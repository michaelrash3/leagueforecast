import { useCallback, useMemo, useState } from "react";
import type { BacktestResult } from "../lib/backtest";
import { displayName } from "../lib/format";
import { recapToStoryBrief } from "../lib/insights";
import { buildForecastSummaryRequest, buildLeagueSummaryRequest } from "../lib/leagueSummaryClient";
import type { PredictionEngineResult } from "../lib/predictionEngine";
import { readSummaryMode, type SummaryMode, writeSummaryMode } from "../lib/preferences";
import type { StatRankings } from "../lib/teamStats";
import type {
  ActiveShareView,
  LastImpact,
  Matchup,
  Settings,
  TeamWithProjection,
} from "../lib/types";
import type { useGameForecasts } from "./useGameForecasts";
import type { useGoldRace } from "./useGoldRace";
import { useLeagueSummary } from "./useLeagueSummary";
import type { SeedRange } from "./useSeedRanges";

/** What `useLeagueStory` reads of App, each by the name App gives it. */
export type LeagueStoryInputs = {
  activeView: ActiveShareView;
  backtestResult: BacktestResult;
  completedGames: Matchup[];
  currentLeader: TeamWithProjection | undefined;
  dashboardRows: TeamWithProjection[];
  gameForecasts: ReturnType<typeof useGameForecasts>["gameForecasts"];
  gamesThatMatterMost: ReturnType<typeof useGoldRace>["gamesThatMatterMost"];
  goldCutoff: number;
  hasCutLine: boolean;
  lastImpact: LastImpact | null;
  matchups: Matchup[];
  modelRows: TeamWithProjection[];
  predictionEngine: PredictionEngineResult;
  seedRangeForTeam: (teamId: string) => SeedRange | null;
  settings: Settings;
  statRankings: StatRankings;
  statusLabel: (team: TeamWithProjection) => string;
};

/**
 * The League Standings story: the recap of the last change to the season, told from the facts
 * alone; the AI's rewrite of the same facts, asked for only once there is movement to describe;
 * the Forecast's write-up, asked for only while the Forecast is open; and whether the write-ups
 * fetch themselves at all, a setting kept on this device and read everywhere at once.
 *
 * App.tsx worked these out under "Header / selection". They moved here whole and are called where
 * they were, so both write-ups' requests are made in the order they were.
 */
export function useLeagueStory({
  activeView,
  backtestResult,
  completedGames,
  currentLeader,
  dashboardRows,
  gameForecasts,
  gamesThatMatterMost,
  goldCutoff,
  hasCutLine,
  lastImpact,
  matchups,
  modelRows,
  predictionEngine,
  seedRangeForTeam,
  settings,
  statRankings,
  statusLabel,
}: LeagueStoryInputs) {
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
        /*
         * None while the walk is paused, and then the writer is told none. Told the projection at
         * both ends as each team's realistic seed range, it had a finish nothing left to play
         * could move to write about, beside a table that said the range was paused.
         */
        const range = seedRangeForTeam(team.id);
        return {
          name: team.name,
          projectedRank: team.projectedRank,
          currentRank: team.rank,
          projectedRecord: team.projectedRecord,
          goldPct: team.goldPct,
          goldMargin: team.goldPctMargin,
          bestSeed: range?.best,
          worstSeed: range?.worst,
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

  return { aiStory, forecastStory, setSummaryMode, storyText, summaryMode };
}
