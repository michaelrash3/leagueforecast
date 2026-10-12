import { describe, expect, it } from "vitest";
import { forecastRange } from "../forecastRange";
import { marginSpanText, runSpanText } from "../forecastRangeText";
import { buildPredictionEngine } from "../predictionEngine";
import { calculateTeams } from "../sim";
import { DEFAULT_SETTINGS, type GameLog, type Matchup, type TeamBase } from "../types";

/*
 * The range a game lands in (2.10): eight games in ten end within 9 runs of the projected margin at
 * player pitch and 10 at machine pitch, with each side within 6.5 and 8 runs of its expected score,
 * in whole runs as the cards show them. Placeholder teams.
 */

describe("forecastRange", () => {
  it("spans the margin by 9 runs at player pitch and 10 at machine pitch", () => {
    expect(forecastRange({ margin: 2.3, machinePitch: false }).margin).toEqual({
      low: -7,
      high: 11,
    });
    expect(forecastRange({ margin: 2.3, machinePitch: true }).margin).toEqual({
      low: -8,
      high: 12,
    });
  });

  it("spans each side's runs by 6.5 and 8, never below none", () => {
    const expectedScore = { teamA: 6.1, teamB: 3.8 };
    expect(forecastRange({ margin: 2.3, expectedScore, machinePitch: false }).score).toEqual({
      teamA: { low: 0, high: 13 },
      teamB: { low: 0, high: 10 },
    });
    expect(forecastRange({ margin: 2.3, expectedScore, machinePitch: true }).score).toEqual({
      teamA: { low: 0, high: 14 },
      teamB: { low: 0, high: 12 },
    });
    // A side expected to score plenty has a floor above none.
    expect(
      forecastRange({ margin: 0, expectedScore: { teamA: 12.4, teamB: 12.4 }, machinePitch: false })
        .score?.teamA
    ).toEqual({ low: 6, high: 19 });
  });

  it("says nothing of the score before there is a scoring level to read", () => {
    expect(forecastRange({ margin: 2.3, machinePitch: false })).not.toHaveProperty("score");
  });

  it("rounds a half away from zero, so the other side's view is the same range turned round", () => {
    expect(forecastRange({ margin: 2.5, machinePitch: false }).margin).toEqual({
      low: -7,
      high: 12,
    });
    expect(forecastRange({ margin: -2.5, machinePitch: false }).margin).toEqual({
      low: -12,
      high: 7,
    });
    // An end that rounds to zero from below is a plain zero, not a negative one.
    expect(Object.is(forecastRange({ margin: 8.6, machinePitch: false }).margin.low, 0)).toBe(true);
    expect(Object.is(forecastRange({ margin: 9, machinePitch: false }).margin.low, 0)).toBe(true);
  });
});

describe("the range in words", () => {
  const names = { teamA: "Aces", teamB: "Bears" };

  it("runs from the underdog's end to the favorite's across zero", () => {
    expect(marginSpanText({ low: -7, high: 11 }, names)).toBe("Bears by 7 to Aces by 11");
    expect(marginSpanText({ low: -11, high: 7 }, names)).toBe("Aces by 7 to Bears by 11");
    expect(marginSpanText({ low: -9, high: 9 }, names)).toBe("either side by up to 9");
  });

  it("names one side's two margins, the nearer first, when the range does not cross zero", () => {
    expect(marginSpanText({ low: 2, high: 20 }, names)).toBe("Aces by 2 to 20");
    expect(marginSpanText({ low: 0, high: 18 }, names)).toBe("a tie to Aces by 18");
    expect(marginSpanText({ low: -20, high: -2 }, names)).toBe("Bears by 2 to 20");
    expect(marginSpanText({ low: -18, high: 0 }, names)).toBe("a tie to Bears by 18");
  });

  it("says the same of a game whichever side is read as team A", () => {
    for (const machinePitch of [false, true])
      for (let tenths = -140; tenths <= 140; tenths += 1) {
        const margin = tenths / 10;
        const asListed = marginSpanText(forecastRange({ margin, machinePitch }).margin, names);
        const turned = marginSpanText(forecastRange({ margin: -margin, machinePitch }).margin, {
          teamA: "Bears",
          teamB: "Aces",
        });
        expect(turned, `margin ${margin}`).toBe(asListed);
      }
  });

  it("writes a side's runs as a span, or one number when both ends meet", () => {
    expect(runSpanText({ low: 0, high: 13 })).toBe("0–13");
    expect(runSpanText({ low: 5, high: 5 })).toBe("5");
  });
});

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
];
const matchups: Matchup[] = [
  { id: "g1", date: "5/2", away: "A", home: "B" },
  { id: "g2", date: "5/9", away: "B", home: "C" },
  { id: "g3", date: "5/16", away: "C", home: "A" },
  { id: "g4", date: "5/23", away: "A", home: "B" },
  { id: "g5", date: "5/30", away: "C", home: "B" },
];
const logs = { g1: final(8, 2), g2: final(5, 4), g3: final(3, 6) };

const predictionsAt = (pitchMode: "player" | "machine", scores: Record<string, GameLog> = logs) =>
  buildPredictionEngine(
    calculateTeams(teams, matchups, scores, { ...DEFAULT_SETTINGS, pitchMode }),
    matchups,
    scores,
    { ...DEFAULT_SETTINGS, pitchMode }
  ).predictions;

describe("each Dashboard prediction's range", () => {
  it("is worked out from the margin and expected score the card shows", () => {
    for (const [pitchMode, width, scoreWidth] of [
      ["player", 9, 6.5],
      ["machine", 10, 8],
    ] as const) {
      const predictions = predictionsAt(pitchMode);
      expect(predictions).toHaveLength(2);
      predictions.forEach((prediction) => {
        const { projectedMargin, expectedScore, range } = prediction;
        if (projectedMargin === null || !expectedScore || !range?.score)
          throw new Error(`No range for ${prediction.gameId}`);
        const signed = prediction.predictedWinnerId === prediction.teamAId ? 1 : -1;
        const whole = (runs: number) => Math.sign(runs) * Math.round(Math.abs(runs)) + 0;
        expect(range.margin).toEqual({
          low: whole(signed * projectedMargin - width),
          high: whole(signed * projectedMargin + width),
        });
        expect(range.score.teamA).toEqual({
          low: Math.max(0, whole(expectedScore.teamA - scoreWidth)),
          high: whole(expectedScore.teamA + scoreWidth),
        });
        expect(range.score.teamB).toEqual({
          low: Math.max(0, whole(expectedScore.teamB - scoreWidth)),
          high: whole(expectedScore.teamB + scoreWidth),
        });
      });
    }
  });

  it("is absent while the model has no final to forecast from", () => {
    predictionsAt("player", {}).forEach((prediction) => expect(prediction.range).toBeUndefined());
  });
});
