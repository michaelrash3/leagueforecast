import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { parseGcTeamList, type GcTeamListEntry } from "../lib/gameChangerApi";
import type { NamedAges } from "../lib/namedAges";
import { type DeletedClubs } from "../lib/deletedGames";
import {
  holdingNow,
  holdingWholePool,
  sectionOf,
  type HeldPool,
  type RunPhase,
} from "../lib/pullRun";
import { isPoolBusy, isPullLive, watchPull } from "../lib/pullSession";
import {
  comparePairing,
  GC_PAIRING_EVIDENCE_LABEL,
  type GcImportOutcome,
  type GcImportState,
  type GcPairingComparison,
  type GcPairingSide,
  type GcSeasonPairing,
} from "../lib/gameChangerImport";
import {
  describePull,
  remainingIds,
  retryFailures,
  startPull,
  type GcPullProgress,
  type GcPullView,
} from "../lib/gameChangerPull";
import {
  describeCadence,
  describeDue,
  describeRotation,
  MIN_PULL_GAP_HOURS,
  type RefreshLog,
} from "../lib/gameChangerSchedule";
import {
  describeGcProblems,
  gcImportProblemsCsv,
  type GcImportProblem,
} from "../lib/gameChangerReport";
import { rosterWatchOf, MIN_REAL_ROSTER } from "../lib/gcRoster";
import { AGE_UNKNOWN_MAX_TRIES } from "../lib/ageUnknown";
import { type TooYoungClubs } from "../lib/tooYoungClubs";
import { forgetRefused, type RefusedClubs } from "../lib/refusedClubs";
import { usePoolTidy } from "../hooks/usePoolTidy";
import { TidyProgressView } from "./teamRankings/TidyProgressView";
import { listCoverage, unpulledClubs } from "../lib/unpulledClubs";
import { downloadCsv } from "../lib/download";
import {
  type PoolHolding,
  loadTooYoungClubs,
  loadRefusedClubs,
  saveRefusedClubs,
} from "../lib/teamRankingsStorage";
import { type PullLiveSummary } from "../lib/pullTracker";
import { gcLinkSquadYearIn, MIN_AGE_LEVEL, mergeScoutTeams, segmentOn } from "../lib/teamRankings";
import { todayIsoDay } from "../lib/date";
import type { MarksChange } from "../lib/removedForYou";
import { cloudStatus, subscribeCloud } from "../lib/cloud/cloudSession";
import { pullBlockedBy } from "../lib/cloud/pullGate";
import type { ToastTone } from "../hooks/useToast";
import { button, card, pill, tapArea } from "../styles/tokens";
import { useGcRunControls } from "../hooks/useGcRunControls";
import { useGcPullSchedule } from "../hooks/useGcPullSchedule";
import { useGcTeamList } from "../hooks/useGcTeamList";
import { estimatedMinutes, nowIso, SAVE_EVERY_MAX, SAVE_EVERY_MIN } from "../lib/gcPullPacing";
import { useGcPullRun } from "../hooks/useGcPullRun";

type GameChangerImportPanelProps = {
  /** The pool as it stands. The panel works on a copy and hands whole states back. */
  pool: GcImportState;
  /**
   * Saves the pool. Called as the pull runs, not only at the end: a run of a few thousand teams
   * will be interrupted, and what it fetched before that should still be there.
   *
   * `holding` says what `pool.games` actually is. A sectioned run holds one age page at a time, so
   * saving its games as the whole pool would delete every other page. Absent means the caller is
   * holding the whole pool, which is what every other save is.
   */
  onPersist: (pool: GcImportState, holding?: PoolHolding) => boolean;
  /** A run already under way when the panel opened, so it can offer to carry on. */
  savedProgress: GcPullProgress | null;
  onSaveProgress: (progress: GcPullProgress) => void;
  onClearProgress: () => void;
  onClose: () => void;
  showToast: (message: string, options?: { tone?: ToastTone }) => void;
  /**
   * The ages somebody typed on the review card.
   *
   * A prop rather than a `loadNamedAges()` inside the memos that need it: a storage read in a
   * memo body is a dependency React cannot see, so the memo would keep a stale answer after the
   * card recorded a new one. It is only safe today because this panel and that card are mutually
   * exclusive mounts, which is a thing no future layout has to respect.
   */
  namedAges: NamedAges;
  /**
   * The clubs somebody threw out, for the same reason and with the same caveat as `namedAges`:
   * the rota must not offer a club that has already been answered for, and a `loadDroppedClubs()`
   * inside the memo would be a dependency React cannot see.
   */
  droppedClubs: DeletedClubs;
  /**
   * The GameChanger ids a finished run refused as invented, handed up to be thrown out for good.
   * Up, because the list of thrown-out clubs is the view's state — this panel only reads it — and
   * a save made here would leave the view offering the same ids to the rota until the next reload.
   */
  onInvented: (gcTeamIds: string[]) => void;
  /**
   * What the sweep for clubs plainly made up (`obviousFakes.ts`) changed in the marks, run in the
   * tidy worker on the pool a finished run left, tidied, as the nightly sweeps the cloud copy after
   * its pull. Up, for the same reason as the clubs thrown out: the marks are the view's state. With
   * the clubs the tidy spares (the real list and every club a League Standings team links), which
   * the view deletes none of when it deletes the clubs a lopsided score marked (`lopsidedDrops`).
   * Told after every sweep, `change` null where it changed no mark, since a club marked before
   * still goes. Answers with the clubs it deleted, which this run's working copy still holds.
   */
  onSwept?: (change: MarksChange | null, spared: ReadonlySet<string>) => readonly string[];
  /** Which levels have already had their turn today, and how to record that they have. */
  refreshLog: RefreshLog;
  onRefreshLog: (log: RefreshLog) => void;
};

/** "About 1 minute", "About 12 minutes": the estimate as a person says it, where it said "minute(s)". */
const aboutMinutes = (fresh: number): string => {
  const minutes = estimatedMinutes(fresh);
  return `About ${minutes.toLocaleString()} ${minutes === 1 ? "minute" : "minutes"}`;
};

/** A count as the page prints every other: "52,470", with its comma. */
const withCommas = (value: number): string => value.toLocaleString();

/** A baseball year as the picker names it: "2027: Fall 2026 to Summer 2027". */
const seasonYearLabel = (year: number): string => `${year}: Fall ${year - 1} to Summer ${year}`;

const SAMPLE = `https://web.gc.com/teams/FtEExZwB4b8E/2026-fall-trosky-illinois-9u/schedule
gsUthn4XoIxS

…or paste the whole export, headers and all:
Team Name,Team ID,Age Group,Season,City,State
"9u Astros 9U",hH8l9MBjxg7U,9U,Fall 2026,Baileyton,AL`;

/** Hands the whole list over as a file, since a few hundred rows is spreadsheet work. */
const downloadProblems = (problems: GcImportProblem[]) => {
  downloadCsv("gamechanger-not-imported.csv", gcImportProblemsCsv(problems));
};

/** How many rows of the list are drawn; the rest are in the file the button writes. */
const PROBLEMS_SHOWN = 200;
/** Pairings drawn before "Show all" is pressed. A cap on the drawing, never on the deciding. */
const PAIRS_DRAWN = 100;

/**
 * Whether a pairing answers to what was typed in the search box.
 *
 * Both names, both seasons and the confidence, because those are the words on the row: somebody
 * looking for their own club types its name, somebody working through the winter boundary types
 * "Fall 2025", and somebody who only trusts the strong ones types "strong". An empty box matches
 * everything, which is what makes it a filter rather than a gate.
 */
export const pairingMatches = (pairing: GcSeasonPairing, search: string): boolean => {
  const term = search.trim().toLowerCase();
  if (!term) return true;
  return [
    pairing.fromTeamName,
    pairing.toTeamName,
    pairing.fromSeason,
    pairing.toSeason,
    pairing.confidence,
  ]
    .join(" ")
    .toLowerCase()
    .includes(term);
};

export function GameChangerImportPanel({
  pool,
  onPersist,
  savedProgress,
  namedAges,
  droppedClubs,
  onInvented,
  onSwept,
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
  const [phase, setPhase] = useState<RunPhase>({ kind: "picking" });
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
   * Why this browser cannot pull, when it cannot: the proxy is for the accounts on the cloud
   * copy's list (`pullGate.ts`). Said above the buttons it turns off, rather than by a run that
   * stops on its first request. The buttons are the only way in: nothing else calls what they do.
   */
  const pullBlock = pullBlockedBy(useSyncExternalStore(subscribeCloud, cloudStatus));
  /*
   * The tidy runs in a worker. It is five passes over every game — half a minute on a nationwide
   * pool — and on the main thread that is half a minute of frozen tab at the very end of an hour
   * of fetching, which is exactly when somebody reloads the page and throws it away.
   */
  const { tidy: tidyInWorker, busy: tidying, progress: tidyProgress } = usePoolTidy();
  const [pairings, setPairings] = useState<GcSeasonPairing[]>([]);
  const [approved, setApproved] = useState<Set<string>>(new Set());
  /** Narrows the pairing list by name, state or season. */
  const [pairSearch, setPairSearch] = useState("");
  /** How many pairings are drawn. Raised to all of them by the button under the list. */
  const [pairLimit, setPairLimit] = useState(PAIRS_DRAWN);
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

  /**
   * What the run is working on, and what that pool *is* — see `HeldPool`.
   *
   * The pull mutates this as results land. Holding the working pool in React state instead would
   * queue a render per team and copy a growing pool each time; what the panel draws is kept
   * separately.
   */
  const heldRef = useRef<HeldPool>(holdingWholePool(pool));
  /**
   * The pool as the page has it right now, so a run can start from that rather than from whatever
   * was there when this panel opened.
   *
   * `heldRef` is the run's working copy and the run owns it, which is right once a run is under
   * way — the slot it claims is what keeps a tidy or a second pull from writing underneath it. It
   * was also seeded at mount and never again, and the panel can sit open across a tidy, a club
   * deletion or a restored backup. A run started afterwards folded onto the pool as it was at
   * mount and saved that, undoing whatever had happened in between. `runSectioned` showed the
   * seam plainly: it worked out its sections from this prop and then folded them over the stale
   * ref.
   */
  const livePoolRef = useRef<GcImportState>(pool);
  useEffect(() => {
    livePoolRef.current = pool;
  }, [pool]);
  const progressRef = useRef<GcPullProgress | null>(savedProgress);
  const outcomesRef = useRef<GcImportOutcome[]>([]);
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
  /**
   * The ids already known to be below the youngest level ranked here.
   *
   * State as well as storage because the paste is filtered against it during render — a run that
   * learns fifty more of them should shorten the next paste without a reload.
   */
  const [tooYoung, setTooYoung] = useState<TooYoungClubs>(() => loadTooYoungClubs());
  // The ids earlier pulls turned away, which a paste leaves out (`refusedClubs.ts`).
  const [refused, setRefused] = useState<RefusedClubs>(() => loadRefusedClubs());

  // Split once a paste, apart from what it is held against, so a pool saved while the panel is open
  // reads its rows again without splitting a forty megabyte export again.
  const read = useMemo(() => parseGcTeamList(text), [text]);
  const {
    ageless,
    asks,
    currentSeasonYear,
    membership,
    orgAges,
    parsed,
    seasonOptions,
    seasonYears,
    setAgeless,
    setMembership,
    split,
    toggleSeasonYear,
    waitingOrgAged,
  } = useGcTeamList({ droppedClubs, namedAges, pool, read, refused, text, tooYoung });
  const {
    agelessLine,
    cadence,
    chooseCadence,
    chooseOrgFile,
    chooseTeamFile,
    due,
    everythingDue,
    linkedTeams,
    resumable,
    setShowWeek,
    showWeek,
  } = useGcPullSchedule({
    ageless,
    asks,
    droppedClubs,
    membership,
    phase,
    pool,
    refreshLog,
    savedProgress,
    setLoaded,
    setMembership,
    showToast,
  });

  /**
   * The GameChanger pages that may not be teams, and which are worth asking about again.
   *
   * It takes nine to field a side, and roughly one page in thirty-six has fewer — a page somebody
   * made and did not finish, or a squad still being assembled. None are thrown away, because a
   * squad of six in September is twelve in October and the roster count is the only thing that
   * ever says which. They are simply asked about again, a fortnight later.
   */
  /*
   * The season being played's pages only, as the rota keeps to. A club keeps the ids it was pulled
   * as after its year is archived or deleted, so last season's six-player page stayed on this list
   * and asking about it again filed the squad back onto a page of the year that was put away.
   */
  const rosterWatch = useMemo(
    () =>
      rosterWatchOf(pool.teams, gcLinkSquadYearIn(pool.ageGroups), segmentOn(todayIsoDay()).year),
    [pool.teams, pool.ageGroups]
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

  /** Which section of a sectioned run is going, for the bar to say so. Null when it is one run. */
  const section = sectionOf(phase);

  const {
    forcedCount,
    persist,
    recheckRosters,
    runAgeless,
    runDue,
    runEverything,
    runSectioned,
    tidyNow,
  } = useGcPullRun({
    due,
    dueLevelsRef,
    everythingDue,
    heldRef,
    livePoolRef,
    namedAges,
    onInvented,
    onPersist,
    onRefreshLog,
    onSaveProgress,
    onSwept,
    orgAges,
    outcomesRef,
    parsed,
    pool,
    progressRef,
    refreshLog,
    rosterDue,
    setAgeless,
    setApproved,
    setLive,
    setOpenPair,
    setPairings,
    setPhase,
    setRefused,
    setResult,
    setStats,
    setTooYoung,
    showToast,
    split,
    tidyInWorker,
  });

  const startNew = () => {
    // The button is off with no season ticked; this is for anything else that calls it.
    if (seasonYears.length === 0) return;
    const ids = (split.fresh.length > 0 ? split.fresh : split.refresh).map((entry) => entry.teamId);
    if (ids.length === 0) {
      showToast(
        split.seen > 0 ? "Every team in that list is already here." : "No GameChanger ids in that.",
        { tone: "error" }
      );
      return;
    }
    const progress = startPull(ids, nowIso(), savedProgress, seasonYears);
    onSaveProgress(progress);
    void runSectioned(remainingIds(progress), progress);
  };

  const resume = () => {
    if (!savedProgress) return;
    void runSectioned(remainingIds(savedProgress), savedProgress);
  };

  const retry = () => {
    const current = progressRef.current;
    if (!current) return;
    const next = retryFailures(current, nowIso());
    onSaveProgress(next);
    void runSectioned(remainingIds(next), next);
  };

  const {
    downloadRunSummary,
    downloadRunTeams,
    keepApart,
    pairKey,
    releasePool,
    stop,
    tracked,
    trackedIds,
  } = useGcRunControls({ progressRef, setApproved, setOpenPair, setPairings, showToast });

  const matching = pairings.filter((pairing) => pairingMatches(pairing, pairSearch));
  const shown = matching.slice(0, pairLimit);

  const applyPairings = () => {
    if (approved.size === 0) {
      onClearProgress();
      onClose();
      return;
    }
    let next = heldRef.current.state;
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
    heldRef.current = holdingNow(heldRef.current, next);
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
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Pull from GameChanger
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-slate-500 dark:text-slate-400">
            Paste team ids, team page links, or a whole spreadsheet export. Each team&apos;s
            schedule is read and filed under its own age group and squad year — the pages are
            created as needed. A pull of a few thousand teams takes a while; it saves as it goes, so
            stopping or closing the tab keeps what it already has.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className={`${tapArea} text-xs font-bold text-slate-600 hover:underline dark:text-slate-400`}
        >
          Close
        </button>
      </div>

      {phase.kind === "picking" && poolBusy && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40">
          <p className="text-sm font-bold text-slate-950 dark:text-white">
            {pullLive ? "A pull is already running." : "The pool is being tidied."}
          </p>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
            {pullLive ? (
              <>
                It kept going when this panel was closed. Starting another would have the two of
                them saving the pool over each other, so this one waits. The counter below is the
                last position saved, which advances every {SAVE_EVERY_MIN} teams on a small pool and
                up to every {SAVE_EVERY_MAX} on a large one.
              </>
            ) : (
              <>
                Folding the pool and settling its stand-ins. It writes the whole pool when it
                finishes, so a pull started now would be saved over — this one waits. On a large
                pool it takes a minute or two, and it runs again by itself if it is interrupted.
              </>
            )}
          </p>
          {/*
           * What that tidy is doing. It is not this component's tidy — something else on the page
           * started it — so this reads the slot that told the banner to appear, which is the only
           * thing that can see across.
           */}
          {!pullLive && <TidyProgressView watch={tidyProgress} running />}
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
      {/*
       * Above everything that starts a pull, which is all turned off while it shows. Not while a
       * pull runs: one that began signed in and is turned away part way stops and says so itself.
       */}
      {pullBlock && phase.kind !== "pulling" && (
        <p
          role="note"
          data-testid="gc-pull-blocked"
          className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-200"
        >
          {pullBlock}
        </p>
      )}
      {phase.kind === "picking" && (
        <div className="mt-4">
          <div className="mb-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold text-slate-950 dark:text-white">{describeDue(due)}</p>
              {cadence === "rotation" && (
                <button
                  type="button"
                  onClick={() => setShowWeek((value) => !value)}
                  aria-expanded={showWeek}
                  className="text-xs font-bold text-blue-600 hover:underline dark:text-blue-400"
                >
                  {showWeek ? "Hide the week" : "The week"}
                </button>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {describeCadence(cadence)} Nothing happens on its own — a browser cannot run while it
              is closed — so this is here whenever you next open it.
            </p>
            <fieldset className="mt-3">
              <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                How much comes round at once
              </legend>
              <div className="mt-1 flex flex-wrap gap-3">
                {(
                  [
                    ["daily", "Every age group, daily"],
                    ["rotation", "One or two levels a day"],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value} className="flex items-center gap-1.5 text-xs font-bold">
                    <input
                      type="radio"
                      name="gc-refresh-cadence"
                      value={value}
                      checked={cadence === value}
                      onChange={() => chooseCadence(value)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            {cadence === "rotation" && showWeek && (
              <ul className="mt-2 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                {describeRotation().map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
            {due.teamIds.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={runDue}
                  disabled={pullBlock !== null}
                  className={`${button.primary} mt-3`}
                >
                  {cadence === "daily"
                    ? `Refresh all ${due.teamIds.length.toLocaleString()} teams`
                    : `Refresh today's ${due.ageLevels.map((level) => `${level}U`).join(" and ")}`}
                </button>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {aboutMinutes(due.teamIds.length)} of requests, and the whole pool is written back
                  several times along the way, which is the slower half.
                </p>
              </>
            )}
            {due.heldBack > 0 && (
              <p
                className="mt-1 text-xs text-slate-500 dark:text-slate-400"
                data-testid="gc-held-back"
              >
                {due.heldBack.toLocaleString()} team{due.heldBack === 1 ? "" : "s"} pulled in the
                last {MIN_PULL_GAP_HOURS} hours with no game yesterday, today or tomorrow{" "}
                {due.heldBack === 1 ? "waits" : "wait"} for a later run.
              </p>
            )}
            {due.teamIds.length === 0 && forcedCount > 0 && (
              <>
                <button
                  type="button"
                  onClick={runEverything}
                  disabled={pullBlock !== null}
                  className={`${button.ghost} mt-3`}
                >
                  Refresh all {forcedCount.toLocaleString()} teams again
                </button>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Today is already marked done. Run it again if something has changed since — a
                  fixed link, a tournament that finished this afternoon.
                </p>
              </>
            )}
            {due.agelessTotal > 0 && (
              <>
                {/*
                  The button is omitted rather than disabled when nothing is due: `runAgeless`
                  returns early on an empty list, so a button here would be one that does nothing
                  when pressed.
                */}
                {due.agelessIds.length > 0 ? (
                  <button
                    type="button"
                    onClick={runAgeless}
                    disabled={pullBlock !== null}
                    aria-describedby="gc-ageless-why"
                    className={`${button.primary} mt-3`}
                  >
                    Ask again about {due.agelessIds.length.toLocaleString()} team
                    {due.agelessIds.length === 1 ? "" : "s"} with no age
                  </button>
                ) : (
                  <p className="mt-3 text-sm font-bold text-slate-950 dark:text-white">
                    All asked within the past week. They come round again as each one&apos;s week is
                    up.
                  </p>
                )}
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400" id="gc-ageless-why">
                  {agelessLine} They are on no page, so a refresh by age level never reaches them,
                  and the fetch worked, so nothing retries them either. Asking again is the only
                  thing that can answer it — GameChanger may have filled the field in since, the
                  club may have renamed the squad, or the team may have played more games against
                  opponents who do name an age. Pulling other clubs cannot help: the opponent names
                  are read off this team&apos;s own schedule. One that comes back with an age drops
                  off this list and is refreshed with its level from then on. Each is asked at most
                  once a week, and left alone once it has had {AGE_UNKNOWN_MAX_TRIES} asks and{" "}
                  {AGE_UNKNOWN_MAX_TRIES} weeks.
                </p>
              </>
            )}
          </div>

          {rosterWatch.length > 0 && (
            <div className="mb-3 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
              <p className="font-bold text-slate-950 dark:text-white">
                {withCommas(rosterWatch.length)} page{rosterWatch.length === 1 ? "" : "s"} may not
                be a team yet
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
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
                  disabled={pullBlock !== null}
                  className={`${button.ghost} mt-3 text-sm`}
                >
                  Check{" "}
                  {rosterDue.length === rosterWatch.length
                    ? "them"
                    : `${withCommas(rosterDue.length)} of them`}{" "}
                  again
                </button>
              ) : (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
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
                {describePull(savedProgress!)} {withCommas(resumable.length)} still to go.
              </p>
              <div className="mt-2 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={resume}
                  disabled={pullBlock !== null}
                  className={button.primary}
                >
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
            className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
            htmlFor="gc-import-text"
          >
            Teams
          </label>
          {loaded ? (
            <div className="mt-1 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-900">
              <span className="font-mono font-bold">{loaded.name}</span>
              <span className="text-slate-500 dark:text-slate-400">
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
                  if (file) chooseTeamFile(file);
                }}
              />
            </label>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              The export from GameChanger, headers and all — or paste a few ids above. A file of any
              size is fine; the rota is there so they need not all be pulled at once.
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
            {text.trim() === "" ? (
              <span>Nothing chosen or pasted yet.</span>
            ) : (
              <>
                <span className={pill(parsed.entries.length ? "emerald" : "red")}>
                  {withCommas(parsed.entries.length)} team{parsed.entries.length === 1 ? "" : "s"}
                </span>
                {split.seen > 0 && (
                  <span className={pill("neutral")}>
                    {withCommas(split.seen)} already here
                    {split.refresh.length > 0 ? "" : ", skipped"}
                  </span>
                )}
                {parsed.skipped.length > 0 && (
                  <span className={pill("amber")}>
                    {`${withCommas(parsed.skipped.length)} ${parsed.skipped.length === 1 ? "line" : "lines"} ignored`}
                  </span>
                )}
                {parsed.tooYoung > 0 && (
                  <span className={pill("neutral")}>
                    {withCommas(parsed.tooYoung)} under {MIN_AGE_LEVEL}U, skipped
                  </span>
                )}
                {parsed.notBaseball > 0 && (
                  <span className={pill("neutral")}>
                    {withCommas(parsed.notBaseball)} wiffle ball, blitzball or softball, skipped
                  </span>
                )}
                {parsed.notYouth > 0 && (
                  <span className={pill("neutral")}>
                    {withCommas(parsed.notYouth)} adult or college, skipped
                  </span>
                )}
                {parsed.highSchool > 0 && (
                  <span className={pill("neutral")}>
                    {withCommas(parsed.highSchool)} high school, skipped
                  </span>
                )}
                {parsed.notATeam > 0 && (
                  <span
                    className={pill("neutral")}
                    title="Pages whose name says they are no team: a practice, scrimmage, tryout or test page, an old page marked void, do not use or delete, or a page called only Team and a number, a letter or an age. Read off the name on every paste, so a page renamed since is asked about again. A club you vouched for is pulled whatever its name says."
                  >
                    {`${withCommas(parsed.notATeam)} practice, test, old or unnamed team ${parsed.notATeam === 1 ? "page" : "pages"}, skipped`}
                  </span>
                )}
                {parsed.otherSeason > 0 && (
                  <span className={pill("neutral")}>
                    {withCommas(parsed.otherSeason)} from other seasons, skipped
                  </span>
                )}
                {parsed.turnedAway.length > 0 && (
                  <span
                    className={pill("neutral")}
                    title="Fetched by an earlier pull and turned away: high school, wiffle ball or softball, adult or over-age teams for good, and teams from a season that is still not ticked."
                  >
                    {withCommas(parsed.turnedAway.length)} turned away before, skipped{" "}
                    <button
                      type="button"
                      className="font-bold underline"
                      onClick={() => {
                        const next = forgetRefused(refused, parsed.turnedAway);
                        setRefused(next);
                        saveRefusedClubs(next);
                      }}
                    >
                      Ask again
                    </button>
                  </span>
                )}
                {parsed.thrownOut > 0 && (
                  <span
                    className={pill("neutral")}
                    title="A club you threw out is refused whatever list names it. Paste its id into Find a team to bring it back."
                  >
                    {parsed.thrownOut} you threw out, skipped
                  </span>
                )}
                {split.fresh.length > 200 && (
                  <span>{aboutMinutes(split.fresh.length)} of requests.</span>
                )}
              </>
            )}
          </div>

          {text.trim() !== "" && (
            <fieldset className="mt-3">
              <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Seasons to pull
              </legend>
              <div className="mt-1 flex flex-wrap gap-3">
                {seasonOptions.map((year) => {
                  const count = parsed.bySeason.get(year) ?? 0;
                  return (
                    <label key={year} className="flex items-center gap-1.5 text-xs font-bold">
                      <input
                        type="checkbox"
                        checked={seasonYears.includes(year)}
                        onChange={() => toggleSeasonYear(year)}
                      />
                      {seasonYearLabel(year)}
                      {year === currentSeasonYear ? ", this season" : ""}
                      {/* A space for the label's accessible name; flex layout drops it. */}
                      {count > 0 && " "}
                      {count > 0 && (
                        <span className="font-normal text-slate-500 dark:text-slate-400">
                          ({count.toLocaleString()} team{count === 1 ? "" : "s"})
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
              <p
                className="mt-1 text-xs text-slate-500 dark:text-slate-400"
                data-testid="gc-season-note"
              >
                {seasonYears.length === 0
                  ? "Tick a season to pull."
                  : parsed.noSeason > 0
                    ? `${parsed.noSeason.toLocaleString()} ${
                        parsed.noSeason === 1 ? "team does not say its" : "teams do not say their"
                      } season, so each is checked when it arrives and filed only if it is from a ticked season.`
                    : "Teams from any other season are left out before a request is spent on them."}
              </p>
            </fieldset>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="inline-block">
              <span className={`${button.ghost} inline-block cursor-pointer`}>
                Choose an Organizations CSV
              </span>
              <input
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                className="hidden"
                aria-label="Organizations CSV"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  event.currentTarget.value = "";
                  if (file) chooseOrgFile(file);
                }}
              />
            </label>
            <span
              className="text-xs text-slate-500 dark:text-slate-400"
              data-testid="gc-org-membership"
            >
              {membership.orgs.length === 0
                ? "The Organizations export with its Team IDs column. A team GameChanger gives no age takes the age its organization's name states, and a file read later adds to this one."
                : `${membership.orgs.length.toLocaleString()} organizations kept, ${linkedTeams.toLocaleString()} teams under them. ${orgAges.size.toLocaleString()} can take an age from an organization's name, ${waitingOrgAged.toLocaleString()} of them waiting on one.`}
            </span>
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
              disabled={
                (split.fresh.length === 0 && split.refresh.length === 0) ||
                seasonYears.length === 0 ||
                pullBlock !== null
              }
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
              <span className="self-center text-xs text-slate-500 dark:text-slate-400">
                {split.refresh.length > 0
                  ? "Already here — pulling again reads today's schedule."
                  : "Every team in that list is already here."}
              </span>
            )}
          </div>
        </div>
      )}

      {phase.kind === "pulling" && stats && (
        <div className="mt-4">
          <div className="h-2 w-full overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-900">
            <div
              className="h-full bg-slate-950 transition-[width] dark:bg-white"
              style={{ width: `${Math.round(stats.fraction * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-sm font-bold text-slate-950 dark:text-white">
            {withCommas(stats.done)} of {withCommas(stats.total)} pulled
            {stats.failed ? `, ${withCommas(stats.failed)} failed` : ""}.
          </p>
          {section && (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Age group {section.index} of {section.of}: <strong>{section.label}</strong>. A run
              this size is done a page at a time so the tab is never holding the whole pool — the
              count above is the whole run, and it carries on across them.
            </p>
          )}
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Saved every {SAVE_EVERY_MIN}–{SAVE_EVERY_MAX} teams, less often as the pool grows. You
            can stop, close this, or leave the tab — it picks up where it left off.
          </p>

          {live && (
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
              <div>
                <dt className="uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Teams a minute
                </dt>
                <dd className="font-bold text-slate-950 dark:text-white">
                  {live.perMinute?.toLocaleString() ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="uppercase tracking-wide text-slate-500 dark:text-slate-400">Held</dt>
                <dd className="font-bold text-slate-950 dark:text-white">{live.heldSeconds}s</dd>
              </div>
              <div>
                <dt className="uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Refused
                </dt>
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
                <dt className="uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Saves
                </dt>
                <dd className="font-bold text-slate-950 dark:text-white">
                  {live.saves}
                  {live.lastSaveMs === undefined ? "" : ` · ${live.lastSaveMs}ms`}
                </dd>
              </div>
            </dl>
          )}
          {tidying === "tidy" ? (
            <>
              <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
                Everything is in. Tidying now — naming the stand-ins the other side&apos;s schedule
                can settle, folding the clubs pulled under more than one id. It walks every game
                several times over, so on a big pool this takes a while; it runs off the main
                thread, so the page stays usable and leaving this open is not needed.
              </p>
              <TidyProgressView watch={tidyProgress} running />
            </>
          ) : (
            <div className="mt-3">
              <button type="button" onClick={stop} className={button.ghost}>
                Stop
              </button>
            </div>
          )}
        </div>
      )}

      {phase.kind === "review" && result && (
        <div className="mt-4">
          <ul className="space-y-1 text-sm text-slate-700 dark:text-slate-200">
            {result.summary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>

          <div className="mt-4 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
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
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Worth a look ({withCommas(result.problems.length)})
                </p>
                <button
                  type="button"
                  onClick={() => downloadProblems(result.problems)}
                  className="text-xs font-bold text-blue-600 hover:underline dark:text-blue-400"
                >
                  Download the list
                </button>
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {describeGcProblems(result.problems)}. A team not reached is often worth another
                try; one that could not be filed needs its age group or season fixed on GameChanger,
                is a level this app does not rank, or, where its row says so, has the wrong id. One
                to check did import — its id simply returned a different team from the one your list
                named, which is what a wrong id looks like.
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
                    <span className="block text-slate-500 dark:text-slate-400">
                      {problem.detail}
                    </span>
                  </li>
                ))}
              </ul>
              {result.problems.length > PROBLEMS_SHOWN && (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Showing the first {PROBLEMS_SHOWN}. The download has all{" "}
                  {withCommas(result.problems.length)}.
                </p>
              )}
              {result.canRetry && (
                <button
                  type="button"
                  onClick={retry}
                  disabled={pullBlock !== null}
                  className={`${button.ghost} mt-3`}
                >
                  Try the unreached ones again
                </button>
              )}
            </div>
          )}

          {pairings.length > 0 && (
            <div className="mt-4 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Same squad, a season on?
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                GameChanger gives a club a new id every season, so these arrived as separate teams.
                Pairs with the same name, town and state have been combined already. These share
                less than that, so they are yours to call — tap a name to see the two side by side.
                Pairing makes one team with both seasons behind it. <strong>Not the same</strong>
                is remembered against the two GameChanger ids, so a pair you turn down is never
                offered again.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <input
                  type="search"
                  value={pairSearch}
                  onChange={(event) => setPairSearch(event.target.value)}
                  placeholder="Search by name or season"
                  aria-label="Search pairings"
                  className="min-w-48 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-900"
                />
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={
                      matching.length > 0 &&
                      matching.every((pairing) => approved.has(pairKey(pairing)))
                    }
                    onChange={(event) => {
                      /*
                       * Only the ones the search matches, added or removed. It used to replace the
                       * whole set, so unticking it threw away every approval made under a previous
                       * search — a hundred decisions lost to one click.
                       */
                      const keys = matching.map((pairing) => pairKey(pairing));
                      setApproved((current) => {
                        const next = new Set(current);
                        keys.forEach((key) =>
                          event.target.checked ? next.add(key) : next.delete(key)
                        );
                        return next;
                      });
                    }}
                  />
                  Tick all {withCommas(matching.length)}
                  {pairSearch.trim() ? " matching" : ""}
                </label>
              </div>
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
                                        heldRef.current.state.teams,
                                        heldRef.current.state.games
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
                            <span className="text-slate-500 dark:text-slate-400">
                              {/* One season on both cards reads as nonsense with an arrow through
                                  it, and the arrow is not what happened: nothing carried on. */}
                              {pairing.kind === "same-season"
                                ? `${pairing.toSeason}, listed twice`
                                : `${pairing.fromSeason} → ${pairing.toSeason}`}
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
                          </label>{" "}
                          <button
                            type="button"
                            onClick={() => keepApart(pairing)}
                            className={`${button.ghost} text-xs`}
                          >
                            Not the same
                          </button>
                        </div>
                      </div>
                      {comparison && <PairingComparison comparison={comparison} />}
                    </li>
                  );
                })}
              </ul>
              {shown.length < matching.length && (
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                  <span>
                    Drawing {withCommas(shown.length)} of {withCommas(matching.length)}
                    {pairSearch.trim() ? ` that match, out of ${withCommas(pairings.length)}` : ""}.
                  </span>
                  <button
                    type="button"
                    className={button.ghost}
                    onClick={() => setPairLimit(matching.length)}
                  >
                    Show all {withCommas(matching.length)}
                  </button>
                </div>
              )}
              {matching.length === 0 && (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  None of the {withCommas(pairings.length)} match that. Clear the search to see them
                  all.
                </p>
              )}
              {approved.size > 0 && (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  {withCommas(approved.size)} ticked
                  {approved.size > shown.length ? ", including some not drawn here" : ""}.
                </p>
              )}
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" onClick={applyPairings} className={button.primary}>
              {approved.size > 0 ? `Pair ${withCommas(approved.size)} and finish` : "Finish"}
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
        <thead className="bg-slate-50 text-slate-500 dark:text-slate-400 dark:bg-slate-900">
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
        <p className="px-2 py-1 text-xs text-slate-500 dark:text-slate-400">
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
      <span className="text-slate-500 dark:text-slate-400">none yet</span>
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
          <tr className="text-left text-slate-500 dark:text-slate-400">
            <th className="pb-1 pr-3 font-semibold" />
            <th className="pb-1 pr-3 font-semibold">{from.season}</th>
            <th className="pb-1 font-semibold">{to.season}</th>
          </tr>
        </thead>
        <tbody className="align-top">
          {rows.map(([label, a, b]) => (
            <tr key={label}>
              <td className="py-0.5 pr-3 text-slate-500 dark:text-slate-400">{label}</td>
              <td className="py-0.5 pr-3 text-slate-950 dark:text-white">{a}</td>
              <td className="py-0.5 text-slate-950 dark:text-white">{b}</td>
            </tr>
          ))}
          <tr>
            <td className="py-0.5 pr-3 text-slate-500 dark:text-slate-400">
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
