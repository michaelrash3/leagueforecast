import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { parseGcTeamList, type GcTeamListEntry, type GcTeamProfile } from "../lib/gameChangerApi";
import { BATCH_SIZE, fetchGcTeams } from "../lib/gameChangerClient";
import {
  beginPull,
  endPull,
  forceReleasePool,
  isPoolBusy,
  isPullLive,
  lastPullLog,
  livePull,
  livePullTracker,
  stopLivePull,
  watchPull,
} from "../lib/pullSession";
import {
  comparePairing,
  createGcImporter,
  describeTidy,
  GC_PAIRING_EVIDENCE_LABEL,
  poolSignature,
  proposeSeasonPairings,
  summarizeGcImport,
  type GcImportOutcome,
  type GcImportState,
  type GcPairingComparison,
  type GcPairingSide,
  type GcSeasonPairing,
  type PoolTidy,
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
  checkPulledTeam,
  collectGcImportProblems,
  describeGcProblems,
  gcImportProblemsCsv,
  type GcImportProblem,
} from "../lib/gameChangerReport";
import { rosterWatchList, MIN_REAL_ROSTER } from "../lib/gcRoster";
import { describeAgeUnknown, updateAgeUnknown, type AgeUnknownList } from "../lib/ageUnknown";
import { usePoolTidy } from "../hooks/usePoolTidy";
import { listCoverage, unpulledClubs } from "../lib/unpulledClubs";
import {
  flushPoolWrites,
  loadAgeUnknown,
  loadPullLog,
  saveAgeUnknown,
  savePullLog,
  saveTidyStamp,
} from "../lib/teamRankingsStorage";
import {
  liveSummary,
  pullSummaryCsv,
  pullTeamsCsv,
  type PullEndReason,
  type PullLiveSummary,
  type PullRunLog,
} from "../lib/pullTracker";
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

/**
 * Seconds one batch request takes, end to end.
 *
 * A round assumption rather than a measurement, and labelled as one. A batch is ten teams, whose
 * twenty upstream fetches all start in the same tick, so the request costs about what the slowest
 * of them does — a live check of a single team through the proxy came back in roughly 300ms, and a
 * second is a fair allowance for ten of them plus the round trip.
 */
const SECONDS_PER_BATCH = 1;

/**
 * Roughly how long a run of `fresh` teams will spend making requests.
 *
 * Teams are asked for ten at a time, so the work is `fresh / BATCH_SIZE` requests shared between
 * the workers — not one request per team, and not two. Leaving out the batch size read every team
 * as its own pair of requests and overstated a 52,470-team run by a factor of ten: 219 minutes
 * against a floor nearer 11.
 */
const estimatedMinutes = (fresh: number): number => {
  const requests = Math.ceil(fresh / BATCH_SIZE);
  const seconds = (requests / CONCURRENCY) * SECONDS_PER_BATCH;
  return Math.max(1, Math.ceil(seconds / 60));
};

/** How many pasted ids still count as a hand-typed list rather than an export. */
const HANDFUL = 25;

const SAMPLE = `https://web.gc.com/teams/FtEExZwB4b8E/2026-fall-trosky-illinois-9u/schedule
gsUthn4XoIxS

…or paste the whole export, headers and all:
Team Name,Team ID,Age Group,Season,City,State
"9u Astros 9U",hH8l9MBjxg7U,9U,Fall 2026,Baileyton,AL`;

const nowIso = () => new Date().toISOString();

/**
 * The clock, behind a function.
 *
 * Every timing the tracker keeps is a difference between two of these. Read through a helper
 * rather than called in place because the compiler cannot tell a call made while a run is going
 * from one made during a render, and reads the second as a component that will not settle.
 */
const msNow = () => Date.now();

/**
 * Saves text as a CSV.
 *
 * The byte order mark is not decoration. These files are opened in Excel and mailed on, and
 * without it Excel reads them in the system codepage and mangles every accented and apostrophed
 * team name — which is most of what makes the rows readable, and all of the evidence about what a
 * club calls itself. A twelve-megabyte file nobody can read does not get downloaded twice.
 */
const downloadCsv = (name: string, body: string) => {
  const blob = new Blob(["\ufeff", body], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
};

/** Hands the whole list over as a file, since a few hundred rows is spreadsheet work. */
const downloadProblems = (problems: GcImportProblem[]) => {
  downloadCsv("gamechanger-not-imported.csv", gcImportProblemsCsv(problems));
};

/** Today, as "2026-09-17", so two runs' files do not overwrite each other. */
const fileDay = (): string => new Date().toISOString().slice(0, 10);

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
  const [typed, setTyped] = useState("");
  /**
   * A chosen file's contents, kept out of the textarea on purpose.
   *
   * A nationwide export is forty megabytes and a hundred and fifty thousand lines. Put that in the
   * textarea's `value` and the browser is asked to lay out forty megabytes of monospaced text in a
   * box eight rows tall, which is not a wait, it is a hang — and every later keystroke re-parses
   * the lot. So the file goes in its own state and the box shows what was chosen rather than what
   * is in it. Typing and pasting still work exactly as before, which is what they are for: a
   * handful of ids somebody wants pulled now.
   */
  const [loaded, setLoaded] = useState<{ name: string; size: number; text: string } | null>(null);
  const text = loaded ? loaded.text : typed;
  const [stage, setStage] = useState<Stage>("picking");
  /*
   * Whether a pull is running anywhere, which is not the same as whether this panel is running
   * one: closing the panel hides the run and keeps it going, so a panel opened afterwards is
   * looking at a pool that is still moving underneath it.
   */
  const pullLive = useSyncExternalStore(watchPull, isPullLive, () => false);
  /**
   * Whether anything at all holds the pool, which is the question this panel actually cares about:
   * a tidy refuses a pull exactly as another pull does, and a banner that only knew about pulls
   * left somebody staring at a refusal with nothing on screen to explain it.
   */
  const poolBusy = useSyncExternalStore(watchPull, isPoolBusy, () => false);
  /*
   * The tidy runs in a worker. It is five passes over every game — half a minute on a nationwide
   * pool — and on the main thread that is half a minute of frozen tab at the very end of an hour
   * of fetching, which is exactly when somebody reloads the page and throws it away.
   */
  const { tidy: tidyInWorker, busy: tidying } = usePoolTidy();
  const [pairings, setPairings] = useState<GcSeasonPairing[]>([]);
  const [approved, setApproved] = useState<Set<string>>(new Set());
  /** The pairing opened side by side, if any, worked out when it was opened. */
  const [openPair, setOpenPair] = useState<{
    key: string;
    comparison: GcPairingComparison | null;
  } | null>(null);
  /** Counts for the bar. Numbers rather than the cursor itself, so a redraw copies almost nothing. */
  const [stats, setStats] = useState<GcPullView | null>(null);
  /**
   * The handful of numbers worth watching while it runs.
   *
   * Refreshed on each save rather than on each team: the bar already redraws fifty thousand times
   * and a second piece of state alongside it would double the only expensive thing in the loop.
   * Once every five hundred teams is about once a minute, which is the rate a person reads at.
   */
  const [live, setLive] = useState<PullLiveSummary | null>(null);
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
    // Wiffle ball is a different game, so those rows never cost a request. Counted separately from
    // the too-young ones because they are a different kind of "not for us" and the panel says so.
    const baseball = read.entries.filter((entry) => !entry.notBaseball);
    const entries = baseball.filter(
      (entry) => entry.ageLevel === undefined || entry.ageLevel >= MIN_AGE_LEVEL
    );
    return {
      ...read,
      entries,
      tooYoung: baseball.length - entries.length,
      notBaseball: read.entries.length - baseball.length,
      // Counted here rather than again at run time: on a nationwide export this is a forty
      // megabyte split, and once is enough.
      lines: text ? text.split(/\r?\n/).length : 0,
    };
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
    const seen = parsed.entries.length - fresh.length;
    /*
     * A handful pasted by hand is a different thing from an export. Somebody who types one team's
     * id in wants that team pulled now, whether or not it is already here — that is how a schedule
     * that changed today gets read before the rota comes round — so a short list with nothing new
     * in it is offered as a refresh rather than refused.
     */
    const refresh =
      fresh.length === 0 && parsed.entries.length > 0 && parsed.entries.length <= HANDFUL
        ? parsed.entries
        : [];
    return { fresh, seen, refresh };
  }, [parsed.entries, pool.teams]);

  /**
   * The teams GameChanger answered for and nobody could age.
   *
   * Held in state rather than read on every render: the run rewrites it at the end, and the rota
   * below has to see the new one without the panel being closed and reopened.
   */
  const [ageless, setAgeless] = useState<AgeUnknownList>(() => loadAgeUnknown());
  const due = useMemo(
    () => dueRefresh(new Date(), refreshLog, pool.ageGroups, pool.teams, undefined, ageless),
    [refreshLog, pool.ageGroups, pool.teams, ageless]
  );
  const [showWeek, setShowWeek] = useState(false);
  const resumable = savedProgress ? remainingIds(savedProgress) : [];

  /**
   * The GameChanger pages that may not be teams, and which are worth asking about again.
   *
   * It takes nine to field a side, and roughly one page in thirty-six has fewer — a page somebody
   * made and did not finish, or a squad still being assembled. None are thrown away, because a
   * squad of six in September is twelve in October and the roster count is the only thing that
   * ever says which. They are simply asked about again, a fortnight later.
   */
  const rosterWatch = useMemo(
    () =>
      rosterWatchList(
        pool.teams.flatMap((team) =>
          (team.gcTeams ?? []).map((link) => ({
            teamId: link.teamId,
            ...(link.playerCount === undefined ? {} : { playerCount: link.playerCount }),
            ...(link.countedAt ? { countedAt: link.countedAt } : {}),
          }))
        )
      ),
    [pool.teams]
  );
  const rosterDue = rosterWatch.filter((entry) => entry.due);

  /**
   * What the pasted list is worth against the backlog.
   *
   * The clubs the pool knows only by name cannot be worked through automatically — GameChanger has
   * no id for any of them, which is why they are a backlog at all. What can be automatic is saying
   * what a list clears before it is pulled, so the work directs itself.
   */
  const coverage = useMemo(() => {
    if (parsed.entries.length === 0) return null;
    const found = listCoverage(parsed.entries, unpulledClubs(pool));
    return found.standIns === 0 ? null : found;
  }, [parsed.entries, pool]);

  /** Copies the counts out of the live cursor so React has something it can see change. */
  const syncStats = () => {
    if (progressRef.current) setStats(pullView(progressRef.current));
  };

  const persist = (note?: string): boolean => {
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
    if (!ok) {
      showToast(`Could not save the pull (storage full).${note ? ` ${note}` : ""}`, {
        tone: "error",
      });
    }
    return ok;
  };

  /**
   * Runs the pull. Each schedule is folded in as it arrives rather than collected and applied at
   * the end, so stopping — or closing the tab — keeps everything already fetched.
   */
  const run = async (ids: string[], progress: GcPullProgress) => {
    /*
     * Claimed before anything is fetched. A pull survives its panel — closing it hides the run
     * rather than stopping it — so a reopened panel could otherwise start a second, and the two
     * would write whole-pool snapshots over each other while the cursor marked the losers settled.
     */
    const session = beginPull(nowIso());
    if (!session) {
      // What is actually holding it, rather than a guess. A tidy refuses a pull exactly as another
      // pull does, and saying "a pull is already running" when one is not sends somebody looking
      // for a run that does not exist.
      const holder = livePull();
      showToast(
        holder?.kind === "tidy"
          ? "The pool is being tidied. That takes a moment — try again when it finishes."
          : "A pull is already running. Reopen Import to watch it, or stop it there.",
        { tone: "error" }
      );
      return;
    }
    const controller = session.controller;
    abortRef.current = controller;
    /*
     * Released whatever happens from here on. The slot this run holds is what stops a second one
     * starting, so anything that throws between the claim and the release leaves it held for the
     * rest of the page's life — and every later run refused, with nothing running to explain it.
     * `endPull` ignores a session that is no longer the live one, so calling it twice is free.
     */
    let released = false;
    /** Declared out here so the `finally` can take it off again however the run ends. */
    let onVisibility: (() => void) | null = null;
    const giveUpSlot = () => {
      if (released) return;
      released = true;
      endPull(session);
    };
    try {
      /*
       * The record of this run, which outlives the panel with the session that holds it.
       *
       * Wrapped rather than called directly, everywhere it is used. A tracker that throws inside
       * `onProgress` would take the whole run down with it — no final flush, no released slot — and
       * destroying an hour of fetching to record it is exactly backwards. A field it could not write
       * is a blank cell; nothing more.
       */
      const tracker = session.tracker;
      const track = (write: () => void): void => {
        try {
          write();
        } catch {
          /* never at the run's expense */
        }
      };
      const runFrom = msNow();
      track(() => {
        tracker?.beginSegment(session.startedAt, ids);
        tracker?.config({
          concurrency: CONCURRENCY,
          batchSize: BATCH_SIZE,
          saveEvery: SAVE_EVERY,
        });
        tracker?.eta(estimatedMinutes(ids.length));
        tracker?.paste({
          lines: parsed.lines,
          parsed: parsed.entries.length,
          skipped: parsed.skipped.length,
          skippedSamples: parsed.skipped,
          tooYoung: parsed.tooYoung + parsed.notBaseball,
          alreadyHere: split.seen,
          asked: ids.length,
        });
      });

      /*
       * An hour against an eleven-minute estimate has two explanations that look identical from the
       * inside — GameChanger was slow, or the tab was in the background and the browser throttled
       * it. Nothing else recorded can tell them apart, and this is six lines.
       */
      let hiddenFrom = document.visibilityState === "hidden" ? msNow() : 0;
      onVisibility = () => {
        if (document.visibilityState === "hidden") {
          hiddenFrom = msNow();
          return;
        }
        if (hiddenFrom === 0) return;
        const spell = msNow() - hiddenFrom;
        hiddenFrom = 0;
        track(() => tracker?.hidden(spell));
      };
      document.addEventListener("visibilitychange", onVisibility);

      /*
       * One fold held open for the whole run. Folding each schedule on its own rebuilt an index of
       * the pool per team, over a pool growing underneath it — quadratic, and on a few thousand
       * teams by far the longest part of a pull.
       */
      const importer = createGcImporter(poolRef.current);
      progressRef.current = progress;
      outcomesRef.current = [];
      /**
       * What the list claimed about each id, beside what GameChanger returned for it, so the report
       * can say which ids do not look like the team that was asked for. Only ids the list described
       * are kept; a bare pasted id claims nothing to check.
       */
      const claimed = new Map(parsed.entries.map((entry) => [entry.teamId, entry]));
      /**
       * Only the ids where the two disagree.
       *
       * The check is the same one the report runs, moved to the moment the answer arrives instead
       * of the end of the run. It used to keep every team pulled — a hundred and sixteen thousand
       * profiles held for hours to report on the few hundred that turn out to be worth reporting —
       * and the whole point of the map is the disagreements, so the agreements are dropped as soon
       * as they are known to be agreements.
       */
      const pulledRef = new Map<string, { entry: GcTeamListEntry; profile: GcTeamProfile }>();
      setStage("pulling");
      setResult(null);
      setLive(null);
      syncStats();

      // Settled but not yet written. The cursor follows the save, never leads it.
      let unsaved: string[] = [];
      /** Saves so far, so a row can say which one kept it — and where the saving stopped. */
      let flushSeq = 0;
      /** How the run came to an end, settled by whatever ends it and read once at the bottom. */
      let endReason: PullEndReason = "finished";
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

        flushSeq += 1;
        const flushNumber = flushSeq;

        flushing = flushing.then(async () => {
          const from = msNow();
          /*
           * A refused save stops the run, rather than being noted and fetched past.
           *
           * On localStorage this is the only signal there is: writeValue returns whether the value
           * actually landed, while flushPoolWrites can only say whether the pool is usable at all,
           * so a quota refusal reaches here and nowhere else. Carrying on meant hours of fetching
           * that saved nothing, with the cursor never advancing and the progress bar walking
           * backwards 500 at a time on every flush.
           */
          const sample = (ok: boolean) =>
            track(() => {
              tracker?.flushed(
                {
                  flush: flushNumber,
                  second: Math.round((msNow() - runFrom) / 1000),
                  teams: batch.length,
                  settled: progressRef.current?.settled.length ?? 0,
                  poolTeams: poolRef.current.teams.length,
                  poolGames: poolRef.current.games.length,
                  poolPages: poolRef.current.ageGroups.length,
                  ms: msNow() - from,
                  ok,
                },
                batch
              );
              // Written beside the pool rather than inside it, so a record that will not fit can
              // never be the thing that stops the run it is recording.
              const current = tracker?.log();
              if (current) {
                if (!savePullLog(current)) tracker?.unpersisted();
                setLive(
                  liveSummary(current, progressRef.current?.settled.length ?? 0, msNow() - runFrom)
                );
              }
            });

          if (!persist("Stopping, so nothing is fetched that cannot be kept.")) {
            sample(false);
            endReason = "save-refused";
            abortRef.current?.abort();
            return;
          }
          if (!(await flushPoolWrites())) {
            showToast("Could not save the pull — stopping so nothing is lost.", { tone: "error" });
            sample(false);
            endReason = "save-refused";
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
          sample(true);
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
        onHold: (ms, source) => track(() => tracker?.hold(ms, source)),
        onBlocked: () => track(() => tracker?.blocked()),
        onSuppressed: (teamId) => track(() => tracker?.suppressed(teamId)),
        onRefused: (refusals) =>
          track(() => {
            endReason = "gave-up";
            tracker?.gaveUp(refusals, Math.round((msNow() - runFrom) / 1000));
          }),
        onProgress: ({ teamId, result, attempts, firstFailure }) => {
          track(() =>
            tracker?.answered({
              teamId,
              result,
              attempts,
              ...(firstFailure ? { firstFailure } : {}),
              ...(claimed.get(teamId)?.ageLevel === undefined
                ? {}
                : { listAge: claimed.get(teamId)?.ageLevel }),
            })
          );
          if (result.ok) {
            const entry = claimed.get(teamId);
            /*
             * The staff and the roster size come from the user's own list, not from GameChanger —
             * its public API returns neither. Attached here, where both halves are in hand, so the
             * link the import records carries them.
             */
            const listed =
              entry && (entry.staff?.length || entry.playerCount !== undefined)
                ? {
                    ...(entry.staff?.length ? { staff: entry.staff } : {}),
                    ...(entry.playerCount === undefined ? {} : { playerCount: entry.playerCount }),
                  }
                : undefined;
            const schedule = listed ? { ...result.schedule, listed } : result.schedule;
            const outcome = importer.add(schedule);
            outcomesRef.current.push(outcome);
            track(() => tracker?.imported(outcome));
            poolRef.current = importer.state;
            if (entry && checkPulledTeam(entry, result.schedule.profile)) {
              pulledRef.set(teamId, { entry, profile: result.schedule.profile });
            }
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
      if (onVisibility) document.removeEventListener("visibilitychange", onVisibility);
      track(() => {
        // A spell that is still running when the pull ends is still time the tab was hidden.
        if (hiddenFrom !== 0) tracker?.hidden(msNow() - hiddenFrom);
        tracker?.fetchEnded(nowIso());
        /*
         * Stopped is worked out here rather than recorded when the button was pressed, because the
         * same abort is how a refused save ends a run — and those are very different facts about an
         * hour that produced nothing.
         */
        if (endReason === "finished" && controller.signal.aborted) endReason = "stopped";
        tracker?.endSegment(nowIso(), endReason);
      });
      // Given up here rather than at the end: what follows is the tidy and the summary, neither of
      // which is a reason to refuse a run somebody starts in the meantime.
      giveUpSlot();
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
      const outcome = await tidyInWorker(poolRef.current);
      /*
       * Refused only if something else claimed the pool in the moment between this run giving it up
       * and the tidy asking for it. Nothing is lost by skipping it: the stamp is left alone, so the
       * pool still reads as untidied and the next time the app opens on it, it is tidied then.
       */
      const tidy: PoolTidy | null = outcome ? { ...outcome.tidy, state: outcome.state } : null;
      if (tidy) {
        // Stamped before the save lands, so the page does not read the tidied pool as untidied.
        saveTidyStamp(poolSignature(tidy.state));
        if (
          tidy.named +
            tidy.folded +
            tidy.paired +
            tidy.collapsed +
            tidy.pruned +
            tidy.reclaimed +
            tidy.refiled +
            tidy.releveled >
          0
        ) {
          poolRef.current = tidy.state;
          if (persist()) await flushPoolWrites();
        }
      }

      /*
       * Teams nobody could age go on the list; teams that were filed come off it. Done for every
       * run, not just the catch-up one, because any run can answer the question: a team pulled for
       * the first time today may have no age, and a 9U opponent pulled next week may be the third
       * one whose name settles it.
       */
      const nextAgeless = updateAgeUnknown(loadAgeUnknown(), outcomesRef.current, nowIso());
      setAgeless(nextAgeless);
      saveAgeUnknown(nextAgeless);

      track(() => {
        // `outcome.tidy` and not `tidy`: the latter carries the whole tidied pool, and writing that
        // into the record would put a second copy of every game in storage.
        if (outcome) tracker?.tidied(outcome.tidy);
        tracker?.finish(nowIso(), endReason);
        if (tracker && !savePullLog(tracker.log())) tracker.unpersisted();
      });

      const finished = progressRef.current;
      setResult({
        summary: [...summarizeGcImport(outcomesRef.current), ...(tidy ? describeTidy(tidy) : [])],
        problems: collectGcImportProblems(
          finished?.failures ?? [],
          outcomesRef.current,
          new Map(
            parsed.entries.flatMap((entry) => (entry.name ? [[entry.teamId, entry.name]] : []))
          ),
          pulledRef
        ),
        canRetry: finished ? retryableIds(finished).length > 0 : false,
      });
      setPairings(proposeSeasonPairings(poolRef.current.teams, poolRef.current.games));
      setApproved(new Set());
      setOpenPair(null);
      setStage("review");
      syncStats();
    } finally {
      giveUpSlot();
      if (onVisibility) document.removeEventListener("visibilitychange", onVisibility);
    }
  };

  /**
   * Pulls the under-strength pages again, and nothing else.
   *
   * Its own button rather than part of the rota: these are a few hundred pages at most and the
   * question about them is different from keeping a schedule current. A page whose roster has
   * grown past nine comes back from this as an ordinary team, and one that has not is asked about
   * again in another fortnight.
   */
  const recheckRosters = () => {
    if (rosterDue.length === 0) return;
    const progress = startPull(
      rosterDue.map((entry) => entry.teamId),
      nowIso(),
      null
    );
    onSaveProgress(progress);
    // Not a rota run, so nothing is marked refreshed when it finishes.
    dueLevelsRef.current = [];
    void run(remainingIds(progress), progress);
  };

  /**
   * The catch-up day's other job: ask again about the teams nobody could age.
   *
   * The same route they came in on, because that is the only thing that can answer the question —
   * GameChanger may have filled its field in, the club may have renamed the squad, or enough of
   * the team's opponents may have been pulled since that their names now settle it. Not a rota
   * run, so nothing is marked refreshed when it finishes.
   */
  const runAgeless = () => {
    if (due.agelessIds.length === 0) return;
    const progress = startPull(due.agelessIds, nowIso(), null);
    onSaveProgress(progress);
    dueLevelsRef.current = [];
    void run(remainingIds(progress), progress);
  };

  const runDue = () => {
    if (due.teamIds.length === 0) return;
    const progress = startPull(due.teamIds, nowIso(), null);
    onSaveProgress(progress);
    dueLevelsRef.current = due.ageLevels;
    void run(remainingIds(progress), progress);
  };

  /**
   * The end-of-run tidy on its own. It also runs by itself whenever the app opens on a pool it has
   * not tidied, so this is for the person who wants to see it happen now.
   */
  const tidyNow = async () => {
    // From the pool as saved, not the ref: nothing has been pulled since it was handed in.
    const outcome = await tidyInWorker(pool);
    if (!outcome) {
      showToast("Something is already working on the pool — try again when it has finished.", {
        tone: "error",
      });
      return;
    }
    const tidy: PoolTidy = { ...outcome.tidy, state: outcome.state };
    saveTidyStamp(poolSignature(tidy.state));
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
    const ids = (split.fresh.length > 0 ? split.fresh : split.refresh).map((entry) => entry.teamId);
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

  /**
   * The run's own record, live or the last one finished, falling back to what storage kept.
   *
   * Three sources because the record has to be downloadable in all three situations: while the run
   * is going, after it has ended in this panel, and after a reload that lost every component but
   * not the file.
   */
  const runLog = (): PullRunLog | null =>
    livePullTracker()?.log() ?? lastPullLog() ?? loadPullLog();
  /*
   * Read again when the button is pressed rather than used from the render that drew it. A run
   * still going is writing to this the whole time, and a file built from the copy that happened to
   * be in hand when the button was drawn would be missing everything since.
   */
  const tracked = runLog();
  const trackedIds = tracked?.ids.length ?? 0;

  const downloadRunSummary = () => {
    const log = runLog();
    if (!log) return;
    downloadCsv(
      `gamechanger-run-${fileDay()}-summary.csv`,
      pullSummaryCsv(log, progressRef.current?.settled ?? [])
    );
  };

  const downloadRunTeams = () => {
    const log = runLog();
    if (!log) return;
    downloadCsv(
      `gamechanger-run-${fileDay()}-teams.csv`,
      pullTeamsCsv(log, progressRef.current?.settled ?? [])
    );
  };

  /**
   * Takes the pool back from whatever holds it.
   *
   * Only offered for a tidy: a pull is stopped through its own session so it can shut down
   * cleanly, but a tidy has no cursor to keep and re-runs by itself the next time the app opens on
   * a pool it does not recognise — so there is nothing to lose by cutting it short, and a person
   * who wants to start an hour of fetching should not have to wait on housekeeping.
   */
  const releasePool = () => {
    forceReleasePool();
    showToast("Stopped tidying. The pool will be tidied again after the pull.", { tone: "info" });
  };

  const stop = () => {
    // Through the session, so a panel that has just opened onto somebody else's run can stop it.
    stopLivePull();
    abortRef.current?.abort();
    showToast("Stopping after the requests already in flight.", { tone: "info" });
  };

  const pairKey = (pairing: GcSeasonPairing) => `${pairing.fromTeamId}>${pairing.toTeamId}`;
  /** The pairings on screen; the rest can be paired from a team's own panel. */
  const shown = pairings.slice(0, 100);

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

      {stage === "picking" && poolBusy && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40">
          <p className="text-sm font-bold text-slate-950 dark:text-white">
            {pullLive ? "A pull is already running." : "The pool is being tidied."}
          </p>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
            {pullLive ? (
              <>
                It kept going when this panel was closed. Starting another would have the two of
                them saving the pool over each other, so this one waits. The counter below is the
                last position saved, which advances every {SAVE_EVERY} teams.
              </>
            ) : (
              <>
                Folding the pool and settling its stand-ins. It writes the whole pool when it
                finishes, so a pull started now would be saved over — this one waits. On a large
                pool it takes a minute or two, and it runs again by itself if it is interrupted.
              </>
            )}
          </p>
          {pullLive ? (
            <button type="button" onClick={stop} className={`${button.ghost} mt-2`}>
              Stop the running pull
            </button>
          ) : (
            <button type="button" onClick={releasePool} className={`${button.ghost} mt-2`}>
              Stop waiting and let me pull
            </button>
          )}
        </div>
      )}
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
            {due.agelessIds.length > 0 && (
              <>
                <button type="button" onClick={runAgeless} className={`${button.primary} mt-3`}>
                  Ask again about {due.agelessIds.length.toLocaleString()} team
                  {due.agelessIds.length === 1 ? "" : "s"} with no age
                </button>
                <p className="mt-1 text-xs text-slate-500">
                  {describeAgeUnknown(ageless)} They are on no page, so the weekly rotation never
                  reaches them, and the fetch worked, so nothing retries them either. Asking again
                  is the only thing that can answer it — GameChanger may have filled the field in
                  since, the club may have renamed the squad, or enough of the team&apos;s opponents
                  may have been pulled that their names now settle it. One that comes back with an
                  age drops off this list and joins the ordinary rotation for its level.
                </p>
              </>
            )}
          </div>

          {rosterWatch.length > 0 && (
            <div className="mb-3 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
              <p className="font-bold text-slate-950 dark:text-white">
                {rosterWatch.length} page{rosterWatch.length === 1 ? "" : "s"} may not be a team yet
              </p>
              <p className="mt-1 text-xs text-slate-500">
                It takes {MIN_REAL_ROSTER} players to field a side, and{" "}
                {rosterWatch.length === 1 ? "this one has" : "these have"} fewer — a page somebody
                made and did not finish, or a squad still being assembled. Nothing is thrown away: a
                squad of six in September is twelve in October, and the roster count is the only
                thing that says which.
              </p>
              {rosterDue.length > 0 ? (
                <button
                  type="button"
                  onClick={recheckRosters}
                  className={`${button.ghost} mt-3 text-sm`}
                >
                  Check{" "}
                  {rosterDue.length === rosterWatch.length ? "them" : `${rosterDue.length} of them`}{" "}
                  again
                </button>
              ) : (
                <p className="mt-2 text-xs text-slate-500">
                  All counted recently. They come round again in a fortnight.
                </p>
              )}
            </div>
          )}

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
          {loaded ? (
            <div className="mt-1 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-900">
              <span className="font-mono font-bold">{loaded.name}</span>
              <span className="text-slate-500">
                {(loaded.size / 1_000_000).toFixed(1)} MB, {parsed.lines.toLocaleString()} lines
              </span>
              <button type="button" className={button.ghost} onClick={() => setLoaded(null)}>
                Choose a different file
              </button>
            </div>
          ) : (
            <textarea
              id="gc-import-text"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              rows={8}
              spellCheck={false}
              placeholder={SAMPLE}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-3 font-mono text-xs dark:border-slate-800 dark:bg-slate-900"
            />
          )}

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
                  reader.onload = () =>
                    setLoaded({
                      name: file.name,
                      size: file.size,
                      text: String(reader.result ?? ""),
                    });
                  reader.readAsText(file);
                }}
              />
            </label>
            <span className="text-xs text-slate-500">
              The export from GameChanger, headers and all — or paste a few ids above. A file of any
              size is fine; the rota is there so they need not all be pulled at once.
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
                  <span className={pill("neutral")}>
                    {split.seen} already here{split.refresh.length > 0 ? "" : ", skipped"}
                  </span>
                )}
                {parsed.skipped.length > 0 && (
                  <span className={pill("amber")}>{parsed.skipped.length} line(s) ignored</span>
                )}
                {parsed.tooYoung > 0 && (
                  <span className={pill("neutral")}>
                    {parsed.tooYoung} under {MIN_AGE_LEVEL}U, skipped
                  </span>
                )}
                {parsed.notBaseball > 0 && (
                  <span className={pill("neutral")}>{parsed.notBaseball} wiffle ball, skipped</span>
                )}
                {split.fresh.length > 200 && (
                  <span>About {estimatedMinutes(split.fresh.length)} minute(s) of requests.</span>
                )}
              </>
            )}
          </div>

          {coverage && (
            <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-200">
              <strong>{coverage.standIns}</strong> of these are clubs this pool only knows by name.
              Pulling them turns <strong>{coverage.resultsWaiting}</strong> result
              {coverage.resultsWaiting === 1 ? "" : "s"} it is already holding into games with two
              real sides.
            </p>
          )}

          {parsed.entries.length > 0 && <ParsedPreview entries={parsed.entries} />}

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={startNew}
              disabled={split.fresh.length === 0 && split.refresh.length === 0}
              className={button.primary}
            >
              {split.fresh.length === 0 && split.refresh.length > 0
                ? `Pull ${split.refresh.length === 1 ? "it" : split.refresh.length} again`
                : `Pull ${split.fresh.length || ""} schedule${split.fresh.length === 1 ? "" : "s"}`}
            </button>
            {pool.games.length > 0 && (
              <button
                type="button"
                onClick={() => void tidyNow()}
                // A pull writes the whole pool as it goes, so a tidy alongside one would save over
                // whatever landed while it was working — and the cursor has already counted those
                // teams settled, so nothing would fetch them again.
                disabled={tidying !== null || pullLive}
                className={button.ghost}
              >
                {tidying === "tidy" ? "Tidying…" : "Tidy now"}
              </button>
            )}
            {split.fresh.length === 0 && split.seen > 0 && (
              <span className="self-center text-xs text-slate-500">
                {split.refresh.length > 0
                  ? "Already here — pulling again reads today's schedule."
                  : "Every team in that list is already here."}
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

          {live && (
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
              <div>
                <dt className="uppercase tracking-wide text-slate-500">Teams a minute</dt>
                <dd className="font-bold text-slate-950 dark:text-white">
                  {live.perMinute?.toLocaleString() ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="uppercase tracking-wide text-slate-500">Held</dt>
                <dd className="font-bold text-slate-950 dark:text-white">{live.heldSeconds}s</dd>
              </div>
              <div>
                <dt className="uppercase tracking-wide text-slate-500">Refused</dt>
                <dd
                  className={
                    live.blocked > 0
                      ? "font-bold text-amber-700 dark:text-amber-300"
                      : "font-bold text-slate-950 dark:text-white"
                  }
                >
                  {live.blocked.toLocaleString()}
                </dd>
              </div>
              <div>
                <dt className="uppercase tracking-wide text-slate-500">Saves</dt>
                <dd className="font-bold text-slate-950 dark:text-white">
                  {live.saves}
                  {live.lastSaveMs === undefined ? "" : ` · ${live.lastSaveMs}ms`}
                </dd>
              </div>
            </dl>
          )}
          {tidying === "tidy" ? (
            <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
              Everything is in. Tidying now — naming the stand-ins the other side&apos;s schedule
              can settle, folding the clubs pulled under more than one id. It walks every game
              several times over, so on a big pool this takes a while; it runs off the main thread,
              so the page stays usable and leaving this open is not needed.
            </p>
          ) : (
            <div className="mt-3">
              <button type="button" onClick={stop} className={button.ghost}>
                Stop
              </button>
            </div>
          )}
        </div>
      )}

      {stage === "review" && result && (
        <div className="mt-4">
          <ul className="space-y-1 text-sm text-slate-700 dark:text-slate-200">
            {result.summary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>

          <div className="mt-4 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              What this run did
            </p>
            <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
              Two files. The summary is the run&apos;s own totals — how long it took, what it was
              held up by, what came back refused and what it was filed under. The teams file is one
              row for every id asked for, including the ones it never reached.
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={downloadRunSummary}
                className={`${button.ghost} text-sm`}
              >
                Summary
              </button>
              <button
                type="button"
                onClick={downloadRunTeams}
                className={`${button.ghost} text-sm`}
              >
                Every team ({trackedIds.toLocaleString()} rows)
              </button>
            </div>
            {!tracked?.persisted && (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                This record is only in the page. Storage would not take it, so downloading it now is
                the only way to keep it — a reload loses it.
              </p>
            )}
          </div>

          {result.problems.length > 0 && (
            <div className="mt-4 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Worth a look ({result.problems.length})
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
                or is a level this app does not rank. One to check did import — its id simply
                returned a different team from the one your list named, which is what a wrong id
                looks like.
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
                      <span
                        className={pill(
                          problem.kind === "not-reached"
                            ? "red"
                            : problem.kind === "check-id"
                              ? "blue"
                              : "amber"
                        )}
                      >
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
                Pairs with the same name, town and state have been combined already. These share
                less than that, so they are yours to call — tap a name to see the two side by side.
                Pairing makes one team with both seasons behind it.
              </p>
              <label className="mt-2 flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={
                    shown.length > 0 && shown.every((pairing) => approved.has(pairKey(pairing)))
                  }
                  onChange={(event) => {
                    setApproved(
                      event.target.checked
                        ? new Set(shown.map((pairing) => pairKey(pairing)))
                        : new Set()
                    );
                  }}
                />
                Tick all {shown.length}
              </label>
              <ul className="mt-2 max-h-72 space-y-2 overflow-y-auto">
                {shown.map((pairing) => {
                  const key = pairKey(pairing);
                  const open = openPair?.key === key;
                  const comparison = open ? openPair.comparison : null;
                  return (
                    <li key={key} className="text-sm">
                      <div className="flex items-start gap-2">
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
                        <div className="flex-1">
                          <button
                            type="button"
                            onClick={() =>
                              setOpenPair(
                                open
                                  ? null
                                  : {
                                      key,
                                      comparison: comparePairing(
                                        pairing,
                                        poolRef.current.teams,
                                        poolRef.current.games
                                      ),
                                    }
                              )
                            }
                            aria-expanded={open}
                            className="font-bold text-slate-950 hover:underline dark:text-white"
                          >
                            {pairing.fromTeamName}
                          </button>{" "}
                          <label htmlFor={`pair-${key}`}>
                            <span className="text-slate-500">
                              {pairing.fromSeason} → {pairing.toSeason}
                            </span>{" "}
                            <span
                              className={pill(
                                pairing.confidence === "strong" ? "emerald" : "amber"
                              )}
                            >
                              {[
                                ...(pairing.sameName ? ["same name"] : []),
                                ...pairing.evidence.map((item) => GC_PAIRING_EVIDENCE_LABEL[item]),
                              ].join(" · ")}
                            </span>
                          </label>
                        </div>
                      </div>
                      {comparison && <PairingComparison comparison={comparison} />}
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

/**
 * The two clubs of a pairing side by side: what GameChanger calls each, where each says it is
 * from, its record, and who it has played, with the opponents in common marked. An amber pill
 * says only that the two share a name and one more thing; this is what there is to decide on.
 */
function PairingComparison({ comparison }: { comparison: GcPairingComparison }) {
  const { from, to, sharedOpponents } = comparison;
  const shared = new Set(sharedOpponents);
  const record = (side: GcPairingSide) =>
    side.record ? `${side.record.win}-${side.record.loss}-${side.record.tie}` : "—";
  const rows: [string, string, string][] = [
    ["GameChanger name", from.gcName, to.gcName],
    ["Town", from.city ?? "—", to.city ?? "—"],
    ["State", from.state ?? "—", to.state ?? "—"],
    ["Record on GameChanger", record(from), record(to)],
    ["Games here", String(from.games), String(to.games)],
  ];
  const opponents = (side: GcPairingSide) =>
    side.opponents.length === 0 ? (
      <span className="text-slate-500">none yet</span>
    ) : (
      <ul className="space-y-0.5">
        {side.opponents.map((name) => (
          <li
            key={name}
            className={shared.has(name) ? "font-bold text-emerald-700 dark:text-emerald-300" : ""}
          >
            {name}
          </li>
        ))}
      </ul>
    );
  return (
    <div className="ml-6 mt-2 overflow-x-auto rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-800">
      <table className="w-full">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="pb-1 pr-3 font-semibold" />
            <th className="pb-1 pr-3 font-semibold">{from.season}</th>
            <th className="pb-1 font-semibold">{to.season}</th>
          </tr>
        </thead>
        <tbody className="align-top">
          {rows.map(([label, a, b]) => (
            <tr key={label}>
              <td className="py-0.5 pr-3 text-slate-500">{label}</td>
              <td className="py-0.5 pr-3 text-slate-950 dark:text-white">{a}</td>
              <td className="py-0.5 text-slate-950 dark:text-white">{b}</td>
            </tr>
          ))}
          <tr>
            <td className="py-0.5 pr-3 text-slate-500">
              Opponents
              {sharedOpponents.length > 0 && (
                <span className="block text-emerald-700 dark:text-emerald-300">
                  {sharedOpponents.length} in common
                </span>
              )}
            </td>
            <td className="py-0.5 pr-3">{opponents(from)}</td>
            <td className="py-0.5">{opponents(to)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
