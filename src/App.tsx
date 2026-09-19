import React, {
  lazy,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  Suspense,
} from "react";
import { registerSW } from "virtual:pwa-register";
import type { Command } from "./components/CommandPalette";
import type { H2HCell } from "./components/charts/HeadToHeadMatrix";
import { ScoutLinkPanel } from "./components/ScoutLinkPanel";
import { CompareDrawer } from "./components/CompareDrawer";
import { LoadingPanel } from "./components/LoadingPanel";
import { ModelView } from "./components/league/ModelView";
import { GamesView } from "./components/league/GamesView";
import { StandingsView } from "./components/league/StandingsView";
import {
  applyLeagueScoreFill,
  planLeagueScoreFill,
  summarizeLeagueFill,
  type LeagueFillPlan,
} from "./lib/leagueScoreFill";
import { hasGcLinks, leagueScoutBridge, scoutLinkCandidates } from "./lib/teamRankings";
import {
  loadAgeGroups,
  loadScoutGamesForSeason,
  loadScoutTeams,
  isPoolUnavailable,
  onPoolWriteError,
  replaceArchivedSeasons,
} from "./lib/teamRankingsStorage";
import {
  coerceTeamRankingsBackup,
  parseTeamRankingsCsv,
  readTeamRankingsBackup,
  parseTeamRankingsJson,
  summarizeTeamRankingsBackup,
  teamRankingsBackupIsEmpty,
  teamRankingsCsvSections,
  writeTeamRankingsBackup,
  type TeamRankingsBackup,
  type UndoSnapshotWithRankings,
} from "./lib/teamRankingsBackup";
import { readSummaryMode, writeSummaryMode, type SummaryMode } from "./lib/preferences";
import {
  applyFullBackup,
  backupFilename,
  coerceBackup,
  readFullBackup,
  summarizeFullBackup,
  type FullBackup,
  type LiveSeasonData,
} from "./lib/backup";
import { ToastView } from "./components/Toast";
import { useAppMode } from "./hooks/useAppMode";
import { useDarkMode } from "./hooks/useDarkMode";
import { useConfirmation } from "./hooks/useConfirmation";
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
import { CSV_SECTIONS, csvEscape, csvSectionMarker } from "./lib/csv";
import {
  formatGameDate,
  normalizeDateInput,
  parseDateValue,
  sundayEndingWeekKey,
} from "./lib/date";
import { displayName, recordText } from "./lib/format";
import { summarizeCsvImportIssues } from "./lib/importReport";
import { buildSeasonImportPreview, formatSeasonImportPreview } from "./lib/importPreview";
import { parseScheduleCsvImport } from "./lib/scheduleCsvImport";
import { pathSummary, recapToMarkdown, recapToStoryBrief, weeklyRecap } from "./lib/insights";
import { buildForecastSummaryRequest, buildLeagueSummaryRequest } from "./lib/leagueSummaryClient";
import { eliminationNumberForGold, magicForGold } from "./lib/magic";
import { backtestPredictions } from "./lib/backtest";
import { buildPredictionEngine } from "./lib/predictionEngine";
import { buildBracketProjection } from "./lib/bracket";
import { scheduleDifficultyForTeam as buildScheduleDifficultyForTeam } from "./lib/scheduleDifficulty";
import { buildShareUrl } from "./lib/share";
import { noteBackupTaken } from "./lib/lastBackup";
import { formatProbabilityMargin, wilsonScoreInterval } from "./lib/probability";
import {
  buildProjectionSnapshot,
  diffProjectionSnapshots,
  type ProjectionRelevantSettings,
} from "./lib/projectionDelta";
import { buildProjectionExplanations } from "./lib/projectionExplanation";
import { buildSeasonTimeline } from "./lib/seasonTimeline";
import {
  applyResult,
  attachAdjustedRatings,
  calculateTeams,
  createTeamId,
  getMathGoldStatus,
  getRemainingCounts,
  isSeedingLocked,
  predictGame,
  projectStandings,
  rankOptionsFromSettings,
  rankTeams,
  simulationSeed,
  standingsPoints,
} from "./lib/sim";
import {
  createSeason,
  deleteSeason,
  duplicateSeason,
  getActiveSeasonId,
  listSeasons,
  loadBracketLogs,
  loadLogs,
  loadMatchups,
  loadSettings,
  loadTeams,
  readUndoSnapshot,
  renameSeason,
  saveBracketLogs,
  saveLogs,
  saveMatchups,
  saveSettings,
  saveTeams,
  saveUndoSnapshot,
  setActiveSeason,
  type SeasonMeta,
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
  type Settings,
  type SwingGame,
  type Team,
  type LastImpact,
  type ProjectionExplanationEntry,
  type TeamBase,
  type TeamWithProjection,
} from "./lib/types";
import {
  buildLeagueAverageStats,
  buildTeamSplitSummary,
  buildTeamStatRankings,
  calcBip,
  emptySplitLine,
} from "./lib/teamStats";
import { buildDemoSeason } from "./lib/demoSeason";
import { buildTeamTrendSummary } from "./lib/teamTrend";
import { blankLog, clamp, isFinal, parseNumber } from "./lib/util";
import { linkedTeamIdFromUrl, projectedRunLine, TEAM_QUERY_PARAM } from "./lib/teamLink";
import { HeaderStatCard } from "./components/HeaderStatCard";
import { DashboardView } from "./components/league/DashboardView";
import { TeamDrawer } from "./components/league/TeamDrawer";
import { EmptyState } from "./components/league/EmptyState";
import { PowerRatingsView } from "./components/league/PowerRatingsView";
import { SeasonManager } from "./components/league/SeasonManager";
import { TeamStatsView } from "./components/league/TeamStatsView";
import { SettingsView } from "./components/league/SettingsView";
import { button as buttonClasses, focusRing, tab } from "./styles/tokens";
import {
  formatGoldPct as formatGoldPctValue,
  titleRaceBadgeForTeam as titleRaceBadgeForTeamValue,
} from "./lib/standingsView";

type ActiveView = ActiveShareView;

type RankSnapshotEntry = Team & {
  rank: number;
  projectedRank: number;
  goldPct: number;
  goldStatus: "Clinched" | "In" | "Alive" | "Eliminated";
  maxPoints: number;
  blockersAhead: number;
};

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
const PROJECT_STANDINGS_REMAINING_GAME_LIMIT = 250;
const IMPACT_RECAP_REMAINING_GAME_LIMIT = 120;
const SCOREBOARD_PREDICTION_CHUNK_SIZE = 24;
const EMPTY_GAME_LOG = blankLog();

const replaceTeamDataUrl = (teamId: string | null) => {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  if (teamId) {
    url.searchParams.set(TEAM_QUERY_PARAM, teamId);
  } else {
    url.searchParams.delete(TEAM_QUERY_PARAM);
  }
  url.hash = "";
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
};

const VIEW_LABELS: Record<ActiveView, string> = {
  dashboard: "Dashboard",
  power: "Power Ratings",
  standings: "Standings",
  teamStats: "League Stats",
  games: "Schedule",
  model: "Forecast",
  settings: "Settings",
};

const VIEW_ORDER: ActiveView[] = [
  "dashboard",
  "power",
  "games",
  "standings",
  "teamStats",
  "model",
  "settings",
];

// ---------- Main app ----------

/**
 * Three things nobody sees until they ask for them: the command palette, the shortcut list and the
 * first-run tour. Each is behind a keystroke or a button, and each is guarded by its own open flag
 * below so the fetch happens on the press rather than on the page load.
 */
const CommandPalette = lazy(() =>
  import("./components/CommandPalette").then((module) => ({ default: module.CommandPalette }))
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
  import("./components/TeamRankingsView").then((module) => ({ default: module.TeamRankingsView }))
);

export default function App() {
  const [activeView, setActiveView] = useState<ActiveView>("dashboard");
  const [teams, setTeams] = useState<TeamBase[]>(() => loadTeams());
  const [matchups, setMatchups] = useState<Matchup[]>(() => loadMatchups());
  const [logs, setLogs] = useState<Record<string, GameLog>>(() => loadLogs());
  const deferredLogs = useDeferredValue(logs);
  const [bracketLogs, setBracketLogs] = useState<Record<string, GameLog>>(() => loadBracketLogs());
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [seasons, setSeasons] = useState<SeasonMeta[]>(() => listSeasons());
  const [activeSeasonId, setActiveSeasonIdState] = useState<string>(() => getActiveSeasonId());

  const [newDate, setNewDate] = useState("");
  const [newAway, setNewAway] = useState("");
  const [newHome, setNewHome] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(() => linkedTeamIdFromUrl());
  const [compareTeamId, setCompareTeamId] = useState<string | null>(null);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
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

  const undoRef = useRef<UndoSnapshotWithRankings | null>(null);
  const { toast, show: showToast, dismiss: dismissToast } = useToast();

  /**
   * A pool write goes to IndexedDB behind the caller, so a quota failure surfaces long after the
   * save was reported as accepted. This is the only place that can still say so.
   */
  useEffect(() => {
    onPoolWriteError(() =>
      showToast("Team Rankings could not be saved — storage is full.", { tone: "error" })
    );
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
  /**
   * Bumped whenever Team Rankings saves. That data lives in its own storage keys, so nothing here
   * would otherwise notice it changed — and the league's forecasts read it.
   */
  const [scoutRevision, setScoutRevision] = useState(0);
  const noteScoutChange = useCallback(() => setScoutRevision((value) => value + 1), []);

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
    [showToast]
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

  // Default the add-game selects once teams exist. Guarded on the value being unset, so this
  // settles in one extra render and never fights a choice the user has made.
  if (!newAway && teams[0]) setNewAway(teams[0].id);
  if (!newHome && teams[1]) setNewHome(teams[1].id);

  // ---------- Derived state ----------

  const baseTeams = useMemo(
    () => calculateTeams(teams, matchups, deferredLogs, settings),
    [teams, matchups, deferredLogs, settings]
  );

  /**
   * This season's schedule in the shape `leagueScoutBridge` matches stored games against:
   * team names rather than ids, because Team Rankings keeps its own ids for the same clubs, and
   * the league's own date string, which it normalizes. Without it a GameChanger pull of a league
   * team's schedule would feed this season's own games back in as if they were outside results.
   */
  const seasonFixtures = useMemo(() => {
    const nameById = new Map(teams.map((team) => [team.id, team.name]));
    return matchups.map((game) => ({
      away: nameById.get(game.away) ?? "",
      home: nameById.get(game.home) ?? "",
      date: game.date,
    }));
  }, [teams, matchups]);

  // Tournament results logged in Team Rankings, for age groups that include this season. Read
  // from storage rather than held in state: Team Rankings owns them, this view only borrows.
  const scoutBridge = useMemo(() => {
    // Storage is not reactive, so the counter is the signal that it changed. Referenced rather
    // than merely listed, so it reads as the dependency it is.
    void scoutRevision;
    const empty = {
      results: [],
      seasonLinked: false,
      rows: [],
      linkedCount: 0,
      countedResults: 0,
    };
    if (!activeSeasonId) return empty;
    return leagueScoutBridge(
      activeSeasonId,
      loadAgeGroups(),
      loadScoutTeams(),
      loadScoutGamesForSeason(activeSeasonId),
      // The roster, not the computed teams: the bridge reads a team's id, name and stored pick,
      // all of which live on the roster row, and reading the computed teams here would need them
      // to exist before the rating that this feeds could be attached to them.
      teams,
      seasonFixtures
    );
  }, [activeSeasonId, teams, seasonFixtures, scoutRevision]);

  /**
   * The bridge is read whether or not the setting lets it count, so the panel can say how much is
   * ready and waiting; only the results are withheld.
   */
  const externalResults = useMemo(
    () => (settings.useScoutResults ? scoutBridge.results : []),
    [settings.useScoutResults, scoutBridge]
  );

  /** The clubs that could be a given league team, best evidence first: who they have both played. */
  const scoutCandidatesFor = useCallback(
    (leagueTeamName: string) => {
      void scoutRevision;
      if (!activeSeasonId) return [];
      return scoutLinkCandidates(
        leagueTeamName,
        activeSeasonId,
        loadAgeGroups(),
        loadScoutTeams(),
        loadScoutGamesForSeason(activeSeasonId),
        seasonFixtures
      );
    },
    [activeSeasonId, seasonFixtures, scoutRevision]
  );

  const allScoutClubs = useCallback(() => {
    void scoutRevision;
    // Linked clubs only. Searching forty thousand names to land on one that has no GameChanger
    // team behind it is a search that could not have succeeded.
    return loadScoutTeams().filter((team) => !team.placeholder && hasGcLinks(team));
  }, [scoutRevision]);

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

  const predictionEngine = useMemo(
    () => buildPredictionEngine(baseTeams, matchups, deferredLogs, settings, externalResults),
    [baseTeams, matchups, deferredLogs, settings, externalResults]
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
  const remainingGames = useMemo(
    () => matchups.filter((game) => !isFinal(deferredLogs[game.id])),
    [matchups, deferredLogs]
  );
  const completedGames = useMemo(
    () =>
      matchups
        .filter((game) => isFinal(deferredLogs[game.id]))
        .sort((a, b) => parseDateValue(a.date) - parseDateValue(b.date)),
    [matchups, deferredLogs]
  );
  const leagueAverageStats = useMemo(
    () => buildLeagueAverageStats(matchups, deferredLogs),
    [matchups, deferredLogs]
  );
  const statRankings = useMemo(
    () =>
      buildTeamStatRankings(
        teams,
        matchups,
        deferredLogs,
        settings.pitchMode,
        settings.trackErrors,
        runsOnly
      ),
    [teams, matchups, deferredLogs, settings.pitchMode, settings.trackErrors, runsOnly]
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
        deferredLogs,
        `odds-${goldCutoff}-${settings.modelAggression}-${settings.winPoints}-${settings.tiePoints}-${settings.tiebreakerOrder.join(",")}`
      ),
    [matchups, deferredLogs, goldCutoff, settings]
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
  const { odds, iterations: oddsIterations } = useSimulationOdds(oddsInput);

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
    const states = completedGames.slice(-TREND_STATES);
    // Build states from index=1 (drops the misleading empty-logs leading zero).
    const buildLogsUntil = (limitIndex: number) => {
      const allowed = new Set(states.slice(0, limitIndex).map((g) => g.id));
      const stateLogs: Record<string, GameLog> = {};
      matchups.forEach((game) => {
        const log = deferredLogs[game.id];
        if (allowed.has(game.id) && log) stateLogs[game.id] = log;
      });
      return stateLogs;
    };
    const built: { teams: Team[]; remaining: Matchup[]; seedText: string }[] = [];
    for (let index = 1; index <= states.length; index += 1) {
      const stateLogs = buildLogsUntil(index);
      const stateTeams = calculateTeams(teams, matchups, stateLogs, settings);
      const stateRemaining = matchups.filter((g) => !isFinal(stateLogs[g.id]));
      const seedText = simulationSeed(
        matchups,
        stateLogs,
        `trend-${index}-${goldCutoff}-${settings.modelAggression}`
      );
      built.push({ teams: stateTeams, remaining: stateRemaining, seedText });
    }
    return { teamIds, states: built, iterations: TREND_ITERATIONS, cutoff: goldCutoff, settings };
  }, [teams, matchups, deferredLogs, completedGames, goldCutoff, settings]);
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

  const backtestResult = useMemo(
    () => backtestPredictions(teams, matchups, deferredLogs, settings),
    [teams, matchups, deferredLogs, settings]
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
    (rowId: string, colId: string): H2HCell => {
      if (rowId === colId) return "self";
      const record = liveById.get(rowId)?.headToHead?.[colId];
      if (!record) return "none";
      const { wins, losses } = record;
      if (wins === 0 && losses === 0 && record.ties === 0) return "none";
      if (wins > losses) return "win";
      if (losses > wins) return "loss";
      return "tie";
    },
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

  const currentSosRanks = useMemo(() => {
    const ordered = [...dashboardRows].sort((a, b) => b.sos - a.sos);
    const map: Record<string, number> = {};
    ordered.forEach((team, index) => {
      map[team.id] = index + 1;
    });
    return map;
  }, [dashboardRows]);

  const projectedCutLineTeams = useMemo(() => {
    return modelRows.filter((team) => {
      const seed = team.projectedRank ?? 99;
      return seed >= goldCutoff - 2 && seed <= goldCutoff + 3;
    });
  }, [modelRows, goldCutoff]);

  // ---------- Scenario helpers ----------

  const scenarioSeedCacheRef = useRef<Map<string, Map<string, number>>>(new Map());
  const teamScenarioSeedCacheRef = useRef<Map<string, number>>(new Map());
  const seedRangeCacheRef = useRef<Map<string, { best: number; worst: number; baseline: number }>>(
    new Map()
  );

  useEffect(() => {
    scenarioSeedCacheRef.current.clear();
    teamScenarioSeedCacheRef.current.clear();
    seedRangeCacheRef.current.clear();
  }, [liveTeams, remainingGames, settings]);

  const getScenarioRankMap = useCallback(
    (game: Matchup, winnerId: string) => {
      const scenarioKey = `${game.id}|${winnerId}`;
      if (!exactScenarioAnalysisEnabled) return new Map<string, number>();
      const cached = scenarioSeedCacheRef.current.get(scenarioKey);
      if (cached) return cached;
      const scenario = applyResult(liveTeams, game, winnerId, liveTeams, settings);
      const scenarioGames = remainingGames.filter((item) => item.id !== game.id);
      const finalProjected = projectStandings(scenario, scenarioGames, settings);
      const rankMap = new Map<string, number>();
      finalProjected.forEach((team) => rankMap.set(team.id, team.rank ?? 99));
      scenarioSeedCacheRef.current.set(scenarioKey, rankMap);
      return rankMap;
    },
    [exactScenarioAnalysisEnabled, liveTeams, remainingGames, settings]
  );

  const seedForScenario = useCallback(
    (teamId: string, game: Matchup, winnerId: string) => {
      const cacheKey = `${teamId}|${game.id}|${winnerId}`;
      const cached = teamScenarioSeedCacheRef.current.get(cacheKey);
      if (cached != null) return cached;
      const seed = getScenarioRankMap(game, winnerId).get(teamId) ?? 99;
      teamScenarioSeedCacheRef.current.set(cacheKey, seed);
      return seed;
    },
    [getScenarioRankMap]
  );

  const computeSeedRangeForTeam = useCallback(
    (teamId: string) => {
      const cached = seedRangeCacheRef.current.get(teamId);
      if (cached) return cached;
      const baseline =
        projectedById.get(teamId)?.rank ?? ranked.find((item) => item.id === teamId)?.rank ?? 99;
      if (!exactScenarioAnalysisEnabled) {
        const result = { best: baseline, worst: baseline, baseline };
        seedRangeCacheRef.current.set(teamId, result);
        return result;
      }
      let best = baseline;
      let worst = baseline;
      remainingGames
        .filter((game) => game.away === teamId || game.home === teamId)
        .forEach((game) => {
          const opponentId = game.away === teamId ? game.home : game.away;
          const winSeed = seedForScenario(teamId, game, teamId);
          const lossSeed = seedForScenario(teamId, game, opponentId);
          if (winSeed < best) best = winSeed;
          if (winSeed > worst) worst = winSeed;
          if (lossSeed < best) best = lossSeed;
          if (lossSeed > worst) worst = lossSeed;
        });
      const result = { best, worst, baseline };
      seedRangeCacheRef.current.set(teamId, result);
      return result;
    },
    [projectedById, ranked, exactScenarioAnalysisEnabled, remainingGames, seedForScenario]
  );

  const seedRangeForTeam = useCallback(
    (teamId: string) => computeSeedRangeForTeam(teamId) ?? { best: 99, worst: 99, baseline: 99 },
    [computeSeedRangeForTeam]
  );

  const nextTwoSwingGames = useCallback(
    (teamId: string): SwingGame[] => {
      return remainingGames
        .filter((game) => game.away === teamId || game.home === teamId)
        .sort((a, b) => parseDateValue(a.date) - parseDateValue(b.date))
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

  const timelineEntries = useMemo(
    () => buildSeasonTimeline(teams, matchups, deferredLogs, settings, 6),
    [teams, matchups, deferredLogs, settings]
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
      if (
        team.goldPct >= 20 ||
        projectedSeed <= goldCutoff + 2 ||
        team.maxPoints >= standingsPoints(cutoffRow, settings)
      ) {
        return "Bubble Out";
      }
      return "Long Shot";
    },
    [goldCutoff, dashboardRows, settings]
  );

  const scheduleDifficultyForTeam = useCallback(
    (teamId: string) =>
      buildScheduleDifficultyForTeam(teamId, remainingGames, dashboardRows, matchups, deferredLogs),
    [remainingGames, dashboardRows, matchups, deferredLogs]
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

  const nextGameByTeam = useMemo(() => {
    const map = new Map<string, Matchup>();
    [...remainingGames]
      .sort((a, b) => parseDateValue(a.date) - parseDateValue(b.date))
      .forEach((game) => {
        if (!map.has(game.away)) map.set(game.away, game);
        if (!map.has(game.home)) map.set(game.home, game);
      });
    return map;
  }, [remainingGames]);

  const isTeamNextGame = (teamId: string, game: Matchup) =>
    nextGameByTeam.get(teamId)?.id === game.id;

  const goldStatusAfterScenario = (teamId: string, game: Matchup, winnerId: string) => {
    const scenarioTeams = rankTeams(
      applyResult(liveTeams, game, winnerId, liveTeams, settings),
      rankOptionsFromSettings(settings)
    );
    const scenarioRemaining = remainingGames.filter((item) => item.id !== game.id);
    const scenarioCounts = getRemainingCounts(scenarioTeams, scenarioRemaining);
    const scenarioTeam = scenarioTeams.find((team) => team.id === teamId);
    if (!scenarioTeam) return null;
    return getMathGoldStatus(scenarioTeam, scenarioTeams, scenarioCounts, goldCutoff, settings)
      .goldStatus;
  };

  const teamsClinchingAfterGameResult = (game: Matchup, winnerId: string) => {
    const scenarioTeams = rankTeams(
      applyResult(liveTeams, game, winnerId, liveTeams, settings),
      rankOptionsFromSettings(settings)
    );
    const scenarioRemaining = remainingGames.filter((item) => item.id !== game.id);
    const scenarioCounts = getRemainingCounts(scenarioTeams, scenarioRemaining);

    return scenarioTeams
      .filter((scenarioTeam) => {
        const before = dashboardById.get(scenarioTeam.id);
        if (!before || before.goldStatus === "Clinched" || before.goldStatus === "Eliminated")
          return false;
        const after = getMathGoldStatus(
          scenarioTeam,
          scenarioTeams,
          scenarioCounts,
          goldCutoff,
          settings
        ).goldStatus;
        return after === "Clinched";
      })
      .map((team) => team.id);
  };

  const teamClinchesGoldWithWin = (teamId: string, game: Matchup) => {
    const team = dashboardById.get(teamId);
    if (!team || team.goldStatus === "Clinched" || team.goldStatus === "Eliminated") return false;
    if (!isTeamNextGame(teamId, game)) return false;
    return goldStatusAfterScenario(teamId, game, teamId) === "Clinched";
  };

  const teamCanBeEliminatedWithLoss = (teamId: string, game: Matchup) => {
    const team = dashboardById.get(teamId);
    if (!team || team.goldStatus === "Clinched" || team.goldStatus === "Eliminated") return false;
    if (!isTeamNextGame(teamId, game)) return false;
    const opponentId = game.away === teamId ? game.home : game.away;
    return goldStatusAfterScenario(teamId, game, opponentId) === "Eliminated";
  };

  const teamClinchesRegularSeasonTitleWithWin = (teamId: string, game: Matchup) => {
    const team = dashboardById.get(teamId);
    if (!team || team.goldStatus === "Eliminated") return false;
    if (!isTeamNextGame(teamId, game)) return false;

    const scenarioTeams = rankTeams(
      applyResult(liveTeams, game, teamId, liveTeams, settings),
      rankOptionsFromSettings(settings)
    );
    const scenarioRemaining = remainingGames.filter((item) => item.id !== game.id);
    const scenarioCounts = getRemainingCounts(scenarioTeams, scenarioRemaining);
    const scenarioTeam = scenarioTeams.find((item) => item.id === teamId);
    if (!scenarioTeam) return false;

    const titlePoints = standingsPoints(scenarioTeam, settings);
    return scenarioTeams.every((other) => {
      if (other.id === teamId) return true;
      const otherMax =
        standingsPoints(other, settings) + (scenarioCounts[other.id] ?? 0) * settings.winPoints;
      return otherMax < titlePoints;
    });
  };

  const gameScenarioBadgesForGame = (game: Matchup) => {
    const away = dashboardById.get(game.away);
    const home = dashboardById.get(game.home);
    const teamsInGame = [away, home].filter(Boolean) as TeamWithProjection[];
    const badges: string[] = [];

    const clinchTeams = new Set<string>();
    teamsInGame.forEach((team) => {
      if (teamClinchesGoldWithWin(team.id, game)) clinchTeams.add(displayName(team.name));
    });
    teamsClinchingAfterGameResult(game, game.away).forEach((teamId) => {
      const team = dashboardById.get(teamId);
      clinchTeams.add(displayName(team?.name || teamId));
    });
    teamsClinchingAfterGameResult(game, game.home).forEach((teamId) => {
      const team = dashboardById.get(teamId);
      clinchTeams.add(displayName(team?.name || teamId));
    });
    if (clinchTeams.size > 0) {
      badges.push(`Clinch Scenario: ${[...clinchTeams].join(", ")}`);
    }

    const eliminationTeams = new Set<string>();
    teamsInGame.forEach((team) => {
      if (teamCanBeEliminatedWithLoss(team.id, game)) eliminationTeams.add(displayName(team.name));
    });
    if (eliminationTeams.size > 0) {
      badges.push(`Elimination Scenario: ${[...eliminationTeams].join(", ")}`);
    }

    return badges;
  };

  const gameStatusForGame = (game: Matchup) => {
    const impact = getGameScenarioImpactMap.get(game.id);
    const away = dashboardById.get(game.away);
    const home = dashboardById.get(game.home);
    const teamsInGame = [away, home].filter(Boolean) as TeamWithProjection[];
    const titleTeam = teamsInGame.find((team) =>
      teamClinchesRegularSeasonTitleWithWin(team.id, game)
    );
    if (titleTeam) return `Title Clinch-${displayName(titleTeam.name)}`;
    const scenarioBadges = gameScenarioBadgesForGame(game);
    if (scenarioBadges.length > 0) return scenarioBadges[0] ?? "Clinch Scenario";

    // "Bubble" only means something relative to a cut line; without one, a
    // tight game is just a high-leverage seeding game.
    const nearCutLine =
      hasCutLine && teamsInGame.some((team) => Math.abs((team.rank ?? 99) - goldCutoff) <= 1);
    if (impact && impact.seedImpact >= 2) return "High Impact";
    if (nearCutLine) return "Bubble Game";
    if (impact && impact.seedImpact >= 1) return "Seeding Game";
    return "Low Impact";
  };

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

  const gamesThatMatterMost = useMemo(() => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingGames, dashboardById, getGameScenarioImpactMap, goldCutoff]);

  const bubbleRows = useMemo(() => {
    return dashboardRows.map((team) => ({
      team,
      tier: bubbleTierForTeam(team),
      sos: scheduleDifficultyForTeam(team.id),
      control: controlLevelForTeam(team),
    }));
  }, [dashboardRows, bubbleTierForTeam, scheduleDifficultyForTeam, controlLevelForTeam]);

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

  const statusLabel = (team: TeamWithProjection) => {
    if (team.goldStatus === "Clinched") return "Clinched";
    if (team.goldStatus === "Eliminated") return "Eliminated";

    const currentSeed = team.rank ?? 99;
    const projectedSeed = team.projectedRank ?? 99;
    const cutoffRow = dashboardRows[Math.min(goldCutoff - 1, dashboardRows.length - 1)];
    const cutoffPoints = cutoffRow ? standingsPoints(cutoffRow, settings) : 0;
    const canStillReachCutLine = team.maxPoints >= cutoffPoints;

    if (currentSeed <= goldCutoff) {
      const currentPoints = standingsPoints(team, settings);
      const outsideThreats = dashboardRows.filter(
        (other) =>
          other.id !== team.id &&
          (other.rank ?? 99) > goldCutoff &&
          other.maxPoints >= currentPoints
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
  };

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
        sortValue: parseDateValue(game.date),
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
      return parseDateValue(a.date) - parseDateValue(b.date) || a.id.localeCompare(b.id);
    };
    const filtered =
      scoreboardTeamFilter === "ALL"
        ? matchups
        : matchups.filter(
            (game) => game.away === scoreboardTeamFilter || game.home === scoreboardTeamFilter
          );
    return [...filtered].sort(dateCompare);
  }, [matchups, logs, scoreboardTeamFilter]);

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

  const buildRankSnapshot = (nextLogs: Record<string, GameLog>): RankSnapshotEntry[] => {
    const nextLive = calculateTeams(teams, matchups, nextLogs, settings);
    const nextRanked = rankTeams(nextLive, rankOptionsFromSettings(settings));
    const nextRemaining = matchups.filter((game) => !isFinal(nextLogs[game.id]));
    const nextRemainingCounts = getRemainingCounts(nextLive, nextRemaining);
    const nextProjected =
      nextRemaining.length <= PROJECT_STANDINGS_REMAINING_GAME_LIMIT
        ? projectStandings(nextLive, nextRemaining, settings)
        : rankTeams(nextLive, rankOptionsFromSettings(settings));

    return nextRanked.map((team) => {
      const projectedTeam = nextProjected.find((item) => item.id === team.id);
      const status = getMathGoldStatus(team, nextRanked, nextRemainingCounts, goldCutoff, settings);
      return {
        ...team,
        projectedRank: projectedTeam?.rank ?? team.rank ?? 99,
        goldPct: 0, // snapshot-only, odds shown live from worker
        ...status,
      };
    });
  };

  /**
   * `withTeamRankings` is for the imports that replace the shared Team Rankings pool: only those
   * need the pool in the snapshot, and it is large enough that carrying it on every undo-able
   * action would risk filling storage for nothing.
   */
  const captureUndo = useCallback(
    (label: string, options?: { withTeamRankings?: boolean }) => {
      const snapshot: UndoSnapshotWithRankings = {
        teams,
        matchups,
        logs,
        bracketLogs,
        label,
        timestamp: Date.now(),
        ...(options?.withTeamRankings ? { teamRankings: readTeamRankingsBackup() } : {}),
      };
      undoRef.current = snapshot;
      if (!saveUndoSnapshot(snapshot)) {
        /*
         * The undo itself is fine — it is in memory, which is where Undo reads from first. What
         * failed is the copy that would survive a reload, and at a nationwide pool size that copy
         * simply does not fit in localStorage. Saying "storage full" as an error made a working
         * undo read as a broken one; say what is actually true instead, and only for the snapshots
         * that carry the pool, since a plain one failing really is a storage problem.
         */
        if (options?.withTeamRankings) {
          showToast("Undo is ready, but this pool is too big to keep it past a reload.");
        } else {
          showToast("Could not save undo snapshot (storage full).", { tone: "error" });
        }
      }
    },
    [teams, matchups, logs, bracketLogs, showToast]
  );

  const restoreUndo = useCallback(() => {
    const snapshot = undoRef.current ?? (readUndoSnapshot() as UndoSnapshotWithRankings | null);
    if (!snapshot) return;
    setTeams(snapshot.teams);
    setMatchups(snapshot.matchups);
    setLogs(snapshot.logs);
    setBracketLogs(snapshot.bracketLogs ?? {});
    // Snapshots come back off localStorage, so the pool is re-validated rather than trusted.
    const rankings = coerceTeamRankingsBackup(snapshot.teamRankings);
    if (rankings && writeTeamRankingsBackup(rankings)) noteScoutChange();
    closeTeamData();
    undoRef.current = null;
    showToast(`Restored: ${snapshot.label}.`, { tone: "success" });
  }, [closeTeamData, noteScoutChange, showToast]);

  // ---------- Seasons ----------

  // Pull the active season's stored data into React state and clear transient/undo UI.
  const reloadActiveSeason = useCallback(() => {
    setTeams(loadTeams());
    setMatchups(loadMatchups());
    setLogs(loadLogs());
    setBracketLogs(loadBracketLogs());
    setSettings(loadSettings());
    setSeasons(listSeasons());
    setActiveSeasonIdState(getActiveSeasonId());
    setSelectedTeamId(null);
    setCompareTeamId(null);
    setLastImpact(null);
    undoRef.current = null;
  }, []);

  const switchSeason = useCallback(
    (id: string) => {
      if (id === getActiveSeasonId()) return;
      if (!setActiveSeason(id)) return;
      reloadActiveSeason();
      const name = listSeasons().find((season) => season.id === id)?.name ?? "season";
      showToast(`Switched to ${name}.`, { tone: "info" });
    },
    [reloadActiveSeason, showToast]
  );

  const handleCreateSeason = useCallback(
    (name: string) => {
      const meta = createSeason(name);
      setSeasons(listSeasons());
      showToast(`Created ${meta.name}. Switch to it when ready.`, { tone: "success" });
    },
    [showToast]
  );

  const handleDuplicateSeason = useCallback(
    (id: string, name: string) => {
      const meta = duplicateSeason(id, name);
      if (!meta) return;
      setSeasons(listSeasons());
      showToast(`Duplicated into ${meta.name}.`, { tone: "success" });
    },
    [showToast]
  );

  // Keep the active season's index name in sync with its editable season label, so the header
  // switcher and season manager always show the same name the user typed under "Season label".
  useEffect(() => {
    const label = settings.seasonLabel.trim();
    if (!label) return;
    const current = seasons.find((season) => season.id === activeSeasonId);
    if (current && current.name !== label && renameSeason(activeSeasonId, label)) {
      // Reflecting localStorage back into React after writing to it. The season index is the
      // source of truth and is not React state, so re-reading it here is the sync, not a cascade.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSeasons(listSeasons());
    }
  }, [settings.seasonLabel, activeSeasonId, seasons]);

  const handleDeleteSeason = useCallback(
    async (id: string) => {
      const target = listSeasons().find((season) => season.id === id);
      if (!target) return;
      const confirmed = await requestConfirmation({
        title: `Delete ${target.name}?`,
        message:
          "This permanently removes that season's teams, games, scores, and settings from this browser. It cannot be undone.",
        confirmLabel: "Delete season",
      });
      if (!confirmed) return;
      const wasActive = getActiveSeasonId() === id;
      if (!deleteSeason(id)) {
        showToast("Cannot delete the only season.", { tone: "error" });
        return;
      }
      if (wasActive) reloadActiveSeason();
      else setSeasons(listSeasons());
      showToast(`Deleted ${target.name}.`, { tone: "success" });
    },
    [reloadActiveSeason, requestConfirmation, showToast]
  );

  // ---------- Mutations ----------

  /**
   * What an import is about to do to the Team Rankings pool, for the confirmation dialog. Worth
   * stating in all three cases: the pool spans every season and every age group, so replacing it
   * reaches well past the one season being imported; a file that predates rankings backups leaves
   * it untouched, which a manager restoring an old backup should not have to guess at; and a file
   * saved back when the pool was empty restores that emptiness, which is the one outcome nobody
   * would infer from a count.
   */
  const teamRankingsImportNote = (incoming: TeamRankingsBackup | null) => {
    if (!incoming) {
      return "Team Rankings: none in this file. The current Team Rankings pool is left as it is.";
    }
    if (teamRankingsBackupIsEmpty(incoming)) {
      return "Team Rankings: this file's pool is empty. Importing it clears every age group, ranked team, and logged game from Team Rankings.";
    }
    return `Team Rankings: ${summarizeTeamRankingsBackup(incoming)}. Replaces the shared Team Rankings pool for every age group, not just this season.`;
  };

  const applyTeamRankingsImport = async (incoming: TeamRankingsBackup | null) => {
    if (!incoming) return;
    if (!writeTeamRankingsBackup(incoming)) {
      showToast("Season imported, but Team Rankings data could not be saved (storage full).", {
        tone: "error",
      });
      return;
    }
    /*
     * The archives are swapped only when the file carries the field at all. A file written before
     * archives existed has no opinion about them, and reading that silence as "no archives" would
     * delete every finished season on restoring an older backup — the one thing in the pool that
     * cannot be recomputed from anything.
     */
    if (incoming.archives && !(await replaceArchivedSeasons(incoming.archives))) {
      showToast("Pool restored, but the archived seasons could not be saved (storage full).", {
        tone: "error",
      });
    }
    noteScoutChange();
  };

  const importCSV = (file: File) => {
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const raw = event.target?.result;
        if (typeof raw !== "string") throw new Error("File is not text");

        /*
         * A Team Rankings backup is JSON and carries the pool alone — no schedule, no season. Sent
         * through the schedule reader it would parse to nothing and the pool would be left alone,
         * which is the wrong answer to a file that is entirely pool.
         */
        const {
          teams: importedTeams,
          matchups: importedMatchups,
          logs: importedLogs,
          issues: importIssues,
        } = parseScheduleCsvImport(raw);
        // A CSV exported as a backup carries the Team Rankings sections after the schedule; a
        // plain schedule CSV carries none, and parses to null so the pool is left alone.
        const importedRankings = parseTeamRankingsCsv(raw);

        const warningLines = summarizeCsvImportIssues(importIssues);
        const importedScoreCount = Object.values(importedLogs).filter(isFinal).length;
        const logsPendingVerification = importedScoreCount
          ? Object.fromEntries(
              Object.entries(importedLogs).map(([gameId, log]) => [
                gameId,
                isFinal(log) ? { ...log, isFinal: false } : log,
              ])
            )
          : importedLogs;
        const importedTeamNameById = new Map(
          importedTeams.map((team) => [team.id, displayName(team.name)])
        );
        const preview = buildSeasonImportPreview(
          importedTeams,
          importedMatchups,
          importedLogs,
          teams,
          matchups,
          (teamId) => importedTeamNameById.get(teamId) ?? displayName(teamId),
          logs
        );
        const verificationMessage = importedScoreCount
          ? `\n\n${importedScoreCount} imported scored game${importedScoreCount === 1 ? "" : "s"} will load into the Scoreboard as pending verification. Review each score and use Verify Final before standings or prediction work counts it.`
          : "";
        const confirmed = await requestConfirmation({
          title: "Import schedule CSV?",
          message: `${formatSeasonImportPreview(preview, warningLines)}${verificationMessage}

${teamRankingsImportNote(importedRankings)}

This will replace the current season data and save an undo snapshot.`,
          confirmLabel: warningLines.length ? "Import with warnings" : "Replace season",
        });
        if (!confirmed) return;

        captureUndo("CSV import", { withTeamRankings: Boolean(importedRankings) });
        await applyTeamRankingsImport(importedRankings);
        setTeams(importedTeams);
        setMatchups(importedMatchups);
        setLogs(logsPendingVerification);
        setBracketLogs({});
        closeTeamData();
        setActiveView(importedScoreCount ? "games" : "standings");
        showToast(
          `Imported ${importedMatchups.length} games${importIssues.length ? ` with ${importIssues.length} skipped row(s)` : ""}${importedScoreCount ? `; ${importedScoreCount} scored game${importedScoreCount === 1 ? "" : "s"} pending verification` : ""}.`,
          {
            tone: "undo",
            actionLabel: "Undo",
            onAction: restoreUndo,
          }
        );
      } catch (error) {
        console.error(error);
        showToast(
          "Could not import this CSV. Use the schedule CSV with Game ID, Date, Away Team, and Home Team columns.",
          { tone: "error" }
        );
      }
    };
    reader.readAsText(file);
  };

  const exportCSV = useCallback(() => {
    const headers =
      settings.pitchMode === "player"
        ? [
            "Game ID",
            "Date",
            "Away Team",
            "Innings",
            "Away Runs",
            "Away Hits",
            "Away E",
            "Away BB",
            "Home Team",
            "Home Runs",
            "Home Hits",
            "Home E",
            "Home BB",
          ]
        : [
            "Game ID",
            "Date",
            "Away Team",
            "Innings",
            "Away Runs",
            "Away Hits",
            "Away K",
            "Away BIP",
            "Home Team",
            "Home Runs",
            "Home Hits",
            "Home K",
            "Home BIP",
          ];
    const rows = matchups.map((game) => {
      const log = logs[game.id] || EMPTY_GAME_LOG;
      const away = teamBaseById.get(game.away)?.name || game.away;
      const home = teamBaseById.get(game.home)?.name || game.home;
      const awayBip = calcBip(log.awayHits, log.awayRuns, log.awayK, log.innings);
      const homeBip = calcBip(log.homeHits, log.homeRuns, log.homeK, log.innings);
      const values =
        settings.pitchMode === "player"
          ? [
              game.id,
              formatGameDate(game.date),
              away,
              log.innings,
              log.awayRuns,
              log.awayHits,
              log.awayErrors ?? "",
              log.homeWalksAllowed ?? "",
              home,
              log.homeRuns,
              log.homeHits,
              log.homeErrors ?? "",
              log.awayWalksAllowed ?? "",
            ]
          : [
              game.id,
              formatGameDate(game.date),
              away,
              log.innings,
              log.awayRuns,
              log.awayHits,
              log.awayK,
              awayBip,
              home,
              log.homeRuns,
              log.homeHits,
              log.homeK,
              homeBip,
            ];
      return values.map(csvEscape).join(",");
    });
    const schedule = [headers.join(","), ...rows].join("\n");
    // Team Rankings is stored outside this season, so a CSV of the schedule alone is not a full
    // backup. Its sections ride along after the schedule, and the schedule block gets its own
    // marker so the file reads as the sectioned document it has become. A league that never used
    // Team Rankings has nothing to append and gets the same flat CSV as before.
    const rankings = teamRankingsCsvSections(readTeamRankingsBackup());
    const csv = rankings
      ? `${csvSectionMarker(CSV_SECTIONS.schedule)}\n${schedule}\n\n${rankings}\n`
      : schedule;
    const blob = new Blob([csv], {
      type: "text/csv",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${settings.seasonLabel.replace(/\s+/g, "_")}_Schedule_Data.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [settings, matchups, logs, teamBaseById]);

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

  const downloadBackup = useCallback((backup: FullBackup) => {
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = backupFilename(backup.exportedAt);
    anchor.click();
    URL.revokeObjectURL(url);
  }, []);

  const exportBackup = useCallback(() => {
    downloadBackup(readFullBackup(liveSeasonData()));
    noteBackupTaken("league");
  }, [downloadBackup, liveSeasonData]);

  /**
   * A whole-browser restore: every season, the Team Rankings pool, and the UI preferences. It
   * replaces more than the undo snapshot can hold — a season the backup does not carry is gone —
   * so instead of a misleading Undo the toast hands back a backup of what was just replaced.
   */
  const restoreFullBackup = async (backup: FullBackup) => {
    const previous = readFullBackup(liveSeasonData());
    const confirmed = await requestConfirmation({
      title: "Restore full backup?",
      message: `${summarizeFullBackup(backup)}

This replaces everything currently in this browser: all ${seasons.length} season${seasons.length === 1 ? "" : "s"}, the Team Rankings pool, and your theme and mode. It cannot be undone — the toast afterwards offers a download of the data being replaced.`,
      confirmLabel: "Restore everything",
    });
    if (!confirmed) return;

    const result = applyFullBackup(backup);
    // Storage is the source of truth after a restore, so pull React state back from it.
    reloadActiveSeason();
    // Also drops the team-data deep link, which could otherwise point at a team the restored
    // season does not have.
    closeTeamData();
    noteScoutChange();
    if (backup.preferences.theme) setTheme(backup.preferences.theme);
    if (backup.preferences.appMode) setAppMode(backup.preferences.appMode);
    setLastImpact(null);
    setActiveView("standings");

    // The download is the only way back from a restore, so it is offered on both outcomes — most
    // of all on a partial one — and the toast is held open long enough to actually click.
    const replacedDataAction = {
      actionLabel: "Download replaced data",
      onAction: () => downloadBackup(previous),
      durationMs: 12000,
    };
    if (!result.ok) {
      showToast(`Restore incomplete — could not write ${result.failed.join(", ")}.`, {
        tone: "error",
        ...replacedDataAction,
      });
      return;
    }
    showToast(
      `Restored ${backup.seasons.length} season${backup.seasons.length === 1 ? "" : "s"} and Team Rankings.`,
      { tone: "success", ...replacedDataAction }
    );
  };

  /** The older single-season backup shape: replaces the active season only, and stays undoable. */
  const restoreSeasonBackup = async (
    season: LiveSeasonData,
    nextRankings: TeamRankingsBackup | null
  ) => {
    const backupTeamNameById = new Map(
      season.teams.map((team) => [team.id, displayName(team.name)])
    );
    const preview = buildSeasonImportPreview(
      season.teams,
      season.matchups,
      season.logs,
      teams,
      matchups,
      (teamId) => backupTeamNameById.get(teamId) ?? displayName(teamId),
      logs
    );
    const confirmed = await requestConfirmation({
      title: "Import backup JSON?",
      message: `${formatSeasonImportPreview(preview)}

${teamRankingsImportNote(nextRankings)}

This backup carries one season, so it replaces the current season data and saves an undo snapshot.`,
      confirmLabel: "Import backup",
    });
    if (!confirmed) return;

    captureUndo("Backup import", { withTeamRankings: Boolean(nextRankings) });
    await applyTeamRankingsImport(nextRankings);
    setTeams(season.teams);
    setMatchups(season.matchups);
    setLogs(season.logs);
    setBracketLogs(season.bracketLogs);
    setSettings(season.settings);
    closeTeamData();
    setLastImpact(null);
    setActiveView("standings");
    showToast(`Imported backup (${season.matchups.length} games).`, {
      tone: "undo",
      actionLabel: "Undo",
      onAction: restoreUndo,
    });
  };

  const importBackup = (file: File) => {
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const raw = event.target?.result;
        if (typeof raw !== "string") throw new Error("Backup is not text");

        /*
         * Two JSON backups arrive at this button now, and they are not the same file. The whole-app
         * one carries every season, the pool and the settings; the Team Rankings one carries the
         * pool alone. Told apart by what the file says it is rather than by which button was
         * pressed, so handing over the wrong one is a message rather than a restore of nothing.
         */
        const pool = parseTeamRankingsJson(raw);
        if (pool) {
          // It replaces the whole pool rather than merging into it, which is worth saying out loud
          // before it happens — the same reason the CSV path previews what it will do.
          const confirmed = await requestConfirmation({
            title: "Restore Team Rankings from this file?",
            message: `${teamRankingsImportNote(pool)}

League Standings — your seasons, schedules and scores — is not touched.`,
            confirmLabel: "Restore",
          });
          if (!confirmed) return;
          await applyTeamRankingsImport(pool);
          showToast(`Team Rankings restored: ${summarizeTeamRankingsBackup(pool)}`, {
            tone: "success",
          });
          return;
        }

        const parsed = coerceBackup(JSON.parse(raw) as unknown);
        if (!parsed) throw new Error("Backup is not a League Forecast backup");
        if (parsed.kind === "full") await restoreFullBackup(parsed.backup);
        else await restoreSeasonBackup(parsed.season, parsed.teamRankings);
      } catch (error) {
        console.error(error);
        showToast("Could not import this backup JSON.", { tone: "error" });
      }
    };
    reader.readAsText(file);
  };

  const resetSeason = async () => {
    const confirmed = await requestConfirmation({
      title: "Reset season?",
      message:
        "This clears teams, games, and scores from this browser. An undo snapshot will be saved.",
      confirmLabel: "Reset season",
    });
    if (!confirmed) return;
    captureUndo("Reset season");
    setTeams([]);
    setMatchups([]);
    setLogs({});
    setBracketLogs({});
    setLastImpact(null);
    closeTeamData();
    setActiveView("standings");
    showToast("Season reset.", {
      tone: "undo",
      actionLabel: "Undo",
      onAction: restoreUndo,
    });
  };

  const summarizeChanges = (before: RankSnapshotEntry[], after: RankSnapshotEntry[]) => {
    const messages: string[] = [];
    after.forEach((team) => {
      const old = before.find((item) => item.id === team.id);
      if (!old) return;
      const oldRank = old.rank ?? 99;
      const newRank = team.rank ?? 99;
      const teamName = displayName(team.name);
      if (oldRank !== newRank) {
        const direction = newRank < oldRank ? "moved up" : "dropped";
        messages.push(`${teamName} ${direction} from #${oldRank} to #${newRank}`);
      }
      if (oldRank <= goldCutoff && newRank > goldCutoff) {
        messages.push(`${teamName} dropped below the Gold cut line`);
      }
      if (oldRank > goldCutoff && newRank <= goldCutoff) {
        messages.push(`${teamName} moved above the Gold cut line into Gold position`);
      }
      if (old.goldStatus !== team.goldStatus) {
        if (team.goldStatus === "Eliminated")
          messages.push(`${teamName} is now eliminated from Gold Bracket contention`);
        else if (team.goldStatus === "Clinched")
          messages.push(`${teamName} clinched the Gold Bracket`);
      }
    });
    return Array.from(new Set(messages)).slice(0, 10);
  };

  const projectionSettingsForDelta = (): ProjectionRelevantSettings => ({
    goldCutoff: settings.goldCutoff,
    regularSeasonGamesPerTeam: settings.regularSeasonGamesPerTeam,
    winPoints: settings.winPoints,
    tiePoints: settings.tiePoints,
    runDiffTiebreaker: settings.runDiffTiebreaker,
    tiebreakerOrder: settings.tiebreakerOrder,
    maxScoreCap: settings.maxScoreCap,
    modelAggression: settings.modelAggression,
  });

  // Plain-English "why the projection moved" bullets per team, derived from the same
  // before/after rank snapshots the recap already builds (lib/projectionExplanation.ts).
  const buildProjectionExplanationsForUpdate = (
    before: RankSnapshotEntry[],
    after: RankSnapshotEntry[]
  ): ProjectionExplanationEntry[] => {
    const toSnapshotTeam = (entry: RankSnapshotEntry) => ({
      id: entry.id,
      w: entry.w,
      t: entry.t,
      rs: entry.rs,
      ra: entry.ra,
      runDiff: entry.runDiff,
      rank: entry.rank,
      projectedRank: entry.projectedRank,
    });
    const projectionSettings = projectionSettingsForDelta();
    const delta = diffProjectionSnapshots(
      buildProjectionSnapshot({ teams: before.map(toSnapshotTeam), settings: projectionSettings }),
      buildProjectionSnapshot({ teams: after.map(toSnapshotTeam), settings: projectionSettings })
    );
    return delta.teams
      .map((teamDelta) => ({
        teamId: teamDelta.teamId,
        teamName: displayName(teamBaseById.get(teamDelta.teamId)?.name ?? teamDelta.teamId),
        items: buildProjectionExplanations(teamDelta, { maxItems: 2 }),
      }))
      .filter((entry) => entry.items.length > 0);
  };

  const toggleFinal = (gameId: string) => {
    setLogs((prev) => {
      const current = prev[gameId] || blankLog(String(settings.defaultGameInnings));
      const isMarkingFinal = !current.isFinal;
      const game = matchups.find((item) => item.id === gameId);
      const nextLogs = { ...prev, [gameId]: { ...current, isFinal: !current.isFinal } };

      if (isMarkingFinal && game) {
        const dateLabel = normalizeDateInput(game.date);
        const weekLabel = sundayEndingWeekKey(game.date);
        const nextRemainingCount = matchups.reduce(
          (count, matchup) => count + (isFinal(nextLogs[matchup.id]) ? 0 : 1),
          0
        );
        if (nextRemainingCount > IMPACT_RECAP_REMAINING_GAME_LIMIT) {
          const away = teamBaseById.get(game.away);
          const home = teamBaseById.get(game.home);
          setLastImpact({
            title: `Latest Update — ${displayName(away?.name || game.away)} vs ${displayName(
              home?.name || game.home
            )}`,
            scores: [
              `${displayName(away?.name || game.away)} ${parseNumber(current.awayRuns)}, ${displayName(
                home?.name || game.home
              )} ${parseNumber(current.homeRuns)}`,
            ],
            messages: [
              `Final saved. Detailed standings-impact recap is paused until ${IMPACT_RECAP_REMAINING_GAME_LIMIT} or fewer games remain to keep scoring responsive.`,
            ],
            recapItems: [],
          });
          return nextLogs;
        }
        const sameRecapWindow = (m: Matchup) => {
          if (settings.recapGrouping === "game") return m.id === gameId;
          if (settings.recapGrouping === "week") {
            return sundayEndingWeekKey(m.date) === weekLabel;
          }
          return normalizeDateInput(m.date) === dateLabel;
        };
        const groupedFinals = matchups.filter((m) => {
          if (!sameRecapWindow(m)) return false;
          const log = nextLogs[m.id];
          return !!log?.isFinal;
        });

        const beforeLogs = { ...nextLogs };
        groupedFinals.forEach((m) => {
          const log = beforeLogs[m.id] || blankLog();
          beforeLogs[m.id] = { ...log, isFinal: false };
        });

        const before = buildRankSnapshot(beforeLogs);
        const after = buildRankSnapshot(nextLogs);
        const messages = summarizeChanges(before, after);
        const finalsSinceLast = groupedFinals.map((m) => {
          const log = nextLogs[m.id] || blankLog();
          const away = teamBaseById.get(m.away);
          const home = teamBaseById.get(m.home);
          return {
            game: m,
            awayScore: parseNumber(log.awayRuns),
            homeScore: parseNumber(log.homeRuns),
            awayName: displayName(away?.name || m.away),
            homeName: displayName(home?.name || m.home),
          };
        });
        const recapItems = weeklyRecap({
          before,
          after: after.map((entry) => ({
            id: entry.id,
            rank: entry.rank,
            goldPct: entry.goldPct,
            goldStatus: entry.goldStatus,
            name: entry.name,
          })),
          finalsSinceLast,
          cutoff: goldCutoff,
          hasCutLine,
        });
        const projectionExplanations = buildProjectionExplanationsForUpdate(before, after);
        setLastImpact({
          title:
            settings.recapGrouping === "game"
              ? `Latest Update — ${finalsSinceLast[0]?.awayName ?? "Away"} vs ${finalsSinceLast[0]?.homeName ?? "Home"}`
              : settings.recapGrouping === "week"
                ? `Latest Update — Week Ending ${weekLabel || "No Date"}`
                : dateLabel
                  ? `Latest Update — ${dateLabel}`
                  : "Latest Update — No Date",
          scores: finalsSinceLast.map(
            (item) => `${item.awayName} ${item.awayScore}, ${item.homeName} ${item.homeScore}`
          ),
          messages: messages.length
            ? messages
            : ["This update was recorded; no standings-impact detail to summarize."],
          recapItems,
          projectionExplanations,
        });
      } else {
        setLastImpact(null);
      }
      return nextLogs;
    });
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
    [settings.defaultGameInnings]
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
    []
  );

  const toggleBracketFinal = useCallback((gameId: string) => {
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
  }, []);

  const clearBracketScores = useCallback(
    (gameIds: string[], label: string) => {
      const ids = new Set(gameIds);
      setBracketLogs((prev) =>
        Object.fromEntries(Object.entries(prev).filter(([gameId]) => !ids.has(gameId)))
      );
      showToast(`${label} scores cleared.`, { tone: "success" });
    },
    [showToast]
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
   * storage, and nothing about it changes while the review is on screen.
   */
  const [scoreFillPlan, setScoreFillPlan] = useState<LeagueFillPlan | null>(null);

  const openScoreFill = () => {
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
  };

  const applyScoreFill = (matchupIds: string[]) => {
    const plan = scoreFillPlan;
    if (!plan) return;
    const result = applyLeagueScoreFill(plan, matchupIds, logs, settings.defaultGameInnings);
    setScoreFillPlan(null);
    if (result.filled === 0) {
      showToast("Nothing was filled in.", { tone: "info" });
      return;
    }
    captureUndo("Filled scores from Team Rankings");
    setLogs(result.logs);
    showToast(summarizeLeagueFill(plan, result.filled), {
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
      return {
        ...prev,
        [gameId]: {
          ...log,
          awayRuns: log.homeRuns,
          awayHits: log.homeHits,
          awayK: log.homeK,
          homeRuns: log.awayRuns,
          homeHits: log.awayHits,
          homeK: log.awayK,
        },
      };
    });
  };

  const loadDemoSeason = useCallback(async () => {
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
    captureUndo("Load demo season");
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
  }, [teams, matchups, requestConfirmation, captureUndo, closeTeamData, showToast, restoreUndo]);

  // ---------- Season builder ----------

  const readBuilderTeamNames = (): string[] => {
    const cleaned = seasonBuilderText
      .split(/\r?\n|,/)
      .map((name) => name.trim())
      .filter(Boolean);
    return Array.from(new Set(cleaned));
  };

  const buildRoundRobinSeason = () => {
    const names = readBuilderTeamNames();
    if (names.length < 2) {
      showToast("Enter at least two teams to build a schedule.", { tone: "error" });
      return null;
    }
    const existingIds = new Set<string>();
    const builtTeams = names.map((name) => ({
      id: createTeamId(displayName(name), existingIds),
      name,
    }));
    const builtMatchups: Matchup[] = [];
    const builtLogs: Record<string, GameLog> = {};
    for (let awayIndex = 0; awayIndex < builtTeams.length; awayIndex += 1) {
      for (let homeIndex = awayIndex + 1; homeIndex < builtTeams.length; homeIndex += 1) {
        const away = builtTeams[awayIndex];
        const home = builtTeams[homeIndex];
        if (!away || !home) continue;
        const gameNumber = builtMatchups.length + 1;
        const id = `game_${String(gameNumber).padStart(3, "0")}_${away.id}_${home.id}`;
        builtMatchups.push({ id, date: "", away: away.id, home: home.id });
        builtLogs[id] = blankLog(String(settings.defaultGameInnings));
      }
    }
    return { builtTeams, builtMatchups, builtLogs };
  };

  const createSeasonFromTeamList = async () => {
    const built = buildRoundRobinSeason();
    if (!built) return;
    const confirmed = await requestConfirmation({
      title: "Create blank season?",
      message: `${built.builtTeams.length} teams · ${built.builtMatchups.length} games.\n\nEach team plays every other team once. This replaces current season data and saves an undo snapshot.`,
      confirmLabel: "Create season",
    });
    if (!confirmed) return;
    captureUndo("Create blank season");
    setTeams(built.builtTeams);
    setMatchups(built.builtMatchups);
    setLogs(built.builtLogs);
    setBracketLogs({});
    setLastImpact(null);
    closeTeamData();
    setScoreboardTeamFilter("ALL");
    setActiveView("games");
    showToast(`Created ${built.builtMatchups.length}-game schedule.`, {
      tone: "undo",
      actionLabel: "Undo",
      onAction: restoreUndo,
    });
  };

  const downloadRoundRobinCSV = () => {
    const built = buildRoundRobinSeason();
    if (!built) return;
    const headers =
      settings.pitchMode === "player"
        ? [
            "Game ID",
            "Date",
            "Away Team",
            "Innings",
            "Away Runs",
            "Away Hits",
            "Away E",
            "Away BB",
            "Home Team",
            "Home Runs",
            "Home Hits",
            "Home E",
            "Home BB",
          ]
        : [
            "Game ID",
            "Date",
            "Away Team",
            "Innings",
            "Away Runs",
            "Away Hits",
            "Away K",
            "Away BIP",
            "Home Team",
            "Home Runs",
            "Home Hits",
            "Home K",
            "Home BIP",
          ];
    const rows = built.builtMatchups.map((game) => {
      const away = built.builtTeams.find((team) => team.id === game.away)?.name || game.away;
      const home = built.builtTeams.find((team) => team.id === game.home)?.name || game.home;
      const values =
        settings.pitchMode === "player"
          ? [
              game.id,
              "",
              away,
              String(settings.defaultGameInnings),
              "",
              "",
              "",
              "",
              home,
              "",
              "",
              "",
              "",
            ]
          : [
              game.id,
              "",
              away,
              String(settings.defaultGameInnings),
              "",
              "",
              "",
              "N/A",
              home,
              "",
              "",
              "",
              "N/A",
            ];
      return values.map(csvEscape).join(",");
    });
    const blob = new Blob([[headers.join(","), ...rows].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${settings.seasonLabel.replace(/\s+/g, "_")}_Blank_Round_Robin.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // ---------- Header / selection ----------

  const tabRefs = useRef<Record<ActiveView, HTMLButtonElement | null>>({
    dashboard: null,
    power: null,
    standings: null,
    teamStats: null,
    games: null,
    model: null,
    settings: null,
  });

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const idx = VIEW_ORDER.indexOf(activeView);
    const nextIdx =
      event.key === "ArrowRight"
        ? (idx + 1) % VIEW_ORDER.length
        : (idx - 1 + VIEW_ORDER.length) % VIEW_ORDER.length;
    const nextView = VIEW_ORDER[nextIdx];
    if (!nextView) return;
    setActiveView(nextView);
    tabRefs.current[nextView]?.focus();
  };

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
  const currentLeader = dashboardRows[0];

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
    // `statusLabel` is a render-scoped helper over these same inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    lastImpact,
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
        upsetCaptureRate:
          backtestResult.upsetCaptureRate === null
            ? undefined
            : backtestResult.upsetCaptureRate * 100,
      },
      season: {
        finalGames: completedGames.length,
        totalGames: matchups.length,
        leaderName: currentLeader ? displayName(currentLeader.name) : undefined,
        gamesPerTeam: settings.regularSeasonGamesPerTeam,
      },
    });
    // `seedRangeForTeam` is a render-scoped helper over these same inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeView,
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
  useEffect(() => {
    if (!sharedSnapshot || sharedHandledRef.current) return;
    sharedHandledRef.current = true;
    requestConfirmation({
      title: "Load shared season snapshot?",
      message: `${sharedSnapshot.teams.length} teams · ${sharedSnapshot.matchups.length} games found in this URL.\n\nReplace your current local data? Cancel keeps your data; the URL snapshot will still be cleared.`,
      confirmLabel: "Load snapshot",
    }).then((ok) => {
      if (ok) {
        captureUndo("Load shared snapshot");
        setTeams(sharedSnapshot.teams);
        setMatchups(sharedSnapshot.matchups);
        setLogs(sharedSnapshot.logs);
        setSettings(sharedSnapshot.settings);
        if (sharedUiState.view) setActiveView(sharedUiState.view);
        if (sharedUiState.teamId) setSelectedTeamId(sharedUiState.teamId);
        showToast("Loaded shared snapshot and view state.", {
          tone: "undo",
          actionLabel: "Undo",
          onAction: restoreUndo,
        });
      }
      clearSharedSnapshot();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedSnapshot, sharedUiState]);

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

  const runTrackedCommand = useCallback(
    (id: string, run: () => void) => () => {
      setCommandHistory((prev) => [id, ...prev.filter((item) => item !== id)].slice(0, 6));
      run();
    },
    []
  );

  const commands: Command[] = useMemo(() => {
    const teamCmds: Command[] = dashboardRows.map((team) => ({
      id: `team-${team.id}`,
      label: `View ${displayName(team.name)}`,
      group: "Team",
      hint: `#${team.rank} · ${recordText(team)}`,
      run: runTrackedCommand(`team-${team.id}`, () => openTeamData(team.id)),
    }));
    const viewCmds: Command[] = VIEW_ORDER.map((view) => ({
      id: `view-${view}`,
      label: `Go to ${VIEW_LABELS[view]}`,
      group: "View",
      run: runTrackedCommand(`view-${view}`, () => setActiveView(view)),
    }));
    const actionCmds: Command[] = [
      {
        id: "action-share",
        label: "Share this season (copy URL)",
        group: "Action",
        run: runTrackedCommand("action-share", shareSeason),
      },
      {
        id: "action-export",
        label: "Export schedule CSV",
        group: "Action",
        run: runTrackedCommand("action-export", () => exportCSV()),
      },
      {
        id: "action-backup",
        label: "Download backup JSON",
        group: "Action",
        run: runTrackedCommand("action-backup", () => exportBackup()),
      },
      {
        id: "action-demo",
        label: "Load demo season",
        group: "Action",
        run: runTrackedCommand("action-demo", loadDemoSeason),
      },
      {
        id: "action-toggle-theme",
        label: theme === "dark" ? "Switch to light mode" : "Switch to dark mode",
        group: "Action",
        run: runTrackedCommand("action-toggle-theme", toggleTheme),
      },
      {
        id: "action-shortcuts",
        label: "Show keyboard shortcuts",
        group: "Help",
        run: runTrackedCommand("action-shortcuts", () => setShowShortcuts(true)),
      },
      {
        id: "action-tour",
        label: "Show app tour",
        group: "Help",
        run: runTrackedCommand("action-tour", () => setShowTour(true)),
      },
    ];
    const byId = new Map([...viewCmds, ...teamCmds, ...actionCmds].map((c) => [c.id, c]));
    const historyCmds = commandHistory
      .map((id) => byId.get(id))
      .filter((cmd): cmd is Command => !!cmd)
      .map((cmd) => ({ ...cmd, group: "Recent" }));
    return [...historyCmds, ...viewCmds, ...teamCmds, ...actionCmds];
  }, [
    commandHistory,
    dashboardRows,
    theme,
    runTrackedCommand,
    openTeamData,
    shareSeason,
    exportCSV,
    exportBackup,
    loadDemoSeason,
    toggleTheme,
  ]);

  const shortcuts: Shortcut[] = useMemo(
    () =>
      appMode !== "league"
        ? []
        : [
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
            {
              combo: "d",
              description: "Toggle dark mode",
              group: "Action",
              handler: toggleTheme,
            },
          ],
    [appMode, toggleTheme]
  );
  useShortcuts(shortcuts);

  const shortcutEntries = shortcuts.map((s) => ({
    combo: s.combo,
    description: s.description,
    group: s.group,
  }));

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
                <h1 className="text-2xl font-black tracking-[-0.04em] text-slate-950 dark:text-white">
                  League Forecast
                </h1>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div
                  role="tablist"
                  aria-label="App mode"
                  className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-900"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={appMode === "league"}
                    onClick={() => setAppMode("league")}
                    className={tab(appMode === "league")}
                  >
                    League Standings
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={appMode === "rankings"}
                    onClick={() => setAppMode("rankings")}
                    className={tab(appMode === "rankings")}
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
                      onChange={(event) => switchSeason(event.target.value)}
                      className="inline-flex rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                      aria-label="Active season"
                      title="Switch season"
                    >
                      {seasons.map((season) => (
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
                <button
                  type="button"
                  onClick={toggleTheme}
                  className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-3 text-sm font-bold text-slate-800 shadow-xs hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                  aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                  title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                >
                  {theme === "dark" ? "☀" : "☾"}
                </button>
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

        {appMode === "league" && (
          <div className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 shadow-xs shadow-slate-200/60 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/90 dark:shadow-black/20">
            <div
              role="tablist"
              aria-label="Main views"
              className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 py-1.5 sm:px-6 lg:px-8"
            >
              {VIEW_ORDER.map((view) => (
                <button
                  key={view}
                  ref={(el) => {
                    tabRefs.current[view] = el;
                  }}
                  role="tab"
                  id={`tab-${view}`}
                  aria-selected={activeView === view}
                  aria-controls={`panel-${view}`}
                  tabIndex={activeView === view ? 0 : -1}
                  onClick={() => setActiveView(view)}
                  onKeyDown={onTabKeyDown}
                  className={tab(activeView === view)}
                >
                  {VIEW_LABELS[view]}
                </button>
              ))}
            </div>
          </div>
        )}

        {appMode === "rankings" ? (
          <main
            id="main-content"
            tabIndex={-1}
            className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8"
          >
            <Suspense fallback={<LoadingPanel area="Team Rankings" />}>
              <TeamRankingsView
                seasons={seasons}
                showToast={showToast}
                requestConfirmation={requestConfirmation}
                onDataChange={noteScoutChange}
              />
            </Suspense>
          </main>
        ) : (
          <main
            className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8"
            tabIndex={-1}
            id={`panel-${activeView}`}
            role="tabpanel"
            aria-labelledby={`tab-${activeView}`}
          >
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
                backtestResult={backtestResult}
                teamsById={liveById}
                matchups={matchups}
                setActiveView={setActiveView}
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
                    storyText || recapToStoryBrief(settings.seasonLabel, lastImpact.recapItems);
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
                storySource={aiStory.status === "ready" ? "gemini" : "local"}
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
                forecastStoryText={forecastStory.status === "ready" ? forecastStory.summary : ""}
                forecastStoryModel={forecastStory.model}
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
              />
            ) : activeView === "settings" ? (
              <div className="space-y-6">
                <SeasonManager
                  seasons={seasons}
                  activeSeasonId={activeSeasonId}
                  onSwitch={switchSeason}
                  onCreate={handleCreateSeason}
                  onDuplicate={handleDuplicateSeason}
                  onDelete={handleDeleteSeason}
                />
                {/* Above Settings because it answers the question the "Team Rankings results"
                    setting down there raises: which club is which. */}
                <ScoutLinkPanel
                  bridge={scoutBridge}
                  candidatesFor={scoutCandidatesFor}
                  allClubs={allScoutClubs}
                  seasonLabel={settings.seasonLabel}
                  countingOn={settings.useScoutResults}
                  onPick={setScoutLink}
                />
                <SettingsView
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
                openScoreFill={openScoreFill}
                closeScoreFill={() => setScoreFillPlan(null)}
                applyScoreFill={applyScoreFill}
                seasonLabel={settings.seasonLabel}
              />
            )}
          </main>
        )}

        {selectedTeam && (
          <TeamDrawer
            team={selectedTeam}
            range={
              selectedTeamDetail?.range ?? {
                best: selectedTeam.rank ?? 99,
                worst: selectedTeam.rank ?? 99,
                baseline: selectedTeam.rank ?? 99,
              }
            }
            bubble={selectedTeamDetail?.bubble ?? "Loading details..."}
            currentSosRank={selectedTeamDetail?.currentSosRank ?? null}
            sos={selectedTeamDetail?.sos ?? { label: "Loading…", rating: 0, opponents: "" }}
            swings={selectedTeamDetail?.swings ?? []}
            clinchScenarios={selectedTeamDetail?.clinchScenarios ?? ["Loading clinch scenarios…"]}
            titleRace={selectedTeamDetail?.titleRace ?? "Loading…"}
            goldPctLabel={selectedTeamDetail?.goldPctLabel ?? formatGoldPct(selectedTeam)}
            cutoff={goldCutoff}
            magicForGold={
              selectedTeamDetail?.magic ?? {
                type: "magic",
                ownWinsNeeded: 0,
                opponentLossesNeeded: 0,
                description: "Loading magic number…",
              }
            }
            eliminationNumber={
              selectedTeamDetail?.elimination ?? {
                type: "elimination",
                ownWinsNeeded: 0,
                opponentLossesNeeded: 0,
                description: "Loading elimination number…",
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
            onRename={(name) => renameLeagueTeam(selectedTeam.id, name)}
            onCompare={() => {
              const candidate = dashboardRows.find((team) => team.id !== selectedTeam.id);
              setCompareTeamId(candidate ? candidate.id : null);
            }}
          />
        )}

        {selectedTeam && compareTeam && (
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
        )}

        {appMode === "league" && (
          /*
            Guarded by the open flags as well as rendered lazily: each of these returns null when
            closed, so rendering them unconditionally would fetch all three on page load and show
            nothing. There is no fallback because there is nothing on screen to hold a place for —
            an overlay simply appears a frame later than it used to.
          */
          <Suspense fallback={null}>
            {showCommandPalette && (
              <CommandPalette
                open={showCommandPalette}
                commands={commands}
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
          </Suspense>
        )}
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
