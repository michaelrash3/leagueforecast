import { describe, expect, it } from "vitest";
import { backtestPredictions } from "../backtest";
import { DEFAULT_SETTINGS, type GameLog, type Matchup, type TeamBase } from "../types";

const teams: TeamBase[] = [{ id: "A", name: "A" }, { id: "B", name: "B" }];
const matchups: Matchup[] = [
  { id: "g1", date: "5/1", away: "A", home: "B" },
  { id: "g2", date: "5/2", away: "B", home: "A" },
];
const logs: Record<string, GameLog> = {
  g1: { awayRuns: "8", awayHits: "0", awayK: "0", homeRuns: "2", homeHits: "0", homeK: "0", innings: "6", isFinal: true },
  g2: { awayRuns: "1", awayHits: "0", awayK: "0", homeRuns: "5", homeHits: "0", homeK: "0", innings: "6", isFinal: true },
};

describe("backtestPredictions", () => {
  it("returns metrics and calibration buckets", () => {
    const out = backtestPredictions(teams, matchups, logs, DEFAULT_SETTINGS, 0.2);
    expect(out.sampleSize).toBe(2);
    expect(out.brierScore).toBeGreaterThanOrEqual(0);
    expect(out.brierScore).toBeLessThanOrEqual(1);
    expect(out.calibration.length).toBeGreaterThan(0);
  });

  it("reports winner accuracy and margin error over decisive games", () => {
    const out = backtestPredictions(teams, matchups, logs, DEFAULT_SETTINGS, 0.2);
    expect(out.winnerAccuracy).not.toBeNull();
    expect(out.winnerAccuracy!).toBeGreaterThanOrEqual(0);
    expect(out.winnerAccuracy!).toBeLessThanOrEqual(1);
    expect(out.averageMarginError).not.toBeNull();
    expect(out.averageMarginError!).toBeGreaterThanOrEqual(0);
    expect(out.highConfidenceSamples).toBeGreaterThanOrEqual(0);
    expect(out.highConfidenceSamples).toBeLessThanOrEqual(out.sampleSize);
  });

  it("returns null accuracy metrics when there are no decisive games", () => {
    const tie: Record<string, GameLog> = {
      g1: { awayRuns: "3", awayHits: "0", awayK: "0", homeRuns: "3", homeHits: "0", homeK: "0", innings: "6", isFinal: true },
    };
    const out = backtestPredictions(teams, [matchups[0]!], tie, DEFAULT_SETTINGS, 0.2);
    expect(out.sampleSize).toBe(0);
    expect(out.winnerAccuracy).toBeNull();
    expect(out.averageMarginError).toBeNull();
    expect(out.highConfidenceAccuracy).toBeNull();
    expect(out.highConfidenceSamples).toBe(0);
  });
});
