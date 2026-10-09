import { describe, expect, it } from "vitest";
import type { ScoutGame } from "../../teamRankings";
import {
  coerceGames,
  encodeGames,
  findListed,
  gamesKey,
  seenAs,
  type GamesView,
} from "../views/gamesShape";

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

describe("a game the list shows, found in the list as it is now", () => {
  const shown = () => coerceGames(wire())?.games ?? [];

  it("is what the list shows of it, and nothing it leaves out", () => {
    expect(shown().map(seenAs)).toEqual([
      {
        teamAId: "S-1",
        teamBId: "S-2",
        teamAScore: 5,
        teamBScore: 3,
        date: "2027-04-15",
        event: "Placeholder Cup",
      },
      { teamAId: "S-3", teamBId: "S-2", date: "2027-04-16" },
      { teamAId: "S-1", teamBId: "S-2", teamAScore: 0, teamBScore: 12, excluded: true },
      { teamAId: "S-1", teamBId: "S-9", teamAScore: 2, teamBScore: 2, date: "2027-03-01" },
    ]);
    // A record's own fields the list never shows are not part of it.
    expect(
      seenAs({ ...VIEW.games[1]!, startTs: "2027-04-16T18:00:00Z", scoreConfirmed: 2 })
    ).toEqual({
      teamAId: "S-3",
      teamBId: "S-2",
      date: "2027-04-16",
    });
  });

  it("is the game at its place while that game still shows so", () => {
    for (const [at, one] of shown().entries())
      expect(findListed(VIEW.games, at, seenAs(one))).toBe(VIEW.games[at]!.id);
  });

  it("is the one game that shows so anywhere, once the list has moved", () => {
    const moved = [game({ id: "g0", teamAScore: 1, teamBScore: 0 }), ...VIEW.games];
    expect(findListed(moved, 1, seenAs(shown()[1]!))).toBe("g2");
    expect(findListed(moved, 9, seenAs(shown()[3]!))).toBe("g4");
  });

  it("is none where any one thing the list showed of it differs", () => {
    const [first, , third] = shown();
    const { event: _event, ...noEvent } = seenAs(first!);
    const { date: _date, ...noDate } = seenAs(first!);
    const { teamAScore: _a, ...noScoreA } = seenAs(first!);
    const { teamBScore: _b, ...noScoreB } = seenAs(first!);
    const { excluded: _excluded, ...counted } = seenAs(third!);
    for (const seen of [noEvent, noDate, noScoreA, noScoreB])
      expect(findListed(VIEW.games, 0, seen)).toBe(null);
    expect(findListed(VIEW.games, 2, counted)).toBe(null);
    expect(findListed(VIEW.games, 0, { ...seenAs(first!), teamAId: "S-3" })).toBe(null);
    expect(findListed(VIEW.games, 0, { ...seenAs(first!), teamBId: "S-3" })).toBe(null);
  });

  it("is none where no game shows so, or two do and neither at its place", () => {
    const scored = seenAs({ ...shown()[1]!, teamAScore: 4, teamBScore: 5 });
    expect(findListed(VIEW.games, 1, scored)).toBe(null);
    const twice = [...VIEW.games, game({ id: "g5", teamAId: "S-3", date: "2027-04-16" })];
    expect(findListed(twice, 0, seenAs(shown()[1]!))).toBe(null);
    // At its place, it is that one.
    expect(findListed(twice, 1, seenAs(shown()[1]!))).toBe("g2");
  });
});
