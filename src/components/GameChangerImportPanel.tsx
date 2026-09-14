import { useMemo, useRef, useState } from "react";
import { gcTeamPageUrl, parseGcTeamList, type GcTeamListEntry } from "../lib/gameChangerApi";
import { fetchGcTeams } from "../lib/gameChangerClient";
import {
  importGcSchedule,
  proposeSeasonPairings,
  summarizeGcImport,
  type GcImportOutcome,
  type GcImportState,
  type GcSeasonPairing,
} from "../lib/gameChangerImport";
import {
  describePull,
  isPullComplete,
  pullView,
  remainingIds,
  retryFailures,
  retryableIds,
  settleTeam,
  startPull,
  type GcPullFailure,
  type GcPullProgress,
  type GcPullView,
} from "../lib/gameChangerPull";
import {
  describeDue,
  describeRotation,
  dueRefresh,
  markRefreshed,
  type RefreshLog,
} from "../lib/gameChangerSchedule";
import { mergeScoutTeams } from "../lib/teamRankings";
import type { ToastTone } from "../hooks/useToast";
import { button, card, pill } from "../styles/tokens";

type GameChangerImportPanelProps = {
  /** The pool as it stands. The panel works on a copy and hands whole states back. */
  pool: GcImportState;
  /**
   * Saves the pool. Called as the pull runs, not only at the end: a run of a few thousand teams
   * will be interrupted, and what it fetched before that should still be there.
   */
  onPersist: (pool: GcImportState) => boolean;
  /** A run already under way when the panel opened, so it can offer to carry on. */
  savedProgress: GcPullProgress | null;
  onSaveProgress: (progress: GcPullProgress) => void;
  onClearProgress: () => void;
  onClose: () => void;
  showToast: (message: string, options?: { tone?: ToastTone }) => void;
  /** Which levels have already had their turn today, and how to record that they have. */
  refreshLog: RefreshLog;
  onRefreshLog: (log: RefreshLog) => void;
};

type Stage = "picking" | "pulling" | "review";

/**
 * How many schedules are folded in before the pool is written. Writing after every one would be
 * thousands of saves of a growing pool; waiting for the end would throw away an interrupted run.
 * The cursor is only advanced *after* the write, so a crash re-fetches this batch rather than
 * claiming teams it never kept.
 */
const SAVE_EVERY = 25;

/** Requests in flight. Four is what the client defaults to and what GameChanger seems content with. */
const CONCURRENCY = 4;

const SAMPLE = `https://web.gc.com/teams/FtEExZwB4b8E/2026-fall-trosky-illinois-9u/schedule
gsUthn4XoIxS

…or paste the whole export, headers and all:
Team Name,Team ID,Age Group,Season,City,State
"9u Astros 9U",hH8l9MBjxg7U,9U,Fall 2026,Baileyton,AL`;

const nowIso = () => new Date().toISOString();

const REASON_LABEL: Record<string, string> = {
  "invalid-id": "Not a GameChanger id",
  "not-found": "No such team",
  blocked: "GameChanger refused the request",
  throttled: "Too many requests",
  "upstream-error": "GameChanger errored",
  unrecognized: "Unreadable answer",
  network: "Could not reach it",
  unconfigured: "Proxy not deployed",
  timeout: "Timed out",
};

export function GameChangerImportPanel({
  pool,
  onPersist,
  savedProgress,
  onSaveProgress,
  onClearProgress,
  onClose,
  showToast,
  refreshLog,
  onRefreshLog,
}: GameChangerImportPanelProps) {
  const [text, setText] = useState("");
  const [stage, setStage] = useState<Stage>("picking");
  const [pairings, setPairings] = useState<GcSeasonPairing[]>([]);
  const [approved, setApproved] = useState<Set<string>>(new Set());
  /** Counts for the bar. Numbers rather than the cursor itself, so a redraw copies almost nothing. */
  const [stats, setStats] = useState<GcPullView | null>(null);
  /** What the run came to, worked out once when it finishes rather than on every render. */
  const [result, setResult] = useState<{
    summary: string[];
    failures: GcPullFailure[];
    canRetry: boolean;
  } | null>(null);

  // The pull mutates these as results land. Holding the working pool in state instead would queue
  // a render per team and copy a growing pool each time; what the panel draws is kept separately.
  const poolRef = useRef<GcImportState>(pool);
  const progressRef = useRef<GcPullProgress | null>(savedProgress);
  const outcomesRef = useRef<GcImportOutcome[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  /** The levels a scheduled run is for, so they can be marked done when it finishes. */
  const dueLevelsRef = useRef<number[]>([]);

  const parsed = useMemo(() => parseGcTeamList(text), [text]);

  const due = useMemo(
    () => dueRefresh(new Date(), refreshLog, pool.ageGroups, pool.teams),
    [refreshLog, pool.ageGroups, pool.teams]
  );
  const [showWeek, setShowWeek] = useState(false);
  const resumable = savedProgress ? remainingIds(savedProgress) : [];

  /** Copies the counts out of the live cursor so React has something it can see change. */
  const syncStats = () => {
    if (progressRef.current) setStats(pullView(progressRef.current));
  };

  const persist = (): boolean => {
    const ok = onPersist(poolRef.current);
    if (!ok) showToast("Could not save the pull (storage full).", { tone: "error" });
    return ok;
  };

  /**
   * Runs the pull. Each schedule is folded in as it arrives rather than collected and applied at
   * the end, so stopping — or closing the tab — keeps everything already fetched.
   */
  const run = async (ids: string[], progress: GcPullProgress) => {
    const controller = new AbortController();
    abortRef.current = controller;
    progressRef.current = progress;
    outcomesRef.current = [];
    setStage("pulling");
    setResult(null);
    syncStats();

    // Settled but not yet written. The cursor follows the save, never leads it.
    let unsaved: string[] = [];

    const flush = () => {
      if (unsaved.length === 0) return;
      if (!persist()) return;
      const at = nowIso();
      unsaved.forEach((teamId) => {
        const failure = pendingFailures.get(teamId);
        progressRef.current = settleTeam(progressRef.current ?? progress, teamId, at, failure);
      });
      if (progressRef.current) onSaveProgress(progressRef.current);
      unsaved = [];
      pendingFailures.clear();
    };

    const pendingFailures = new Map<
      string,
      { reason: GcPullProgress["failures"][number]["reason"]; message: string }
    >();

    await fetchGcTeams(ids, {
      concurrency: CONCURRENCY,
      signal: controller.signal,
      onProgress: ({ teamId, result }) => {
        if (result.ok) {
          const folded = importGcSchedule(result.schedule, poolRef.current);
          poolRef.current = folded.state;
          outcomesRef.current.push(folded.outcome);
        } else {
          pendingFailures.set(teamId, { reason: result.reason, message: result.message });
        }
        unsaved.push(teamId);
        if (unsaved.length >= SAVE_EVERY) flush();
        // The cursor only advances on a flush, so the bar counts what is settled plus what is
        // fetched and waiting to be written — otherwise it would sit still between saves.
        const settled = progressRef.current?.settled.length ?? 0;
        const total = progressRef.current?.ids.length ?? ids.length;
        setStats({
          done: Math.min(settled + unsaved.length, total),
          total,
          failed: (progressRef.current?.failures.length ?? 0) + pendingFailures.size,
          fraction: total === 0 ? 0 : Math.min(settled + unsaved.length, total) / total,
        });
      },
    });

    flush();
    abortRef.current = null;
    // Marked only now: a run that was stopped half way has not refreshed those levels.
    if (
      dueLevelsRef.current.length > 0 &&
      progressRef.current &&
      isPullComplete(progressRef.current)
    ) {
      onRefreshLog(markRefreshed(refreshLog, dueLevelsRef.current, new Date()));
    }
    dueLevelsRef.current = [];
    const finished = progressRef.current;
    setResult({
      summary: summarizeGcImport(outcomesRef.current),
      failures: finished?.failures ?? [],
      canRetry: finished ? retryableIds(finished).length > 0 : false,
    });
    setPairings(proposeSeasonPairings(poolRef.current.teams));
    setApproved(new Set());
    setStage("review");
    syncStats();
  };

  const runDue = () => {
    if (due.teamIds.length === 0) return;
    const progress = startPull(due.teamIds, nowIso(), null);
    onSaveProgress(progress);
    dueLevelsRef.current = due.ageLevels;
    void run(remainingIds(progress), progress);
  };

  const startNew = () => {
    const ids = parsed.entries.map((entry) => entry.teamId);
    if (ids.length === 0) {
      showToast("No GameChanger ids in that.", { tone: "error" });
      return;
    }
    const progress = startPull(ids, nowIso(), savedProgress);
    onSaveProgress(progress);
    void run(remainingIds(progress), progress);
  };

  const resume = () => {
    if (!savedProgress) return;
    void run(remainingIds(savedProgress), savedProgress);
  };

  const retry = () => {
    const current = progressRef.current;
    if (!current) return;
    const next = retryFailures(current, nowIso());
    onSaveProgress(next);
    void run(remainingIds(next), next);
  };

  const stop = () => {
    abortRef.current?.abort();
    showToast("Stopping after the requests already in flight.", { tone: "info" });
  };

  const pairKey = (pairing: GcSeasonPairing) => `${pairing.fromTeamId}>${pairing.toTeamId}`;

  const applyPairings = () => {
    if (approved.size === 0) {
      onClearProgress();
      onClose();
      return;
    }
    let next = poolRef.current;
    let merged = 0;
    pairings.forEach((pairing) => {
      if (!approved.has(pairKey(pairing))) return;
      // Both may already have been merged away by an earlier approval in this same pass.
      const from = next.teams.find((team) => team.id === pairing.fromTeamId);
      const to = next.teams.find((team) => team.id === pairing.toTeamId);
      if (!from || !to) return;
      const result = mergeScoutTeams(pairing.fromTeamId, pairing.toTeamId, next.teams, next.games);
      next = { ...next, teams: result.teams, games: result.games };
      merged += 1;
    });
    poolRef.current = next;
    if (persist()) {
      showToast(`${merged} squad${merged === 1 ? "" : "s"} paired.`, { tone: "success" });
    }
    onClearProgress();
    onClose();
  };

  return (
    <div className={`${card} mt-4 p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">
            Pull from GameChanger
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-slate-500">
            Paste team ids, team page links, or a whole spreadsheet export. Each team&apos;s
            schedule is read and filed under its own age group and squad year — the pages are
            created as needed. A pull of a few thousand teams takes a while; it saves as it goes, so
            stopping or closing the tab keeps what it already has.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs font-bold text-slate-500 hover:underline dark:text-slate-400"
        >
          Close
        </button>
      </div>

      {stage === "picking" && (
        <div className="mt-4">
          <div className="mb-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold text-slate-950 dark:text-white">{describeDue(due)}</p>
              <button
                type="button"
                onClick={() => setShowWeek((value) => !value)}
                aria-expanded={showWeek}
                className="text-xs font-bold text-blue-600 hover:underline dark:text-blue-400"
              >
                {showWeek ? "Hide the week" : "The week"}
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Each age group comes round once a week, so no level is more than seven days old and no
              day&apos;s run is long enough to be worth interrupting. Nothing happens on its own — a
              browser cannot run while it is closed — so this is here whenever you next open it.
            </p>
            {showWeek && (
              <ul className="mt-2 space-y-0.5 text-xs text-slate-500">
                {describeRotation().map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
            {due.teamIds.length > 0 && (
              <button type="button" onClick={runDue} className={`${button.primary} mt-3`}>
                Refresh today&apos;s {due.ageLevels.map((level) => `${level}U`).join(" and ")}
              </button>
            )}
          </div>

          {resumable.length > 0 && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900/70 dark:bg-amber-950/40">
              <p className="font-bold text-amber-900 dark:text-amber-200">
                A pull was interrupted.
              </p>
              <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                {describePull(savedProgress!)} {resumable.length} still to go.
              </p>
              <div className="mt-2 flex flex-wrap gap-3">
                <button type="button" onClick={resume} className={button.primary}>
                  Carry on
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClearProgress();
                    progressRef.current = null;
                    setStats(null);
                  }}
                  className="text-xs font-bold text-amber-900 hover:underline dark:text-amber-200"
                >
                  Start over instead
                </button>
              </div>
            </div>
          )}

          <label
            className="text-xs font-semibold uppercase tracking-wide text-slate-500"
            htmlFor="gc-import-text"
          >
            Teams
          </label>
          <textarea
            id="gc-import-text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={8}
            spellCheck={false}
            placeholder={SAMPLE}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-3 font-mono text-xs dark:border-slate-800 dark:bg-slate-900"
          />

          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            {text.trim() === "" ? (
              <span>Nothing pasted yet.</span>
            ) : (
              <>
                <span className={pill(parsed.entries.length ? "emerald" : "red")}>
                  {parsed.entries.length} team{parsed.entries.length === 1 ? "" : "s"}
                </span>
                {parsed.skipped.length > 0 && (
                  <span className={pill("amber")}>{parsed.skipped.length} line(s) ignored</span>
                )}
                {parsed.entries.length > 200 && (
                  <span>
                    About {Math.ceil((parsed.entries.length * 2) / CONCURRENCY / 60)} minute(s) of
                    requests.
                  </span>
                )}
              </>
            )}
          </div>

          {parsed.entries.length > 0 && <ParsedPreview entries={parsed.entries} />}

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={startNew}
              disabled={parsed.entries.length === 0}
              className={button.primary}
            >
              Pull {parsed.entries.length || ""} schedule
              {parsed.entries.length === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      )}

      {stage === "pulling" && stats && (
        <div className="mt-4">
          <div className="h-2 w-full overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-900">
            <div
              className="h-full bg-slate-950 transition-[width] dark:bg-white"
              style={{ width: `${Math.round(stats.fraction * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-sm font-bold text-slate-950 dark:text-white">
            {stats.done} of {stats.total} pulled
            {stats.failed ? `, ${stats.failed} failed` : ""}.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Saved every {SAVE_EVERY} teams. You can stop, close this, or leave the tab — it picks up
            where it left off.
          </p>
          <div className="mt-3">
            <button type="button" onClick={stop} className={button.ghost}>
              Stop
            </button>
          </div>
        </div>
      )}

      {stage === "review" && result && (
        <div className="mt-4">
          <ul className="space-y-1 text-sm text-slate-700 dark:text-slate-200">
            {result.summary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>

          {result.failures.length > 0 && (
            <div className="mt-4 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Could not be reached
              </p>
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs">
                {result.failures.slice(0, 50).map((failure) => (
                  <li key={failure.teamId} className="flex flex-wrap gap-2">
                    <a
                      href={gcTeamPageUrl(failure.teamId)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono font-bold text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {failure.teamId}
                    </a>
                    <span className="text-slate-500">
                      {REASON_LABEL[failure.reason] ?? failure.reason}
                    </span>
                  </li>
                ))}
              </ul>
              {result.failures.length > 50 && (
                <p className="mt-1 text-xs text-slate-500">
                  …and {result.failures.length - 50} more.
                </p>
              )}
              {result.canRetry && (
                <button type="button" onClick={retry} className={`${button.ghost} mt-3`}>
                  Try those again
                </button>
              )}
            </div>
          )}

          {pairings.length > 0 && (
            <div className="mt-4 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Same squad, a season on?
              </p>
              <p className="mt-1 text-xs text-slate-500">
                GameChanger gives a club a new id every season, so these arrived as separate teams.
                Pairing them makes one team with both seasons behind it. Nothing is paired unless
                you tick it — two clubs that merely share a name are not the same club.
              </p>
              <ul className="mt-2 max-h-56 space-y-2 overflow-y-auto">
                {pairings.slice(0, 100).map((pairing) => {
                  const key = pairKey(pairing);
                  return (
                    <li key={key} className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        id={`pair-${key}`}
                        checked={approved.has(key)}
                        onChange={(event) => {
                          setApproved((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(key);
                            else next.delete(key);
                            return next;
                          });
                        }}
                        className="mt-1"
                      />
                      <label htmlFor={`pair-${key}`} className="flex-1">
                        <span className="font-bold text-slate-950 dark:text-white">
                          {pairing.fromTeamName}
                        </span>{" "}
                        <span className="text-slate-500">
                          {pairing.fromSeason} → {pairing.toSeason}
                        </span>{" "}
                        <span
                          className={pill(pairing.confidence === "strong" ? "emerald" : "amber")}
                        >
                          {pairing.basis === "avatar" ? "same picture" : "same name"}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              {pairings.length > 100 && (
                <p className="mt-1 text-xs text-slate-500">
                  Showing the first 100 of {pairings.length}; the rest can be paired from a
                  team&apos;s own panel.
                </p>
              )}
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" onClick={applyPairings} className={button.primary}>
              {approved.size > 0 ? `Pair ${approved.size} and finish` : "Finish"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The first few rows of what was pasted, so a wrong column mapping shows itself before the pull. */
function ParsedPreview({ entries }: { entries: GcTeamListEntry[] }) {
  const sample = entries.slice(0, 5);
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
      <table className="w-full text-left text-xs">
        <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900">
          <tr>
            <th className="px-2 py-1">Id</th>
            <th className="px-2 py-1">Name</th>
            <th className="px-2 py-1">Age</th>
            <th className="px-2 py-1">Season</th>
            <th className="px-2 py-1">Where</th>
          </tr>
        </thead>
        <tbody>
          {sample.map((entry) => (
            <tr key={entry.teamId} className="border-t border-slate-100 dark:border-slate-800">
              <td className="px-2 py-1 font-mono">{entry.teamId}</td>
              <td className="px-2 py-1">{entry.name ?? "—"}</td>
              <td className="px-2 py-1">{entry.ageLevel ? `${entry.ageLevel}U` : "—"}</td>
              <td className="px-2 py-1">
                {entry.season ? `${entry.season.season} ${entry.season.year}` : "—"}
              </td>
              <td className="px-2 py-1">
                {[entry.city, entry.state].filter(Boolean).join(", ") || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {entries.length > sample.length && (
        <p className="px-2 py-1 text-xs text-slate-500">
          …and {entries.length - sample.length} more.
        </p>
      )}
    </div>
  );
}
