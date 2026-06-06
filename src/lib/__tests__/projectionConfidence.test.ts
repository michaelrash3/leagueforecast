import { describe, expect, it } from "vitest";
import { projectionConfidenceForTeam } from "../projectionConfidence";
import type { TeamWithProjection } from "../types";

const team = (overrides: Partial<TeamWithProjection>): TeamWithProjection =>
  ({
    id: "aces",
    name: "Aces",
    w: 8,
    l: 2,
    t: 0,
    rs: 80,
    ra: 45,
    games: 10,
    pct: 0.8,
    runDiff: 35,
    rsg: 8,
    rag: 4.5,
    hpg: 9,
    kpg: 2,
    oppKpg: 0,
    tpi: 12,
    baseTpi: 12,
    sos: 0,
    momentum: 0,
    awayK6: null,
    homeK6: null,
    totalK6: null,
    machineDifficulty: 0,
    rank: 1,
    projectedRank: 1,
    projectedRecord: "10-2",
    projectedRunDiff: 42,
    goldPct: 91,
    goldPctMargin: 4,
    goldStatus: "In",
    maxPoints: 20,
    blockersAhead: 0,
    goldTrend: [],
    ...overrides,
  }) as TeamWithProjection;

describe("projectionConfidenceForTeam", () => {
  it("labels separated projections as stable", () => {
    expect(projectionConfidenceForTeam(team({})).label).toBe("Stable");
  });

  it("labels near-cut projections as too close", () => {
    expect(projectionConfidenceForTeam(team({ goldPct: 52, goldPctMargin: 5 })).label).toBe(
      "Too close"
    );
  });

  it("labels moderately uncertain projections as volatile", () => {
    expect(projectionConfidenceForTeam(team({ goldPct: 70, goldPctMargin: 8 })).label).toBe(
      "Volatile"
    );
  });
});
