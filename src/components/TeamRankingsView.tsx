import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { lastBackupTakenAt } from "../lib/lastBackup";
import { myTeamGlance } from "../lib/myTeamGlance";
import { movementOf } from "../lib/rankMovement";
import { compareClubs } from "../lib/clubCompare";
import { createAgeGroupId } from "../lib/teamRankings/seasons";
import { filedByNameOn } from "../lib/notThisTeam";
import { scoutAsked, scoutTaken } from "../lib/scoutRequest";
import {
  ageGroupChain,
  ageGroupLevel,
  ageGroupYear,
  buildScoutingReport,
  EMPTY_SCOUTING_REPORT,
  buildUpcomingSchedule,
  countedInWindow,
  rankingPoolGroupIds,
  segmentLabel,
  seasonYearOptions,
  filterRankingsByState,
  renameScoutTeam,
  statesInUse,
  teamNameSuggestions,
  type AgeGroup,
  type AgeGroupSeason,
  type ScoutGame,
  type ScoutRankingRow,
  type ScoutTeam,
} from "../lib/teamRankings";
import { buildTeamRankExplanationRequest } from "../lib/teamRankingsSummaryClient";
import {
  describeTidy,
  poolSignature,
  poolSignatureOf,
  stampFromNewerRules,
  latestImportedAt,
} from "../lib/tidyStamp";
import type { GcImportState, PoolTidy } from "../lib/gameChangerImport";
import { remainingIds } from "../lib/gameChangerPull";
import { deriveAllKnown, gamesOnPages, leagueTeamIdsOn } from "../lib/live/allKnown";
import { countedByHalf, segmentWorthShowing } from "../lib/teamRankings/halves";
import {
  placesOf,
  unknownStateCountOf,
  unrankedLevelNoteFor,
} from "../lib/teamRankings/boardDisplay";
import type { RankingsHandover } from "../lib/live/liveBoard";
import type { PoolCommand } from "../lib/live/commands";
import { changeBetween, poolParts } from "../lib/live/commands";
import {
  runPoolCommand,
  writtenAnswers,
  writtenAutoRemoved,
  writtenGroups,
  writtenNamedAges,
  writtenTeams,
  type CommandRun,
} from "../lib/live/runPoolCommand";
import { readStoredSeason, type SeasonMeta } from "../lib/storage";
import {
  clearPullProgress,
  loadAgeGroups,
  loadArchiveIndex,
  loadPullProgress,
  loadRefreshLog,
  loadRetiredIds,
  loadScoutGames,
  loadScoutGamesForYear,
  loadScoutTeams,
  loadTidyStamp,
  onPoolChangedElsewhere,
  savePullProgress,
  saveRefreshLog,
  saveTidyStamp,
  storedGamesByYear,
  loadDroppedClubs,
  loadNamedAges,
  loadAutoRemoved,
} from "../lib/teamRankingsStorage";
import { persistPool } from "../lib/poolPersist";
import type { DeletedClubs } from "../lib/deletedGames";
import type { NamedAges } from "../lib/namedAges";
import { type AutoRemovals } from "../lib/autoRemoved";
import { lopsidedDrops } from "../lib/lopsidedDrops";
import { clubAgeOf } from "../lib/teamRankings/clubAge";
import type { RankingsSection } from "../lib/rankingsRoute";
import { type ArchiveEntry } from "../lib/teamRankingsArchive";
import { isPoolBusy, isPullLive, watchPull } from "../lib/pullSession";
import { usePoolTidy } from "../hooks/usePoolTidy";
import { ErrorBoundary } from "./ErrorBoundary";
import { card } from "../styles/tokens";
import { ClubSheet } from "./teamRankings/ClubSheet";
import { leftClubSheet, markClubSheet } from "../lib/clubSheetHistory";
import { useWatchList } from "../lib/watchList";
import { clubLookupOf } from "../lib/teamRankings/leagueBridge";
import { keptGcIds } from "../lib/teamRankings/rememberedClub";
import { EMPTY_ADD_GAME_DRAFT, type AddGameDraft } from "./teamRankings/addGameDraft";
import type { NamedChecker } from "./ScheduleImportPanel";
import { checkNamedGames } from "../lib/teamRankings/namedGames";
import { readLastClosedLevel } from "../lib/live/closedLevelRecord";
import { liveReader } from "../lib/cloud/cloudSession";
import { gamesWindowFor, listedTeamNames, loggedGamesOn } from "../lib/teamRankings/gamesWindow";
import {
  NATIONAL_TOP,
  RankingsSection as RankingsBoards,
  STATE_TOP,
} from "./teamRankings/RankingsSection";
import { todayIsoDay } from "../lib/date";
import { RankingsHeader } from "./teamRankings/RankingsHeader";
import { SECTION_PANEL_ID, sectionTabId } from "./teamRankings/SectionNav";
import {
  archiveSection,
  gamesSection,
  importSection,
  LIKELY_NEXT_SECTION,
  prefetchSection,
  resetSection,
  scoutingSection,
  setupSection,
  tournamentPanel,
} from "./teamRankings/sections";
import type { ViewChunk } from "./viewChunk";
import { LoadingPanel } from "./LoadingPanel";
import { useLeagueSummary } from "../hooks/useLeagueSummary";
import { coachesOf } from "../lib/gcStaff";
import { useRankingsPages } from "../hooks/useRankingsPages";
import { useRankingsWorker } from "../hooks/useRankingsWorker";
import { useStateTop } from "../hooks/useStateTop";
import type { ToastTone } from "../hooks/useToast";
import { useTeamEdits } from "../hooks/useTeamEdits";
import { usePoolAnswers } from "../hooks/usePoolAnswers";
import { useFindTeam } from "../hooks/useFindTeam";
import { usePoolGameEntry } from "../hooks/usePoolGameEntry";
import { useStartingOver } from "../hooks/useStartingOver";
import { useWhatIf } from "../hooks/useWhatIf";
import { useLeagueClubRanks } from "../hooks/useLeagueClubRanks";
import { useRankingsWeek } from "../hooks/useRankingsWeek";

/**
 * A club's panel, fetched as a club is first opened (`ClubSheet`), as the live board's is: opening
 * Team Rankings fetched it with the page whether or not a club was opened.
 */
const TeamDetailPanel = lazy(() =>
  import("./TeamDetailPanel").then((module) => ({ default: module.TeamDetailPanel }))
);

/**
 * A section whose code is fetched as it is first opened, or a little before (`sections.ts`), drawn
 * in a boundary of its own: a line saying it is loading stands in its place meanwhile, and nothing
 * else on the page is swapped for it, nor is the scouting report while the tournament panel below
 * it loads, which says nothing as it does. A load that fails is the Try again of the boundary
 * around it: the section's, or for the tournament panel, its own.
 */
const inPlace = <P extends object>({ View }: ViewChunk<P>, loading: RankingsSection | null) => {
  const Section = (props: P) => (
    <Suspense fallback={loading === null ? null : <LoadingPanel area={sectionLoading(loading)} />}>
      <View {...props} />
    </Suspense>
  );
  Section.displayName = `InPlace(${View.displayName ?? "Section"})`;
  return Section;
};
const GamesSection = inPlace(gamesSection, "games");
const GameChangerImportPanel = inPlace(importSection, "import");
const ScoutingSection = inPlace(scoutingSection, "scouting");
const TournamentPanel = inPlace(tournamentPanel, null);
const ArchiveSection = inPlace(archiveSection, "archive");
const SetupSection = inPlace(setupSection, "setup");

/** A section's tab pointed at or focused: its code starts loading before it is pressed. */
const previewSection = (section: RankingsSection) => void prefetchSection(section);

/**
 * For the live board, which fetches the section it hands over on with this page's code
 * (`teamRankingsChunk.ts`).
 */
export { prefetchSection };

type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

/**
 * The areas a command can open, in the order the tabs show them. Kept beside the palette wiring
 * rather than imported from the nav, because the nav's list is what it draws and this is what can
 * be asked for by name; they happen to agree today and a test says so.
 */

type TeamRankingsViewProps = {
  seasons: SeasonMeta[];
  showToast: (
    message: string,
    options?: {
      tone?: ToastTone;
      actionLabel?: string;
      onAction?: () => void;
      durationMs?: number;
    }
  ) => void;
  requestConfirmation: (options: ConfirmOptions) => Promise<boolean>;
  /** Called after anything here is saved, so the league side knows to re-read it. */
  onDataChange?: () => void;
  /** Where the live board left off, when this page takes over from it (`LiveTeamRankings`). */
  handover?: RankingsHandover;
};

/**
 * Team Rankings, one area at a time.
 *
 * Everything used to render on a single scroll — the tables, the add-a-game form, the GameChanger
 * pull, the scouting report and the age-group editor — which made the page long enough that the
 * thing you came for was rarely the thing on screen. Each area now lives in its own file under
 * `teamRankings/` and is reached through `?section=`, while this file keeps the state they all
 * read from and `runCommand`, through which it is written. Most of the handlers that write it are
 * made in hooks this file calls where their code was (`useTeamEdits`, `usePoolAnswers`,
 * `useFindTeam`, `usePoolGameEntry`, `useStartingOver`).
 *
 * The season-year picker and the age tabs stay above every section, because they scope all of them
 * alike: a section is a view of one age group in one year, never of the pool at large.
 */
/**
 * The largest pool the tidy may work through on the main thread without being asked to.
 *
 * There used to be a limit like this on the automatic tidy and it was removed when the work moved
 * into a worker, on the reasoning that in a worker there is nothing to freeze. That reasoning is
 * sound and the limit is not coming back for pools that have one — it is back for pools that do
 * not. When a worker cannot be started, the same pass runs here instead, and on a nationwide pool
 * that is twenty or thirty seconds of frozen tab: long enough for the browser to reload the page,
 * which cancels the run before it can record that it happened, so the next load starts it again
 * and it never finishes. Twenty thousand games is the number the old limit used, and a pass over
 * that many is a blink rather than a hang.
 *
 * Above it, with no worker, the pool is left untidied until someone presses the button in Setup.
 * That is the right way round: untidied is cosmetic, and an app that reloads every minute is not.
 */
const AUTOMATIC_INLINE_GAME_LIMIT = 20_000;

/** What a section is called when a boundary has to say which one could not be drawn. */
/** Referentially stable, so nothing memoised on "no games" re-runs every render. */
const NO_STORED_GAMES: ScoutGame[] = [];

/**
 * What to say when a whole-pool save turned out not to hold the whole pool.
 *
 * Storage left those years alone rather than emptying them, so nothing is lost — but the save did
 * not do what it was asked, and the pool on screen is no longer what is stored. That is worth an
 * error rather than a quiet note: it can only happen through a bug, and it is exactly the bug
 * that once deleted a season without saying a word.
 */
const sparedYears = (years: (number | undefined)[]): string =>
  `Saved, but ${years.map((year) => year ?? "the undated games").join(", ")} ${
    years.length === 1 ? "was" : "were"
  } left as stored — that save did not hold ${years.length === 1 ? "it" : "them"}. Reload before changing anything else.`;

/**
 * The last weekly re-measure of where a rating starts, read through this browser's member's reader
 * of `live/` (`readLastClosedLevel`): none for a browser that keeps no cloud copy, which never
 * loads Firebase to find that out. One function for the life of the page, so the card reads once.
 */
const lastWeeklyFromCloud = () => readLastClosedLevel(liveReader);

const sectionLabel = (section: RankingsSection): string =>
  ({
    rankings: "The rankings",
    games: "The games list",
    import: "The GameChanger import",
    scouting: "The scouting report",
    archive: "The archive",
    setup: "Setup",
  })[section];

/** What a section is called while its code loads, in a sentence ("Loading the archive…"). */
const sectionLoading = (section: RankingsSection): string =>
  sectionLabel(section).replace(/^The /, "the ");

export function TeamRankingsView({
  seasons,
  showToast,
  requestConfirmation,
  onDataChange,
  handover,
}: TeamRankingsViewProps) {
  const [ageGroups, setAgeGroups] = useState<AgeGroup[]>(() => loadAgeGroups());
  /*
   * Today, as a plain ISO day, read once for the render.
   *
   * Used to decide which half of the year a page opens on and to work out which fixtures are still
   * ahead. Read here rather than in each place that wants it so both answers come from the same
   * instant — a render where the schedule and the board disagreed about what day it is would be a
   * genuinely confusing thing to debug.
   *
   * The reader's own day, not the UTC one. `toISOString().slice(0, 10)` is tomorrow's date for the
   * last hours of every evening in the Americas — 4 of 24 hours in New York, 5 in Chicago, 6 in
   * Denver, 7 in Los Angeles — and it is always the later of the two, so a game being played this
   * evening dropped off "Next up" while it was being played. It also disagreed with
   * `scoutRatingGames`, which has always defaulted to the local day, so the board and the schedule
   * were reading different calendars for those hours.
   */
  const today = todayIsoDay();
  /*
   * One `Date` per day rather than one per render. The review card memoises the whole ageless
   * list on this, and a fresh object every render threw that away — so a list of thirty thousand
   * was mapped and sorted again on every keystroke anywhere in this view.
   */
  const agelessNow = useMemo(() => new Date(today), [today]);
  const {
    section,
    selectedAgeGroupId,
    selectedYear,
    groupsInYear,
    yearChoices,
    routeSegment,
    calendarSegment,
    openPage,
    openSection,
    openSegment,
    openYear,
    pickPage,
    defaultAge,
    setDefaultAge,
  } = useRankingsPages(ageGroups, today);
  // The section most often opened next, fetched once this one is drawn and the page is idle.
  useEffect(() => {
    const next = LIKELY_NEXT_SECTION[section];
    if (!next) return;
    const timer = window.setTimeout(() => void prefetchSection(next), 1_500);
    return () => window.clearTimeout(timer);
  }, [section]);

  const [scoutTeams, setScoutTeams] = useState<ScoutTeam[]>(() => loadScoutTeams());
  /**
   * Bumped whenever this view, or another tab, writes the games. Storage is not reactive, and the
   * games are read from it below rather than held here — one year at a time — so this is the
   * signal that a read is due.
   */
  const [poolRevision, setPoolRevision] = useState(0);
  const bumpPool = useCallback(() => setPoolRevision((revision) => revision + 1), []);
  const pullLive = useSyncExternalStore(watchPull, isPullLive, () => false);
  /**
   * The revision the expensive reads follow, which stands still while a pull owns the pool.
   *
   * A pull saves every few hundred teams and can run for the better part of an hour. Every one of
   * those saves bumped `poolRevision`, and every bump made this view decode the pool again — the
   * year on screen, and on the Import section the whole pool, every year of it. Measured on a
   * synthetic pool of two hundred thousand games that is about 110 ms of decode on top of the
   * 250 ms of encode the save itself costs, on the one thread that also has to draw the page,
   * several hundred times over a full refresh. The Import section's copy is pure waste besides:
   * the GameChanger panel seeds itself from that prop once and never reads it again, so the whole
   * pool was being decoded for nobody.
   *
   * While a run is going the view therefore shows the pool as it stood when the run started —
   * which is what it showed between saves anyway — and the panel's own progress is what moves.
   * The moment the run releases the pool this catches up, once.
   */
  const [pullStartedOn, setPullStartedOn] = useState<number | null>(null);
  /*
   * Only the revision a running pull started on is kept, set once as the pull starts and cleared
   * as it ends; otherwise the revision is the pool's own, read as it is. Following it with a set
   * during render, as this once did, threw that render away and ran the view again, and where the
   * teams and the revision change together (every tidy, and every pull's last save) the first pass
   * had already rebuilt everything hanging off the teams against the old games: the whole view,
   * twice. On the 114,500-team pool of 29 September 2026 the freeze after a tidy on open lands
   * went from 6.85 s to 3.74 s without it. The two sets left change nothing a render reads, so the
   * pass either repeats finds every memo as it was.
   */
  if (pullLive && pullStartedOn === null) setPullStartedOn(poolRevision);
  if (!pullLive && pullStartedOn !== null) setPullStartedOn(null);
  const settledRevision = pullLive ? (pullStartedOn ?? poolRevision) : poolRevision;
  /**
   * The season on screen's games, and only those.
   *
   * The pool used to be held whole, every year of it, for a view that shows one year at a time
   * and rates each year on its own games. The games are stored a year at a time now, and this is
   * the one year decoded and kept; switching years decodes the other and lets this one go. What
   * needs the whole pool — a tidy, a pull, a backup, an archive, merging or renaming a club —
   * reads it from storage at the moment it runs, and holds it only that long.
   */
  const scoutGames = useMemo(() => {
    void settledRevision;
    return loadScoutGamesForYear(selectedYear);
  }, [selectedYear, settledRevision]);
  /** What each stored year holds, counted off the store without decoding any of it. */
  const storedYears = useMemo(() => {
    void poolRevision;
    return storedGamesByYear();
  }, [poolRevision]);
  const storedGameCount = useMemo(
    () => storedYears.reduce((sum, entry) => sum + entry.games, 0),
    [storedYears]
  );
  /**
   * The whole pool, every year, while an area that works on all of it is open — and not a moment
   * longer. Two areas do: Setup, for the health card, and Import, for the GameChanger panel.
   *
   * Import belongs on that list and was missing from it, which was silent data loss rather than a
   * slow render. The panel seeds itself from this once and, when a pull saves, writes back what it
   * holds through `saveScoutGames`, which replaces every year and drops any it was not given. With
   * an empty array it therefore folded a pull into nothing and saved that over the lot, deleting
   * every year the pull did not itself refetch. `poolWrite.test.tsx` is the guard.
   */
  const wholePoolGames = useMemo(() => {
    void settledRevision;
    return section === "setup" || section === "import" ? loadScoutGames() : NO_STORED_GAMES;
  }, [section, settledRevision]);
  /** When the pool was last backed up from this browser; re-read after a download from here. */
  const [poolBackupAt, setPoolBackupAt] = useState(() => lastBackupTakenAt("pool"));
  /** The newest GameChanger fetch in the stored pool: what the rankings are "as of". */
  const pulledAt = useMemo(() => latestImportedAt(scoutTeams), [scoutTeams]);
  // Handed the club the board had open, or the one League Standings' Scout button asked for.
  const [reportTeamId, setReportTeamId] = useState<string>(
    () => handover?.reportTeamId ?? scoutAsked() ?? ""
  );
  useEffect(() => scoutTaken(), []);

  const [gameDraft, setGameDraft] = useState<AddGameDraft>(EMPTY_ADD_GAME_DRAFT);

  const [importOpen, setImportOpen] = useState(false);
  const [pullProgress, setPullProgress] = useState(() => loadPullProgress());
  const [refreshLog, setRefreshLog] = useState(() => loadRefreshLog());
  const [openTeamId, setOpenTeamId] = useState<string | null>(handover?.openTeamId ?? null);
  /*
   * A club's sheet (`ClubSheet`): opened with the history entry Back closes it by, shut by Back,
   * the history having moved already, or closed by its own controls, which take the entry back
   * (`clubSheetHistory.ts`).
   */
  const openClub = useCallback((teamId: string) => {
    markClubSheet();
    setOpenTeamId(teamId);
  }, []);
  const shutClub = useCallback(() => setOpenTeamId(null), []);
  const closeClub = useCallback(() => {
    setOpenTeamId(null);
    leftClubSheet();
  }, []);
  const [stateFilter, setStateFilter] = useState(handover?.stateFilter ?? "");
  const [showAll, setShowAll] = useState(handover?.showAll ?? false);
  // Somebody went to search on the live board: the search they asked for, now it has its list.
  const focusSearch = handover?.focusSearch === true;
  useEffect(() => {
    if (focusSearch) document.getElementById("scout-team-search")?.focus();
  }, [focusSearch]);

  const [editingGameId, setEditingGameId] = useState<string | null>(null);
  const [editScoreA, setEditScoreA] = useState("");
  const [editScoreB, setEditScoreB] = useState("");

  /**
   * Makes an edit as a command (`commands.ts`), on this browser's pool, and shows it once it is
   * written: a change the store refused is a change that is not there, so the page keeps showing
   * the pool as stored and says so. Only the parts the command changed are written.
   */
  // Held here as well as stored: a club's age and a thrown-out club change what is on screen at
  // once, and a list pasted in this session skips a club thrown out in it.
  const [namedAges, setNamedAges] = useState<NamedAges>(() => loadNamedAges());
  const [droppedClubs, setDroppedClubs] = useState<DeletedClubs>(() => loadDroppedClubs());
  // The clubs taken off as plainly made up, which the boards leave out (`deriveAllKnown`).
  const [autoRemoved, setAutoRemoved] = useState<AutoRemovals>(() => loadAutoRemoved());
  const runCommand = useCallback(
    (
      command: PoolCommand,
      { quiet = false, explains = false }: { quiet?: boolean; explains?: boolean } = {}
    ): CommandRun => {
      const run = runPoolCommand(command);
      // Work done in the background (the tidy) that the pool has moved on from is not news: it
      // comes round again on the pool as it is. A store that would not take a write still is.
      if (!run.ok && quiet && run.why !== "unsaved") return run;
      // A caller that says what a refusal leaves behind itself (the archive, whose tables are
      // kept either way) is the one message shown.
      if (!run.ok && explains) return run;
      if (!run.ok) {
        showToast(
          run.why === "unsaved"
            ? "Could not save (storage full)."
            : run.why === "missing"
              ? "That is no longer in the pool. Reload to see it as it is."
              : "That is not a change the pool takes.",
          { tone: "error" }
        );
        return run;
      }
      if (run.writes.length === 0) return run;
      const teams = writtenTeams(run);
      if (teams) setScoutTeams(teams);
      // A page's mark lives on the page, so a page written is the one the board reads its ★ from.
      const groups = writtenGroups(run);
      if (groups) setAgeGroups(groups);
      const named = writtenNamedAges(run);
      if (named) setNamedAges(named);
      const dropped = writtenAnswers(run, "droppedClubs");
      if (dropped) setDroppedClubs(dropped);
      const marks = writtenAutoRemoved(run);
      if (marks) setAutoRemoved(marks);
      if (run.writes.some((write) => write.part === "games")) bumpPool();
      onDataChange?.();
      return run;
    },
    [showToast, onDataChange, bumpPool]
  );

  /**
   * Another tab changed the pool, so what is held here is old.
   *
   * The pool is read once, at mount, into the state above. That is what makes a synchronous read
   * of an asynchronous store possible, and it is also what made two tabs unsafe: open Team
   * Rankings twice, start a pull in one and correct a score in the other, and the second tab saved
   * the pool it read at startup over everything the pull had done, without erroring.
   *
   * Re-reading here closes it. The store has already taken the new value in by the time this runs,
   * so every load below answers with what the other tab wrote, and the next save from this tab
   * builds on that rather than on a pool from an hour ago.
   */
  useEffect(
    () =>
      onPoolChangedElsewhere(() => {
        setAgeGroups(loadAgeGroups());
        setScoutTeams(loadScoutTeams());
        setAutoRemoved(loadAutoRemoved());
        bumpPool();
        setPullProgress(loadPullProgress());
        setRefreshLog(loadRefreshLog());
      }),
    [bumpPool]
  );

  /**
   * Tidies a pool the tidy has not seen. It runs at the end of every pull; opening the app on a
   * pool whose shape differs from the one it last tidied — a restored backup, a pull closed
   * mid-tidy, a pool from before the tidy existed — runs it again, unasked, once the page has
   * painted. Nothing to press: games outside their squad year are deleted, doubles collapsed,
   * stand-ins settled, exactly as at the end of a pull.
   */
  const { tidy: tidyInWorker } = usePoolTidy();
  /**
   * What a tidy changed, laid onto the pool as it is now rather than its copy saved whole
   * (`changeBetween`), and the stamp that says the pool is tidy written only once that landed:
   * refused, the stamp is left alone and the tidy comes round again on the pool as it is.
   */
  const layDownTidy = useCallback(
    (before: GcImportState, after: GcImportState, options: { quiet?: boolean } = {}): boolean => {
      if (!runCommand(changeBetween(poolParts(before), poolParts(after)), options).ok) return false;
      saveTidyStamp(poolSignature(after));
      return true;
    },
    [runCommand]
  );
  const tidyingRef = useRef(false);
  /**
   * Whether the page's first board has come back, or there is none to wait for: what the tidy on
   * open waits on. Handing the tidy the pool is a second copy of all of it made on the page's own
   * thread (1.1 s on the pool of 29 September 2026) just as the rankings ask for theirs, so the rows
   * came up later for it: 10.1 s rather than 9.1 on a pool the tidy has nothing to do to, and 9.9
   * rather than 8.4 on one it had. The tidy now starts once they are up; it takes a quarter of a
   * minute and more in its worker either way, and nothing on the page waits on it. A board that
   * never comes back, which should not happen, holds it up for a minute at most.
   */
  const [boardShown, setBoardShown] = useState(false);
  useEffect(() => {
    if (boardShown) return;
    const timer = setTimeout(() => setBoardShown(true), 60_000);
    return () => clearTimeout(timer);
  }, [boardShown]);
  useEffect(() => {
    if (storedGameCount === 0 || tidyingRef.current || !boardShown) return;
    /*
     * A pull still running tidies when it finishes, and a tidy already going is the same work; both
     * write the whole pool, so the one that finished first would be overwritten by the other.
     */
    if (isPoolBusy()) return;
    if (pullProgress && remainingIds(pullProgress).length > 0) return;
    // From counts, so a pool the tidy has already seen is recognised without decoding a year of it.
    const stamp = poolSignatureOf(
      { ageGroups: ageGroups.length, teams: scoutTeams.length, games: storedGameCount },
      latestImportedAt(scoutTeams)
    );
    const stored = loadTidyStamp();
    if (stamp === stored || stampFromNewerRules(stored)) return;
    tidyingRef.current = true;
    // Only now, with work to do: every year, for the one pass that has to see them together.
    const pool: GcImportState = { ageGroups, teams: scoutTeams, games: loadScoutGames() };
    /*
     * No size limit on this any more. There used to be one — above 20,000 games it was left to a
     * button in Setup — because five passes over two hundred thousand games is twenty-odd seconds
     * on the main thread: the tab freezes, gets reloaded, the cleanup cancels the run, the stamp is
     * never written, and it starts over next time and never finishes. A real pool was found with
     * eleven thousand results still filed against "TBD" for exactly that reason. In the worker
     * there is nothing to freeze, so the pool that most needs tidying is no longer the one that
     * never gets it.
     */
    let live = true;
    void tidyInWorker(pool, { workerOnly: storedGameCount > AUTOMATIC_INLINE_GAME_LIMIT }).then(
      (outcome) => {
        // Something else claimed the pool first, or the view moved on to a different one while this
        // was working. Either way the stamp is untouched, so it comes round again.
        if (!outcome || !live) return;
        const tidy: PoolTidy = { ...outcome.tidy, state: outcome.state };
        if (!layDownTidy(pool, tidy.state, { quiet: true })) return;
        const lines = describeTidy(tidy);
        if (lines.length > 0) showToast(lines.join(" "));
      }
    );
    return () => {
      live = false;
      tidyingRef.current = false;
    };
  }, [
    ageGroups,
    scoutTeams,
    storedGameCount,
    boardShown,
    pullProgress,
    layDownTidy,
    showToast,
    tidyInWorker,
  ]);

  // ---------- Age group management ----------

  const yearOptions = useMemo(() => seasonYearOptions(ageGroups), [ageGroups]);

  /*
   * What has been archived, and whether an archive is running.
   *
   * Only the index — names, dates and counts — is held here. A season's rows are a hundred
   * thousand of them and are read when somebody opens one, which is the whole point of keeping
   * them in a key of their own.
   */
  const [archives, setArchives] = useState<ArchiveEntry[]>(() => loadArchiveIndex());
  const [archiving, setArchiving] = useState(false);

  /**
   * Answers "what age does this league season play?" — the only age-group question left to ask.
   *
   * The pages themselves arrive with the GameChanger pull, so asking somebody to type one in first
   * is asking them to repeat what the import is about to say. What no import can know is which
   * page your own league belongs on: nothing in a GameChanger schedule mentions your league at all.
   */
  const assignSeasonToAge = (seasonId: string, season: AgeGroupSeason | null) => {
    const pageId = createAgeGroupId();
    const run = runCommand({ kind: "season.assign", seasonId, season, pageId });
    if (!run.ok) return;
    const group = season
      ? (writtenGroups(run) ?? ageGroups).find((page) => page.seasonIds.includes(seasonId))
      : undefined;
    if (!group) {
      showToast("League season taken off Team Rankings.");
      return;
    }
    pickPage(group.id);
    // Made by this, where no page had its id before: a page is made under its age and year's id
    // (`newPageId`), which is not the one the command carried.
    showToast(
      ageGroups.some((page) => page.id === group.id)
        ? `League season added to ${group.name}.`
        : `${group.name} created, with your league season on it.`,
      { tone: "success" }
    );
  };

  // ---------- Ranking data for the selected age group ----------

  // The selected age group, plus the ones it carries on from (last year's squad, and so on). Only
  // the selected group is ever ranked; the rest are here so a squad's opponents keep showing up in
  // the name dropdown as it ages up.
  const chainGroupIds = useMemo(
    () => ageGroupChain(selectedAgeGroupId, ageGroups),
    [selectedAgeGroupId, ageGroups]
  );

  /**
   * Every team and game the app knows about: the persisted scout roster extended (in memory, not
   * yet necessarily saved) with every league team name not already in it, and every game from
   * every age group, League Standings ones derived alongside (`deriveAllKnown`, which says why it
   * walks every age group and reads the links off the year on screen). The same function a server
   * builds its boards from, so the two cannot drift. League seasons are read from storage whenever
   * this recomputes — this view never writes back to League Standings data, only reads it.
   */
  const allKnown = useMemo(
    () =>
      deriveAllKnown({
        ageGroups,
        teams: scoutTeams,
        yearGames: scoutGames,
        readSeason: readStoredSeason,
        autoRemoved,
        // Read off the stored roster `scoutTeams` was loaded from, so it moves when that does.
        retired: loadRetiredIds(),
      }),
    [ageGroups, scoutGames, scoutTeams, autoRemoved]
  );

  const allKnownGames = allKnown.games;

  // Everything on the chain — used only for name suggestions, never for ratings.
  const chainGames = useMemo(() => {
    const onChain = new Set(chainGroupIds);
    return allKnown.games.filter((game) => onChain.has(game.ageGroupId));
  }, [allKnown.games, chainGroupIds]);

  const ageGroupGames = useMemo(
    () => chainGames.filter((game) => game.ageGroupId === selectedAgeGroupId),
    [chainGames, selectedAgeGroupId]
  );

  // Teams whose game here came from a League Standings season rather than being logged by hand
  // (`leagueTeamIdsOn`, which the published boards flag their rows by too).
  const leagueGameTeamIds = useMemo(
    () => leagueTeamIdsOn(allKnown.derivedGames, selectedAgeGroupId),
    [allKnown.derivedGames, selectedAgeGroupId]
  );

  /**
   * The games the rating pool is fitted over: every counted game in any age group sharing this
   * group's season year. `buildTeamRankings` filters to the pool itself, but it can only rate what
   * it is handed, so the wider list is passed rather than the page-scoped one.
   */
  const poolIds = useMemo(
    () => JSON.stringify(rankingPoolGroupIds(selectedAgeGroupId, ageGroups)),
    [selectedAgeGroupId, ageGroups]
  );
  /*
   * Followed by the pool's pages rather than by the page on screen, and the list itself when the
   * pool keeps every game, so a switch from 9U to 10U hands the rankings worker the array it
   * already holds. The worker is sent the year again whenever the array is a new one, and a new
   * one was built on every switch for the same games: on the 18:40 pool that was about a second
   * of encoding and copying on the main thread, and a refit in the worker, for nothing.
   */
  const poolGames = useMemo(
    () => gamesOnPages(allKnown.games, JSON.parse(poolIds) as string[]),
    [allKnown.games, poolIds]
  );

  /**
   * How many counted games each half of this year holds (`countedByHalf`), off `poolGames`, the
   * same list the boards are fitted from: so a half with nothing in it says so on its own tab, and
   * the board opens on a half worth reading (`segmentWorthShowing`).
   */
  const segmentGames = useMemo(
    () =>
      countedByHalf(
        poolGames,
        ageGroupYear(ageGroups.find((group) => group.id === selectedAgeGroupId)),
        today
      ),
    [poolGames, ageGroups, selectedAgeGroupId, today]
  );

  /**
   * Which half of the year the boards are for.
   *
   * The URL decides when it says; otherwise the calendar's half, unless that half holds nothing and
   * the other does. The fallback is here rather than in the hook because it is the counts above
   * that make it answerable, and it is never written into the URL — the app's guess should not end
   * up pinned in a link somebody shares.
   */
  const selectedSegment = routeSegment ?? segmentWorthShowing(calendarSegment, segmentGames);

  const myTeamId = ageGroups.find((g) => g.id === selectedAgeGroupId)?.myTeamId;

  /**
   * Passing `ageGroups` is what rates the whole season year as one pool: every age group sharing
   * this group's year is fitted together, each game carrying the age gap between the two sides, and
   * the rows that come back are the teams whose home level is this page's. A group below
   * `MIN_RANKED_AGE_LEVEL` has no table and comes back empty — its games still count as evidence
   * about the older teams that played down against it.
   */
  const {
    rows: rankings,
    stale: rankingsStale,
    standIn,
    whatIf,
    askWhatIf,
    checkModel,
    lastWeek,
    history: rankHistory,
  } = useRankingsWorker({
    ageGroupId: selectedAgeGroupId,
    teams: allKnown.teams,
    games: poolGames,
    ...(myTeamId === undefined ? {} : { myTeamId }),
    ageGroups,
    /*
     * One half of the year, fitted on its own games. Everything below reads `rankings`, so the two
     * boards, the state boards, the full table and the scouting report all follow the half
     * together — which they must, because a scouting report on a spring table built from autumn
     * ratings would be describing a team that does not exist.
     */
    ...(selectedSegment === undefined ? {} : { segment: selectedSegment }),
    // The cloud's board stands in only on a page it handed over to.
    liveStandIn: handover !== undefined,
  });
  // Once, as the first board settles; nothing a render reads changes with it.
  if (!boardShown && !rankingsStale) setBoardShown(true);

  /**
   * The teams behind the rows on this page. Taken from the rows rather than from the games filed
   * here, because the pool can list a team whose games were all filed elsewhere — a 10U that spent
   * the year playing down is at home on the 10U page with nothing filed on it — and the state
   * filter has to know about that team or it would drop off the page when a state is chosen.
   */
  const rankedTeams = useMemo(() => {
    const byId = new Map(allKnown.teams.map((team) => [team.id, team]));
    return rankings
      .map((row) => byId.get(row.teamId))
      .filter((team): team is ScoutTeam => team !== undefined);
  }, [rankings, allKnown.teams]);
  /** A club's row on the board on screen, by id: what a matchup's What if is worked out from. */
  const rankingRowOf = useMemo(() => {
    const byId = new Map(rankings.map((row) => [row.teamId, row]));
    return (teamId: string) => byId.get(teamId);
  }, [rankings]);
  /*
   * The pool as a club this device remembers is read by (`readClub`): the clubs watched on this
   * page (`watchList.ts`), each by the GameChanger ids kept with it, so one folded into another is
   * watched as that club and one whose id is another club's now is shown gone.
   */
  const clubLookup = useMemo(() => clubLookupOf(allKnown.teams), [allKnown.teams]);
  // And a saved tournament field's (`tournamentFields.ts`), whose clubs are saved with the ids each
  // carries on this page, as a League team's club's place is.
  const fieldClubs = useMemo(() => {
    const byId = new Map(allKnown.teams.map((team) => [team.id, team]));
    return {
      lookup: clubLookup,
      gcOf: (teamId: string) => {
        const club = byId.get(teamId);
        const ids = club && keptGcIds(club, selectedAgeGroupId, ageGroups);
        return ids?.length ? ids : undefined;
      },
    };
  }, [allKnown.teams, clubLookup, selectedAgeGroupId, ageGroups]);
  const watchList = useWatchList(selectedAgeGroupId, clubLookup);
  const { toggle: toggleWatch } = watchList;
  const watchCard = useMemo(
    () => ({ watched: watchList.watched, rowOf: rankingRowOf, onStop: toggleWatch }),
    [watchList.watched, rankingRowOf, toggleWatch]
  );

  const availableStates = useMemo(() => statesInUse(rankedTeams), [rankedTeams]);

  /**
   * The two rankings a page leads with. A nationwide pool is thousands of teams and a table of all
   * of them answers no question anybody has; the ones worth a headline are the best in the country
   * at this age, and the best in one state. The full list is still below, for finding a team.
   */
  const nationalTop = useMemo(() => rankings.slice(0, NATIONAL_TOP), [rankings]);

  /** Which state the top ten is for (`useStateTop`), shared with the live board. */
  const { shownState, pickState, keptState, keepState } = useStateTop(
    rankedTeams,
    myTeamId,
    handover?.stateTop ?? null
  );

  /** "Prosper, TX" for each club on the page (`placesOf`), shared with the live board. */
  const placeById = useMemo(() => placesOf(rankedTeams), [rankedTeams]);
  // A lookup rather than a search of the page's clubs per call: the Scouting picker asks it of
  // every row, and on a four-thousand-club page that was 288 ms of searching against about 5.
  const placeOf = useCallback((teamId: string) => placeById.get(teamId), [placeById]);
  /** Who coaches each club on the page, for the Scouting pickers to search and list. */
  const coachesById = useMemo(
    () => new Map(rankedTeams.map((team) => [team.id, coachesOf(team)])),
    [rankedTeams]
  );
  const coachesFor = useCallback(
    (teamId: string): readonly string[] => coachesById.get(teamId) ?? [],
    [coachesById]
  );

  const stateTopRows = useMemo(
    () =>
      shownState
        ? filterRankingsByState(rankings, rankedTeams, shownState).slice(0, STATE_TOP)
        : [],
    [rankings, rankedTeams, shownState]
  );
  const unknownStateCount = unknownStateCountOf(rankedTeams);

  // Filtering is presentational: ratings come from every game, because a team's strength does not
  // depend on which rows are on screen. Only the numbering changes.
  const visibleRankings = useMemo(
    () => filterRankingsByState(rankings, rankedTeams, stateFilter),
    [rankings, rankedTeams, stateFilter]
  );

  // A club taken off as plainly made up is named too, as such: the Games tab lists its stored games.
  const teamNameById = useMemo(
    () => listedTeamNames(allKnown.teams, allKnown.removed, scoutTeams),
    [allKnown.teams, allKnown.removed, scoutTeams]
  );
  // The roster by id, for what asks a game's other side for more than its name (Not this team).
  const scoutTeamById = useMemo(
    () => new Map(scoutTeams.map((team) => [team.id, team])),
    [scoutTeams]
  );

  const reportForId =
    reportTeamId || rankings.find((row) => row.isMine)?.teamId || rankings[0]?.teamId || "";
  /** Opponents asked for by name in the scouting report, beyond the two lists it shows by default. */
  const [pickedOpponentIds, setPickedOpponentIds] = useState<string[]>(
    () => handover?.pickedOpponentIds ?? []
  );

  /**
   * A club to set beside the report's team (`compareClubs`): their meetings, the clubs both have
   * played, and each one's best wins, worst losses and latest results, off the games this board
   * counts in the half it is showing.
   */
  const [compareId, setCompareId] = useState(handover?.compareTeamId ?? "");
  const comparison = useMemo(() => {
    if (!compareId || !reportForId || compareId === reportForId) return null;
    return compareClubs(
      reportForId,
      compareId,
      poolGames,
      rankings,
      (teamId) => teamNameById.get(teamId) ?? "Unknown team",
      (game) => countedInWindow(game, ageGroups, selectedSegment)
    );
  }, [compareId, reportForId, poolGames, rankings, teamNameById, ageGroups, selectedSegment]);
  const report = useMemo(
    () =>
      reportForId
        ? buildScoutingReport(reportForId, rankings, rankedTeams, {
            pickedIds: pickedOpponentIds,
          })
        : EMPTY_SCOUTING_REPORT,
    [reportForId, rankings, rankedTeams, pickedOpponentIds]
  );
  /** Everyone the report names, for the panel that has to explain where a rank comes from. */
  const reportRows = useMemo(
    () => [...report.national, ...report.state, ...report.picked],
    [report]
  );

  /**
   * The games still on this team's schedule. Read from the same pool the ratings are fitted over,
   * so a fixture a GameChanger pull brought in with no score yet is already here — nothing has to
   * be entered by hand for the next game to show up.
   */
  const upcomingRows = useMemo(() => {
    if (!reportForId) return [];
    return buildUpcomingSchedule(reportForId, rankings, poolGames, allKnown.teams, today);
  }, [reportForId, rankings, poolGames, allKnown.teams, today]);
  const reportRow = rankings.find((row) => row.teamId === reportForId) ?? null;

  /** How far a row on this page's national board has moved since last week. */
  const boardMovement = useCallback(
    (row: ScoutRankingRow) =>
      movementOf(row.teamId, row.overallRank ?? row.rank, lastWeek?.ranks ?? null),
    [lastWeek]
  );

  const { myExpected, myTeam, myWeek, thisWeek, weekly } = useRankingsWeek({
    ageGroups,
    allKnown,
    lastWeek,
    myTeamId,
    poolGames,
    rankedTeams,
    rankings,
    reportForId,
    selectedAgeGroupId,
    selectedSegment,
    today,
    upcomingRows,
  });
  // The club marked as the page's own while it has no row on the board, for the short card that
  // says so (`RankingsSection`).
  const myTeamWaiting = useMemo(() => {
    if (myTeamId === undefined || myTeam) return undefined;
    const club = allKnown.teams.find((team) => team.id === myTeamId);
    return club ? { teamId: club.id, name: club.name } : undefined;
  }, [myTeamId, myTeam, allKnown.teams]);

  useLeagueClubRanks({
    ageGroups,
    allKnown,
    fieldClubs,
    lastWeek,
    rankedTeams,
    rankings,
    rankingsStale,
    selectedAgeGroupId,
    selectedSegment,
    selectedYear,
  });

  const { setOpened, whatIfBoard, whatIfDeclineFor, whatIfGameId } = useWhatIf({
    ageGroups,
    allKnown,
    askWhatIf,
    poolGames,
    poolIds,
    reportForId,
    routeSegment,
    selectedAgeGroupId,
    today,
    upcomingRows,
  });

  const selectedGroupName = ageGroups.find((g) => g.id === selectedAgeGroupId)?.name ?? "";

  /** Why a page below the ranked ages has no table (`unrankedLevelNoteFor`). */
  const selectedAgeLevel = ageGroupLevel(ageGroups.find((g) => g.id === selectedAgeGroupId));
  const unrankedLevelNote = unrankedLevelNoteFor(selectedAgeGroupId, selectedAgeLevel);

  const explanationRequest = useMemo(() => {
    if (!reportRow || reportRow.games === 0) return null;
    return buildTeamRankExplanationRequest(
      reportRow,
      rankings.length,
      reportRows,
      selectedGroupName || "this age group"
    );
  }, [reportRow, rankings.length, reportRows, selectedGroupName]);
  const explanation = useLeagueSummary(explanationRequest);

  const ageGroupManualGames = useMemo(
    () => loggedGamesOn(scoutGames, selectedAgeGroupId),
    [scoutGames, selectedAgeGroupId]
  );
  /**
   * The day the Games tab lists before it is asked for every game: today (`gamesWindow.ts`).
   */
  const gamesWindow = useMemo(
    () => gamesWindowFor({ today, year: selectedYear, games: ageGroupManualGames }),
    [today, selectedYear, ageGroupManualGames]
  );
  /**
   * Games added on this page since it was opened, kept on the list whatever their date, so a game
   * dated a month back does not vanish the moment it is added. Keyed on the page, so another page
   * starts with none and nothing has to be cleared when the page changes.
   */
  const [justAdded, setJustAdded] = useState<{ pageId: string; ids: string[] }>({
    pageId: "",
    ids: [],
  });
  const keptOnList = useMemo(
    () => new Set(justAdded.pageId === selectedAgeGroupId ? justAdded.ids : []),
    [justAdded, selectedAgeGroupId]
  );
  const noteAdded = (ids: string[]) =>
    setJustAdded((previous) => ({
      pageId: selectedAgeGroupId,
      ids: [...(previous.pageId === selectedAgeGroupId ? previous.ids : []), ...ids],
    }));

  const {
    clearTeamAge,
    dropGames,
    hasGamesFiledHere,
    mintRetired,
    notThisTeam,
    removeGame,
    removeTeamById,
    setMyTeam,
    setTeamAge,
    setTeamAges,
    setTeamState,
    unlinkGc,
  } = useTeamEdits({
    ageGroups,
    allKnown,
    requestConfirmation,
    runCommand,
    scoutGames,
    scoutTeams,
    selectedAgeGroupId,
    selectedGroupName,
    selectedYear,
    showToast,
    teamNameById,
    wholePoolGames,
  });

  const {
    agelessList,
    clearAgelessRows,
    confirmScore,
    deleteRemoved,
    deleteRemovedOn,
    dropClub,
    nameAgeFor,
    putBackRemoved,
    putBackRemovedOn,
    restoreDroppedClub,
    throwOutAgeless,
    undoAgelessAnswer,
  } = usePoolAnswers({
    ageGroups,
    allKnown,
    requestConfirmation,
    runCommand,
    section,
    showToast,
    wholePoolGames,
  });

  const {
    explainGcId,
    heldHeals,
    mergeCandidatesFor,
    mergeInto,
    offerForGcId,
    openListedTeam,
    openSearchedTeam,
    searchOptions,
    unheldOf,
    withHeals,
  } = useFindTeam({
    ageGroups,
    allKnown,
    autoRemoved,
    droppedClubs,
    openClub,
    openPage,
    pullLive,
    rankedTeams,
    requestConfirmation,
    restoreDroppedClub,
    runCommand,
    scoutTeams,
    section,
    setOpenTeamId,
    settledRevision,
    showToast,
  });

  const openTeam = openTeamId ? (allKnown.teams.find((t) => t.id === openTeamId) ?? null) : null;
  /** The open club's level in this year and whether it was set by hand (`clubAgeOf`). */
  const openTeamAge = useMemo(
    () => (openTeam ? clubAgeOf(openTeam, selectedYear, ageGroups, namedAges) : undefined),
    [openTeam, selectedYear, ageGroups, namedAges]
  );
  /**
   * Where the open club stands on the board on screen, for its panel to lead with: its place on
   * the page's board and among its state's clubs, read as the My Team card reads its own
   * (`myTeamGlance`), and none for a club the board does not list.
   */
  const openTeamStanding = useMemo(() => {
    if (!openTeamId) return undefined;
    const stateById = new Map(rankedTeams.map((team) => [team.id, team.state]));
    return myTeamGlance(rankings, openTeamId, (teamId) => stateById.get(teamId), []) ?? undefined;
  }, [openTeamId, rankings, rankedTeams]);

  /**
   * Renaming onto a name that already exists merges the two teams, so a placeholder or a
   * misspelling can be routed to the real team rather than leaving its games stranded.
   */
  const renameTeam = async (teamId: string, nextName: string) => {
    const everyGame = loadScoutGames();
    const preview = renameScoutTeam(teamId, nextName, allKnown.teams, everyGame, ageGroups);
    if (preview.mergedInto) {
      const moved = everyGame.filter(
        (game) => game.teamAId === teamId || game.teamBId === teamId
      ).length;
      const confirmed = await requestConfirmation({
        title: `Merge into ${preview.mergedInto.name}?`,
        message: `${moved} game${moved === 1 ? "" : "s"} will move to ${preview.mergedInto.name}, and this team will be removed.${
          preview.droppedGames > 0
            ? `\n\n${preview.droppedGames} game${preview.droppedGames === 1 ? " is" : "s are"} between these two teams and will be dropped — a team cannot play itself.`
            : ""
        }`,
        confirmLabel: "Merge",
      });
      if (!confirmed) return;
    }

    const survivor = preview.mergedInto;
    // A merge takes every page whose own team was this one along with it (`teams.merge`), so no
    // page's star, "use my team" shortcut or import subject is left on an id nothing answers to.
    const run = runCommand(
      survivor
        ? {
            kind: "teams.merge",
            fromId: teamId,
            intoId: survivor.id,
            adopt: unheldOf(teamId, survivor.id),
          }
        : { kind: "team.rename", teamId, name: nextName }
    );
    if (!run.ok) return;
    // The merged-away team no longer exists, so follow the games to the one that does.
    if (survivor) setOpenTeamId(survivor.id);
    showToast(preview.mergedInto ? `Merged into ${preview.mergedInto.name}.` : "Team renamed.", {
      tone: "success",
    });
  };

  const myTeamName = rankings.find((row) => row.isMine)?.teamName ?? "";

  const { addGame, addGameValid, importGames, saveGameScore, startEditScore, toggleGameExcluded } =
    usePoolGameEntry({
      ageGroupGames,
      allKnown,
      editScoreA,
      editScoreB,
      gameDraft,
      heldHeals,
      mintRetired,
      noteAdded,
      requestConfirmation,
      runCommand,
      scoutTeams,
      selectedAgeGroupId,
      selectedYear,
      setEditingGameId,
      setEditScoreA,
      setEditScoreB,
      setGameDraft,
      setImportOpen,
      showToast,
      teamNameById,
      withHeals,
    });

  // ---------- Starting over ----------

  const { archivableSummaries, archiveYear, deleteYear, downloadPoolBackup, resetEverything } =
    useStartingOver({
      ageGroups,
      allKnown,
      archives,
      closeClub,
      onDataChange,
      pickPage,
      requestConfirmation,
      runCommand,
      scoutTeams,
      setArchives,
      setArchiving,
      setPoolBackupAt,
      setReportTeamId,
      showToast,
      storedYears,
    });

  // Scoped to this age group and the ones it continues from: a 9U opponent has no business being
  // suggested while logging an 11U game, even though both squads share one roster store.
  const suggestedTeams = useMemo(
    () => teamNameSuggestions(selectedAgeGroupId, ageGroups, allKnown.teams, chainGames),
    [selectedAgeGroupId, ageGroups, allKnown.teams, chainGames]
  );
  const teamNameOptions = useMemo(() => suggestedTeams.map((team) => team.name), [suggestedTeams]);
  // A pasted schedule's rows checked here, against this device's roster and the page's games.
  const importChecker = useMemo<NamedChecker>(
    () => ({
      kind: "here",
      check: (named) => checkNamedGames(named, allKnown.teams, ageGroupGames, selectedAgeGroupId),
    }),
    [allKnown.teams, ageGroupGames, selectedAgeGroupId]
  );

  return (
    <div className="flex flex-col gap-6">
      <RankingsHeader
        pulledAt={pulledAt}
        defaultAge={defaultAge}
        onSetDefaultAge={setDefaultAge}
        ageGroups={ageGroups}
        section={section}
        selectedYear={selectedYear}
        selectedAgeGroupId={selectedAgeGroupId}
        groupsInYear={groupsInYear}
        yearChoices={yearChoices}
        selectedSegment={selectedSegment}
        segmentGames={segmentGames}
        onOpenSegment={openSegment}
        onOpenYear={openYear}
        onOpenPage={openPage}
        onOpenSection={openSection}
        onPreviewSection={previewSection}
      />

      <div
        id={SECTION_PANEL_ID}
        role="tabpanel"
        aria-labelledby={sectionTabId(section)}
        className="flex flex-col gap-6"
      >
        {/*
          One boundary per section, keyed by section, so a section that throws leaves the tabs and
          the age picker above it usable — you can still get to Setup and take a backup out. Keying
          it clears the caught error on the way to another section, which is what makes leaving a
          broken one possible at all. A section whose code failed to load is caught here too, and
          its Try again fetches the code afresh (`resetSection`).
        */}
        <ErrorBoundary
          key={section}
          area={sectionLabel(section)}
          onReset={() => resetSection(section)}
        >
          {section === "rankings" && (
            <RankingsBoards
              groupName={selectedGroupName}
              searchOptions={searchOptions}
              onSearchTeam={openSearchedTeam}
              explainGcId={explainGcId}
              offerForGcId={offerForGcId}
              hasAgeGroups={ageGroups.length > 0}
              unrankedLevelNote={unrankedLevelNote}
              segment={
                selectedSegment === undefined || selectedYear === undefined
                  ? null
                  : {
                      name: segmentLabel(selectedYear, selectedSegment),
                      played: segmentGames[selectedSegment],
                      otherName: segmentLabel(
                        selectedYear,
                        selectedSegment === "fall" ? "spring" : "fall"
                      ),
                      otherPlayed: segmentGames[selectedSegment === "fall" ? "spring" : "fall"],
                    }
              }
              rankings={rankings}
              rankingsStale={rankingsStale}
              {...(rankingsStale && standIn === "live"
                ? { standInNote: "The cloud's board · refitting here…" }
                : {})}
              nationalTop={nationalTop}
              stateTopRows={stateTopRows}
              visibleRankings={visibleRankings}
              availableStates={availableStates}
              shownState={shownState}
              onShownStateChange={pickState}
              keptState={keptState}
              onKeepState={keepState}
              unknownStateCount={unknownStateCount}
              stateFilter={stateFilter}
              onStateFilterChange={setStateFilter}
              showAll={showAll}
              onToggleShowAll={() => setShowAll((value) => !value)}
              placeOf={placeOf}
              isLeagueTeam={(teamId) => leagueGameTeamIds.has(teamId)}
              hasGamesFiledHere={hasGamesFiledHere}
              onOpenTeam={openClub}
              onMarkMine={setMyTeam}
              myTeam={myTeam}
              {...(myTeamWaiting ? { myTeamWaiting } : {})}
              thisWeek={thisWeek}
              weekly={weekly}
              myWeek={myWeek}
              {...(myExpected ? { myExpected } : {})}
              {...(rankHistory ? { rankHistory } : {})}
              movementOf={boardMovement}
              watch={watchCard}
              onScoutNext={(opponentId) => {
                // Our club's report, with its next opponent beside it in Compare with.
                if (myTeamId !== undefined) setReportTeamId(myTeamId);
                setCompareId(opponentId);
                openSection("scouting");
              }}
              onRemoveTeam={removeTeamById}
            />
          )}

          {section === "games" && (
            <GamesSection
              groupName={selectedGroupName}
              ageGroupId={selectedAgeGroupId}
              hasAgeGroups={ageGroups.length > 0}
              draft={gameDraft}
              onDraftChange={(patch) => setGameDraft((prev) => ({ ...prev, ...patch }))}
              teamNameOptions={teamNameOptions}
              myTeamName={myTeamName}
              addGameValid={addGameValid}
              onAddGame={() => void addGame()}
              onGoToImport={() => openSection("import")}
              importOpen={importOpen}
              onOpenImport={() => setImportOpen(true)}
              onCloseImport={() => setImportOpen(false)}
              suggestedTeams={suggestedTeams}
              checker={importChecker}
              onImportGames={importGames}
              showToast={showToast}
              loggedGames={ageGroupManualGames}
              gamesWindow={gamesWindow}
              today={today}
              keep={keptOnList}
              teamNameById={teamNameById}
              editingGameId={editingGameId}
              editScoreA={editScoreA}
              editScoreB={editScoreB}
              onEditScoreA={setEditScoreA}
              onEditScoreB={setEditScoreB}
              onStartEditScore={startEditScore}
              onSaveScore={saveGameScore}
              onToggleExcluded={toggleGameExcluded}
              onRemoveGame={(game) => void removeGame(game)}
              ratingRowOf={rankingRowOf}
            />
          )}

          {section === "import" && (
            <GameChangerImportPanel
              /*
               * The stored pool only — not the merged roster. League-derived teams and games are
               * rebuilt from League Standings on every render and must never be written back here, or
               * a pull would persist a second copy of every league game it happened to see.
               */
              pool={{ ageGroups, teams: scoutTeams, games: wholePoolGames }}
              namedAges={namedAges}
              droppedClubs={droppedClubs}
              onInvented={(ids) => {
                // Thrown out exactly as a club deleted by hand is: see `inventedFromOutcomes`.
                runCommand({ kind: "answers", list: "droppedClubs", add: [...ids], remove: [] });
              }}
              onSwept={(change, spared) => {
                // The clubs plainly made up, swept as the nightly sweeps the cloud copy after its
                // pull, for a pool kept on this device (`obviousFakes.ts`), in the tidy worker.
                if (change) runCommand({ kind: "autoRemoved", ...change }, { quiet: true });
                // ...and those marked for a game their own schedule reports won or lost by 40 or
                // more deleted outright, as the nightly deletes them (`lopsidedDrops`).
                return lopsidedDrops(loadAutoRemoved(), loadScoutTeams(), spared).filter(
                  (teamId) => runCommand({ kind: "club.drop", teamId }, { quiet: true }).ok
                );
              }}
              savedProgress={pullProgress}
              onPersist={(next, holding) => {
                /*
                 * A pull never empties a squad year, so it names none. If storage reports one
                 * spared, the panel is holding a pool it was not given — which is the bug this
                 * whole path once had, now a message instead of a deletion (`persistPool`).
                 */
                const { saved, spared } = persistPool(next, holding);
                if (spared.length > 0) showToast(sparedYears(spared), { tone: "error" });
                setAgeGroups(next.ageGroups);
                setScoutTeams(next.teams);
                bumpPool();
                onDataChange?.();
                return saved;
              }}
              onSaveProgress={(progress) => {
                setPullProgress(progress);
                savePullProgress(progress);
              }}
              onClearProgress={() => {
                setPullProgress(null);
                clearPullProgress();
              }}
              refreshLog={refreshLog}
              onRefreshLog={(log) => {
                setRefreshLog(log);
                saveRefreshLog(log);
              }}
              /* The panel closes itself when a pull finishes; there is nowhere to close to but the
               tables it has just filled. */
              onClose={() => openSection("rankings")}
              showToast={showToast}
            />
          )}

          {section === "scouting" && (
            <ScoutingSection
              rankings={rankings}
              reportForId={reportForId}
              onReportTeamChange={setReportTeamId}
              reportRow={reportRow}
              report={report}
              onPickOpponent={(id) =>
                setPickedOpponentIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
              }
              onDropOpponent={(id) =>
                setPickedOpponentIds((prev) => prev.filter((entry) => entry !== id))
              }
              upcomingRows={upcomingRows}
              explanation={explanation}
              placeOf={placeOf}
              coachesFor={coachesFor}
              whatIfGameId={whatIfGameId}
              whatIf={whatIf}
              onToggleWhatIf={(gameId) =>
                setOpened((open) =>
                  open && open.board === whatIfBoard && open.gameId === gameId
                    ? null
                    : { gameId, board: whatIfBoard }
                )
              }
              whatIfDeclineFor={whatIfDeclineFor}
              compareId={compareId}
              onCompareChange={setCompareId}
              comparison={comparison}
            />
          )}
          {section === "scouting" && rankings.length > 0 && (
            /*
              A boundary of its own, since the panel's code is a chunk of its own: caught by the
              section's boundary, its failure took the report above it down with it. Its Try again
              fetches the code afresh. Keyed by the page, so the panel opens afresh on each.
            */
            <ErrorBoundary
              key={selectedAgeGroupId}
              area="The tournament field"
              onReset={tournamentPanel.reset}
            >
              <TournamentPanel
                ageGroupId={selectedAgeGroupId}
                rankings={rankings}
                reportForId={reportForId}
                upcomingRows={upcomingRows}
                placeOf={placeOf}
                clubs={fieldClubs}
              />
            </ErrorBoundary>
          )}

          {section === "archive" && <ArchiveSection entries={archives} />}

          {section === "setup" && (
            <SetupSection
              seasons={seasons}
              ageGroups={ageGroups}
              onAssignSeason={assignSeasonToAge}
              yearOptions={yearOptions}
              teamCount={scoutTeams.length}
              gameCount={storedGameCount}
              onDownloadBackup={() => void downloadPoolBackup()}
              lastBackupAt={poolBackupAt}
              /*
              The stored pool, not the merged roster: league-derived games are rebuilt from League
              Standings every render and must never be written back here.
            */
              ageless={{
                list: agelessList,
                named: namedAges,
                dropped: droppedClubs,
                onNameAge: nameAgeFor,
                onThrowOut: throwOutAgeless,
                onClearRows: clearAgelessRows,
                onUndo: undoAgelessAnswer,
                now: agelessNow,
              }}
              poolHealth={{
                pool: { ageGroups, teams: scoutTeams, games: wholePoolGames },
                tidyStamp: loadTidyStamp() ?? "",
                onTidied: ({ state: tidied }) => {
                  layDownTidy({ ageGroups, teams: scoutTeams, games: wholePoolGames }, tidied);
                },
                onMergeTeams: mergeInto,
                onDropGames: dropGames,
                onDropClub: dropClub,
                onConfirmScore: confirmScore,
                onOpenTeam: openListedTeam,
                onSetAge: setTeamAge,
                onSetAges: setTeamAges,
                runCommand: (command) => runCommand(command),
                autoRemoved,
                readSeason: readStoredSeason,
                onPutBack: putBackRemoved,
                onPutBackDay: putBackRemovedOn,
                onDeleteRemoved: deleteRemoved,
                onDeleteRemovedDay: deleteRemovedOn,
              }}
              /*
              The whole known pool, not just this page's rows: the fit is over the season year, so
              a check over anything narrower would be measuring a different model than the one the
              table came from.
            */
              modelCheck={{
                ageGroupId: selectedAgeGroupId,
                groupName: selectedGroupName,
                teams: allKnown.teams,
                games: allKnownGames,
                // The same answer from the pool the worker already holds: the check selects the
                // year's games, which is exactly what that pool is.
                check: checkModel,
                lastWeekly: lastWeeklyFromCloud,
              }}
              onReset={() => void resetEverything()}
              archive={{
                years: archivableSummaries,
                currentYear: selectedYear,
                busy: archiving,
                onArchive: (year) => void archiveYear(year),
                onDelete: (year) => void deleteYear(year),
              }}
            />
          )}
        </ErrorBoundary>
      </div>

      {openTeam && (
        <ClubSheet label={openTeam.name} onShut={shutClub} onClose={closeClub}>
          <ErrorBoundary area="The club" onReset={closeClub}>
            <Suspense fallback={<ClubOpening />}>
              <TeamDetailPanel
                // Keyed by team, so opening a different one gets a fresh panel. Without this React keeps
                // the instance and its rename draft still holds the previous team's name — which would
                // arm Merge to fold the newly opened team into the one you were just looking at.
                key={openTeam.id}
                team={openTeam}
                allGames={allKnownGames}
                ageGroupId={selectedAgeGroupId}
                ageGroups={ageGroups}
                // The half the board behind it is showing, so its record is the row's record.
                {...(selectedSegment === undefined ? {} : { segment: selectedSegment })}
                ageGroupName={selectedGroupName}
                teamNameById={teamNameById}
                leagueLink={
                  // A club the roster does not hold is one League Standings made, named there and
                  // nowhere else: a rename would have no club to write to.
                  !scoutTeams.some((team) => team.id === openTeam.id)
                    ? "name"
                    : leagueGameTeamIds.has(openTeam.id)
                      ? allKnown.pickedOnly.has(openTeam.id)
                        ? "pick"
                        : "name"
                      : undefined
                }
                onRename={(nextName) => void renameTeam(openTeam.id, nextName)}
                onUnlinkGc={(gcTeamId) => unlinkGc(openTeam.id, gcTeamId)}
                onMergeInto={(intoTeamId) => void mergeInto(openTeam.id, intoTeamId)}
                {...(openTeamAge ? { age: openTeamAge } : {})}
                onSetAge={(level) => setTeamAge(openTeam.id, level)}
                onClearAge={() => clearTeamAge(openTeam.id)}
                notThisTeam={{
                  offered: (game) => filedByNameOn(game, openTeam, (id) => scoutTeamById.get(id)),
                  onRefuse: (game) => notThisTeam(openTeam.id, game),
                }}
                mergeCandidates={mergeCandidatesFor(openTeam.id)}
                onSetState={(state) => setTeamState(openTeam.id, state)}
                onClose={closeClub}
                ratingRowOf={rankingRowOf}
                {...(openTeamStanding ? { standing: openTeamStanding } : {})}
                mine={{
                  on: myTeamId === openTeam.id,
                  onToggle: () => setMyTeam(openTeam.id),
                }}
                watch={{
                  on: watchList.watched.some((club) => club.id === openTeam.id),
                  full: watchList.full,
                  onToggle: (name) => {
                    const gc = keptGcIds(openTeam, selectedAgeGroupId, ageGroups);
                    toggleWatch({ id: openTeam.id, name, ...(gc.length ? { gc } : {}) });
                  },
                }}
              />
            </Suspense>
          </ErrorBoundary>
        </ClubSheet>
      )}
    </div>
  );
}

/** The sheet while a club's panel is fetched, the first time one is opened. */
function ClubOpening() {
  return (
    <section className={`${card} p-5`} role="status" aria-live="polite">
      <p className="text-sm text-slate-500 dark:text-slate-400">Opening the club…</p>
    </section>
  );
}
