import {
  lazy,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  Suspense,
  type ReactNode,
} from "react";
import { registerSW } from "virtual:pwa-register";
import type { Command } from "./components/CommandPalette";
import type { H2HCell } from "./components/charts/HeadToHeadMatrix";
import { CloudButton, useCloudPanel } from "./components/CloudButton";
import { liveBoardWanted, RankingsOpen } from "./components/RankingsOpen";
import { loadTeamRankingsView } from "./components/teamRankingsChunk";
import {
  cloudStatus,
  leagueInStep,
  loadNewer,
  startCloudSession,
  subscribeCloud,
} from "./lib/cloud/cloudSession";
import { leagueMetHere, loadCloudState } from "./lib/cloud/cloudState";
import { editable, reachable } from "./lib/live/leagueSync";
import {
  leagueArriving,
  leagueLiveWanted,
  memberSignedIn,
  SEASON_DELETE_OFFLINE,
  seasonDeleteRefused,
  seasonDeleteRoute,
} from "./lib/live/leagueWanted";
import type { LocalSeasons } from "./lib/live/leagueSeasons";
import { subscribeLeagueMet } from "./lib/preferences";
import { askLeague, LEAGUE_UNANSWERED } from "./lib/live/leagueAsk";
import { useLiveLeague } from "./hooks/useLiveLeague";
import {
  editingOffBecause,
  LiveLeagueBanner,
  needsAPerson,
} from "./components/league/LiveLeagueBanner";
import { EditLock, SeasonEditable } from "./components/league/EditLock";
import { RANKINGS_COMMAND_SECTIONS, rankingsSectionCommandId } from "./lib/rankingsRoute";
import { recordDiagnostic } from "./lib/diagnostics";
import { useClinchScenarios } from "./hooks/useClinchScenarios";
import { useSeedRanges } from "./hooks/useSeedRanges";
import { useSeasons } from "./hooks/useSeasons";
import { useSeasonFiles, type ImportedSeason } from "./hooks/useSeasonFiles";
import { useSeasonState, type SeasonState } from "./hooks/useSeasonState";
import { useScoutBridge } from "./hooks/useScoutBridge";
import { finalScoresKey, leagueFixturesOf } from "./lib/teamRankings";
import { LoadingPanel } from "./components/LoadingPanel";
import { ErrorBoundary } from "./components/ErrorBoundary";
import {
  compareDrawerView,
  dashboardView,
  forecastView,
  LIKELY_NEXT,
  playoffMachineView,
  powerView,
  prefetchView,
  qualityView,
  resetView,
  scheduleView,
  scoutLinkView,
  seasonManagerView,
  settingsView,
  standingsView,
  statsView,
  teamDrawerView,
} from "./components/league/leagueViews";
import {
  applyLeagueScoreFill,
  planLeagueScoreFill,
  summarizeLeagueFill,
  type LeagueFillPlan,
  type RecordedRuns,
} from "./lib/leagueScoreFill";
import {
  loadAgeGroups,
  loadScoutGamesForSeason,
  loadScoutTeams,
  isPoolUnavailable,
  onPoolWriteError,
} from "./lib/teamRankingsStorage";
import {
  readNotifyPrefs,
  readOurTeam,
  readPutAside,
  readSummaryMode,
  subscribeNotifyPrefs,
  writeNotifyPrefs,
  writeOurTeam,
  writePutAside,
  writeSummaryMode,
  type SummaryMode,
} from "./lib/preferences";
import { digestOddsMove, raceOf, type NotifyPrefs } from "./lib/seasonDigest";
import { useSeasonDigest } from "./hooks/useSeasonDigest";
import { useDigestNotifications } from "./hooks/useDigestNotifications";
import { ourTeamSummary } from "./lib/ourTeam";
import { leagueClubRankFor } from "./lib/leagueClubRanks";
import { OurTeamCard } from "./components/league/OurTeamCard";
import type { LiveSeasonData } from "./lib/backup";
import { ToastView } from "./components/Toast";
import { useAppMode } from "./hooks/useAppMode";
import { useDarkMode } from "./hooks/useDarkMode";
import { useConfirmation } from "./hooks/useConfirmation";
import { useLeagueCommands } from "./hooks/useLeagueCommands";
import { useUndoSnapshot, type UndoableSeason } from "./hooks/useUndoSnapshot";
import { useShortcuts, type Shortcut } from "./hooks/useShortcuts";
import { useLeagueSummary } from "./hooks/useLeagueSummary";
import { useToast } from "./hooks/useToast";
import { useUrlSnapshot } from "./hooks/useUrlState";
import {
  useSimulationBracket,
  useSimulationOdds,
  useSimulationTrend,
} from "./hooks/useSimulationWorker";
import { clinchingPathsForTeams, goldCutLineSnapshot } from "./lib/clinchingPaths";
import {
  formatGameDate,
  normalizeDateInput,
  parseDateValue,
  seasonStartMonth,
  todayIsoDay,
} from "./lib/date";
import {
  builderTeamNames,
  buildRoundRobin,
  roundRobinCsv,
  roundRobinFileName,
} from "./lib/roundRobin";
import { headToHeadCell as cellFor, sosRanks, teamsOnBubble } from "./lib/standingsViews";
import { displayName, recordText } from "./lib/format";
import { pathSummary, recapToMarkdown, recapToStoryBrief } from "./lib/insights";
import { buildForecastSummaryRequest, buildLeagueSummaryRequest } from "./lib/leagueSummaryClient";
import { eliminationNumberForGold, magicForGold } from "./lib/magic";
import { backtestPredictions } from "./lib/backtest";
import { buildPredictionEngine } from "./lib/predictionEngine";
import { buildBracketProjection } from "./lib/bracket";
import { scheduleDifficultyForTeam as buildScheduleDifficultyForTeam } from "./lib/scheduleDifficulty";
import { buildShareUrl } from "./lib/share";
import { formatProbabilityMargin, wilsonScoreInterval } from "./lib/probability";
import {
  finalToggled,
  withFinal,
  nameFrom,
  PROJECT_STANDINGS_REMAINING_GAME_LIMIT,
  type RecapPool,
} from "./lib/impactRecap";
import { buildSeasonTimeline, type SeasonTimelineEntry } from "./lib/seasonTimeline";
import { rememberLast } from "./lib/rememberLast";
import {
  auditLeague,
  copiesToDelete,
  isDismissed,
  repairIsDestructive,
  repairPreview,
  type Finding,
  type FindingRepair,
  type FindingSeverity,
  type FindingTarget,
} from "./lib/leagueFindings";
import { useToday } from "./hooks/useToday";
import { useNarrowViewport } from "./hooks/useWideViewport";
import { TabNav, type TabNavItem } from "./components/TabNav";
import { NAV_ICONS } from "./components/navIcons";
import {
  applyResult,
  attachAdjustedRatings,
  calculateTeams,
  getMathGoldStatus,
  getRemainingCounts,
  isSeedingLocked,
  predictGame,
  projectStandings,
  rankOptionsFromSettings,
  rankTeams,
  simulationSeed,
} from "./lib/sim";
import { buildTrendStates } from "./lib/trend";
import {
  addSeasons,
  adoptSeasonCreatedAt,
  getActiveSeasonId,
  listSeasons,
  loadBracketLogs,
  loadLogs,
  loadMatchups,
  loadSettings,
  loadTeams,
  readSeasonSnapshot,
  saveBracketLogs,
  writeSeasonData,
  saveLogs,
  saveMatchups,
  saveSettings,
  saveTeams,
} from "./lib/storage";
import {
  DEFAULT_GOLD_CUTOFF,
  DEFAULT_SETTINGS,
  SIM_ITERATIONS,
  TREND_ITERATIONS,
  TREND_STATES,
  type ActiveShareView,
  type GameLog,
  type Matchup,
  type SwingGame,
  type Team,
  type LastImpact,
  type TeamBase,
  type TeamWithProjection,
} from "./lib/types";
import {
  buildLeagueAverageStats,
  buildTeamSplitSummary,
  buildTeamStatRankings,
  emptySplitLine,
} from "./lib/teamStats";
import { buildDemoSeason } from "./lib/demoSeason";
import { buildTeamTrendSummary } from "./lib/teamTrend";
import { blankLog, clamp, isFinal, swappedLog } from "./lib/util";
import { linkedTeamIdFromUrl, projectedRunLine, TEAM_QUERY_PARAM } from "./lib/teamLink";
import { HeaderStatCard } from "./components/HeaderStatCard";
import { EmptyState } from "./components/league/EmptyState";
import { button as buttonClasses, focusRing, tab } from "./styles/tokens";
import {
  formatGoldPct as formatGoldPctValue,
  titleRaceBadgeForTeam as titleRaceBadgeForTeamValue,
} from "./lib/standingsView";

type ActiveView = ActiveShareView;

type ScoreboardPrediction = {
  spread: string;
  pickName: string;
  pickPct: number;
  scenarioBadges: string[];
  impactScore: number;
};

// Keep the synchronous exact solver capped below browser-freezing schedule sizes.
// The solver branches exponentially over every unfinished game (including ties),
// so larger schedules should continue showing the paused message until this
// computation moves off the React render path.
const EXACT_MAGIC_REMAINING_GAME_LIMIT = 15;
// One-game seed swing projections are O(remaining games²) because each game
// needs away-win and home-win season projections. On a freshly imported full
// schedule this can otherwise block the browser before the confirmation toast
// and first render complete.
const EXACT_SCENARIO_REMAINING_GAME_LIMIT = 60;
// Full-season imports can contain hundreds of open games. Projecting every
// remaining game synchronously is useful late in the season, but it can block
// the browser immediately after import or while saving a final. Keep the UI
// responsive by falling back to current standings until the schedule is small
// enough for synchronous projection work.
const SCOREBOARD_PREDICTION_CHUNK_SIZE = 24;

/*
 * The two heaviest calculations one tab alone shows, each remembering its last answer, so going
 * back to its tab on an unchanged season gives it at once (`rememberLast`, 2.2); and what stands in
 * for each while no tab showing it is open.
 */
const rememberedBacktest = rememberLast(backtestPredictions);
const rememberedTimeline = rememberLast(buildSeasonTimeline);
const NO_BACKTEST = backtestPredictions([], [], {}, DEFAULT_SETTINGS);
const NO_TIMELINE: SeasonTimelineEntry[] = [];

const replaceTeamDataUrl = (teamId: string | null) => {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  if (teamId) {
    url.searchParams.set(TEAM_QUERY_PARAM, teamId);
  } else {
    url.searchParams.delete(TEAM_QUERY_PARAM);
  }
  /*
   * A scenario link still to be asked about stays (2.7 review): it waits in the address bar for the
   * cloud's season, and on a member's first meeting that arrives with a reload, which carries only
   * what the address bar still holds. The hash goes once the link is asked about.
   */
  if (!url.hash.includes("scenario=")) url.hash = "";
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
};

const VIEW_LABELS: Record<ActiveView, string> = {
  dashboard: "Dashboard",
  power: "Power Ratings",
  standings: "Standings",
  teamStats: "League Stats",
  games: "Schedule",
  model: "Forecast",
  quality: "Data Quality",
  settings: "Settings",
};

/**
 * The tabs a phone keeps in its row (2.4): where a season is read and scored. The rest are under
 * More, with Data Quality out in the row whenever something needs attention.
 */
const PHONE_VIEWS: readonly ActiveView[] = ["dashboard", "games", "standings", "model"];
const VIEW_ICONS: Partial<Record<ActiveView, ReactNode>> = {
  dashboard: NAV_ICONS.dashboard,
  games: NAV_ICONS.games,
  standings: NAV_ICONS.standings,
  model: NAV_ICONS.model,
};

const VIEW_ORDER: ActiveView[] = [
  "dashboard",
  "power",
  "games",
  "standings",
  "teamStats",
  "model",
  "quality",
  "settings",
];

// Each League view, drawn by its own chunk once loaded (`leagueViews.ts`, 2.1).
const DashboardView = dashboardView.View;
const PowerRatingsView = powerView.View;
const StandingsView = standingsView.View;
const TeamStatsView = statsView.View;
const ModelView = forecastView.View;
const PlayoffMachine = playoffMachineView.View;
const GamesView = scheduleView.View;
const DataQualityView = qualityView.View;
const SettingsView = settingsView.View;
const SeasonManager = seasonManagerView.View;
const ScoutLinkPanel = scoutLinkView.View;
const TeamDrawer = teamDrawerView.View;
const CompareDrawer = compareDrawerView.View;

// ---------- Main app ----------

/**
 * Three things nobody sees until they ask for them: the command palette, the shortcut list and the
 * first-run tour. Each is behind a keystroke or a button, and each is guarded by its own open flag
 * below so the fetch happens on the press rather than on the page load.
 */
const CommandPalette = lazy(() =>
  import("./components/CommandPalette").then((module) => ({ default: module.CommandPalette }))
);
const CloudPanel = lazy(() =>
  import("./components/CloudPanel").then((module) => ({ default: module.CloudPanel }))
);
const ShortcutsHelp = lazy(() =>
  import("./components/ShortcutsHelp").then((module) => ({ default: module.ShortcutsHelp }))
);
const OnboardingTour = lazy(() =>
  import("./components/OnboardingTour").then((module) => ({ default: module.OnboardingTour }))
);

/**
 * Team Rankings is a whole second half of the app — the nationwide pool, the GameChanger importer,
 * the compact storage codec, the weekly rota — and somebody here to check their league's standings
 * never opens it. Fetched when it is asked for rather than shipped to everyone up front.
 */
const TeamRankingsView = lazy(() =>
  loadTeamRankingsView().then((module) => ({ default: module.TeamRankingsView }))
);

/**
 * One add-game select, settled against the team list it names: the id it holds when that is still
 * a team here, the team at `fallback` otherwise, and nothing at all when there is no such team.
 *
 * Pulled out of the component because the rule is the whole of the bug — a select that keeps an id
 * from a season that has been switched away from — and a rule is testable where a render is not.
 */
export const settleSide = (teams: readonly TeamBase[], held: string, fallback: number): string => {
  if (teams.some((team) => team.id === held)) return held;
  return teams[fallback]?.id ?? "";
};

/** This device's seasons in storage, as League kept live meets them with the cloud's. */
const LOCAL_SEASONS: LocalSeasons = {
  list: listSeasons,
  read: readSeasonSnapshot,
  add: addSeasons,
};

/** A season's entry in this device's season list. */
const entryOfSeason = (id: string) => listSeasons().find((season) => season.id === id);

/** The active season's data as storage holds it. */
const loadOpenSeason = (): SeasonState => ({
  teams: loadTeams(),
  matchups: loadMatchups(),
  logs: loadLogs(),
  bracketLogs: loadBracketLogs(),
  settings: loadSettings(),
});

export default function App() {
  const [activeView, setActiveView] = useState<ActiveView>("dashboard");
  // The tab most often opened next, fetched once this one is drawn and the browser is idle (2.1).
  useEffect(() => {
    const next = LIKELY_NEXT[activeView];
    if (!next) return;
    const timer = window.setTimeout(() => void prefetchView(next), 1_500);
    return () => window.clearTimeout(timer);
  }, [activeView]);
  const {
    teams,
    setTeams,
    matchups,
    setMatchups,
    logs,
    setLogs,
    bracketLogs,
    setBracketLogs,
    settings,
    setSettings,
    openSeason,
    store: seasonStore,
    finalLogs: storedFinalLogs,
  } = useSeasonState(() => ({ id: getActiveSeasonId(), season: loadOpenSeason() }));
  /*
   * What every calculation from the scores is keyed on: the final games' scores alone, which stay
   * the same object while a score is typed into a game still being played (`finalLogsOf`), so a
   * keystroke there works none of the season out again (2.2). Deferred, so marking a game final
   * draws its box at once and the season follows. The playoff machine alone reads the whole
   * score map, since a pick there keeps the innings typed into its game.
   */
  const finalLogs = useDeferredValue(storedFinalLogs);
  const deferredLogs = useDeferredValue(logs);

  const [newDate, setNewDate] = useState("");
  const [newAway, setNewAway] = useState("");
  const [newHome, setNewHome] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(() => linkedTeamIdFromUrl());
  const [compareTeamId, setCompareTeamId] = useState<string | null>(null);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  /*
   * The palette used to exist only on the league half, which left the half with a nationwide pool
   * and the most places to be without one. Team Rankings owns its own navigation state, so rather
   * than lift all of it up here it publishes the commands it can run and this holds them.
   */
  const [rankingsCommands, setRankingsCommands] = useState<Command[]>([]);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showTour, setShowTour] = useState(false);
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false
  );
  const [updateApp, setUpdateApp] = useState<(() => Promise<void>) | null>(null);
  useEffect(() => {
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);
  const [lastImpact, setLastImpact] = useState<LastImpact | null>(null);
  const [scoreboardTeamFilter, setScoreboardTeamFilter] = useState("ALL");
  const [scoreboardPredictions, setScoreboardPredictions] = useState<
    Map<string, ScoreboardPrediction>
  >(() => new Map());
  const [seasonBuilderText, setSeasonBuilderText] = useState("");
  const {
    state: confirmState,
    dialogRef: confirmDialogRef,
    request: requestConfirmation,
    resolve: resolveConfirmation,
  } = useConfirmation();

  const { toast, show: showToast, dismiss: dismissToast } = useToast();

  /**
   * A pool write goes to IndexedDB behind the caller, so a quota failure surfaces long after the
   * save was reported as accepted. This is the only place that can still say so.
   */
  useEffect(() => {
    onPoolWriteError((key) => {
      // Written down as well as said, because this is the failure somebody reports days later —
      // "it stopped saving at some point" — and the key and the time are what answer it.
      recordDiagnostic({
        kind: "pool-write",
        where: key,
        message: "A Team Rankings write did not land; storage is full or unavailable.",
      });
      showToast("Team Rankings could not be saved — storage is full.", { tone: "error" });
    });
    return () => onPoolWriteError(null);
  }, [showToast]);

  /**
   * The pool is in a store this session could not open — a private window, or a browser that
   * refused it this time. Said out loud, because the alternative is a Team Rankings that looks
   * simply empty and quietly refuses everything typed into it.
   */
  useEffect(() => {
    if (!isPoolUnavailable()) return;
    showToast(
      "Team Rankings is stored in this browser's database, which would not open. Your data is safe — reload, or try a normal (not private) window.",
      { tone: "error", durationMs: 15000 }
    );
  }, [showToast]);
  const recordSaveResult = useCallback(
    (ok: boolean, _label: string, errorMessage: string) => {
      if (!ok) showToast(errorMessage, { tone: "error" });
    },
    [showToast]
  );
  const { theme, setTheme, toggle: toggleTheme } = useDarkMode();
  const { appMode, setAppMode } = useAppMode();
  /*
   * The cloud copy of this browser's data (`lib/cloud`, README "Your data on every device"): its
   * changes are listened for once the app is on screen, and where it stands is the header button.
   * With no Firebase project to keep a copy in (`cloudConfig`) there is neither, and this is inert.
   */
  useEffect(() => startCloudSession(), []);
  const cloud = useSyncExternalStore(subscribeCloud, cloudStatus);
  const cloudPanel = useCloudPanel(cloud);
  /*
   * Team Rankings is the cloud's for this member (`liveBoardWanted`): League Standings asks the
   * server for what Team Rankings has for its seasons (`askLeague`), which a device that holds no
   * pool cannot work out (1.6e), and which the board on the Team Rankings side is built from.
   */
  const rankingsLive = liveBoardWanted(cloud);

  useEffect(() => {
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        setUpdateApp(() => () => updateSW(true));
        showToast("A fresh app version is ready.", {
          tone: "info",
          actionLabel: "Reload",
          onAction: () => {
            void updateSW(true);
          },
        });
      },
      onOfflineReady() {
        showToast("App shell cached for offline use.", { tone: "success" });
      },
    });
  }, [showToast]);
  const {
    snapshot: sharedSnapshot,
    uiState: sharedUiState,
    clear: clearSharedSnapshot,
  } = useUrlSnapshot();
  const openTeamData = useCallback((teamId: string) => {
    setSelectedTeamId(teamId);
    replaceTeamDataUrl(teamId);
  }, []);

  /**
   * Renames a league team. The id is what every matchup and log refers to, and it is fixed at
   * creation, so this touches the label alone — a name can be corrected mid-season without moving
   * a single game or score. Team Rankings matches league teams by name, so a corrected name is
   * also how a club stops appearing there twice.
   */
  const renameLeagueTeam = useCallback(
    (teamId: string, nextName: string) => {
      const name = nextName.trim();
      if (!name) return;
      setTeams((prev) => prev.map((team) => (team.id === teamId ? { ...team, name } : team)));
      showToast(`Renamed to ${name}.`, { tone: "success" });
    },
    [showToast, setTeams]
  );

  const closeTeamData = useCallback(() => {
    setSelectedTeamId(null);
    setCompareTeamId(null);
    replaceTeamDataUrl(null);
  }, []);

  /**
   * Whether this league writes down the final score and nothing else. Runs are
   * all the standings and the projections ever needed, so the rest of the box
   * score is opt-in, and every display built on it hides while it is off rather
   * than reporting a season-long 0.0.
   */
  const runsOnly = settings.scoreDetail === "runs";

  const postseasonFormat = settings.postseasonFormat;
  /** Only a "cut" league has a line to be inside or outside of. */
  const hasCutLine = postseasonFormat === "cut";
  const hasPostseason = postseasonFormat !== "none";

  /**
   * Effective cutoff driving the simulation and seeding.
   *
   * The model is written around "how many teams qualify", so rather than
   * special-casing it everywhere, each format is expressed as a number: a cut
   * league uses its setting, an all-in league qualifies everyone, and a league
   * with no postseason qualifies nobody. Displays that only make sense with a
   * real cut line are gated on `hasCutLine` instead.
   */
  const goldCutoff = hasCutLine
    ? clamp(
        Math.round(settings.goldCutoff || DEFAULT_GOLD_CUTOFF),
        1,
        Math.max(1, teams.length || DEFAULT_GOLD_CUTOFF)
      )
    : postseasonFormat === "all"
      ? Math.max(1, teams.length)
      : 0;

  // ---------- Persisted state ----------

  useEffect(() => {
    recordSaveResult(saveTeams(teams), "teams", "Could not save teams (storage full).");
  }, [teams, recordSaveResult]);

  useEffect(() => {
    recordSaveResult(saveMatchups(matchups), "schedule", "Could not save schedule (storage full).");
  }, [matchups, recordSaveResult]);

  useEffect(() => {
    const saveTimer = window.setTimeout(() => {
      recordSaveResult(saveLogs(logs), "scores", "Could not save scores (storage full).");
    }, 500);

    return () => window.clearTimeout(saveTimer);
  }, [logs, recordSaveResult]);

  useEffect(() => {
    recordSaveResult(
      saveBracketLogs(bracketLogs),
      "bracket scores",
      "Could not save bracket scores (storage full)."
    );
  }, [bracketLogs, recordSaveResult]);

  useEffect(() => {
    recordSaveResult(saveSettings(settings), "settings", "Could not save settings (storage full).");
  }, [settings, recordSaveResult]);

  /*
   * Settle the add-game selects against the team list they name.
   *
   * It used to fill only an empty value, which meant that once set they held whatever they held —
   * and `teams` is replaced wholesale by a season switch, a restored backup, an undo, the season
   * builder and Reset Season, none of which touched them. What that leaves is a form that looks
   * blank and is not: a select whose value names no option shows nothing selected, while the state
   * behind it still holds the old id, and Add Game is enabled on exactly that state — two
   * non-empty ids that differ. Pressing it booked a game between two teams not in this season.
   *
   * Checking membership rather than emptiness settles in the same one extra render and still never
   * fights a choice somebody has made, because a chosen id is a team that is there.
   */
  const settledAway = settleSide(teams, newAway, 0);
  const settledHome = settleSide(teams, newHome, 1);
  if (settledAway !== newAway) setNewAway(settledAway);
  if (settledHome !== newHome) setNewHome(settledHome);

  // ---------- Derived state ----------

  const baseTeams = useMemo(
    () => calculateTeams(teams, matchups, finalLogs, settings),
    [teams, matchups, finalLogs, settings]
  );

  /**
   * This season's schedule in the shape `leagueScoutBridge` matches stored games against:
   * team names rather than ids, because Team Rankings keeps its own ids for the same clubs, and
   * the league's own date string, which it normalizes. Without it a GameChanger pull of a league
   * team's schedule would feed this season's own games back in as if they were outside results.
   *
   * With the runs of every final game, so a club's own row filed against "TBD" can be told for the
   * league's game it is. Keyed on the final scores as a string, which changes only when a final
   * result does: the bridge reads the pool from storage whenever this changes, and typing a score
   * into a game still in progress must not make it.
   */
  const finalScores = useMemo(() => finalScoresKey(matchups, finalLogs), [matchups, finalLogs]);
  const seasonFixtures = useMemo(
    () => leagueFixturesOf(teams, matchups, finalScores),
    [teams, matchups, finalScores]
  );

  /** Stores which Team Rankings club a league team is, or clears the answer. */
  const setScoutLink = useCallback(
    (leagueTeamId: string, scoutTeamId: string | undefined) => {
      setTeams((prev) =>
        prev.map((team) =>
          team.id === leagueTeamId
            ? scoutTeamId
              ? { ...team, scoutTeamId }
              : (({ scoutTeamId: _dropped, ...rest }) => rest)(team)
            : team
        )
      );
    },
    [setTeams]
  );

  // ---------- Seasons ----------

  /**
   * Re-reads everything the active season holds. Its body is written further down, where the undo
   * snapshot it clears exists; this is the stable handle `useSeasons` is given.
   */
  const loadActiveSeasonRef = useRef<() => void>(() => {});
  const loadActiveSeason = useCallback(() => loadActiveSeasonRef.current(), []);

  /**
   * Which seasons exist and which one is being looked at. Above the bridge because the bridge is
   * scoped to the active season; what a season *holds* is re-read by `loadActiveSeason` below.
   */
  // Filled once League kept live is known, below: the season list asks it before a deletion.
  const removeLiveSeason = useRef<(id: string) => Promise<boolean>>(async () => true);
  const beforeSeasonDelete = useCallback((id: string) => removeLiveSeason.current(id), []);
  const seasons = useSeasons({
    seasonLabel: settings.seasonLabel,
    loadActiveSeason,
    showToast,
    requestConfirmation,
    beforeDelete: beforeSeasonDelete,
  });
  const activeSeasonId = seasons.activeId;

  const refreshSeasons = seasons.refresh;
  const adoptSeason = useCallback(
    (id: string, createdAt: string) => {
      if (adoptSeasonCreatedAt(id, createdAt)) refreshSeasons();
    },
    [refreshSeasons]
  );
  const leagueMet = useSyncExternalStore(subscribeLeagueMet, leagueMetHere, () => false);
  const leagueSettled = useSyncExternalStore(subscribeCloud, leagueInStep, () => false);
  const liveLeague = useLiveLeague({
    enabled: leagueLiveWanted({
      status: cloud,
      met: leagueMet,
      inStep: leagueSettled,
    }),
    seasons: seasonStore,
    entryOf: entryOfSeason,
    entryKey: seasons.all,
    local: LOCAL_SEASONS,
    onSeasonsAdded: seasons.refresh,
    persist: writeSeasonData,
    adopt: adoptSeason,
  });
  const leagueEditable = editable(liveLeague.state);
  const { guardUndo, removeSeason } = liveLeague;
  const leagueReachable = reachable(liveLeague.state);
  // Kept live this moment, rather than switched on: a visitor, or a member's device offline or
  // still to meet the cloud's seasons, is not.
  const leagueKeptLive = liveLeague.state.kind !== "off";
  /*
   * The lock is on the season itself, not only on the controls on the page: the team drawer, the
   * command palette, a shared link and a toast's Undo all reach the season from outside them, and
   * each is refused while the season may not be written, with the reason.
   */
  const editingOff = editingOffBecause(liveLeague.state);
  // Locked as the page is drawn read-only, not a frame after, so no edit lands in between.
  useLayoutEffect(() => {
    seasonStore.lock(editingOff);
  }, [seasonStore, editingOff]);
  useEffect(() => {
    // Said once the handler that tried the edit is done: one that goes on to say it did what it
    // set out to ("Loaded demo season.") would otherwise put its word over the refusal.
    seasonStore.onRefused((why) => queueMicrotask(() => showToast(why, { tone: "error" })));
    return () => seasonStore.onRefused(null);
  }, [seasonStore, showToast]);
  useEffect(() => {
    removeLiveSeason.current = async (id) => {
      // A season every device shares goes from the cloud first, or not at all: deleted here
      // alone, it would come back on the next visit. With no word from the cloud this moment,
      // there is no cloud to delete it from, and so no deleting; on a member's device that is
      // so whenever League is not live, met or about to be (1.6e review).
      const route = seasonDeleteRoute({
        live: leagueKeptLive,
        // A member's device: one a member has signed in to, its record keeping the account,
        // which any device that met the cloud's seasons has.
        memberDevice: loadCloudState().uid !== null,
      });
      if (route === "here") return true;
      if (route === "refuse" || !leagueReachable) {
        showToast(route === "refuse" ? seasonDeleteRefused(cloudStatus()) : SEASON_DELETE_OFFLINE, {
          tone: "error",
        });
        return false;
      }
      try {
        return await removeSeason(id);
      } catch (error) {
        const refused = (error as { code?: unknown } | null)?.code === "permission-denied";
        showToast(
          refused
            ? "Only the owner of the list can delete a season every device shares."
            : "The season could not be deleted from the cloud. Try again when online.",
          { tone: "error" }
        );
        return false;
      }
    };
  }, [leagueKeptLive, leagueReachable, removeSeason, showToast]);

  /**
   * What Team Rankings has for this season: the results, the picks and the search behind them.
   * Asked of the server, it is asked again when the sign-in comes through and on coming back from
   * Team Rankings, where the member may have changed what it reads.
   */
  const {
    bridge: scoutBridge,
    externalResults,
    unanswered: scoutUnanswered,
    candidatesFor: scoutCandidatesFor,
    wideOptions: scoutWideOptions,
    wideStatus: scoutWideStatus,
    wantWide: wantScoutWide,
    noteChange: noteScoutChange,
  } = useScoutBridge({
    activeSeasonId,
    teams,
    seasonFixtures,
    useScoutResults: settings.useScoutResults,
    onLink: setScoutLink,
    ...(rankingsLive
      ? {
          asker: askLeague,
          signedIn: memberSignedIn(cloud),
          leagueOnScreen: appMode === "league",
        }
      : {}),
  });

  const predictionEngine = useMemo(
    () =>
      buildPredictionEngine(
        baseTeams,
        matchups,
        finalLogs,
        settings,
        externalResults,
        scoutBridge.squadYear
      ),
    [baseTeams, matchups, finalLogs, settings, externalResults, scoutBridge.squadYear]
  );

  /**
   * The teams every forecast reads, each carrying the opponent-adjusted rating the Power Ratings
   * table is built from — so a game pick knows who a team played and not only what it scored, and
   * knows about the tournament games Team Rankings brought in. A team the fit never saw carries no
   * rating and its forecast is exactly the number it was before any of this.
   */
  const liveTeams = useMemo(
    () => attachAdjustedRatings(baseTeams, predictionEngine.ratings),
    [baseTeams, predictionEngine]
  );
  const liveById = useMemo(() => {
    const map = new Map<string, Team>();
    liveTeams.forEach((team) => map.set(team.id, team));
    return map;
  }, [liveTeams]);
  const teamBaseById = useMemo(() => {
    const map = new Map<string, TeamBase>();
    teams.forEach((team) => map.set(team.id, team));
    return map;
  }, [teams]);

  const ranked = useMemo(
    () => rankTeams(liveTeams, rankOptionsFromSettings(settings)),
    [liveTeams, settings]
  );
  /*
   * The month this season's year turns in, from its own dates (`seasonStartMonth`), so a season
   * played over New Year orders its January after its December everywhere it is put in order.
   */
  const seasonStart = useMemo(
    () => seasonStartMonth(matchups.map((game) => game.date)),
    [matchups]
  );
  const remainingGames = useMemo(
    () => matchups.filter((game) => !isFinal(finalLogs[game.id])),
    [matchups, finalLogs]
  );
  const completedGames = useMemo(
    () =>
      matchups
        .filter((game) => isFinal(finalLogs[game.id]))
        .sort((a, b) => parseDateValue(a.date, seasonStart) - parseDateValue(b.date, seasonStart)),
    [matchups, finalLogs, seasonStart]
  );
  const leagueAverageStats = useMemo(
    () => buildLeagueAverageStats(matchups, finalLogs),
    [matchups, finalLogs]
  );
  const statRankings = useMemo(
    () =>
      buildTeamStatRankings(
        teams,
        matchups,
        finalLogs,
        settings.pitchMode,
        settings.trackErrors,
        runsOnly
      ),
    [teams, matchups, finalLogs, settings.pitchMode, settings.trackErrors, runsOnly]
  );
  const remainingCounts = useMemo(
    () =>
      getRemainingCounts(
        liveTeams,
        remainingGames,
        Math.max(0, Math.round(settings.regularSeasonGamesPerTeam || 0))
      ),
    [liveTeams, remainingGames, settings.regularSeasonGamesPerTeam]
  );
  const projectionAnalysisEnabled = remainingGames.length <= PROJECT_STANDINGS_REMAINING_GAME_LIMIT;
  const exactScenarioAnalysisEnabled =
    activeView === "model" && remainingGames.length <= EXACT_SCENARIO_REMAINING_GAME_LIMIT;

  const projected = useMemo(
    () =>
      projectionAnalysisEnabled
        ? projectStandings(liveTeams, remainingGames, settings)
        : rankTeams(liveTeams, rankOptionsFromSettings(settings)),
    [projectionAnalysisEnabled, liveTeams, remainingGames, settings]
  );
  const projectedById = useMemo(() => {
    const map = new Map<string, Team & { rank: number }>();
    projected.forEach((team) => map.set(team.id, team));
    return map;
  }, [projected]);

  // ---------- Worker-driven odds + trend ----------

  const oddsSeed = useMemo(
    () =>
      simulationSeed(
        matchups,
        finalLogs,
        `odds-${goldCutoff}-${settings.modelAggression}-${settings.winPoints}-${settings.tiePoints}-${settings.tiebreakerOrder.join(",")}`
      ),
    [matchups, finalLogs, goldCutoff, settings]
  );

  const oddsInput = useMemo(
    () => ({
      teams: liveTeams,
      remaining: remainingGames,
      iterations: SIM_ITERATIONS,
      seedText: oddsSeed,
      cutoff: goldCutoff,
      settings,
    }),
    [liveTeams, remainingGames, oddsSeed, goldCutoff, settings]
  );
  const { odds, iterations: oddsIterations, pending: oddsPending } = useSimulationOdds(oddsInput);

  const trendInput = useMemo(() => {
    const teamIds = teams.map((t) => t.id);
    if (!teamIds.length) {
      return {
        teamIds: [],
        states: [],
        iterations: TREND_ITERATIONS,
        cutoff: goldCutoff,
        settings,
      };
    }
    const built = buildTrendStates(teams, matchups, finalLogs, completedGames, {
      states: TREND_STATES,
      goldCutoff,
      settings,
      // The results the Gold % column is rated with, so the line ends where the column is.
      externalResults,
      squadYear: scoutBridge.squadYear,
    });
    return { teamIds, states: built, iterations: TREND_ITERATIONS, cutoff: goldCutoff, settings };
  }, [
    teams,
    matchups,
    finalLogs,
    completedGames,
    goldCutoff,
    settings,
    externalResults,
    scoutBridge.squadYear,
  ]);
  const trendMap = useSimulationTrend(trendInput);

  const bracketInput = useMemo(
    () => ({
      teams: liveTeams,
      remaining: remainingGames,
      iterations: SIM_ITERATIONS,
      seedText: oddsSeed,
      cutoff: goldCutoff,
      settings,
      enabled: activeView === "model",
    }),
    [liveTeams, remainingGames, oddsSeed, goldCutoff, settings, activeView]
  );
  const { bracketOdds } = useSimulationBracket(bracketInput);

  /*
   * How the model has done on the games played, which the Dashboard and the Forecast show and no
   * other tab does: worked out only while one of them is open, and remembered, so opening one again
   * on an unchanged season costs nothing (2.2). It refits the season once per game played, the
   * heaviest single thing League works out: 62 ms on a twelve-team season with 78 games played,
   * about a quarter of a second on a phone, which every final on the Schedule used to wait behind.
   */
  const backtestShown = activeView === "dashboard" || activeView === "model";
  const backtestResult = useMemo(
    () => (backtestShown ? rememberedBacktest(teams, matchups, finalLogs, settings) : NO_BACKTEST),
    [backtestShown, teams, matchups, finalLogs, settings]
  );

  // ---------- Dashboard / scenario computations ----------

  const dashboardRows: TeamWithProjection[] = useMemo(() => {
    return ranked.map((team) => {
      const projectedTeam = projectedById.get(team.id);
      const status = getMathGoldStatus(team, ranked, remainingCounts, goldCutoff, settings);
      return {
        ...team,
        projectedRank: projectedTeam?.rank ?? team.rank ?? 99,
        projectedRecord: projectedTeam ? recordText(projectedTeam) : recordText(team),
        projectedRunDiff: projectedTeam?.runDiff ?? team.runDiff,
        goldPct: odds[team.id] ?? 0,
        // From the seasons actually played out, not the ceiling: the loop stops early once the
        // odds are settled, and a ± from the ceiling would claim a precision never reached.
        goldPctMargin: wilsonScoreInterval((odds[team.id] ?? 0) / 100, oddsIterations).margin * 100,
        goldTrend: trendMap[team.id] ?? [],
        ...status,
      };
    });
  }, [
    ranked,
    projectedById,
    odds,
    oddsIterations,
    trendMap,
    remainingCounts,
    goldCutoff,
    settings,
  ]);

  const dashboardById = useMemo(() => {
    const map = new Map<string, TeamWithProjection>();
    dashboardRows.forEach((row) => map.set(row.id, row));
    return map;
  }, [dashboardRows]);

  const modelRows = useMemo(() => {
    return [...dashboardRows].sort((a, b) => {
      if (a.projectedRank !== b.projectedRank) return a.projectedRank - b.projectedRank;
      if (Math.abs(b.goldPct - a.goldPct) > 0.01) return b.goldPct - a.goldPct;
      return (a.rank ?? 99) - (b.rank ?? 99);
    });
  }, [dashboardRows]);

  // ---------- Head-to-head matrix (league-wide) ----------
  const headToHeadMatrixTeams = useMemo(
    () => ranked.map((team) => ({ id: team.id, name: team.name })),
    [ranked]
  );
  const headToHeadCell = useCallback(
    (rowId: string, colId: string): H2HCell =>
      cellFor(liveById.get(rowId)?.headToHead?.[colId], rowId, colId),
    [liveById]
  );

  const bracketProjection = useMemo(
    () =>
      buildBracketProjection({
        teams: modelRows,
        cutoff: goldCutoff,
        logs: bracketLogs,
        settings,
      }),
    [modelRows, goldCutoff, bracketLogs, settings]
  );

  const silverBracketProjection = useMemo(
    () =>
      buildBracketProjection({
        teams: modelRows,
        cutoff: Math.max(0, modelRows.length - goldCutoff),
        startIndex: goldCutoff,
        idPrefix: "silver-bracket",
        logs: bracketLogs,
        settings,
      }),
    [modelRows, goldCutoff, bracketLogs, settings]
  );

  const bracketSeedingLocked = useMemo(
    () => isSeedingLocked(ranked, remainingGames, settings),
    [ranked, remainingGames, settings]
  );

  const currentSosRanks = useMemo(() => sosRanks(dashboardRows), [dashboardRows]);

  const projectedCutLineTeams = useMemo(
    () => teamsOnBubble(modelRows, goldCutoff),
    [modelRows, goldCutoff]
  );

  // ---------- Scenario helpers ----------

  const { seedForScenario, seedRangeForTeam } = useSeedRanges({
    exact: exactScenarioAnalysisEnabled,
    liveTeams,
    remainingGames,
    settings,
    projectedById,
    ranked,
  });

  const nextTwoSwingGames = useCallback(
    (teamId: string): SwingGame[] => {
      return remainingGames
        .filter((game) => game.away === teamId || game.home === teamId)
        .sort((a, b) => parseDateValue(a.date, seasonStart) - parseDateValue(b.date, seasonStart))
        .slice(0, 2)
        .map((game) => {
          const teamIsAway = game.away === teamId;
          const opponentId = teamIsAway ? game.home : game.away;
          const opponentName = displayName(teamBaseById.get(opponentId)?.name || opponentId);
          const prediction = predictGame(game, liveTeams, settings, liveById);
          const baselineSeed =
            projectedById.get(teamId)?.rank ??
            ranked.find((item) => item.id === teamId)?.rank ??
            99;
          const winSeed = exactScenarioAnalysisEnabled
            ? seedForScenario(teamId, game, teamId)
            : baselineSeed;
          const lossSeed = exactScenarioAnalysisEnabled
            ? seedForScenario(teamId, game, opponentId)
            : baselineSeed;
          const teamWinPct = teamIsAway ? prediction.awayWinPct : 1 - prediction.awayWinPct;
          const modelPick = displayName(
            teamBaseById.get(prediction.winnerId)?.name || prediction.winnerId
          );
          return {
            game,
            opponentName,
            teamIsAway,
            winSeed,
            lossSeed,
            modelPick,
            winPct: teamWinPct,
          };
        });
    },
    [
      remainingGames,
      seasonStart,
      teamBaseById,
      liveTeams,
      settings,
      liveById,
      projectedById,
      ranked,
      exactScenarioAnalysisEnabled,
      seedForScenario,
    ]
  );

  const clinchingPaths = useMemo(
    () =>
      activeView === "model"
        ? clinchingPathsForTeams(
            dashboardRows,
            remainingGames,
            goldCutoff,
            settings,
            nextTwoSwingGames,
            {
              limit: 8,
              exactLimit: EXACT_MAGIC_REMAINING_GAME_LIMIT,
            }
          )
        : [],
    [activeView, dashboardRows, remainingGames, goldCutoff, settings, nextTwoSwingGames]
  );

  const cutLineSnapshot = useMemo(
    () => goldCutLineSnapshot(dashboardRows, goldCutoff, settings),
    [dashboardRows, goldCutoff, settings]
  );

  // The Forecast's timeline, which plays the season through game by game: as heavy as the
  // backtest, and only the Forecast shows it (2.2).
  const timelineEntries = useMemo(
    () =>
      activeView === "model"
        ? rememberedTimeline(teams, matchups, finalLogs, settings, 6)
        : NO_TIMELINE,
    [activeView, teams, matchups, finalLogs, settings]
  );

  const controlLevelMap = useMemo(() => {
    const result = new Map<string, string>();
    if (!dashboardRows.length) return result;

    if (activeView !== "model" || remainingGames.length > PROJECT_STANDINGS_REMAINING_GAME_LIMIT) {
      dashboardRows.forEach((team) => {
        if (team.goldStatus === "Clinched" || team.goldStatus === "Eliminated") {
          result.set(team.id, team.goldStatus);
        } else if ((team.rank ?? 99) <= goldCutoff) {
          result.set(team.id, "In Control");
        } else {
          result.set(team.id, "Needs Help");
        }
      });
      return result;
    }

    teams.forEach((team) => {
      const row = dashboardById.get(team.id);
      if (!row) return;
      if (row.goldStatus === "Clinched") {
        result.set(team.id, "Clinched");
        return;
      }
      if (row.goldStatus === "Eliminated") {
        result.set(team.id, "Eliminated");
        return;
      }

      let winOut = liveTeams.map((item) => ({ ...item }));
      remainingGames.forEach((game) => {
        const winner =
          game.away === team.id || game.home === team.id
            ? team.id
            : predictGame(game, liveTeams, settings, liveById).winnerId;
        winOut = applyResult(winOut, game, winner, liveTeams, settings);
      });

      const winOutSeed =
        rankTeams(winOut, rankOptionsFromSettings(settings)).find((item) => item.id === team.id)
          ?.rank ?? 99;
      const swings = nextTwoSwingGames(team.id);
      const lossRisk = swings.some((swing) => swing.lossSeed > goldCutoff);

      if (winOutSeed <= goldCutoff && (row.rank ?? 99) > goldCutoff) {
        result.set(team.id, "Controls Own Fate");
      } else if (winOutSeed > goldCutoff) {
        result.set(team.id, "Needs Help");
      } else if ((row.rank ?? 99) <= goldCutoff && lossRisk) {
        result.set(team.id, "At Risk");
      } else {
        result.set(team.id, "In Control");
      }
    });
    return result;
  }, [
    activeView,
    teams,
    dashboardRows,
    dashboardById,
    liveTeams,
    remainingGames,
    settings,
    liveById,
    goldCutoff,
    nextTwoSwingGames,
  ]);

  const controlLevelForTeam = useCallback(
    (team: TeamWithProjection) => controlLevelMap.get(team.id) ?? "In Control",
    [controlLevelMap]
  );

  const bubbleTierForTeam = useCallback(
    (team: TeamWithProjection) => {
      if (team.goldStatus === "Clinched") return "Locked In";
      if (team.goldStatus === "Eliminated") return "Eliminated";
      const currentSeed = team.rank ?? 99;
      const projectedSeed = team.projectedRank ?? 99;
      if (currentSeed <= goldCutoff - 2 && projectedSeed <= goldCutoff && team.goldPct >= 80) {
        return "Likely In";
      }
      if (currentSeed <= goldCutoff || projectedSeed <= goldCutoff) return "Bubble In";
      const cutoffRow = dashboardRows[Math.min(goldCutoff - 1, dashboardRows.length - 1)] ?? team;
      if (team.goldPct >= 20 || projectedSeed <= goldCutoff + 2 || team.maxPct >= cutoffRow.pct) {
        return "Bubble Out";
      }
      return "Long Shot";
    },
    [goldCutoff, dashboardRows]
  );

  const scheduleDifficultyForTeam = useCallback(
    (teamId: string) =>
      buildScheduleDifficultyForTeam(teamId, remainingGames, dashboardRows, matchups, finalLogs),
    [remainingGames, dashboardRows, matchups, finalLogs]
  );

  const gameImportance = useCallback(
    (game: Matchup) => {
      const away = dashboardById.get(game.away);
      const home = dashboardById.get(game.home);
      if (!away || !home) return 0;
      const seedScore = (team: TeamWithProjection) =>
        Math.max(0, 8 - Math.abs((team.rank ?? 99) - goldCutoff));
      const oddsScore = (team: TeamWithProjection) =>
        Math.max(0, 50 - Math.abs(team.goldPct - 50)) / 10;
      const projectedScore = (team: TeamWithProjection) =>
        Math.max(0, 5 - Math.abs((team.projectedRank ?? 99) - goldCutoff));
      return (
        seedScore(away) +
        seedScore(home) +
        oddsScore(away) +
        oddsScore(home) +
        projectedScore(away) +
        projectedScore(home)
      );
    },
    [dashboardById, goldCutoff]
  );

  const getGameScenarioImpactMap = useMemo(() => {
    const map = new Map<
      string,
      {
        awaySeedWin: number;
        awaySeedLoss: number;
        homeSeedWin: number;
        homeSeedLoss: number;
        seedImpact: number;
        impactLabel: "High" | "Medium" | "Low";
        awayGoldSwing: number;
        homeGoldSwing: number;
        awayName: string;
        homeName: string;
      }
    >();
    if (!exactScenarioAnalysisEnabled) return map;
    remainingGames.forEach((game) => {
      const prediction = predictGame(game, liveTeams, settings, liveById);
      const away = dashboardById.get(game.away);
      const home = dashboardById.get(game.home);
      const awaySeedWin = seedForScenario(game.away, game, game.away);
      const awaySeedLoss = seedForScenario(game.away, game, game.home);
      const homeSeedWin = seedForScenario(game.home, game, game.home);
      const homeSeedLoss = seedForScenario(game.home, game, game.away);
      const seedImpact = Math.max(
        Math.abs(awaySeedWin - awaySeedLoss),
        Math.abs(homeSeedWin - homeSeedLoss)
      );
      const impactLabel: "High" | "Medium" | "Low" =
        seedImpact >= 3 ? "High" : seedImpact >= 1 ? "Medium" : "Low";
      const awayGoldSwing = clamp(
        (awaySeedLoss - awaySeedWin) * 8 + (prediction.winnerId === game.away ? 4 : -4),
        -25,
        25
      );
      const homeGoldSwing = clamp(
        (homeSeedLoss - homeSeedWin) * 8 + (prediction.winnerId === game.home ? 4 : -4),
        -25,
        25
      );
      map.set(game.id, {
        awaySeedWin,
        awaySeedLoss,
        homeSeedWin,
        homeSeedLoss,
        seedImpact,
        impactLabel,
        awayGoldSwing,
        homeGoldSwing,
        awayName: displayName(away?.name || game.away),
        homeName: displayName(home?.name || game.home),
      });
    });
    return map;
  }, [
    exactScenarioAnalysisEnabled,
    remainingGames,
    liveTeams,
    settings,
    liveById,
    dashboardById,
    seedForScenario,
  ]);

  /**
   * What one more result would do to the table: who clinches, who goes out, what a game is worth.
   *
   * Seven of these, all the same shape — play the game forward, rank what comes out, ask the
   * clinching maths — and they sat here among everything else App does. Out in a hook they are a
   * closed question over the season, and they have a test, which they did not before.
   */
  const { gameStatusForGame } = useClinchScenarios({
    liveTeams,
    settings,
    remainingGames,
    seasonStart,
    goldCutoff,
    hasCutLine,
    dashboardById,
    scenarioImpact: getGameScenarioImpactMap,
  });

  const gameStatusClasses = (label: string) => {
    if (label.startsWith("Title Clinch-")) return "bg-purple-100 text-purple-700";
    if (label.startsWith("Clinch Game-")) return "bg-emerald-100 text-emerald-700";
    if (label.startsWith("Clinch Watch-")) return "bg-teal-100 text-teal-700";
    if (label.startsWith("Clinch Scenario:")) return "bg-emerald-100 text-emerald-700";
    if (label.startsWith("Elimination Game-")) return "bg-red-100 text-red-700";
    if (label.startsWith("Elimination Scenario:")) return "bg-red-100 text-red-700";
    if (label === "High Impact") return "bg-amber-100 text-amber-700";
    if (label === "Bubble Game" || label === "Seeding Game") return "bg-blue-100 text-blue-700";
    return "bg-slate-200 text-slate-600";
  };

  // The Forecast's list alone, and the clinch questions behind each line are not free (2.2).
  const gamesThatMatterMost = useMemo(() => {
    if (activeView !== "model") return [];
    return [...remainingGames]
      .sort((a, b) => gameImportance(b) - gameImportance(a))
      .slice(0, 5)
      .map((game, index) => {
        const away = dashboardById.get(game.away);
        const home = dashboardById.get(game.home);
        const impact = getGameScenarioImpactMap.get(game.id);
        const status = gameStatusForGame(game);
        const reason =
          status === "Low Impact"
            ? `${impact?.impactLabel ?? "Low"} projected seed impact`
            : status;
        return {
          game,
          rank: index + 1,
          label: `${displayName(away?.name || game.away)} vs ${displayName(home?.name || game.home)}`,
          reason,
          date: formatGameDate(game.date),
        };
      });
  }, [
    activeView,
    remainingGames,
    dashboardById,
    getGameScenarioImpactMap,
    gameStatusForGame,
    gameImportance,
  ]);

  // The Forecast's bubble, each team's schedule strength read off every game (2.2).
  const bubbleRows = useMemo(() => {
    if (activeView !== "model") return [];
    return dashboardRows.map((team) => ({
      team,
      tier: bubbleTierForTeam(team),
      sos: scheduleDifficultyForTeam(team.id),
      control: controlLevelForTeam(team),
    }));
  }, [
    activeView,
    dashboardRows,
    bubbleTierForTeam,
    scheduleDifficultyForTeam,
    controlLevelForTeam,
  ]);

  const bubbleMovementRows = useMemo(() => {
    const byId = new Map(bubbleRows.map((row) => [row.team.id, row]));
    const selected = new Map<string, (typeof bubbleRows)[number]>();
    const add = (row: (typeof bubbleRows)[number] | undefined) => {
      if (row) selected.set(row.team.id, row);
    };

    dashboardRows
      .filter((team) => {
        const seed = team.rank ?? 99;
        return seed >= goldCutoff - 1 && seed <= goldCutoff;
      })
      .forEach((team) => add(byId.get(team.id)));

    dashboardRows
      .filter((team) => {
        const seed = team.rank ?? 99;
        return seed >= goldCutoff + 1 && seed <= goldCutoff + 3;
      })
      .forEach((team) => add(byId.get(team.id)));

    dashboardRows
      .filter((team) => {
        const currentInside = (team.rank ?? 99) <= goldCutoff;
        const projectedInside = (team.projectedRank ?? 99) <= goldCutoff;
        return currentInside !== projectedInside;
      })
      .forEach((team) => add(byId.get(team.id)));

    return [...selected.values()].sort((a, b) => {
      const aCross =
        (a.team.rank ?? 99) <= goldCutoff !== (a.team.projectedRank ?? 99) <= goldCutoff;
      const bCross =
        (b.team.rank ?? 99) <= goldCutoff !== (b.team.projectedRank ?? 99) <= goldCutoff;
      if (aCross !== bCross) return aCross ? -1 : 1;
      return (
        Math.abs((a.team.rank ?? 99) - goldCutoff) - Math.abs((b.team.rank ?? 99) - goldCutoff)
      );
    });
  }, [bubbleRows, dashboardRows, goldCutoff]);

  const clinchScenariosForTeam = useCallback(
    (teamId: string) => {
      const team = dashboardById.get(teamId);
      if (!team) return [];
      const teamName = displayName(team.name);

      if (team.goldStatus === "Clinched")
        return [`${teamName} have already clinched a Gold Bracket spot.`];
      if (team.goldStatus === "Eliminated")
        return [`${teamName} are eliminated from Gold Bracket contention.`];

      const scenarios = nextTwoSwingGames(teamId)
        .slice(0, 2)
        .map((swing) => {
          const opponentLine = `${swing.teamIsAway ? "at" : "vs"} ${swing.opponentName}`;
          if (swing.winSeed <= goldCutoff && swing.lossSeed > goldCutoff) {
            return `${opponentLine}: win projects inside the Gold cut line at #${swing.winSeed}; loss drops outside the Gold cut line at #${swing.lossSeed}.`;
          }
          if (swing.winSeed <= goldCutoff && swing.lossSeed <= goldCutoff) {
            return `${opponentLine}: win improves or protects the Gold Bracket path at #${swing.winSeed}; loss still projects #${swing.lossSeed}.`;
          }
          if (swing.winSeed > goldCutoff && swing.lossSeed > goldCutoff) {
            return `${opponentLine}: win projects #${swing.winSeed}; loss projects #${swing.lossSeed}, so outside help is still needed.`;
          }
          return `${opponentLine}: win projects #${swing.winSeed}; loss projects #${swing.lossSeed}.`;
        });

      if (!scenarios.length) {
        return [
          `${teamName} have no remaining games; Gold Bracket status depends only on outside results.`,
        ];
      }
      return scenarios;
    },
    [dashboardById, nextTwoSwingGames, goldCutoff]
  );

  const formatGoldPct = useCallback((team: TeamWithProjection) => formatGoldPctValue(team), []);

  const statusLabel = useCallback(
    (team: TeamWithProjection) => {
      if (team.goldStatus === "Clinched") return "Clinched";
      if (team.goldStatus === "Eliminated") return "Eliminated";

      const currentSeed = team.rank ?? 99;
      const projectedSeed = team.projectedRank ?? 99;
      const cutoffRow = dashboardRows[Math.min(goldCutoff - 1, dashboardRows.length - 1)];
      // The cut is decided on PCT, in the table and in the Monte Carlo both; points only ever go
      // up, so reading the cut line off them said a club with twice the games was twice as close.
      const canStillReachCutLine = team.maxPct >= (cutoffRow?.pct ?? 0);

      if (currentSeed <= goldCutoff) {
        const outsideThreats = dashboardRows.filter(
          (other) =>
            other.id !== team.id && (other.rank ?? 99) > goldCutoff && other.maxPct >= team.minPct
        ).length;
        const cushionSlots = Math.max(0, goldCutoff - currentSeed);
        const exposedToChasers = outsideThreats > cushionSlots;

        if (
          currentSeed <= goldCutoff - 2 &&
          projectedSeed <= goldCutoff &&
          team.goldPct >= 90 &&
          !exposedToChasers
        ) {
          return "Firmly In";
        }
        return "In";
      }

      const seedDistance = currentSeed - goldCutoff;
      const projectedNearCut = projectedSeed <= goldCutoff + 1;

      if (projectedSeed <= goldCutoff && team.goldPct >= 15) return "Alive";
      if (team.goldPct >= 25 && seedDistance <= 3) return "Alive";
      if (projectedNearCut && team.goldPct >= 12) return "Alive";
      if (canStillReachCutLine) return "Longshot";
      return "Longshot";
    },
    [dashboardRows, goldCutoff]
  );

  const statusClass = (team: TeamWithProjection) => {
    const label = statusLabel(team);
    if (label === "Clinched") return "bg-slate-950 text-white dark:bg-white dark:text-slate-950";
    if (label === "Firmly In")
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300";
    if (label === "In") return "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300";
    if (label === "Alive")
      return "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300";
    if (label === "Longshot")
      return "bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300";
    return "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300";
  };

  const titleRaceBadgeForTeam = useCallback(
    (team: TeamWithProjection) =>
      titleRaceBadgeForTeamValue(team, dashboardRows, remainingCounts, settings),
    [dashboardRows, remainingCounts, settings]
  );

  const latestCompletedDate = completedGames.length
    ? formatGameDate(completedGames[completedGames.length - 1]?.date ?? "")
    : "No finals yet";

  // ---------- Game forecasts ----------

  const gameForecasts = useMemo(() => {
    if (activeView !== "model") return [];

    const regularSeasonForecasts = [...remainingGames].map((game) => {
      const prediction = predictGame(game, liveTeams, settings, liveById);
      const winner = teamBaseById.get(prediction.winnerId);
      const away = teamBaseById.get(game.away);
      const home = teamBaseById.get(game.home);
      const winnerPct =
        prediction.winnerId === game.away ? prediction.awayWinPct : 1 - prediction.awayWinPct;
      const impact = getGameScenarioImpactMap.get(game.id);
      return {
        game,
        prediction,
        awayName: displayName(away?.name || game.away),
        homeName: displayName(home?.name || game.home),
        winnerName: displayName(winner?.name || prediction.winnerId),
        winnerPct,
        impact,
        sourceLabel: "Regular Season",
        sortValue: parseDateValue(game.date, seasonStart),
      };
    });

    const bracketForecasts = bracketSeedingLocked
      ? [
          ...bracketProjection.rounds.flatMap((round) =>
            round.map((game) => ({ game, bracketLabel: "Gold Bracket" }))
          ),
          ...silverBracketProjection.rounds.flatMap((round) =>
            round.map((game) => ({ game, bracketLabel: "Silver Bracket" }))
          ),
        ]
          .filter(({ game }) => game.matchup && game.prediction && !isFinal(game.log))
          .map(({ game, bracketLabel }) => {
            const matchup = game.matchup!;
            const prediction = game.prediction!;
            const winner = teamBaseById.get(prediction.winnerId);
            const away = teamBaseById.get(matchup.away);
            const home = teamBaseById.get(matchup.home);
            const winnerPct =
              prediction.winnerId === matchup.away
                ? prediction.awayWinPct
                : 1 - prediction.awayWinPct;
            return {
              game: matchup,
              prediction,
              awayName: displayName(away?.name || matchup.away),
              homeName: displayName(home?.name || matchup.home),
              winnerName: displayName(winner?.name || prediction.winnerId),
              winnerPct,
              impact: undefined,
              sourceLabel: `${bracketLabel} · ${game.roundName}`,
              sortValue: Number.POSITIVE_INFINITY,
            };
          })
      : [];

    return [...regularSeasonForecasts, ...bracketForecasts].sort(
      (a, b) => a.sortValue - b.sortValue || a.game.id.localeCompare(b.game.id)
    );
  }, [
    activeView,
    remainingGames,
    seasonStart,
    liveTeams,
    settings,
    liveById,
    teamBaseById,
    getGameScenarioImpactMap,
    bracketSeedingLocked,
    bracketProjection,
    silverBracketProjection,
  ]);

  const scoreboardGames = useMemo(() => {
    const dateCompare = (a: Matchup, b: Matchup) => {
      const aFinal = isFinal(logs[a.id]);
      const bFinal = isFinal(logs[b.id]);
      const aNoDate = !(a.date ?? "").trim();
      const bNoDate = !(b.date ?? "").trim();
      if (aFinal !== bFinal) return aFinal ? 1 : -1;
      if (!aFinal && aNoDate !== bNoDate) return aNoDate ? -1 : 1;
      return (
        parseDateValue(a.date, seasonStart) - parseDateValue(b.date, seasonStart) ||
        a.id.localeCompare(b.id)
      );
    };
    const filtered =
      scoreboardTeamFilter === "ALL"
        ? matchups
        : matchups.filter(
            (game) => game.away === scoreboardTeamFilter || game.home === scoreboardTeamFilter
          );
    return [...filtered].sort(dateCompare);
  }, [matchups, logs, scoreboardTeamFilter, seasonStart]);

  useEffect(() => {
    // Clearing first is the point: predictions are filled in incrementally over many chunks, and
    // without the wipe a stale entry would sit in the map until its game happened to be
    // recomputed. Deriving it instead would mean carrying a key through every chunk write, which
    // is more moving parts than the one render this costs.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setScoreboardPredictions(new Map());
    if (activeView !== "games" || !remainingGames.length) return;

    let cancelled = false;
    let timer: ReturnType<typeof window.setTimeout> | null = null;
    let index = 0;
    const games = [...remainingGames];

    const queueNextChunk = () => {
      timer = window.setTimeout(() => {
        if (cancelled) return;
        const entries: [string, ScoreboardPrediction][] = [];
        const chunkEnd = Math.min(index + SCOREBOARD_PREDICTION_CHUNK_SIZE, games.length);

        for (; index < chunkEnd; index += 1) {
          const game = games[index];
          if (!game) continue;
          const prediction = predictGame(game, liveTeams, settings, liveById);
          const winner = teamBaseById.get(prediction.winnerId);
          const winnerPct =
            prediction.winnerId === game.away ? prediction.awayWinPct : 1 - prediction.awayWinPct;
          entries.push([
            game.id,
            {
              spread: projectedRunLine(prediction, liveById),
              pickName: displayName(winner?.name || prediction.winnerId),
              pickPct: winnerPct,
              // Keep Schedule score entry lightweight. Exact clinch/elimination badges are
              // still computed in the Model view, but doing them for every open game on
              // each score keystroke makes the scoring workflow feel frozen.
              scenarioBadges: [],
              impactScore: 0,
            },
          ]);
        }

        if (entries.length) {
          startTransition(() => {
            setScoreboardPredictions((prev) => {
              if (cancelled) return prev;
              const next = new Map(prev);
              entries.forEach(([gameId, prediction]) => next.set(gameId, prediction));
              return next;
            });
          });
        }

        if (index < games.length) queueNextChunk();
      }, 0);
    };

    queueNextChunk();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [activeView, remainingGames, liveTeams, settings, liveById, teamBaseById]);

  // ---------- Snapshots / undo ----------

  /**
   * The season a recap reads against, and the names it puts in one. Both are values the recap
   * needs, and neither is something it should go and look up for itself.
   */
  const recapPool = useMemo(
    (): RecapPool => ({ teams, matchups, settings, goldCutoff, hasCutLine }),
    [teams, matchups, settings, goldCutoff, hasCutLine]
  );
  const nameOf = useMemo(() => nameFrom(teamBaseById), [teamBaseById]);

  /**
   * `withTeamRankings` is for the imports that replace the shared Team Rankings pool: only those
   * need the pool in the snapshot, and it is large enough that carrying it on every undo-able
   * action would risk filling storage for nothing.
   */
  // The season as it stands this moment, from the store: a step that asks first is captured after
  // the answer, and another device's change that arrived while it was asked is part of it.
  const readSeasonForUndo = useCallback(() => ({ ...seasonStore.get().season }), [seasonStore]);

  const applySeasonFromUndo = useCallback(
    (season: UndoableSeason) => {
      // Shared live, only what no other device has changed since the step goes back.
      const next =
        (season.takenAt === undefined ? null : guardUndo(season, season.takenAt)) ?? season;
      setTeams(next.teams);
      setMatchups(next.matchups);
      setLogs(next.logs);
      setBracketLogs(next.bracketLogs);
      if (next.settings) setSettings(next.settings);
      closeTeamData();
    },
    [closeTeamData, guardUndo, setTeams, setMatchups, setLogs, setBracketLogs, setSettings]
  );

  const {
    capture: captureUndo,
    restore: restoreUndo,
    forget: forgetUndo,
  } = useUndoSnapshot({
    readSeason: readSeasonForUndo,
    applySeason: applySeasonFromUndo,
    onRankingsRestored: noteScoutChange,
    showToast,
    blocked: seasonStore.locked,
  });

  /*
   * Bound here and filled below, because these three run in a circle: the season index is needed
   * by the Team Rankings bridge, the bridge is needed by the undo snapshot, and the undo snapshot
   * is needed by the reload the index drives. Something has to be late, and this is the smallest
   * of the three — one function, called only from a handler, never during a render.
   */
  useEffect(() => {
    loadActiveSeasonRef.current = () => {
      // The season's id and data together, so nothing reading the season takes one for the other.
      openSeason(getActiveSeasonId(), loadOpenSeason());
      setSelectedTeamId(null);
      setCompareTeamId(null);
      setLastImpact(null);
      forgetUndo();
    };
  });

  /** The active season's live React state — fresher than storage, whose score writes are debounced. */
  const liveSeasonData = useCallback(
    (): LiveSeasonData => ({
      teams,
      matchups,
      logs,
      bracketLogs,
      settings,
    }),
    [teams, matchups, logs, bracketLogs, settings]
  );

  /**
   * A season out of a file, into React.
   *
   * The same shape as `applySeasonFromUndo` above and for the same reason: every path that
   * replaces a season sets the same things in the same order, and passing five setters to
   * whoever needs them would be five chances to forget one. `settings` is set only when the file
   * carried them — a schedule CSV does not, and inventing them would quietly replace whatever the
   * manager had chosen.
   */
  const applySeason = useCallback(
    (next: ImportedSeason) => {
      setTeams(next.teams);
      setMatchups(next.matchups);
      setLogs(next.logs);
      setBracketLogs(next.bracketLogs);
      if (next.settings) setSettings(next.settings);
    },
    [setTeams, setMatchups, setLogs, setBracketLogs, setSettings]
  );

  const clearLastImpact = useCallback(() => setLastImpact(null), []);

  /*
   * The four buttons a season goes in and out by, and the reset that empties it. Lifted out
   * whole: they are one concern — read a file or write one, ask before replacing what is there,
   * snapshot for undo — and the rule that decides between them is what the file turns out to be
   * rather than which button was pressed, which is not a thing this component has any part in.
   */
  const { importCSV, exportCSV, importBackup, exportBackup, resetSeason } = useSeasonFiles({
    liveSeason: liveSeasonData,
    activeSeasonId,
    ...(rankingsLive && scoutBridge.squadYear !== undefined
      ? { cloudSquadYear: scoutBridge.squadYear }
      : {}),
    rankingsLive,
    teams,
    matchups,
    logs,
    settings,
    teamBaseById,
    seasonCount: seasons.all.length,
    applySeason,
    captureUndo,
    restoreUndo,
    requestConfirmation,
    showToast,
    closeTeamData,
    noteScoutChange,
    reloadSeasons: seasons.reload,
    setActiveView,
    setTheme,
    setAppMode,
    clearLastImpact,
  });

  const toggleFinal = (gameId: string) => {
    const { nextLogs, impact } = finalToggled(
      gameId,
      logs,
      settings.defaultGameInnings,
      recapPool,
      nameOf
    );
    // The final alone, onto the scores as they are by then, which may hold keystrokes this press
    // came before (`withFinal`).
    const isFinal = nextLogs[gameId]?.isFinal === true;
    setLogs((prev) => withFinal(prev, gameId, isFinal, settings.defaultGameInnings));
    setLastImpact(impact);
  };

  const updateLog = useCallback(
    (gameId: string, field: keyof GameLog, value: string | boolean) => {
      setLogs((prev) => {
        const current = prev[gameId] || blankLog(String(settings.defaultGameInnings));
        if (current[field] === value) return prev;
        return {
          ...prev,
          [gameId]: { ...current, [field]: value },
        };
      });
    },
    [settings.defaultGameInnings, setLogs]
  );

  const updateBracketLog = useCallback(
    (gameId: string, field: keyof GameLog, value: string | boolean) => {
      setBracketLogs((prev) => {
        const current = prev[gameId] || blankLog();
        return {
          ...prev,
          [gameId]: {
            ...current,
            awayK: current.awayK || "0",
            homeK: current.homeK || "0",
            [field]: value,
          },
        };
      });
    },
    [setBracketLogs]
  );

  const toggleBracketFinal = useCallback(
    (gameId: string) => {
      setBracketLogs((prev) => {
        const current = prev[gameId] || blankLog();
        return {
          ...prev,
          [gameId]: {
            ...current,
            awayK: current.awayK || "0",
            homeK: current.homeK || "0",
            isFinal: !current.isFinal,
          },
        };
      });
    },
    [setBracketLogs]
  );

  const clearBracketScores = useCallback(
    (gameIds: string[], label: string) => {
      const ids = new Set(gameIds);
      setBracketLogs((prev) =>
        Object.fromEntries(Object.entries(prev).filter(([gameId]) => !ids.has(gameId)))
      );
      showToast(`${label} scores cleared.`, { tone: "success" });
    },
    [showToast, setBracketLogs]
  );

  const addGameValid = !!newAway && !!newHome && newAway !== newHome;

  const addGame = () => {
    if (!addGameValid) {
      showToast("Pick two different teams to add a game.", { tone: "error" });
      return;
    }
    const id = `game_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    setMatchups((prev) => [
      ...prev,
      { id, date: normalizeDateInput(newDate), away: newAway, home: newHome },
    ]);
    setLogs((prev) => ({ ...prev, [id]: blankLog(String(settings.defaultGameInnings)) }));
    setNewDate("");
  };

  /**
   * Filling this season's scores from the Team Rankings pool — in practice, from a GameChanger
   * pull. The plan is built when the panel opens rather than continuously: it reads the pool off
   * storage, and nothing about it changes while the review is on screen. Where Team Rankings is the
   * cloud's, the server makes the same plan from the season as this device holds it (`league.fill`).
   */
  const [scoreFillPlan, setScoreFillPlan] = useState<LeagueFillPlan | null>(null);
  /*
   * The scores the open plan was made from: a game scored here since, while the server was asked
   * or with the panel open, is not filled over (`applyLeagueScoreFill`).
   */
  const scoreFillSeen = useRef<Record<string, RecordedRuns>>({});
  // Asked of the server and not answered yet: the button says so and takes no second press.
  const [scoreFillAsking, setScoreFillAsking] = useState(false);
  // The season open now, for a plan the server answers after another one was switched to.
  const activeSeasonRef = useRef(activeSeasonId);
  useLayoutEffect(() => {
    activeSeasonRef.current = activeSeasonId;
  }, [activeSeasonId]);

  const openScoreFill = () => {
    if (!rankingsLive) {
      scoreFillSeen.current = logs;
      setScoreFillPlan(
        planLeagueScoreFill({
          seasonId: activeSeasonId,
          teams,
          matchups,
          logs,
          ageGroups: loadAgeGroups(),
          scoutTeams: loadScoutTeams(),
          scoutGames: loadScoutGamesForSeason(activeSeasonId),
        })
      );
      return;
    }
    const season = activeSeasonId;
    const seen = logs;
    setScoreFillAsking(true);
    void askLeague({
      kind: "league.fill",
      season,
      teams: teams.map(({ id, name, scoutTeamId }) => ({
        id,
        name,
        ...(scoutTeamId === undefined ? {} : { scoutTeamId }),
      })),
      matchups: matchups.map(({ id, date, away, home }) => ({ id, date, away, home })),
      runs: Object.entries(logs).map(([id, log]) => ({
        id,
        awayRuns: log.awayRuns,
        homeRuns: log.homeRuns,
        ...(log.isFinal ? { isFinal: true as const } : {}),
      })),
      today: todayIsoDay(),
    }).then((answer) => {
      setScoreFillAsking(false);
      if (!answer) {
        showToast(LEAGUE_UNANSWERED, { tone: "error" });
        return;
      }
      // Opened for the season it was asked about, not one switched to while it was asked.
      if (season !== activeSeasonRef.current) return;
      scoreFillSeen.current = seen;
      setScoreFillPlan(answer.plan);
    });
  };

  const applyScoreFill = (matchupIds: string[], otherVersion: string[]) => {
    const plan = scoreFillPlan;
    if (!plan) return;
    const seen = scoreFillSeen.current;
    const innings = settings.defaultGameInnings;
    const result = applyLeagueScoreFill(plan, matchupIds, logs, innings, otherVersion, seen);
    setScoreFillPlan(null);
    if (result.filled === 0) {
      showToast(
        result.changed === 0
          ? "Nothing was filled in."
          : `Nothing was filled in: ${
              result.changed === 1
                ? "1 game changed here since, left as it is"
                : `${result.changed} games changed here since, left as they are`
            }.`,
        { tone: "info" }
      );
      return;
    }
    captureUndo("Filled scores from Team Rankings");
    // Filled onto the scores as they are by then, not as this handler saw them.
    setLogs(
      (prev) => applyLeagueScoreFill(plan, matchupIds, prev, innings, otherVersion, seen).logs
    );
    showToast(summarizeLeagueFill(plan, result.filled, result.changed), {
      tone: "undo",
      actionLabel: "Undo",
      onAction: restoreUndo,
    });
  };

  const removeGame = async (gameId: string) => {
    const confirmed = await requestConfirmation({
      title: "Delete this game?",
      message: "This removes the game and its current score data. An undo snapshot will be saved.",
      confirmLabel: "Delete game",
    });
    if (!confirmed) return;
    const game = matchups.find((m) => m.id === gameId);
    captureUndo(
      game
        ? `Deleted ${displayName(teamBaseById.get(game.away)?.name || game.away)} vs ${displayName(teamBaseById.get(game.home)?.name || game.home)}`
        : "Deleted game"
    );
    setMatchups((prev) => prev.filter((g) => g.id !== gameId));
    setLogs((prev) => {
      const next = { ...prev };
      delete next[gameId];
      return next;
    });
    showToast("Game deleted.", {
      tone: "undo",
      actionLabel: "Undo",
      onAction: restoreUndo,
    });
  };

  const swapGame = (gameId: string) => {
    setMatchups((prev) =>
      prev.map((game) =>
        game.id === gameId ? { ...game, away: game.home, home: game.away } : game
      )
    );
    setLogs((prev) => {
      const log = prev[gameId];
      if (!log) return prev;
      return { ...prev, [gameId]: swappedLog(log) };
    });
  };

  // ---------- Data quality (2.3) ----------

  const today = useToday();
  /*
   * Every finding on the season. Read from the scores as they stand, since a game scored and not
   * marked final is one of the things it looks for, and deferred like them; cheap (one pass over
   * the games), so it is kept whatever tab is open, for the Dashboard's count.
   */
  const findings = useMemo(
    () =>
      auditLeague({
        teams,
        matchups,
        logs: deferredLogs,
        settings,
        links: scoutBridge.rows,
        today,
      }),
    [teams, matchups, deferredLogs, settings, scoutBridge.rows, today]
  );
  /* The findings put aside on this device, held by season id as the team followed is. */
  const [putAsideHeld, setPutAsideHeld] = useState(() => ({
    seasonId: activeSeasonId,
    entries: readPutAside(activeSeasonId),
  }));
  const putAsideEntries =
    putAsideHeld.seasonId === activeSeasonId ? putAsideHeld.entries : readPutAside(activeSeasonId);
  const openFindings = useMemo(
    () => findings.filter((finding) => !isDismissed(finding, putAsideEntries)),
    [findings, putAsideEntries]
  );
  /*
   * What the tab row marks (2.4): Data Quality with what needs attention, which also brings it out
   * of More on a phone. A setting at fault (the cut line, games per team, a link) is one of those
   * findings, so it is counted there rather than marked twice.
   */
  const viewBadges = useMemo((): Partial<Record<ActiveView, TabNavItem<ActiveView>["badge"]>> => {
    const attention = openFindings.filter((finding) => finding.severity === "attention").length;
    return {
      ...(attention
        ? {
            quality: {
              count: attention,
              describe: `${attention} ${attention === 1 ? "needs" : "need"} attention`,
              urgent: true,
            },
          }
        : {}),
    };
  }, [openFindings]);
  const narrowScreen = useNarrowViewport();
  const asideFindings = useMemo(
    () => findings.filter((finding) => isDismissed(finding, putAsideEntries)),
    [findings, putAsideEntries]
  );
  const setPutAside = useCallback(
    (entries: Record<string, FindingSeverity>) => {
      writePutAside(activeSeasonId, entries);
      setPutAsideHeld({ seasonId: activeSeasonId, entries });
    },
    [activeSeasonId]
  );
  const putFindingAside = useCallback(
    (finding: Finding) =>
      setPutAside({ ...putAsideEntries, [finding.fingerprint]: finding.severity }),
    [putAsideEntries, setPutAside]
  );
  const bringFindingBack = useCallback(
    (finding: Finding) =>
      setPutAside(
        Object.fromEntries(
          Object.entries(putAsideEntries).filter(([print]) => print !== finding.fingerprint)
        )
      ),
    [putAsideEntries, setPutAside]
  );

  /*
   * The element a finding's link goes to, once its tab has drawn it: a game's card, or a setting
   * marked `data-setting`. Looked for a frame at a time, since the tab may still be loading.
   */
  const [focusAfterOpen, setFocusAfterOpen] = useState<
    { gameId: string } | { setting: string } | null
  >(null);
  useEffect(() => {
    if (!focusAfterOpen) return;
    let frames = 0;
    let frame = 0;
    const look = () => {
      const found =
        "gameId" in focusAfterOpen
          ? document.getElementById(`game-card-${focusAfterOpen.gameId}`)
          : document.querySelector<HTMLElement>(`[data-setting="${focusAfterOpen.setting}"]`);
      if (found) {
        found.scrollIntoView?.({ block: "center" });
        const control = found.matches("input, select, button")
          ? found
          : found.querySelector<HTMLElement>("input, select, button");
        (control ?? found).focus({ preventScroll: true });
        setFocusAfterOpen(null);
        return;
      }
      frames += 1;
      if (frames < 180) frame = requestAnimationFrame(look);
      else setFocusAfterOpen(null);
    };
    frame = requestAnimationFrame(look);
    return () => cancelAnimationFrame(frame);
  }, [focusAfterOpen, activeView]);

  const openFindingTarget = useCallback(
    (target: FindingTarget) => {
      if (target.kind === "team") {
        openTeamData(target.id);
      } else if (target.kind === "game") {
        setScoreboardTeamFilter("ALL");
        setActiveView("games");
        setFocusAfterOpen({ gameId: target.id });
      } else {
        setActiveView("settings");
        setFocusAfterOpen({ setting: target.id });
      }
    },
    [openTeamData]
  );

  /*
   * A finding's repair, made: asked first when it deletes, taken as one undo step, and reported by
   * what it actually changed, which is worked out again from the season as it is now rather than
   * as the finding saw it, so a game given anything since is never deleted, nor the last copy of
   * one (`copiesToDelete`), and one marked final since is not counted.
   */
  const repairFinding = async (finding: Finding) => {
    const repair = finding.repair;
    if (!repair) return;
    const lockedBecause = seasonStore.locked();
    if (lockedBecause) {
      showToast(lockedBecause, { tone: "error" });
      return;
    }
    const lines = repairPreview(repair, { teams, matchups, logs });
    if (repairIsDestructive(repair)) {
      const confirmed = await requestConfirmation({
        title: lines.length === 1 ? "Delete this game?" : `Delete these ${lines.length} games?`,
        message: `${lines.join(" ")} An undo snapshot will be saved.`,
        confirmLabel: lines.length === 1 ? "Delete game" : "Delete games",
      });
      if (!confirmed) return;
    }
    const now = seasonStore.get().season;
    const scoredOpen = (id: string) => {
      const log = now.logs[id];
      return !isFinal(log) && Boolean(log?.awayRuns.trim()) && Boolean(log?.homeRuns.trim());
    };
    const undo = { tone: "undo" as const, actionLabel: "Undo", onAction: restoreUndo };
    if (repair.kind === "removeGames") {
      const ids = new Set(copiesToDelete(repair.gameIds, now));
      if (!ids.size) {
        showToast("Nothing to delete: those games have changed since.", { tone: "error" });
        return;
      }
      captureUndo(`Deleted ${ids.size === 1 ? "a duplicate game" : `${ids.size} duplicate games`}`);
      setMatchups((prev) => prev.filter((game) => !ids.has(game.id)));
      setLogs((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !ids.has(id))));
      showToast(ids.size === 1 ? "Deleted 1 game." : `Deleted ${ids.size} games.`, undo);
    } else if (repair.kind === "markFinal") {
      const ids = repair.gameIds.filter(scoredOpen);
      if (!ids.length) {
        showToast("Nothing to mark: those games have changed since.", { tone: "error" });
        return;
      }
      captureUndo(`Marked ${ids.length === 1 ? "a game" : `${ids.length} games`} final`);
      setLogs((prev) =>
        ids.reduce((next, id) => withFinal(next, id, true, settings.defaultGameInnings), prev)
      );
      showToast(
        ids.length === 1 ? "Marked 1 game final." : `Marked ${ids.length} games final.`,
        undo
      );
    } else {
      // A setting is all this repair changes, so the step must carry the settings to put it back.
      captureUndo(`Games per team ${repair.from} to ${repair.to}`, { withSettings: true });
      setSettings((prev) => ({ ...prev, regularSeasonGamesPerTeam: repair.to }));
      showToast(`Games per team is now ${repair.to}.`, undo);
    }
  };
  const previewRepair = useCallback(
    (repair: FindingRepair) => repairPreview(repair, { teams, matchups, logs }),
    [teams, matchups, logs]
  );

  const loadDemoSeason = useCallback(async () => {
    // Reached from the command palette as well as the page: refused before it asks, or takes an
    // undo step over the one there, while the season may not be written.
    const lockedBecause = seasonStore.locked();
    if (lockedBecause) {
      showToast(lockedBecause, { tone: "error" });
      return;
    }
    // Nothing to overwrite on an empty season, and the first thing a new user
    // is invited to do should not open with a warning about losing data.
    if (teams.length > 0 || matchups.length > 0) {
      const confirmed = await requestConfirmation({
        title: "Load demo season?",
        message:
          "This replaces the current teams, games, and scores with a sample season and saves an undo snapshot.",
        confirmLabel: "Load demo",
      });
      if (!confirmed) return;
    }
    const demo = buildDemoSeason();
    captureUndo("Load demo season", { withSettings: true });
    setTeams(demo.teams);
    setMatchups(demo.matchups);
    setLogs(demo.logs);
    setBracketLogs({});
    setSettings(demo.settings);
    setActiveView("standings");
    closeTeamData();
    showToast("Loaded demo season.", {
      tone: "undo",
      actionLabel: "Undo",
      onAction: restoreUndo,
    });
  }, [
    teams,
    matchups,
    requestConfirmation,
    captureUndo,
    closeTeamData,
    showToast,
    restoreUndo,
    seasonStore,
    setTeams,
    setMatchups,
    setLogs,
    setBracketLogs,
    setSettings,
  ]);

  // ---------- Season builder ----------

  /*
   * The schedule itself, the score sheet and the file name are all in `roundRobin.ts`: none of
   * them needs a browser, and a round robin's own correctness — every pair exactly once, in a
   * stable order — is the sort of thing to check by reading it rather than by clicking through it.
   * What is left here is what only a component can do: ask, adopt, and hand the browser a file.
   */
  const builtFromList = () => {
    const built = buildRoundRobin(builderTeamNames(seasonBuilderText), settings.defaultGameInnings);
    // The message belongs here rather than in the builder, which has no way to say anything.
    if (!built) showToast("Enter at least two teams to build a schedule.", { tone: "error" });
    return built;
  };

  const createSeasonFromTeamList = async () => {
    const built = builtFromList();
    if (!built) return;
    const confirmed = await requestConfirmation({
      title: "Create blank season?",
      message: `${built.teams.length} teams · ${built.matchups.length} games.\n\nEach team plays every other team once. This replaces current season data and saves an undo snapshot.`,
      confirmLabel: "Create season",
    });
    if (!confirmed) return;
    captureUndo("Create blank season");
    setTeams(built.teams);
    setMatchups(built.matchups);
    setLogs(built.logs);
    setBracketLogs({});
    setLastImpact(null);
    closeTeamData();
    setScoreboardTeamFilter("ALL");
    setActiveView("games");
    showToast(`Created ${built.matchups.length}-game schedule.`, {
      tone: "undo",
      actionLabel: "Undo",
      onAction: restoreUndo,
    });
  };

  const downloadRoundRobinCSV = () => {
    const built = builtFromList();
    if (!built) return;
    const blob = new Blob([roundRobinCsv(built, settings)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = roundRobinFileName(settings.seasonLabel);
    link.click();
    URL.revokeObjectURL(url);
  };

  // ---------- Header / selection ----------

  const selectedTeam = selectedTeamId ? (dashboardById.get(selectedTeamId) ?? null) : null;
  const selectedTeamSplitSummary = useMemo(
    () =>
      selectedTeam
        ? buildTeamSplitSummary(selectedTeam.id, matchups, logs)
        : {
            all: emptySplitLine("Overall"),
            home: emptySplitLine("Home"),
            away: emptySplitLine("Away"),
          },
    [selectedTeam, matchups, logs]
  );
  const selectedTeamTrendSummary = useMemo(
    () =>
      selectedTeam
        ? buildTeamTrendSummary(selectedTeam.id, matchups, logs, runsOnly)
        : buildTeamTrendSummary("", [], {}, runsOnly),
    [selectedTeam, matchups, logs, runsOnly]
  );
  const compareTeam = compareTeamId ? (dashboardById.get(compareTeamId) ?? null) : null;

  /*
   * The team this browser follows, for the Dashboard's card: this browser's own pick, one per season
   * (`readOurTeam`), and never a setting, which would travel in a shared link. Held by season id,
   * so a season switch reads the pick made for that season rather than carrying one across.
   */
  const [ourTeamPick, setOurTeamPick] = useState(() => ({
    seasonId: activeSeasonId,
    teamId: readOurTeam(activeSeasonId),
  }));
  const ourTeamId =
    ourTeamPick.seasonId === activeSeasonId ? ourTeamPick.teamId : readOurTeam(activeSeasonId);
  const pickOurTeam = useCallback(
    (teamId: string | null) => {
      writeOurTeam(activeSeasonId, teamId);
      setOurTeamPick({ seasonId: activeSeasonId, teamId });
    },
    [activeSeasonId]
  );
  /*
   * Where the followed team's club stands on Team Rankings, as its board last stood there
   * (`leagueClubRankFor`). Read again whenever the League side is shown, since the Rankings side
   * is what writes it.
   */
  const ourClubRank = useMemo(
    () =>
      ourTeamId && appMode === "league" ? leagueClubRankFor(activeSeasonId, ourTeamId) : undefined,
    [activeSeasonId, ourTeamId, appMode]
  );
  const ourTeam = useMemo(() => {
    const team = ourTeamId ? dashboardById.get(ourTeamId) : undefined;
    if (!team) return null;
    const magic =
      hasCutLine && remainingGames.length <= EXACT_MAGIC_REMAINING_GAME_LIMIT
        ? magicForGold(team.id, dashboardRows, remainingGames, goldCutoff, settings).description
        : undefined;
    return ourTeamSummary(team, dashboardRows.length, {
      hasCutLine,
      swings: nextTwoSwingGames(team.id),
      ...(magic ? { magic } : {}),
    });
  }, [
    ourTeamId,
    dashboardById,
    dashboardRows,
    hasCutLine,
    remainingGames,
    goldCutoff,
    settings,
    nextTwoSwingGames,
  ]);
  const currentLeader = dashboardRows[0];

  /*
   * What changed in the season since this device last looked (2.6): another device's scores, games
   * moved or removed, clinches and eliminations, the followed team's odds moving. The race is read
   * from the forecast once its odds have settled, and not at all without a cut line. Notifications
   * of the same, opted into, while the app is open but not looked at.
   */
  const [notifyPrefs, setNotifyPrefsState] = useState<NotifyPrefs>(readNotifyPrefs);
  const setNotifyPrefs = useCallback((prefs: NotifyPrefs) => {
    setNotifyPrefsState(prefs);
    writeNotifyPrefs(prefs);
  }, []);
  // Changed in another tab, the installed app beside this one: followed here, or this tab would
  // go on announcing what was turned off there.
  useEffect(() => subscribeNotifyPrefs(() => setNotifyPrefsState(readNotifyPrefs())), []);
  /*
   * Only once the deferred finals have caught up with the season as well (`finalLogs`): until
   * then the forecast is still the one from before the scores that just came, and a race read
   * from it would be set beside the season it does not describe.
   */
  const digestRace = useMemo(
    () =>
      hasCutLine && !oddsPending && finalLogs === storedFinalLogs && dashboardRows.length
        ? raceOf(dashboardRows)
        : null,
    [hasCutLine, oddsPending, finalLogs, storedFinalLogs, dashboardRows]
  );
  const digest = useSeasonDigest({
    store: seasonStore,
    race: digestRace,
    followed: ourTeamId,
    oddsMove: digestOddsMove(notifyPrefs),
    heard: liveLeague.state.kind === "live",
  });
  useDigestNotifications({
    seasonId: activeSeasonId,
    seasonLabel: settings.seasonLabel,
    changes: digest.changes,
    prefs: notifyPrefs,
    followed: ourTeamId,
    problem: needsAPerson(liveLeague.state),
    nameOf,
  });
  const digestBadge: TabNavItem<ActiveView>["badge"] | undefined = digest.changes.length
    ? {
        count: digest.changes.length,
        describe: `${digest.changes.length} ${digest.changes.length === 1 ? "change" : "changes"} since you last looked`,
      }
    : undefined;

  const selectedTeamDetail = useMemo(() => {
    if (!selectedTeam) return null;
    const swings = nextTwoSwingGames(selectedTeam.id);
    return {
      bubble: bubbleTierForTeam(selectedTeam),
      currentSosRank: currentSosRanks[selectedTeam.id] ?? null,
      goldPctLabel: formatGoldPct(selectedTeam),
      range: seedRangeForTeam(selectedTeam.id),
      sos: scheduleDifficultyForTeam(selectedTeam.id),
      swings,
      titleRace: titleRaceBadgeForTeam(selectedTeam),
      clinchScenarios: clinchScenariosForTeam(selectedTeam.id),
      magic:
        remainingGames.length <= EXACT_MAGIC_REMAINING_GAME_LIMIT
          ? magicForGold(selectedTeam.id, dashboardRows, remainingGames, goldCutoff, settings)
          : {
              type: "magic" as const,
              ownWinsNeeded: 0,
              opponentLossesNeeded: 0,
              description: `Exact magic number is paused until ${EXACT_MAGIC_REMAINING_GAME_LIMIT} or fewer games remain to keep team modals responsive.`,
            },
      elimination:
        remainingGames.length <= EXACT_MAGIC_REMAINING_GAME_LIMIT
          ? eliminationNumberForGold(
              selectedTeam.id,
              dashboardRows,
              remainingGames,
              goldCutoff,
              settings
            )
          : {
              type: "elimination" as const,
              ownWinsNeeded: 0,
              opponentLossesNeeded: 0,
              description: `Exact elimination number is paused until ${EXACT_MAGIC_REMAINING_GAME_LIMIT} or fewer games remain to keep team modals responsive.`,
            },
      path: pathSummary(
        { ...selectedTeam, rank: selectedTeam.rank ?? 99 },
        goldCutoff,
        swings.map((swing) => ({
          opponentName: swing.opponentName,
          teamIsAway: swing.teamIsAway,
          winSeed: swing.winSeed,
          lossSeed: swing.lossSeed,
        })),
        {
          totalTeams: dashboardRows.length,
          leaderName: currentLeader ? displayName(currentLeader.name) : "",
        }
      ),
    };
  }, [
    selectedTeam,
    nextTwoSwingGames,
    bubbleTierForTeam,
    currentSosRanks,
    formatGoldPct,
    seedRangeForTeam,
    scheduleDifficultyForTeam,
    titleRaceBadgeForTeam,
    clinchScenariosForTeam,
    dashboardRows,
    remainingGames,
    goldCutoff,
    settings,
    currentLeader,
  ]);

  const finalCount = completedGames.length;
  const totalGamesCount = matchups.length;
  const weeklyStory = useMemo(() => {
    if (!lastImpact || lastImpact.recapItems.length === 0) return "";
    return recapToStoryBrief(settings.seasonLabel, lastImpact.recapItems);
  }, [lastImpact, settings.seasonLabel]);

  // Gemini rewrite of the same facts. The request is null until there is real
  // movement to describe, so the endpoint is only called when the story changes.
  const leagueSummaryRequest = useMemo(() => {
    if (!lastImpact || lastImpact.recapItems.length === 0) return null;
    return buildLeagueSummaryRequest({
      seasonLabel: settings.seasonLabel,
      cutoff: goldCutoff,
      hasCutLine,
      updateTitle: lastImpact.title,
      finalScores: lastImpact.scores,
      recapItems: lastImpact.recapItems,
      standings: dashboardRows.map((team) => ({
        rank: team.rank,
        name: team.name,
        w: team.w,
        l: team.l,
        t: team.t,
        goldPct: team.goldPct,
        status: statusLabel(team),
        projectedRank: team.projectedRank,
        runDiff: team.runDiff,
      })),
      powerRatings: predictionEngine.powerRatings.map((row) => ({
        rank: row.rank,
        teamName: row.teamName,
        rating: row.rating,
        record: row.record,
        trend: row.trend,
        recentForm: row.recentForm,
        sosRank: row.sosRank,
      })),
      statMetrics: statRankings.metrics.map((metric) => ({
        label: metric.label,
        direction: metric.direction,
        average: metric.average,
        entries: metric.entries.map((entry) => ({
          teamName: entry.teamName,
          value: entry.value,
        })),
      })),
      season: {
        finalGames: completedGames.length,
        totalGames: matchups.length,
        leaderName: currentLeader ? displayName(currentLeader.name) : undefined,
        gamesPerTeam: settings.regularSeasonGamesPerTeam,
      },
      fallback: weeklyStory,
    });
  }, [
    lastImpact,
    statusLabel,
    settings.seasonLabel,
    settings.regularSeasonGamesPerTeam,
    goldCutoff,
    hasCutLine,
    dashboardRows,
    predictionEngine,
    statRankings,
    completedGames,
    matchups,
    currentLeader,
    weeklyStory,
  ]);

  /*
   * Whether the write-ups fetch themselves. Held here so flipping it in Settings takes effect
   * everywhere at once rather than on the next reload.
   */
  const [summaryMode, setSummaryModeState] = useState<SummaryMode>(() => readSummaryMode());
  const setSummaryMode = useCallback((mode: SummaryMode) => {
    setSummaryModeState(mode);
    writeSummaryMode(mode);
  }, []);

  const aiStory = useLeagueSummary(leagueSummaryRequest, { mode: summaryMode });
  const storyText = aiStory.status === "ready" ? aiStory.summary : weeklyStory;

  // Forecast write-up: the projected finish, the model's upcoming picks, the
  // games that swing most, and how accurate the model has actually been. Only
  // requested while the Forecast view is open, so it costs nothing elsewhere.
  const forecastSummaryRequest = useMemo(() => {
    if (activeView !== "model" || modelRows.length === 0) return null;
    return buildForecastSummaryRequest({
      seasonLabel: settings.seasonLabel,
      cutoff: goldCutoff,
      hasCutLine,
      projections: modelRows.map((team) => {
        const range = seedRangeForTeam(team.id);
        return {
          name: team.name,
          projectedRank: team.projectedRank,
          currentRank: team.rank,
          projectedRecord: team.projectedRecord,
          goldPct: team.goldPct,
          goldMargin: team.goldPctMargin,
          bestSeed: range.best,
          worstSeed: range.worst,
        };
      }),
      gameForecasts: gameForecasts.slice(0, 18).map((item) => ({
        awayName: item.awayName,
        homeName: item.homeName,
        favoriteName: item.winnerName,
        winPct: item.winnerPct,
        impact: item.impact?.impactLabel,
        date: item.game.date,
      })),
      keyGames: gamesThatMatterMost.slice(0, 10).map((item) => ({
        label: item.label,
        reason: item.reason,
        date: item.date,
      })),
      modelAccuracy: {
        gamesEvaluated: backtestResult.sampleSize,
        brierScore: backtestResult.brierScore ?? undefined,
        hitRate:
          backtestResult.winnerAccuracy === null ? undefined : backtestResult.winnerAccuracy * 100,
        confidentMissRate:
          backtestResult.confidentMissRate === null
            ? undefined
            : backtestResult.confidentMissRate * 100,
      },
      season: {
        finalGames: completedGames.length,
        totalGames: matchups.length,
        leaderName: currentLeader ? displayName(currentLeader.name) : undefined,
        gamesPerTeam: settings.regularSeasonGamesPerTeam,
      },
    });
  }, [
    activeView,
    seedRangeForTeam,
    modelRows,
    gameForecasts,
    gamesThatMatterMost,
    backtestResult,
    goldCutoff,
    hasCutLine,
    settings.seasonLabel,
    settings.regularSeasonGamesPerTeam,
    completedGames,
    matchups,
    currentLeader,
  ]);

  const forecastStory = useLeagueSummary(forecastSummaryRequest, { mode: summaryMode });

  // ---------- Share + URL snapshot ----------

  const sharedHandledRef = useRef(false);
  /*
   * The Undo on the toast below is pressed long after this effect has run, so it has to call
   * whatever `restoreUndo` is at that moment rather than the one that existed when the snapshot
   * loaded. The ref is read inside the handler for that reason; the effect itself runs once per
   * snapshot and must not re-run when an unrelated callback is rebuilt.
   */
  const restoreUndoRef = useRef(restoreUndo);
  restoreUndoRef.current = restoreUndo;

  useEffect(() => {
    // Asked once the season may be written: League kept live opens read-only until the cloud's
    // version is in, and a link loaded then would be refused, and lost.
    if (!sharedSnapshot || sharedHandledRef.current || !leagueEditable) return;
    sharedHandledRef.current = true;
    requestConfirmation({
      title: "Load shared season snapshot?",
      message: `${sharedSnapshot.teams.length} teams · ${sharedSnapshot.matchups.length} games found in this URL.\n\nReplace your current local data? Cancel keeps your data; the URL snapshot will still be cleared.`,
      confirmLabel: "Load snapshot",
    }).then((ok) => {
      const why = ok ? seasonStore.locked() : null;
      if (why) {
        // Gone read-only while the question was up: the link is kept, and asked about again
        // once the season may be written.
        sharedHandledRef.current = false;
        showToast(why, { tone: "error" });
        return;
      }
      if (ok) {
        captureUndo("Load shared snapshot", { withSettings: true });
        setTeams(sharedSnapshot.teams);
        setMatchups(sharedSnapshot.matchups);
        setLogs(sharedSnapshot.logs);
        // A link carries no bracket, and the one here was scored between the teams just replaced.
        setBracketLogs({});
        setSettings(sharedSnapshot.settings);
        if (sharedUiState.view) setActiveView(sharedUiState.view);
        if (sharedUiState.teamId) setSelectedTeamId(sharedUiState.teamId);
        showToast("Loaded shared snapshot and view state.", {
          tone: "undo",
          actionLabel: "Undo",
          onAction: () => restoreUndoRef.current(),
        });
      }
      clearSharedSnapshot();
    });
    /*
     * The callbacks are stable, so listing them changes nothing about when this runs — and
     * `sharedHandledRef` makes a second run a no-op regardless. The point of listing them is that
     * the next person to add a closure here gets told, rather than inheriting a comment that was
     * true when it was written. `leagueEditable` is the one that does change it: the question is
     * put once the season may be written.
     */
  }, [
    sharedSnapshot,
    sharedUiState,
    leagueEditable,
    seasonStore,
    captureUndo,
    clearSharedSnapshot,
    requestConfirmation,
    showToast,
    setTeams,
    setMatchups,
    setLogs,
    setBracketLogs,
    setSettings,
  ]);

  // ---------- Scenario links (2.7) ----------

  /*
   * A playoff-machine scenario someone shared: shown, and kept on this device for the open season
   * only once the person says so (`scenarioLink.ts`). It never touches the season. The handling
   * is fetched only when a link names a scenario, so none of it is in the page's first download.
   */
  const [scenarioLink, setScenarioLink] = useState<{ hash: string } | null>(() =>
    typeof window !== "undefined" && window.location.hash.includes("scenario=")
      ? { hash: window.location.hash }
      : null
  );
  useEffect(() => {
    const heard = () => {
      if (window.location.hash.includes("scenario="))
        setScenarioLink({ hash: window.location.hash });
    };
    window.addEventListener("hashchange", heard);
    return () => window.removeEventListener("hashchange", heard);
  }, []);
  const scenarioLinkTaken = useRef<{ hash: string } | null>(null);
  const [incomingScenario, setIncomingScenario] = useState<{
    seasonId: string;
    id: string;
  } | null>(null);
  const incomingScenarioOpened = useCallback(() => setIncomingScenario(null), []);
  /*
   * Whether the season on screen is still to give way to the cloud's: the sign-in still coming, a
   * member's first meeting with the cloud's seasons, or League kept live waiting for its version.
   */
  const leagueComing = leagueArriving({ status: cloud, met: leagueMet, inStep: leagueSettled });
  const seasonArriving = leagueComing || liveLeague.state.kind === "connecting";
  const scenarioLinkWaitTold = useRef<{ hash: string } | null>(null);
  useEffect(() => {
    // Signed in, with the cloud's newer seasons still to be taken in on a first meeting: they come
    // when the page is left, left alone a while or asked, which may be minutes. The other waits are
    // a moment's, and go unsaid.
    if (
      !scenarioLink ||
      scenarioLinkTaken.current === scenarioLink ||
      scenarioLinkWaitTold.current === scenarioLink ||
      appMode !== "league" ||
      cloud.kind !== "saved" ||
      !leagueComing
    )
      return;
    scenarioLinkWaitTold.current = scenarioLink;
    showToast("The shared scenario opens once League Standings has the cloud's newer seasons.", {
      tone: "info",
      actionLabel: "Load them now",
      onAction: () => void loadNewer(),
      durationMs: 12_000,
    });
  }, [scenarioLink, appMode, cloud.kind, leagueComing, showToast]);
  useEffect(() => {
    // Asked once the open season is the one this device shows, so the link is matched against the
    // season's own games; until then it stays in the address bar, to be asked about then.
    if (
      !scenarioLink ||
      scenarioLinkTaken.current === scenarioLink ||
      appMode !== "league" ||
      seasonArriving
    )
      return;
    scenarioLinkTaken.current = scenarioLink;
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    const seasonId = activeSeasonId;
    const seasonName = seasons.all.find((season) => season.id === seasonId)?.name ?? "this season";
    void import("./lib/scenarioLink")
      .then((links) =>
        links.openScenarioLink({
          hash: scenarioLink.hash,
          seasonId,
          seasonName,
          matchups,
          logs,
          nameOf,
          ask: requestConfirmation,
          say: (text, tone) => showToast(text, { tone }),
        })
      )
      .then((kept) => {
        if (!kept) return;
        setIncomingScenario({ seasonId, id: kept.id });
        setActiveView("model");
      })
      .catch(() =>
        showToast("The scenario link could not be opened. Reload the page and open it again.", {
          tone: "error",
        })
      );
  }, [
    scenarioLink,
    appMode,
    seasonArriving,
    activeSeasonId,
    seasons.all,
    matchups,
    logs,
    nameOf,
    requestConfirmation,
    showToast,
  ]);

  const shareSeason = useCallback(async () => {
    const snapshot = { v: 1 as const, teams, matchups, logs, settings };
    try {
      const url = buildShareUrl(window.location.href, snapshot, {
        view: activeView,
        teamId: selectedTeamId ?? undefined,
      });
      try {
        await navigator.clipboard.writeText(url);
        showToast(
          activeView === "standings" && !selectedTeamId
            ? "Share URL copied to clipboard."
            : "Share URL copied with the current tab and team context.",
          { tone: "success" }
        );
      } catch {
        showToast(
          "Could not copy automatically. Share URL is ready in your browser clipboard permissions prompt.",
          { tone: "error" }
        );
      }
    } catch {
      showToast(
        "Snapshot is too large for a share URL. Use Settings → Download backup JSON instead.",
        {
          tone: "error",
        }
      );
    }
  }, [teams, matchups, logs, settings, activeView, selectedTeamId, showToast]);

  // ---------- Command palette + shortcuts ----------

  const describeCommandTeam = useCallback(
    (team: TeamWithProjection) => ({ name: displayName(team.name), record: recordText(team) }),
    []
  );

  const commandActions = useMemo(
    () => ({
      openTeam: openTeamData,
      openView: (view: ActiveShareView) => setActiveView(view),
      shareSeason: () => void shareSeason(),
      exportCSV: () => exportCSV(),
      exportBackup: () => exportBackup(),
      loadDemoSeason: () => void loadDemoSeason(),
      toggleTheme,
      showShortcuts: () => setShowShortcuts(true),
      showTour: () => setShowTour(true),
    }),
    [openTeamData, shareSeason, exportCSV, exportBackup, loadDemoSeason, toggleTheme]
  );

  const commands = useLeagueCommands({
    teams: dashboardRows,
    views: VIEW_ORDER.map((view) => ({ view, label: VIEW_LABELS[view] })),
    theme,
    describeTeam: describeCommandTeam,
    actions: commandActions,
  });

  const shortcuts: Shortcut[] = useMemo(
    () => [
      // The palette, the shortcut sheet and the theme are the app's, not one half's.
      {
        combo: "mod+k",
        description: "Open command palette",
        group: "General",
        handler: () => setShowCommandPalette(true),
      },
      {
        combo: "shift+/",
        description: "Show shortcuts",
        group: "General",
        handler: () => setShowShortcuts(true),
      },
      {
        combo: "d",
        description: "Toggle dark mode",
        group: "Action",
        handler: toggleTheme,
      },
      /*
       * Team Rankings had the palette and the shortcut sheet — those are the app's, not one
       * half's — but no way to move between its six sections from the keyboard, on the half with a
       * nationwide pool and the most places to be. These are built from the commands the view
       * publishes rather than from a second navigation path: the view owns its own route, and a
       * section it adds arrives here with a key already attached.
       */
      ...(appMode !== "rankings"
        ? []
        : RANKINGS_COMMAND_SECTIONS.flatMap(({ section, label, key }) => {
            const command = rankingsCommands.find(
              (entry) => entry.id === rankingsSectionCommandId(section)
            );
            return command
              ? [
                  {
                    combo: `g ${key}`,
                    description: `Go to ${label}`,
                    group: "Navigate",
                    handler: command.run,
                  },
                ]
              : [];
          })),
      ...(appMode !== "league"
        ? []
        : [
            {
              combo: "g s",
              description: "Go to Standings",
              group: "Navigate",
              handler: () => setActiveView("standings"),
            },
            {
              combo: "g t",
              description: "Go to League Stats",
              group: "Navigate",
              handler: () => setActiveView("teamStats"),
            },
            {
              combo: "g g",
              description: "Go to Schedule",
              group: "Navigate",
              handler: () => setActiveView("games"),
            },
            {
              combo: "g m",
              description: "Go to Forecast",
              group: "Navigate",
              handler: () => setActiveView("model"),
            },
            {
              combo: "g e",
              description: "Go to Settings",
              group: "Navigate",
              handler: () => setActiveView("settings"),
            },
          ]),
    ],
    [appMode, toggleTheme, rankingsCommands]
  );
  useShortcuts(shortcuts);

  const shortcutEntries = shortcuts.map((s) => ({
    combo: s.combo,
    description: s.description,
    group: s.group,
  }));

  /** The light/dark switch, placed by the caller: in the title row on a phone, with the controls from `lg`. */
  const themeToggle = (placement: string) => (
    <button
      type="button"
      onClick={toggleTheme}
      className={`${placement} items-center justify-center rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-800 shadow-xs hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800`}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );

  // League's tab row: a sticky row at the top of a wide screen, a bar along the bottom of a phone's.
  const leagueTabs = (
    <TabNav
      label="Main views"
      items={VIEW_ORDER.map((view) => {
        const badge = view === "dashboard" ? digestBadge : viewBadges[view];
        return {
          key: view,
          label: VIEW_LABELS[view],
          tabId: `tab-${view}`,
          controls: `panel-${view}`,
          ...(VIEW_ICONS[view] ? { icon: VIEW_ICONS[view] } : {}),
          ...(badge ? { badge } : {}),
        };
      })}
      current={activeView}
      onSelect={setActiveView}
      narrow={narrowScreen}
      primary={PHONE_VIEWS}
      actions={[
        { label: "Take the tour", onSelect: () => setShowTour(true) },
        { label: "Keyboard shortcuts", onSelect: () => setShowShortcuts(true) },
      ]}
      // A tab about to be opened starts loading before the press (2.1).
      onPreview={(view) => void prefetchView(view)}
      className="mx-auto max-w-7xl px-4 py-1.5 sm:px-6 lg:px-8"
    />
  );

  return (
    <>
      {/*
       * Before this, a keyboard reached the content by tabbing the mode tablist and then seven
       * view tabs, on every single page. The link is the first thing in the tab order and shows
       * only once it has focus, and the two mains it points at take focus themselves so the next
       * Tab continues from the content rather than from the top again. The league main is also the
       * tabpanel, so its id moves with the open tab and the link follows it.
       */}
      <a
        href={appMode === "rankings" ? "#main-content" : `#panel-${activeView}`}
        className={`sr-only rounded-lg bg-slate-950 px-4 py-2 text-sm font-black text-white focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 dark:bg-white dark:text-slate-950 ${focusRing}`}
      >
        Skip to main content
      </a>
      {isOffline && (
        <div className="bg-amber-100 px-4 py-2 text-center text-xs font-bold text-amber-900 dark:bg-amber-900/70 dark:text-amber-100">
          You are offline. Showing cached app shell and local data; score edits still save in this
          browser.
        </div>
      )}
      <div className="min-h-screen bg-slate-100 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
        <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 pt-4 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-950 text-sm font-black text-white dark:bg-white dark:text-slate-950">
                  LF
                </div>
                {/*
                 * A size smaller on a phone, where the title row also holds the cloud button and the
                 * theme toggle: at its full size on a 360px screen the title took a second line once
                 * the cloud button joined the row, 28px more of the first screen.
                 */}
                <h1 className="text-xl font-black tracking-[-0.04em] text-slate-950 sm:text-2xl dark:text-white">
                  League Forecast
                </h1>
                {/*
                 * Below `lg` the theme toggle sits in the title row, the logo's size. At the end of
                 * the controls it fell to a row of its own on a phone whenever the season's name was
                 * long, and on Team Rankings always: 54px of the first screen for one button.
                 */}
                <div className="ml-auto flex shrink-0 items-center gap-2 lg:hidden">
                  <CloudButton
                    status={cloud}
                    onOpen={cloudPanel.show}
                    className="inline-flex h-10 w-10 shrink-0"
                  />
                  {themeToggle("inline-flex h-10 w-10 shrink-0")}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div
                  role="tablist"
                  aria-label="App mode"
                  className="flex w-full items-center gap-1 rounded-lg bg-slate-100 p-1 sm:inline-flex sm:w-auto dark:bg-slate-900"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={appMode === "league"}
                    onClick={() => setAppMode("league")}
                    className={tab(appMode === "league", "fill")}
                  >
                    League Standings
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={appMode === "rankings"}
                    onClick={() => setAppMode("rankings")}
                    className={tab(appMode === "rankings", "fill")}
                  >
                    Team Rankings
                  </button>
                </div>
                {appMode === "league" && (
                  <>
                    <label className="sr-only" htmlFor="season-switcher">
                      Active season
                    </label>
                    <select
                      id="season-switcher"
                      value={activeSeasonId}
                      onChange={(event) => seasons.switchTo(event.target.value)}
                      className="inline-flex rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                      aria-label="Active season"
                      title="Switch season"
                    >
                      {seasons.all.map((season) => (
                        <option key={season.id} value={season.id}>
                          {season.name}
                        </option>
                      ))}
                    </select>
                    {teams.length > 0 && (
                      <button
                        type="button"
                        onClick={shareSeason}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-800 shadow-xs hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                        aria-label="Copy share URL for this season"
                      >
                        Share
                      </button>
                    )}
                  </>
                )}
                {updateApp && (
                  <button
                    type="button"
                    onClick={() => {
                      void updateApp();
                    }}
                    className="inline-flex items-center gap-2 rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 shadow-xs hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-200 dark:hover:bg-blue-900/60"
                  >
                    Reload update
                  </button>
                )}
                <CloudButton
                  status={cloud}
                  onOpen={cloudPanel.show}
                  className="hidden h-11 w-11 lg:inline-flex"
                />
                {themeToggle("hidden p-3 lg:inline-flex")}
              </div>
            </div>

            {appMode === "league" && (
              <div
                className={`grid grid-cols-2 gap-3 pb-4 sm:grid-cols-3 ${
                  teams.length === 0 ? "hidden" : ""
                }`}
                aria-label="League pulse summary"
              >
                <HeaderStatCard
                  label="Games analyzed"
                  value={`${finalCount}/${totalGamesCount}`}
                  accent="from-emerald-400 via-cyan-400 to-blue-500"
                />
                <HeaderStatCard
                  label="Current leader"
                  value={currentLeader ? currentLeader.name : "—"}
                  accent="from-blue-500 via-indigo-500 to-slate-900"
                />
                {hasPostseason && (
                  <HeaderStatCard
                    label={hasCutLine ? "Gold cutoff" : "Postseason"}
                    value={hasCutLine ? `Top ${goldCutoff}` : "All teams"}
                    accent="from-amber-400 via-orange-500 to-red-500"
                  />
                )}
              </div>
            )}
          </div>
        </header>

        {appMode === "league" &&
          (narrowScreen ? (
            leagueTabs
          ) : (
            <div className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 shadow-xs shadow-slate-200/60 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/90 dark:shadow-black/20">
              {leagueTabs}
            </div>
          ))}

        {appMode === "rankings" ? (
          <main
            id="main-content"
            tabIndex={-1}
            // Room below on a phone for the tab bar fixed along the bottom of the screen (2.4).
            className="mx-auto max-w-7xl px-4 pb-32 pt-6 sm:px-6 sm:pb-6 lg:px-8"
          >
            <Suspense fallback={<LoadingPanel area="Team Rankings" />}>
              <RankingsOpen
                status={cloud}
                seasons={seasons.all}
                showToast={showToast}
                confirm={requestConfirmation}
                page={(handover) => (
                  <TeamRankingsView
                    seasons={seasons.all}
                    showToast={showToast}
                    requestConfirmation={requestConfirmation}
                    onDataChange={noteScoutChange}
                    onCommands={setRankingsCommands}
                    {...(handover ? { handover } : {})}
                  />
                )}
              />
            </Suspense>
          </main>
        ) : (
          <main
            // Room below on a phone for the tab bar fixed along the bottom of the screen (2.4).
            className="mx-auto max-w-7xl px-4 pb-32 pt-6 sm:px-6 sm:pb-6 lg:px-8"
            tabIndex={-1}
            id={`panel-${activeView}`}
            role="tabpanel"
            aria-labelledby={`tab-${activeView}`}
          >
            <LiveLeagueBanner state={liveLeague.state} />
            {/* Kept live, a season that may not be written is read-only: every control that edits
              it is off (`EditLock`), and what only reads it stays usable. */}
            <SeasonEditable value={leagueEditable}>
              {/* Each view loads on demand (2.1): a placeholder while it does, and a failed load is
                one view's Try again, not a blank page. */}
              <ErrorBoundary
                key={activeView}
                area={VIEW_LABELS[activeView]}
                onReset={() => resetView(activeView)}
              >
                <Suspense fallback={<LoadingPanel area={VIEW_LABELS[activeView]} />}>
                  {teams.length === 0 ? (
                    <EmptyState
                      importCSV={importCSV}
                      createSeasonFromTeamList={createSeasonFromTeamList}
                      downloadRoundRobinCSV={downloadRoundRobinCSV}
                      seasonBuilderText={seasonBuilderText}
                      setSeasonBuilderText={setSeasonBuilderText}
                      teams={teams}
                      loadDemoSeason={loadDemoSeason}
                      openTour={() => setShowTour(true)}
                    />
                  ) : activeView === "dashboard" ? (
                    <DashboardView
                      engine={predictionEngine}
                      gameOdds={(game) =>
                        predictGame(game, liveTeams, settings, liveById).awayWinPct
                      }
                      backtestResult={backtestResult}
                      teamsById={liveById}
                      matchups={matchups}
                      setActiveView={setActiveView}
                      findings={openFindings}
                      digest={{
                        changes: digest.changes,
                        followed: ourTeamId,
                        nameOf,
                        hasGame: (gameId) => matchups.some((game) => game.id === gameId),
                        onOpenGame: (gameId) =>
                          openFindingTarget({ kind: "game", id: gameId, label: "" }),
                        onOpenTeam: (teamId) =>
                          openFindingTarget({ kind: "team", id: teamId, label: "" }),
                        onAcknowledge: digest.acknowledge,
                      }}
                      ourTeam={
                        // Not locked: the team followed is this browser's own pick, never a setting
                        // that travels, and "Enter a score" only goes to the schedule.
                        <OurTeamCard
                          summary={ourTeam}
                          {...(ourClubRank ? { clubRank: ourClubRank } : {})}
                          teams={teams}
                          onPick={pickOurTeam}
                          onEnterScore={(teamId) => {
                            setScoreboardTeamFilter(teamId);
                            setActiveView("games");
                          }}
                        />
                      }
                    />
                  ) : activeView === "power" ? (
                    <PowerRatingsView engine={predictionEngine} />
                  ) : activeView === "standings" ? (
                    <StandingsView
                      goldCutoff={goldCutoff}
                      latestCompletedDate={latestCompletedDate}
                      lastImpact={lastImpact}
                      dismissImpact={() => setLastImpact(null)}
                      copyRecap={async () => {
                        if (!lastImpact) return;
                        const md = recapToMarkdown(settings.seasonLabel, lastImpact.recapItems);
                        try {
                          await navigator.clipboard.writeText(md);
                          showToast("Recap copied.", { tone: "success" });
                        } catch {
                          showToast("Could not copy recap to clipboard.", { tone: "error" });
                        }
                      }}
                      copyStory={async () => {
                        if (!lastImpact) return;
                        const story =
                          storyText ||
                          recapToStoryBrief(settings.seasonLabel, lastImpact.recapItems);
                        try {
                          await navigator.clipboard.writeText(story);
                          showToast("League story copied.", { tone: "success" });
                        } catch {
                          showToast("Could not copy story to clipboard.", { tone: "error" });
                        }
                      }}
                      dashboardRows={dashboardRows}
                      hasCutLine={hasCutLine}
                      storyText={storyText}
                      storySource={aiStory.status === "ready" ? aiStory.provider : "local"}
                      storyModel={aiStory.model}
                      storyLoading={aiStory.status === "loading"}
                      storyUnavailableReason={
                        aiStory.status === "unavailable" || aiStory.status === "error"
                          ? (aiStory.reason ?? "upstream-error")
                          : null
                      }
                      storyErrorMessage={aiStory.message}
                      retryStory={aiStory.retry}
                      storyWaiting={aiStory.waiting}
                      askStory={aiStory.ask}
                      currentSosRanks={currentSosRanks}
                      statusClass={statusClass}
                      statusLabel={statusLabel}
                      formatGoldPct={formatGoldPct}
                      formatGoldMargin={(team) =>
                        formatProbabilityMargin((team.goldPctMargin ?? 0) / 100)
                      }
                      onSelectTeam={openTeamData}
                    />
                  ) : activeView === "teamStats" ? (
                    <TeamStatsView
                      leagueAverageStats={leagueAverageStats}
                      statRankings={statRankings}
                      pitchMode={settings.pitchMode}
                      trackErrors={settings.trackErrors}
                      runsOnly={runsOnly}
                      matrixTeams={headToHeadMatrixTeams}
                      headToHeadCell={headToHeadCell}
                    />
                  ) : activeView === "model" ? (
                    <ModelView
                      goldCutoff={goldCutoff}
                      modelRows={modelRows}
                      bracketProjection={bracketProjection}
                      silverBracketProjection={silverBracketProjection}
                      updateBracketLog={updateBracketLog}
                      toggleBracketFinal={toggleBracketFinal}
                      clearBracketScores={clearBracketScores}
                      seedRangeForTeam={seedRangeForTeam}
                      gamesThatMatterMost={gamesThatMatterMost}
                      bubbleMovementRows={bubbleMovementRows}
                      scheduleDifficultyForTeam={scheduleDifficultyForTeam}
                      formatGoldPct={formatGoldPct}
                      formatGoldMargin={(team) =>
                        formatProbabilityMargin((team.goldPctMargin ?? 0) / 100)
                      }
                      projectedCutLineTeams={projectedCutLineTeams}
                      nextTwoSwingGames={nextTwoSwingGames}
                      gameForecasts={gameForecasts}
                      byId={liveById}
                      gameStatusClasses={gameStatusClasses}
                      teams={teams}
                      matchups={matchups}
                      logs={logs}
                      settings={settings}
                      cutoff={goldCutoff}
                      onSelectTeam={openTeamData}
                      liveTeams={liveTeams}
                      remainingGames={remainingGames}
                      backtestResult={backtestResult}
                      bracketOdds={bracketOdds}
                      clinchingPaths={clinchingPaths}
                      cutLineSnapshot={cutLineSnapshot}
                      timelineEntries={timelineEntries}
                      hasCutLine={hasCutLine}
                      hasPostseason={hasPostseason}
                      forecastStoryText={
                        forecastStory.status === "ready" ? forecastStory.summary : ""
                      }
                      forecastStoryModel={forecastStory.model}
                      forecastStoryProvider={forecastStory.provider}
                      forecastStoryLoading={forecastStory.status === "loading"}
                      forecastStoryUnavailableReason={
                        forecastStory.status === "unavailable" || forecastStory.status === "error"
                          ? (forecastStory.reason ?? "upstream-error")
                          : null
                      }
                      forecastStoryErrorMessage={forecastStory.message}
                      retryForecastStory={forecastStory.retry}
                      forecastStoryWaiting={forecastStory.waiting}
                      askForecastStory={forecastStory.ask}
                      playoffMachine={
                        <PlayoffMachine
                          teams={teams}
                          matchups={matchups}
                          logs={deferredLogs}
                          settings={settings}
                          liveTeams={liveTeams}
                          ratings={predictionEngine.ratings}
                          remainingGames={remainingGames}
                          cutoff={goldCutoff}
                          hasCutLine={hasCutLine}
                          currentRows={dashboardRows}
                          oddsSeed={oddsSeed}
                          iterations={SIM_ITERATIONS}
                          seasonId={activeSeasonId}
                          followedTeamId={ourTeamId}
                          incoming={
                            incomingScenario?.seasonId === activeSeasonId
                              ? incomingScenario.id
                              : null
                          }
                          onIncomingOpened={incomingScenarioOpened}
                        />
                      }
                    />
                  ) : activeView === "quality" ? (
                    <DataQualityView
                      findings={openFindings}
                      putAside={asideFindings}
                      tier={predictionEngine.dataQuality.tier}
                      preview={previewRepair}
                      onOpen={openFindingTarget}
                      onRepair={(finding) => void repairFinding(finding)}
                      onPutAside={putFindingAside}
                      onBringBack={bringFindingBack}
                    />
                  ) : activeView === "settings" ? (
                    <div className="space-y-6">
                      <SeasonManager
                        seasons={seasons.all}
                        activeSeasonId={activeSeasonId}
                        onSwitch={seasons.switchTo}
                        onCreate={seasons.create}
                        onDuplicate={seasons.duplicate}
                        onDelete={(id) => void seasons.remove(id)}
                      />
                      {/* Above Settings because it answers the question the "Team Rankings results"
                    setting down there raises: which club is which. */}
                      <EditLock>
                        <ScoutLinkPanel
                          bridge={scoutBridge}
                          {...(scoutUnanswered ? { unanswered: scoutUnanswered } : {})}
                          candidatesFor={scoutCandidatesFor}
                          wideOptions={scoutWideOptions}
                          {...(scoutWideStatus ? { wideStatus: scoutWideStatus } : {})}
                          onWide={wantScoutWide}
                          seasonLabel={settings.seasonLabel}
                          countingOn={settings.useScoutResults}
                          onPick={setScoutLink}
                        />
                      </EditLock>
                      <SettingsView
                        onOpenCloud={cloud.kind === "off" ? undefined : cloudPanel.show}
                        settings={settings}
                        setSettings={setSettings}
                        teamsCount={teams.length}
                        importCSV={importCSV}
                        importBackup={importBackup}
                        exportCSV={exportCSV}
                        exportBackup={exportBackup}
                        resetSeason={resetSeason}
                        loadDemoSeason={loadDemoSeason}
                        summaryMode={summaryMode}
                        onSummaryMode={setSummaryMode}
                        notifyPrefs={notifyPrefs}
                        onNotifyPrefs={setNotifyPrefs}
                        followedName={ourTeamId ? nameOf(ourTeamId) : null}
                      />
                    </div>
                  ) : (
                    <GamesView
                      teams={teams}
                      matchups={matchups}
                      logs={logs}
                      scoreboardGames={scoreboardGames}
                      scoreboardPredictions={scoreboardPredictions}
                      scoreboardTeamFilter={scoreboardTeamFilter}
                      pitchMode={settings.pitchMode}
                      trackErrors={settings.trackErrors}
                      runsOnly={runsOnly}
                      setScoreboardTeamFilter={setScoreboardTeamFilter}
                      newDate={newDate}
                      setNewDate={setNewDate}
                      newAway={newAway}
                      setNewAway={setNewAway}
                      newHome={newHome}
                      setNewHome={setNewHome}
                      addGameValid={addGameValid}
                      addGame={addGame}
                      toggleFinal={toggleFinal}
                      swapGame={swapGame}
                      removeGame={removeGame}
                      updateLog={updateLog}
                      setMatchups={setMatchups}
                      gameStatusClasses={gameStatusClasses}
                      seasonGamesFinalized={matchups.length > 0 && remainingGames.length === 0}
                      bracketProjection={bracketProjection}
                      silverBracketProjection={silverBracketProjection}
                      updateBracketLog={updateBracketLog}
                      toggleBracketFinal={toggleBracketFinal}
                      scoreFillPlan={scoreFillPlan}
                      scoreFillAsking={scoreFillAsking}
                      openScoreFill={openScoreFill}
                      closeScoreFill={() => setScoreFillPlan(null)}
                      applyScoreFill={applyScoreFill}
                      seasonLabel={settings.seasonLabel}
                    />
                  )}
                </Suspense>
              </ErrorBoundary>
            </SeasonEditable>
          </main>
        )}

        {/* Each drawer is fetched the first time it is opened (2.1, 2.7), so each has a boundary of
          its own: a download that fails is said over the page, with Close, and is fetched afresh on
          Try again or the next opening, rather than reaching the root's boundary, whose Try again
          would open the panel again from the address and fail again. */}
        {selectedTeam && (
          <ErrorBoundary
            area="The team panel"
            onReset={teamDrawerView.reset}
            onClose={closeTeamData}
          >
            <Suspense fallback={null}>
              <TeamDrawer
                team={selectedTeam}
                range={
                  selectedTeamDetail?.range ?? {
                    best: selectedTeam.rank ?? 99,
                    worst: selectedTeam.rank ?? 99,
                    baseline: selectedTeam.rank ?? 99,
                  }
                }
                bubble={selectedTeamDetail?.bubble ?? ""}
                detailsPending={!selectedTeamDetail}
                currentSosRank={selectedTeamDetail?.currentSosRank ?? null}
                sos={selectedTeamDetail?.sos ?? { label: "", rating: 0, opponents: "" }}
                swings={selectedTeamDetail?.swings ?? []}
                clinchScenarios={selectedTeamDetail?.clinchScenarios ?? []}
                titleRace={selectedTeamDetail?.titleRace ?? ""}
                goldPctLabel={selectedTeamDetail?.goldPctLabel ?? formatGoldPct(selectedTeam)}
                cutoff={goldCutoff}
                magicForGold={
                  selectedTeamDetail?.magic ?? {
                    type: "magic",
                    ownWinsNeeded: 0,
                    opponentLossesNeeded: 0,
                    description: "",
                  }
                }
                eliminationNumber={
                  selectedTeamDetail?.elimination ?? {
                    type: "elimination",
                    ownWinsNeeded: 0,
                    opponentLossesNeeded: 0,
                    description: "",
                  }
                }
                splitSummary={selectedTeamSplitSummary}
                trendSummary={selectedTeamTrendSummary}
                leagueAverageStats={leagueAverageStats}
                pitchMode={settings.pitchMode}
                trackErrors={settings.trackErrors}
                runsOnly={runsOnly}
                hasCutLine={hasCutLine}
                projectionExplanations={
                  lastImpact?.projectionExplanations?.find((e) => e.teamId === selectedTeam.id)
                    ?.items ?? []
                }
                onClose={closeTeamData}
                onRename={
                  leagueEditable ? (name) => renameLeagueTeam(selectedTeam.id, name) : undefined
                }
                onCompare={() => {
                  const candidate = dashboardRows.find((team) => team.id !== selectedTeam.id);
                  setCompareTeamId(candidate ? candidate.id : null);
                }}
              />
            </Suspense>
          </ErrorBoundary>
        )}

        {selectedTeam && compareTeam && (
          <ErrorBoundary
            area="The comparison"
            onReset={compareDrawerView.reset}
            onClose={() => setCompareTeamId(null)}
          >
            <Suspense fallback={null}>
              <CompareDrawer
                left={selectedTeam}
                right={compareTeam}
                allTeams={dashboardRows}
                matchups={matchups}
                logs={logs}
                runsOnly={runsOnly}
                onClose={() => setCompareTeamId(null)}
                onPickRight={(id) => setCompareTeamId(id)}
              />
            </Suspense>
          </ErrorBoundary>
        )}

        {
          /*
            Guarded by the open flags as well as rendered lazily: each of these returns null when
            closed, so rendering them unconditionally would fetch every one on page load and show
            nothing. There is no fallback because there is nothing on screen to hold a place for —
            an overlay simply appears a frame later than it used to.
          */
          <Suspense fallback={null}>
            {showCommandPalette && (
              <CommandPalette
                open={showCommandPalette}
                commands={appMode === "rankings" ? rankingsCommands : commands}
                onClose={() => setShowCommandPalette(false)}
              />
            )}
            {showShortcuts && (
              <ShortcutsHelp
                open={showShortcuts}
                shortcuts={shortcutEntries}
                onClose={() => setShowShortcuts(false)}
              />
            )}
            {showTour && <OnboardingTour open={showTour} onClose={() => setShowTour(false)} />}
            {cloudPanel.showing && (
              <CloudPanel status={cloud} open={cloudPanel.showing} onClose={cloudPanel.hide} />
            )}
          </Suspense>
        }
        {confirmState && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
            role="presentation"
          >
            <section
              ref={confirmDialogRef}
              role="dialog"
              aria-modal="true"
              aria-label={confirmState.title}
              className="w-full max-w-lg rounded-lg bg-white p-6 shadow-2xl dark:bg-slate-900"
            >
              <h2 className="text-xl font-black tracking-tight text-slate-950 dark:text-slate-100">
                {confirmState.title}
              </h2>
              <p className="mt-3 whitespace-pre-line text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
                {confirmState.message}
              </p>
              <div className="mt-6 flex flex-wrap justify-end gap-3">
                <button
                  type="button"
                  onClick={() => resolveConfirmation(false)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                >
                  {confirmState.cancelLabel ?? "Cancel"}
                </button>
                <button
                  type="button"
                  onClick={() => resolveConfirmation(true)}
                  className={buttonClasses.danger}
                >
                  {confirmState.confirmLabel ?? "Confirm"}
                </button>
              </div>
            </section>
          </div>
        )}

        <ToastView toast={toast} onDismiss={dismissToast} />
      </div>
    </>
  );
}

// ---------- View partials ----------

// expose for tree-shake-friendly use in DEFAULT_SETTINGS test imports
export { DEFAULT_SETTINGS };
