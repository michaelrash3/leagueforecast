import { useMemo, useRef, useState } from "react";
import {
  findDuplicateGame,
  findSimilarTeam,
  isPlaceholderName,
  resolveOrCreateTeam,
  teamNameKey,
  type ScoutGame,
  type ScoutTeam,
} from "../lib/teamRankings";
import { parseScheduleText, type ParsedGameRow } from "../lib/scheduleText";
import { TeamNameCombobox } from "./TeamNameCombobox";
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
  /** Pre-fills whose schedule this is, when rows name only the opponent; the "my team" name. */
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

type Stage = "picking" | "review";

const SAMPLE_PASTE = `Date,Opponent,Us,Them
2026-08-22,Velocirabbits,6,5
2026-08-23,NV Stars,3,10
2026-09-05,Bourbon Bandits,,`;

const inputClass =
  "rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm dark:border-slate-800 dark:bg-slate-900";

const isValidScorePair = (a: string, b: string) => {
  const bothBlank = a.trim() === "" && b.trim() === "";
  if (bothBlank) return true;
  if (a.trim() === "" || b.trim() === "") return false;
  return (
    Number.isFinite(Number(a)) && Number(a) >= 0 && Number.isFinite(Number(b)) && Number(b) >= 0
  );
};

/**
 * A one-line flag under a name in the review table: a placeholder that names nobody, or a team
 * this age group probably already has under a slightly different spelling. The suggestion is a
 * button rather than an automatic correction, because two real teams can be one character apart.
 */
function NameNote({
  note,
  onUse,
}: {
  note: { kind: "placeholder" } | { kind: "similar"; to: string } | null;
  onUse: (name: string) => void;
}) {
  if (!note) return null;
  if (note.kind === "placeholder") {
    return (
      <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-500">
        Placeholder — set the real team before adding
      </span>
    );
  }
  return (
    <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-500">
      Close to{" "}
      <button
        type="button"
        onClick={() => onUse(note.to)}
        className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
        title="Use this name instead"
      >
        {note.to}
      </button>
    </span>
  );
}

/**
 * Import games in bulk from pasted text or a CSV, then review every row before anything is saved.
 * The review step is the point: a wrong score would quietly skew the ratings, so nothing is
 * committed until it has been looked at, and anything matching a game already in this age group
 * arrives unchecked.
 *
 * Everything happens on the device — no key, no network call, nothing to run out.
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
  const [pasteText, setPasteText] = useState("");
  const [skipped, setSkipped] = useState<string[]>([]);
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

  /**
   * What is worth a second look about a name before it becomes a team. A placeholder would create
   * a team that collects games belonging to whoever actually turns up; a near-match is usually the
   * same club spelled two ways, and left alone it splits one team's record in half.
   *
   * Both are shown, never applied: "South Lexington Red" and "South Lexington Blue" are four
   * characters apart and are two different teams.
   */
  const nameNote = (
    value: string
  ): { kind: "placeholder" } | { kind: "similar"; to: string } | null => {
    const name = value.trim();
    if (!name) return null;
    if (isPlaceholderName(name)) return { kind: "placeholder" };
    const close = findSimilarTeam(name, teams);
    return close ? { kind: "similar", to: close.name } : null;
  };
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

  const applyGames = (games: ParsedGameRow[], readSubject?: string) => {
    if (readSubject && !defaultSubjectTeam) setSubjectTeam(readSubject);
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
    setStage("review");
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
          <p className="mt-1 text-xs text-slate-500">
            Paste your games below, one per line, or pick a CSV file. Every game is shown for review
            before anything is saved.
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
              <code>SAT 22 vs. Velocirabbits W 6-5</code> under an <code>August 2026</code> heading.
              Scores are always read from your team&apos;s side first, so <code>L 3-10</code> means
              you scored 3. Leave both scores blank for a game that hasn&apos;t been played.
            </p>
          </details>
        </>
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
                  team&apos;s side.
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
                        <span className="flex flex-col gap-1">
                          <input
                            type="text"
                            value={nameA(row)}
                            // Typing here pins the row to a team of its own, so it stops following
                            // the subject field above.
                            onChange={(event) => updateRow(row.key, { teamA: event.target.value })}
                            aria-label="Team"
                            className={`${inputClass} w-44`}
                          />
                          <NameNote
                            note={nameNote(nameA(row))}
                            onUse={(name) => updateRow(row.key, { teamA: name })}
                          />
                        </span>
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
                        <span className="flex flex-col gap-1">
                          <span className="flex items-center gap-1">
                            <input
                              type="text"
                              value={row.teamB}
                              aria-label="Opponent"
                              onChange={(event) =>
                                updateRow(row.key, { teamB: event.target.value })
                              }
                              className={`${inputClass} w-44`}
                            />
                            {duplicate && (
                              <span className={pill("neutral")} title="Already in this age group">
                                Already logged
                              </span>
                            )}
                          </span>
                          <NameNote
                            note={nameNote(row.teamB)}
                            onUse={(name) => updateRow(row.key, { teamB: name })}
                          />
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
            Check the scores against what you pasted before adding. Leave both scores blank for a
            game that hasn&apos;t been played yet.
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
