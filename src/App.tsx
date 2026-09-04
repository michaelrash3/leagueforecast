import React, {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { registerSW } from "virtual:pwa-register";
import { CommandPalette, type Command } from "./components/CommandPalette";
import { AiStoryPanel } from "./components/AiStoryPanel";
import { ClinchingPathsPanel } from "./components/ClinchingPathsPanel";
import { CompareDrawer } from "./components/CompareDrawer";
import { ModelHealthPanel } from "./components/ModelHealthPanel";
import { OnboardingTour } from "./components/OnboardingTour";
import { HelpTip } from "./components/HelpTip";
import { ProjectionExplanation } from "./components/ProjectionExplanation";
import { SeedOddsPanel } from "./components/SeedOddsPanel";
import { GoldOddsTrendChart } from "./components/charts/GoldOddsTrendChart";
import { HeadToHeadMatrix, type H2HCell } from "./components/charts/HeadToHeadMatrix";
import { SeasonTimelinePanel } from "./components/SeasonTimelinePanel";
import { ShortcutsHelp } from "./components/ShortcutsHelp";
import { TeamRankingsView } from "./components/TeamRankingsView";
import { ToastView } from "./components/Toast";
import { useAppMode } from "./hooks/useAppMode";
import { useDarkMode } from "./hooks/useDarkMode";
import { useFocusTrap } from "./hooks/useFocusTrap";
import { useShortcuts, type Shortcut } from "./hooks/useShortcuts";
import { useLeagueSummary } from "./hooks/useLeagueSummary";
import { useToast } from "./hooks/useToast";
import { useUrlSnapshot } from "./hooks/useUrlState";
import {
  useSimulationBracket,
  useSimulationOdds,
  useSimulationTrend,
} from "./hooks/useSimulationWorker";
import {
  clinchingPathsForTeams,
  goldCutLineSnapshot,
  type ClinchingPathNote,
} from "./lib/clinchingPaths";
import { csvEscape } from "./lib/csv";
import {
  formatGameDate,
  formatGameDateLong,
  normalizeDateInput,
  parseDateValue,
  sundayEndingWeekKey,
} from "./lib/date";
import { displayName, recordText, teamAbbr } from "./lib/format";
import { summarizeCsvImportIssues } from "./lib/importReport";
import { buildSeasonImportPreview, formatSeasonImportPreview } from "./lib/importPreview";
import { parseScheduleCsvImport } from "./lib/scheduleCsvImport";
import {
  pathSummary,
  recapToMarkdown,
  recapToStoryBrief,
  weeklyRecap,
  type RecapItem,
} from "./lib/insights";
import type { LeagueSummaryErrorReason } from "./lib/leagueSummary";
import { buildForecastSummaryRequest, buildLeagueSummaryRequest } from "./lib/leagueSummaryClient";
import { eliminationNumberForGold, magicForGold } from "./lib/magic";
import { backtestPredictions } from "./lib/backtest";
import { buildPredictionEngine, type LeaguePrediction } from "./lib/predictionEngine";
import { buildBracketProjection, type BracketGameProjection } from "./lib/bracket";
import { scheduleDifficultyForTeam as buildScheduleDifficultyForTeam } from "./lib/scheduleDifficulty";
import { buildShareUrl } from "./lib/share";
import { formatProbabilityMargin, wilsonScoreInterval } from "./lib/probability";
import { projectionConfidenceForTeam } from "./lib/projectionConfidence";
import {
  buildProjectionSnapshot,
  diffProjectionSnapshots,
  type ProjectionRelevantSettings,
} from "./lib/projectionDelta";
import { buildProjectionExplanations } from "./lib/projectionExplanation";
import { buildSeasonTimeline, type SeasonTimelineEntry } from "./lib/seasonTimeline";
import { coerceLogs, coerceMatchups, coerceSettings, coerceTeams, isRecord } from "./lib/validate";
import {
  applyResult,
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
  type BracketOddsResult,
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
  RUN_SCORE_CAP,
  SIM_ITERATIONS,
  TIEBREAKER_LABELS,
  TREND_STATES,
  type ActiveShareView,
  type GameLog,
  type Matchup,
  type ModelAggression,
  type PitchMode,
  type PostseasonFormat,
  type Prediction,
  type RecapGrouping,
  type Settings,
  type SwingGame,
  type Team,
  type TeamBase,
  type TeamWithProjection,
  type TiebreakerFactor,
  type UndoSnapshot,
} from "./lib/types";
import { blankLog, clamp, isFinal, parseNumber } from "./lib/util";
import { button as buttonClasses, card, pill, tab } from "./styles/tokens";
import {
  formatGoldPct as formatGoldPctValue,
  titleRaceBadgeForTeam as titleRaceBadgeForTeamValue,
} from "./lib/standingsView";

type ActiveView = ActiveShareView;
type ConfirmState = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

type ProjectionExplanationEntry = {
  teamId: string;
  teamName: string;
  items: string[];
};

type LastImpact = {
  title: string;
  scores: string[];
  messages: string[];
  recapItems: RecapItem[];
  projectionExplanations?: ProjectionExplanationEntry[];
};

type TeamTrendGame = {
  id: string;
  date: string;
  label: string;
  runsFor: number;
  hitsFor: number;
  runsAgainst: number;
  hitsAgainst: number;
};

type TeamTrendMetric = {
  key: string;
  label: string;
  shortLabel: string;
  season: number | null;
  recent: number | null;
  delta: number | null;
  direction: "higher" | "lower";
  status: "Hot" | "Cold" | "Steady" | "No data";
  values: number[];
};

type TeamTrendSummary = {
  games: TeamTrendGame[];
  recentWindow: number;
  metrics: TeamTrendMetric[];
  headline: string;
};

type TeamSplitLine = {
  label: string;
  games: number;
  offense: { runs: number; hits: number; strikeouts: number; walks: number };
  defense: { runs: number; hits: number; strikeouts: number; errors: number; walks: number };
};

type TeamSplitSummary = {
  all: TeamSplitLine;
  home: TeamSplitLine;
  away: TeamSplitLine;
};

type LeagueAverageStats = {
  completedGames: number;
  teamGames: number;
  runs: number;
  hits: number;
  strikeouts: number;
  errors: number;
  walks: number;
};

type StatRankingMetric = {
  key: string;
  label: string;
  direction: "asc" | "desc";
  average: number | null;
  entries: StatRankingEntry[];
};

type StatRankingEntry = {
  teamId: string;
  teamName: string;
  rank: number;
  games: number;
  value: number | null;
};

type StatRankings = {
  sampleGames: number;
  metrics: StatRankingMetric[];
};

type DesignFlowAction = {
  label: string;
  onClick?: () => void;
  tone?: "primary" | "dark" | "ghost";
  file?: {
    accept: string;
    ariaLabel: string;
    onChange: (file: File) => void;
  };
};

type DesignFlowStep = {
  eyebrow: string;
  title: string;
  body: string;
  meta: string;
  tone: "blue" | "amber" | "emerald" | "red";
  actions?: DesignFlowAction[];
};

const flowToneClasses: Record<DesignFlowStep["tone"], string> = {
  blue: "from-blue-600/16 via-blue-500/8 to-transparent text-blue-700 ring-blue-200 dark:from-blue-500/20 dark:text-blue-200 dark:ring-blue-900/70",
  amber:
    "from-amber-500/18 via-amber-400/8 to-transparent text-amber-700 ring-amber-200 dark:from-amber-500/20 dark:text-amber-200 dark:ring-amber-900/70",
  emerald:
    "from-emerald-500/16 via-emerald-400/8 to-transparent text-emerald-700 ring-emerald-200 dark:from-emerald-500/20 dark:text-emerald-200 dark:ring-emerald-900/70",
  red: "from-red-500/16 via-red-400/8 to-transparent text-red-700 ring-red-200 dark:from-red-500/20 dark:text-red-200 dark:ring-red-900/70",
};

const flowButtonClass = (tone: DesignFlowAction["tone"] = "ghost") =>
  tone === "primary"
    ? buttonClasses.primary
    : tone === "dark"
      ? buttonClasses.dark
      : buttonClasses.ghost;

function DesignFlowPanel({
  title,
  subtitle,
  steps,
  footer,
}: {
  title: string;
  subtitle: string;
  steps: DesignFlowStep[];
  footer?: React.ReactNode;
}) {
  return (
    <section className={`${card} overflow-hidden`} aria-label={title}>
      <div className="border-b border-slate-200 bg-white px-6 py-5 dark:border-slate-800 dark:bg-slate-950">
        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
          Launch checklist
        </div>
        <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950 dark:text-white">
          {title}
        </h2>
        <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
          {subtitle}
        </p>
        {footer && <div className="mt-3">{footer}</div>}
      </div>
      <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
        {steps.map((step, index) => (
          <article
            key={step.title}
            className={`rounded-lg bg-linear-to-br ${flowToneClasses[step.tone]} p-4 ring-1`}
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-sm font-bold text-slate-950 shadow-xs ring-1 ring-white/70 dark:bg-slate-950 dark:text-white dark:ring-white/10">
                {index + 1}
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.2em] opacity-80">
                  {step.eyebrow}
                </div>
                <h3 className="mt-1 text-base font-black tracking-tight text-slate-950 dark:text-white">
                  {step.title}
                </h3>
              </div>
            </div>
            <p className="mt-4 text-sm font-bold leading-6 text-slate-600 dark:text-slate-300">
              {step.body}
            </p>
            <div className="mt-4 rounded-lg bg-white/75 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600 ring-1 ring-white/80 dark:bg-slate-950/55 dark:text-slate-300 dark:ring-white/10">
              {step.meta}
            </div>
            {step.actions && step.actions.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {step.actions.map((action) =>
                  action.file ? (
                    <label
                      key={action.label}
                      className={`inline-flex cursor-pointer ${flowButtonClass(action.tone)}`}
                    >
                      {action.label}
                      <input
                        type="file"
                        accept={action.file.accept}
                        className="hidden"
                        aria-label={action.file.ariaLabel}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) action.file?.onChange(file);
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                  ) : (
                    <button
                      key={action.label}
                      type="button"
                      onClick={action.onClick}
                      className={flowButtonClass(action.tone)}
                    >
                      {action.label}
                    </button>
                  )
                )}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function HeaderStatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-800 dark:bg-slate-950">
      <div className={`absolute inset-x-0 top-0 h-0.5 bg-linear-to-r ${accent} opacity-90`} />
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="mt-0.5 truncate text-lg font-black leading-tight tracking-tight text-slate-950 dark:text-white">
        {value}
      </div>
    </div>
  );
}

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

const TEAM_QUERY_PARAM = "team";
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

const DEMO_TEAM_NAMES = [
  "Northside Knockouts",
  "River City Rockets",
  "Metro Mashers",
  "Lakeside Legends",
  "Capital Crushers",
  "East End Eagles",
  "Westfield Whales",
  "Southtown Sluggers",
];

const buildDemoSeason = () => {
  const existingIds = new Set<string>();
  const demoTeams: TeamBase[] = DEMO_TEAM_NAMES.map((name) => ({
    id: createTeamId(name, existingIds),
    name,
  }));
  const demoMatchups: Matchup[] = [];
  const demoLogs: Record<string, GameLog> = {};
  const dates = [
    "2026-04-05",
    "2026-04-12",
    "2026-04-19",
    "2026-04-26",
    "2026-05-03",
    "2026-05-10",
    "2026-05-17",
  ];
  let gameIndex = 1;

  for (let round = 0; round < demoTeams.length - 1; round += 1) {
    for (let slot = 0; slot < demoTeams.length / 2; slot += 1) {
      const awayIndex = (round + slot) % demoTeams.length;
      const homeIndex = (demoTeams.length - 1 - slot + round) % demoTeams.length;
      if (awayIndex === homeIndex) continue;
      const away = demoTeams[awayIndex];
      const home = demoTeams[homeIndex];
      if (!away || !home) continue;
      const id = `demo-${String(gameIndex).padStart(2, "0")}`;
      demoMatchups.push({ id, date: dates[round] ?? "", away: away.id, home: home.id });

      if (gameIndex <= 18) {
        const awayRuns = 6 + ((gameIndex * 3 + awayIndex) % 9);
        const homeRuns = 5 + ((gameIndex * 5 + homeIndex) % 9);
        demoLogs[id] = {
          innings: "6",
          awayRuns: String(awayRuns === homeRuns ? awayRuns + 1 : awayRuns),
          awayHits: String(Math.max(awayRuns + 3, 8 + ((gameIndex + awayIndex) % 8))),
          awayK: String(2 + ((gameIndex + awayIndex) % 6)),
          homeRuns: String(homeRuns),
          homeHits: String(Math.max(homeRuns + 3, 8 + ((gameIndex + homeIndex) % 8))),
          homeK: String(2 + ((gameIndex + homeIndex) % 6)),
          isFinal: true,
        };
      } else {
        demoLogs[id] = blankLog();
      }
      gameIndex += 1;
    }
  }

  return {
    teams: demoTeams,
    matchups: demoMatchups,
    logs: demoLogs,
    settings: {
      ...DEFAULT_SETTINGS,
      seasonLabel: "Demo League Forecast",
      goldCutoff: 4,
      regularSeasonGamesPerTeam: demoTeams.length - 1,
    },
  };
};

const linkedTeamIdFromUrl = () => {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(TEAM_QUERY_PARAM);
};

const buildTeamDataHref = (teamId: string) => {
  const encodedTeamId = encodeURIComponent(teamId);
  if (typeof window === "undefined") return `?${TEAM_QUERY_PARAM}=${encodedTeamId}`;

  const url = new URL(window.location.href);
  url.searchParams.set(TEAM_QUERY_PARAM, teamId);
  url.hash = "";
  return `${url.pathname}${url.search}`;
};

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

type RaceTone = "clinched" | "safe" | "inside" | "bubble" | "chasing" | "out";

const raceToneForTeam = (team: TeamWithProjection, goldCutoff: number): RaceTone => {
  if (team.goldStatus === "Clinched") return "clinched";
  if (team.goldStatus === "Eliminated") return "out";
  if ((team.rank ?? 99) <= goldCutoff) {
    if (team.goldPct >= 75) return "safe";
    return "inside";
  }
  if (team.goldPct >= 25 || (team.projectedRank ?? 99) <= goldCutoff) return "bubble";
  return "chasing";
};

const raceRowToneClasses: Record<RaceTone, string> = {
  clinched:
    "bg-linear-to-r from-slate-950/8 via-slate-900/4 to-transparent ring-slate-900/20 dark:from-white/10 dark:via-white/5 dark:ring-white/15",
  safe: "bg-linear-to-r from-emerald-500/14 via-emerald-400/7 to-transparent ring-emerald-300/50 dark:from-emerald-500/18 dark:via-emerald-400/8 dark:ring-emerald-800/70",
  inside:
    "bg-linear-to-r from-blue-500/14 via-sky-400/7 to-transparent ring-blue-300/50 dark:from-blue-500/18 dark:via-sky-400/8 dark:ring-blue-800/70",
  bubble:
    "bg-linear-to-r from-amber-500/18 via-yellow-400/8 to-transparent ring-amber-300/60 dark:from-amber-500/22 dark:via-yellow-400/10 dark:ring-amber-800/70",
  chasing:
    "bg-linear-to-r from-orange-500/14 via-orange-400/7 to-transparent ring-orange-300/50 dark:from-orange-500/18 dark:via-orange-400/8 dark:ring-orange-800/70",
  out: "bg-linear-to-r from-red-500/14 via-rose-400/7 to-transparent ring-red-300/50 dark:from-red-500/18 dark:via-rose-400/8 dark:ring-red-800/70",
};

const raceSeedBadgeClasses: Record<RaceTone, string> = {
  clinched: "bg-slate-950 text-white dark:bg-white dark:text-slate-950",
  safe: "bg-emerald-600 text-white dark:bg-emerald-400 dark:text-emerald-950",
  inside: "bg-blue-600 text-white dark:bg-blue-400 dark:text-blue-950",
  bubble: "bg-amber-500 text-slate-950 dark:bg-amber-300 dark:text-amber-950",
  chasing: "bg-orange-500 text-white dark:bg-orange-300 dark:text-orange-950",
  out: "bg-red-600 text-white dark:bg-red-400 dark:text-red-950",
};

const TIEBREAKER_FACTORS: TiebreakerFactor[] = [
  "headToHead",
  "runDifferential",
  "runsAgainst",
  "runsFor",
];
type TiebreakerSelectValue = TiebreakerFactor | "none";

// ---------- Helpers that depend on app-shape but no state ----------

const projectedRunLine = (prediction: Prediction, byId: Map<string, Team>) => {
  const favorite = byId.get(prediction.winnerId);
  const favoriteName = favorite ? displayName(favorite.name) : prediction.winnerId;
  const rawMargin = Math.abs(prediction.awayScore - prediction.homeScore);
  const halfRunLine = Math.max(0.5, rawMargin - 0.5);
  return `${favoriteName} -${halfRunLine.toFixed(1)}`;
};

const upsetRiskLabel = (winnerPct: number, margin: number) => {
  if (winnerPct < 0.58 || margin <= 2) return "High";
  if (winnerPct < 0.7 || margin <= 5) return "Medium";
  return "Low";
};

const calcBip = (hits: string, runs: string, strikeouts: string, innings: string) => {
  const h = parseNumber(hits, NaN);
  const r = parseNumber(runs, NaN);
  const k = parseNumber(strikeouts, 0);
  const inn = parseNumber(innings, 6);
  const contact = Number.isFinite(h) ? h : Number.isFinite(r) ? r : 0;
  return contact + inn * 3 - k;
};

const emptySplitLine = (label: string): TeamSplitLine => ({
  label,
  games: 0,
  offense: { runs: 0, hits: 0, strikeouts: 0, walks: 0 },
  defense: { runs: 0, hits: 0, strikeouts: 0, errors: 0, walks: 0 },
});

const addSplitGame = (
  line: TeamSplitLine,
  offense: { runs: number; hits: number; strikeouts: number; walks: number },
  defense: { runs: number; hits: number; strikeouts: number; errors: number; walks: number }
) => {
  line.games += 1;
  line.offense.runs += offense.runs;
  line.offense.hits += offense.hits;
  line.offense.strikeouts += offense.strikeouts;
  line.offense.walks += offense.walks;
  line.defense.runs += defense.runs;
  line.defense.hits += defense.hits;
  line.defense.strikeouts += defense.strikeouts;
  line.defense.errors += defense.errors;
  line.defense.walks += defense.walks;
};

const buildTeamSplitSummary = (
  teamId: string,
  matchups: Matchup[],
  logs: Record<string, GameLog>
): TeamSplitSummary => {
  const summary: TeamSplitSummary = {
    all: emptySplitLine("Overall"),
    home: emptySplitLine("Home"),
    away: emptySplitLine("Away"),
  };

  matchups.forEach((game) => {
    if (game.away !== teamId && game.home !== teamId) return;
    const log = logs[game.id];
    if (!log || !isFinal(log)) return;

    const isAway = game.away === teamId;
    const offense = isAway
      ? {
          runs: parseNumber(log.awayRuns),
          hits: parseNumber(log.awayHits),
          strikeouts: parseNumber(log.awayK),
          walks: parseNumber(log.homeWalksAllowed ?? ""),
        }
      : {
          runs: parseNumber(log.homeRuns),
          hits: parseNumber(log.homeHits),
          strikeouts: parseNumber(log.homeK),
          walks: parseNumber(log.awayWalksAllowed ?? ""),
        };
    const defense = isAway
      ? {
          runs: parseNumber(log.homeRuns),
          hits: parseNumber(log.homeHits),
          strikeouts: parseNumber(log.homeK),
          errors: parseNumber(log.awayErrors ?? ""),
          walks: parseNumber(log.awayWalksAllowed ?? ""),
        }
      : {
          runs: parseNumber(log.awayRuns),
          hits: parseNumber(log.awayHits),
          strikeouts: parseNumber(log.awayK),
          errors: parseNumber(log.homeErrors ?? ""),
          walks: parseNumber(log.homeWalksAllowed ?? ""),
        };

    addSplitGame(summary.all, offense, defense);
    addSplitGame(isAway ? summary.away : summary.home, offense, defense);
  });

  return summary;
};

const gameSortValue = (game: Matchup) => parseDateValue(game.date);

const averageRecent = (values: number[], window: number) => {
  if (!values.length) return null;
  const sample = values.slice(-window);
  return sample.reduce((sum, value) => sum + value, 0) / sample.length;
};

const trendStatusFor = (
  delta: number | null,
  direction: TeamTrendMetric["direction"],
  threshold: number
): TeamTrendMetric["status"] => {
  if (delta === null) return "No data";
  if (Math.abs(delta) < threshold) return "Steady";
  const isBetter = direction === "higher" ? delta > 0 : delta < 0;
  return isBetter ? "Hot" : "Cold";
};

const buildTeamTrendSummary = (
  teamId: string,
  matchups: Matchup[],
  logs: Record<string, GameLog>
): TeamTrendSummary => {
  const games = matchups
    .filter((game) => game.away === teamId || game.home === teamId)
    .filter((game) => isFinal(logs[game.id]))
    .sort((a, b) => {
      const dateDiff = gameSortValue(a) - gameSortValue(b);
      return dateDiff === 0 ? a.id.localeCompare(b.id) : dateDiff;
    })
    .map<TeamTrendGame>((game, index) => {
      const log = logs[game.id] ?? blankLog();
      const isAway = game.away === teamId;
      const date = game.date ? formatGameDate(game.date) : `Game ${index + 1}`;

      return {
        id: game.id,
        date: game.date,
        label: date,
        runsFor: parseNumber(isAway ? log.awayRuns : log.homeRuns),
        hitsFor: parseNumber(isAway ? log.awayHits : log.homeHits),
        runsAgainst: parseNumber(isAway ? log.homeRuns : log.awayRuns),
        hitsAgainst: parseNumber(isAway ? log.homeHits : log.awayHits),
      };
    });

  const recentWindow = Math.min(3, games.length);
  const metricConfigs: Array<{
    key: string;
    label: string;
    shortLabel: string;
    direction: TeamTrendMetric["direction"];
    threshold: number;
    value: (game: TeamTrendGame) => number;
  }> = [
    {
      key: "runs-for",
      label: "Runs scored",
      shortLabel: "R/G",
      direction: "higher",
      threshold: 0.5,
      value: (game) => game.runsFor,
    },
    {
      key: "hits-for",
      label: "Hits",
      shortLabel: "H/G",
      direction: "higher",
      threshold: 0.75,
      value: (game) => game.hitsFor,
    },
    {
      key: "runs-against",
      label: "Runs allowed",
      shortLabel: "RA/G",
      direction: "lower",
      threshold: 0.5,
      value: (game) => game.runsAgainst,
    },
    {
      key: "hits-against",
      label: "Hits allowed",
      shortLabel: "HA/G",
      direction: "lower",
      threshold: 0.75,
      value: (game) => game.hitsAgainst,
    },
  ];

  const metrics = metricConfigs.map<TeamTrendMetric>((config) => {
    const values = games.map(config.value);
    const season = averageRecent(values, values.length);
    const recent = recentWindow ? averageRecent(values, recentWindow) : null;
    const delta = season === null || recent === null ? null : recent - season;

    return {
      key: config.key,
      label: config.label,
      shortLabel: config.shortLabel,
      direction: config.direction,
      season,
      recent,
      delta,
      status: trendStatusFor(delta, config.direction, config.threshold),
      values,
    };
  });

  const hotCount = metrics.filter((metric) => metric.status === "Hot").length;
  const coldCount = metrics.filter((metric) => metric.status === "Cold").length;
  const headline =
    games.length < 2
      ? "Need more finals for a real trend."
      : hotCount > coldCount
        ? "Heating up"
        : coldCount > hotCount
          ? "Cooling off"
          : "Holding steady";

  return { games, recentWindow, metrics, headline };
};

const buildLeagueAverageStats = (
  matchups: Matchup[],
  logs: Record<string, GameLog>
): LeagueAverageStats => {
  return matchups.reduce<LeagueAverageStats>(
    (totals, game) => {
      const log = logs[game.id];
      if (!log || !isFinal(log)) return totals;

      totals.completedGames += 1;
      totals.teamGames += 2;
      totals.runs += parseNumber(log.awayRuns) + parseNumber(log.homeRuns);
      totals.hits += parseNumber(log.awayHits) + parseNumber(log.homeHits);
      totals.strikeouts += parseNumber(log.awayK) + parseNumber(log.homeK);
      totals.errors += parseNumber(log.awayErrors ?? "") + parseNumber(log.homeErrors ?? "");
      totals.walks +=
        parseNumber(log.awayWalksAllowed ?? "") + parseNumber(log.homeWalksAllowed ?? "");
      return totals;
    },
    { completedGames: 0, teamGames: 0, runs: 0, hits: 0, strikeouts: 0, errors: 0, walks: 0 }
  );
};

const buildTeamStatRankings = (
  teams: TeamBase[],
  matchups: Matchup[],
  logs: Record<string, GameLog>,
  pitchMode: PitchMode,
  trackErrors: boolean
): StatRankings => {
  const summaries = teams.map((team) => ({
    team,
    line: buildTeamSplitSummary(team.id, matchups, logs).all,
  }));

  const rankedEntries = (
    valueForLine: (line: TeamSplitLine) => number,
    direction: "asc" | "desc"
  ): StatRankingEntry[] =>
    summaries
      .map(({ team, line }) => ({
        teamId: team.id,
        teamName: team.name,
        games: line.games,
        value: line.games > 0 ? valueForLine(line) / line.games : null,
      }))
      .sort((a, b) => {
        if (a.value === null && b.value === null) return a.teamName.localeCompare(b.teamName);
        if (a.value === null) return 1;
        if (b.value === null) return -1;
        const valueDiff = direction === "asc" ? a.value - b.value : b.value - a.value;
        if (Math.abs(valueDiff) > 0.0001) return valueDiff;
        return a.teamName.localeCompare(b.teamName);
      })
      .map((entry, index) => ({ ...entry, rank: index + 1 }));

  const averageFor = (valueForLine: (line: TeamSplitLine) => number): number | null => {
    const totals = summaries.reduce(
      (acc, { line }) => {
        if (line.games === 0) return acc;
        acc.value += valueForLine(line);
        acc.games += line.games;
        return acc;
      },
      { value: 0, games: 0 }
    );

    return totals.games > 0 ? totals.value / totals.games : null;
  };

  const sampleGames = matchups.filter((game) => isFinal(logs[game.id])).length;

  const baseMetrics: StatRankingMetric[] = [
    {
      key: "runs-scored",
      label: "R/G",
      direction: "desc",
      average: averageFor((line) => line.offense.runs),
      entries: rankedEntries((line) => line.offense.runs, "desc"),
    },
    {
      key: "hits",
      label: "H/G",
      direction: "desc",
      average: averageFor((line) => line.offense.hits),
      entries: rankedEntries((line) => line.offense.hits, "desc"),
    },
  ];

  const modeMetrics: StatRankingMetric[] =
    pitchMode === "player"
      ? [
          {
            key: "walks-drawn",
            label: "BB/G",
            direction: "desc",
            average: averageFor((line) => line.offense.walks),
            entries: rankedEntries((line) => line.offense.walks, "desc"),
          },
          ...(trackErrors
            ? [
                {
                  key: "errors",
                  label: "E/G",
                  direction: "asc" as const,
                  average: averageFor((line) => line.defense.errors),
                  entries: rankedEntries((line) => line.defense.errors, "asc"),
                },
              ]
            : []),
        ]
      : [
          {
            key: "least-strikeouts",
            label: "K/G",
            direction: "asc",
            average: averageFor((line) => line.offense.strikeouts),
            entries: rankedEntries((line) => line.offense.strikeouts, "asc"),
          },
          {
            key: "opponent-strikeouts",
            label: "Opp K/G",
            direction: "desc",
            average: averageFor((line) => line.defense.strikeouts),
            entries: rankedEntries((line) => line.defense.strikeouts, "desc"),
          },
        ];

  return {
    sampleGames,
    metrics: [
      ...baseMetrics,
      ...modeMetrics,
      {
        key: "runs-allowed",
        label: "RA/G",
        direction: "asc",
        average: averageFor((line) => line.defense.runs),
        entries: rankedEntries((line) => line.defense.runs, "asc"),
      },
      {
        key: pitchMode === "player" ? "walks-allowed" : "hits-allowed",
        label: pitchMode === "player" ? "BB Allowed/G" : "HA/G",
        direction: "asc",
        average: averageFor((line) =>
          pitchMode === "player" ? line.defense.walks : line.defense.hits
        ),
        entries: rankedEntries(
          (line) => (pitchMode === "player" ? line.defense.walks : line.defense.hits),
          "asc"
        ),
      },
    ],
  };
};

const perGame = (value: number, games: number) => (games ? (value / games).toFixed(1) : "—");

// ---------- Subcomponents ----------

const Sparkline = React.memo(function Sparkline({ values }: { values: number[] }) {
  if (!values.length) return <span className="text-slate-500">—</span>;
  const width = 108;
  const height = 30;
  const seed = values[0] ?? 0;
  const data = values.length === 1 ? [seed, seed] : values;
  const points = data
    .map((value, index) => {
      const x = (index / Math.max(data.length - 1, 1)) * width;
      const y = height - (clamp(value, 0, 100) / 100) * height;
      return `${x},${y}`;
    })
    .join(" ");

  const last = data[data.length - 1] ?? 0;
  const tone =
    last >= 75 ? "stroke-emerald-500" : last >= 40 ? "stroke-blue-500" : "stroke-slate-500";

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
      role="img"
      aria-label={`Gold odds trend over recent completed games. Starts at ${Math.round(data[0] ?? 0)}%, ends at ${Math.round(last)}%.`}
    >
      <title>{`Gold odds over recent completed games: ${Math.round(data[0] ?? 0)}% to ${Math.round(last)}%. Higher is better.`}</title>
      <polyline
        points={points}
        fill="none"
        className={tone}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={width}
        cy={height - (clamp(last, 0, 100) / 100) * height}
        r="3"
        className={tone.replace("stroke", "fill")}
      />
    </svg>
  );
});

function GameDateInput({
  value,
  onCommit,
  ariaLabel,
}: {
  value: string;
  onCommit: (value: string) => void;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(value || "");

  useEffect(() => {
    setDraft(value || "");
  }, [value]);

  const commit = () => {
    const normalized = normalizeDateInput(draft);
    onCommit(normalized);
    setDraft(normalized);
  };

  return (
    <input
      type="text"
      inputMode="text"
      placeholder="5/1"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      className="w-28 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-bold text-slate-950 outline-hidden focus:border-slate-950 focus:ring-2 focus:ring-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white dark:focus:ring-slate-700"
      aria-label={ariaLabel ?? "Game date in M/D format"}
    />
  );
}

function DrawerMetric({ label, value }: { label: React.ReactNode; value: string | number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-700 dark:bg-slate-900">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="mt-1 text-lg font-black text-slate-950 dark:text-slate-100">{value}</div>
    </div>
  );
}

function SplitStatsTable({
  title,
  lines,
  side,
  pitchMode,
  trackErrors,
}: {
  title: string;
  lines: TeamSplitLine[];
  side: "offense" | "defense";
  pitchMode: PitchMode;
  trackErrors: boolean;
}) {
  // The kid-pitch defensive column is E/G, which is empty when errors are not scored.
  const showModeColumn = !(pitchMode === "player" && side === "defense" && !trackErrors);

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xs dark:border-slate-700 dark:bg-slate-900">
      <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
        <h4 className="text-sm font-bold tracking-tight text-slate-950 dark:text-slate-100">
          {title}
        </h4>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-4 py-2">Split</th>
              <th className="px-3 py-2 text-center">G</th>
              <th className="px-3 py-2 text-center">R/G</th>
              <th className="px-3 py-2 text-center">H/G</th>
              {showModeColumn && (
                <th className="px-3 py-2 text-center">
                  {pitchMode === "player" ? (side === "offense" ? "BB/G" : "E/G") : "K/G"}
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-800 dark:divide-slate-800 dark:text-slate-100">
            {lines.map((line) => (
              <tr key={`${title}-${line.label}`}>
                <td className="px-4 py-3 font-black">{line.label}</td>
                <td className="px-3 py-3 text-center font-bold">{line.games}</td>
                <td className="px-3 py-3 text-center font-bold">
                  {perGame(line[side].runs, line.games)}
                </td>
                <td className="px-3 py-3 text-center font-bold">
                  {perGame(line[side].hits, line.games)}
                </td>
                {showModeColumn && (
                  <td className="px-3 py-3 text-center font-bold">
                    {pitchMode === "player"
                      ? perGame(
                          side === "offense" ? line.offense.walks : line.defense.errors,
                          line.games
                        )
                      : perGame(line[side].strikeouts, line.games)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TeamStatTrendSparkline({
  values,
  lowerIsBetter,
}: {
  values: number[];
  lowerIsBetter: boolean;
}) {
  if (!values.length) return <span className="text-slate-500">—</span>;

  const width = 130;
  const height = 34;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(max - min, 1);
  const seed = values[0] ?? 0;
  const data = values.length === 1 ? [seed, seed] : values;
  const points = data
    .map((value, index) => {
      const x = (index / Math.max(data.length - 1, 1)) * width;
      const y = height - ((value - min) / spread) * height;
      return `${x},${y}`;
    })
    .join(" ");
  const first = data[0] ?? 0;
  const last = data[data.length - 1] ?? 0;
  const improved = lowerIsBetter ? last < first : last > first;
  const tone = improved
    ? "stroke-emerald-500"
    : last === first
      ? "stroke-slate-500"
      : "stroke-amber-500";

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
      role="img"
      aria-label={`Trend from ${first.toFixed(1)} to ${last.toFixed(1)}.`}
    >
      <title>{`Game-by-game trend: ${first.toFixed(1)} to ${last.toFixed(1)}.`}</title>
      <polyline
        points={points}
        fill="none"
        className={tone}
        strokeWidth="2.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={width}
        cy={height - ((last - min) / spread) * height}
        r="3.5"
        className={tone.replace("stroke", "fill")}
      />
    </svg>
  );
}

function TeamTrendPanel({ trend }: { trend: TeamTrendSummary }) {
  const formatDelta = (metric: TeamTrendMetric) => {
    if (metric.delta === null) return "—";
    const value = Math.abs(metric.delta).toFixed(1);
    if (Math.abs(metric.delta) < 0.05) return "even";
    const better = metric.direction === "higher" ? metric.delta > 0 : metric.delta < 0;
    return `${better ? "+" : "−"}${value} ${better ? "better" : "worse"}`;
  };

  const statusClass = (status: TeamTrendMetric["status"]) =>
    status === "Hot"
      ? "bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:ring-emerald-800"
      : status === "Cold"
        ? "bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:ring-amber-800"
        : "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700";

  return (
    <section className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-slate-950 text-white shadow-xs dark:border-slate-700">
      <div className="relative isolate p-4">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.25),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.22),transparent_42%)]" />
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-amber-200">
              Current Form
            </div>
            <h3 className="text-xl font-black tracking-tight">{trend.headline}</h3>
          </div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-300">
            Last {trend.recentWindow || 0} vs season
          </div>
        </div>
      </div>

      <div className="grid gap-3 bg-white p-3 text-slate-950 dark:bg-slate-900 dark:text-slate-100">
        {trend.metrics.map((metric) => (
          <article
            key={metric.key}
            className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-bold tracking-tight">{metric.label}</div>
                <div className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">
                  Season {metric.season?.toFixed(1) ?? "—"} {metric.shortLabel} · Recent{" "}
                  {metric.recent?.toFixed(1) ?? "—"}
                </div>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ring-1 ${statusClass(
                  metric.status
                )}`}
              >
                {metric.status}
              </span>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <TeamStatTrendSparkline
                values={metric.values}
                lowerIsBetter={metric.direction === "lower"}
              />
              <div className="text-right text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {formatDelta(metric)}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function StatRankingsPanel({ rankings }: { rankings: StatRankings }) {
  const averageSeparator = (metric: StatRankingMetric) => (
    <li
      key={`${metric.key}-league-average`}
      aria-label={`League average for ${metric.label}`}
      className="flex items-center gap-3 bg-slate-200/80 px-4 py-2 text-slate-700 dark:bg-slate-700/80 dark:text-slate-200"
    >
      <div className="h-px flex-1 bg-slate-400/70 dark:bg-slate-500/80" />
      <div className="flex shrink-0 items-center gap-2 rounded-full bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-wide shadow-xs ring-1 ring-slate-300 dark:bg-slate-900 dark:ring-slate-600">
        <span>League Avg</span>
        <span className="tabular-nums">{metric.average?.toFixed(1)}</span>
      </div>
      <div className="h-px flex-1 bg-slate-400/70 dark:bg-slate-500/80" />
    </li>
  );

  const averageInsertIndex = (metric: StatRankingMetric) => {
    if (metric.average === null) return -1;

    const nullIndex = metric.entries.findIndex((entry) => entry.value === null);
    const fallbackIndex = nullIndex === -1 ? metric.entries.length : nullIndex;
    const worseIndex = metric.entries.findIndex((entry) => {
      if (entry.value === null || metric.average === null) return false;
      return metric.direction === "asc"
        ? entry.value > metric.average
        : entry.value < metric.average;
    });

    return worseIndex === -1 ? fallbackIndex : worseIndex;
  };

  return (
    <section className="bg-white p-5 dark:bg-slate-900">
      <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Team Stats
          </div>
          <h2 className="text-xl font-black tracking-tight text-slate-950 dark:text-slate-100">
            Per-Game Rankings
          </h2>
        </div>
        <div className="text-xs font-bold text-slate-500 dark:text-slate-400">
          Based on {rankings.sampleGames} completed games
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
        {rankings.metrics.map((metric) => (
          <div
            key={metric.key}
            className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50 shadow-xs dark:border-slate-700 dark:bg-slate-800/60"
          >
            <div className="border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
              <h3 className="text-sm font-bold tracking-tight text-slate-950 dark:text-slate-100">
                {metric.label}
              </h3>
            </div>
            {metric.entries.length > 0 ? (
              <ol className="divide-y divide-slate-200 dark:divide-slate-700">
                {metric.entries.map((entry, index) => (
                  <React.Fragment key={`${metric.key}-${entry.teamId}`}>
                    {averageInsertIndex(metric) === index ? averageSeparator(metric) : null}
                    <li className="flex items-center gap-3 px-4 py-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-950 text-xs font-semibold text-white dark:bg-white dark:text-slate-950">
                        {entry.rank}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-bold text-slate-950 dark:text-slate-100">
                          {displayName(entry.teamName)}
                        </div>
                        <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                          {entry.games} games
                        </div>
                      </div>
                      <div className="text-lg font-black tabular-nums text-slate-950 dark:text-slate-100">
                        {entry.value === null ? "—" : entry.value.toFixed(1)}
                      </div>
                    </li>
                  </React.Fragment>
                ))}
                {averageInsertIndex(metric) === metric.entries.length
                  ? averageSeparator(metric)
                  : null}
              </ol>
            ) : (
              <div className="px-4 py-6 text-center text-sm font-bold text-slate-500 dark:text-slate-400">
                No teams added yet.
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

type ScoreRowProps = {
  teamName: string;
  prefix: "away" | "home";
  log: GameLog;
  onChange: (field: keyof GameLog, value: string) => void;
  pitchMode: PitchMode;
  trackErrors: boolean;
};

const ScoreRow = React.memo(function ScoreRow({
  teamName,
  prefix,
  log,
  onChange,
  pitchMode,
  trackErrors,
}: ScoreRowProps) {
  const fields = useMemo(
    () => [
      { key: `${prefix}Runs` as keyof GameLog, label: "R", aria: "Runs" },
      { key: `${prefix}Hits` as keyof GameLog, label: "H", aria: "Hits" },
      ...(pitchMode === "player"
        ? [
            ...(trackErrors
              ? [{ key: `${prefix}Errors` as keyof GameLog, label: "E", aria: "Errors" }]
              : []),
            {
              key: `${prefix === "away" ? "home" : "away"}WalksAllowed` as keyof GameLog,
              label: "BB",
              aria: "Walks",
            },
          ]
        : [{ key: `${prefix}K` as keyof GameLog, label: "K", aria: "Strikeouts" }]),
    ],
    [pitchMode, prefix, trackErrors]
  );
  const display = displayName(teamName);
  const abbr = teamAbbr(teamName);
  const inputRefs = useRef<Partial<Record<keyof GameLog, HTMLInputElement | null>>>({});
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    fields.forEach((field) => {
      const input = inputRefs.current[field.key];
      if (!input || document.activeElement === input) return;
      const nextValue = String(log[field.key] ?? "");
      if (input.value !== nextValue) input.value = nextValue;
    });
  }, [fields, log]);

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-950 text-xs font-semibold text-white sm:h-10 sm:w-10">
          {abbr}
        </div>
        <div className="truncate font-bold" title={teamName}>
          {display}
        </div>
      </div>
      <div className="flex gap-2 pl-11 sm:pl-0">
        {fields.map((field, index) => (
          <label
            key={field.key}
            className="text-center text-[10px] font-semibold uppercase text-slate-500"
          >
            {field.label}
            <input
              ref={(node) => {
                inputRefs.current[field.key] = node;
              }}
              defaultValue={String(log[field.key] ?? "")}
              onChange={(event) => {
                const digits = event.currentTarget.value.replace(/[^0-9]/g, "").slice(0, 2);
                const isRunsField = field.key === "awayRuns" || field.key === "homeRuns";
                const next =
                  isRunsField && Number(digits) > RUN_SCORE_CAP ? String(RUN_SCORE_CAP) : digits;
                if (event.currentTarget.value !== next) event.currentTarget.value = next;
                startTransition(() => {
                  onChangeRef.current(field.key, next);
                });
              }}
              onKeyDown={(event) => {
                // Most scores are one digit, so a length-based jump fires on
                // "10" but not on "7". Enter advances instead: it is the same
                // keystroke every time, and it never moves focus unasked.
                if (event.key !== "Enter") return;
                const nextField = fields[index + 1];
                if (!nextField) return;
                event.preventDefault();
                inputRefs.current[nextField.key]?.focus();
              }}
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={2}
              aria-label={`${display} ${field.aria}`}
              className="mt-1 block h-10 w-11 rounded-lg border border-slate-300 bg-white text-center text-base font-black text-slate-950 outline-hidden focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
            />
          </label>
        ))}
      </div>
    </div>
  );
}, areScoreRowPropsEqual);

function areScoreRowPropsEqual(previous: ScoreRowProps, next: ScoreRowProps) {
  return (
    previous.teamName === next.teamName &&
    previous.prefix === next.prefix &&
    previous.log === next.log &&
    previous.pitchMode === next.pitchMode
  );
}

function BracketScoreInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-center text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
      {label}
      <input
        value={value}
        onChange={(event) => {
          const digits = event.target.value.replace(/[^0-9]/g, "").slice(0, 2);
          onChange(Number(digits) > RUN_SCORE_CAP ? String(RUN_SCORE_CAP) : digits);
        }}
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={2}
        className="mt-1 block h-10 w-12 rounded-lg border border-slate-300 bg-white text-center text-base font-black text-slate-950 outline-hidden focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
      />
    </label>
  );
}

function BracketTeamLine({
  slot,
  score,
  isWinner,
  sourceLabel,
  onScoreChange,
}: {
  slot: BracketGameProjection["top"];
  score: string;
  isWinner: boolean;
  sourceLabel: "Projected" | "Actual" | "Bye" | "";
  onScoreChange: (value: string) => void;
}) {
  const team = slot.team;
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${
        isWinner
          ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"
          : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
      }`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="rounded-lg bg-slate-950 px-2 py-1 text-[10px] font-semibold text-white">
            {slot.seed ? `#${slot.seed}` : "—"}
          </span>
          <span className="truncate text-sm font-bold text-slate-950 dark:text-slate-100">
            {team ? displayName(team.name) : slot.sourceGameId ? "Awaiting previous game" : "Bye"}
          </span>
        </div>
        <div className="mt-1 text-[11px] font-bold text-slate-500 dark:text-slate-400">
          {team
            ? `${`Seed #${slot.seed}`}${sourceLabel ? ` · ${sourceLabel}` : ""}`
            : slot.sourceGameId
              ? `Winner of ${slot.sourceGameId.toUpperCase()}`
              : "Automatic advance"}
        </div>
      </div>
      {team && <BracketScoreInput label="R" value={score} onChange={onScoreChange} />}
    </div>
  );
}

const winnerLabelForTeam = (
  source: BracketGameProjection["winnerSource"]
): "Projected" | "Actual" | "Bye" | "" => {
  if (source === "actual") return "Actual";
  if (source === "projected") return "Projected";
  if (source === "bye") return "Bye";
  return "";
};

function BracketGameCard({
  game,
  onScoreChange,
  onToggleFinal,
}: {
  game: BracketGameProjection;
  onScoreChange: (gameId: string, field: keyof GameLog, value: string | boolean) => void;
  onToggleFinal: (gameId: string) => void;
}) {
  const topWinner = !!game.top.team && game.winnerId === game.top.team.id;
  const bottomWinner = !!game.bottom.team && game.winnerId === game.bottom.team.id;
  const winnerLabel =
    game.winnerSource === "actual"
      ? "Actual winner"
      : game.winnerSource === "bye"
        ? "Bye advance"
        : game.winnerSource === "projected"
          ? "Model pick"
          : "Pending";
  const pickPct =
    game.prediction && game.predictedWinnerId
      ? game.predictedWinnerId === game.matchup?.away
        ? game.prediction.awayWinPct
        : 1 - game.prediction.awayWinPct
      : null;
  const hasPlayableTeams = !!game.top.team && !!game.bottom.team;

  return (
    <article className="min-w-[260px] rounded-lg border border-slate-200 bg-slate-50 p-3 shadow-xs dark:border-slate-700 dark:bg-slate-800">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Game {game.gameIndex + 1}
          </div>
          <div className="text-sm font-bold text-slate-950 dark:text-slate-100">{winnerLabel}</div>
        </div>
        {hasPlayableTeams && (
          <button
            type="button"
            onClick={() => onToggleFinal(game.id)}
            className={`rounded-lg px-3 py-1 text-xs font-black ${
              game.log.isFinal ? "bg-emerald-600 text-white" : "bg-slate-950 text-white"
            }`}
          >
            {game.log.isFinal ? "Final" : "Set Final"}
          </button>
        )}
      </div>

      <div className="space-y-2">
        <BracketTeamLine
          slot={game.top}
          score={game.log.homeRuns}
          isWinner={topWinner}
          sourceLabel={topWinner ? winnerLabelForTeam(game.winnerSource) : ""}
          onScoreChange={(value) => onScoreChange(game.id, "homeRuns", value)}
        />
        <BracketTeamLine
          slot={game.bottom}
          score={game.log.awayRuns}
          isWinner={bottomWinner}
          sourceLabel={bottomWinner ? winnerLabelForTeam(game.winnerSource) : ""}
          onScoreChange={(value) => onScoreChange(game.id, "awayRuns", value)}
        />
      </div>

      {game.prediction && pickPct !== null && (
        <div className="mt-3 rounded-lg bg-white p-3 text-xs font-bold text-slate-600 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700">
          Model score: {game.prediction.awayScore}-{game.prediction.homeScore} ·{" "}
          {Math.round(pickPct * 100)}% win chance for the bracket pick
        </div>
      )}
    </article>
  );
}

function BracketPredictionPanel({
  title,
  emptyMessage,
  championLabel,
  projection,
  onScoreChange,
  onToggleFinal,
  onClearScores,
}: {
  title: string;
  emptyMessage: string;
  championLabel: string;
  projection: ReturnType<typeof buildBracketProjection>;
  onScoreChange: (gameId: string, field: keyof GameLog, value: string | boolean) => void;
  onToggleFinal: (gameId: string) => void;
  onClearScores: (gameIds: string[], label: string) => void;
}) {
  const bracketGames = projection.rounds.flat();
  const savedGames = bracketGames.filter(
    (game) =>
      game.log.isFinal ||
      game.log.awayRuns !== "" ||
      game.log.homeRuns !== "" ||
      game.log.awayHits !== "" ||
      game.log.homeHits !== ""
  ).length;
  const champion = projection.champion;
  return (
    <section className={`${card} p-5`} aria-label="Bracket prediction model">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-100">
            {title}
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {projection.entrantCount} teams · {projection.size}-slot bracket
          </span>
          <button
            type="button"
            onClick={() =>
              onClearScores(
                bracketGames.map((game) => game.id),
                title
              )
            }
            disabled={savedGames === 0}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 shadow-xs hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            Clear bracket scores
          </button>
        </div>
      </div>

      {projection.rounds.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm font-bold text-slate-500 dark:border-slate-600 dark:bg-slate-800/40 dark:text-slate-400">
          {emptyMessage}
        </div>
      ) : (
        <>
          <div className="mb-4 rounded-lg bg-slate-950 p-4 text-white">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-300">
              {championLabel}
            </div>
            <div className="mt-1 text-2xl font-black">
              {champion ? displayName(champion.name) : "Pending"}
            </div>
          </div>
          <div className="overflow-x-auto pb-2">
            <div
              className="grid min-w-max gap-4"
              style={{
                gridTemplateColumns: `repeat(${projection.rounds.length}, minmax(280px, 1fr))`,
              }}
            >
              {projection.rounds.map((round) => (
                <div key={round[0]?.roundName ?? "round"} className="space-y-4">
                  <div className="sticky left-0 rounded-lg bg-slate-100 px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {round[0]?.roundName}
                  </div>
                  <div className="space-y-4">
                    {round.map((game) => (
                      <BracketGameCard
                        key={game.id}
                        game={game}
                        onScoreChange={(gameId, field, value) =>
                          onScoreChange(gameId, field, value)
                        }
                        onToggleFinal={onToggleFinal}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

// ---------- TeamDrawer (a11y modal) ----------

function TeamDrawer({
  team,
  range,
  bubble,
  currentSosRank,
  sos,
  swings,
  clinchScenarios,
  titleRace,
  goldPctLabel,
  cutoff,
  onClose,
  magicForGold,
  eliminationNumber,
  splitSummary,
  trendSummary,
  onCompare,
  leagueAverageStats,
  pitchMode,
  trackErrors,
  hasCutLine,
  projectionExplanations,
}: {
  team: TeamWithProjection;
  range: { best: number; worst: number; baseline: number };
  bubble: string;
  currentSosRank: number | null;
  sos: { label: string; rating: number; opponents: string };
  swings: SwingGame[];
  clinchScenarios: string[];
  titleRace: string;
  goldPctLabel: string;
  cutoff: number;
  onClose: () => void;
  magicForGold: import("./lib/magic").MagicResult;
  eliminationNumber: import("./lib/magic").MagicResult;
  splitSummary: TeamSplitSummary;
  trendSummary: TeamTrendSummary;
  onCompare: () => void;
  leagueAverageStats: LeagueAverageStats;
  pitchMode: PitchMode;
  trackErrors: boolean;
  hasCutLine: boolean;
  projectionExplanations: string[];
}) {
  const ref = useRef<HTMLElement>(null);
  const titleId = useId();
  useFocusTrap(true, ref as React.RefObject<HTMLElement>);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/40 p-3"
      onClick={onClose}
      role="presentation"
    >
      {/* Stop click + keydown propagation so the backdrop's onClose doesn't fire from inside the dialog. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <aside
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="h-full w-full max-w-md overflow-y-auto rounded-lg bg-white p-6 shadow-2xl outline-hidden dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Team Detail
            </div>
            <h2
              id={titleId}
              className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-slate-100"
            >
              {displayName(team.name)}
            </h2>
            <div className="mt-2 text-sm font-bold text-slate-500 dark:text-slate-400">
              Current #{team.rank} · Projected #{team.projectedRank}
              {hasCutLine ? ` · Top ${cutoff} Gold Bracket` : ""}
            </div>
            {projectionExplanations.length > 0 && (
              <div className="mt-3 rounded-lg border-l-2 border-blue-400 bg-blue-50 py-1 pl-3 pr-2 dark:border-blue-500 dark:bg-blue-950/30">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-300">
                  Since the last update
                </div>
                <ProjectionExplanation explanations={projectionExplanations} />
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={onCompare}
              className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950"
            >
              Compare
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Close
            </button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <DrawerMetric label="Record" value={recordText(team)} />
          {hasCutLine && <DrawerMetric label="Gold %" value={goldPctLabel} />}
          <DrawerMetric label="Range" value={`#${range.best}–#${range.worst}`} />
          {hasCutLine && <DrawerMetric label="Bubble" value={bubble} />}
          <DrawerMetric label="Runs/Game" value={team.rsg.toFixed(1)} />
          <DrawerMetric label="Hits/Game" value={team.hpg.toFixed(1)} />
          {pitchMode === "player" ? (
            <>
              {trackErrors && (
                <DrawerMetric label="Errors/Game" value={(team.errorsPerGame ?? 0).toFixed(1)} />
              )}
              <DrawerMetric label="BB/Game" value={(team.walksReceivedPerGame ?? 0).toFixed(1)} />
            </>
          ) : (
            <>
              <DrawerMetric label="K/Game" value={team.kpg.toFixed(1)} />
              <DrawerMetric label="Opp K/Game" value={team.oppKpg.toFixed(1)} />
            </>
          )}
          <DrawerMetric
            label="Lg Avg R/G"
            value={perGame(leagueAverageStats.runs, leagueAverageStats.teamGames)}
          />
          <DrawerMetric
            label="Lg Avg H/G"
            value={perGame(leagueAverageStats.hits, leagueAverageStats.teamGames)}
          />
          {(pitchMode !== "player" || trackErrors) && (
            <DrawerMetric
              label={pitchMode === "player" ? "Lg Avg E/G" : "Lg Avg K/G"}
              value={
                pitchMode === "player"
                  ? perGame(leagueAverageStats.errors, leagueAverageStats.teamGames)
                  : perGame(leagueAverageStats.strikeouts, leagueAverageStats.teamGames)
              }
            />
          )}
          <DrawerMetric label="Current SOS" value={currentSosRank ? `#${currentSosRank}` : "—"} />
          <DrawerMetric label="Remaining SOS" value={sos.label} />
          {titleRace && <DrawerMetric label="Title Race" value={titleRace} />}
        </div>

        <TeamTrendPanel trend={trendSummary} />

        <section className="mt-6 space-y-3">
          <div>
            <h3 className="font-black tracking-tight text-slate-950 dark:text-slate-100">
              Team Stats Splits
            </h3>
          </div>
          <SplitStatsTable
            title="Offensive Splits"
            side="offense"
            trackErrors={trackErrors}
            lines={[splitSummary.all, splitSummary.home, splitSummary.away]}
            pitchMode={pitchMode}
          />
          <SplitStatsTable
            title="Defensive Splits"
            side="defense"
            trackErrors={trackErrors}
            lines={[splitSummary.all, splitSummary.home, splitSummary.away]}
            pitchMode={pitchMode}
          />
        </section>

        {hasCutLine && (
          <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-700 dark:bg-slate-900">
            <h3 className="font-black tracking-tight text-slate-950 dark:text-slate-100">
              Magic Numbers
              <HelpTip title="Magic & Elimination Numbers">
                <strong>Magic number (M)</strong> is the combined total of wins by this team plus
                losses by rivals that guarantees a Gold Bracket spot.{" "}
                <strong>Elimination number (E)</strong> is the combined total of losses and rival
                wins that would end its Gold chances. Reaching either clinches or eliminates
                regardless of other results.
              </HelpTip>
            </h3>
            <ul className="mt-2 space-y-2 text-sm font-bold text-slate-700 dark:text-slate-200">
              <li>
                <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  M (Gold clinch)
                </span>
                <div className="text-sm font-bold leading-snug">{magicForGold.description}</div>
              </li>
              <li>
                <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  E (Gold elimination)
                </span>
                <div className="text-sm font-bold leading-snug">
                  {eliminationNumber.description}
                </div>
              </li>
            </ul>
          </section>
        )}

        {hasCutLine && (
          <section className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
            <h3 className="font-black tracking-tight text-slate-950 dark:text-slate-100">
              Clinch Scenarios
            </h3>
            <div className="mt-3 space-y-2">
              {clinchScenarios.map((scenario) => (
                <div
                  key={scenario}
                  className="rounded-lg bg-white p-3 text-sm font-bold leading-6 text-slate-600 shadow-xs ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700"
                >
                  {scenario}
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="mt-6">
          <h3 className="font-black tracking-tight text-slate-950 dark:text-slate-100">
            Next Two Games
          </h3>
          <div className="mt-3 space-y-3">
            {swings.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-800/40 p-5 text-sm font-bold text-slate-500 dark:text-slate-400">
                No remaining games for this team.
              </div>
            ) : (
              swings.map((swing) => (
                <div
                  key={swing.game.id}
                  className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-700 dark:bg-slate-900"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-black text-slate-950 dark:text-slate-100">
                      {swing.teamIsAway ? "at" : "vs"} {swing.opponentName}
                    </div>
                    <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                      {formatGameDate(swing.game.date)}
                    </div>
                  </div>
                  <div className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">
                    Model: {swing.modelPick} · {Math.round(swing.winPct * 100)}% team win chance
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-semibold">
                    <div className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                      Win: #{swing.winSeed}
                    </div>
                    <div className="rounded-lg bg-red-50 px-3 py-2 text-red-700 dark:bg-red-950/40 dark:text-red-300">
                      Loss: #{swing.lossSeed}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </aside>
    </div>
  );
}

// ---------- Main app ----------

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
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const confirmResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const confirmDialogRef = useRef<HTMLElement>(null);

  const undoRef = useRef<UndoSnapshot | null>(null);
  const { toast, show: showToast, dismiss: dismissToast } = useToast();
  const recordSaveResult = useCallback(
    (ok: boolean, _label: string, errorMessage: string) => {
      if (!ok) showToast(errorMessage, { tone: "error" });
    },
    [showToast]
  );
  const { theme, toggle: toggleTheme } = useDarkMode();
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
  const requestConfirmation = useCallback(
    (options: ConfirmState) =>
      new Promise<boolean>((resolve) => {
        confirmResolverRef.current = resolve;
        setConfirmState(options);
      }),
    []
  );
  const resolveConfirmation = useCallback((confirmed: boolean) => {
    confirmResolverRef.current?.(confirmed);
    confirmResolverRef.current = null;
    setConfirmState(null);
  }, []);
  const openTeamData = useCallback((teamId: string) => {
    setSelectedTeamId(teamId);
    replaceTeamDataUrl(teamId);
  }, []);

  const closeTeamData = useCallback(() => {
    setSelectedTeamId(null);
    setCompareTeamId(null);
    replaceTeamDataUrl(null);
  }, []);

  useFocusTrap(!!confirmState, confirmDialogRef as React.RefObject<HTMLElement>);
  useEffect(() => {
    if (!confirmState) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") resolveConfirmation(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmState, resolveConfirmation]);

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

  useEffect(() => {
    if (!newAway && teams[0]) setNewAway(teams[0].id);
    if (!newHome && teams[1]) setNewHome(teams[1].id);
  }, [teams, newAway, newHome]);

  // ---------- Derived state ----------

  const liveTeams = useMemo(
    () => calculateTeams(teams, matchups, deferredLogs, settings),
    [teams, matchups, deferredLogs, settings]
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
        settings.trackErrors
      ),
    [teams, matchups, deferredLogs, settings.pitchMode, settings.trackErrors]
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
  const { odds } = useSimulationOdds(oddsInput);

  const trendInput = useMemo(() => {
    const teamIds = teams.map((t) => t.id);
    if (!teamIds.length) {
      return { teamIds: [], states: [], iterations: 70, cutoff: goldCutoff, settings };
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
    return { teamIds, states: built, iterations: 70, cutoff: goldCutoff, settings };
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

  const predictionEngine = useMemo(
    () => buildPredictionEngine(liveTeams, matchups, deferredLogs, settings),
    [liveTeams, matchups, deferredLogs, settings]
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
        goldPctMargin: wilsonScoreInterval((odds[team.id] ?? 0) / 100, SIM_ITERATIONS).margin * 100,
        goldTrend: trendMap[team.id] ?? [],
        ...status,
      };
    });
  }, [ranked, projectedById, odds, trendMap, remainingCounts, goldCutoff, settings]);

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

  const captureUndo = (label: string) => {
    const snapshot: UndoSnapshot = {
      teams,
      matchups,
      logs,
      bracketLogs,
      label,
      timestamp: Date.now(),
    };
    undoRef.current = snapshot;
    if (!saveUndoSnapshot(snapshot)) {
      showToast("Could not save undo snapshot (storage full).", { tone: "error" });
    }
  };

  const restoreUndo = () => {
    const snapshot = undoRef.current ?? (readUndoSnapshot() as UndoSnapshot | null);
    if (!snapshot) return;
    setTeams(snapshot.teams);
    setMatchups(snapshot.matchups);
    setLogs(snapshot.logs);
    setBracketLogs(snapshot.bracketLogs ?? {});
    closeTeamData();
    undoRef.current = null;
    showToast(`Restored: ${snapshot.label}.`, { tone: "success" });
  };

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

  const importCSV = (file: File) => {
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const raw = event.target?.result;
        if (typeof raw !== "string") throw new Error("File is not text");
        const {
          teams: importedTeams,
          matchups: importedMatchups,
          logs: importedLogs,
          issues: importIssues,
        } = parseScheduleCsvImport(raw);

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

This will replace the current season data and save an undo snapshot.`,
          confirmLabel: warningLines.length ? "Import with warnings" : "Replace season",
        });
        if (!confirmed) return;

        captureUndo("CSV import");
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

  const exportCSV = () => {
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
    const blob = new Blob([[headers.join(","), ...rows].join("\n")], {
      type: "text/csv",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${settings.seasonLabel.replace(/\s+/g, "_")}_Schedule_Data.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const exportBackup = () => {
    const blob = new Blob(
      [JSON.stringify({ teams, matchups, logs, bracketLogs, settings }, null, 2)],
      {
        type: "application/json",
      }
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${settings.seasonLabel.replace(/\s+/g, "_")}_Backup.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const importBackup = (file: File) => {
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const raw = event.target?.result;
        if (typeof raw !== "string") throw new Error("Backup is not text");
        const parsed = JSON.parse(raw) as unknown;
        if (!isRecord(parsed)) throw new Error("Backup must be an object");
        if (
          !Array.isArray(parsed.teams) ||
          !Array.isArray(parsed.matchups) ||
          !isRecord(parsed.logs)
        ) {
          throw new Error("Backup is missing teams, matchups, or logs");
        }

        const nextSettings = coerceSettings(parsed.settings);
        const nextTeams = coerceTeams(parsed.teams);
        const nextMatchups = coerceMatchups(parsed.matchups, nextTeams);
        const nextLogs = coerceLogs(parsed.logs, nextMatchups, nextSettings);
        const backupTeamNameById = new Map(
          nextTeams.map((team) => [team.id, displayName(team.name)])
        );
        const preview = buildSeasonImportPreview(
          nextTeams,
          nextMatchups,
          nextLogs,
          teams,
          matchups,
          (teamId) => backupTeamNameById.get(teamId) ?? displayName(teamId),
          logs
        );
        const confirmed = await requestConfirmation({
          title: "Import backup JSON?",
          message: `${formatSeasonImportPreview(preview)}

This will replace current season data and save an undo snapshot.`,
          confirmLabel: "Import backup",
        });
        if (!confirmed) return;

        captureUndo("Backup import");
        setTeams(nextTeams);
        setMatchups(nextMatchups);
        setLogs(nextLogs);
        setBracketLogs(
          coerceLogs(isRecord(parsed.bracketLogs) ? parsed.bracketLogs : {}, [], nextSettings)
        );
        setSettings(nextSettings);
        closeTeamData();
        setLastImpact(null);
        setActiveView("standings");
        showToast(`Imported backup (${nextMatchups.length} games).`, {
          tone: "undo",
          actionLabel: "Undo",
          onAction: restoreUndo,
        });
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

  const loadDemoSeason = async () => {
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
  };

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
        ? buildTeamTrendSummary(selectedTeam.id, matchups, logs)
        : buildTeamTrendSummary("", [], {}),
    [selectedTeam, matchups, logs]
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

  const aiStory = useLeagueSummary(leagueSummaryRequest);
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

  const forecastStory = useLeagueSummary(forecastSummaryRequest);

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

  const shareSeason = async () => {
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
  };

  // ---------- Command palette + shortcuts ----------

  const runTrackedCommand = (id: string, run: () => void) => () => {
    setCommandHistory((prev) => [id, ...prev.filter((item) => item !== id)].slice(0, 6));
    run();
  };

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commandHistory, dashboardRows, theme]);

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
          <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            <TeamRankingsView
              seasons={seasons}
              activeSeasonId={activeSeasonId}
              showToast={showToast}
              requestConfirmation={requestConfirmation}
            />
          </main>
        ) : (
          <main
            className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8"
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
            hasCutLine={hasCutLine}
            projectionExplanations={
              lastImpact?.projectionExplanations?.find((e) => e.teamId === selectedTeam.id)
                ?.items ?? []
            }
            onClose={closeTeamData}
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
            onClose={() => setCompareTeamId(null)}
            onPickRight={(id) => setCompareTeamId(id)}
          />
        )}

        {appMode === "league" && (
          <>
            <CommandPalette
              open={showCommandPalette}
              commands={commands}
              onClose={() => setShowCommandPalette(false)}
            />
            <ShortcutsHelp
              open={showShortcuts}
              shortcuts={shortcutEntries}
              onClose={() => setShowShortcuts(false)}
            />
            <OnboardingTour open={showTour} onClose={() => setShowTour(false)} />
          </>
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

function teamNameFor(map: Map<string, Team>, id: string) {
  return map.get(id)?.name ?? id;
}

function PredictionCard({
  prediction,
  teamsById,
  matchups,
}: {
  prediction: LeaguePrediction;
  teamsById: Map<string, Team>;
  matchups: Matchup[];
}) {
  const game = matchups.find((item) => item.id === prediction.gameId);
  const a = teamNameFor(teamsById, prediction.teamAId);
  const b = teamNameFor(teamsById, prediction.teamBId);
  const winner = prediction.predictedWinnerId
    ? teamNameFor(teamsById, prediction.predictedWinnerId)
    : "Pending data";
  const aPct = Math.round(prediction.winProbability.teamA * 100);
  const bPct = Math.round(prediction.winProbability.teamB * 100);
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs ring-1 ring-slate-950/5 dark:border-slate-800 dark:bg-slate-950/70">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
            Upcoming prediction
          </p>
          <h3 className="mt-2 text-xl font-black tracking-tight text-slate-950 dark:text-white">
            {a} vs {b}
          </h3>
          <p className="mt-1 text-sm font-semibold text-slate-500">
            {game?.date ? formatGameDate(game.date) : "Date TBD"}
          </p>
        </div>
        <span className="rounded-full bg-slate-950 px-3 py-1 text-xs font-semibold uppercase text-white dark:bg-white dark:text-slate-950">
          {prediction.confidence.tier}
        </span>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Projected Winner
          </p>
          <p className="mt-1 text-lg font-black">
            {winner}
            {prediction.projectedMargin !== null ? ` by ${prediction.projectedMargin}` : ""}
          </p>
        </div>
        <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Win Probability
          </p>
          <p className="mt-1 flex flex-col gap-0.5 text-sm font-black">
            <span className="flex justify-between gap-2">
              <span className="truncate font-semibold">{displayName(a)}</span>
              {aPct}%
            </span>
            <span className="flex justify-between gap-2">
              <span className="truncate font-semibold">{displayName(b)}</span>
              {bPct}%
            </span>
          </p>
        </div>
        <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Expected Score
          </p>
          <p className="mt-1 text-lg font-black">
            {prediction.expectedScore
              ? `${prediction.expectedScore.teamA}-${prediction.expectedScore.teamB}`
              : "Needs scores"}
          </p>
        </div>
      </div>
      <div className="mt-4 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Model Read</p>
        <p className="mt-2 text-sm font-semibold leading-6 text-slate-700 dark:text-slate-300">
          {prediction.keyFactors[0] ?? "Add completed scores to unlock a model read."}
        </p>
      </div>
      {prediction.riskFactors.length > 0 && (
        <p className="mt-3 text-sm font-bold text-amber-700 dark:text-amber-300">
          Risk: {prediction.riskFactors[0]}
        </p>
      )}
    </article>
  );
}

function DashboardView({
  engine,
  backtestResult,
  teamsById,
  matchups,
  setActiveView,
}: {
  engine: ReturnType<typeof buildPredictionEngine>;
  backtestResult: ReturnType<typeof backtestPredictions>;
  teamsById: Map<string, Team>;
  matchups: Matchup[];
  setActiveView: (view: ActiveView) => void;
}) {
  const avgConfidence = engine.predictions.length
    ? Math.round(
        engine.predictions.reduce((sum, p) => sum + p.confidence.score, 0) /
          engine.predictions.length
      )
    : 0;
  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Games forecasted", String(engine.predictions.length)],
          ["Avg confidence", avgConfidence ? `${avgConfidence}%` : "—"],
          ["Top-rated team", engine.powerRatings[0]?.teamName ?? "—"],
          [
            "Prediction accuracy",
            backtestResult.winnerAccuracy == null
              ? "Tracking ready"
              : `${Math.round(backtestResult.winnerAccuracy * 100)}%`,
          ],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
            <p className="mt-2 text-2xl font-black">{value}</p>
          </div>
        ))}
      </section>
      <section className="grid gap-6 lg:grid-cols-[1.25fr_.75fr]">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-black">Upcoming Game Predictions</h2>
            <button className={buttonClasses.ghost} onClick={() => setActiveView("games")}>
              Open Schedule
            </button>
          </div>
          {engine.predictions.slice(0, 3).map((p) => (
            <PredictionCard
              key={p.gameId}
              prediction={p}
              teamsById={teamsById}
              matchups={matchups}
            />
          ))}
          {engine.predictions.length === 0 && (
            <EmptyPanel
              title="No predictions yet"
              body="Add completed scores and upcoming games to generate forecasts."
            />
          )}
        </div>
        <DataQualityPanel engine={engine} />
      </section>
      <PowerRatingsView engine={engine} compact />
    </div>
  );
}

function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
      <h3 className="text-xl font-black">{title}</h3>
      <p className="mt-2 text-sm font-semibold text-slate-500">{body}</p>
    </div>
  );
}
function DataQualityNotes({ notes }: { notes: string[] }) {
  if (notes.length === 0) {
    return (
      <p className="mt-3 text-sm font-semibold text-slate-500 dark:text-slate-400">
        Nothing to flag — the model has what it needs from the games entered so far.
      </p>
    );
  }
  return (
    <ul className="mt-4 space-y-2 text-sm font-semibold text-slate-600 dark:text-slate-300">
      {notes.slice(0, 6).map((item) => (
        <li key={item}>• {item}</li>
      ))}
    </ul>
  );
}

function DataQualityPanel({ engine }: { engine: ReturnType<typeof buildPredictionEngine> }) {
  return (
    <aside className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Data Quality</p>
      <h3 className="mt-2 text-2xl font-black">{engine.dataQuality.tier}</h3>
      <DataQualityNotes
        notes={[...engine.dataQuality.warnings, ...engine.dataQuality.recommendedActions]}
      />
    </aside>
  );
}

/**
 * A finished game collapsed to its result. The winner's line is the bold one so
 * a column of these can be read down without comparing digits.
 */
function FinalGameRow({
  id,
  date,
  awayName,
  homeName,
  awayRuns,
  homeRuns,
  onEdit,
}: {
  id: string;
  date: string;
  awayName: string;
  homeName: string;
  awayRuns: string;
  homeRuns: string;
  onEdit: () => void;
}) {
  const away = Number(awayRuns);
  const home = Number(homeRuns);
  const awayWon = away > home;
  const homeWon = home > away;
  const side = (name: string, runs: string, won: boolean) => (
    <div className="flex items-baseline justify-between gap-3">
      <span
        className={`truncate ${won ? "font-black text-slate-950 dark:text-white" : "font-semibold text-slate-500 dark:text-slate-400"}`}
      >
        {displayName(name)}
      </span>
      <span
        className={`tabular-nums ${won ? "font-black text-slate-950 dark:text-white" : "font-bold text-slate-500 dark:text-slate-400"}`}
      >
        {runs === "" ? "—" : runs}
      </span>
    </div>
  );
  return (
    <article
      id={id}
      className="flex items-center gap-4 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm shadow-xs dark:border-slate-700 dark:bg-slate-900"
    >
      <span className="w-14 shrink-0 text-xs font-semibold text-slate-400 dark:text-slate-500">
        {formatGameDate(date)}
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        {side(awayName, awayRuns, awayWon)}
        {side(homeName, homeRuns, homeWon)}
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
        aria-label={`Edit final: ${displayName(awayName)} at ${displayName(homeName)}`}
      >
        Edit
      </button>
    </article>
  );
}

/**
 * Recent form against a team's own season average. Most teams sit inside the
 * band most weeks, so the movers have to be the ones that catch the eye.
 */
function TrendCell({ trend }: { trend: "Up" | "Down" | "Stable" | "New" }) {
  if (trend === "Up") {
    return <span className="font-bold text-emerald-600 dark:text-emerald-400">↑ Up</span>;
  }
  if (trend === "Down") {
    return <span className="font-bold text-red-600 dark:text-red-400">↓ Down</span>;
  }
  return (
    <span className="text-slate-400 dark:text-slate-500">
      {trend === "New" ? "New" : "– Stable"}
    </span>
  );
}

// Format a run-denominated rating value with an explicit sign, e.g. "+2.3", "0.0", "-1.0".
const signedRuns = (value: number) => {
  const rounded = Number(value.toFixed(1));
  const safe = Object.is(rounded, -0) ? 0 : rounded;
  return `${safe > 0 ? "+" : ""}${safe.toFixed(1)}`;
};

function PowerRatingsView({
  engine,
  compact = false,
}: {
  engine: ReturnType<typeof buildPredictionEngine>;
  compact?: boolean;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-black">
          Power Ratings
          <HelpTip title="How the rating works">
            <strong>Rating</strong> is an opponent-adjusted run margin (a Massey rating, the same
            idea as the NCAA&apos;s NET): it fits every team so rating difference ≈ expected run
            margin, using per-game-capped run differential regressed toward league average so short
            seasons stay stable. It reads in runs — <strong>+2.0</strong> means about two runs
            better than an average team. <strong>Run Diff/G</strong> is your own capped run
            differential per game; <strong>SOS</strong> ranks how tough a schedule you&apos;ve faced
            (#1 = toughest). Because it adjusts for opponents, this is <em>not</em> the standings —
            an undefeated team that beat weak opponents can rank below a strong-schedule team.
          </HelpTip>
        </h2>
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Opponent-adjusted
        </span>
      </div>
      {engine.powerRatings.length ? (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="py-2">Rank</th>
                <th>Team</th>
                <th>Rating</th>
                <th>Record</th>
                <th>Run Diff/G</th>
                <th>SOS</th>
                <th>Trend</th>
              </tr>
            </thead>
            <tbody>
              {engine.powerRatings.slice(0, compact ? 6 : undefined).map((r) => (
                <tr key={r.teamId} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-3 font-black">#{r.rank}</td>
                  <td className="font-black">{r.teamName}</td>
                  <td className="font-black">{signedRuns(r.rating)}</td>
                  <td>{r.record}</td>
                  <td>{signedRuns(r.rawMargin)}</td>
                  <td>{r.sosRank > 0 ? `#${r.sosRank}` : "—"}</td>
                  <td>
                    <TrendCell trend={r.trend} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!compact && (
            <p className="mt-3 text-xs font-semibold leading-5 text-slate-500 dark:text-slate-400">
              Opponent-adjusted, so it can differ from the standings on purpose — a team that beat a
              weak schedule can rank below a team that played tougher competition. SOS is a schedule
              rank (#1 = toughest faced).
            </p>
          )}
        </div>
      ) : (
        <EmptyPanel
          title="Power ratings unavailable"
          body="Power ratings will appear once teams have completed games."
        />
      )}
    </section>
  );
}

function EmptyState({
  importCSV,
  createSeasonFromTeamList,
  downloadRoundRobinCSV,
  seasonBuilderText,
  setSeasonBuilderText,
  teams,
  loadDemoSeason,
  openTour,
}: {
  importCSV: (file: File) => void;
  createSeasonFromTeamList: () => void;
  downloadRoundRobinCSV: () => void;
  seasonBuilderText: string;
  setSeasonBuilderText: (v: string) => void;
  teams: TeamBase[];
  loadDemoSeason: () => void;
  openTour: () => void;
}) {
  const kickoffFlow: DesignFlowStep[] = [
    {
      eyebrow: "Load",
      title: "Bring in the league file",
      body: "Start with the official CSV when you have dates, teams, and scores already organized.",
      meta: "Fastest path for real schedules",
      tone: "blue",
      actions: [
        {
          label: "Import CSV",
          tone: "primary",
          file: {
            accept: ".csv,text/csv",
            ariaLabel: "Import schedule CSV",
            onChange: importCSV,
          },
        },
      ],
    },
    {
      eyebrow: "Build",
      title: "Create from team names",
      body: "Paste the clubs once and generate a blank round-robin shell for scorekeeping.",
      meta: "Great for a clean new season",
      tone: "amber",
      actions: [
        { label: "Create Schedule", tone: "dark", onClick: createSeasonFromTeamList },
        { label: "Blank CSV", onClick: downloadRoundRobinCSV },
      ],
    },
    {
      eyebrow: "Review",
      title: "Review season data",
      body: "Use standings, team stats, and the schedule board to confirm the season looks right.",
      meta: "Validates teams, games, and scores",
      tone: "emerald",
    },
    {
      eyebrow: "Practice",
      title: "Explore with demo data",
      body: "Load a sample season to see the model, cut line, and recap flow before importing yours.",
      meta: "Safe sandbox mode",
      tone: "red",
      actions: [{ label: "Load Demo", onClick: loadDemoSeason }],
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-6">
      <DesignFlowPanel
        title="Launch the season with a guided flow"
        subtitle="A visual setup lane keeps the first import, roster build, validation, and demo rehearsal in one place before the standings go live."
        steps={kickoffFlow}
        footer={
          <button
            type="button"
            onClick={openTour}
            className="text-sm font-semibold text-slate-500 underline decoration-dotted underline-offset-4 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white"
          >
            New here? Take the quick tour
          </button>
        }
      />

      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-700 dark:bg-slate-900">
        <div>
          <h2 className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-100">
            New Season Builder
          </h2>
          <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
            One team per line. Step 2 above turns this list into a round-robin schedule.
          </p>
          <label className="sr-only" htmlFor="season-builder-textarea">
            Team list
          </label>
          <textarea
            id="season-builder-textarea"
            value={seasonBuilderText}
            onChange={(event) => setSeasonBuilderText(event.target.value)}
            placeholder={
              teams.length
                ? teams.map((team) => displayName(team.name)).join("\n")
                : "Falcons\nWolves\nComets"
            }
            className="mt-4 h-44 w-full resize-none rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-950 outline-hidden focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
          />
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={createSeasonFromTeamList}
              className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white shadow-xs hover:bg-slate-800"
            >
              Create Schedule
            </button>
            <button
              onClick={downloadRoundRobinCSV}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 shadow-xs hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              Download Blank CSV
            </button>
            <button
              onClick={() =>
                setSeasonBuilderText(teams.map((team) => displayName(team.name)).join("\n"))
              }
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 shadow-xs hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              Use Current Teams
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TeamStatsView({
  leagueAverageStats,
  statRankings,
  pitchMode,
  trackErrors,
  matrixTeams,
  headToHeadCell,
}: {
  leagueAverageStats: LeagueAverageStats;
  statRankings: StatRankings;
  pitchMode: PitchMode;
  trackErrors: boolean;
  matrixTeams: { id: string; name: string }[];
  headToHeadCell: (rowId: string, colId: string) => H2HCell;
}) {
  return (
    <div className="grid grid-cols-1 gap-6">
      <section>
        <h2 className="text-2xl font-black tracking-tight text-slate-950 dark:text-slate-100">
          League Stats
        </h2>
        <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
          Compare league-wide scoring, hitting, pitching, and fielding rates.
        </p>
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xs dark:border-slate-700 dark:bg-slate-900">
        <div className="grid grid-cols-2 gap-3 border-b border-slate-200 bg-slate-50 p-4 md:grid-cols-4 dark:border-slate-700 dark:bg-slate-800/40">
          <div className="rounded-lg bg-linear-to-br from-blue-500/12 via-white to-white p-4 shadow-xs ring-1 ring-blue-100 dark:from-blue-500/18 dark:via-slate-900 dark:to-slate-900 dark:ring-blue-900/50">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              League Avg Sample
            </div>
            <div className="mt-1 text-xl font-black text-slate-950 dark:text-slate-100">
              {leagueAverageStats.completedGames}
            </div>
            <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
              games played
            </div>
          </div>
          <div className="rounded-lg bg-linear-to-br from-emerald-500/12 via-white to-white p-4 shadow-xs ring-1 ring-emerald-100 dark:from-emerald-500/18 dark:via-slate-900 dark:to-slate-900 dark:ring-emerald-900/50">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              League Avg R/G
            </div>
            <div className="mt-1 text-xl font-black text-slate-950 dark:text-slate-100">
              {perGame(leagueAverageStats.runs, leagueAverageStats.teamGames)}
            </div>
          </div>
          <div className="rounded-lg bg-linear-to-br from-amber-500/14 via-white to-white p-4 shadow-xs ring-1 ring-amber-100 dark:from-amber-500/18 dark:via-slate-900 dark:to-slate-900 dark:ring-amber-900/50">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              League Avg H/G
            </div>
            <div className="mt-1 text-xl font-black text-slate-950 dark:text-slate-100">
              {perGame(leagueAverageStats.hits, leagueAverageStats.teamGames)}
            </div>
          </div>
          {pitchMode === "player" && (
            <div className="rounded-lg bg-linear-to-br from-violet-500/12 via-white to-white p-4 shadow-xs ring-1 ring-violet-100 dark:from-violet-500/18 dark:via-slate-900 dark:to-slate-900 dark:ring-violet-900/50">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                League Avg BB/G
              </div>
              <div className="mt-1 text-xl font-black text-slate-950 dark:text-slate-100">
                {perGame(leagueAverageStats.walks, leagueAverageStats.teamGames)}
              </div>
            </div>
          )}
          {(pitchMode !== "player" || trackErrors) && (
            <div className="rounded-lg bg-linear-to-br from-red-500/12 via-white to-white p-4 shadow-xs ring-1 ring-red-100 dark:from-red-500/18 dark:via-slate-900 dark:to-slate-900 dark:ring-red-900/50">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {pitchMode === "player" ? "League Avg E/G" : "League Avg K/G"}
              </div>
              <div className="mt-1 text-xl font-black text-slate-950 dark:text-slate-100">
                {pitchMode === "player"
                  ? perGame(leagueAverageStats.errors, leagueAverageStats.teamGames)
                  : perGame(leagueAverageStats.strikeouts, leagueAverageStats.teamGames)}
              </div>
            </div>
          )}
        </div>

        <StatRankingsPanel rankings={statRankings} />
      </section>

      {matrixTeams.length >= 2 && (
        <section className={`${card} p-5`} aria-label="Head-to-head matrix">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-100">
                Head-to-Head Matrix
              </h3>
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                Each row shows how that team has fared against every opponent this season.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-wide">
              <span className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
                <span className="h-3 w-3 rounded-xs bg-emerald-500" /> Won series
              </span>
              <span className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
                <span className="h-3 w-3 rounded-xs bg-red-500" /> Lost series
              </span>
              <span className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
                <span className="h-3 w-3 rounded-xs bg-amber-400" /> Split
              </span>
              <span className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
                <span className="h-3 w-3 rounded-xs bg-slate-100 dark:bg-slate-800" /> Not played
              </span>
            </div>
          </div>
          <HeadToHeadMatrix teams={matrixTeams} cellFor={headToHeadCell} />
        </section>
      )}
    </div>
  );
}

function StandingsView({
  goldCutoff,
  latestCompletedDate,
  lastImpact,
  dismissImpact,
  copyRecap,
  copyStory,
  dashboardRows,
  hasCutLine,
  storyText,
  storySource,
  storyModel,
  storyLoading,
  storyUnavailableReason,
  storyErrorMessage,
  retryStory,
  currentSosRanks,
  statusClass,
  statusLabel,
  formatGoldPct,
  formatGoldMargin,
  onSelectTeam,
}: {
  goldCutoff: number;
  latestCompletedDate: string;
  lastImpact: LastImpact | null;
  dismissImpact: () => void;
  copyRecap: () => void;
  copyStory: () => void;
  dashboardRows: TeamWithProjection[];
  /** False when the league has no cut line, so Gold odds and status are meaningless. */
  hasCutLine: boolean;
  /** Gemini story when one arrived, otherwise the deterministic one. */
  storyText: string;
  storySource: "gemini" | "local";
  storyModel: string;
  storyLoading: boolean;
  storyUnavailableReason: LeagueSummaryErrorReason | null;
  storyErrorMessage: string;
  retryStory: () => void;
  currentSosRanks: Record<string, number>;
  statusClass: (t: TeamWithProjection) => string;
  statusLabel: (t: TeamWithProjection) => string;
  formatGoldPct: (t: TeamWithProjection) => string;
  formatGoldMargin: (t: TeamWithProjection) => string;
  onSelectTeam: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-6">
      <section>
        <h2 className="text-2xl font-black tracking-tight text-slate-950 dark:text-slate-100">
          Standings
          <HelpTip title="Reading the table">
            {hasCutLine && (
              <>
                <strong>Gold %</strong> is the simulated chance of finishing in the top {goldCutoff}{" "}
                (the Gold Bracket), from thousands of season simulations.{" "}
              </>
            )}
            <strong>SOS</strong> is strength of schedule — a lower rank means tougher opponents.{" "}
            <strong>Diff</strong> is run differential (runs scored minus runs allowed).
          </HelpTip>
        </h2>
        <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
          Updated through {latestCompletedDate}.
        </p>
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xs dark:border-slate-700 dark:bg-slate-900">
        {lastImpact && (
          <div className="border-b border-slate-200 bg-blue-50 px-5 py-4 dark:border-slate-700 dark:bg-slate-800/50">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-400">
                  Impact Since Last Update
                </div>
                <div className="text-sm font-bold text-slate-950 dark:text-slate-100">
                  {lastImpact.title}
                </div>
              </div>
              <div className="flex gap-2">
                {lastImpact.recapItems.length > 0 && (
                  <button
                    type="button"
                    onClick={copyStory}
                    className="rounded-full bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white shadow-xs hover:bg-blue-500"
                  >
                    Copy Story
                  </button>
                )}
                {lastImpact.recapItems.length > 0 && (
                  <button
                    type="button"
                    onClick={copyRecap}
                    className="rounded-full bg-slate-950 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white shadow-xs hover:bg-slate-800 dark:bg-white dark:text-slate-950"
                  >
                    Copy Recap
                  </button>
                )}
                <button
                  type="button"
                  onClick={dismissImpact}
                  className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 shadow-xs ring-1 ring-blue-100 hover:text-slate-950 dark:bg-slate-900 dark:text-slate-400 dark:ring-slate-700"
                >
                  Dismiss
                </button>
              </div>
            </div>
            {lastImpact.scores.length > 0 && (
              <div className="mb-3 rounded-lg bg-white p-3 shadow-xs ring-1 ring-blue-100 dark:bg-slate-900 dark:ring-slate-700">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Final Scores
                </div>
                <div className="flex flex-wrap gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
                  {lastImpact.scores.map((score) => (
                    <span
                      key={score}
                      className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800 dark:text-slate-200"
                    >
                      {score}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {lastImpact.recapItems.length > 0 ? (
              <>
                <AiStoryPanel
                  title="League Story"
                  text={storyText}
                  source={storySource}
                  model={storyModel}
                  loading={storyLoading}
                  unavailableReason={storyUnavailableReason}
                  errorMessage={storyErrorMessage}
                  onRetry={retryStory}
                />
                <ul className="space-y-2 text-xs font-semibold text-blue-800 dark:text-blue-300">
                  {lastImpact.recapItems.map((item) => (
                    <li
                      key={item.text}
                      className="rounded-lg bg-white px-3 py-2 shadow-xs ring-1 ring-blue-100 dark:bg-slate-900 dark:ring-slate-700"
                    >
                      <span>{item.text}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="flex flex-wrap gap-2 text-xs font-semibold text-blue-700 dark:text-blue-300">
                {lastImpact.messages.map((change) => (
                  <span
                    key={change}
                    className="rounded-full bg-white px-3 py-1 shadow-xs ring-1 ring-blue-100 dark:bg-slate-900 dark:ring-slate-700"
                  >
                    {change}
                  </span>
                ))}
              </div>
            )}
            {lastImpact.projectionExplanations && lastImpact.projectionExplanations.length > 0 && (
              <div className="mt-3 rounded-lg bg-white p-3 shadow-xs ring-1 ring-blue-100 dark:bg-slate-900 dark:ring-slate-700">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Why projections moved
                </div>
                <div className="space-y-2">
                  {lastImpact.projectionExplanations.slice(0, 5).map((entry) => (
                    <div key={entry.teamId}>
                      <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                        {entry.teamName}
                      </div>
                      <ProjectionExplanation explanations={entry.items} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {hasCutLine && (
          <div className="border-b border-slate-200 bg-white/80 px-5 py-3 dark:border-slate-700 dark:bg-slate-900/70">
            <div className="flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-wide">
              <span className="rounded-full bg-slate-950 px-3 py-1 text-white dark:bg-white dark:text-slate-950">
                Clinched
              </span>
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                Safe
              </span>
              <span className="rounded-full bg-blue-100 px-3 py-1 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
                Inside Cut
              </span>
              <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                Bubble
              </span>
              <span className="rounded-full bg-orange-100 px-3 py-1 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300">
                Chasing
              </span>
              <span className="rounded-full bg-red-100 px-3 py-1 text-red-700 dark:bg-red-950/50 dark:text-red-300">
                Out
              </span>
            </div>
          </div>
        )}

        {dashboardRows.length === 0 ? (
          <div className="p-8 text-center text-sm font-bold text-slate-500 dark:text-slate-400">
            No final results yet. Mark a game Final in the Schedule tab to populate standings.
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left">
                <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                  <tr>
                    <th className="px-5 py-3">Seed</th>
                    <th className="px-5 py-3">Team</th>
                    <th className="px-4 py-3 text-center">Record</th>
                    <th className="px-4 py-3 text-center">Diff</th>
                    <th className="px-4 py-3 text-center">SOS</th>
                    {hasCutLine && (
                      <>
                        <th className="px-4 py-3 text-center">Gold %</th>
                        <th className="px-4 py-3 text-center">Playoff Status</th>
                        <th className="px-4 py-3 text-center" title="Gold % trend.">
                          Trend (Gold %)
                        </th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {dashboardRows.map((team, index) => {
                    const raceTone = raceToneForTeam(team, goldCutoff);
                    return (
                      <React.Fragment key={team.id}>
                        {hasCutLine && index === goldCutoff && (
                          <tr
                            key="cut-line"
                            // eslint-disable-next-line jsx-a11y/no-interactive-element-to-noninteractive-role
                            role="separator"
                            aria-label={`Gold cut line: top ${goldCutoff} teams qualify`}
                          >
                            <td
                              colSpan={8}
                              className="bg-slate-950 px-5 py-2 text-center text-xs font-semibold uppercase tracking-[0.22em] text-red-400 dark:bg-black"
                            >
                              Gold Cut Line
                            </td>
                          </tr>
                        )}
                        <tr
                          className={`text-slate-800 ring-1 ring-inset transition hover:brightness-[0.98] dark:text-slate-100 dark:hover:brightness-110 ${raceRowToneClasses[raceTone]}`}
                        >
                          <td className="px-5 py-4 font-black">
                            <span
                              className={`rounded-full px-3 py-1 text-xs ${raceSeedBadgeClasses[raceTone]}`}
                            >
                              #{team.rank}
                            </span>
                          </td>
                          <td className="px-5 py-4">
                            <a
                              href={buildTeamDataHref(team.id)}
                              onClick={(event) => {
                                event.preventDefault();
                                onSelectTeam(team.id);
                              }}
                              className="-m-1 flex items-center gap-3 rounded-lg p-1 text-left focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-slate-900"
                              aria-label={`View stats for ${displayName(team.name)}`}
                            >
                              <span
                                className={`flex h-9 w-9 items-center justify-center rounded-lg text-xs font-black shadow-xs ${raceSeedBadgeClasses[raceTone]}`}
                              >
                                {teamAbbr(team.name)}
                              </span>
                              <span
                                className="font-black tracking-tight text-blue-700 underline decoration-blue-300 underline-offset-4 hover:text-blue-500 dark:text-blue-300 dark:decoration-blue-700 dark:hover:text-blue-200"
                                title={team.name}
                              >
                                {displayName(team.name)}
                              </span>
                            </a>
                          </td>
                          <td className="px-4 py-4 text-center font-black text-slate-800 dark:text-slate-100">
                            {recordText(team)}
                          </td>
                          <td
                            className={`px-4 py-4 text-center font-black ${
                              team.runDiff > 0
                                ? "text-emerald-600 dark:text-emerald-400"
                                : team.runDiff < 0
                                  ? "text-red-600 dark:text-red-400"
                                  : "text-slate-500 dark:text-slate-400"
                            }`}
                          >
                            {team.runDiff > 0 ? "+" : ""}
                            {team.runDiff}
                          </td>
                          <td className="px-4 py-4 text-center">
                            <span
                              title={`Current SOS: ${team.sos.toFixed(2)}. Rank is based on opponents already played.`}
                              className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                            >
                              #{currentSosRanks[team.id] || "—"}
                            </span>
                          </td>
                          {hasCutLine && (
                            <>
                              <td className="px-4 py-4 text-center">
                                <span
                                  className={
                                    team.goldPct >= 75
                                      ? pill("emerald")
                                      : team.goldPct >= 40
                                        ? pill("blue")
                                        : pill("neutral")
                                  }
                                >
                                  {formatGoldPct(team)}
                                </span>
                                <div className="mt-1 text-[10px] font-bold text-slate-500 dark:text-slate-400">
                                  {formatGoldMargin(team)} sim. error
                                </div>
                              </td>
                              <td className="px-4 py-4 text-center">
                                <span
                                  title={
                                    team.goldStatus === "Eliminated"
                                      ? `${displayName(team.name)} can max out at ${team.maxPoints} standings points, but ${team.blockersAhead} team${team.blockersAhead === 1 ? "" : "s"} already sit above that number.`
                                      : team.goldStatus === "Clinched"
                                        ? `${displayName(team.name)} have mathematically secured a Top ${goldCutoff} spot even if they lose out.`
                                        : `${displayName(team.name)} are still mathematically live for the Top ${goldCutoff}.`
                                  }
                                  aria-label={`Playoff status: ${statusLabel(team)}`}
                                  className={`rounded-full px-3 py-1 text-xs font-black ${statusClass(team)}`}
                                >
                                  {statusLabel(team)}
                                </span>
                              </td>
                              <td className="px-4 py-4 text-center">
                                <Sparkline values={team.goldTrend} />
                              </td>
                            </>
                          )}
                        </tr>
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="hidden px-5 pb-4 text-[11px] font-bold text-slate-500 md:block dark:text-slate-400"></div>

            {/* Mobile cards */}
            <ul className="divide-y divide-slate-100 md:hidden dark:divide-slate-800">
              {dashboardRows.map((team, index) => {
                const isLastInside = hasCutLine && index + 1 === goldCutoff;
                const raceTone = raceToneForTeam(team, goldCutoff);
                return (
                  <li key={team.id} className={`ring-1 ring-inset ${raceRowToneClasses[raceTone]}`}>
                    <div className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
                      <a
                        href={buildTeamDataHref(team.id)}
                        onClick={(event) => {
                          event.preventDefault();
                          onSelectTeam(team.id);
                        }}
                        className="flex min-w-0 items-center gap-3 rounded-lg text-left focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-slate-900"
                        aria-label={`View stats for ${displayName(team.name)}`}
                      >
                        <span
                          className={`rounded-full px-2 py-1 text-right text-xs font-black ${raceSeedBadgeClasses[raceTone]}`}
                        >
                          #{team.rank}
                        </span>
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[10px] font-black shadow-xs ${raceSeedBadgeClasses[raceTone]}`}
                        >
                          {teamAbbr(team.name)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-bold text-blue-700 underline decoration-blue-300 underline-offset-4 dark:text-blue-300 dark:decoration-blue-700">
                            {displayName(team.name)}
                          </span>
                          <span className="mt-0.5 block text-[11px] font-bold text-slate-500 dark:text-slate-400">
                            {recordText(team)} ·{" "}
                            <span
                              className={
                                team.runDiff > 0
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : team.runDiff < 0
                                    ? "text-red-600 dark:text-red-400"
                                    : ""
                              }
                            >
                              {team.runDiff > 0 ? "+" : ""}
                              {team.runDiff}
                            </span>{" "}
                            · SOS #{currentSosRanks[team.id] || "—"}
                          </span>
                        </span>
                      </a>
                      {hasCutLine && (
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <span
                            className={
                              team.goldPct >= 75
                                ? pill("emerald")
                                : team.goldPct >= 40
                                  ? pill("blue")
                                  : pill("neutral")
                            }
                          >
                            {formatGoldPct(team)}
                          </span>
                          <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
                            {formatGoldMargin(team)}
                          </span>
                          <span
                            aria-label={`Playoff status: ${statusLabel(team)}`}
                            className={`rounded-full px-2 py-0.5 text-[10px] font-black ${statusClass(team)}`}
                          >
                            {statusLabel(team)}
                          </span>
                        </div>
                      )}
                    </div>
                    {isLastInside && (
                      <div
                        role="separator"
                        aria-label={`Gold cut line: top ${goldCutoff} teams qualify`}
                        className="bg-slate-950 px-4 py-1.5 text-center text-[10px] font-semibold uppercase tracking-[0.22em] text-red-400 dark:bg-black"
                      >
                        Gold Cut Line
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

function ModelView(props: {
  goldCutoff: number;
  modelRows: TeamWithProjection[];
  bracketProjection: ReturnType<typeof buildBracketProjection>;
  silverBracketProjection: ReturnType<typeof buildBracketProjection>;
  updateBracketLog: (gameId: string, field: keyof GameLog, value: string | boolean) => void;
  toggleBracketFinal: (gameId: string) => void;
  clearBracketScores: (gameIds: string[], label: string) => void;
  seedRangeForTeam: (id: string) => { best: number; worst: number; baseline: number };
  gamesThatMatterMost: {
    game: Matchup;
    rank: number;
    label: string;
    reason: string;
    date: string;
  }[];
  bubbleMovementRows: {
    team: TeamWithProjection;
    tier: string;
    sos: { label: string; opponents: string };
    control: string;
  }[];
  scheduleDifficultyForTeam: (id: string) => { label: string; rating: number; opponents: string };
  formatGoldPct: (t: TeamWithProjection) => string;
  formatGoldMargin: (t: TeamWithProjection) => string;
  projectedCutLineTeams: TeamWithProjection[];
  nextTwoSwingGames: (id: string) => SwingGame[];
  gameForecasts: {
    game: Matchup;
    prediction: Prediction;
    awayName: string;
    homeName: string;
    winnerName: string;
    winnerPct: number;
    impact: ReturnType<Map<string, { impactLabel: "High" | "Medium" | "Low" }>["get"]>;
    sourceLabel: string;
  }[];
  byId: Map<string, Team>;
  gameStatusClasses: (s: string) => string;
  teams: TeamBase[];
  matchups: Matchup[];
  logs: Record<string, GameLog>;
  settings: Settings;
  cutoff: number;
  onSelectTeam: (id: string) => void;
  liveTeams: Team[];
  remainingGames: Matchup[];
  backtestResult: ReturnType<typeof backtestPredictions>;
  bracketOdds: BracketOddsResult;
  clinchingPaths: ClinchingPathNote[];
  cutLineSnapshot: ReturnType<typeof goldCutLineSnapshot>;
  timelineEntries: SeasonTimelineEntry[];
  /** False when the league has no cut line: no Gold odds, no bubble, no clinching. */
  hasCutLine: boolean;
  /** False when the league plays no bracket at all. */
  hasPostseason: boolean;
  /** Gemini write-up of the projection; empty when the AI story is unavailable. */
  forecastStoryText: string;
  forecastStoryModel: string;
  forecastStoryLoading: boolean;
  forecastStoryUnavailableReason: LeagueSummaryErrorReason | null;
  forecastStoryErrorMessage: string;
  retryForecastStory: () => void;
}) {
  const {
    goldCutoff,
    modelRows,
    bracketProjection,
    silverBracketProjection,
    updateBracketLog,
    toggleBracketFinal,
    clearBracketScores,
    seedRangeForTeam,
    gamesThatMatterMost,
    bubbleMovementRows,
    scheduleDifficultyForTeam,
    formatGoldPct,
    formatGoldMargin,
    projectedCutLineTeams,
    nextTwoSwingGames,
    gameForecasts,
    byId,
    gameStatusClasses,
    teams: _teams,
    matchups: _matchups,
    logs: _logs,
    settings: _settings,
    cutoff: _cutoff,
    onSelectTeam,
    liveTeams: _liveTeams,
    remainingGames: _remainingGames,
    backtestResult,
    bracketOdds,
    clinchingPaths,
    cutLineSnapshot,
    timelineEntries,
    hasCutLine,
    hasPostseason,
    forecastStoryText,
    forecastStoryModel,
    forecastStoryLoading,
    forecastStoryUnavailableReason,
    forecastStoryErrorMessage,
    retryForecastStory,
  } = props;

  // While loading, the panel header carries the status label on its own, so
  // there is no body text to repeat it.
  const forecastPanelText =
    forecastStoryText ||
    (forecastStoryLoading
      ? ""
      : forecastStoryUnavailableReason
        ? "The written forecast is unavailable. The projected table and game picks below are unaffected."
        : "");

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-2xl font-black tracking-tight text-slate-950 dark:text-slate-100">
          Forecast
        </h2>
        <div className="mt-3">
          <AiStoryPanel
            title="Forecast Write-up"
            text={forecastPanelText}
            source={forecastStoryText ? "gemini" : "local"}
            model={forecastStoryModel}
            loading={forecastStoryLoading}
            loadingLabel="Reading the projection…"
            unavailableReason={forecastStoryUnavailableReason}
            errorMessage={forecastStoryErrorMessage}
            onRetry={retryForecastStory}
          />
        </div>
      </div>

      {hasCutLine && (
        <ClinchingPathsPanel
          paths={clinchingPaths}
          lastInName={cutLineSnapshot.lastInName}
          firstOutName={cutLineSnapshot.firstOutName}
          pointsGap={cutLineSnapshot.pointsGap}
          onSelectTeam={onSelectTeam}
        />
      )}

      {hasCutLine && modelRows.some((team) => team.goldTrend.length >= 2) && (
        <section className={`${card} p-5`} aria-label="Gold odds trend">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-100">
                Gold Odds Over Recent Games
              </h3>
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                Simulated Gold Bracket odds for the top teams after each of the latest results.
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              Top 5
            </span>
          </div>
          <GoldOddsTrendChart rows={modelRows} />
        </section>
      )}

      <section className={`${card} p-5`} aria-label="Schedule difficulty heatmap">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-100">
              Schedule Difficulty Heatmap
            </h3>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            Remaining slate
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {modelRows.map((team) => {
            const sos = scheduleDifficultyForTeam(team.id);
            const toneClass =
              sos.label === "Hard"
                ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-200"
                : sos.label === "Medium"
                  ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200"
                  : sos.label === "Complete"
                    ? "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                    : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-200";
            return (
              <button
                type="button"
                key={`sos-heat-${team.id}`}
                onClick={() => onSelectTeam(team.id)}
                className={`rounded-lg border p-4 text-left shadow-xs transition hover:-translate-y-0.5 hover:shadow-md ${toneClass}`}
                aria-label={`${displayName(team.name)} remaining schedule difficulty: ${sos.label}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-black">{displayName(team.name)}</span>
                  <span className="rounded-full bg-white/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-current dark:bg-black/20">
                    {sos.label}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 text-xs font-bold opacity-80">{sos.opponents}</p>
              </button>
            );
          })}
        </div>
      </section>

      {hasPostseason && (
        <BracketPredictionPanel
          title={hasCutLine ? "Gold Bracket Predictor" : "Bracket Predictor"}
          emptyMessage="Not enough teams for a bracket."
          championLabel="Projected Champion"
          projection={bracketProjection}
          onScoreChange={updateBracketLog}
          onToggleFinal={toggleBracketFinal}
          onClearScores={clearBracketScores}
        />
      )}

      {hasCutLine && (
        <BracketPredictionPanel
          title="Silver Bracket Predictor"
          emptyMessage="Not enough Silver teams."
          championLabel="Projected Silver Champion"
          projection={silverBracketProjection}
          onScoreChange={updateBracketLog}
          onToggleFinal={toggleBracketFinal}
          onClearScores={clearBracketScores}
        />
      )}

      {hasCutLine && (
        <SeedOddsPanel
          teams={modelRows.map((team) => ({ id: team.id, name: team.name }))}
          bracketOdds={bracketOdds}
          cutoff={goldCutoff}
          cardClassName={card}
        />
      )}

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xs dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <h3 className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-100">
            Projected Standings
          </h3>
        </div>
        {modelRows.length === 0 ? (
          <div className="p-8 text-center text-sm font-bold text-slate-500 dark:text-slate-400">
            No teams yet.
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left">
                <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                  <tr>
                    <th className="px-5 py-3">Team</th>
                    <th className="px-4 py-3 text-center">Current Seed</th>
                    <th className="px-4 py-3 text-center">Projected Seed</th>
                    <th className="px-4 py-3 text-center">Range</th>
                    <th className="px-4 py-3 text-center">Projected Record</th>
                    {hasCutLine && <th className="px-4 py-3 text-center">Gold Odds</th>}
                    <th className="px-4 py-3 text-center">Run Diff</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {modelRows.map((team) => {
                    const movement = (team.rank ?? 99) - team.projectedRank;
                    const range = seedRangeForTeam(team.id);
                    const confidence = projectionConfidenceForTeam(team);
                    const confidenceClass =
                      confidence.tone === "emerald"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                        : confidence.tone === "amber"
                          ? "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                          : "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300";
                    return (
                      <tr
                        key={`forecast-${team.id}`}
                        className="text-slate-800 hover:bg-slate-50/70 dark:text-slate-100 dark:hover:bg-slate-800/70"
                      >
                        <td className="px-5 py-4 font-black">
                          <a
                            href={buildTeamDataHref(team.id)}
                            onClick={(event) => {
                              event.preventDefault();
                              onSelectTeam(team.id);
                            }}
                            className="rounded-lg text-left text-blue-700 underline decoration-blue-300 underline-offset-4 hover:text-blue-500 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-white dark:text-blue-300 dark:decoration-blue-700 dark:hover:text-blue-200 dark:focus:ring-offset-slate-900"
                            aria-label={`View stats for ${displayName(team.name)}`}
                          >
                            {displayName(team.name)}
                          </a>
                        </td>
                        <td className="px-4 py-4 text-center font-black">#{team.rank}</td>
                        <td className="px-4 py-4 text-center font-black">
                          #{team.projectedRank}
                          <span
                            className={`ml-2 rounded-full px-2 py-1 text-[10px] font-black ${
                              movement > 0
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                                : movement < 0
                                  ? "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300"
                                  : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                            }`}
                          >
                            {movement > 0
                              ? `+${movement}`
                              : movement < 0
                                ? `-${Math.abs(movement)}`
                                : "0"}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-center font-black">
                          #{range.best}–#{range.worst}
                        </td>
                        <td className="px-4 py-4 text-center font-black">{team.projectedRecord}</td>
                        {hasCutLine && (
                          <td className="px-4 py-4 text-center font-black">
                            <div>{formatGoldPct(team)}</div>
                            <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
                              {formatGoldMargin(team)}
                            </div>
                            <span
                              className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-black ${confidenceClass}`}
                              title={confidence.detail}
                            >
                              {confidence.label}
                            </span>
                          </td>
                        )}
                        <td
                          className={`px-4 py-4 text-center font-black ${
                            team.projectedRunDiff > 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : team.projectedRunDiff < 0
                                ? "text-red-600 dark:text-red-400"
                                : "text-slate-500 dark:text-slate-400"
                          }`}
                        >
                          {team.projectedRunDiff > 0 ? "+" : ""}
                          {team.projectedRunDiff}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="hidden px-5 pb-4 text-[11px] font-bold text-slate-500 md:block dark:text-slate-400"></div>

            {/* Mobile cards */}
            <ul className="divide-y divide-slate-100 md:hidden dark:divide-slate-800">
              {modelRows.map((team) => {
                const movement = (team.rank ?? 99) - team.projectedRank;
                const range = seedRangeForTeam(team.id);
                const confidence = projectionConfidenceForTeam(team);
                return (
                  <li
                    key={`forecast-mobile-${team.id}`}
                    className="grid grid-cols-[40px_1fr_auto] items-center gap-3 px-4 py-3"
                  >
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                      #{team.rank}
                    </span>
                    <div className="min-w-0">
                      <a
                        href={buildTeamDataHref(team.id)}
                        onClick={(event) => {
                          event.preventDefault();
                          onSelectTeam(team.id);
                        }}
                        className="block truncate rounded-lg text-left text-sm font-bold text-blue-700 underline decoration-blue-300 underline-offset-4 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-white dark:text-blue-300 dark:decoration-blue-700 dark:focus:ring-offset-slate-900"
                        aria-label={`View stats for ${displayName(team.name)}`}
                      >
                        {displayName(team.name)}
                      </a>
                      <div className="mt-0.5 text-[11px] font-bold text-slate-500 dark:text-slate-400">
                        Proj #{team.projectedRank}{" "}
                        <span
                          className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-black ${
                            movement > 0
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                              : movement < 0
                                ? "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300"
                                : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                          }`}
                        >
                          {movement > 0
                            ? `+${movement}`
                            : movement < 0
                              ? `-${Math.abs(movement)}`
                              : "0"}
                        </span>{" "}
                        · #{range.best}–#{range.worst} · {team.projectedRecord}
                      </div>
                      <div className="mt-0.5 text-[11px] font-bold text-slate-500 dark:text-slate-400">
                        Diff{" "}
                        <span
                          className={
                            team.projectedRunDiff > 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : team.projectedRunDiff < 0
                                ? "text-red-600 dark:text-red-400"
                                : ""
                          }
                        >
                          {team.projectedRunDiff > 0 ? "+" : ""}
                          {team.projectedRunDiff}
                        </span>
                      </div>
                    </div>
                    <span className="text-right text-sm font-bold text-slate-950 dark:text-slate-100">
                      {formatGoldPct(team)}
                      <span className="block text-[10px] font-bold text-slate-500 dark:text-slate-400">
                        {formatGoldMargin(team)}
                      </span>
                      <span className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                        {confidence.label}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      <section className={`${card} p-5 dark:border-slate-700 dark:bg-slate-900`}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-100">
            Games That Matter Most
          </h3>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            Next up
          </span>
        </div>
        {gamesThatMatterMost.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-800/40 p-6 text-center text-sm font-bold text-slate-500 dark:text-slate-400">
            No remaining games.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {gamesThatMatterMost.map((item) => (
              <div
                key={`matter-${item.game.id}`}
                className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      #{item.rank} · {item.date}
                    </div>
                    <div className="mt-1 font-black text-slate-950 dark:text-slate-100">
                      {item.label}
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-black ${gameStatusClasses(item.reason)}`}
                  >
                    {item.reason}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {hasCutLine && bubbleMovementRows.length > 0 && (
        <section className={`${card} p-5`}>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-100">
              Bubble Watch
            </h3>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              Around Top {goldCutoff}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {bubbleMovementRows.map(({ team, tier, sos }) => {
              const range = seedRangeForTeam(team.id);
              const confidence = projectionConfidenceForTeam(team);
              return (
                <div
                  key={`bubble-${team.id}`}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-black text-slate-950 dark:text-slate-100">
                        {displayName(team.name)}
                      </div>
                      <div className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">
                        Now #{team.rank} · Projected #{team.projectedRank} · Range #{range.best}–#
                        {range.worst}
                      </div>
                    </div>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-xs ring-1 ring-slate-200">
                      {tier}
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs font-semibold">
                    <div className="rounded-lg bg-white p-3 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
                      <div className="text-slate-500 dark:text-slate-400">Gold</div>
                      <div className="mt-1 text-slate-950 dark:text-slate-100">
                        {formatGoldPct(team)}
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400">
                        {formatGoldMargin(team)} · {confidence.label}
                      </div>
                    </div>
                    <div className="rounded-lg bg-white p-3 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
                      <div className="text-slate-500 dark:text-slate-400">SOS</div>
                      <div className="mt-1 text-slate-950 dark:text-slate-100">{sos.label}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {hasCutLine && projectedCutLineTeams.length > 0 && (
        <section className={`${card} p-5`}>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-100">
              Projected Cut Line Games
            </h3>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              Next Two
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {projectedCutLineTeams.slice(0, 6).map((team) => {
              const swings = nextTwoSwingGames(team.id);
              if (!swings.length) return null;
              return (
                <div
                  key={`model-swing-${team.id}`}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800"
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="font-black text-slate-950 dark:text-slate-100">
                      {displayName(team.name)}
                    </div>
                    <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                      #{team.rank} now · #{team.projectedRank} projected
                    </div>
                  </div>
                  <div className="space-y-2">
                    {swings.map((swing) => (
                      <div
                        key={swing.game.id}
                        className="rounded-lg bg-white p-3 text-sm shadow-xs ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-black text-slate-950 dark:text-slate-100">
                            {swing.teamIsAway ? "at" : "vs"} {swing.opponentName}
                          </span>
                          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                            {formatGameDate(swing.game.date)}
                          </span>
                        </div>
                        <div className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">
                          Model: {swing.modelPick} · {Math.round(swing.winPct * 100)}% team win
                          chance
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs font-bold">
                          <div className="rounded-lg bg-emerald-50 px-2 py-2 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                            Win: #{swing.winSeed}
                          </div>
                          <div className="rounded-lg bg-red-50 px-2 py-2 text-red-700 dark:bg-red-950/40 dark:text-red-300">
                            Loss: #{swing.lossSeed}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className={`${card} p-5`}>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-100">
            Game Projections
          </h3>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {gameForecasts.length} Projections
          </span>
        </div>
        {gameForecasts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-800/40 p-8 text-center font-bold text-slate-500">
            No remaining games to project.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {gameForecasts.map((item) => {
              const margin = Math.abs(item.prediction.awayScore - item.prediction.homeScore);
              const runLine = projectedRunLine(item.prediction, byId);
              const upsetRisk = upsetRiskLabel(item.winnerPct, margin);
              return (
                <article
                  key={`game-forecast-${item.game.id}`}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-4 shadow-xs dark:border-slate-700 dark:bg-slate-800"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        {item.game.date
                          ? `${item.sourceLabel} · ${formatGameDate(item.game.date)}`
                          : item.sourceLabel}
                      </div>
                      <div className="mt-1 text-base font-black tracking-tight text-slate-950 dark:text-slate-100">
                        {item.awayName} at {item.homeName}
                      </div>
                    </div>
                    <div className="rounded-lg bg-white px-3 py-2 text-right shadow-xs ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Pick
                      </div>
                      <div className="text-sm font-bold text-slate-950 dark:text-slate-100">
                        {item.winnerName}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs font-semibold">
                    <div className="rounded-lg bg-white p-3 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
                      <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Spread
                      </div>
                      <div className="mt-1 text-base text-slate-950 dark:text-slate-100">
                        {runLine}
                      </div>
                    </div>
                    <div className="rounded-lg bg-white p-3 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
                      <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Chance
                      </div>
                      <div className="mt-1 text-base text-slate-950 dark:text-slate-100">
                        {Math.round(item.winnerPct * 100)}%
                      </div>
                    </div>
                    <div className="rounded-lg bg-white p-3 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
                      <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Upset Risk
                      </div>
                      <div className="mt-1 text-base text-slate-950 dark:text-slate-100">
                        {upsetRisk}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <span
                      className={
                        item.prediction.confidence === "High"
                          ? pill("emerald")
                          : item.prediction.confidence === "Medium"
                            ? pill("blue")
                            : pill("neutral")
                      }
                    >
                      {item.prediction.confidence} Confidence
                    </span>
                    {margin <= 2 && <span className={pill("amber")}>Toss-Up</span>}
                    <span
                      className={
                        item.impact?.impactLabel === "High"
                          ? pill("red")
                          : item.impact?.impactLabel === "Medium"
                            ? pill("blue")
                            : pill("neutral")
                      }
                    >
                      Seed Impact: {item.impact?.impactLabel ?? "—"}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
      <SeasonTimelinePanel entries={timelineEntries} />

      <ModelHealthPanel backtestResult={backtestResult} cardClassName={card} />
    </section>
  );
}

function SeasonManager({
  seasons,
  activeSeasonId,
  onSwitch,
  onCreate,
  onDuplicate,
  onDelete,
}: {
  seasons: SeasonMeta[];
  activeSeasonId: string;
  onSwitch: (id: string) => void;
  onCreate: (name: string) => void;
  onDuplicate: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [newName, setNewName] = useState("");
  const chip =
    "rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800";
  const createNew = () => {
    if (!newName.trim()) return;
    onCreate(newName.trim());
    setNewName("");
  };
  return (
    <section className={`${card} p-5`} aria-label="Seasons">
      <h2 className="text-2xl font-black tracking-tight text-slate-950 dark:text-slate-100">
        Seasons
      </h2>
      <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
        Run several seasons side by side. Each keeps its own teams, games, scores, and settings —
        switching is instant and nothing is overwritten. Rename the active season with the “Season
        label” field below.
      </p>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") createNew();
          }}
          placeholder="New season name"
          aria-label="New season name"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-900 shadow-xs dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 sm:max-w-xs"
        />
        <button
          type="button"
          onClick={createNew}
          disabled={!newName.trim()}
          className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white shadow-xs hover:bg-slate-800 disabled:opacity-40 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
        >
          New Season
        </button>
      </div>

      <ul className="mt-4 space-y-2">
        {seasons.map((season) => {
          const isActive = season.id === activeSeasonId;
          return (
            <li
              key={season.id}
              className={`flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between ${
                isActive
                  ? "border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30"
                  : "border-slate-200 dark:border-slate-700"
              }`}
            >
              <div className="flex min-w-0 items-center gap-2">
                {isActive && (
                  <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                    Active
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-900 dark:text-slate-100">
                  {season.name}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {!isActive && (
                  <button type="button" className={chip} onClick={() => onSwitch(season.id)}>
                    Switch
                  </button>
                )}
                <button
                  type="button"
                  className={chip}
                  onClick={() => onDuplicate(season.id, `${season.name} copy`)}
                >
                  Duplicate
                </button>
                {seasons.length > 1 && (
                  <button
                    type="button"
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 dark:border-red-900/70 dark:text-red-300 dark:hover:bg-red-950/30"
                    onClick={() => onDelete(season.id)}
                  >
                    Delete
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function SettingsView({
  settings,
  setSettings,
  teamsCount,
  importCSV,
  importBackup,
  exportCSV,
  exportBackup,
  resetSeason,
  loadDemoSeason,
}: {
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  teamsCount: number;
  importCSV: (file: File) => void;
  importBackup: (file: File) => void;
  exportCSV: () => void;
  exportBackup: () => void;
  resetSeason: () => void;
  loadDemoSeason: () => void;
}) {
  const seasonId = useId();
  const cutoffId = useId();
  const postseasonId = useId();
  const trackErrorsId = useId();
  const winId = useId();
  const tieId = useId();
  const regularSeasonGamesId = useId();
  const defaultInningsId = useId();
  const maxRunDifferentialId = useId();
  const pitchModeId = useId();
  const aggrId = useId();
  const recapId = useId();
  const tiebreakerId = useId();
  const updateTiebreaker = (index: number, value: TiebreakerSelectValue) => {
    setSettings((prev) => {
      const next: Array<TiebreakerFactor | undefined> = [...prev.tiebreakerOrder];
      next[index] = value === "none" ? undefined : value;
      return {
        ...prev,
        tiebreakerOrder: next.filter(
          (factor, factorIndex): factor is TiebreakerFactor =>
            factor !== undefined && next.indexOf(factor) === factorIndex
        ),
      };
    });
  };

  return (
    <section className="grid grid-cols-1 gap-6">
      <div className={`${card} p-6`}>
        <h2 className="text-2xl font-black tracking-tight text-slate-950 dark:text-slate-100">
          Settings
        </h2>
        <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
          <label htmlFor={seasonId} className="block">
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Season</span>
            <input
              id={seasonId}
              value={settings.seasonLabel}
              onChange={(event) =>
                setSettings((prev) => ({ ...prev, seasonLabel: event.target.value }))
              }
              placeholder="Spring 26"
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 font-bold text-slate-950 outline-hidden focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
            />
          </label>
          <label htmlFor={postseasonId} className="block">
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Postseason</span>
            <select
              id={postseasonId}
              value={settings.postseasonFormat}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  postseasonFormat: event.target.value as PostseasonFormat,
                }))
              }
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 font-bold text-slate-950 outline-hidden focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
            >
              <option value="cut">Cut line — top teams make the bracket</option>
              <option value="all">Bracket, no cut — every team qualifies</option>
              <option value="none">No postseason — regular season only</option>
            </select>
            <span className="mt-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">
              {settings.postseasonFormat === "cut"
                ? "Standings show Gold odds, playoff status and the cut line."
                : settings.postseasonFormat === "all"
                  ? "Everyone is seeded into the bracket, so there are no Gold odds or bubble."
                  : "Standings only. No bracket, Gold odds, clinching or magic numbers."}
            </span>
          </label>
          {settings.postseasonFormat === "cut" && (
            <label htmlFor={cutoffId} className="block">
              <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
                Gold Cutoff
              </span>
              <input
                id={cutoffId}
                type="number"
                min={1}
                max={Math.max(1, teamsCount)}
                value={settings.goldCutoff}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    goldCutoff: Number(event.target.value),
                  }))
                }
                className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 font-bold text-slate-950 outline-hidden focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
              />
            </label>
          )}
          <label htmlFor={winId} className="block">
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Win Points</span>
            <input
              id={winId}
              type="number"
              step="0.5"
              min={0}
              value={settings.winPoints}
              onChange={(event) =>
                setSettings((prev) => ({ ...prev, winPoints: Number(event.target.value) }))
              }
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 font-bold text-slate-950 outline-hidden focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
            />
          </label>
          <label htmlFor={tieId} className="block">
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Tie Points</span>
            <input
              id={tieId}
              type="number"
              step="0.5"
              min={0}
              value={settings.tiePoints}
              onChange={(event) =>
                setSettings((prev) => ({ ...prev, tiePoints: Number(event.target.value) }))
              }
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 font-bold text-slate-950 outline-hidden focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
            />
          </label>
          <label htmlFor={regularSeasonGamesId} className="block">
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
              Regular Season Games / Team
            </span>
            <input
              id={regularSeasonGamesId}
              type="number"
              min={0}
              value={settings.regularSeasonGamesPerTeam}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  regularSeasonGamesPerTeam: Number(event.target.value),
                }))
              }
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 font-bold text-slate-950 outline-hidden focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
            />
          </label>

          <label htmlFor={defaultInningsId} className="block">
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
              Default Innings / Game
            </span>
            <select
              id={defaultInningsId}
              value={settings.defaultGameInnings}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  defaultGameInnings: Number(event.target.value),
                }))
              }
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 font-bold text-slate-950 outline-hidden focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
            >
              {[5, 6, 7].map((innings) => (
                <option key={innings} value={innings}>
                  {innings} innings
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">
              New games and blank round-robin schedules use this innings value by default.
            </p>
          </label>

          <label htmlFor={maxRunDifferentialId} className="block">
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
              Max Run Differential
            </span>
            <select
              id={maxRunDifferentialId}
              value={settings.autoRunDiffCap ? "auto" : String(settings.maxRunDifferential)}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "auto") {
                  setSettings((prev) => ({ ...prev, autoRunDiffCap: true }));
                } else {
                  setSettings((prev) => ({
                    ...prev,
                    autoRunDiffCap: false,
                    maxRunDifferential: Number(value),
                  }));
                }
              }}
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 font-bold text-slate-950 outline-hidden focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
            >
              <option value="auto">Auto (by format)</option>
              {[8, 10].map((runs) => (
                <option key={runs} value={String(runs)}>
                  {runs} runs
                </option>
              ))}
              <option value="0">No cap</option>
            </select>
            <p className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">
              Standings, ratings, and projections cap each game&apos;s run-differential credit at
              this amount. <strong>Auto</strong> uses 8 runs for machine/coach pitch (per-inning run
              limit) and 12 for player pitch (9U+ has no run limit).
            </p>
          </label>

          <label htmlFor={pitchModeId} className="block">
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
              Pitch Format
            </span>
            <select
              id={pitchModeId}
              value={settings.pitchMode}
              onChange={(event) =>
                setSettings((prev) => ({ ...prev, pitchMode: event.target.value as PitchMode }))
              }
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 font-bold text-slate-950 outline-hidden focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
            >
              <option value="machine">Machine Pitch</option>
              <option value="coach">Coach Pitch</option>
              <option value="player">Kid Pitch</option>
            </select>
            <p className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">
              Machine Pitch and Coach Pitch use R/H/K. Kid Pitch uses R/H/E/BB; BB means walks drawn
              by that team&apos;s hitters.
            </p>
          </label>

          {settings.pitchMode === "player" && (
            <label htmlFor={trackErrorsId} className="block">
              <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
                Score Errors
              </span>
              <select
                id={trackErrorsId}
                value={settings.trackErrors ? "yes" : "no"}
                onChange={(event) =>
                  setSettings((prev) => ({ ...prev, trackErrors: event.target.value === "yes" }))
                }
                className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 font-bold text-slate-950 outline-hidden focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
              >
                <option value="yes">Yes — track fielding errors</option>
                <option value="no">No — do not score errors</option>
              </select>
              <p className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">
                Turn this off if your league does not record errors. The E box disappears from score
                entry and E/G drops out of the stat pages; already-entered errors are kept.
              </p>
            </label>
          )}

          <label htmlFor={aggrId} className="block">
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
              Model Aggression
            </span>
            <select
              id={aggrId}
              value={settings.modelAggression}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  modelAggression: event.target.value as ModelAggression,
                }))
              }
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 font-bold text-slate-950 outline-hidden focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
            >
              <option value="Conservative">Conservative</option>
              <option value="Balanced">Balanced</option>
              <option value="Aggressive">Aggressive</option>
            </select>
          </label>
          <label htmlFor={recapId} className="block">
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
              Recap Grouping
            </span>
            <select
              id={recapId}
              value={settings.recapGrouping}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  recapGrouping: event.target.value as RecapGrouping,
                }))
              }
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 font-bold text-slate-950 outline-hidden focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
            >
              <option value="game">Per Game</option>
              <option value="date">Per Date</option>
              <option value="week">Per Week (ending Sunday)</option>
            </select>
          </label>
          <fieldset
            className="rounded-lg border border-slate-300 p-4 dark:border-slate-600 md:col-span-2"
            aria-labelledby={tiebreakerId}
          >
            <legend
              id={tiebreakerId}
              className="px-1 text-sm font-bold text-slate-700 dark:text-slate-200"
            >
              League Tiebreaker Order
            </legend>
            <p className="mt-3 text-sm font-semibold text-slate-600 dark:text-slate-300">
              Winning percentage is always applied first. Head-to-head is only applied to two-team
              ties.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
              {[0, 1, 2, 3].map((index) => (
                <label key={index} className="block">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Tie-break {index + 1}
                  </span>
                  <select
                    value={settings.tiebreakerOrder[index] ?? "none"}
                    onChange={(event) =>
                      updateTiebreaker(index, event.target.value as TiebreakerSelectValue)
                    }
                    className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 font-bold text-slate-950 outline-hidden focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
                    aria-label={`Tie-break ${index + 1}`}
                  >
                    <option value="none">None</option>
                    {TIEBREAKER_FACTORS.map((factor) => (
                      <option key={factor} value={factor}>
                        {TIEBREAKER_LABELS[factor]}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="mt-4 flex flex-col gap-2 border-t border-slate-200 pt-4 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                Match USSSA pool-play seeding: Win % → Head-to-head → Avg Runs Allowed → Avg Run
                Differential (capped at 8).
              </p>
              <button
                type="button"
                onClick={() =>
                  setSettings((prev) => ({
                    ...prev,
                    tiebreakerOrder: ["headToHead", "runsAgainst", "runDifferential"],
                    maxRunDifferential: 8,
                    autoRunDiffCap: false,
                    runDiffTiebreaker: true,
                  }))
                }
                className="shrink-0 rounded-lg bg-slate-950 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white shadow-xs hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
              >
                Use USSSA preset
              </button>
            </div>
          </fieldset>
        </div>

        <div className="mt-8 rounded-lg border border-slate-200 bg-slate-50 p-5">
          <h3 className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-100">
            Data
          </h3>
          <div className="mt-4 flex flex-wrap gap-3">
            <label className="cursor-pointer rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white shadow-xs hover:bg-slate-800">
              Import CSV
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                aria-label="Import schedule CSV"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) importCSV(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            <label className="cursor-pointer rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 shadow-xs hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700">
              Import Backup JSON
              <input
                type="file"
                accept=".json,application/json"
                className="hidden"
                aria-label="Import backup JSON"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) importBackup(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            <button
              onClick={exportCSV}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 shadow-xs hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              Export CSV
            </button>
            <button
              onClick={exportBackup}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 shadow-xs hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              Backup JSON
            </button>
            <button
              onClick={loadDemoSeason}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 shadow-xs hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              Load Demo
            </button>
            <button onClick={resetSeason} className={buttonClasses.danger}>
              Reset Season
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function GamesView({
  teams,
  matchups: _matchups,
  logs,
  scoreboardGames,
  scoreboardPredictions,
  scoreboardTeamFilter,
  pitchMode,
  trackErrors,
  setScoreboardTeamFilter,
  newDate,
  setNewDate,
  newAway,
  setNewAway,
  newHome,
  setNewHome,
  addGameValid,
  addGame,
  toggleFinal,
  swapGame,
  removeGame,
  updateLog,
  setMatchups,
  gameStatusClasses,
  seasonGamesFinalized,
  bracketProjection,
  silverBracketProjection,
  updateBracketLog,
  toggleBracketFinal,
}: {
  teams: TeamBase[];
  matchups: Matchup[];
  logs: Record<string, GameLog>;
  scoreboardGames: Matchup[];
  scoreboardPredictions: Map<
    string,
    {
      spread: string;
      pickName: string;
      pickPct: number;
      scenarioBadges: string[];
      impactScore: number;
    }
  >;
  scoreboardTeamFilter: string;
  pitchMode: PitchMode;
  trackErrors: boolean;
  setScoreboardTeamFilter: (v: string) => void;
  newDate: string;
  setNewDate: (v: string) => void;
  newAway: string;
  setNewAway: (v: string) => void;
  newHome: string;
  setNewHome: (v: string) => void;
  addGameValid: boolean;
  addGame: () => void;
  toggleFinal: (id: string) => void;
  swapGame: (id: string) => void;
  removeGame: (id: string) => void;
  updateLog: (id: string, field: keyof GameLog, value: string | boolean) => void;
  setMatchups: React.Dispatch<React.SetStateAction<Matchup[]>>;
  gameStatusClasses: (s: string) => string;
  seasonGamesFinalized: boolean;
  bracketProjection: ReturnType<typeof buildBracketProjection>;
  silverBracketProjection: ReturnType<typeof buildBracketProjection>;
  updateBracketLog: (gameId: string, field: keyof GameLog, value: string | boolean) => void;
  toggleBracketFinal: (gameId: string) => void;
}) {
  const dateId = useId();
  const awayId = useId();
  const homeId = useId();
  const filterId = useId();
  const [quickFilter, setQuickFilter] = useState<"all" | "open" | "today">("all");

  const todayKey = useMemo(() => {
    const now = new Date();
    return `${now.getUTCMonth() + 1}/${now.getUTCDate()}`;
  }, []);

  const handleToggleFinal = useCallback(
    (gameId: string) => {
      const priorScrollY = window.scrollY;
      toggleFinal(gameId);
      requestAnimationFrame(() => {
        window.scrollTo({ top: priorScrollY });
      });
    },
    [toggleFinal]
  );
  const visibleGames = useMemo(() => {
    if (quickFilter === "open") return scoreboardGames.filter((g) => !isFinal(logs[g.id]));
    if (quickFilter === "today") {
      return scoreboardGames.filter(
        (g) => normalizeDateInput(g.date) === normalizeDateInput(todayKey)
      );
    }
    return scoreboardGames;
  }, [quickFilter, scoreboardGames, logs, todayKey]);
  const tournamentGames = useMemo(() => {
    if (!seasonGamesFinalized || quickFilter === "today") return [];

    const inSelectedTeamFilter = (game: BracketGameProjection) => {
      if (scoreboardTeamFilter === "ALL") return true;
      return (
        game.matchup?.away === scoreboardTeamFilter || game.matchup?.home === scoreboardTeamFilter
      );
    };

    return [
      ...bracketProjection.rounds.flatMap((round) =>
        round.map((game) => ({ game, bracketLabel: "Gold Bracket" }))
      ),
      ...silverBracketProjection.rounds.flatMap((round) =>
        round.map((game) => ({ game, bracketLabel: "Silver Bracket" }))
      ),
    ]
      .filter(({ game }) => game.matchup && inSelectedTeamFilter(game))
      .filter(({ game }) => quickFilter !== "open" || !isFinal(game.log))
      .sort(
        (a, b) =>
          a.game.roundIndex - b.game.roundIndex ||
          a.bracketLabel.localeCompare(b.bracketLabel) ||
          a.game.gameIndex - b.game.gameIndex
      );
  }, [
    seasonGamesFinalized,
    quickFilter,
    scoreboardTeamFilter,
    bracketProjection,
    silverBracketProjection,
  ]);

  const nextOpenGameId = useMemo(
    () => scoreboardGames.find((game) => !isFinal(logs[game.id]))?.id ?? null,
    [scoreboardGames, logs]
  );
  const jumpToNextOpen = useCallback(() => {
    if (!nextOpenGameId) return;
    document.getElementById(`game-card-${nextOpenGameId}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [nextOpenGameId]);

  // A finished game is a result to read, not a form to fill, so it collapses to
  // one line. Re-opening one puts the full card back for a correction.
  const [expandedFinals, setExpandedFinals] = useState<Record<string, boolean>>({});
  const toggleExpandedFinal = useCallback((gameId: string) => {
    setExpandedFinals((prev) => ({ ...prev, [gameId]: !prev[gameId] }));
  }, []);

  return (
    <section className="space-y-6">
      <div className={`${card} p-5`}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[140px_1fr_1fr_auto]">
          <div>
            <label htmlFor={dateId} className="sr-only">
              Game date
            </label>
            <GameDateInput
              value={newDate}
              onCommit={(v) => setNewDate(v)}
              ariaLabel="New game date (M/D)"
            />
            <input id={dateId} type="hidden" value={newDate} readOnly aria-hidden="true" />
          </div>
          <label htmlFor={awayId} className="block">
            <span className="sr-only">Away team</span>
            <select
              id={awayId}
              value={newAway}
              onChange={(event) => setNewAway(event.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-bold text-slate-950 outline-hidden focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
            >
              <option value="">Away team…</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {displayName(team.name)}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor={homeId} className="block">
            <span className="sr-only">Home team</span>
            <select
              id={homeId}
              value={newHome}
              onChange={(event) => setNewHome(event.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-bold text-slate-950 outline-hidden focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
            >
              <option value="">Home team…</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {displayName(team.name)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={addGame}
            disabled={!addGameValid}
            className="rounded-lg bg-slate-950 px-5 py-2 font-black text-white shadow-xs hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
          >
            Add Game
          </button>
        </div>
        {!addGameValid && (newAway || newHome) && (
          <p className="mt-2 text-xs font-bold text-amber-600">
            Pick two different teams to add a game.
          </p>
        )}
      </div>

      <div className={`${card} p-4`}>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <label
            htmlFor={filterId}
            className="text-sm font-bold text-slate-700 dark:text-slate-200"
          >
            Scoreboard Filter
          </label>
          <select
            id={filterId}
            value={scoreboardTeamFilter}
            onChange={(event) => setScoreboardTeamFilter(event.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-950 outline-hidden focus:border-slate-950 md:w-72 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
          >
            <option value="ALL">All Teams</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {displayName(team.name)}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setQuickFilter("all")}
            className={tab(quickFilter === "all")}
          >
            All Games
          </button>
          <button
            type="button"
            onClick={() => setQuickFilter("open")}
            className={tab(quickFilter === "open")}
          >
            Open Games
          </button>
          <button
            type="button"
            onClick={() => setQuickFilter("today")}
            className={tab(quickFilter === "today")}
          >
            Today
          </button>
          <button
            type="button"
            onClick={jumpToNextOpen}
            disabled={!nextOpenGameId}
            className="ml-auto rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            Next Unfinalized
          </button>
        </div>
      </div>

      {visibleGames.length === 0 && tournamentGames.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm font-bold text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          {seasonGamesFinalized ? "No games match this filter." : "No games yet."}
        </div>
      ) : null}

      {visibleGames.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {visibleGames.map((game) => {
            const log = logs[game.id] || EMPTY_GAME_LOG;
            const away = teams.find((team) => team.id === game.away);
            const home = teams.find((team) => team.id === game.home);
            const final = isFinal(log);
            const hasEnteredScore = log.awayRuns.trim() !== "" && log.homeRuns.trim() !== "";
            const prediction = scoreboardPredictions.get(game.id);
            if (final && !expandedFinals[game.id]) {
              return (
                <FinalGameRow
                  key={game.id}
                  id={`game-card-${game.id}`}
                  date={game.date}
                  awayName={away?.name || game.away}
                  homeName={home?.name || game.home}
                  awayRuns={log.awayRuns}
                  homeRuns={log.homeRuns}
                  onEdit={() => toggleExpandedFinal(game.id)}
                />
              );
            }
            return (
              <article
                key={game.id}
                id={`game-card-${game.id}`}
                className={`overflow-hidden rounded-lg border bg-white shadow-xs dark:border-slate-700 dark:bg-slate-900 ${
                  final
                    ? "border-slate-200 opacity-80 dark:border-slate-700"
                    : "border-slate-200 dark:border-slate-700"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/50">
                  <GameDateInput
                    value={game.date}
                    ariaLabel={`Date for ${displayName(away?.name || game.away)} vs ${displayName(home?.name || game.home)}`}
                    onCommit={(nextDate) =>
                      setMatchups((prev) =>
                        prev.map((item) =>
                          item.id === game.id ? { ...item, date: nextDate } : item
                        )
                      )
                    }
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.currentTarget.blur();
                        handleToggleFinal(game.id);
                      }}
                      className={`rounded-lg px-3 py-1 text-xs font-black ${
                        final ? "bg-emerald-600 text-white" : "bg-slate-950 text-white"
                      }`}
                      aria-label={final ? "Mark game as scheduled" : "Mark game as final"}
                    >
                      {final ? "Final" : "Scheduled"}
                    </button>
                    <button
                      type="button"
                      onClick={() => swapGame(game.id)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      aria-label="Swap home and away teams"
                    >
                      Swap
                    </button>
                    <button
                      type="button"
                      onClick={() => removeGame(game.id)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-red-600 dark:border-slate-600 dark:bg-slate-800"
                      aria-label="Delete game"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div className="space-y-4 p-4">
                  {!final && prediction ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-white px-3 py-1 text-slate-700 shadow-xs ring-1 ring-slate-200">
                          Spread: {prediction.spread}
                        </span>
                        {prediction.scenarioBadges.map((badge) => (
                          <span
                            key={badge}
                            className={`rounded-full px-3 py-1 ${gameStatusClasses(badge)}`}
                          >
                            {badge}
                          </span>
                        ))}
                      </div>
                      <span className="text-slate-500">
                        Pick: {prediction.pickName} · {Math.round(prediction.pickPct * 100)}%
                      </span>
                    </div>
                  ) : !final ? (
                    <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
                      Prediction queued in the background — score entry and final verification are
                      ready now.
                    </div>
                  ) : null}
                  <ScoreRow
                    teamName={away?.name || game.away}
                    prefix="away"
                    log={log}
                    onChange={(field, value) => updateLog(game.id, field, value)}
                    pitchMode={pitchMode}
                    trackErrors={trackErrors}
                  />
                  <ScoreRow
                    teamName={home?.name || game.home}
                    prefix="home"
                    log={log}
                    onChange={(field, value) => updateLog(game.id, field, value)}
                    pitchMode={pitchMode}
                    trackErrors={trackErrors}
                  />
                  <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-sm font-bold text-slate-500 dark:text-slate-400">
                    <label className="flex items-center gap-2">
                      Innings
                      <input
                        value={log.innings}
                        onChange={(event) =>
                          updateLog(
                            game.id,
                            "innings",
                            event.target.value.replace(/[^0-9]/g, "").slice(0, 2)
                          )
                        }
                        onBlur={(event) => {
                          const n = clamp(parseNumber(event.target.value, 6), 1, 10);
                          updateLog(game.id, "innings", String(n));
                        }}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={2}
                        aria-label="Innings played"
                        className="w-14 rounded-lg border border-slate-300 bg-white px-2 py-1 text-center font-black text-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      />
                    </label>
                    <span>
                      {final
                        ? `Final · ${formatGameDate(game.date)}`
                        : hasEnteredScore
                          ? "Scores entered — verify final"
                          : (game.date ?? "").trim()
                            ? formatGameDateLong(game.date)
                            : "Needs Date"}
                    </span>
                    {!final && (
                      <button
                        type="button"
                        onClick={() => handleToggleFinal(game.id)}
                        className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white"
                      >
                        {hasEnteredScore ? "Verify Final" : "Save + Final"}
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {tournamentGames.length > 0 && (
        <div className="space-y-4">
          <div className={`${card} p-4`}>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Tournament Schedule
            </div>
            <h3 className="mt-1 text-lg font-black text-slate-950 dark:text-slate-100">
              Bracket games are ready for score entry
            </h3>
            <p className="mt-1 text-sm font-bold text-slate-500 dark:text-slate-400">
              All regular-season games are finalized, so Gold and Silver tournament matchups now
              appear here alongside the bracket predictor.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {tournamentGames.map(({ game, bracketLabel }) => {
              const matchup = game.matchup;
              if (!matchup) return null;
              const away = teams.find((team) => team.id === matchup.away);
              const home = teams.find((team) => team.id === matchup.home);
              const final = isFinal(game.log);
              const hasEnteredScore =
                game.log.awayRuns.trim() !== "" && game.log.homeRuns.trim() !== "";
              const pickPct =
                game.prediction && game.predictedWinnerId
                  ? game.predictedWinnerId === matchup.away
                    ? game.prediction.awayWinPct
                    : 1 - game.prediction.awayWinPct
                  : null;
              const winnerLabel =
                game.winnerSource === "actual"
                  ? "Actual winner"
                  : game.winnerSource === "bye"
                    ? "Bye advance"
                    : game.winnerSource === "projected"
                      ? "Model pick"
                      : "Pending";

              return (
                <article
                  key={game.id}
                  className={`overflow-hidden rounded-lg border bg-white shadow-xs dark:border-slate-700 dark:bg-slate-900 ${
                    final
                      ? "border-slate-200 opacity-80 dark:border-slate-700"
                      : "border-slate-200 dark:border-slate-700"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/50">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        {bracketLabel} · {game.roundName} · Game {game.gameIndex + 1}
                      </div>
                      <div className="mt-1 text-sm font-bold text-slate-950 dark:text-slate-100">
                        {winnerLabel}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleBracketFinal(game.id)}
                      className={`rounded-lg px-3 py-1 text-xs font-black ${
                        final ? "bg-emerald-600 text-white" : "bg-slate-950 text-white"
                      }`}
                      aria-label={
                        final
                          ? "Mark tournament game as scheduled"
                          : "Mark tournament game as final"
                      }
                    >
                      {final ? "Final" : "Scheduled"}
                    </button>
                  </div>
                  <div className="space-y-4 p-4">
                    {!final && game.prediction && pickPct !== null && (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-800/50">
                        <span className="rounded-full bg-white px-3 py-1 text-slate-700 shadow-xs ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700">
                          Model score: {game.prediction.awayScore}-{game.prediction.homeScore}
                        </span>
                        <span className="text-slate-500 dark:text-slate-400">
                          Bracket pick · {Math.round(pickPct * 100)}%
                        </span>
                      </div>
                    )}
                    <ScoreRow
                      teamName={away?.name || matchup.away}
                      prefix="away"
                      log={game.log}
                      onChange={(field, value) => updateBracketLog(game.id, field, value)}
                      pitchMode={pitchMode}
                      trackErrors={trackErrors}
                    />
                    <ScoreRow
                      teamName={home?.name || matchup.home}
                      prefix="home"
                      log={game.log}
                      onChange={(field, value) => updateBracketLog(game.id, field, value)}
                      pitchMode={pitchMode}
                      trackErrors={trackErrors}
                    />
                    <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-sm font-bold text-slate-500 dark:border-slate-800 dark:text-slate-400">
                      <span>
                        {final
                          ? `Final · ${bracketLabel}`
                          : hasEnteredScore
                            ? "Scores entered — verify final"
                            : `${game.roundName} score entry`}
                      </span>
                      {!final && (
                        <button
                          type="button"
                          onClick={() => toggleBracketFinal(game.id)}
                          className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white"
                        >
                          {hasEnteredScore ? "Verify Final" : "Save + Final"}
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

// expose for tree-shake-friendly use in DEFAULT_SETTINGS test imports
export { DEFAULT_SETTINGS };
