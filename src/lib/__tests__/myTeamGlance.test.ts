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

// D's schedule the second toughest of Ohio's three: B's is tougher, E's easier.
const rankings = [
  row("A", 1, { strengthOfSchedule: 3 }),
  row("B", 2, { strengthOfSchedule: 1.5 }),
  row("C", 3, { strengthOfSchedule: 2 }),
  row("D", 4, { strengthOfSchedule: 1 }),
  row("E", 5, { strengthOfSchedule: -1 }),
];
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
      schedule: { rank: 2, of: 3 },
    });
  });

  it("says its next weekend where it plays two or more games on it", () => {
    const sunday = { ...saturday, gameId: "g2", date: "2026-09-20", opponentId: "E", winProb: 0.8 };
    const later = { ...saturday, gameId: "g3", date: "2026-09-26" };
    const glance = myTeamGlance(rankings, "D", stateOf, [saturday, sunday, later]);
    expect(glance?.weekend).toEqual({
      sunday: "2026-09-20",
      games: [saturday, sunday],
      expectedWins: 0.42 + 0.8,
      toughest: saturday,
      likeliest: sunday,
    });
    expect(myTeamGlance(rankings, "D", stateOf, [saturday, later])).not.toHaveProperty("weekend");
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
