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
import { RANKINGS_COMMAND_SECTIONS, rankingsSectionCommandId } from "./lib/rankingsRoute";
import { recordDiagnostic } from "./lib/diagnostics";
import { useClinchScenarios } from "./hooks/useClinchScenarios";
import { useSeedRanges } from "./hooks/useSeedRanges";
import { useSeasons } from "./hooks/useSeasons";
import { useSeasonFiles, type ImportedSeason } from "./hooks/useSeasonFiles";
import { useScoutBridge } from "./hooks/useScoutBridge";
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
import {
  loadAgeGroups,
  loadScoutGamesForSeason,
  loadScoutTeams,
  isPoolUnavailable,
  onPoolWriteError,
} from "./lib/teamRankingsStorage";
import { readSummaryMode, writeSummaryMode, type SummaryMode } from "./lib/preferences";
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
import { formatGameDate, normalizeDateInput, parseDateValue } from "./lib/date";
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
  nameFrom,
  PROJECT_STANDINGS_REMAINING_GAME_LIMIT,
  type RecapPool,
} from "./lib/impactRecap";
import { buildSeasonTimeline } from "./lib/seasonTimeline";
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
  loadBracketLogs,
  loadLogs,
  loadMatchups,
  loadSettings,
  loadTeams,
  saveBracketLogs,
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
  type Settings,
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
import { blankLog, clamp, isFinal } from "./lib/util";
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

export default function App() {
  const [activeView, setActiveView] = useState<ActiveView>("dashboard");
  const [teams, setTeams] = useState<TeamBase[]>(() => loadTeams());
  const [matchups, setMatchups] = useState<Matchup[]>(() => loadMatchups());
  const [logs, setLogs] = useState<Record<string, GameLog>>(() => loadLogs());
  const deferredLogs = useDeferredValue(logs);
  const [bracketLogs, setBracketLogs] = useState<Record<string, GameLog>>(() => loadBracketLogs());
  const [settings, setSettings] = useState<Settings>(() => loadSettings());

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
  const seasons = useSeasons({
    seasonLabel: settings.seasonLabel,
    loadActiveSeason,
    showToast,
    requestConfirmation,
  });
  const activeSeasonId = seasons.activeId;

  /** What Team Rankings has for this season: the results, the picks and the search behind them. */
  const {
    bridge: scoutBridge,
    externalResults,
    candidatesFor: scoutCandidatesFor,
    allClubs: allScoutClubs,
    noteChange: noteScoutChange,
  } = useScoutBridge({
    activeSeasonId,
    teams,
    seasonFixtures,
    useScoutResults: settings.useScoutResults,
    onLink: setScoutLink,
  });

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
    const built = buildTrendStates(teams, matchups, deferredLogs, completedGames, {
      states: TREND_STATES,
      goldCutoff,
      settings,
    });
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
      if (team.goldPct >= 20 || projectedSeed <= goldCutoff + 2 || team.maxPct >= cutoffRow.pct) {
        return "Bubble Out";
      }
      return "Long Shot";
    },
    [goldCutoff, dashboardRows]
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
  }, [remainingGames, dashboardById, getGameScenarioImpactMap, gameStatusForGame, gameImportance]);

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
  const readSeasonForUndo = useCallback(
    () => ({ teams, matchups, logs, bracketLogs }),
    [teams, matchups, logs, bracketLogs]
  );

  const applySeasonFromUndo = useCallback(
    (season: UndoableSeason) => {
      setTeams(season.teams);
      setMatchups(season.matchups);
      setLogs(season.logs);
      setBracketLogs(season.bracketLogs);
      closeTeamData();
    },
    [closeTeamData]
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
  });

  /*
   * Bound here and filled below, because these three run in a circle: the season index is needed
   * by the Team Rankings bridge, the bridge is needed by the undo snapshot, and the undo snapshot
   * is needed by the reload the index drives. Something has to be late, and this is the smallest
   * of the three — one function, called only from a handler, never during a render.
   */
  useEffect(() => {
    loadActiveSeasonRef.current = () => {
      setTeams(loadTeams());
      setMatchups(loadMatchups());
      setLogs(loadLogs());
      setBracketLogs(loadBracketLogs());
      setSettings(loadSettings());
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
  const applySeason = useCallback((next: ImportedSeason) => {
    setTeams(next.teams);
    setMatchups(next.matchups);
    setLogs(next.logs);
    setBracketLogs(next.bracketLogs);
    if (next.settings) setSettings(next.settings);
  }, []);

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
    setLogs(nextLogs);
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
          onAction: () => restoreUndoRef.current(),
        });
      }
      clearSharedSnapshot();
    });
    /*
     * All four are stable callbacks, so listing them changes nothing about when this runs — and
     * `sharedHandledRef` makes a second run a no-op regardless. The point of listing them is that
     * the next person to add a closure here gets told, rather than inheriting a comment that was
     * true when it was written.
     */
  }, [
    sharedSnapshot,
    sharedUiState,
    captureUndo,
    clearSharedSnapshot,
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
                seasons={seasons.all}
                showToast={showToast}
                requestConfirmation={requestConfirmation}
                onDataChange={noteScoutChange}
                onCommands={setRankingsCommands}
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
                  seasons={seasons.all}
                  activeSeasonId={activeSeasonId}
                  onSwitch={seasons.switchTo}
                  onCreate={seasons.create}
                  onDuplicate={seasons.duplicate}
                  onDelete={(id) => void seasons.remove(id)}
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

        {
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
