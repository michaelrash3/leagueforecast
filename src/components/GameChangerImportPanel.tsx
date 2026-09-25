import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ageFromLeagueNames,
  ageFromOrgName,
  parseGcOrgList,
  parseGcTeamList,
  type GcTeamListEntry,
  type GcTeamProfile,
} from "../lib/gameChangerApi";
import { BATCH_SIZE, fetchGcTeams } from "../lib/gameChangerClient";
import type { NamedAges } from "../lib/namedAges";
import {
  mergeOrgMembership,
  orgAgesByTeam,
  withOrgAges,
  type OrgMembership,
} from "../lib/orgMembership";
import { inventedFromOutcomes, type DeletedClubs } from "../lib/deletedGames";
import {
  heldSnapshot,
  holdingNow,
  holdingPages,
  holdingWholePool,
  sectionOf,
  type HeldPool,
  type RunPhase,
  type SectionMark,
} from "../lib/pullRun";
import {
  beginPull,
  endPull,
  forceReleasePool,
  isPoolBusy,
  isPullLive,
  lastPullLog,
  type PullSession,
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
  tidyChangedAnything,
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
  describeCadence,
  describeDue,
  describeRotation,
  dueRefresh,
  markRefreshed,
  type DueRefresh,
  type RefreshCadence,
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
import {
  AGE_UNKNOWN_MAX_TRIES,
  describeAgeUnknown,
  updateAgeUnknown,
  withRulesMoved,
  type AgeUnknownList,
} from "../lib/ageUnknown";
import {
  isTooYoungClub,
  rememberTooYoung,
  tooYoungFromOutcomes,
  type TooYoungClubs,
} from "../lib/tooYoungClubs";
import { usePoolTidy } from "../hooks/usePoolTidy";
import { TidyProgressView } from "./teamRankings/TidyProgressView";
import { listCoverage, unpulledClubs } from "../lib/unpulledClubs";
import { downloadCsv, fileDay } from "../lib/download";
import {
  flushPoolWrites,
  loadAgeUnknown,
  loadRefreshCadence,
  loadScoutGames,
  loadScoutGamesForPages,
  saveRefreshCadence,
  loadPullLog,
  saveAgeUnknown,
  savePullLog,
  saveTidyStamp,
  type PoolHolding,
  loadDeletedGames,
  loadDroppedClubs,
  loadTooYoungClubs,
  saveTooYoungClubs,
  loadOrgMembership,
  saveOrgMembership,
  loadKeptApart,
  saveKeptApart,
} from "../lib/teamRankingsStorage";
import { keepApart as apartAfter } from "../lib/keptApart";
import {
  liveSummary,
  pullSummaryCsv,
  pullTeamsCsv,
  type PullEndReason,
  type PullLiveSummary,
  type PullRunLog,
  type PullTracker,
} from "../lib/pullTracker";
import {
  MIN_AGE_LEVEL,
  mergeScoutTeams,
  pulledGcTeamIds,
  segmentOn,
  squadYearForGcSeason,
} from "../lib/teamRankings";
import { todayIsoDay } from "../lib/date";
import type { ToastTone } from "../hooks/useToast";
import { pullSections } from "../lib/pullSections";
import { button, card, pill } from "../styles/tokens";

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
  /** Which levels have already had their turn today, and how to record that they have. */
  refreshLog: RefreshLog;
  onRefreshLog: (log: RefreshLog) => void;
};

/**
 * Teams between saves. Each save writes the whole pool, so on a run of several thousand the cost
 * is the pool's size times the number of saves — often enough to dwarf the fetching. What it buys
 * is how much an interrupted run has to redo, and five hundred teams is about a minute of that
 * against fourteen writes of the pool rather than two hundred and eighty. The cursor is only
 * advanced *after* the write, so a crash re-fetches the batch rather than claiming teams it never
 * kept.
 */
/**
 * Writes the run's record beside the pool. Written asynchronously — the record is read on demand,
 * not from the pool's cache — and a refusal, or a store that throws, is noted in the record itself
 * rather than allowed anywhere near the run.
 */
const persistLog = (tracker: PullTracker, log: PullRunLog): void => {
  savePullLog(log).then(
    (ok) => {
      if (!ok) tracker.unpersisted();
    },
    () => tracker.unpersisted()
  );
};

/**
 * How many teams to fetch between saves, given how big the pool already is.
 *
 * Every save writes the *whole* pool — the store keeps it as one value, so there is no such thing
 * as appending a game to it. That is fine at a few thousand teams and ruinous at a hundred
 * thousand: a fixed interval means the number of saves grows with the run while the cost of each
 * one grows with the pool, so the total written grows as the square. Measured on a real pool at 169
 * bytes a row encoded, a nationwide pull saving every five hundred teams writes **fourteen to
 * twenty-six gigabytes to disk** to store a few hundred megabytes, and allocates the encoded pool
 * as garbage each time. It is the reason such a pull slows to a crawl and buries the tab in
 * collection: not the fetching, the saving.
 *
 * So the interval grows with the pool. Twenty-odd saves instead of two hundred and thirty, a tenth
 * of the disk and a tenth of the garbage. What it costs is how much a crash can undo — at the
 * ceiling, five thousand teams, which is two or three minutes of fetching. Worth it against an
 * hour of thrashing, and the floor keeps small pulls saving as often as they always did.
 */
export const SAVE_EVERY_MIN = 500;
export const SAVE_EVERY_MAX = 5000;
export const saveEvery = (games: number): number => {
  /*
   * Guarded rather than trusted, because of what the arithmetic does with a number that is not
   * one: `Math.max(500, NaN)` is NaN, and the caller's test is `unsaved.length >= interval`, which
   * is false for NaN every time — so a bad count here would not make the pull save badly, it would
   * make it never save at all, and lose the lot on the way out.
   */
  if (!Number.isFinite(games) || games <= 0) return SAVE_EVERY_MIN;
  return Math.min(SAVE_EVERY_MAX, Math.max(SAVE_EVERY_MIN, Math.round(games / 100)));
};

/**
 * Requests in flight at once, each one asking for ten teams. A browser holds only a handful of
 * connections open to one host, so this is the real parallelism of the pull; the batching is what
 * lets it be worth anything. A throttled answer holds every worker back rather than this one, so
 * the cost of being wrong here is a slower pull rather than lost teams.
 */
const CONCURRENCY = 8;
/**
 * Workers the pull may grow to while the route stays clean.
 *
 * Eight was a guess made when nobody knew what GameChanger would take, and it held a nationwide
 * pull to around two thousand teams a minute — most of an hour for a hundred thousand. Rather than
 * replace it with a bigger guess, the client starts at eight and adds a worker for every ten
 * batches that come back without a hold, stopping for good at the first sign of pushback. This is
 * only where it stops climbing.
 */
const MAX_CONCURRENCY = 24;

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

/** A baseball year as the picker names it: "2027: Fall 2026 to Summer 2027". */
const seasonYearLabel = (year: number): string => `${year}: Fall ${year - 1} to Summer ${year}`;

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

  const listRead = useMemo(() => {
    const read = parseGcTeamList(text);
    // Wiffle ball is a different game, so those rows never cost a request. Counted separately from
    // the too-young ones because they are a different kind of "not for us" and the panel says so.
    const baseball = read.entries.filter((entry) => !entry.notBaseball);
    // A high school squad plays its own season against other high school squads, so its results
    // join nothing ranked here. Dropped on the same terms and for the same reason as the wiffle
    // rows — before a request is spent — and counted apart, because a reader who pasted a list
    // full of them deserves to be told which kind of "not for us" ate it.
    const club = baseball.filter((entry) => !entry.highSchool);
    // And the third kind of "not for us": GameChanger's own field saying adult or college. Same
    // terms again — refused before a request, counted apart — because a list of men's-league
    // teams vanishing silently is indistinguishable from a list that failed to parse.
    const youth = club.filter((entry) => !entry.notYouth);
    const entries = youth.filter(
      (entry) =>
        !isTooYoungClub(tooYoung, entry.teamId) &&
        (entry.ageLevel === undefined || entry.ageLevel >= MIN_AGE_LEVEL)
    );
    return {
      ...read,
      entries,
      tooYoung: youth.length - entries.length,
      notBaseball: read.entries.length - baseball.length,
      highSchool: baseball.length - club.length,
      notYouth: club.length - youth.length,
      // Counted here rather than again at run time: on a nationwide export this is a forty
      // megabyte split, and once is enough.
      lines: text ? text.split(/\r?\n/).length : 0,
    };
  }, [text, tooYoung]);

  /**
   * The seasons a pull files: the one being played, unless somebody ticks another.
   *
   * A season in this app's sense, the baseball year from August to July (`segmentOn`), so 2027 is
   * Fall 2026 through Summer 2027. A crawl that searched every season of a calendar year hands over
   * last spring's and summer's squads beside this fall's, and a finished year's team adds nothing
   * to the tables being read now. Held against the list it was chosen for, so a new list starts
   * from the season being played again rather than from whatever the last one asked for.
   */
  const currentSeasonYear = segmentOn(todayIsoDay()).year;
  const [seasonChoice, setSeasonChoice] = useState<{ text: string; years: number[] } | null>(null);
  const seasonYears = useMemo(
    () =>
      seasonChoice !== null && seasonChoice.text === text
        ? seasonChoice.years
        : [currentSeasonYear],
    [seasonChoice, text, currentSeasonYear]
  );
  const toggleSeasonYear = (year: number) => {
    const next = seasonYears.includes(year)
      ? seasonYears.filter((kept) => kept !== year)
      : [...seasonYears, year].sort((a, b) => b - a);
    setSeasonChoice({ text, years: next });
  };

  /**
   * The list less the rows from seasons nobody asked for.
   *
   * Only a row whose Season column says so is dropped here, before a request is spent on it. A row
   * that does not say is kept and settled when it arrives, by GameChanger's own season: the run
   * hands the same years to the importer, which refuses the rest (`seasonYears`).
   */
  const parsed = useMemo(() => {
    const wanted = new Set(seasonYears);
    const bySeason = new Map<number, number>();
    const entries: GcTeamListEntry[] = [];
    let noSeason = 0;
    for (const entry of listRead.entries) {
      if (!entry.season) {
        noSeason += 1;
        entries.push(entry);
        continue;
      }
      const year = squadYearForGcSeason(entry.season.season, entry.season.year);
      bySeason.set(year, (bySeason.get(year) ?? 0) + 1);
      if (wanted.has(year)) entries.push(entry);
    }
    return {
      ...listRead,
      entries,
      otherSeason: listRead.entries.length - entries.length,
      bySeason,
      noSeason,
    };
  }, [listRead, seasonYears]);

  /** The years the picker offers: the one being played, the one before, and any the list names. */
  const seasonOptions = useMemo(
    () =>
      [...new Set([currentSeasonYear, currentSeasonYear - 1, ...parsed.bySeason.keys()])].sort(
        (a, b) => b - a
      ),
    [currentSeasonYear, parsed.bySeason]
  );

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
  /**
   * The organizations the user's Organizations file named, with the teams under each, and the age
   * each such team's organizations agree on. Read when a pull files a team GameChanger left
   * ageless, and by the rota, which asks straight away about a waiting team a file can now age.
   */
  const [membership, setMembership] = useState<OrgMembership>(() => loadOrgMembership());
  const orgAges = useMemo(() => orgAgesByTeam(membership), [membership]);
  const asks = useMemo(
    () => withRulesMoved(withOrgAges(namedAges, orgAges, membership.savedAt), ageless),
    [namedAges, orgAges, membership.savedAt, ageless]
  );
  const waitingOrgAged = useMemo(
    () => ageless.filter((entry) => orgAges.has(entry.teamId)).length,
    [ageless, orgAges]
  );
  const linkedTeams = useMemo(
    () => new Set(membership.orgs.flatMap((org) => org.teamIds)).size,
    [membership]
  );
  const readOrgFile = (text: string) => {
    const { orgs } = parseGcOrgList(text);
    if (!orgs.some((org) => org.teamIds?.length)) {
      showToast("That file names no teams under its organizations: it needs the Team IDs column.", {
        tone: "error",
      });
      return;
    }
    const next = mergeOrgMembership(membership, orgs, new Date().toISOString());
    if (next === membership) {
      showToast("Nothing new in that file: every organization in it is already kept.");
      return;
    }
    if (!saveOrgMembership(next)) {
      showToast("Could not keep the organizations: the browser refused the write.", {
        tone: "error",
      });
      return;
    }
    setMembership(next);
    showToast(`Kept ${next.orgs.length.toLocaleString()} organizations with teams under them.`);
  };
  const [cadence, setCadence] = useState<RefreshCadence>(() => loadRefreshCadence());
  const chooseCadence = useCallback((next: RefreshCadence) => {
    setCadence(next);
    saveRefreshCadence(next);
  }, []);

  /*
   * One instant for all of it. The gate that decides what is due, the count in the button and the
   * sentence under it all read a clock now, and three clocks a millisecond apart could disagree
   * about whether a team was asked seven days ago — which is exactly the kind of thing nobody
   * would ever reproduce.
   */
  const { due, agelessLine } = useMemo(() => {
    const now = new Date();
    return {
      due: dueRefresh(now, refreshLog, pool.ageGroups, pool.teams, {
        /*
         * The season being played and no other. A finished season's pages cannot change, so
         * walking them every day spent a pool's worth of requests on nothing; what it costs is a
         * result posted after August 1 for a game in late July, which the pull no longer reads.
         */
        seasonYear: segmentOn(todayIsoDay(now)).year,
        ageless,
        cadence,
        namedAges: asks,
        refused: droppedClubs,
      }),
      agelessLine: describeAgeUnknown(ageless, now, asks, droppedClubs),
    };
  }, [refreshLog, pool.ageGroups, pool.teams, ageless, cadence, asks, droppedClubs]);

  /*
   * The same day, with what has already been done today set aside. Only ever used by the button
   * that asks for it: a person who has just fixed a link, or who knows a tournament finished an
   * hour ago, is asking about something the day log cannot know, and "come back tomorrow" is the
   * wrong answer to that.
   *
   * Built when asked for rather than alongside `due`, because both walk every team's GameChanger
   * links, and on the daily cadence that is the whole pool rather than a level or two of it.
   * Computing it beside the other one paid that walk twice on every change for an answer that is
   * read only when nothing is due.
   */
  const everythingDue = useCallback(() => {
    const now = new Date();
    return dueRefresh(now, refreshLog, pool.ageGroups, pool.teams, {
      // Held to the season being played for the same reason as `due` above.
      seasonYear: segmentOn(todayIsoDay(now)).year,
      ageless,
      cadence,
      namedAges: asks,
      refused: droppedClubs,
      force: true,
    });
  }, [refreshLog, pool.ageGroups, pool.teams, ageless, cadence, asks, droppedClubs]);
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

  /** Which section of a sectioned run is going, for the bar to say so. Null when it is one run. */
  const section = sectionOf(phase);

  /** Copies the counts out of the live cursor so React has something it can see change. */
  const syncStats = () => {
    if (progressRef.current) setStats(pullView(progressRef.current));
  };

  const persist = (note?: string): boolean => {
    /*
     * The copy and the label come out of one value, so a save cannot be handed one run's pool
     * under another run's name — which in one direction deletes every page the run is not holding
     * and in the other writes a pool it was never given. The copy is shallow and per save rather
     * than per team, which is why the save interval is what it is; see `heldSnapshot`.
     */
    const ok = onPersist(heldSnapshot(heldRef.current), heldRef.current.holding);
    if (!ok) {
      /*
       * No cause named here. A save refuses for more than one reason now — the store being full,
       * and the store declining to take this snapshot as the whole pool — and the caller has
       * already said which on its way to returning false. Guessing "storage full" over the top of
       * that would be the wrong one half the time.
       */
      showToast(`Could not save the pull.${note ? ` ${note}` : ""}`, { tone: "error" });
    }
    return ok;
  };

  /**
   * One section of a sectioned run, and where it sits in the sequence.
   *
   * What the fold holds is not in here: `heldRef` is seeded before the section starts, and a
   * section that reached in to seed it would be a second place that decides what a section holds.
   */
  type RunPart = {
    /** Claimed once, by the sequence, and held to the end. */
    session: PullSession;
    /** Whether the paste and the estimate have been recorded yet. */
    first: boolean;
    /** Whether the tidy, the summary and the review screen fall to this one. */
    last: boolean;
    /** What the whole sequence was asked for, which is not what this section was asked for. */
    asked: number;
    /**
     * Which section of how many this is, for the bar.
     *
     * Passed in rather than set beside the run, because the phase carries it and only the thing
     * entering that phase can set both at once. Set separately, the sequence marked the section
     * while the panel was still on "picking" — where a section mark does not exist — and the run
     * then entered "pulling" with no section at all.
     */
    section: SectionMark;
  };

  /**
   * Runs the pull, or one section of it. Each schedule is folded in as it arrives rather than
   * collected and applied at the end, so stopping — or closing the tab — keeps everything already
   * fetched.
   *
   * `part` is what makes a section a section. Absent, this claims the slot, folds over the whole
   * pool and finishes the run at the bottom — which is what it always did, and is still what a
   * run of one section does. Given, the session is the one the sequence holds, the fold is over
   * whatever `heldRef` was seeded with, and the opening and closing work is done once for the
   * sequence rather than once per section.
   */
  const run = async (
    ids: string[],
    progress: GcPullProgress,
    part?: RunPart
  ): Promise<PullEndReason> => {
    /*
     * Claimed before anything is fetched. A pull survives its panel — closing it hides the run
     * rather than stopping it — so a reopened panel could otherwise start a second, and the two
     * would write whole-pool snapshots over each other while the cursor marked the losers settled.
     *
     * A section does not claim: the sequence claimed once, before the first, and holds it to the
     * end. Six claims would be six chances for something else to take the slot in between and
     * leave half a pool refreshed.
     */
    const session = part?.session ?? beginPull(nowIso());
    if (session && part === undefined) {
      /*
       * Seeded here rather than at mount: the slot is claimed, so nothing else can write the pool
       * from now until it is released, and this is the last moment the page's own copy is the
       * newest there is. A section does not seed — the sequence did, before the first of them.
       */
      heldRef.current = holdingNow(heldRef.current, livePoolRef.current);
    }
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
      return "stopped";
    }
    const last = part?.last ?? true;
    const controller = session.controller;
    /*
     * Released whatever happens from here on. The slot this run holds is what stops a second one
     * starting, so anything that throws between the claim and the release leaves it held for the
     * rest of the page's life — and every later run refused, with nothing running to explain it.
     * `endPull` ignores a session that is no longer the live one, so calling it twice is free.
     */
    let released = false;
    /**
     * Whether this section is the one that ends the run: the last of them, or whichever one
     * something stopped. A run that gave up in its third section is still owed a tidy, a summary
     * and a review screen, and there is no seventh section coming to give it one.
     *
     * Out here with `released` so that a throw before the try body cannot leave the `finally`
     * reading it in its dead zone, where the error it raised would bury the one that got there.
     */
    let ending = last;
    /** Declared out here so the `finally` can take it off again however the run ends. */
    let onVisibility: (() => void) | null = null;
    const giveUpSlot = () => {
      // Not this section's to give up. The sequence releases it once, in its own `finally`, so a
      // section that throws half way still frees the slot without the next one finding it gone.
      if (!ending || released) return;
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
      /*
       * What the whole sequence was asked for, which is not what this section was asked for. The
       * paste and the estimate are facts about the run, so a sectioned run must not record the
       * last section's numbers as if they were the run's.
       */
      const askedInRun = part?.asked ?? ids.length;
      track(() => {
        tracker?.beginSegment(session.startedAt, ids);
        tracker?.config({
          concurrency: CONCURRENCY,
          maxConcurrency: MAX_CONCURRENCY,
          batchSize: BATCH_SIZE,
          saveEvery: saveEvery(heldRef.current.state.games.length),
        });
        if (part === undefined || part.first) {
          tracker?.eta(estimatedMinutes(askedInRun));
          tracker?.paste({
            lines: parsed.lines,
            parsed: parsed.entries.length,
            skipped: parsed.skipped.length,
            skippedSamples: parsed.skipped,
            tooYoung:
              parsed.tooYoung +
              parsed.notBaseball +
              parsed.highSchool +
              parsed.notYouth +
              parsed.otherSeason,
            alreadyHere: split.seen,
            asked: askedInRun,
          });
        }
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
      // Rows thrown out for being dated ahead of today stay thrown out; see `deletedGames.ts`.
      const importer = createGcImporter(heldRef.current.state, {
        deleted: loadDeletedGames(),
        droppedClubs: loadDroppedClubs(),
        tooYoung: loadTooYoungClubs(),
        // The ages somebody typed on the review card. This is the only call site there is, so
        // leaving it out did not weaken the feature, it turned it off: the answer was stored, the
        // row vanished from the card because the queue hides a team once it is named, and the
        // next pull read an empty map and refused the team for having no age all over again.
        namedAges,
        // The run's own seasons, not the panel's: a resumed run files what it was started for.
        ...(progress.seasonYears ? { seasonYears: new Set(progress.seasonYears) } : {}),
      });
      progressRef.current = progress;
      // The summary is the whole run's, so a section adds to what the sections before it found.
      if (part === undefined || part.first) outcomesRef.current = [];
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
      setPhase({ kind: "pulling", session, section: part?.section ?? null });
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
                  poolTeams: heldRef.current.state.teams.length,
                  poolGames: heldRef.current.state.games.length,
                  poolPages: heldRef.current.state.ageGroups.length,
                  ms: msNow() - from,
                  ok,
                },
                batch
              );
              // Written beside the pool rather than inside it, so a record that will not fit can
              // never be the thing that stops the run it is recording.
              const current = tracker?.log();
              if (current) {
                if (tracker) persistLog(tracker, current);
                setLive(
                  liveSummary(current, progressRef.current?.settled.length ?? 0, msNow() - runFrom)
                );
              }
            });

          if (!persist("Stopping, so nothing is fetched that cannot be kept.")) {
            sample(false);
            endReason = "save-refused";
            controller.abort();
            return;
          }
          if (!(await flushPoolWrites())) {
            showToast("Could not save the pull — stopping so nothing is lost.", { tone: "error" });
            sample(false);
            endReason = "save-refused";
            controller.abort();
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
        maxConcurrency: MAX_CONCURRENCY,
        // Merged into the run's config, so the report says what the pool grew to.
        onConcurrency: (workers) => track(() => tracker?.config({ workers })),
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
             * What the user's own list knows and GameChanger's payload does not: the roster size
             * as their export recorded it, and the leagues the team plays in — the API has no
             * route from a team to its leagues at all. Attached here, where both halves are in
             * hand, so the link the import records carries them and the age a league names can
             * file a team GameChanger left ageless.
             */
            /*
             * The league the list says they play in, and failing that the organization they sit
             * under. The organization is the weaker of the two — a crawl types every organization
             * the same way, so a tournament and a league are one word apart — which is why
             * `ageFromOrgName` refuses event-sounding names and spans, and why it only answers
             * where the league said nothing.
             */
            /*
             * And failing both, the Organizations file: the age the organizations it put this team
             * under agree on. It reaches a team the list does not describe at all — one the rota
             * is asking about again because it is waiting on an age — which is most of the point.
             */
            const leagueAge =
              ageFromLeagueNames(entry?.leagues) ??
              ageFromOrgName(entry?.org?.name) ??
              orgAges.get(teamId);
            const listed =
              entry?.staff?.length || entry?.playerCount !== undefined || leagueAge !== undefined
                ? {
                    ...(entry?.staff?.length ? { staff: entry.staff } : {}),
                    ...(entry?.playerCount === undefined ? {} : { playerCount: entry.playerCount }),
                    ...(leagueAge === undefined ? {} : { ageLevel: leagueAge }),
                  }
                : undefined;
            const schedule = listed ? { ...result.schedule, listed } : result.schedule;
            const outcome = importer.add(schedule);
            outcomesRef.current.push(outcome);
            track(() => tracker?.imported(outcome));
            heldRef.current = holdingNow(heldRef.current, importer.state);
            if (entry && checkPulledTeam(entry, result.schedule.profile)) {
              pulledRef.set(teamId, { entry, profile: result.schedule.profile });
            }
          } else {
            pendingFailures.set(teamId, { reason: result.reason, message: result.message });
          }
          unsaved.push(teamId);
          if (unsaved.length >= saveEvery(heldRef.current.state.games.length)) void flush();
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
      // A section that finished and is not the last one ends here. Everything below is the run's
      // ending, and a run of six sections has one.
      if (!ending && endReason === "finished") return endReason;
      ending = true;
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
      /*
       * Back to the whole pool for the ending. A sectioned run has been holding one age page at a
       * time, so `heldRef` is whatever the last section held — and the tidy names stand-ins from
       * the other side's schedule, folds clubs holding several ids and collapses the rows those
       * folds make, none of which it can do without seeing every side. Read back from the store
       * rather than accumulated across the sections, because accumulating it is the thing the
       * sections exist not to do: held all at once it is the 332 MB that was running the tab out
       * of memory, and the fold's index — 253 MB of that — is out of scope by the time this runs.
       */
      if (part !== undefined) {
        heldRef.current = holdingWholePool({
          ...heldRef.current.state,
          games: loadScoutGames(),
        });
      }
      const outcome = await tidyInWorker(heldRef.current.state);
      /*
       * Refused only if something else claimed the pool in the moment between this run giving it up
       * and the tidy asking for it. Nothing is lost by skipping it: the stamp is left alone, so the
       * pool still reads as untidied and the next time the app opens on it, it is tidied then.
       */
      const tidy: PoolTidy | null = outcome ? { ...outcome.tidy, state: outcome.state } : null;
      if (tidy) {
        // Stamped before the save lands, so the page does not read the tidied pool as untidied.
        saveTidyStamp(poolSignature(tidy.state));
        // Asked of the step list rather than summed here, where three of the eleven counts were
        // missing and a pass that only deleted teams stamped a pool it did not save.
        if (tidyChangedAnything(tidy)) {
          heldRef.current = holdingNow(heldRef.current, tidy.state);
          if (persist()) await flushPoolWrites();
        }
      }

      /*
       * Teams nobody could age go on the list; teams that were filed come off it. Done for every
       * run, not just the catch-up one, because any run can answer the question for a team it
       * fetched: the opponent names that settle an age are read off that team's own schedule, so
       * whichever run happens to pull it is the run that can answer it.
       */
      const nextAgeless = updateAgeUnknown(loadAgeUnknown(), outcomesRef.current, nowIso());
      setAgeless(nextAgeless);
      /*
       * Checked, because this write is the one that can fail quietly. Without IndexedDB the whole
       * pool lives in localStorage, where a list this size does not fit: the write throws, the
       * store catches it and answers false, and every answer the run learned is gone with nothing
       * said. `onPoolWriteError` does not cover it — that fires on the IndexedDB path only.
       */
      if (!saveAgeUnknown(nextAgeless)) {
        showToast("The list of teams waiting on an age could not be saved — storage is full.", {
          tone: "error",
        });
      }

      /*
       * And the ones GameChanger says are too young to rank. Remembered so the next export does
       * not spend two requests each rediscovering it: a nationwide list carries thousands of them,
       * the paste can only skip the rows that name an age themselves, and every other one is a
       * fetch whose answer never changes. Safe to keep for good — a GameChanger id is minted per
       * team per season, so this cannot hold a club down as it ages up.
       */
      const learnedTooYoung = tooYoungFromOutcomes(outcomesRef.current);
      if (learnedTooYoung.length > 0) {
        const nextTooYoung = rememberTooYoung(loadTooYoungClubs(), learnedTooYoung);
        setTooYoung(nextTooYoung);
        saveTooYoungClubs(nextTooYoung);
      }

      /*
       * And the ones whose whole schedule was results on days that have not happened. Thrown out
       * like a club somebody deleted by hand, so the refusal outlasts the dates that gave it away.
       */
      const invented = inventedFromOutcomes(outcomesRef.current);
      if (invented.length > 0) onInvented(invented);

      track(() => {
        // `outcome.tidy` and not `tidy`: the latter carries the whole tidied pool, and writing that
        // into the record would put a second copy of every game in storage.
        if (outcome) tracker?.tidied(outcome.tidy);
        tracker?.finish(nowIso(), endReason);
        if (tracker) persistLog(tracker, tracker.log());
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
      setPairings(
        proposeSeasonPairings(
          heldRef.current.state.teams,
          heldRef.current.state.games,
          loadKeptApart()
        )
      );
      setApproved(new Set());
      setOpenPair(null);
      setPhase({ kind: "review", endReason });
      syncStats();
      return endReason;
    } finally {
      giveUpSlot();
      if (onVisibility) document.removeEventListener("visibilitychange", onVisibility);
    }
  };

  /**
   * Runs a pull as a sequence of sections, one age page at a time.
   *
   * This is the whole point of the exercise. A fold over the whole pool was measured at 332 MB on
   * forty thousand teams and two hundred thousand games — 79 MB of pool and 253 MB of the index
   * the fold builds over it — and that is what has been running the tab out of memory an hour into
   * a nationwide refresh. One age page of six is 99 MB, and the roster, which every section needs
   * in full so that an opponent can be matched at all, is only 25 MB of it. The games are the rest
   * and they scale with how many are held, so holding a sixth of them holds a third of the memory.
   *
   * What it costs is written down in `pullSections` and `saveScoutGamesForGroups`: a section
   * cannot see another page's games while it folds, matching is keyed on the squad year rather
   * than the page, and so one cross-age tournament fixture can arrive twice during a run. The
   * end-of-run tidy runs over the whole pool and collapses them, so it is a state the pool passes
   * through rather than one it is left in.
   */
  const runSectioned = async (ids: string[], progress: GcPullProgress): Promise<void> => {
    const sections = pullSections(ids, pool.teams, pool.ageGroups);
    /*
     * One section is the run. Sectioning a single page would hold exactly what an unsectioned run
     * holds and pay a second fold to arrive there, and — because nothing else is being refreshed
     * alongside it — it would take the duplicate-fixture trade for nothing in return.
     */
    if (sections.length <= 1) {
      await run(ids, progress);
      return;
    }

    /*
     * Claimed here rather than in `run`, and held across every section. Six claims would be six
     * moments where a tidy could take the slot between two sections and leave the pool half
     * refreshed, with the cursor saying the rest was done.
     */
    const session = beginPull(nowIso());
    if (!session) {
      const holder = livePull();
      showToast(
        holder?.kind === "tidy"
          ? "The pool is being tidied. That takes a moment — try again when it finishes."
          : "A pull is already running. Reopen Import to watch it, or stop it there.",
        { tone: "error" }
      );
      return;
    }

    // As in `run`: the slot is held from here, so this is the last moment the page's copy is the
    // newest there is, and every section below carries forward from it.
    heldRef.current = holdingNow(heldRef.current, livePoolRef.current);

    try {
      for (const [index, section] of sections.entries()) {
        /*
         * What this section folds over: every team, and only this page's games. The teams have to
         * be whole — an opponent that is not in the roster is a stand-in, and a section that could
         * not see the rest of the country would invent one for half its schedule — and they are
         * nearly free. The games are the cost, so they are this page's and nothing else's.
         */
        /*
         * The pool and its label in one move, because they are one fact: a section that owns pages
         * is authoritative for them and replaces them, and the section of ids nobody has pulled
         * before owns none — it never read a page, so it cannot say what one ought to contain, and
         * can only add. `holdingPages` is where that choice lives now.
         */
        heldRef.current = holdingPages(
          {
            ageGroups: heldRef.current.state.ageGroups,
            teams: heldRef.current.state.teams,
            games: loadScoutGamesForPages(section.ageGroupIds),
          },
          section.ageGroupIds
        );
        // The cursor the sections before it advanced, not the one the run started from: passing
        // the original back would throw away what they settled and have a resume fetch it again.
        const reason = await run(section.teamIds, progressRef.current ?? progress, {
          session,
          first: index === 0,
          last: index === sections.length - 1,
          asked: ids.length,
          section: { index: index + 1, of: sections.length, label: section.label },
        });
        // Stopped, refused or given up. That section did the run's ending on the way out.
        if (reason !== "finished") break;
      }
    } finally {
      heldRef.current = holdingWholePool(heldRef.current.state);
      setPhase((current) => (current.kind === "pulling" ? { ...current, section: null } : current));
      // `endPull` ignores a session that is no longer the live one, so the section that ended the
      // run having already released it costs nothing; a section that threw is why this is here.
      endPull(session);
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
    void runSectioned(remainingIds(progress), progress);
  };

  /**
   * The catch-up day's other job: ask again about the teams nobody could age.
   *
   * The same route they came in on, because that is the only thing that can answer the question —
   * GameChanger may have filled its field in, the club may have renamed the squad, or the team may
   * have played more games against opponents who do name an age. Pulling other clubs cannot help:
   * the names are read off this team's own schedule. Not a rota run, so nothing is marked
   * refreshed when it finishes.
   */
  const runAgeless = () => {
    if (due.agelessIds.length === 0) return;
    const progress = startPull(due.agelessIds, nowIso(), null);
    onSaveProgress(progress);
    dueLevelsRef.current = [];
    void runSectioned(remainingIds(progress), progress);
  };

  const runRefresh = (target: DueRefresh) => {
    if (target.teamIds.length === 0) return;
    const progress = startPull(target.teamIds, nowIso(), null);
    onSaveProgress(progress);
    dueLevelsRef.current = target.ageLevels;
    void runSectioned(remainingIds(progress), progress);
  };

  const runDue = () => runRefresh(due);
  /** Everything the cadence covers, whether or not it has already been done today. */
  const runEverything = () => runRefresh(everythingDue());

  /*
   * How many a re-run would cover, worked out only once nothing is due — which is the only time
   * the button that shows it is on screen. While there is work outstanding this stays zero and
   * the walk is not paid at all.
   */
  const forcedCount = useMemo(
    () => (due.teamIds.length === 0 ? everythingDue().teamIds.length : 0),
    [due.teamIds.length, everythingDue]
  );

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
    heldRef.current = holdingNow(heldRef.current, tidy.state);
    if (persist()) {
      await flushPoolWrites();
      showToast(lines.join(" "), { tone: "success" });
    }
  };

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

  /**
   * The record storage kept of the last run, read once this panel is open.
   *
   * On demand rather than with the pool: a row per team in a nationwide pull is tens of thousands
   * of rows, and every page was holding them for the sake of the download buttons below. It is
   * asked for here, when the panel that has those buttons mounts, and nowhere else.
   */
  const [storedLog, setStoredLog] = useState<PullRunLog | null>(null);
  useEffect(() => {
    let wanted = true;
    void loadPullLog().then((log) => {
      if (wanted) setStoredLog(log);
    });
    return () => {
      wanted = false;
    };
  }, []);

  /**
   * The run's own record, live or the last one finished, falling back to what storage kept.
   *
   * Three sources because the record has to be downloadable in all three situations: while the run
   * is going, after it has ended in this panel, and after a reload that lost every component but
   * not the file.
   */
  const runLog = (): PullRunLog | null => livePullTracker()?.log() ?? lastPullLog() ?? storedLog;
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
    // Through the session, and only through it: the panel used to keep a second copy of the same
    // controller, which said nothing the session did not and went stale the moment a run ended.
    stopLivePull();
    showToast("Stopping after the requests already in flight.", { tone: "info" });
  };

  const pairKey = (pairing: GcSeasonPairing) => `${pairing.fromTeamId}>${pairing.toTeamId}`;
  /**
   * The pairings the search matches, and how many of them are drawn.
   *
   * A nationwide pull offers four hundred of these, and the list used to stop at a hundred and say
   * the rest could be done from each team's own panel — three hundred panels, one at a time, for a
   * decision that is the same decision every time. Worse, an unpaired squad is not a cosmetic
   * problem: a club whose fall and spring ids were never joined is two teams with no game between
   * them, and a rating cannot carry across a winter it cannot see.
   *
   * So all of them are reachable. The first hundred are drawn for speed, "Show all" draws the
   * rest, and the search narrows by name, state or season for when the answer is only wanted for
   * some of them.
   */
  /**
   * Says the two are two clubs, for good. Recorded against the GameChanger ids, which is what the
   * next pull brings back unchanged; the same pair is never offered here or on the pool health
   * card again. See `keptApart.ts`.
   */
  const keepApart = (pairing: GcSeasonPairing) => {
    saveKeptApart(apartAfter(loadKeptApart(), pairing.fromGcId, pairing.toGcId));
    const key = pairKey(pairing);
    setPairings((current) => current.filter((entry) => pairKey(entry) !== key));
    setApproved((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    setOpenPair((current) => (current?.key === key ? null : current));
  };

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
            <p className="mt-1 text-xs text-slate-500">
              {describeCadence(cadence)} Nothing happens on its own — a browser cannot run while it
              is closed — so this is here whenever you next open it.
            </p>
            <fieldset className="mt-3">
              <legend className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
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
              <ul className="mt-2 space-y-0.5 text-xs text-slate-500">
                {describeRotation().map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
            {due.teamIds.length > 0 && (
              <>
                <button type="button" onClick={runDue} className={`${button.primary} mt-3`}>
                  {cadence === "daily"
                    ? `Refresh all ${due.teamIds.length.toLocaleString()} teams`
                    : `Refresh today's ${due.ageLevels.map((level) => `${level}U`).join(" and ")}`}
                </button>
                <p className="mt-1 text-xs text-slate-500">
                  About {estimatedMinutes(due.teamIds.length)} minute(s) of requests, and the whole
                  pool is written back several times along the way, which is the slower half.
                </p>
              </>
            )}
            {due.teamIds.length === 0 && forcedCount > 0 && (
              <>
                <button type="button" onClick={runEverything} className={`${button.ghost} mt-3`}>
                  Refresh all {forcedCount.toLocaleString()} teams again
                </button>
                <p className="mt-1 text-xs text-slate-500">
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
                <p className="mt-1 text-xs text-slate-500" id="gc-ageless-why">
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
                  <span className={pill("neutral")}>
                    {parsed.notBaseball} wiffle ball or blitzball, skipped
                  </span>
                )}
                {parsed.notYouth > 0 && (
                  <span className={pill("neutral")}>
                    {parsed.notYouth} adult or college, skipped
                  </span>
                )}
                {parsed.highSchool > 0 && (
                  <span className={pill("neutral")}>{parsed.highSchool} high school, skipped</span>
                )}
                {parsed.otherSeason > 0 && (
                  <span className={pill("neutral")}>
                    {parsed.otherSeason} from other seasons, skipped
                  </span>
                )}
                {split.fresh.length > 200 && (
                  <span>About {estimatedMinutes(split.fresh.length)} minute(s) of requests.</span>
                )}
              </>
            )}
          </div>

          {text.trim() !== "" && (
            <fieldset className="mt-3">
              <legend className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
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
                        <span className="font-normal text-slate-500">
                          ({count.toLocaleString()} team{count === 1 ? "" : "s"})
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
              <p className="mt-1 text-xs text-slate-500" data-testid="gc-season-note">
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
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onerror = () => showToast("Could not read that file.", { tone: "error" });
                  reader.onload = () => readOrgFile(String(reader.result ?? ""));
                  reader.readAsText(file);
                }}
              />
            </label>
            <span className="text-xs text-slate-500" data-testid="gc-org-membership">
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
                (split.fresh.length === 0 && split.refresh.length === 0) || seasonYears.length === 0
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
              <span className="self-center text-xs text-slate-500">
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
            {stats.done} of {stats.total} pulled
            {stats.failed ? `, ${stats.failed} failed` : ""}.
          </p>
          {section && (
            <p className="mt-1 text-xs text-slate-500">
              Age group {section.index} of {section.of}: <strong>{section.label}</strong>. A run
              this size is done a page at a time so the tab is never holding the whole pool — the
              count above is the whole run, and it carries on across them.
            </p>
          )}
          <p className="mt-1 text-xs text-slate-500">
            Saved every {SAVE_EVERY_MIN}–{SAVE_EVERY_MAX} teams, less often as the pool grows. You
            can stop, close this, or leave the tab — it picks up where it left off.
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
                  Tick all {matching.length}
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
                            <span className="text-slate-500">
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
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                  <span>
                    Drawing {shown.length} of {matching.length}
                    {pairSearch.trim() ? ` that match, out of ${pairings.length}` : ""}.
                  </span>
                  <button
                    type="button"
                    className={button.ghost}
                    onClick={() => setPairLimit(matching.length)}
                  >
                    Show all {matching.length}
                  </button>
                </div>
              )}
              {matching.length === 0 && (
                <p className="mt-2 text-xs text-slate-500">
                  None of the {pairings.length} match that. Clear the search to see them all.
                </p>
              )}
              {approved.size > 0 && (
                <p className="mt-2 text-xs text-slate-500">
                  {approved.size} ticked
                  {approved.size > shown.length ? ", including some not drawn here" : ""}.
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
