import { describe, expect, it } from "vitest";
import { fitFormat, simulateTournament } from "../tournamentSim";
import type { ScoutRankingRow } from "../teamRankings";

const club = (teamId: string, rating: number, rank: number, componentId = "main") =>
  ({ teamId, teamName: teamId, rating, rank, ageLevel: 10, componentId }) as ScoutRankingRow;

const field = [
  club("A", 6, 1),
  club("B", 4, 2),
  club("C", 2, 3),
  club("D", 1, 4),
  club("E", 0, 5),
  club("F", -1, 6),
  club("G", -3, 7),
  club("H", -5, 8),
];

describe("a format the field can be played in", () => {
  it("keeps pools at two clubs or more and the bracket a power of two no bigger than the field", () => {
    expect(fitFormat({ pools: 4, advance: 4 }, 5)).toEqual({ pools: 2, advance: 4 });
    expect(fitFormat({ pools: 2, advance: 8 }, 6)).toEqual({ pools: 2, advance: 4 });
    expect(fitFormat({ pools: 1, advance: 3 }, 6)).toEqual({ pools: 1, advance: 2 });
  });
});

describe("the event played out", () => {
  const result = simulateTournament(field, { pools: 2, advance: 4 })!;

  it("draws the pools by snaking down the ratings", () => {
    const poolOf = Object.fromEntries(result.field.map((row) => [row.teamId, row.pool]));
    expect(["A", "D", "E", "H"].map((id) => poolOf[id])).toEqual([1, 1, 1, 1]);
    expect(["B", "C", "F", "G"].map((id) => poolOf[id])).toEqual([2, 2, 2, 2]);
  });

  it("gives out exactly one winner, two finalists and one pool winner a pool", () => {
    const sum = (key: "win" | "reachFinal" | "winPool") =>
      result.field.reduce((total, row) => total + row[key], 0);
    expect(sum("win")).toBeCloseTo(1, 9);
    expect(sum("reachFinal")).toBeCloseTo(2, 9);
    expect(sum("winPool")).toBeCloseTo(2, 9);
  });

  it("favours the strongest club, and lists the field most likely winner first", () => {
    expect(result.field[0]?.teamId).toBe("A");
    expect(result.field[0]!.win).toBeGreaterThan(result.field[7]!.win);
  });

  it("reads the same every time it is opened", () => {
    expect(simulateTournament(field, { pools: 2, advance: 4 })).toEqual(result);
  });

  it("says how strong the field is", () => {
    expect(result.strength).toEqual({ averageRating: 0.5, averageRank: 4.5, bestRank: 1 });
  });

  it("flags a club rated against a different set of teams from the rest", () => {
    const withStranger = simulateTournament([...field.slice(0, 3), club("Z", 3, 9, "elsewhere")], {
      pools: 1,
      advance: 2,
    })!;
    expect(withStranger.field.find((row) => row.teamId === "Z")?.apart).toBe(true);
    expect(withStranger.field.find((row) => row.teamId === "A")?.apart).toBe(false);
  });

  it("is nothing for a field of one", () => {
    expect(simulateTournament(field.slice(0, 1), { pools: 1, advance: 2 })).toBeNull();
  });
});
