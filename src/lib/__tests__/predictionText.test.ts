import { describe, expect, it } from "vitest";
import { describePrediction, projectedRunLine, upsetRiskLabel } from "../predictionText";
import type { Matchup, Prediction, Team } from "../types";

const makeTeam = (id: string, name: string, overrides: Partial<Team> = {}): Team => ({
  id,
  name,
  w: 0,
  l: 0,
  t: 0,
  rs: 0,
  ra: 0,
  games: 0,
  pct: 0.5,
  runDiff: 0,
  tpi: 0,
  baseTpi: 0,
  sos: 0,
  momentum: 0,
  rsg: 0,
  rag: 0,
  hpg: 0,
  kpg: 0,
  awayK6: 4.5,
  homeK6: 4.5,
  totalK6: 4.5,
  machineDifficulty: 0,
  ...overrides,
});

describe("predictionText helpers", () => {
  it("formats projected run line from prediction winner and margin", () => {
    const byId = new Map<string, Team>([["a", makeTeam("a", "Alpha Team")]]);
    const prediction: Prediction = {
      awayScore: 9,
      homeScore: 5,
      awayWinPct: 0.7,
      winnerId: "a",
      confidence: "Medium",
    };
    expect(projectedRunLine(prediction, byId)).toBe("Alpha Team -3.5");
  });

  it("maps upset risk thresholds", () => {
    expect(upsetRiskLabel(0.57, 3)).toBe("High");
    expect(upsetRiskLabel(0.65, 4)).toBe("Medium");
    expect(upsetRiskLabel(0.75, 6)).toBe("Low");
  });

  it("handles missing teams in describePrediction", () => {
    const game: Matchup = { id: "g1", away: "a", home: "b", date: "" };
    const prediction: Prediction = {
      awayScore: 6,
      homeScore: 4,
      awayWinPct: 0.64,
      winnerId: "a",
      confidence: "Low",
    };
    const byId = new Map<string, Team>([["a", makeTeam("a", "Alpha Team")]]);
    expect(describePrediction(game, prediction, byId)).toContain("missing from the imported team list");
  });

  it("includes confidence text and top reasons for a clear edge", () => {
    const game: Matchup = { id: "g2", away: "a", home: "b", date: "" };
    const prediction: Prediction = {
      awayScore: 11,
      homeScore: 5,
      awayWinPct: 0.72,
      winnerId: "a",
      confidence: "High",
    };
    const byId = new Map<string, Team>([
      [
        "a",
        makeTeam("a", "Alpha Team", {
          tpi: 8,
          rsg: 10,
          rag: 3,
          awayK6: 6,
        }),
      ],
      [
        "b",
        makeTeam("b", "Beta Team", {
          tpi: 2,
          rsg: 6,
          rag: 7,
          homeK6: 3,
          machineDifficulty: 1,
        }),
      ],
    ]);

    const text = describePrediction(game, prediction, byId);
    expect(text).toContain("a strong lean");
    expect(text).toContain("Alpha Team -5.5");
    expect(text).toContain("Alpha Team has the stronger scoring profile");
  });

  it("uses the close-grades fallback reason when no edge thresholds are met", () => {
    const game: Matchup = { id: "g3", away: "a", home: "b", date: "" };
    const prediction: Prediction = {
      awayScore: 6,
      homeScore: 5,
      awayWinPct: 0.51,
      winnerId: "a",
      confidence: "Low",
    };
    const byId = new Map<string, Team>([
      ["a", makeTeam("a", "Alpha Team", { tpi: 4.2, rsg: 6.0, rag: 5.2, awayK6: 4.5 })],
      ["b", makeTeam("b", "Beta Team", { tpi: 4.0, rsg: 5.9, rag: 5.1, homeK6: 4.6 })],
    ]);

    const text = describePrediction(game, prediction, byId);
    expect(text).toContain("a light lean");
    expect(text).toContain("teams grade close");
  });
});
