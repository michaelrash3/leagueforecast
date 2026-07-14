import type { GameLog, Matchup, Settings, Team, TeamBase } from "./types";
import { clamp, isFinal, parseNumber } from "./util";
import { buildOpponentAdjustedRatings } from "./powerRating";
import { resolveMaxRunDifferential } from "./sim";

export type DataQualityTier = "Insufficient" | "Limited" | "Developing" | "Strong" | "Excellent";
export type ConfidenceTier = "Low" | "Moderate" | "Strong" | "High";

export type PowerRating = {
  teamId: string;
  teamName: string;
  rank: number;
  /** Opponent-adjusted power rating in run units (expected margin vs a league-average team). */
  rating: number;
  elo: number;
  record: string;
  games: number;
  /** Own capped net runs per game, before opponent adjustment. */
  rawMargin: number;
  /** Run-denominated strength of schedule: the average rating of opponents faced. */
  strengthOfSchedule: number;
  recentForm: number;
  volatility: number;
  trend: "Up" | "Down" | "Stable" | "New";
};

export type LeaguePrediction = {
  gameId: string;
  teamAId: string;
  teamBId: string;
  predictedWinnerId: string | null;
  projectedMargin: number | null;
  winProbability: { teamA: number; teamB: number };
  expectedScore?: { teamA: number; teamB: number };
  confidence: { score: number; tier: ConfidenceTier; reasons: string[] };
  dataQuality: { tier: DataQualityTier; warnings: string[]; recommendedActions: string[] };
  keyFactors: string[];
  riskFactors: string[];
};

export type PredictionEngineResult = {
  powerRatings: PowerRating[];
  predictions: LeaguePrediction[];
  dataQuality: LeaguePrediction["dataQuality"];
  // Realized forecast accuracy is measured by the walk-forward backtest (see lib/backtest.ts),
  // which replays each finalized game; the engine only reports how many games it has to learn from.
  accuracy: {
    gamesEvaluated: number;
  };
};

type CompletedGame = Matchup & { awayScore: number; homeScore: number; margin: number };

const scoreFor = (log: GameLog | undefined, side: "away" | "home") =>
  parseNumber(side === "away" ? (log?.awayRuns ?? "") : (log?.homeRuns ?? ""), Number.NaN);

const completedGamesFrom = (matchups: Matchup[], logs: Record<string, GameLog>) =>
  matchups.flatMap((game): CompletedGame[] => {
    const log = logs[game.id];
    const awayScore = scoreFor(log, "away");
    const homeScore = scoreFor(log, "home");
    if (!isFinal(log) || !Number.isFinite(awayScore) || !Number.isFinite(homeScore)) return [];
    return [{ ...game, awayScore, homeScore, margin: awayScore - homeScore }];
  });

const tierForData = (
  teams: TeamBase[],
  completedGames: CompletedGame[],
  futureGames: Matchup[]
) => {
  const teamGameCounts = new Map(teams.map((team) => [team.id, 0]));
  completedGames.forEach((game) => {
    teamGameCounts.set(game.away, (teamGameCounts.get(game.away) ?? 0) + 1);
    teamGameCounts.set(game.home, (teamGameCounts.get(game.home) ?? 0) + 1);
  });
  const teamsWithNoGames = [...teamGameCounts.values()].filter((games) => games === 0).length;
  const minGames = Math.min(...[...teamGameCounts.values(), 0]);
  const warnings: string[] = [];
  const recommendedActions: string[] = [];
  if (teams.length < 2) {
    warnings.push("Add at least two teams before the model can compare matchups.");
    recommendedActions.push("Add teams or import a schedule.");
  }
  if (completedGames.length === 0) {
    warnings.push(
      "No completed scores are available, so forecasts are only league-average placeholders."
    );
    recommendedActions.push("Enter completed game scores.");
  }
  if (teamsWithNoGames) {
    warnings.push(
      `${teamsWithNoGames} team${teamsWithNoGames === 1 ? " has" : "s have"} no completed results.`
    );
    recommendedActions.push("Add scores for teams with no completed games.");
  }
  if (futureGames.length === 0)
    recommendedActions.push("Add future scheduled games to generate upcoming predictions.");

  const tier: DataQualityTier =
    teams.length < 2 || completedGames.length === 0
      ? "Insufficient"
      : completedGames.length >= teams.length * 4 && minGames >= 4
        ? "Excellent"
        : completedGames.length >= teams.length * 3 && minGames >= 3
          ? "Strong"
          : completedGames.length >= teams.length && minGames >= 1
            ? "Developing"
            : "Limited";
  return { tier, warnings, recommendedActions };
};

const confidenceTier = (score: number): ConfidenceTier =>
  score >= 82 ? "High" : score >= 66 ? "Strong" : score >= 46 ? "Moderate" : "Low";

export const buildPredictionEngine = (
  teams: Team[],
  matchups: Matchup[],
  logs: Record<string, GameLog>,
  settings?: Pick<Settings, "maxRunDifferential" | "pitchMode" | "autoRunDiffCap">
): PredictionEngineResult => {
  const byId = new Map(teams.map((team) => [team.id, team]));
  const completedGames = completedGamesFrom(matchups, logs);
  const futureGames = matchups.filter((game) => !isFinal(logs[game.id]));
  const dataQuality = tierForData(teams, completedGames, futureGames);
  const leagueAvgScoring = completedGames.length
    ? completedGames.reduce((sum, game) => sum + game.awayScore + game.homeScore, 0) /
      (completedGames.length * 2)
    : 0;

  // NET-in-spirit power ratings: opponent-adjusted, capped run margin with small-sample shrinkage.
  const runDiffCap = settings
    ? resolveMaxRunDifferential(settings)
    : 8;
  const adjusted = buildOpponentAdjustedRatings(
    teams.map((team) => team.id),
    completedGames.map((game) => ({
      home: game.home,
      away: game.away,
      homeMargin: game.homeScore - game.awayScore,
    })),
    { cap: runDiffCap }
  );

  const elo = new Map(teams.map((team) => [team.id, 1500]));
  completedGames
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach((game) => {
      const awayElo = elo.get(game.away) ?? 1500;
      const homeElo = elo.get(game.home) ?? 1500;
      const expectedAway = 1 / (1 + 10 ** ((homeElo - awayElo) / 400));
      const actualAway =
        game.awayScore === game.homeScore ? 0.5 : game.awayScore > game.homeScore ? 1 : 0;
      const marginMultiplier = Math.log(Math.abs(game.margin) + 1) * 1.15;
      const change = clamp(22 * marginMultiplier * (actualAway - expectedAway), -34, 34);
      elo.set(game.away, awayElo + change);
      elo.set(game.home, homeElo - change);
    });

  const powerRatings = teams
    .map((team): PowerRating => {
      const recentGames = completedGames
        .filter((game) => game.away === team.id || game.home === team.id)
        .slice(-5);
      const weightedRecent = recentGames.reduce((sum, game, index) => {
        const gameMargin = game.away === team.id ? game.margin : -game.margin;
        return sum + gameMargin * ((index + 1) / recentGames.length);
      }, 0);
      const recentForm = recentGames.length ? weightedRecent / recentGames.length : 0;
      const margins = completedGames
        .filter((game) => game.away === team.id || game.home === team.id)
        .map((game) => (game.away === team.id ? game.margin : -game.margin));
      const avgMargin = margins.length ? margins.reduce((a, b) => a + b, 0) / margins.length : 0;
      const volatility = margins.length
        ? Math.sqrt(
            margins.reduce((sum, margin) => sum + (margin - avgMargin) ** 2, 0) / margins.length
          )
        : 0;
      const rating = adjusted.ratings.get(team.id) ?? 0;
      const rawMargin = adjusted.rawMargin.get(team.id) ?? 0;
      return {
        teamId: team.id,
        teamName: team.name,
        rank: 0,
        rating,
        elo: elo.get(team.id) ?? 1500,
        record: `${team.w}-${team.l}${team.t ? `-${team.t}` : ""}`,
        games: team.games,
        rawMargin,
        strengthOfSchedule: adjusted.strengthOfSchedule.get(team.id) ?? 0,
        recentForm,
        volatility,
        trend:
          team.games === 0
            ? "New"
            : recentForm > avgMargin + 1
              ? "Up"
              : recentForm < avgMargin - 1
                ? "Down"
                : "Stable",
      };
    })
    .sort(
      (a, b) =>
        b.rating - a.rating || b.rawMargin - a.rawMargin || a.teamName.localeCompare(b.teamName)
    )
    .map((row, index) => ({ ...row, rank: index + 1 }));
  const powerById = new Map(powerRatings.map((rating) => [rating.teamId, rating]));

  const predictionFor = (game: Matchup): LeaguePrediction => {
    const a = byId.get(game.away);
    const b = byId.get(game.home);
    const ar = powerById.get(game.away);
    const br = powerById.get(game.home);
    if (!a || !b || !ar || !br || dataQuality.tier === "Insufficient") {
      return {
        gameId: game.id,
        teamAId: game.away,
        teamBId: game.home,
        predictedWinnerId: null,
        projectedMargin: null,
        winProbability: { teamA: 0.5, teamB: 0.5 },
        confidence: {
          score: 12,
          tier: "Low",
          reasons: ["The model needs completed scores before it can forecast this matchup."],
        },
        dataQuality,
        keyFactors: ["Insufficient completed game data."],
        riskFactors: dataQuality.warnings,
      };
    }
    const headToHead = a.headToHead?.[b.id];
    // Ratings are opponent-adjusted expected margins (runs), so their difference IS the projected
    // margin; the home team gets the estimated home-field bump, plus a small head-to-head nudge.
    const h2hEdge = headToHead ? clamp((headToHead.wins - headToHead.losses) * 0.4, -1.5, 1.5) : 0;
    const margin = clamp((ar.rating - br.rating) - adjusted.homeAdvantage + h2hEdge, -14, 14);
    const probA = clamp(1 / (1 + Math.exp(-margin / 2.8)), 0.08, 0.92);
    const projectedWinnerId = margin >= 0 ? a.id : b.id;
    const samplePenalty = Math.max(0, 3 - Math.min(a.games, b.games)) * 13;
    const volatilityPenalty = clamp((ar.volatility + br.volatility) * 1.1, 0, 20);
    const qualityBonus = {
      Insufficient: -35,
      Limited: -18,
      Developing: 0,
      Strong: 9,
      Excellent: 14,
    }[dataQuality.tier];
    const confidenceScore = clamp(
      42 + Math.abs(margin) * 4.0 + qualityBonus - samplePenalty - volatilityPenalty,
      5,
      94
    );
    const confidence = {
      score: Math.round(confidenceScore),
      tier: confidenceTier(confidenceScore),
      reasons: [] as string[],
    };
    if (Math.min(a.games, b.games) < 3)
      confidence.reasons.push(
        "Confidence is reduced because at least one team has fewer than three completed games."
      );
    if (Math.abs(margin) < 3)
      confidence.reasons.push("Projected margin is tight, so winner certainty remains limited.");
    if (ar.volatility + br.volatility > 12)
      confidence.reasons.push("Recent results are volatile, which lowers model confidence.");
    const favorite = projectedWinnerId === a.id ? a : b;
    const favRating = projectedWinnerId === a.id ? ar : br;
    const underRating = projectedWinnerId === a.id ? br : ar;
    const keyFactors = [
      `${favorite.name} holds the stronger opponent-adjusted rating (${favRating.rating >= 0 ? "+" : ""}${favRating.rating.toFixed(1)} vs ${underRating.rating >= 0 ? "+" : ""}${underRating.rating.toFixed(1)} runs).`,
    ];
    if (favRating.strengthOfSchedule - underRating.strengthOfSchedule >= 0.5)
      keyFactors.push(`${favorite.name} has also faced the tougher schedule.`);
    if (Math.abs(favRating.recentForm - underRating.recentForm) >= 1)
      keyFactors.push("Recent form supports the projected winner.");
    if (headToHead && headToHead.wins + headToHead.losses + headToHead.ties > 0)
      keyFactors.push(
        "Head-to-head results are included but capped so one game does not dominate."
      );
    const riskFactors = [...dataQuality.warnings];
    if (Math.min(a.games, b.games) < 3)
      riskFactors.push("Small sample size can make ratings unstable.");
    if (Math.abs(margin) < 3) riskFactors.push("Similar team ratings create a close-game risk.");
    return {
      gameId: game.id,
      teamAId: a.id,
      teamBId: b.id,
      predictedWinnerId: projectedWinnerId,
      projectedMargin: Math.abs(Number(margin.toFixed(1))),
      winProbability: { teamA: Number(probA.toFixed(2)), teamB: Number((1 - probA).toFixed(2)) },
      expectedScore: leagueAvgScoring
        ? {
            teamA: Math.max(0, Number((leagueAvgScoring + margin / 2).toFixed(1))),
            teamB: Math.max(0, Number((leagueAvgScoring - margin / 2).toFixed(1))),
          }
        : undefined,
      confidence,
      dataQuality,
      keyFactors,
      riskFactors,
    };
  };

  return {
    powerRatings,
    predictions: futureGames.map(predictionFor),
    dataQuality,
    accuracy: {
      gamesEvaluated: completedGames.length,
    },
  };
};
