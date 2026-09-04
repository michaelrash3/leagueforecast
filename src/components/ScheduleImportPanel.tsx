import { useMemo, useRef, useState } from "react";
import {
  findDuplicateGame,
  resolveOrCreateTeam,
  resolveTruncatedName,
  teamNameKey,
  type ScoutGame,
  type ScoutTeam,
} from "../lib/teamRankings";
import {
  readImageForUpload,
  requestScheduleImageParse,
  type ScheduleImageOutcome,
} from "../lib/scheduleImageClient";
import { parseScheduleText, type ParsedGameRow } from "../lib/scheduleText";
import { aiStoryUnavailableLabel } from "./AiStoryPanel";
import { TeamNameCombobox } from "./TeamNameCombobox";
import type { LeagueSummaryErrorReason } from "../lib/leagueSummary";
import type { ToastTone } from "../hooks/useToast";
import { button, card, pill } from "../styles/tokens";

type ScheduleImportPanelProps = {
  ageGroupId: string;
  ageGroupName: string;
  /** The full roster, so an opponent already known resolves to the same team. */
  teams: ScoutTeam[];
  /** The teams this age group already knows — what the subject-name dropdown offers. */
  suggestedTeams: ScoutTeam[];
  /** Everything already in this age group — manual and league-derived — for duplicate checks. */
  existingGames: ScoutGame[];
  /** Pre-fills whose schedule this is, for sources that only name the opponent; the "my team" name. */
  defaultSubjectTeam: string;
  onImport: (teams: ScoutTeam[], games: ScoutGame[]) => void;
  onClose: () => void;
  showToast: (message: string, options?: { tone?: ToastTone }) => void;
};

type ReviewRow = {
  key: string;
  include: boolean;
  date: string;
  /**
   * `null` means "whoever the subject team is" — a schedule names only the opponent, so its rows
   * borrow the subject until it is known. A game list names both sides and fills this in outright.
   */
  teamA: string | null;
  teamB: string;
  scoreA: string;
  scoreB: string;
};

type Stage = "picking" | "reading" | "review";

/**
 * Screenshots need Gemini; pasted text does not. Both land in the same review table, so when the
 * key is missing or its quota is spent there is still a way in that always works.
 */
type Source = "screenshot" | "text";

const SAMPLE_PASTE = `Date,Opponent,Us,Them
2026-08-22,Velocirabbits,6,5
2026-08-23,NV Stars,3,10
2026-09-05,Bourbon Bandits,,`;

const inputClass =
  "rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm dark:border-slate-800 dark:bg-slate-900";

const sourceTab = (active: boolean) =>
  `rounded-md px-3 py-1.5 text-xs font-bold ${
    active
      ? "bg-white text-slate-950 shadow-sm dark:bg-slate-700 dark:text-white"
      : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
  }`;

const isValidScorePair = (a: string, b: string) => {
  const bothBlank = a.trim() === "" && b.trim() === "";
  if (bothBlank) return true;
  if (a.trim() === "" || b.trim() === "") return false;
  return (
    Number.isFinite(Number(a)) && Number(a) >= 0 && Number.isFinite(Number(b)) && Number(b) >= 0
  );
};

/**
 * Import games in bulk — from a schedule screenshot, or from pasted text or a CSV — then review
 * every row before anything is saved. The review step is the point: a misread score would quietly
 * skew the ratings, so nothing is committed until it has been looked at, and anything matching a
 * game already in this age group arrives unchecked.
 */
export function ScheduleImportPanel({
  ageGroupId,
  ageGroupName,
  teams,
  suggestedTeams,
  existingGames,
  defaultSubjectTeam,
  onImport,
  onClose,
  showToast,
}: ScheduleImportPanelProps) {
  const [stage, setStage] = useState<Stage>("picking");
  const [source, setSource] = useState<Source>("screenshot");
  const [pasteText, setPasteText] = useState("");
  const [skipped, setSkipped] = useState<string[]>([]);
  const [failure, setFailure] = useState<{
    reason: LeagueSummaryErrorReason;
    message: string;
  } | null>(null);
  const [subjectTeam, setSubjectTeam] = useState(defaultSubjectTeam);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const rowKey = useRef(0);

  const subjectOptions = useMemo(() => suggestedTeams.map((team) => team.name), [suggestedTeams]);

  const idByName = useMemo(() => {
    const map = new Map<string, string>();
    teams.forEach((team) => map.set(teamNameKey(team.name), team.id));
    return map;
  }, [teams]);

  /** A row's home-side name: its own, or the subject when the source only named an opponent. */
  const nameA = (row: ReviewRow) => row.teamA ?? subjectTeam;
  /** True while any row is still waiting on the subject field to know who it played. */
  const needsSubject = rows.some((row) => row.teamA === null);

  /**
   * Which rows already exist here. A brand-new team can't be part of a duplicate, so this only has
   * to consider rows where both names already resolve to known teams.
   */
  const duplicateKeys = useMemo(() => {
    const flagged = new Set<string>();
    rows.forEach((row) => {
      const idA = idByName.get(teamNameKey(row.teamA ?? subjectTeam));
      const idB = idByName.get(teamNameKey(row.teamB));
      if (!idA || !idB || idA === idB) return;
      if (!isValidScorePair(row.scoreA, row.scoreB)) return;
      const played = row.scoreA.trim() !== "" && row.scoreB.trim() !== "";
      const candidate: ScoutGame = {
        id: `preview_${row.key}`,
        teamAId: idA,
        teamBId: idB,
        ageGroupId,
        ...(played ? { teamAScore: Number(row.scoreA), teamBScore: Number(row.scoreB) } : {}),
        ...(row.date ? { date: row.date } : {}),
      };
      if (findDuplicateGame(candidate, existingGames)) flagged.add(row.key);
    });
    return flagged;
  }, [rows, subjectTeam, idByName, ageGroupId, existingGames]);

  /** Both sources land here, so the review table behaves identically however the rows were read. */
  const applyGames = (
    games: ParsedGameRow[],
    readSubject?: string,
    { truncated = false }: { truncated?: boolean } = {}
  ) => {
    if (readSubject && !defaultSubjectTeam) {
      // A screenshot header is usually cut off ("South Lexington Re…"), so it is only a hint: take
      // it only when it lands on a team this age group already knows, rather than saving a
      // truncated near-duplicate of a real team. A name read from a CSV column is not truncated —
      // it is exactly what was typed — so it is taken as written.
      setSubjectTeam(
        truncated ? (resolveTruncatedName(readSubject, suggestedTeams) ?? "") : readSubject
      );
    }
    setRows(
      games.map((game) => {
        rowKey.current += 1;
        return {
          key: `r${rowKey.current}`,
          // Pre-checked here, then unchecked below if it turns out to be a duplicate.
          include: true,
          date: game.date ?? "",
          teamA: game.teamA ?? null,
          teamB: game.teamB,
          scoreA: game.scoreA === undefined ? "" : String(game.scoreA),
          scoreB: game.scoreB === undefined ? "" : String(game.scoreB),
        };
      })
    );
    setFailure(null);
    setStage("review");
  };

  const applyOutcome = (outcome: ScheduleImageOutcome) => {
    if (!outcome.ok) {
      setFailure({ reason: outcome.reason, message: outcome.message });
      setStage("picking");
      return;
    }
    setSkipped([]);
    applyGames(
      // The image contract is subject-relative: every row names only the opponent.
      outcome.games.map((game) => ({
        ...(game.date ? { date: game.date } : {}),
        teamB: game.opponent,
        ...(game.teamScore !== undefined && game.opponentScore !== undefined
          ? { scoreA: game.teamScore, scoreB: game.opponentScore }
          : {}),
      })),
      outcome.subjectTeam,
      { truncated: true }
    );
  };

  const handleImageFile = async (file: File | null) => {
    if (!file) return;
    setFailure(null);
    setStage("reading");
    const prepared = await readImageForUpload(file);
    if (!prepared.ok) {
      setFailure({ reason: "invalid-request", message: prepared.message });
      setStage("picking");
      return;
    }
    applyOutcome(await requestScheduleImageParse(prepared.payload));
  };

  /** Reads pasted text right here in the browser — no key, no quota, no network call. */
  const readPastedText = (text: string) => {
    const parsed = parseScheduleText(text);
    if (parsed.games.length === 0) {
      showToast(
        text.trim()
          ? "No games could be read from that text — check it against the example below the box."
          : "Paste your games first.",
        { tone: "error" }
      );
      return;
    }
    setSkipped(parsed.skipped);
    applyGames(parsed.games, parsed.subjectTeam);
  };

  const handleTextFile = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => showToast("Could not read that file.", { tone: "error" });
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setPasteText(text);
      readPastedText(text);
    };
    reader.readAsText(file);
  };

  const updateRow = (key: string, patch: Partial<ReviewRow>) => {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const includedRows = rows.filter((row) => row.include && !duplicateKeys.has(row.key));
  const subjectMissing = needsSubject && subjectTeam.trim().length === 0;
  const isBadRow = (row: ReviewRow) =>
    nameA(row).trim().length === 0 ||
    row.teamB.trim().length === 0 ||
    teamNameKey(nameA(row)) === teamNameKey(row.teamB) ||
    !isValidScorePair(row.scoreA, row.scoreB);
  const badRows = includedRows.filter(isBadRow);

  const commit = () => {
    if (subjectMissing) {
      showToast("Enter which team's schedule this is.", { tone: "error" });
      return;
    }
    if (badRows.length > 0) {
      showToast("Fix or uncheck the highlighted rows first.", { tone: "error" });
      return;
    }
    if (includedRows.length === 0) {
      showToast("Nothing selected to add.", { tone: "error" });
      return;
    }

    let pool = teams;
    const games: ScoutGame[] = [];
    includedRows.forEach((row, index) => {
      const a = resolveOrCreateTeam(nameA(row), pool);
      pool = a.teams;
      const b = resolveOrCreateTeam(row.teamB, pool);
      pool = b.teams;
      const played = row.scoreA.trim() !== "" && row.scoreB.trim() !== "";
      games.push({
        id: `scout_${Date.now()}_${index}_${Math.floor(Math.random() * 1000)}`,
        teamAId: a.teamId,
        teamBId: b.teamId,
        ageGroupId,
        ...(played ? { teamAScore: Number(row.scoreA), teamBScore: Number(row.scoreB) } : {}),
        ...(row.date ? { date: row.date } : {}),
      });
    });

    onImport(pool, games);
  };

  return (
    <div className={`${card} p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">
          Import games{ageGroupName ? ` → ${ageGroupName}` : ""}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="text-xs font-bold text-slate-500 hover:underline dark:text-slate-400"
        >
          Close
        </button>
      </div>

      {stage !== "review" && (
        <>
          <div
            role="tablist"
            aria-label="Where the games come from"
            className="mt-3 inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-900"
          >
            <button
              type="button"
              role="tab"
              aria-selected={source === "screenshot"}
              onClick={() => setSource("screenshot")}
              className={sourceTab(source === "screenshot")}
            >
              Screenshot
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={source === "text"}
              onClick={() => setSource("text")}
              className={sourceTab(source === "text")}
            >
              Paste or CSV
            </button>
          </div>

          {source === "screenshot" ? (
            <>
              <p className="mt-2 text-xs text-slate-500">
                Take a screenshot of a team&apos;s schedule (the list of games with scores) and pick
                it here. Every game is shown for review before anything is saved. This one reads the
                picture with AI, so it can be unavailable when the day&apos;s quota is spent —
                &ldquo;Paste or CSV&rdquo; never is.
              </p>
              <label className="mt-3 inline-block">
                <span className={`${button.primary} inline-block cursor-pointer`}>
                  {stage === "reading" ? "Reading screenshot…" : "Choose screenshot"}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={stage === "reading"}
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    // Reset so picking the same file again still fires a change.
                    event.currentTarget.value = "";
                    void handleImageFile(file);
                  }}
                />
              </label>
            </>
          ) : (
            <>
              <p className="mt-2 text-xs text-slate-500">
                Paste your games below, one per line, or pick a CSV file. Read here on your phone —
                no AI, so this always works.
              </p>
              <label className="sr-only" htmlFor="scout-import-paste">
                Games to import
              </label>
              <textarea
                id="scout-import-paste"
                value={pasteText}
                onChange={(event) => setPasteText(event.target.value)}
                rows={6}
                spellCheck={false}
                placeholder={SAMPLE_PASTE}
                className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs dark:border-slate-800 dark:bg-slate-900"
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => readPastedText(pasteText)}
                  className={button.primary}
                >
                  Read games
                </button>
                <label className="inline-block">
                  <span className={`${button.ghost} inline-block cursor-pointer`}>
                    Choose a CSV file
                  </span>
                  <input
                    type="file"
                    accept=".csv,.txt,text/csv,text/plain"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      event.currentTarget.value = "";
                      handleTextFile(file);
                    }}
                  />
                </label>
              </div>
              <details className="mt-2 text-xs text-slate-500">
                <summary className="cursor-pointer font-semibold">What can I paste?</summary>
                <p className="mt-1">
                  A CSV with headers in any order (<code>date</code>, <code>opponent</code>,{" "}
                  <code>us</code>/<code>them</code>, or a single <code>score</code> column holding{" "}
                  <code>6-5</code>), a spreadsheet paste, or schedule lines like{" "}
                  <code>SAT 22 vs. Velocirabbits W 6-5</code> under an <code>August 2026</code>{" "}
                  heading. Scores are always read from your team&apos;s side first, so{" "}
                  <code>L 3-10</code> means you scored 3. Leave both scores blank for a game that
                  hasn&apos;t been played.
                </p>
              </details>
            </>
          )}
        </>
      )}

      {failure && (
        <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs font-semibold leading-5 text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:ring-slate-700">
          <span className="mr-2 font-black uppercase tracking-wide">
            {aiStoryUnavailableLabel(failure.reason)}
          </span>
          {failure.message} Try &ldquo;Paste or CSV&rdquo; above — it reads games on this device,
          with no AI involved — or add them by hand.
        </div>
      )}

      {stage === "review" && (
        <>
          {/* Only a schedule needs this: a game list already names both sides on every row. */}
          {needsSubject && (
            <>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label
                  className="text-xs font-semibold uppercase tracking-wide text-slate-500"
                  htmlFor="scout-import-subject"
                >
                  Whose schedule is this?
                </label>
                <TeamNameCombobox
                  id="scout-import-subject"
                  value={subjectTeam}
                  onChange={setSubjectTeam}
                  options={subjectOptions}
                  placeholder="Team name"
                  className={`${inputClass} w-56`}
                />
              </div>
              {subjectMissing && (
                <p className="mt-1 text-xs font-semibold text-red-600 dark:text-red-400">
                  Needed — these rows name only the opponent, so every score is from this
                  team&apos;s side. Screenshot headers are usually cut off, so it has to be
                  confirmed by hand.
                </p>
              )}
            </>
          )}

          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="py-2">Add</th>
                  <th>Date</th>
                  <th>Team</th>
                  <th>Score</th>
                  <th>Opponent</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const duplicate = duplicateKeys.has(row.key);
                  const invalid = row.include && !duplicate && isBadRow(row);
                  return (
                    <tr
                      key={row.key}
                      className={`border-t border-slate-100 dark:border-slate-800 ${
                        invalid ? "bg-red-50 dark:bg-red-950/30" : ""
                      }`}
                    >
                      <td className="py-2">
                        <input
                          type="checkbox"
                          checked={row.include && !duplicate}
                          disabled={duplicate}
                          aria-label={`Add ${nameA(row) || "this team"} versus ${
                            row.teamB || "this opponent"
                          }`}
                          onChange={(event) =>
                            updateRow(row.key, { include: event.target.checked })
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="date"
                          value={row.date}
                          onChange={(event) => updateRow(row.key, { date: event.target.value })}
                          className={`${inputClass} w-36`}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={nameA(row)}
                          // Typing here pins the row to a team of its own, so it stops following
                          // the subject field above.
                          onChange={(event) => updateRow(row.key, { teamA: event.target.value })}
                          aria-label="Team"
                          className={`${inputClass} w-44`}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={row.scoreA}
                          aria-label="Team score"
                          onChange={(event) => updateRow(row.key, { scoreA: event.target.value })}
                          className={`${inputClass} w-16`}
                        />
                      </td>
                      <td>
                        <span className="flex items-center gap-1">
                          <input
                            type="text"
                            value={row.teamB}
                            aria-label="Opponent"
                            onChange={(event) => updateRow(row.key, { teamB: event.target.value })}
                            className={`${inputClass} w-44`}
                          />
                          {duplicate && (
                            <span className={pill("neutral")} title="Already in this age group">
                              Already logged
                            </span>
                          )}
                        </span>
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={row.scoreB}
                          aria-label="Opponent score"
                          onChange={(event) => updateRow(row.key, { scoreB: event.target.value })}
                          className={`${inputClass} w-16`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {skipped.length > 0 && (
            <p className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-500">
              {skipped.length} line{skipped.length === 1 ? "" : "s"} could not be read and{" "}
              {skipped.length === 1 ? "was" : "were"} left out:{" "}
              <span className="font-mono font-normal">{skipped.slice(0, 3).join(" · ")}</span>
              {skipped.length > 3 ? ` … and ${skipped.length - 3} more` : ""}
            </p>
          )}

          <p className="mt-2 text-xs text-slate-500">
            {source === "screenshot"
              ? "Scores read off a picture are worth a glance — check them against the screenshot before adding."
              : "Check the scores against what you pasted before adding."}{" "}
            Leave both scores blank for a game that hasn&apos;t been played yet.
            {duplicateKeys.size > 0 &&
              ` ${duplicateKeys.size} row${duplicateKeys.size === 1 ? " is" : "s are"} already in this age group and won't be added again.`}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={commit} className={button.primary}>
              Add {includedRows.length} game{includedRows.length === 1 ? "" : "s"}
            </button>
            <button type="button" onClick={onClose} className={button.ghost}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
