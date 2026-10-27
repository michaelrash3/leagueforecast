import { describe, expect, it } from "vitest";
import { myTeamGlance } from "../myTeamGlance";
import type { ScoutRankingRow, UpcomingMatchup } from "../teamRankings";

const row = (teamId: string, rank: number, extra: Partial<ScoutRankingRow> = {}) =>
  ({
    teamId,
    teamName: teamId,
    isMine: false,
    rank,
    rating: 10 - rank,
    record: `${10 - rank}-${rank}`,
    wins: 10 - rank,
    losses: rank,
    games: 10,
    ...extra,
  }) as ScoutRankingRow;

const rankings = [row("A", 1), row("B", 2), row("C", 3), row("D", 4), row("E", 5)];
const states: Record<string, string> = { A: "TX", B: "OH", C: "KY", D: "OH", E: "OH" };
const stateOf = (teamId: string) => states[teamId];
const saturday: UpcomingMatchup = {
  gameId: "g1",
  date: "2026-09-19",
  opponentId: "B",
  opponentName: "B",
  opponentRank: 2,
  winProb: 0.42,
};

describe("my team at a glance", () => {
  it("reads its place in the whole table and among its state's clubs, and its next game", () => {
    expect(myTeamGlance(rankings, "D", stateOf, [saturday])).toEqual({
      teamId: "D",
      teamName: "D",
      nationalRank: 4,
      nationalOf: 5,
      state: "OH",
      stateRank: 2,
      stateOf: 3,
      record: "6-4",
      rating: 6,
      next: saturday,
    });
  });

  it("keeps the unfiltered place when a filter has renumbered the rows", () => {
    const filtered = [row("D", 1, { overallRank: 4 })];
    expect(myTeamGlance(filtered, "D", stateOf, [])?.nationalRank).toBe(4);
  });

  it("says nothing of a state it does not have, or a game it has not got", () => {
    const glance = myTeamGlance(rankings, "C", () => undefined, []);
    expect(glance).not.toHaveProperty("state");
    expect(glance).not.toHaveProperty("stateRank");
    expect(glance).not.toHaveProperty("next");
  });

  it("is nothing without a team, or for one that is not on this table", () => {
    expect(myTeamGlance(rankings, undefined, stateOf, [])).toBeNull();
    expect(myTeamGlance(rankings, "Z", stateOf, [])).toBeNull();
  });
});
