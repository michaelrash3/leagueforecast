import { describe, expect, it } from "vitest";
import { daysBefore, movementOf, ranksAsOf } from "../rankMovement";
import { buildTeamRankings, type AgeGroup, type ScoutGame, type ScoutTeam } from "../teamRankings";

const groups: AgeGroup[] = [
  { id: "ag10", name: "10U 2027", seasonIds: [], ageLevel: 10, year: 2027 },
];
const teams: ScoutTeam[] = ["A", "B", "C", "D"].map((id) => ({ id, name: id }));
const played = (id: string, a: string, b: string, sa: number, sb: number, date: string) =>
  ({
    id,
    ageGroupId: "ag10",
    teamAId: a,
    teamBId: b,
    teamAScore: sa,
    teamBScore: sb,
    date,
  }) as ScoutGame;

// A leads the first fortnight; D wins everything in the last week and climbs.
const games = [
  played("g1", "A", "B", 8, 1, "2026-09-05"),
  played("g2", "A", "C", 7, 2, "2026-09-06"),
  played("g3", "B", "D", 6, 3, "2026-09-12"),
  played("g4", "C", "D", 5, 4, "2026-09-13"),
  played("g5", "D", "A", 9, 1, "2026-09-19"),
  played("g6", "D", "B", 9, 2, "2026-09-20"),
];

describe("where each club stood a week ago", () => {
  it("counts back whole days", () => {
    expect(daysBefore("2026-09-21")).toBe("2026-09-14");
    expect(daysBefore("2026-03-02", 7)).toBe("2026-02-23");
  });

  it("is the board fitted on the games played by then", () => {
    const before = ranksAsOf("ag10", teams, games, groups, undefined, "2026-09-14");
    const board = buildTeamRankings("ag10", teams, games.slice(0, 4), undefined, groups);
    expect(before).toEqual(Object.fromEntries(board.map((row) => [row.teamId, row.rank])));
    expect(before.D).toBe(4);
  });

  it("gives every page of the year from the one fit", () => {
    const two: AgeGroup[] = [
      ...groups,
      { id: "ag11", name: "11U 2027", seasonIds: [], ageLevel: 11, year: 2027 },
    ];
    const older: ScoutTeam = { id: "E", name: "E" };
    const eleven = [
      played("e1", "E", "A", 5, 4, "2026-09-06"),
      { ...played("e2", "E", "B", 6, 2, "2026-09-07"), ageGroupId: "ag11" },
    ];
    const ranks = ranksAsOf(
      "ag10",
      [...teams, older],
      [...games, ...eleven],
      two,
      undefined,
      "2026-09-14"
    );
    expect(ranks.E).toBeDefined();
  });
});

describe("how far a club has moved", () => {
  const lastWeek = { A: 1, B: 2, D: 4 };

  it("counts places climbed, and a fall as negative", () => {
    expect(movementOf("D", 1, lastWeek)).toBe(3);
    expect(movementOf("A", 2, lastWeek)).toBe(-1);
    expect(movementOf("B", 2, lastWeek)).toBe(0);
  });

  it("calls a club that was not on last week's board new", () => {
    expect(movementOf("C", 3, lastWeek)).toBe("new");
  });

  it("says nothing without a board a week ago to compare with", () => {
    expect(movementOf("C", 3, null)).toBeUndefined();
    expect(movementOf("C", 3, {})).toBeUndefined();
  });
});
