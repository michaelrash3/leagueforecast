import {
  applyResult,
  predictGame,
  projectStandings,
  rankTeams,
  simulateGoldOdds,
} from "./sim";
import type { GameLog, Matchup, Settings, Team } from "./types";

export type OverlayChoice = "away" | "home" | "model";
export type ScenarioOverlay = Record<string, OverlayChoice>;

const buildById = (teams: Team[]) => {
  const map = new Map<string, Team>();
  teams.forEach((team) => map.set(team.id, team));
  return map;
};

const winnerFor = (
  game: Matchup,
  overlay: ScenarioOverlay,
  liveTeams: Team[],
  settings: Settings,
  byId: Map<string, Team>
): string => {
  const choice = overlay[game.id];
  if (choice === "away") return game.away;
  if (choice === "home") return game.home;
  return predictGame(game, liveTeams, settings, byId).winnerId;
};

/**
 * Apply an overlay of forced winners to remaining games and return the
 * projected, ranked teams. `overlay[gameId] === 'model'` (or missing) falls
 * back to the model's predicted winner.
 */
export const applyScenarioOverlay = (
  liveTeams: Team[],
  remaining: Matchup[],
  overlay: ScenarioOverlay,
  settings: Settings
) => {
  const byId = buildById(liveTeams);
  let projected = liveTeams.map((team) => ({ ...team }));
  remaining.forEach((game) => {
    const winner = winnerFor(game, overlay, liveTeams, settings, byId);
    projected = applyResult(projected, game, winner, liveTeams, settings);
  });
  return rankTeams(projected, { runDiffTiebreaker: settings.runDiffTiebreaker });
};

/**
 * Materialize logs as if every remaining game finished according to the
 * overlay. Final scores come from `predictGame`, then nudged to match the
 * forced winner if needed. Used by the What-If Lab to feed `simulateGoldOdds`
 * with the simulated "what if these results happen" history.
 */
export const overlayToHypotheticalLogs = (
  liveTeams: Team[],
  remaining: Matchup[],
  overlay: ScenarioOverlay,
  settings: Settings,
  baseLogs: Record<string, GameLog>
): Record<string, GameLog> => {
  const byId = buildById(liveTeams);
  const next: Record<string, GameLog> = { ...baseLogs };
  remaining.forEach((game) => {
    const prediction = predictGame(game, liveTeams, settings, byId);
    const winner = winnerFor(game, overlay, liveTeams, settings, byId);
    let awayRuns = prediction.awayScore;
    let homeRuns = prediction.homeScore;
    if (winner === game.away && awayRuns <= homeRuns) awayRuns = homeRuns + 1;
    if (winner === game.home && homeRuns <= awayRuns) homeRuns = awayRuns + 1;
    next[game.id] = {
      awayRuns: String(awayRuns),
      awayHits: "0",
      awayK: "0",
      homeRuns: String(homeRuns),
      homeHits: "0",
      homeK: "0",
      innings: "6",
      isFinal: true,
    };
  });
  return next;
};

/**
 * Conditional Gold odds: for any game the user has forced via the overlay we
 * treat it as decided in every Monte Carlo iteration; remaining undecided
 * games are sampled normally. We model this by running `simulateGoldOdds`
 * against the (already-applied) overlay scenario teams + just the truly
 * remaining games.
 */
export const scenarioOddsInputs = (
  liveTeams: Team[],
  remaining: Matchup[],
  overlay: ScenarioOverlay,
  settings: Settings
) => {
  const byId = buildById(liveTeams);
  let intermediate = liveTeams.map((team) => ({ ...team }));
  const stillRemaining: Matchup[] = [];
  remaining.forEach((game) => {
    const choice = overlay[game.id];
    if (choice === "away" || choice === "home") {
      const winner = choice === "away" ? game.away : game.home;
      intermediate = applyResult(intermediate, game, winner, liveTeams, settings);
    } else {
      stillRemaining.push(game);
    }
  });
  return { intermediateTeams: intermediate, stillRemaining, byId };
};

export const scenarioOdds = (
  liveTeams: Team[],
  remaining: Matchup[],
  overlay: ScenarioOverlay,
  iterations: number,
  seedText: string,
  cutoff: number,
  settings: Settings
) => {
  const { intermediateTeams, stillRemaining } = scenarioOddsInputs(
    liveTeams,
    remaining,
    overlay,
    settings
  );
  return simulateGoldOdds(
    intermediateTeams,
    stillRemaining,
    iterations,
    seedText,
    cutoff,
    settings
  );
};

export const scenarioProjection = (
  liveTeams: Team[],
  remaining: Matchup[],
  overlay: ScenarioOverlay,
  settings: Settings
) => {
  const { intermediateTeams, stillRemaining } = scenarioOddsInputs(
    liveTeams,
    remaining,
    overlay,
    settings
  );
  return projectStandings(intermediateTeams, stillRemaining, settings);
};

export const overlayHash = (overlay: ScenarioOverlay) =>
  Object.keys(overlay)
    .sort()
    .map((key) => `${key}:${overlay[key]}`)
    .join(",");

export const countForcedGames = (overlay: ScenarioOverlay) =>
  Object.values(overlay).filter((choice) => choice === "away" || choice === "home").length;
