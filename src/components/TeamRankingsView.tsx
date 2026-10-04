import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { lastBackupTakenAt, noteBackupTaken } from "../lib/lastBackup";
import { reloadApp, resetApp } from "../lib/resetApp";
import { myTeamGlance } from "../lib/myTeamGlance";
import { movementOf } from "../lib/rankMovement";
import { compareClubs } from "../lib/clubCompare";
import { setClubAge } from "../lib/clubAge";
import { createAgeGroupId } from "../lib/teamRankings/seasons";
import { planClubAges } from "../lib/live/agePlan";
import { whereIsGcId } from "../lib/gcIdWhereabouts";
import { leagueClubRanksFrom, writeLeagueClubRanks } from "../lib/leagueClubRanks";
import { TournamentPanel } from "./teamRankings/TournamentPanel";
import {
  ageGroupChain,
  ageGroupLevel,
  ageGroupYear,
  buildScoutingReport,
  EMPTY_SCOUTING_REPORT,
  buildUpcomingSchedule,
  countedInWindow,
  dedupeLeagueFixtures,
  leagueStandIns,
  filedTeamIds,
  findDuplicateGame,
  gcLinkSquadYear,
  isScoutGamePlayed,
  IMPLAUSIBLE_MARGIN,
  mergeScoutTeams,
  rankingPoolGroupIds,
  segmentLabel,
  resolveOrCreateTeam,
  seasonYearOptions,
  typedScores,
  filterRankingsByState,
  normalizeState,
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
  type GcImportState,
  type PoolTidy,
  latestImportedAt,
} from "../lib/gameChangerImport";
import { remainingIds } from "../lib/gameChangerPull";
import {
  deriveAllKnown,
  gamesOnPages,
  leagueTeamIdsOn,
  type SeasonReader,
} from "../lib/live/allKnown";
import { countedByHalf } from "../lib/teamRankings/halves";
import {
  defaultStateOf,
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
  writtenGroups,
  writtenNamedAges,
  writtenTeams,
  type CommandRun,
} from "../lib/live/runPoolCommand";
import {
  loadLogsForSeason,
  loadMatchupsForSeason,
  loadTeamsForSeason,
  type SeasonMeta,
} from "../lib/storage";
import {
  clearPullProgress,
  loadAgeGroups,
  loadArchiveIndex,
  loadPullProgress,
  loadRefreshLog,
  loadScoutGames,
  loadScoutGamesForYear,
  loadScoutTeams,
  loadTidyStamp,
  onPoolChangedElsewhere,
  savePullProgress,
  loadAllArchivedSeasons,
  saveArchivedSeasons,
  forgetArchivedSeason,
  saveRefreshLog,
  saveTidyStamp,
  storedGamesByYear,
  loadAgeUnknown,
  loadTooYoungClubs,
  loadDroppedClubs,
  loadNamedAges,
  saveAgeUnknown,
  loadAgelessCleared,
  saveAgelessCleared,
  clearAgelessCleared,
} from "../lib/teamRankingsStorage";
import { persistPool } from "../lib/poolPersist";
import type { DeletedClubs } from "../lib/deletedGames";
import type { NamedAges } from "../lib/namedAges";
import { clubAgeOf } from "../lib/teamRankings/clubAge";
import { forgetAgeless, type AgeUnknownList } from "../lib/ageUnknown";
import {
  agelessClearedPass,
  clearedIds,
  describeCleared,
  isClearedReason,
  restoreCleared,
} from "../lib/agelessCleared";
import type { AgelessAnswered } from "../lib/agelessTriage";

/** Referentially stable, so the card's own memos do not re-run when Setup is closed. */
const NO_AGELESS: AgeUnknownList = [];
import type { UnrealClub } from "../lib/unrealClubs";
import type { GamesDropped } from "./teamRankings/PoolHealthView";
import type { WrongAgeClub } from "../lib/wrongAge";
import {
  estimateBackupBytes,
  formatBytes,
  LARGE_BACKUP_BYTES,
  readTeamRankingsBackup,
  summarizeTeamRankingsBackup,
  teamRankingsJsonParts,
} from "../lib/teamRankingsBackup";
import {
  RANKINGS_COMMAND_SECTIONS,
  rankingsSectionCommandId,
  type RankingsSection,
} from "../lib/rankingsRoute";
import type { Command } from "./CommandPalette";
import { archiveSquadYear, type ArchiveEntry } from "../lib/teamRankingsArchive";
import { deleteSquadYear } from "../lib/deleteSquadYear";
import {
  archiveConfirmation,
  archivedSaid,
  archivePreviewOf,
  archivesAnything,
  archiveTableOf,
  deleteConfirmation,
  deletePreviewOf,
  deletesAnything,
  nothingUnder,
  summariseYears,
} from "../lib/yearSummary";
import { ArchiveSection } from "./teamRankings/ArchiveSection";
import { isPoolBusy, isPullLive, watchPull } from "../lib/pullSession";
import { usePoolTidy } from "../hooks/usePoolTidy";
import { ErrorBoundary } from "./ErrorBoundary";
import { GameChangerImportPanel } from "./GameChangerImportPanel";
import { TEAM_PANEL_ID, TeamDetailPanel } from "./TeamDetailPanel";
import { GamesSection, EMPTY_ADD_GAME_DRAFT, type AddGameDraft } from "./teamRankings/GamesSection";
import { gamesWindowFor, loggedGamesOn } from "../lib/teamRankings/gamesWindow";
import {
  NATIONAL_TOP,
  RankingsSection as RankingsBoards,
  STATE_TOP,
} from "./teamRankings/RankingsSection";
import { ScoutingSection } from "./teamRankings/ScoutingSection";
import { todayIsoDay } from "../lib/date";
import { ratedClubsOf, whatIfDeclines } from "../lib/scoutWhatIf";
import { RankingsHeader } from "./teamRankings/RankingsHeader";
import { SECTION_PANEL_ID, sectionTabId } from "./teamRankings/SectionNav";
import { SetupSection } from "./teamRankings/SetupSection";
import { useLeagueSummary } from "../hooks/useLeagueSummary";
import { useClubSearch } from "../hooks/useClubSearch";
import { clubSearchGames } from "../lib/clubSearch";
import { coachesOf } from "../lib/gcStaff";
import { segmentWorthShowing, useRankingsPages } from "../hooks/useRankingsPages";
import { useRankingsWorker } from "../hooks/useRankingsWorker";
import type { ToastTone } from "../hooks/useToast";

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
  /**
   * The commands this half can run, handed up for the app's palette.
   *
   * The palette and its shortcut live in App, but the navigation they drive lives here, so rather
   * than lift a route's worth of state up this hands the actions down as closures.
   */
  onCommands?: (commands: Command[]) => void;
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
 * read from and the handlers that write it.
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

/** League Standings seasons as this browser stores them, for `deriveAllKnown`. */
const readStoredSeason: SeasonReader = (seasonId) => ({
  teams: loadTeamsForSeason(seasonId),
  matchups: loadMatchupsForSeason(seasonId),
  logs: loadLogsForSeason(seasonId),
});

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

const sectionLabel = (section: RankingsSection): string =>
  ({
    rankings: "The rankings",
    games: "The games list",
    import: "The GameChanger import",
    scouting: "The scouting report",
    archive: "The archive",
    setup: "Setup",
  })[section];

export function TeamRankingsView({
  seasons,
  showToast,
  requestConfirmation,
  onDataChange,
  onCommands,
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

  /*
   * What the palette can do on this half: reach any area, and jump to any season year the pool
   * actually has. Both are the things the section tabs and the year picker do, so a command is
   * only ever another way in, never a second implementation of the navigation.
   *
   * The two navigators are rebuilt every render, so depending on them would rebuild this list
   * every render, publish it every render and set state every render — a loop, and the same shape
   * of mistake as the stale command list on the league side, only louder. The list therefore
   * depends on the data it is made of, `yearChoices` being a memo that is new exactly when the
   * years are, and reaches the navigators through a ref that an effect keeps current. A command is
   * only ever run after that effect, by someone clicking it.
   */
  const navigateRef = useRef({ openSection, openYear });
  useEffect(() => {
    navigateRef.current = { openSection, openYear };
  });

  const commands = useMemo<Command[]>(
    () => [
      ...RANKINGS_COMMAND_SECTIONS.map(({ section: target, label }) => ({
        id: rankingsSectionCommandId(target),
        label: `Go to ${label}`,
        group: "Team Rankings",
        run: () => navigateRef.current.openSection(target),
      })),
      ...yearChoices.map((year) => ({
        id: `rankings-year-${year ?? "undated"}`,
        label: year === undefined ? "Show the squads with no year" : `Show the ${year} season`,
        group: "Season",
        run: () => navigateRef.current.openYear(year),
      })),
    ],
    [yearChoices]
  );

  useEffect(() => {
    onCommands?.(commands);
  }, [onCommands, commands]);
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
  const [reportTeamId, setReportTeamId] = useState<string>(handover?.reportTeamId ?? "");

  const [gameDraft, setGameDraft] = useState<AddGameDraft>(EMPTY_ADD_GAME_DRAFT);

  const [importOpen, setImportOpen] = useState(false);
  const [pullProgress, setPullProgress] = useState(() => loadPullProgress());
  const [refreshLog, setRefreshLog] = useState(() => loadRefreshLog());
  const [openTeamId, setOpenTeamId] = useState<string | null>(handover?.openTeamId ?? null);
  const [stateFilter, setStateFilter] = useState(handover?.stateFilter ?? "");
  /** Which state the top ten shows; `null` means the one picked for you. */
  const [stateTop, setStateTop] = useState<string | null>(handover?.stateTop ?? null);
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
    showToast(
      group.id === pageId
        ? `${group.name} created, with your league season on it.`
        : `League season added to ${group.name}.`,
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
      }),
    [ageGroups, scoutGames, scoutTeams]
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

  const availableStates = useMemo(() => statesInUse(rankedTeams), [rankedTeams]);

  /**
   * The two rankings a page leads with. A nationwide pool is thousands of teams and a table of all
   * of them answers no question anybody has; the ones worth a headline are the best in the country
   * at this age, and the best in one state. The full list is still below, for finding a team.
   */
  const nationalTop = useMemo(() => rankings.slice(0, NATIONAL_TOP), [rankings]);

  /** Which state the top ten is for (`defaultStateOf`), shared with the live board. */
  const defaultState = useMemo(
    () => defaultStateOf(rankedTeams, myTeamId),
    [rankedTeams, myTeamId]
  );

  const shownState = stateTop === null ? defaultState : stateTop;

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

  const teamNameById = useMemo(
    () => new Map(allKnown.teams.map((team) => [team.id, team.name])),
    [allKnown.teams]
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

  /** The team marked as yours, where it stands on this page and what it plays next. */
  const myTeam = useMemo(() => {
    if (myTeamId === undefined) return null;
    const stateById = new Map(rankedTeams.map((team) => [team.id, team.state]));
    const upcoming =
      myTeamId === reportForId
        ? upcomingRows
        : buildUpcomingSchedule(myTeamId, rankings, poolGames, allKnown.teams, today);
    return myTeamGlance(
      rankings,
      myTeamId,
      (teamId) => stateById.get(teamId),
      upcoming,
      lastWeek?.ranks ?? null
    );
  }, [
    lastWeek,
    myTeamId,
    reportForId,
    upcomingRows,
    rankings,
    rankedTeams,
    poolGames,
    allKnown.teams,
    today,
  ]);

  /**
   * Where the clubs of the league seasons this page claims stand on it, written for League
   * Standings' "Our team" card (`leagueClubRanksFrom`), which cannot fit a board of its own. Only
   * off a board that is this page's and settled, so a switch between pages never writes one page's
   * places under another's seasons. A settled board with nobody on it is written too: it takes
   * away places the card would otherwise go on showing.
   *
   * And only off a half the season plays its games in. A fall league's clubs are on the fall
   * board; the spring one, with none of the league's games on it, took away the places the card
   * was showing the moment anybody looked at it, as a board opened on the spring in January did.
   */
  useEffect(() => {
    if (rankingsStale) return;
    const group = ageGroups.find((one) => one.id === selectedAgeGroupId);
    if (!group || group.seasonIds.length === 0) return;
    const stateById = new Map(rankedTeams.map((team) => [team.id, team.state]));
    const board =
      selectedSegment === undefined || selectedYear === undefined
        ? group.name
        : `${group.name} · ${segmentLabel(selectedYear, selectedSegment)}`;
    const at = new Date().toISOString();
    group.seasonIds.forEach((seasonId) => {
      const clubs = allKnown.leagueClubs.get(group.id)?.get(seasonId);
      if (!clubs) return;
      const halves = allKnown.leagueHalves.get(group.id)?.get(seasonId);
      if (selectedSegment !== undefined && halves && halves.size > 0) {
        if (!halves.has(selectedSegment)) return;
      }
      writeLeagueClubRanks(
        seasonId,
        leagueClubRanksFrom(
          rankings,
          clubs,
          (teamId) => stateById.get(teamId),
          lastWeek?.ranks ?? null,
          board,
          at
        )
      );
    });
  }, [
    rankings,
    rankingsStale,
    rankedTeams,
    ageGroups,
    selectedAgeGroupId,
    selectedSegment,
    selectedYear,
    allKnown.leagueClubs,
    allKnown.leagueHalves,
    lastWeek,
  ]);

  /**
   * The fixture whose what-if is open, if any. One at a time: two would be two tables.
   *
   * Remembered against the board it was opened on, and read back as closed whenever that is not
   * the board on screen. A place in a table means nothing in a different one, so a panel opened
   * for one club, page or half of the year must not survive into another — and deriving that is
   * safer than clearing it, because there is no moment where the two disagree.
   */
  const [opened, setOpened] = useState<{ gameId: string; board: string } | null>(null);
  const whatIfBoard = `${reportForId}|${selectedAgeGroupId}|${routeSegment ?? ""}`;
  const whatIfGameId = opened && opened.board === whatIfBoard ? opened.gameId : null;

  /*
   * Which of these fixtures can be asked about at all, worked out once for the whole schedule.
   * The expensive part is choosing the games the fit would read, and that is the same choice for
   * every row, so asking per row would pay for it once a row instead of once a board.
   */
  const asksWhatIf = Boolean(reportForId) && upcomingRows.length > 0;
  /*
   * The half of that check that reads the whole year: which clubs the board counts a game for,
   * which an opponent is checked against. It is the same for every club and every page of a year,
   * so it follows the pool rather than the page, and a switch between pages no longer pays for it
   * (about 350 ms on the 18:40 pool). Only worked out while there is a fixture to ask about.
   */
  const ratedClubs = useMemo(() => {
    if (!asksWhatIf) return null;
    // Any page of the pool names the same pool; the list always holds at least the one on screen.
    const anyPageOfThePool = (JSON.parse(poolIds) as string[])[0] ?? "";
    return ratedClubsOf(
      anyPageOfThePool,
      allKnown.teams,
      poolGames,
      ageGroups,
      routeSegment,
      today
    );
  }, [asksWhatIf, poolIds, allKnown.teams, poolGames, ageGroups, routeSegment, today]);
  const poolGameById = useMemo(
    () => (asksWhatIf ? new Map(poolGames.map((game) => [game.id, game])) : null),
    [asksWhatIf, poolGames]
  );
  const whatIfDeclineMap = useMemo(() => {
    if (!reportForId || !ratedClubs || !poolGameById) return new Map<string, null>();
    const fixtures = upcomingRows
      .map((row) => poolGameById.get(row.gameId))
      .filter((game): game is (typeof poolGames)[number] => game !== undefined);
    return whatIfDeclines(
      fixtures,
      reportForId,
      selectedAgeGroupId,
      allKnown.teams,
      poolGames,
      ageGroups,
      routeSegment,
      today,
      ratedClubs
    );
  }, [
    reportForId,
    ratedClubs,
    poolGameById,
    upcomingRows,
    poolGames,
    selectedAgeGroupId,
    allKnown.teams,
    ageGroups,
    routeSegment,
    today,
  ]);
  const whatIfDeclineFor = useCallback(
    (gameId: string) => whatIfDeclineMap.get(gameId) ?? null,
    [whatIfDeclineMap]
  );

  useEffect(() => {
    askWhatIf(
      whatIfGameId && reportForId ? { forTeamId: reportForId, gameId: whatIfGameId, today } : null
    );
  }, [askWhatIf, whatIfGameId, reportForId, today]);

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

  /**
   * Sets or clears the state a team plays in, which is what the state leaderboard files it under.
   * A team not in the pool at all is ignored rather than created.
   */
  const setTeamState = (teamId: string, nextState: string) => {
    const state = normalizeState(nextState);
    // A club League Standings made joins the roster with its state, and no other club with it:
    // the rest of the league's clubs have ids that hold only for the walk that made them.
    const adopt = scoutTeams.some((team) => team.id === teamId)
      ? undefined
      : allKnown.teams.find((team) => team.id === teamId);
    const run = runCommand({
      kind: "team.state",
      teamId,
      state: state ?? null,
      ...(adopt ? { adopt } : {}),
    });
    if (run.ok && run.writes.length > 0)
      showToast(state ? `Set to ${state}.` : "State cleared.", { tone: "success" });
    return run.ok;
  };

  /**
   * Marks (or unmarks) "our" team *for this age group only* — a club running a 9U and an 11U squad
   * at the same time needs one of each, and the old global flag could only hold one. The team is
   * persisted first so the mark survives even if it was only ever a league-derived name.
   */
  const setMyTeam = (teamId: string) => {
    if (!selectedAgeGroupId) return;
    const marked = ageGroups.find((group) => group.id === selectedAgeGroupId)?.myTeamId;
    const adopt = scoutTeams.some((team) => team.id === teamId)
      ? undefined
      : allKnown.teams.find((team) => team.id === teamId);
    runCommand({
      kind: "page.myTeam",
      ageGroupId: selectedAgeGroupId,
      teamId: marked === teamId ? null : teamId,
      ...(adopt ? { adopt } : {}),
    });
  };

  /**
   * Puts back every team the games an Undo writes name, or had a row filed against, that the roster
   * no longer has, from the roster as it stood when Remove was pressed.
   *
   * Two things take a team away between Remove and Undo. Remove team deletes the club itself when
   * nothing else holds it, and the Undo tested the roster captured at Remove, which still had the
   * club, so it was never written back: its games came back naming an id nobody held, rated for
   * no one, and neither a tidy nor a re-pull repaired them (a re-pull minted the club a new id).
   * And the tidy a removal sets off prunes a stand-in nothing stands on any more, so undoing a
   * game against one brought the game back and not its opponent. The roster is read now, not from
   * the render that showed the toast, so whatever else the tidy did is kept.
   */
  const rosterFor = (games: readonly ScoutGame[], before: readonly ScoutTeam[]): PoolCommand[] => {
    const roster = loadScoutTeams();
    const held = new Set(roster.map((team) => team.id));
    const named = filedTeamIds(games);
    games.forEach((game) => {
      named.add(game.teamAId);
      named.add(game.teamBId);
    });
    return before
      .filter((team) => named.has(team.id) && !held.has(team.id))
      .map((team, index) => ({ kind: "team.insert", team, at: roster.length + index }));
  };

  /**
   * Undoes a removal with its own inverse, which puts back exactly what it took and leaves every
   * change made since; then puts back the clubs a tidy pruned meanwhile that its games name
   * (`rosterFor`), read once the inverse has run, so a club it put back is not put back twice.
   */
  const undoRemoval = (inverse: PoolCommand, games: readonly ScoutGame[], before: ScoutTeam[]) => {
    if (!runCommand(inverse).ok) return;
    const missing = rosterFor(games, before);
    if (missing.length > 0) runCommand({ kind: "batch", commands: missing });
  };

  const removeGame = async (game: ScoutGame) => {
    const played = isScoutGamePlayed(game);
    const confirmed = await requestConfirmation({
      title: "Remove this game?",
      message: played
        ? `${teamNameById.get(game.teamAId) ?? "?"} ${game.teamAScore} – ${
            teamNameById.get(game.teamBId) ?? "?"
          } ${game.teamBScore}`
        : `${teamNameById.get(game.teamAId) ?? "?"} vs ${teamNameById.get(game.teamBId) ?? "?"} (scheduled, no score yet)`,
      confirmLabel: "Remove",
    });
    if (!confirmed) return;
    const before = scoutTeams;
    const run = runCommand({ kind: "game.remove", year: selectedYear ?? null, gameIds: [game.id] });
    if (!run.ok) return;
    showToast("Game removed.", {
      tone: "undo",
      actionLabel: "Undo",
      onAction: () => undoRemoval(run.inverse, [game], before),
    });
  };

  /**
   * Whether this page has anything of its own to remove for a team. The pool can list a team whose
   * every game is filed under a sibling age group; `removeTeam` only touches games filed here, so
   * for that team it would delete nothing and still say it had. The button is not offered instead.
   */
  const hasGamesFiledHere = (teamId: string): boolean =>
    scoutGames.some(
      (game) =>
        game.ageGroupId === selectedAgeGroupId &&
        (game.teamAId === teamId || game.teamBId === teamId)
    );

  /**
   * Removes a team from *this* age group by dropping the games logged against them here. Their
   * results in other age groups are left alone — the same club can be a 9U opponent and an 11U
   * one, and removing a stray 11U entry shouldn't wipe the 9U history. The team record itself only
   * goes when nothing is left of it anywhere.
   */
  const removeTeam = async (team: ScoutTeam) => {
    const isHere = (game: ScoutGame) =>
      game.ageGroupId === selectedAgeGroupId &&
      (game.teamAId === team.id || game.teamBId === team.id);
    const relatedGames = scoutGames.filter(isHere);
    // Every year, not the one on screen: a club with games in another season keeps its record,
    // and one a claimed row elsewhere was filed against stays for that row to go back to.
    const elsewhere = loadScoutGames().filter((game) => !isHere(game));
    const playedElsewhere =
      elsewhere.some((game) => game.teamAId === team.id || game.teamBId === team.id) ||
      filedTeamIds(elsewhere).has(team.id);
    const confirmed = await requestConfirmation({
      title: `Remove ${team.name}?`,
      message: `This removes the ${relatedGames.length === 1 ? "game" : `${relatedGames.length} games`} logged against them in ${selectedGroupName || "this age group"}.${
        playedElsewhere ? " Their games in other age groups stay." : ""
      }`,
      confirmLabel: "Remove",
    });
    if (!confirmed) return;
    const before = scoutTeams;
    const run = runCommand({
      kind: "club.leavePage",
      ageGroupId: selectedAgeGroupId,
      teamId: team.id,
    });
    if (!run.ok) return;
    // The ★ taken off with the club, and the club itself, come back with its games on Undo.
    showToast(`${team.name} removed.`, {
      tone: "undo",
      actionLabel: "Undo",
      onAction: () => undoRemoval(run.inverse, relatedGames, before),
    });
  };

  /** The team behind a row in the full table, for the Remove button that table offers. */
  const removeTeamById = (teamId: string) => {
    const team = allKnown.teams.find((t) => t.id === teamId);
    if (team) void removeTeam(team);
  };

  /**
   * Takes one GameChanger id off a team. Only the roster changes: the games that id brought in
   * stay where they are, because they happened and still belong to this team until somebody says
   * otherwise.
   */
  const unlinkGc = (teamId: string, gcTeamId: string) => {
    const run = runCommand({ kind: "team.unlinkGc", teamId, gcTeamId });
    if (run.ok && run.writes.length > 0)
      showToast("Unlinked from GameChanger.", { tone: "success" });
  };

  /**
   * Files a pulled club at the age somebody says it plays at, and holds it there.
   *
   * The club's GameChanger ids in this year are pinned in the named ages (`NamedAge.pinned`), so a
   * later pull files its schedule at this level whatever GameChanger or the app's other rules say;
   * `setClubAge` moves what is already filed. The toast's undo puts back exactly what was there.
   *
   * In the year on screen, or in the one named: Pool health lists clubs in the squad year being
   * played, whichever year the board shows, and that year's games are read for the move. Answers
   * whether anything changed, so that list can drop the club.
   */
  const setTeamAge = (teamId: string, level: number, year = selectedYear): boolean => {
    if (year === undefined) return false;
    const games = year === selectedYear ? scoutGames : loadScoutGamesForYear(year);
    const pageId = createAgeGroupId();
    // What the change will move, for the toast; the command makes it (`club.age`).
    const change = setClubAge(
      { teams: scoutTeams, games, ageGroups },
      teamId,
      level,
      year,
      "you",
      undefined,
      pageId
    );
    if (!change) return false;
    const run = runCommand({
      kind: "club.age",
      year,
      teamId,
      level,
      at: new Date().toISOString(),
      pageId,
    });
    if (!run.ok) return false;
    const name = scoutTeams.find((team) => team.id === teamId)?.name ?? "The club";
    showToast(
      `${name} is ${level}U now${change.moved > 0 ? `: ${change.moved} of its games moved to ${change.page.name}` : ""}.`,
      { tone: "undo", actionLabel: "Undo", onAction: () => runCommand(run.inverse) }
    );
    return true;
  };

  /** Applies Pool health's evidence-backed age suggestions as one write and one undo. */
  const setTeamAges = async (clubs: readonly WrongAgeClub[]) => {
    const years = [...new Set(clubs.map((club) => club.year))].sort((a, b) => a - b);
    const confirmed = await requestConfirmation({
      title: `Approve age changes for ${clubs.length} ${clubs.length === 1 ? "club" : "clubs"}?`,
      message: `${clubs.length} ${clubs.length === 1 ? "club" : "clubs"} will be moved in squad ${
        years.length === 1 ? `year ${years[0]}` : `years ${years.join(", ")}`
      }. Each suggested level comes from the evidence displayed in Pool health. “It plays up/down” remains an individual opt-out.`,
      confirmLabel: "Approve all changes",
    });
    if (!confirmed) return null;

    const { commands, changedTeamIds, moved, failed } = planClubAges(
      { teams: scoutTeams, games: wholePoolGames, ageGroups },
      clubs.map((club) => ({ teamId: club.teamId, level: club.suggested, year: club.year })),
      new Date().toISOString(),
      createAgeGroupId()
    );
    const run = commands.length > 0 ? runCommand({ kind: "batch", commands }) : null;
    if (run && !run.ok) return null;
    const result = `${changedTeamIds.length} ${changedTeamIds.length === 1 ? "club" : "clubs"} moved to ${
      changedTeamIds.length === 1 ? "its" : "their"
    } suggested age groups; ${moved} ${moved === 1 ? "game" : "games"} refiled.`;
    const failure = failed
      ? ` ${failed} ${failed === 1 ? "club could" : "clubs could"} not be changed and remain in the review list.`
      : "";
    showToast(`${result}${failure}`, {
      ...(run?.ok
        ? {
            tone: "undo" as const,
            actionLabel: "Undo",
            onAction: () => runCommand(run.inverse),
          }
        : { tone: "error" as const }),
    });
    return { changedTeamIds, failed };
  };

  /**
   * Takes back an age set on the panel: the pins come off, and each of the club's ids goes back to
   * the level the app had filed it at, until a pull decides again. An id whose earlier level was
   * never known stays where it is, no longer marked as set by you, for the next pull to decide.
   */
  const clearTeamAge = (teamId: string) => {
    if (selectedYear === undefined) return;
    const club = scoutTeams.find((team) => team.id === teamId);
    const ids = (club?.gcTeams ?? [])
      .filter((link) => gcLinkSquadYear(link, ageGroups) === selectedYear)
      .map((link) => link.teamId);
    const pinned = loadNamedAges();
    const back = new Set<number>();
    ids.forEach((id) => {
      const entry = pinned.get(id);
      if (entry?.pinned) back.add(entry.was ?? entry.level);
    });
    const run = runCommand({
      kind: "club.ageClear",
      year: selectedYear,
      teamId,
      pageId: createAgeGroupId(),
    });
    if (!run.ok) return;
    const unknown = ids.some((id) => pinned.get(id)?.pinned && pinned.get(id)?.was === undefined);
    const levels = [...back.keys()].sort((a, b) => a - b).map((level) => `${level}U`);
    const name = club?.name ?? "The club";
    showToast(
      unknown || levels.length === 0
        ? `${name} is the app's to age again at its next pull.`
        : levels.length === 1
          ? `${name} is back at ${levels[0]}, where the app had it.`
          : `${name} is back where the app had it: ${levels.join(" and ")}.`
    );
  };

  /**
   * The "same team as" the pull can only ever propose. Folding is confirmed first because it moves
   * every game and removes an entry, and a wrong one is tedious to undo by hand.
   */
  /** Answers whether the fold happened, so a list offering several can drop just the one. */
  /**
   * Throws out rows that carry a score on a day that has not happened, and remembers them.
   *
   * The tombstones go down before the games do: a pull that starts between the two writes would
   * otherwise file them straight back, and the list is much the cheaper of the two to write. What
   * it costs is that a refused pool write leaves the rows tombstoned but present — the next tidy
   * or pull settles that, and it is the safer way round.
   */
  const dropGames = async (
    ids: readonly string[],
    why: GamesDropped = "ahead"
  ): Promise<boolean> => {
    if (ids.length === 0) return false;
    const games = `${ids.length} game${ids.length === 1 ? "" : "s"}`;
    const confirmed = await requestConfirmation({
      title: `Delete ${games}?`,
      message: `${
        why === "ahead"
          ? "Each one carries a score on a date still to come, so it cannot be a result."
          : `Each one has a side winning by more than ${IMPLAUSIBLE_MARGIN} runs, which no real game ends with.`
      } The rows that carried those scores are remembered by their GameChanger id, so pulling those schedules again will not bring them back.`,
      confirmLabel: "Delete them",
    });
    if (!confirmed) return false;
    if (!runCommand({ kind: "games.drop", gameIds: [...ids] }).ok) return false;
    showToast(
      `Deleted ${games} ${why === "ahead" ? "dated ahead" : `won by more than ${IMPLAUSIBLE_MARGIN}`}.`,
      { tone: "success" }
    );
    return true;
  };

  /**
   * Counts a game won by more than `IMPLAUSIBLE_MARGIN` runs, because the user says it really was
   * played that way (`ScoutGame.scoreConfirmed`). Nothing to ask first: it is undone by deleting
   * the game, and it asks only that the rating believe a score the user has looked at.
   */
  const confirmScore = async (gameId: string): Promise<boolean> => {
    const game = wholePoolGames.find((entry) => entry.id === gameId);
    if (!game) return false;
    // The game's own year alone: the rest of the pool is as it was.
    const year = ageGroupYear(ageGroups.find((group) => group.id === game.ageGroupId)) ?? null;
    if (!runCommand({ kind: "game.confirm", year, gameId }).ok) return false;
    const nameOf = (id: string) => allKnown.teams.find((team) => team.id === id)?.name ?? id;
    showToast(
      `${nameOf(game.teamAId)} ${game.teamAScore}–${game.teamBScore} ${nameOf(game.teamBId)} counts now.`,
      { tone: "success" }
    );
    return true;
  };

  /**
   * Throws a club out: the team, every row it is in, and its GameChanger ids.
   *
   * The ids are what makes it stick. Without them the next pull reads the same schedule, rebuilds
   * the team from its profile and files a fresh set of the very rows that were deleted — so the
   * club has to be refused at the schedule, which is what `isDeletedClub` does in `importOne`.
   */
  /**
   * The teams nobody could age, and the two ways to answer for one.
   *
   * Held in state as well as storage because both answers change what the review card shows on
   * the spot — naming an age or throwing a club out takes that row out of the queue immediately,
   * without waiting for a refresh to notice.
   */
  /*
   * Re-read when Setup is opened rather than held in state: the import panel is what writes this
   * list, and a copy taken at mount would be the pool as it was before the pull that filled it.
   */
  const agelessList: AgeUnknownList = useMemo(
    () => (section === "setup" ? loadAgeUnknown() : NO_AGELESS),
    [section]
  );

  const nameAgeFor = useCallback(
    (teamId: string, name: string | undefined, level: number) => {
      // What GameChanger was saying when it was named, so a later change to its own page can be
      // told apart from the silence this is filling in — see `namedAgeStands`.
      const run = runCommand({
        kind: "namedAges",
        put: [{ teamId, level, ...(name ? { name } : {}), namedAt: new Date().toISOString() }],
        forget: [],
      });
      if (run.ok)
        showToast(`${name ?? teamId} is ${level}U. It will be filed on the next refresh.`);
    },
    [runCommand, showToast]
  );

  /** Puts a thrown-out club back, which is the whole of what the toast's undo has to do. */
  const restoreDroppedClub = useCallback(
    (teamId: string) =>
      runCommand({ kind: "answers", list: "droppedClubs", add: [], remove: [teamId] }).ok,
    [runCommand]
  );

  /**
   * Throwing out a team nobody could age. No confirmation; an undo on the toast instead.
   *
   * This is a queue worked ten at a time, and most of what is on it is junk that takes a second
   * to recognise — a page with three 20-0 wins on days that have not happened is thrown out on
   * sight. A dialog in front of every one of those is a second click on the common case to guard
   * against the rare one, which is the wrong way round: the guard belongs after the action, where
   * it costs nothing unless it is needed.
   *
   * Safe to do without asking because nothing is destroyed. The club was never filed — there is
   * nothing of it in the pool to delete — so this writes an id to a list, and the undo takes it
   * straight back off. A team that gets past the toast is still findable by name on this card,
   * which is the second way back.
   */
  const throwOutAgeless = useCallback(
    (teamId: string, name: string | undefined): boolean => {
      if (!runCommand({ kind: "answers", list: "droppedClubs", add: [teamId], remove: [] }).ok)
        return false;
      /*
       * And off the waiting list, rather than leaving the row for a later pull to clean up. The
       * row only ever left on a pull that came back with something other than "no age", so a
       * thrown-out club sat there until it was fetched again — two requests to learn a thing
       * somebody had already said. The undo below puts the id back on the queue by restoring the
       * club; the row itself returns on the next pull that reaches the team.
       */
      const waiting = forgetAgeless(loadAgeUnknown(), [teamId]);
      saveAgeUnknown(waiting);
      showToast(`${name ?? teamId} thrown out.`, {
        tone: "undo",
        actionLabel: "Undo",
        onAction: () => restoreDroppedClub(teamId),
      });
      return true;
    },
    [runCommand, showToast, restoreDroppedClub]
  );

  /**
   * Taking back an answer about a team nobody could age.
   *
   * Both stores are cleared rather than the one the reader happened to be looking at, because a
   * team can be in both — named in March and thrown out in May — and an undo that left it in the
   * other would look like it had done nothing. Deleting an id that is not there costs nothing.
   *
   * There was no way to do this at all until the search made these teams visible: both answers
   * were one-way from the UI, and a reader could see the mistake and not fix it.
   */
  const undoAgelessAnswer = useCallback(
    (teamId: string, name: string | undefined) => {
      const run = runCommand({
        kind: "batch",
        commands: [
          { kind: "answers", list: "droppedClubs", add: [], remove: [teamId] },
          { kind: "namedAges", put: [], forget: [teamId] },
        ],
      });
      if (run.ok) showToast(`${name ?? teamId} is back on the queue.`);
    },
    [runCommand, showToast]
  );

  /**
   * Taking back a whole pass, after the toast that offered it has gone.
   *
   * The rows come back from the stored pass rather than from a pull, which is the only reason a
   * bulk clear is safe to offer at all: a team refused at the door was never filed, so the row on
   * the waiting list is the only record that it was ever asked about. Undoing by re-fetching
   * would cost two requests a team to learn what was already known.
   */
  const undoClearedPass = useCallback(async () => {
    const pass = await loadAgelessCleared();
    if (!pass) {
      showToast("That pass is no longer stored, so there is nothing to put back.", {
        tone: "error",
      });
      return;
    }
    const ids = clearedIds(pass);
    if (!runCommand({ kind: "answers", list: "droppedClubs", add: [], remove: ids }).ok) return;
    saveAgeUnknown(restoreCleared(loadAgeUnknown(), pass));
    await clearAgelessCleared();
    showToast(`${describeCleared(pass)} back on the list.`);
  }, [runCommand, showToast]);

  /**
   * Clearing the rows a rule has settled, in one pass: GameChanger's own answers, and the rules the
   * user settled — named void, tee ball and younger, rec ball in a closed league.
   *
   * Asks first, where the single throw-out deliberately does not. The argument there is that a
   * dialog in front of the common case costs a click to guard against the rare one; here the
   * action *is* the rare one, thousands of rows at once, and nobody can check it by eye
   * afterwards. So the dialog says how many each rule is clearing.
   *
   * One write per store rather than one per row: `forgetClubs` and `forgetAgeless` both take
   * arrays, so twenty thousand teams is two writes and one render, not forty thousand. The rows
   * are stored whole before they go, which is what makes the undo real rather than a toast
   * somebody had to catch.
   */
  const clearAgelessRows = useCallback(
    async (chosen: readonly AgelessAnswered[]): Promise<boolean> => {
      const rows = chosen.flatMap(({ row, rule, verdict }) =>
        isClearedReason(verdict.kind) ? [{ row, rule, why: verdict.kind }] : []
      );
      if (rows.length === 0) return false;
      const byRule = new Map<string, { label: string; count: number }>();
      rows.forEach(({ rule }) => {
        const known = byRule.get(rule.id);
        if (known) known.count += 1;
        else byRule.set(rule.id, { label: rule.label, count: 1 });
      });
      const breakdown = [...byRule.values()]
        .map(({ label, count }) => `${count.toLocaleString()}: ${label}`)
        .join("\n");
      const confirmed = await requestConfirmation({
        title: `Clear ${rows.length.toLocaleString()} teams?`,
        message:
          `${breakdown}\n\n` +
          "They leave the list and no later pull asks about them again. Nothing in the pool is " +
          "touched, and the pass can be undone afterwards.",
        confirmLabel: "Clear them",
      });
      if (!confirmed) return false;

      const ids = rows.map(({ row }) => row.teamId);
      // Stored before anything is removed: a pass that cannot be undone must not have happened.
      const pass = agelessClearedPass(
        rows.map(({ row, why }) => ({ entry: row, why })),
        new Date().toISOString()
      );
      const kept = await saveAgelessCleared(pass);

      if (!runCommand({ kind: "answers", list: "droppedClubs", add: ids, remove: [] }).ok)
        return false;
      saveAgeUnknown(forgetAgeless(loadAgeUnknown(), ids));

      showToast(
        `${rows.length.toLocaleString()} teams cleared.` +
          (kept ? "" : " The undo could not be stored, so this one cannot be taken back."),
        kept
          ? { tone: "undo", actionLabel: "Undo", onAction: () => void undoClearedPass() }
          : { tone: "error" }
      );
      return true;
    },
    [runCommand, showToast, requestConfirmation, undoClearedPass]
  );

  /**
   * Deletes a club off the list of clubs that may not be real: the club, every row it is in, and
   * its GameChanger ids, which a later pull then refuses. At once, without asking: the user, going
   * down a list of 9,999-0 winners, said on 28 September 2026 to take the dialog away and that they
   * would take their chances.
   */
  const dropClub = async (club: UnrealClub): Promise<boolean> => {
    // The club, every game it is in, the rows they stood on and its GameChanger ids (`club.drop`);
    // the ids reach the view's own list too, so a list pasted in this session skips it.
    if (!runCommand({ kind: "club.drop", teamId: club.teamId }).ok) return false;
    showToast(`Deleted ${club.name}.`, { tone: "success" });
    return true;
  };

  /** The clubs of a pair League Standings made that the roster does not hold, to join it. */
  const unheldOf = (...ids: string[]): ScoutTeam[] =>
    ids.flatMap((id) =>
      scoutTeams.some((team) => team.id === id)
        ? []
        : allKnown.teams.filter((team) => team.id === id)
    );

  /**
   * What games added put right on the clubs they name that the roster already holds: a name the
   * lookup cleaned of an age label it was stored with (`resolveOrCreateTeam`), and a state the
   * schedule import filled in from its file where the club had none (it never replaces one). Only
   * those two, laid over the club as stored, so nothing else League Standings worked out for it on
   * the fly is written; and only on the clubs the games name, so a club the add did not touch is
   * not written for a name the walk cleaned on its own.
   */
  const heldHeals = (next: readonly ScoutTeam[], named: ReadonlySet<string>): PoolCommand[] =>
    next.flatMap((team): PoolCommand[] => {
      if (!named.has(team.id)) return [];
      const was = scoutTeams.find((held) => held.id === team.id);
      if (!was || (was.name === team.name && was.state === team.state)) return [];
      const state = team.state === undefined ? {} : { state: team.state };
      return [{ kind: "team.put", team: { ...was, name: team.name, ...state } }];
    });

  /** Games added, with the heals of the held clubs they name, as one change. */
  const withHeals = (heals: PoolCommand[], add: PoolCommand): PoolCommand =>
    heals.length === 0 ? add : { kind: "batch", commands: [...heals, add] };

  const mergeInto = async (fromId: string, intoId: string): Promise<boolean> => {
    const from = allKnown.teams.find((team) => team.id === fromId);
    const into = allKnown.teams.find((team) => team.id === intoId);
    if (!from || !into) return false;
    const preview = mergeScoutTeams(fromId, intoId, scoutTeams, loadScoutGames(), ageGroups);
    const confirmed = await requestConfirmation({
      title: `Fold ${from.name} into ${into.name}?`,
      message: `Every game moves to ${into.name} and ${from.name} is removed.${
        preview.droppedGames > 0
          ? ` ${preview.droppedGames} game${preview.droppedGames === 1 ? "" : "s"} between the two cannot survive the merge and will be dropped.`
          : ""
      }`,
      confirmLabel: "Fold in",
    });
    if (!confirmed) return false;
    const run = runCommand({
      kind: "teams.merge",
      fromId,
      intoId,
      adopt: unheldOf(fromId, intoId),
    });
    if (!run.ok) return false;
    setOpenTeamId(intoId);
    showToast(`Folded into ${into.name}.`, { tone: "success" });
    return true;
  };

  /**
   * Every game the search can land on: the league's derived fixtures and every stored year, read
   * when the index is built. Stable across renders so the index is rebuilt on a change, not a render.
   */
  const everyKnownGame = useCallback(
    () => clubSearchGames(allKnown.derivedGames, loadScoutGames(), allKnown.teams, ageGroups),
    [allKnown.derivedGames, allKnown.teams, ageGroups]
  );
  /**
   * Where a GameChanger id pasted into Find a team is when no club there carries it (`whereIsGcId`).
   * Read when asked rather than kept: it is asked only of an id nothing matched, and the lists it
   * reads are cached in memory already.
   */
  const explainGcId = useCallback(
    (gcTeamId: string) =>
      whereIsGcId(gcTeamId, {
        ...(pullLive ? { liveTeams: scoutTeams } : {}),
        ageless: loadAgeUnknown(),
        dropped: droppedClubs,
        tooYoung: loadTooYoungClubs(),
      }),
    [pullLive, scoutTeams, droppedClubs]
  );
  const { searchOptions, pageOf, mergeCandidatesFor } = useClubSearch({
    teams: allKnown.teams,
    games: everyKnownGame,
    ageGroups,
    rankedTeams,
    /*
     * Not rebuilt while a pull is running, and that is the expensive half of this.
     *
     * Rebuilding the index reads every stored year and walks every team against every game, and a
     * pull runs from Import, where the index is on, so every save during a run rebuilt the whole
     * thing. The revision is not enough to stop it, because a save hands back new `teams` and
     * `ageGroups` arrays and the index follows those by identity, as it should.
     *
     * It used to be switched off for the run instead, which took the Find a team box off the top
     * of Rankings for as long as a pull went on, an hour and more on a nationwide list, with
     * nothing to say why: the user asked where it had gone on 28 September 2026. Held, the box
     * stays and searches the pool as it stood when the run began, and the index is built once
     * more when the run lets go.
     */
    enabled: section !== "setup",
    hold: pullLive,
    revision: settledRevision,
  });

  /** Goes to the page a team is on and opens it, whichever season and level that turns out to be. */
  const openSearchedTeam = (teamId: string) => {
    const page = pageOf(teamId);
    if (page) openPage(page.ageGroupId);
    setOpenTeamId(teamId);
  };

  /**
   * The same, from a list further up the page, Pool health's: the panel opens below everything,
   * out of sight of the list, so it is brought into view once it is there.
   */
  const openListedTeam = (teamId: string) => {
    /*
     * The search's page index is not built in Setup, where these lists are, so the page is the one
     * a GameChanger id of the club's own is filed under, the latest year's: opened on another page,
     * the panel showed none of the games the list had named.
     */
    const page =
      pageOf(teamId)?.ageGroupId ??
      allKnown.teams
        .find((known) => known.id === teamId)
        ?.gcTeams?.map((link) => ageGroups.find((group) => group.id === link.ageGroupId))
        .filter((group): group is AgeGroup => group !== undefined)
        .sort((a, b) => (ageGroupYear(b) ?? 0) - (ageGroupYear(a) ?? 0))[0]?.id;
    if (page) openPage(page);
    setOpenTeamId(teamId);
    window.requestAnimationFrame(() =>
      document.getElementById(TEAM_PANEL_ID)?.scrollIntoView?.({ block: "start" })
    );
  };

  const openTeam = openTeamId ? (allKnown.teams.find((t) => t.id === openTeamId) ?? null) : null;
  /** The open club's level in this year and whether it was set by hand (`clubAgeOf`). */
  const openTeamAge = useMemo(
    () => (openTeam ? clubAgeOf(openTeam, selectedYear, ageGroups, namedAges) : undefined),
    [openTeam, selectedYear, ageGroups, namedAges]
  );

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

  const scoresBothBlank = gameDraft.teamAScore.trim() === "" && gameDraft.teamBScore.trim() === "";
  const scoresBothValid =
    gameDraft.teamAScore.trim() !== "" &&
    gameDraft.teamBScore.trim() !== "" &&
    Number.isFinite(Number(gameDraft.teamAScore)) &&
    Number(gameDraft.teamAScore) >= 0 &&
    Number.isFinite(Number(gameDraft.teamBScore)) &&
    Number(gameDraft.teamBScore) >= 0;
  const addGameValid =
    Boolean(selectedAgeGroupId) &&
    gameDraft.teamAName.trim().length > 0 &&
    gameDraft.teamBName.trim().length > 0 &&
    gameDraft.teamAName.trim().toLowerCase() !== gameDraft.teamBName.trim().toLowerCase() &&
    (scoresBothBlank || scoresBothValid);

  const addGame = async () => {
    if (!addGameValid) {
      showToast("Enter both team names, and either both scores or neither.", { tone: "error" });
      return;
    }
    let teams = allKnown.teams;
    const a = resolveOrCreateTeam(gameDraft.teamAName, teams);
    teams = a.teams;
    const b = resolveOrCreateTeam(gameDraft.teamBName, teams);
    teams = b.teams;
    const newGame: ScoutGame = {
      id: `scout_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      teamAId: a.teamId,
      teamBId: b.teamId,
      ageGroupId: selectedAgeGroupId,
      ...(scoresBothValid
        ? { teamAScore: Number(gameDraft.teamAScore), teamBScore: Number(gameDraft.teamBScore) }
        : {}),
      ...(gameDraft.date ? { date: gameDraft.date } : {}),
      ...(gameDraft.event.trim() ? { event: gameDraft.event.trim() } : {}),
    };

    // Same teams, same date, same score as something already here (logged by hand, imported, or
    // pulled from the league schedule) — check before double-counting it into the rating.
    const duplicate = findDuplicateGame(newGame, ageGroupGames);
    if (duplicate) {
      const nameOf = (id: string) =>
        teams.find((team) => team.id === id)?.name ?? teamNameById.get(id) ?? "?";
      const scoreLine = isScoutGamePlayed(duplicate)
        ? `${nameOf(duplicate.teamAId)} ${duplicate.teamAScore} – ${nameOf(duplicate.teamBId)} ${duplicate.teamBScore}`
        : `${nameOf(duplicate.teamAId)} vs ${nameOf(duplicate.teamBId)} (scheduled, no score yet)`;
      const confirmed = await requestConfirmation({
        title: "Already logged?",
        message: `${scoreLine}${duplicate.date ? ` on ${duplicate.date}` : ""} is already in this age group with the same date and score.\n\nAdding it again counts it twice in the rankings.`,
        confirmLabel: "Add anyway",
      });
      if (!confirmed) return;
    }

    // The roster takes only the clubs this game names that it does not hold yet: one typed for
    // the first time, or one League Standings made. Every other club League Standings made stays
    // out of it, its id holding only for the walk that minted it.
    const held = new Set(scoutTeams.map((team) => team.id));
    const named = new Set([newGame.teamAId, newGame.teamBId]);
    const adopt = teams.filter((team) => !held.has(team.id) && named.has(team.id));
    const add: PoolCommand = {
      kind: "game.add",
      year: selectedYear ?? null,
      games: [newGame],
      adopt,
    };
    if (!runCommand(withHeals(heldHeals(teams, named), add)).ok) return;
    noteAdded([newGame.id]);
    setGameDraft(EMPTY_ADD_GAME_DRAFT);
    showToast(scoresBothValid ? "Game added." : "Added to schedule.", { tone: "success" });
  };

  /**
   * Commits a reviewed batch of imported games. The panel has already resolved names
   * through `resolveOrCreateTeam` (so they arrive age-free and linked to existing teams) and has
   * dropped anything already logged here, so this just saves and offers an undo for the lot.
   */
  const importGames = (nextTeams: ScoutTeam[], newGames: ScoutGame[]) => {
    const held = new Set(scoutTeams.map((team) => team.id));
    const named = new Set(newGames.flatMap((game) => [game.teamAId, game.teamBId]));
    const adopt = nextTeams.filter((team) => !held.has(team.id) && named.has(team.id));
    const run = runCommand(
      withHeals(heldHeals(nextTeams, named), {
        kind: "game.add",
        year: selectedYear ?? null,
        games: newGames,
        adopt,
      })
    );
    if (!run.ok) return;
    noteAdded(newGames.map((game) => game.id));
    setImportOpen(false);
    // Undo takes the games back out, and the clubs they brought with them.
    showToast(`Added ${newGames.length} game${newGames.length === 1 ? "" : "s"}.`, {
      tone: "undo",
      actionLabel: "Undo",
      onAction: () => runCommand(run.inverse),
    });
  };

  /**
   * Keeps a game in the log but out of the maths, or puts it back. Fall tournaments pair a team
   * against the age above or below depending on who entered; those results are real and worth
   * having, but they say nothing about how a team stacks up inside its own age group.
   */
  const toggleGameExcluded = (game: ScoutGame) => {
    const excluded = game.excluded !== true;
    const run = runCommand({
      kind: "game.exclude",
      year: selectedYear ?? null,
      gameId: game.id,
      excluded,
    });
    if (run.ok)
      showToast(excluded ? "Game no longer counts." : "Game counts again.", { tone: "success" });
  };

  const startEditScore = (gameId: string) => {
    setEditingGameId(gameId);
    setEditScoreA("");
    setEditScoreB("");
  };

  const saveGameScore = (gameId: string) => {
    const typed = typedScores(editScoreA, editScoreB);
    if (!typed) {
      showToast("Enter two scores, in whole runs.", { tone: "error" });
      return;
    }
    if (!runCommand({ kind: "game.score", year: selectedYear ?? null, gameId, ...typed }).ok)
      return;
    setEditingGameId(null);
    setEditScoreA("");
    setEditScoreB("");
    showToast("Score saved.", { tone: "success" });
  };

  // ---------- Starting over ----------

  /**
   * The whole pool as one JSON file, which is how the data comes back — and the only reason the
   * reset below can be offered at all.
   *
   * JSON rather than the CSV it used to be because the pool is nested: a team carries a list of
   * GameChanger links, each with its own staff list and season record, and a table has nowhere to
   * put that. Restoring still reads either, because files written before this exist.
   */
  const downloadPoolBackup = async () => {
    /*
     * The archives are loaded here and nowhere else in the app. They are read on demand precisely
     * so that they are not in memory, and a backup is the one job that needs all of them at once —
     * and needs them, because an archived table is the only copy of that season and this file is
     * what the reset card offers as the way back.
     */
    const backup = { ...readTeamRankingsBackup(), archives: await loadAllArchivedSeasons() };
    const estimate = estimateBackupBytes(backup);

    // A nationwide pool makes a file that takes a moment to put together and will not open in
    // every spreadsheet. Somebody who pressed this meaning to glance at their own league's rows
    // should hear that before waiting for it.
    if (estimate >= LARGE_BACKUP_BYTES) {
      const go = await requestConfirmation({
        title: "That is a large backup",
        message: `${summarizeTeamRankingsBackup(backup)}

The file will be around ${formatBytes(estimate)} and will take a moment to put together.`,
        confirmLabel: "Download anyway",
      });
      if (!go) return;
    }

    /*
     * Written in pieces rather than as one string. At twenty thousand teams the joined copy is
     * tens of megabytes and exists alongside the rows it was built from at the moment of the join,
     * which is exactly the peak a phone cannot afford. A Blob is assembled from parts perfectly
     * well, so the join never happens.
     */
    const savedAt = new Date().toISOString();
    const parts = teamRankingsJsonParts(backup, savedAt);
    if (parts.length === 0) {
      showToast("Nothing to back up yet.", { tone: "error" });
      return;
    }
    const blob = new Blob(parts, { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `Team_Rankings_Backup_${savedAt.slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    showToast(`Backup downloaded (${formatBytes(blob.size)}).`, { tone: "success" });
    noteBackupTaken("pool");
    setPoolBackupAt(lastBackupTakenAt("pool"));
  };

  /**
   * Empties Team Rankings: every age group, team and game, plus the cursor of any interrupted
   * GameChanger pull and the weekly refresh log. The counts go into the confirmation because the
   * number of games about to disappear is the whole of what makes this decision easy or hard.
   *
   * Afterwards the view is put back to its first-visit state by hand rather than by reloading the
   * page — a reload would throw away a League Standings edit the user has not saved yet, and
   * everything here that came out of storage is named right below.
   */
  /*
   * What each baseball year holds, for the card that offers to freeze one.
   *
   * One pass over the stored games rather than a filter per year: on a nationwide pool there are
   * three hundred thousand of them and half a dozen years, and the card re-renders on every pick.
   * The stored games, because those are the ones a delete can take — the league's fixtures are
   * derived and go from the archive's point of view by the page going, not by being deleted.
   */
  const archivableSummaries = useMemo(
    () => summariseYears(ageGroups, storedYears, archives),
    [ageGroups, storedYears, archives]
  );

  /**
   * Freezes a baseball year's tables and deletes the games behind them.
   *
   * The tables are built from the merged pool, so what is frozen is what was on screen — the
   * league's own fixtures included, which is why the confirmation says they go too. What is
   * deleted is the stored pool only, because derived fixtures were never stored.
   *
   * Order matters and is the reason this is not two calls: the archive is written and confirmed
   * first, and the games are deleted only if it landed. A half-written archive with the games
   * already gone is the one outcome there is no coming back from.
   */
  const archiveYear = async (year: number) => {
    // Every year: the one being archived need not be the one on screen.
    const everyGame = loadScoutGames();
    const shown = {
      teams: allKnown.teams,
      games: dedupeLeagueFixtures(
        [...allKnown.derivedGames, ...everyGame],
        leagueStandIns(allKnown.teams, ageGroups)
      ),
    };
    const stored = { ageGroups, teams: scoutTeams, games: everyGame };
    /*
     * Whether the pool was tidy before this, checked before anything changes.
     *
     * What survives an archive is a subset of what was there — whole pages removed, with their
     * games and the clubs the year was all there was of — and taking things away leaves a tidy
     * nothing new to do. So a tidy pool stays tidy, and stamping the smaller one saves a full
     * worker pass over three hundred thousand games for nothing. An untidy pool leaves the stamp alone, so the tidy still comes.
     */
    const wasTidy = loadTidyStamp() === poolSignature(stored);
    const done = archiveSquadYear(year, shown, stored, new Date().toISOString());

    const preview = archivePreviewOf(done);
    if (!archivesAnything(preview)) {
      showToast(nothingUnder(year), { tone: "error" });
      return;
    }

    const confirmed = await requestConfirmation(archiveConfirmation(year, preview));
    if (!confirmed) return;

    setArchiving(true);
    try {
      const kept = await saveArchivedSeasons(done.seasons);
      if (!kept) {
        showToast("Could not write the archive, so nothing was deleted. The pool is unchanged.", {
          tone: "error",
        });
        return;
      }
      // Only now: the tables are on disk, so the games they replace can go. The year empties
      // before its pages go, as storage needs (`writePool`).
      const deleted = runCommand(changeBetween(poolParts(stored), poolParts(done.state)), {
        explains: true,
      });
      if (!deleted.ok) {
        showToast("The tables are kept under Archive, but the year's games could not be deleted.", {
          tone: "error",
        });
        setArchives(loadArchiveIndex());
        return;
      }
      if (wasTidy) saveTidyStamp(poolSignature(done.state));
      setArchives(loadArchiveIndex());
      pickPage("");
      setOpenTeamId(null);
      setReportTeamId("");
      showToast(archivedSaid(year, { ...preview, tables: kept.map(archiveTableOf) }));
      onDataChange?.();
    } finally {
      setArchiving(false);
    }
  };

  /**
   * Deletes a whole squad year with nothing kept: its pages, their stored games, the clubs no
   * other year holds, the GameChanger ids filed under it, and its archived tables.
   *
   * The same writes as `archiveYear` in the same order — games while the pages that name them
   * are still stored, then the pages — without the archive in front of them. The archived tables
   * go last, one at a time: the pool is the part that matters, and a table that fails to go is
   * still listed under Archive, where it can be seen.
   */
  const deleteYear = async (year: number) => {
    const everyGame = loadScoutGames();
    const stored = { ageGroups, teams: scoutTeams, games: everyGame };
    // Whether the pool was tidy before this, for the reason `archiveYear` gives.
    const wasTidy = loadTidyStamp() === poolSignature(stored);
    const done = deleteSquadYear(year, stored, archives);

    const preview = deletePreviewOf(done);
    if (!deletesAnything(preview)) {
      showToast(nothingUnder(year), { tone: "error" });
      return;
    }

    const confirmed = await requestConfirmation(deleteConfirmation(year, preview));
    if (!confirmed) return;

    setArchiving(true);
    try {
      // The year empties before its pages go, as storage needs (`writePool`).
      if (!runCommand(changeBetween(poolParts(stored), poolParts(done.state))).ok) return;
      if (wasTidy) saveTidyStamp(poolSignature(done.state));
      let tablesLeft = 0;
      for (const id of done.archiveIds) {
        if (!(await forgetArchivedSeason(id))) tablesLeft += 1;
      }
      setArchives(loadArchiveIndex());
      pickPage("");
      setOpenTeamId(null);
      setReportTeamId("");
      showToast(
        `${year} deleted.` +
          (tablesLeft > 0
            ? ` ${tablesLeft} archived table${tablesLeft === 1 ? "" : "s"} could not be removed and ${tablesLeft === 1 ? "is" : "are"} still under Archive.`
            : ""),
        tablesLeft > 0 ? { tone: "error" } : { tone: "success" }
      );
      onDataChange?.();
    } finally {
      setArchiving(false);
    }
  };

  const resetEverything = async () => {
    const going = readTeamRankingsBackup();
    const confirmed = await requestConfirmation({
      title: "Delete everything in the app?",
      message: `${summarizeTeamRankingsBackup(going)}

All of it goes, and so does everything else the app keeps in this browser: every League Standings season with its schedules and scores, the clubs and games you threw out, the ages you named by hand, the teams waiting on an age, the Organizations file and your settings. The app then starts again as if it had never been opened.

This cannot be undone. Cancel and download the backups first if there is any chance you will want any of it again.`,
      confirmLabel: "Delete everything",
    });
    if (!confirmed) return;

    const outcome = await resetApp();
    if (outcome !== "done") {
      showToast(
        outcome === "unreachable"
          ? "Could not reset the app — this browser cannot reach where the pool is kept, so nothing was deleted."
          : "The reset did not finish — this browser would not delete all of the pool. League Standings and your settings were left alone; try again.",
        { tone: "error" }
      );
      return;
    }
    // Every view holds copies of what it read; only a fresh start is sure to hold none.
    reloadApp();
  };

  // Scoped to this age group and the ones it continues from: a 9U opponent has no business being
  // suggested while logging an 11U game, even though both squads share one roster store.
  const suggestedTeams = useMemo(
    () => teamNameSuggestions(selectedAgeGroupId, ageGroups, allKnown.teams, chainGames),
    [selectedAgeGroupId, ageGroups, allKnown.teams, chainGames]
  );
  const teamNameOptions = useMemo(() => suggestedTeams.map((team) => team.name), [suggestedTeams]);

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
          broken one possible at all.
        */}
        <ErrorBoundary key={section} area={sectionLabel(section)}>
          {section === "rankings" && (
            <RankingsBoards
              groupName={selectedGroupName}
              searchOptions={searchOptions}
              onSearchTeam={openSearchedTeam}
              explainGcId={explainGcId}
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
              onShownStateChange={setStateTop}
              unknownStateCount={unknownStateCount}
              stateFilter={stateFilter}
              onStateFilterChange={setStateFilter}
              showAll={showAll}
              onToggleShowAll={() => setShowAll((value) => !value)}
              placeOf={placeOf}
              isLeagueTeam={(teamId) => leagueGameTeamIds.has(teamId)}
              hasGamesFiledHere={hasGamesFiledHere}
              onOpenTeam={setOpenTeamId}
              onMarkMine={setMyTeam}
              myTeam={myTeam}
              {...(rankHistory ? { rankHistory } : {})}
              movementOf={boardMovement}
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
              allTeams={allKnown.teams}
              suggestedTeams={suggestedTeams}
              existingGames={ageGroupGames}
              onImportGames={importGames}
              showToast={showToast}
              loggedGames={ageGroupManualGames}
              gamesWindow={gamesWindow}
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
            <TournamentPanel
              key={selectedAgeGroupId}
              ageGroupId={selectedAgeGroupId}
              rankings={rankings}
              reportForId={reportForId}
              upcomingRows={upcomingRows}
              placeOf={placeOf}
            />
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
          mergeCandidates={mergeCandidatesFor(openTeam.id)}
          onSetState={(state) => setTeamState(openTeam.id, state)}
          onClose={() => setOpenTeamId(null)}
        />
      )}
    </div>
  );
}
