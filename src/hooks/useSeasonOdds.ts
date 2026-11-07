import { useMemo } from "react";
import { backtestPredictions } from "../lib/backtest";
import { rememberLast } from "../lib/rememberLast";
import { simulationSeed } from "../lib/sim";
import type { LeagueScoutBridge, ScoutBridgeResult } from "../lib/teamRankings/leagueBridge";
import { buildTrendStates } from "../lib/trend";
import {
  type ActiveShareView,
  DEFAULT_SETTINGS,
  type GameLog,
  type Matchup,
  type Settings,
  SIM_ITERATIONS,
  type Team,
  type TeamBase,
  TREND_ITERATIONS,
  TREND_STATES,
} from "../lib/types";
import { useSimulationBracket, useSimulationOdds, useSimulationTrend } from "./useSimulationWorker";

/*
 * The heavier of the two calculations one tab alone shows, remembering its last answer, so going
 * back to its tab on an unchanged season gives it at once (`rememberLast`, 2.2); and what stands in
 * for it while no tab showing it is open. The other, the Forecast's timeline, is `useGoldRace`'s.
 */
const rememberedBacktest = rememberLast(backtestPredictions);
const NO_BACKTEST = backtestPredictions([], [], {}, DEFAULT_SETTINGS);

/** What `useSeasonOdds` reads of App, each by the name App gives it. */
export type SeasonOddsInputs = {
  activeView: ActiveShareView;
  bracketLogs: Record<string, GameLog>;
  completedGames: Matchup[];
  externalResults: ScoutBridgeResult[];
  finalLogs: Record<string, GameLog>;
  goldCutoff: number;
  hasCutLine: boolean;
  liveTeams: Team[];
  matchups: Matchup[];
  ourTeamId: string | null;
  remainingGames: Matchup[];
  scoutBridge: LeagueScoutBridge;
  seasonSettings: Settings;
  settings: Settings;
  teams: TeamBase[];
};

/**
 * The season's odds, as the Dashboard, the Standings and the Forecast read them: every team's
 * Gold % and its spread of places, simulated in the worker from the games left, with how each of
 * those games moves the followed team's; the line of Gold % over the season, played forward from
 * each date; the brackets' odds while the Forecast is open; and how the model has done on the
 * games already played.
 *
 * App.tsx worked these out under "Worker-driven odds + trend". They moved here whole and are
 * called where they were, so the three simulations' workers are started, and their memos run, in
 * the order they were.
 */
export function useSeasonOdds({
  activeView,
  bracketLogs,
  completedGames,
  externalResults,
  finalLogs,
  goldCutoff,
  hasCutLine,
  liveTeams,
  matchups,
  ourTeamId,
  remainingGames,
  scoutBridge,
  seasonSettings,
  settings,
  teams,
}: SeasonOddsInputs) {
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
      settings: seasonSettings,
      // The followed team's odds are also counted by how each game left goes, for its card.
      ...(hasCutLine && ourTeamId ? { follow: ourTeamId } : {}),
    }),
    [liveTeams, remainingGames, oddsSeed, goldCutoff, seasonSettings, hasCutLine, ourTeamId]
  );
  const {
    odds,
    places: oddsPlaces,
    iterations: oddsIterations,
    pending: oddsPending,
    swing: ourSwing,
  } = useSimulationOdds(oddsInput);

  const trendInput = useMemo(() => {
    const teamIds = teams.map((t) => t.id);
    if (!teamIds.length) {
      return {
        teamIds: [],
        states: [],
        iterations: TREND_ITERATIONS,
        cutoff: goldCutoff,
        settings: seasonSettings,
      };
    }
    const built = buildTrendStates(teams, matchups, finalLogs, completedGames, {
      states: TREND_STATES,
      goldCutoff,
      settings: seasonSettings,
      // The results the Gold % column is rated with, so the line ends where the column is.
      externalResults,
      squadYear: scoutBridge.squadYear,
    });
    return {
      teamIds,
      states: built,
      iterations: TREND_ITERATIONS,
      cutoff: goldCutoff,
      settings: seasonSettings,
    };
  }, [
    teams,
    matchups,
    finalLogs,
    completedGames,
    goldCutoff,
    seasonSettings,
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
      settings: seasonSettings,
      enabled: activeView === "model",
      bracketLogs,
    }),
    [liveTeams, remainingGames, oddsSeed, goldCutoff, seasonSettings, activeView, bracketLogs]
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
  // With the Team Rankings results the forecast reads, each game called from those played before
  // its day: what is scored is the model shipped, not the league's games alone.
  const backtestOutside = useMemo(
    () => ({ outside: externalResults, squadYear: scoutBridge.squadYear }),
    [externalResults, scoutBridge.squadYear]
  );
  const backtestResult = useMemo(
    () =>
      backtestShown
        ? rememberedBacktest(teams, matchups, finalLogs, settings, 0.1, backtestOutside)
        : NO_BACKTEST,
    [backtestShown, teams, matchups, finalLogs, settings, backtestOutside]
  );

  return {
    backtestResult,
    bracketOdds,
    odds,
    oddsIterations,
    oddsPending,
    oddsPlaces,
    oddsSeed,
    ourSwing,
    trendMap,
  };
}
