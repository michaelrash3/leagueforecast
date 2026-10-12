import { describe, expect, it } from "vitest";
import { buildPredictionEngine, type ExternalResult } from "../predictionEngine";
import { calculateTeams } from "../sim";
import { DEFAULT_SETTINGS, type GameLog, type Matchup } from "../types";

/*
 * Recent form walks a team's games in the order they were played.
 *
 * It sorted the dates as text, and the league's are "M/D" while Team Rankings' are ISO: "9/12"
 * came before "9/5", every October day before every September one, and every tournament game
 * before every league game. From a team's first October game the Trend column read its September.
 */
const final = (away: number, home: number): GameLog => ({
  awayRuns: String(away),
  homeRuns: String(home),
  awayHits: "",
  awayK: "",
  homeHits: "",
  homeK: "",
  innings: "6",
  isFinal: true,
});
const teams = ["A", "B", "C", "D", "E", "F", "G"].map((id) => ({ id, name: `Team ${id}` }));
const upcoming: Matchup = { id: "next", date: "10/9", away: "A", home: "B" };

const engine = (
  matchups: Matchup[],
  logs: Record<string, GameLog>,
  outside: ExternalResult[] = []
) => {
  const all = [...matchups, upcoming];
  const live = calculateTeams(teams, all, logs, DEFAULT_SETTINGS);
  return buildPredictionEngine(live, all, logs, DEFAULT_SETTINGS, outside);
};
const rowOf = (result: ReturnType<typeof engine>, teamId: string) =>
  result.powerRatings.find((row) => row.teamId === teamId)!;

describe("recent form", () => {
  it("reads an October game as newer than September's", () => {
    const matchups: Matchup[] = [
      { id: "g1", date: "9/11", away: "A", home: "B" },
      { id: "g2", date: "9/18", away: "A", home: "C" },
      { id: "g3", date: "9/25", away: "A", home: "D" },
      { id: "g4", date: "10/2", away: "A", home: "E" },
    ];
    const logs = { g1: final(9, 4), g2: final(9, 4), g3: final(9, 4), g4: final(0, 8) };
    const a = rowOf(engine(matchups, logs), "A");
    // +5, +5, +5, then -8, weighted 1 to 4 over 10: -0.2 against an average of 1.75.
    expect(a.recentForm).toBeCloseTo(-0.2, 9);
    expect(a.trend).toBe("Down");
  });

  it("reads 9/5 as older than 9/12", () => {
    const matchups: Matchup[] = [
      { id: "g1", date: "9/5", away: "A", home: "B" },
      { id: "g2", date: "9/12", away: "A", home: "C" },
      { id: "g3", date: "9/19", away: "A", home: "D" },
      { id: "g4", date: "9/26", away: "A", home: "E" },
    ];
    const logs = { g1: final(0, 6), g2: final(4, 2), g3: final(5, 2), g4: final(6, 2) };
    const a = rowOf(engine(matchups, logs), "A");
    // -6, +2, +3, +4: 2.3 against an average of 0.75.
    expect(a.recentForm).toBeCloseTo(2.3, 9);
    expect(a.trend).toBe("Up");
  });

  it("puts a tournament game among the league's by its day", () => {
    const matchups: Matchup[] = [
      { id: "g1", date: "9/11", away: "A", home: "B" },
      { id: "g2", date: "9/18", away: "A", home: "C" },
    ];
    const logs = { g1: final(9, 4), g2: final(9, 4) };
    // Lost by six at a tournament on 20 September, after both league games.
    const tournament = { home: "OUT", away: "A", homeMargin: 6, date: "2026-09-20", neutral: true };
    const a = rowOf(engine(matchups, logs, [tournament]), "A");
    // +5, +5, -6: -0.5 against an average of 1.33.
    expect(a.recentForm).toBeCloseTo(-0.5, 9);
    expect(a.trend).toBe("Down");
  });

  it("keeps an undated final as the oldest game, where it always was", () => {
    const matchups: Matchup[] = [
      { id: "g1", date: "9/11", away: "A", home: "B" },
      { id: "g2", date: "", away: "A", home: "C" },
      { id: "g3", date: "9/18", away: "A", home: "D" },
    ];
    const logs = { g1: final(9, 4), g2: final(0, 8), g3: final(9, 4) };
    const a = rowOf(engine(matchups, logs), "A");
    // -8 first, then +5 and +5: 17/6 against an average of 0.67.
    expect(a.recentForm).toBeCloseTo(17 / 6, 9);
    expect(a.trend).toBe("Up");
  });
});

describe("the recent-form key factor", () => {
  const FORM = "Recent form supports the projected winner.";
  const opponents = ["C", "D", "E", "F", "G"];
  /**
   * A and B each play five opponents early in September and the same five again late: the early
   * margins are `early` from each side's seat and the late ones `late`. Five late games are all
   * recent form reads, while the rating counts all ten.
   */
  const season = (a: { early: number; late: number }, b: { early: number; late: number }) => {
    const matchups: Matchup[] = [];
    const logs: Record<string, GameLog> = {};
    const play = (side: "A" | "B", margin: number, day: number, opponent: string) => {
      const id = `${side}${day}`;
      matchups.push({ id, date: `9/${day}`, away: side, home: opponent });
      logs[id] = margin >= 0 ? final(4 + margin, 4) : final(4, 4 - margin);
    };
    opponents.forEach((opponent, index) => {
      play("A", a.early, 1 + index, opponent);
      play("B", b.early, 1 + index, opponent);
      play("A", a.late, 20 + index, opponent);
      play("B", b.late, 20 + index, opponent);
    });
    const result = engine(matchups, logs);
    const prediction = result.predictions.find((game) => game.gameId === "next")!;
    return { result, prediction };
  };

  it("is left out when the underdog is the one in form", () => {
    // A won big and has since slipped; B lost big and has since been winning.
    const { result, prediction } = season({ early: 8, late: -1 }, { early: -8, late: 3 });
    expect(prediction.predictedWinnerId).toBe("A");
    expect(rowOf(result, "B").recentForm - rowOf(result, "A").recentForm).toBeGreaterThan(1);
    expect(prediction.keyFactors).not.toContain(FORM);
  });

  it("is given when the favourite is the one in form", () => {
    const { result, prediction } = season({ early: 3, late: 8 }, { early: 1, late: -1 });
    expect(prediction.predictedWinnerId).toBe("A");
    expect(rowOf(result, "A").recentForm - rowOf(result, "B").recentForm).toBeGreaterThan(1);
    expect(prediction.keyFactors).toContain(FORM);
  });
});
