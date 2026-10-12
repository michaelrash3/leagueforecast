import { describe, expect, it } from "vitest";
import { buildPredictionEngine } from "../predictionEngine";
import { calculateTeams } from "../sim";
import { DEFAULT_SETTINGS, type GameLog, type Matchup, type TeamBase } from "../types";

/**
 * Two numbers that said the opposite of what they meant.
 *
 * A weighted mean divided by the count instead of the weights, so the Trend column read a steady
 * team as sliding or climbing depending only on whether it was good; and a metric drawn as
 * "Upsets" counted the games the model got confidently wrong.
 */
const settings = { ...DEFAULT_SETTINGS };
const bases: TeamBase[] = ["A", "B"].map((id) => ({ id, name: id }));

/** Five games, every one won by `margin` — a team that has not changed at all. */
const steady = (margin: number) => {
  const matchups: Matchup[] = [];
  const logs: Record<string, GameLog> = {};
  for (let n = 0; n < 5; n += 1) {
    const id = `g${n}`;
    matchups.push({ id, date: `5/${n + 1}`, away: "A", home: "B" });
    const away = margin > 0 ? 6 + margin : 6;
    const home = margin > 0 ? 6 : 6 - margin;
    logs[id] = {
      awayRuns: String(away),
      awayHits: "6",
      awayK: "4",
      homeRuns: String(home),
      homeHits: "6",
      homeK: "4",
      innings: "6",
      isFinal: true,
    };
  }
  return { matchups, logs };
};

const formOf = (margin: number) => {
  const { matchups, logs } = steady(margin);
  const engine = buildPredictionEngine(
    calculateTeams(bases, matchups, logs, settings),
    matchups,
    logs,
    settings
  );
  const a = engine.powerRatings.find((row) => row.teamId === "A")!;
  return { recentForm: a.recentForm, rawMargin: a.rawMargin, trend: a.trend };
};

describe("recent form", () => {
  it("is on the same scale as the average it is compared against", () => {
    /*
     * The weights ramp from 1/n to 1 and sum to (n+1)/2, not to n. Dividing by n shrank the
     * answer to 60% of itself over five games — while `avgMargin`, the number `trend` compares it
     * against, is a plain mean at full scale.
     */
    const good = formOf(6);

    expect(good.recentForm).toBeCloseTo(6, 6);
  });

  it("calls a team that has not changed Stable, whether it is good or bad", () => {
    // As shipped, +6 every game read 3.6 against an average of 6 and came out "Down"; -6 every
    // game read -3.6 against -6 and came out "Up". Good teams slid and bad ones climbed.
    expect(formOf(6).trend).toBe("Stable");
    expect(formOf(-6).trend).toBe("Stable");
  });

  it("still leans on the newest games", () => {
    // The fix is the divisor, not the ramp: the last game must still weigh more than the first.
    const matchups: Matchup[] = [];
    const logs: Record<string, GameLog> = {};
    // Four heavy losses, then a heavy win. A plain mean would be negative; the ramp lifts it.
    [-8, -8, -8, -8, 8].forEach((margin, n) => {
      const id = `g${n}`;
      matchups.push({ id, date: `5/${n + 1}`, away: "A", home: "B" });
      logs[id] = {
        awayRuns: String(margin > 0 ? 6 + margin : 6),
        awayHits: "6",
        awayK: "4",
        homeRuns: String(margin > 0 ? 6 : 6 - margin),
        homeHits: "6",
        homeK: "4",
        innings: "6",
        isFinal: true,
      };
    });
    const engine = buildPredictionEngine(
      calculateTeams(bases, matchups, logs, settings),
      matchups,
      logs,
      settings
    );
    const a = engine.powerRatings.find((row) => row.teamId === "A")!;

    expect(a.recentForm).toBeGreaterThan(a.rawMargin);
    expect(a.trend).toBe("Up");
  });
});
