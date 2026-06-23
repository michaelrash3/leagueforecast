import { describe, expect, it } from "vitest";
import { buildPredictionEngine } from "../predictionEngine";
import { calculateTeams } from "../sim";
import { DEFAULT_SETTINGS, type GameLog, type Matchup, type TeamBase } from "../types";

const teams: TeamBase[] = [
  { id: "FAL", name: "Falcons" },
  { id: "WOL", name: "Wolves" },
  { id: "COM", name: "Comets" },
];

const matchups: Matchup[] = [
  { id: "1", date: "2026-04-01", away: "FAL", home: "WOL" },
  { id: "2", date: "2026-04-02", away: "FAL", home: "COM" },
  { id: "3", date: "2026-04-03", away: "WOL", home: "COM" },
  { id: "4", date: "2026-04-10", away: "FAL", home: "WOL" },
];

const logs: Record<string, GameLog> = {
  "1": {
    awayRuns: "9",
    homeRuns: "4",
    awayHits: "10",
    homeHits: "6",
    awayK: "3",
    homeK: "5",
    innings: "6",
    isFinal: true,
  },
  "2": {
    awayRuns: "7",
    homeRuns: "2",
    awayHits: "8",
    homeHits: "4",
    awayK: "4",
    homeK: "6",
    innings: "6",
    isFinal: true,
  },
  "3": {
    awayRuns: "6",
    homeRuns: "3",
    awayHits: "8",
    homeHits: "5",
    awayK: "4",
    homeK: "5",
    innings: "6",
    isFinal: true,
  },
  "4": {
    awayRuns: "",
    homeRuns: "",
    awayHits: "",
    homeHits: "",
    awayK: "",
    homeK: "",
    innings: "6",
    isFinal: false,
  },
};

describe("buildPredictionEngine", () => {
  it("produces explainable future-game forecasts with margin, probability, confidence, and power ratings", () => {
    const live = calculateTeams(teams, matchups, logs, DEFAULT_SETTINGS);
    const result = buildPredictionEngine(live, matchups, logs);

    expect(result.dataQuality.tier).not.toBe("Insufficient");
    expect(result.powerRatings[0]?.teamName).toBe("Falcons");
    expect(result.predictions).toHaveLength(1);
    expect(result.predictions[0]?.predictedWinnerId).toBe("FAL");
    expect(result.predictions[0]?.projectedMargin).toBeGreaterThan(0);
    expect(result.predictions[0]?.winProbability.teamA).toBeGreaterThan(0.5);
    expect(result.predictions[0]?.confidence.tier).toMatch(/Low|Moderate|Strong|High/);
    expect(result.predictions[0]?.keyFactors.length).toBeGreaterThan(0);
  });

  it("shows low-confidence insufficient states when no completed scores exist", () => {
    const blankLogs: Record<string, GameLog> = { "4": logs["4"]! };
    const live = calculateTeams(teams, [matchups[3]!], blankLogs, DEFAULT_SETTINGS);
    const result = buildPredictionEngine(live, [matchups[3]!], blankLogs);

    expect(result.dataQuality.tier).toBe("Insufficient");
    expect(result.predictions[0]?.predictedWinnerId).toBeNull();
    expect(result.predictions[0]?.confidence.tier).toBe("Low");
  });
});
