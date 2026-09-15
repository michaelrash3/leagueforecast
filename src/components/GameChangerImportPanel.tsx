import { useMemo, useRef, useState } from "react";
import { parseGcTeamList, type GcTeamListEntry } from "../lib/gameChangerApi";
import { fetchGcTeams } from "../lib/gameChangerClient";
import {
  createGcImporter,
  describeTidy,
  GC_PAIRING_EVIDENCE_LABEL,
  proposeSeasonPairings,
  summarizeGcImport,
  tidyPool,
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
import {
  collectGcImportProblems,
  describeGcProblems,
  gcImportProblemsCsv,
  type GcImportProblem,
} from "../lib/gameChangerReport";
import { flushPoolWrites } from "../lib/teamRankingsStorage";
import { MIN_AGE_LEVEL, mergeScoutTeams, pulledGcTeamIds } from "../lib/teamRankings";
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
 * Teams between saves. Each save writes the whole pool, so on a run of several thousand the cost
 * is the pool's size times the number of saves — often enough to dwarf the fetching. What it buys
 * is how much an interrupted run has to redo, and five hundred teams is about a minute of that
 * against fourteen writes of the pool rather than two hundred and eighty. The cursor is only
 * advanced *after* the write, so a crash re-fetches the batch rather than claiming teams it never
 * kept.
 */
const SAVE_EVERY = 500;

/**
 * Requests in flight at once, each one asking for ten teams. A browser holds only a handful of
 * connections open to one host, so this is the real parallelism of the pull; the batching is what
 * lets it be worth anything. A throttled answer holds every worker back rather than this one, so
 * the cost of being wrong here is a slower pull rather than lost teams.
 */
const CONCURRENCY = 8;

const SAMPLE = `https://web.gc.com/teams/FtEExZwB4b8E/2026-fall-trosky-illinois-9u/schedule
gsUthn4XoIxS

…or paste the whole export, headers and all:
Team Name,Team ID,Age Group,Season,City,State
"9u Astros 9U",hH8l9MBjxg7U,9U,Fall 2026,Baileyton,AL`;

const nowIso = () => new Date().toISOString();

/** Hands the whole list over as a file, since a few hundred rows is spreadsheet work. */
const downloadProblems = (problems: GcImportProblem[]) => {
  const blob = new Blob([gcImportProblemsCsv(problems)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "gamechanger-not-imported.csv";
  anchor.click();
  URL.revokeObjectURL(url);
};

/** How many rows of the list are drawn; the rest are in the file the button writes. */
const PROBLEMS_SHOWN = 200;

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
    /** Every team this run left out, fetch failures and unfilable schedules alike. */
    problems: GcImportProblem[];
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

  /**
   * The list as pasted, less the levels this app does not rank.
   *
   * A nationwide export carries thousands of 6U and 7U squads, and fetching them would spend two
   * requests each on schedules that could never be filed — `importGcSchedule` skips anything below
   * `MIN_AGE_LEVEL` when it arrives. A row that simply does not say its age is kept, because a
   * pasted id never says one either and GameChanger's own answer settles it.
   */
  const parsed = useMemo(() => {
    const read = parseGcTeamList(text);
    const entries = read.entries.filter(
      (entry) => entry.ageLevel === undefined || entry.ageLevel >= MIN_AGE_LEVEL
    );
    return { ...read, entries, tooYoung: read.entries.length - entries.length };
  }, [text]);

  /**
   * The list less the teams already here.
   *
   * A team list grows rather than changes — a few dozen clubs added to an export of several
   * thousand — so an import is for the ones nobody has pulled yet. Re-fetching the rest would cost
   * the same minutes the first run did to learn nothing: keeping a schedule current is the weekly
   * rota's job, and it is a separate thing from adding a club to the pool.
   */
  const split = useMemo(() => {
    const pulled = pulledGcTeamIds(pool.teams);
    const fresh = parsed.entries.filter((entry) => !pulled.has(entry.teamId));
    return { fresh, seen: parsed.entries.length - fresh.length };
  }, [parsed.entries, pool.teams]);

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
    /*
     * A copy, because the fold goes on mutating its own arrays after this returns and what the
     * caller stores has to stop changing underneath it. Three shallow copies per save, not per
     * team, which is why the save interval is what it is.
     */
    const snapshot: GcImportState = {
      ageGroups: poolRef.current.ageGroups.slice(),
      teams: poolRef.current.teams.slice(),
      games: poolRef.current.games.slice(),
    };
    const ok = onPersist(snapshot);
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
    /*
     * One fold held open for the whole run. Folding each schedule on its own rebuilt an index of
     * the pool per team, over a pool growing underneath it — quadratic, and on a few thousand
     * teams by far the longest part of a pull.
     */
    const importer = createGcImporter(poolRef.current);
    progressRef.current = progress;
    outcomesRef.current = [];
    setStage("pulling");
    setResult(null);
    syncStats();

    // Settled but not yet written. The cursor follows the save, never leads it.
    let unsaved: string[] = [];
    // Flushes run one at a time and in order; a batch is never overtaken by the next.
    let flushing: Promise<void> = Promise.resolve();

    /**
     * Writes what has been folded in, then advances the cursor — in that order, and only if the
     * write actually reached the store.
     *
     * Waiting matters because a save can only be *accepted* synchronously: the pool is written to
     * IndexedDB behind the caller, so a cursor that trusted the acknowledgement would mark teams
     * settled that a closed tab then loses, and the resume would skip them for good.
     */
    const flush = (): Promise<void> => {
      if (unsaved.length === 0) return flushing;
      const batch = unsaved;
      const failures = new Map(pendingFailures);
      unsaved = [];
      pendingFailures.clear();

      flushing = flushing.then(async () => {
        if (!persist()) return;
        if (!(await flushPoolWrites())) {
          showToast("Could not save the pull — stopping so nothing is lost.", { tone: "error" });
          abortRef.current?.abort();
          return;
        }
        const at = nowIso();
        batch.forEach((teamId) => {
          progressRef.current = settleTeam(
            progressRef.current ?? progress,
            teamId,
            at,
            failures.get(teamId)
          );
        });
        if (progressRef.current) onSaveProgress(progressRef.current);
      });
      return flushing;
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
          outcomesRef.current.push(importer.add(result.schedule));
          poolRef.current = importer.state;
        } else {
          pendingFailures.set(teamId, { reason: result.reason, message: result.message });
        }
        unsaved.push(teamId);
        if (unsaved.length >= SAVE_EVERY) void flush();
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

    await flush();
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

    /*
     * Now that every schedule in this run is in: name the stand-ins from the other side's schedule,
     * fold the clubs holding several GameChanger ids, and collapse the rows those folds made into
     * one game. A whole run is the first point at which both halves of each are certainly present.
     */
    const tidy = tidyPool(poolRef.current);
    if (tidy.named + tidy.folded + tidy.collapsed > 0) {
      poolRef.current = tidy.state;
      if (persist()) await flushPoolWrites();
    }

    const finished = progressRef.current;
    setResult({
      summary: [...summarizeGcImport(outcomesRef.current), ...describeTidy(tidy)],
      problems: collectGcImportProblems(
        finished?.failures ?? [],
        outcomesRef.current,
        new Map(parsed.entries.flatMap((entry) => (entry.name ? [[entry.teamId, entry.name]] : [])))
      ),
      canRetry: finished ? retryableIds(finished).length > 0 : false,
    });
    setPairings(proposeSeasonPairings(poolRef.current.teams, poolRef.current.games));
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

  /**
   * The end-of-run tidy on its own. Doubles are a state of the data, not of the list: the checks
   * that stop new ones being made do nothing for the ones already saved, and a list with nothing
   * new in it never reaches the end of a run.
   */
  const tidyNow = async () => {
    // From the pool as saved, not the ref: nothing has been pulled since it was handed in.
    const tidy = tidyPool(pool);
    const lines = describeTidy(tidy);
    if (lines.length === 0) {
      showToast("Nothing doubled up, nothing to fold.");
      return;
    }
    poolRef.current = tidy.state;
    if (persist()) {
      await flushPoolWrites();
      showToast(lines.join(" "), { tone: "success" });
    }
  };

  const startNew = () => {
    const ids = split.fresh.map((entry) => entry.teamId);
    if (ids.length === 0) {
      showToast(
        split.seen > 0 ? "Every team in that list is already here." : "No GameChanger ids in that.",
        { tone: "error" }
      );
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
      const result = mergeScoutTeams(
        pairing.fromTeamId,
        pairing.toTeamId,
        next.teams,
        next.games,
        next.ageGroups
      );
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

          <div className="mt-2 flex flex-wrap items-center gap-3">
            <label className="inline-block">
              <span className={`${button.ghost} inline-block cursor-pointer`}>
                Choose a CSV file
              </span>
              <input
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                className="hidden"
                aria-label="Team list CSV"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  // Cleared straight away so picking the same file twice still fires a change.
                  event.currentTarget.value = "";
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onerror = () => showToast("Could not read that file.", { tone: "error" });
                  reader.onload = () => setText(String(reader.result ?? ""));
                  reader.readAsText(file);
                }}
              />
            </label>
            <span className="text-xs text-slate-500">
              The export from GameChanger, headers and all — or paste it above. A file of a few
              thousand teams is fine; the rota is there so they need not all be pulled at once.
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            {text.trim() === "" ? (
              <span>Nothing chosen or pasted yet.</span>
            ) : (
              <>
                <span className={pill(parsed.entries.length ? "emerald" : "red")}>
                  {parsed.entries.length} team{parsed.entries.length === 1 ? "" : "s"}
                </span>
                {split.seen > 0 && (
                  <span className={pill("neutral")}>{split.seen} already here, skipped</span>
                )}
                {parsed.skipped.length > 0 && (
                  <span className={pill("amber")}>{parsed.skipped.length} line(s) ignored</span>
                )}
                {parsed.tooYoung > 0 && (
                  <span className={pill("neutral")}>
                    {parsed.tooYoung} under {MIN_AGE_LEVEL}U, skipped
                  </span>
                )}
                {split.fresh.length > 200 && (
                  <span>
                    About {Math.ceil((split.fresh.length * 2) / CONCURRENCY / 60)} minute(s) of
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
              disabled={split.fresh.length === 0}
              className={button.primary}
            >
              Pull {split.fresh.length || ""} schedule{split.fresh.length === 1 ? "" : "s"}
            </button>
            {pool.games.length > 0 && (
              <button type="button" onClick={() => void tidyNow()} className={button.ghost}>
                Check for doubles
              </button>
            )}
            {split.fresh.length === 0 && split.seen > 0 && (
              <span className="self-center text-xs text-slate-500">
                Every team in that list is already here.
              </span>
            )}
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

          {result.problems.length > 0 && (
            <div className="mt-4 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Did not import ({result.problems.length})
                </p>
                <button
                  type="button"
                  onClick={() => downloadProblems(result.problems)}
                  className="text-xs font-bold text-blue-600 hover:underline dark:text-blue-400"
                >
                  Download the list
                </button>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {describeGcProblems(result.problems)}. A team not reached is often worth another
                try; one that could not be filed needs its age group or season fixed on GameChanger,
                or is a level this app does not rank.
              </p>
              <ul className="mt-2 max-h-72 space-y-1.5 overflow-y-auto text-xs">
                {result.problems.slice(0, PROBLEMS_SHOWN).map((problem) => (
                  <li key={`${problem.kind}-${problem.teamId}`}>
                    <span className="flex flex-wrap items-baseline gap-2">
                      <a
                        href={problem.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono font-bold text-blue-600 hover:underline dark:text-blue-400"
                      >
                        {problem.teamId}
                      </a>
                      {problem.teamName && (
                        <span className="font-bold text-slate-950 dark:text-white">
                          {problem.teamName}
                        </span>
                      )}
                      <span className={pill(problem.kind === "not-reached" ? "red" : "amber")}>
                        {problem.reason}
                      </span>
                    </span>
                    <span className="block text-slate-500">{problem.detail}</span>
                  </li>
                ))}
              </ul>
              {result.problems.length > PROBLEMS_SHOWN && (
                <p className="mt-1 text-xs text-slate-500">
                  Showing the first {PROBLEMS_SHOWN}. The download has all {result.problems.length}.
                </p>
              )}
              {result.canRetry && (
                <button type="button" onClick={retry} className={`${button.ghost} mt-3`}>
                  Try the unreached ones again
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
                          {[
                            ...(pairing.sameName ? ["same name"] : []),
                            ...pairing.evidence.map((item) => GC_PAIRING_EVIDENCE_LABEL[item]),
                          ].join(" · ")}
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
