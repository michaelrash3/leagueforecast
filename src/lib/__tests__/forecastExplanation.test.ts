import { describe, expect, it } from "vitest";
import { buildPredictionEngine, type ExternalResult } from "../predictionEngine";
import { calculateTeams } from "../sim";
import { DEFAULT_SETTINGS, type GameLog, type Matchup, type TeamBase } from "../types";

/*
 * Forecast explanations (2.8): the Dashboard's matchup odds told as the sum of their parts, and the
 * context around them. Placeholder teams.
 */

const final = (away: number, home: number): GameLog => ({
  awayRuns: String(away),
  homeRuns: String(home),
  awayHits: "6",
  homeHits: "5",
  awayK: "4",
  homeK: "5",
  innings: "6",
  isFinal: true,
});

const teams: TeamBase[] = [
  { id: "A", name: "Aces" },
  { id: "B", name: "Bears" },
  { id: "C", name: "Comets" },
  { id: "D", name: "Ducks" },
  { id: "E", name: "Eagles" },
];

const matchups: Matchup[] = [
  { id: "g1", date: "5/2", away: "A", home: "B" },
  { id: "g2", date: "5/2", away: "C", home: "D" },
  { id: "g3", date: "5/9", away: "A", home: "C" },
  { id: "g4", date: "5/9", away: "B", home: "E" },
  { id: "g5", date: "5/16", away: "D", home: "A" },
  { id: "g6", date: "5/16", away: "E", home: "C" },
  { id: "g7", date: "5/23", away: "B", home: "A" },
  // Still to play.
  { id: "g8", date: "5/30", away: "A", home: "E" },
  { id: "g9", date: "5/30", away: "B", home: "D" },
  { id: "g10", date: "6/6", away: "C", home: "B" },
  { id: "g11", date: "6/6", away: "E", home: "D" },
];

const logs: Record<string, GameLog> = {
  g1: final(7, 3),
  g2: final(4, 5),
  g3: final(9, 2),
  g4: final(3, 6),
  g5: final(1, 8),
  g6: final(5, 5),
  g7: final(6, 4),
};

// Two of the league's teams have tournament results besides, one against an outside club twice.
const external: ExternalResult[] = [
  { away: "E", home: "X1", homeMargin: -6, date: "2026-04-18", neutral: true },
  { away: "X1", home: "D", homeMargin: 2, date: "2026-04-19", neutral: true },
  { away: "E", home: "X2", homeMargin: 1, date: "2026-04-25", neutral: true },
];

const engineFor = (
  games: Matchup[] = matchups,
  scores: Record<string, GameLog> = logs,
  outside: ExternalResult[] = external
) =>
  buildPredictionEngine(
    calculateTeams(teams, games, scores, DEFAULT_SETTINGS),
    games,
    scores,
    DEFAULT_SETTINGS,
    outside
  );

describe("the matchup odds", () => {
  it("are pinned, so explaining them moves none of them", () => {
    const pinned = engineFor().predictions.map((prediction) => ({
      gameId: prediction.gameId,
      predictedWinnerId: prediction.predictedWinnerId,
      projectedMargin: prediction.projectedMargin,
      winProbability: prediction.winProbability,
      expectedScore: prediction.expectedScore,
      confidence: prediction.confidence,
      keyFactors: prediction.keyFactors,
      riskFactors: prediction.riskFactors,
    }));
    expect(pinned).toMatchSnapshot();
  });
});
