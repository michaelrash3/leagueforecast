import { describe, expect, it } from "vitest";
import type { ScoutRankingRow } from "../teamRankings";
import { CLIMBS_SHOWN, weekMovers } from "../thisWeek";

const row = (teamId: string, rank: number): ScoutRankingRow =>
  ({ teamId, teamName: `Team ${teamId}`, rank }) as unknown as ScoutRankingRow;

describe("weekMovers", () => {
  it("says nothing without a week before to measure against", () => {
    expect(weekMovers([row("a", 1)], null)).toBeNull();
    expect(weekMovers([row("a", 1)], {})).toBeNull();
  });

  it("names who came into the top 25 and who fell out, by where they stand", () => {
    const rows = [row("up", 12), row("new", 20), row("stay", 3), row("down", 31)];
    const movers = weekMovers(rows, { up: 40, stay: 2, down: 8 })!;
    expect(movers.into.map((move) => [move.teamId, move.from, move.to])).toEqual([
      ["up", 40, 12],
      ["new", null, 20],
    ]);
    expect(movers.outOf.map((move) => [move.teamId, move.from, move.to])).toEqual([
      ["down", 8, 31],
    ]);
  });

  it("lists the biggest climbs that end inside the top 100, the biggest first", () => {
    const rows = [
      row("far", 64),
      row("near", 30),
      row("outside", 140),
      row("small", 10),
      row("x", 90),
    ];
    const movers = weekMovers(rows, { far: 210, near: 50, outside: 900, small: 11, x: 120 })!;
    expect(movers.climbs.map((move) => move.teamId)).toEqual(["far", "x", "near"]);
    expect(movers.climbs).toHaveLength(CLIMBS_SHOWN);
  });

  it("reads a row's place overall where the board gives one", () => {
    const shown = { ...row("a", 2), overallRank: 30 } as ScoutRankingRow;
    expect(weekMovers([shown], { a: 10 })!.outOf.map((move) => move.to)).toEqual([30]);
  });
});
