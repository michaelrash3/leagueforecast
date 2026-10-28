import { describe, expect, it } from "vitest";
import { boardShift, leaveOutStandIns, oneOffGames, standInBreakdown } from "../standInLevers";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../teamRankings";

/*
 * What the year's share of games on a stand-in is made of, which games a lever leaving one-off names
 * out would take, and how far a board's places move between two readings. Placeholder names.
 */
const PAGE = "ag_10u_2027";
const OLD = "ag_10u_2026";
const GROUPS: AgeGroup[] = [
  { id: PAGE, name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] },
  { id: OLD, name: "10U 2026", ageLevel: 10, year: 2026, seasonIds: [] },
];
const pulled = (id: string): ScoutTeam => ({
  id,
  name: `Club ${id}`,
  gcTeams: [{ teamId: `gc-${id}`, name: `Club ${id}`, ageGroupId: PAGE, ageLevel: 10 }],
});
const TEAMS: ScoutTeam[] = [
  pulled("A"),
  pulled("B"),
  { id: "ONCE", name: "Once", nameOnly: true },
  { id: "TWICE", name: "Twice", nameOnly: true },
  { id: "SLOT", name: "Winner of Game 3", placeholder: true },
];
let made = 0;
const game = (a: string, b: string, ageGroupId = PAGE): ScoutGame => ({
  id: `g${(made += 1)}`,
  ageGroupId,
  teamAId: a,
  teamBId: b,
  teamAScore: 3,
  teamBScore: 1,
});
const GAMES = [
  game("A", "B"),
  game("A", "ONCE"),
  game("A", "TWICE"),
  game("B", "TWICE"),
  game("B", "SLOT"),
  // Another year's game is not counted.
  game("A", "ONCE", OLD),
];

describe("the year's games on a stand-in, by what holds them there", () => {
  it("counts each game once, by its slot or by how many games its name holds and why", () => {
    const why = { ONCE: "unmatched", TWICE: "oneOtherState" } as const;
    const breakdown = standInBreakdown(TEAMS, GAMES, GROUPS, 2027, (id) =>
      id in why ? why[id as keyof typeof why] : undefined
    );
    expect(breakdown).toEqual({
      games: 5,
      onStandIn: 4,
      slots: 1,
      byCount: { "1": 1, "2": 2, "3-4": 0, "5-9": 0, "10+": 0 },
      byWhy: { unmatched: 1, oneOtherState: 2 },
      oneOffByWhy: { unmatched: 1 },
      byCountWhy: {
        "1": { unmatched: 1 },
        "2": { oneOtherState: 2 },
        "3-4": {},
        "5-9": {},
        "10+": {},
      },
    });
  });

  it("reads a game of two names by the one holding fewer games", () => {
    const twoNames = [...GAMES.slice(0, 5), game("ONCE", "TWICE")];
    const breakdown = standInBreakdown(TEAMS, twoNames, GROUPS, 2027, () => "unmatched");
    // "Once" now holds two games, and "Twice" three: the game of both is read as "Once"'s.
    expect(breakdown.byCount).toEqual({ "1": 0, "2": 2, "3-4": 2, "5-9": 0, "10+": 0 });
  });
});

describe("the games a one-off name holds", () => {
  it("is every game whose every name side holds no other, and never a game with a slot", () => {
    const year = GAMES.slice(0, 5);
    expect([...oneOffGames(TEAMS, year)]).toEqual([year[1]!.id]);
    // "Solo" holds one game, against a slot: never one, the slot being another question.
    const solo: ScoutTeam = { id: "SOLO", name: "Solo", nameOnly: true };
    const teams = [...TEAMS, solo];
    expect([...oneOffGames(teams, [...year, game("SOLO", "SLOT")])]).toEqual([year[1]!.id]);
    // A game of a one-off name and one holding two: not every name side is a one-off.
    const mixed = [...year.filter((one) => one.teamBId !== "ONCE"), game("SOLO", "TWICE")];
    expect([...oneOffGames(teams, mixed)]).toEqual([]);
    // Names holding two games or fewer: both of "Twice"'s as well.
    expect([...oneOffGames(TEAMS, year, 2)]).toEqual([year[1]!.id, year[2]!.id, year[3]!.id]);
  });
});

describe("a lever as the model sweep tries it", () => {
  it("leaves out the few-game names' games of those trained, and the slots' games where asked", () => {
    const trained = GAMES.slice(0, 5).map((game) => ({ game, ageGap: 0 }));
    const ids = (set: ReadonlySet<string>) => [...set].sort();
    expect(ids(leaveOutStandIns(1, false)(TEAMS, trained))).toEqual([GAMES[1]!.id]);
    expect(ids(leaveOutStandIns(2, false)(TEAMS, trained))).toEqual(
      [GAMES[1]!.id, GAMES[2]!.id, GAMES[3]!.id].sort()
    );
    expect(ids(leaveOutStandIns(1, true)(TEAMS, trained))).toEqual(
      [GAMES[1]!.id, GAMES[4]!.id].sort()
    );
    expect(ids(leaveOutStandIns(0, true)(TEAMS, trained))).toEqual([GAMES[4]!.id]);
  });
});

describe("how far a board's places move", () => {
  const board = (ids: string[]) => ids.map((teamId, at) => ({ teamId, rank: at + 1 }));

  it("says the top kept, the middle move and the clubs moving more than a tenth of the board", () => {
    const before = board(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]);
    const after = board(["b", "a", "c", "d", "e", "f", "g", "j", "i", "h"]);
    expect(boardShift(before, after, 3)).toEqual({
      compared: 10,
      topKept: 3,
      top: 3,
      medianMove: 0,
      movedTenth: 2,
    });
    expect(boardShift(before, board(["x", "y", "z"]), 3)).toMatchObject({
      compared: 0,
      topKept: 0,
      medianMove: 0,
    });
  });
});
