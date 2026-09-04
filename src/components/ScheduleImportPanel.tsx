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
  /** Pre-fills whose schedule this is; the "my team" name when one is marked. */
  defaultSubjectTeam: string;
  onImport: (teams: ScoutTeam[], games: ScoutGame[]) => void;
  onClose: () => void;
  showToast: (message: string, options?: { tone?: ToastTone }) => void;
};

type ReviewRow = {
  key: string;
  include: boolean;
  date: string;
  opponent: string;
  isHome: boolean;
  teamScore: string;
  opponentScore: string;
};

type Stage = "picking" | "reading" | "review";

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
 * Import games from a schedule screenshot: pick an image, let the model read it, then review every
 * row before anything is saved. The review step is the point — a misread score would quietly skew
 * the ratings, so nothing is committed until it has been looked at, and anything that matches a
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
  const [failure, setFailure] = useState<{
    reason: LeagueSummaryErrorReason;
    message: string;
  } | null>(null);
  const [subjectTeam, setSubjectTeam] = useState(defaultSubjectTeam);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const rowKey = useRef(0);

  const subjectOptions = useMemo(
    () => suggestedTeams.map((team) => team.name),
    [suggestedTeams]
  );

  const idByName = useMemo(() => {
    const map = new Map<string, string>();
    teams.forEach((team) => map.set(teamNameKey(team.name), team.id));
    return map;
  }, [teams]);

  /**
   * Which rows already exist here. A brand-new opponent can't be a duplicate, so this only has to
   * consider rows where both names already resolve to known teams.
   */
  const duplicateKeys = useMemo(() => {
    const subjectId = idByName.get(teamNameKey(subjectTeam));
    if (!subjectId) return new Set<string>();
    const flagged = new Set<string>();
    rows.forEach((row) => {
      const opponentId = idByName.get(teamNameKey(row.opponent));
      if (!opponentId || opponentId === subjectId) return;
      if (!isValidScorePair(row.teamScore, row.opponentScore)) return;
      const played = row.teamScore.trim() !== "" && row.opponentScore.trim() !== "";
      const candidate: ScoutGame = {
        id: `preview_${row.key}`,
        teamAId: subjectId,
        teamBId: opponentId,
        ageGroupId,
        ...(played
          ? { teamAScore: Number(row.teamScore), teamBScore: Number(row.opponentScore) }
          : {}),
        ...(row.date ? { date: row.date } : {}),
      };
      if (findDuplicateGame(candidate, existingGames)) flagged.add(row.key);
    });
    return flagged;
  }, [rows, subjectTeam, idByName, ageGroupId, existingGames]);

  const applyOutcome = (outcome: ScheduleImageOutcome) => {
    if (!outcome.ok) {
      setFailure({ reason: outcome.reason, message: outcome.message });
      setStage("picking");
      return;
    }
    // These headers are usually cut off ("South Lexington Re…"), so the model's reading is only a
    // hint. Take it only when it lands on a team already in this age group; otherwise leave the
    // field empty so it gets picked rather than saved as a truncated near-duplicate.
    if (outcome.subjectTeam && !defaultSubjectTeam) {
      setSubjectTeam(resolveTruncatedName(outcome.subjectTeam, suggestedTeams) ?? "");
    }
    setRows(
      outcome.games.map((game) => {
        rowKey.current += 1;
        return {
          key: `r${rowKey.current}`,
          // Pre-checked here, then unchecked below if it turns out to be a duplicate.
          include: true,
          date: game.date ?? "",
          opponent: game.opponent,
          isHome: game.isHome ?? true,
          teamScore: game.teamScore === undefined ? "" : String(game.teamScore),
          opponentScore: game.opponentScore === undefined ? "" : String(game.opponentScore),
        };
      })
    );
    setFailure(null);
    setStage("review");
  };

  const handleFile = async (file: File | null) => {
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

  const updateRow = (key: string, patch: Partial<ReviewRow>) => {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const includedRows = rows.filter((row) => row.include && !duplicateKeys.has(row.key));
  const subjectMissing = subjectTeam.trim().length === 0;
  const badRows = includedRows.filter(
    (row) =>
      row.opponent.trim().length === 0 ||
      teamNameKey(row.opponent) === teamNameKey(subjectTeam) ||
      !isValidScorePair(row.teamScore, row.opponentScore)
  );

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
    const subject = resolveOrCreateTeam(subjectTeam, pool);
    pool = subject.teams;

    const games: ScoutGame[] = [];
    includedRows.forEach((row, index) => {
      const opponent = resolveOrCreateTeam(row.opponent, pool);
      pool = opponent.teams;
      const played = row.teamScore.trim() !== "" && row.opponentScore.trim() !== "";
      games.push({
        id: `scout_${Date.now()}_${index}_${Math.floor(Math.random() * 1000)}`,
        teamAId: subject.teamId,
        teamBId: opponent.teamId,
        ageGroupId,
        ...(played
          ? { teamAScore: Number(row.teamScore), teamBScore: Number(row.opponentScore) }
          : {}),
        ...(row.date ? { date: row.date } : {}),
      });
    });

    onImport(pool, games);
  };

  return (
    <div className={`${card} p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">
          Import from screenshot{ageGroupName ? ` → ${ageGroupName}` : ""}
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
            Take a screenshot of a team&apos;s schedule (the list of games with scores) and pick it
            here. Every game is shown for review before anything is saved.
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
                void handleFile(file);
              }}
            />
          </label>
        </>
      )}

      {failure && (
        <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs font-semibold leading-5 text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:ring-slate-700">
          <span className="mr-2 font-black uppercase tracking-wide">
            {aiStoryUnavailableLabel(failure.reason)}
          </span>
          {failure.message} You can still add games by hand.
        </div>
      )}

      {stage === "review" && (
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
              Needed — every row is scored from this team&apos;s side. Screenshot headers are
              usually cut off, so this one has to be confirmed by hand.
            </p>
          )}

          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="py-2">Add</th>
                  <th>Date</th>
                  <th>Opponent</th>
                  <th>Score</th>
                  <th>Opp</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const duplicate = duplicateKeys.has(row.key);
                  const invalid =
                    row.include &&
                    !duplicate &&
                    (row.opponent.trim().length === 0 ||
                      teamNameKey(row.opponent) === teamNameKey(subjectTeam) ||
                      !isValidScorePair(row.teamScore, row.opponentScore));
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
                          aria-label={`Add ${row.opponent || "this game"}`}
                          onChange={(event) => updateRow(row.key, { include: event.target.checked })}
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
                        <span className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => updateRow(row.key, { isHome: !row.isHome })}
                            title={row.isHome ? "Home game" : "Away game"}
                            className="text-xs font-bold text-slate-500 hover:underline dark:text-slate-400"
                          >
                            {row.isHome ? "vs" : "@"}
                          </button>
                          <input
                            type="text"
                            value={row.opponent}
                            onChange={(event) =>
                              updateRow(row.key, { opponent: event.target.value })
                            }
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
                          value={row.teamScore}
                          onChange={(event) =>
                            updateRow(row.key, { teamScore: event.target.value })
                          }
                          className={`${inputClass} w-16`}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={row.opponentScore}
                          onChange={(event) =>
                            updateRow(row.key, { opponentScore: event.target.value })
                          }
                          className={`${inputClass} w-16`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-2 text-xs text-slate-500">
            Scores read off a picture are worth a glance — check them against the screenshot before
            adding. Leave both scores blank for a game that hasn&apos;t been played yet.
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
