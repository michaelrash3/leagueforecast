import { describe, expect, it } from "vitest";
import type { ScoutGame } from "../../teamRankings";
import { coerceGames, encodeGames, gamesKey, type GamesView } from "../views/gamesShape";

/*
 * A page's Games list as published and read back (`gamesShape.ts`): its key, the list through the
 * wire and back, and the check that refuses one that is not a list. Placeholder names throughout.
 */

const PAGE = "ag_10u_2027";
const game = (more: Partial<ScoutGame> & Pick<ScoutGame, "id">): ScoutGame => ({
  teamAId: "S-1",
  teamBId: "S-2",
  ageGroupId: PAGE,
  ...more,
});

const VIEW: GamesView = {
  page: PAGE,
  games: [
    game({ id: "g1", teamAScore: 5, teamBScore: 3, date: "2027-04-15", event: "Placeholder Cup" }),
    // Still to be played, set not to count, with no day, and against a club with no name.
    game({ id: "g2", teamAId: "S-3", date: "2027-04-16" }),
    game({ id: "g3", teamAScore: 0, teamBScore: 12, excluded: true }),
    game({ id: "g4", teamBId: "S-9", teamAScore: 2, teamBScore: 2, date: "2027-03-01" }),
  ],
  names: new Map([
    ["S-1", "Placeholder Hawks"],
    ["S-2", "Placeholder Bees"],
    ["S-3", "Placeholder Cows"],
  ]),
};

const wire = () =>
  JSON.parse(JSON.stringify(encodeGames(VIEW))) as {
    page: unknown;
    teams: unknown[][];
    games: unknown[][];
  };

describe("a page's Games list", () => {
  it("is named by year and page, with none for a page without a year", () => {
    expect(gamesKey(2027, PAGE)).toBe("games:2027:ag_10u_2027");
    expect(gamesKey(undefined, "ag_showcase")).toBe("games:none:ag_showcase");
  });

  it("reads back as it was published, but for its games' ids, which are their places", () => {
    expect(coerceGames(wire())).toEqual({
      ...VIEW,
      games: VIEW.games.map((one, at) => ({ ...one, id: String(at) })),
    });
  });

  it("names each club once, and one the roster has no name for by its id alone", () => {
    const sent = encodeGames(VIEW);
    expect(sent.teams).toEqual([
      ["S-1", "Placeholder Hawks"],
      ["S-2", "Placeholder Bees"],
      ["S-3", "Placeholder Cows"],
      ["S-9"],
    ]);
    expect(sent.games.map((one) => [one[0], one[1]])).toEqual([
      [0, 1],
      [2, 1],
      [0, 1],
      [0, 3],
    ]);
  });

  it("is refused a game filed on another page", () => {
    expect(() =>
      encodeGames({ ...VIEW, games: [game({ id: "x", ageGroupId: "ag_9u_2027" })] })
    ).toThrow(/filed on ag_9u_2027/);
  });
});

describe("a published Games list read back", () => {
  const refused = (spoil: (list: ReturnType<typeof wire>) => void) => {
    const list = wire();
    spoil(list);
    return coerceGames(list);
  };

  it("is nothing at all when any part of it is not a list's", () => {
    expect(coerceGames(null)).toBeNull();
    expect(coerceGames([])).toBeNull();
    expect(refused((list) => (list.page = ""))).toBeNull();
    expect(refused((list) => (list.teams = {} as never))).toBeNull();
    expect(refused((list) => (list.games = {} as never))).toBeNull();
    expect(refused((list) => list.teams.push(["S-1"]))).toBeNull();
    expect(refused((list) => list.teams.push([]))).toBeNull();
    expect(refused((list) => list.teams.push(["S-7", 4]))).toBeNull();
    expect(refused((list) => list.teams.push(["S-7", "Placeholder Owls", "more"]))).toBeNull();
    expect(refused((list) => (list.teams[0]![0] = ""))).toBeNull();
    expect(refused((list) => list.games[0]!.push(1))).toBeNull();
    expect(refused((list) => (list.games[0]![0] = 9))).toBeNull();
    expect(refused((list) => (list.games[0]![1] = "1"))).toBeNull();
    expect(refused((list) => (list.games[0]![2] = "5"))).toBeNull();
    expect(refused((list) => (list.games[0]![3] = undefined))).toBeNull();
    expect(refused((list) => (list.games[0]![4] = 20270415))).toBeNull();
    expect(refused((list) => (list.games[0]![5] = null))).toBeNull();
    expect(refused((list) => (list.games[0]![6] = true))).toBeNull();
    // Untouched, it reads.
    expect(coerceGames(wire())).not.toBeNull();
  });
});
