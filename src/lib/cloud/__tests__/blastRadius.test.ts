import { describe, expect, it } from "vitest";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../../teamRankings/types";
import { blastRadius, heldWord, pastTheLine, poolYears, radiusWords } from "../blastRadius";

/*
 * What a nightly's save would take away, by squad year, and the line past which it is held (the
 * owner's rule: more than 5% of a year's games or 2% of its clubs).
 */

const page = (id: string, year?: number): AgeGroup =>
  ({ id, name: id, ...(year === undefined ? {} : { year }) }) as AgeGroup;

const games = (count: number, ageGroupId: string, prefix = "g"): ScoutGame[] =>
  Array.from({ length: count }, (_, at) => ({
    id: `${prefix}${at}`,
    teamAId: `${prefix}c${at % 100}`,
    teamBId: `${prefix}c${(at + 1) % 100}`,
    ageGroupId,
  }));

const after = (pool: { games: readonly ScoutGame[]; teams: readonly ScoutTeam[] }) => ({
  games: new Set(pool.games.map((game) => game.id)),
  clubs: new Set([
    ...pool.teams.map((team) => team.id),
    ...pool.games.flatMap((game) => [game.teamAId, game.teamBId]),
  ]),
});

describe("what a save would take away", () => {
  const before = poolYears({
    ageGroups: [page("9u", 2027), page("old", 2025), page("loose")],
    teams: [],
    games: [...games(1000, "9u"), ...games(20, "old", "o"), ...games(5, "loose", "l")],
  });

  it("counts each year's games and clubs, and leaves a page with no year out", () => {
    expect([...before.keys()].sort()).toEqual([2025, 2027]);
    expect(before.get(2027)?.games.size).toBe(1000);
    expect(before.get(2027)?.clubs.size).toBe(100);
  });

  it("holds a save that takes more than 5% of a year's games, and not one that takes 5%", () => {
    const pool = games(1000, "9u");
    const radius = (removed: number) =>
      blastRadius(before, after({ games: pool.slice(removed), teams: [] })).find(
        (year) => year.year === 2027
      )!;
    expect(radius(60)).toMatchObject({ games: 1000, gamesRemoved: 60 });
    expect(pastTheLine([radius(60)])).toHaveLength(1);
    expect(pastTheLine([radius(50)])).toHaveLength(0);
  });

  it("holds a save that takes more than 2% of a year's clubs", () => {
    const year = { year: 2027, games: 50_000, gamesRemoved: 0, clubs: 2000, clubsRemoved: 41 };
    expect(pastTheLine([year])).toHaveLength(1);
    expect(pastTheLine([{ ...year, clubsRemoved: 40 }])).toHaveLength(0);
  });

  it("holds nothing for a small year's handful, under the floor", () => {
    expect(
      pastTheLine([{ year: 2025, games: 20, gamesRemoved: 10, clubs: 15, clubsRemoved: 5 }])
    ).toHaveLength(0);
  });

  it("does not count a game or club that moved to another year as taken away", () => {
    // Every 2025 game refiled onto the 2027 page, under the same ids.
    const moved = [...games(1000, "9u"), ...games(20, "9u", "o")];
    const radius = blastRadius(before, after({ games: moved, teams: [] }));
    expect(radius.find((year) => year.year === 2025)).toMatchObject({
      gamesRemoved: 0,
      clubsRemoved: 0,
    });
  });

  it("counts a club still in the pool, with no game left, as kept", () => {
    const teams = Array.from(
      { length: 100 },
      (_, at) => ({ id: `gc${at}`, name: "" }) as ScoutTeam
    );
    const radius = blastRadius(before, after({ games: [], teams }));
    expect(radius.find((year) => year.year === 2027)).toMatchObject({
      gamesRemoved: 1000,
      clubsRemoved: 0,
    });
  });

  it("says what it would have done, in numbers", () => {
    expect(
      radiusWords({ year: 2027, games: 1000, gamesRemoved: 60, clubs: 100, clubsRemoved: 3 })
    ).toBe("2027: would have removed 60 of 1000 games (6.0%) and 3 of 100 clubs (3.0%)");
  });

  it("hands the alarm step numbers only", () => {
    expect(heldWord([])).toBe("none");
    expect(
      heldWord([
        { year: 2027, games: 1000, gamesRemoved: 60, clubs: 100, clubsRemoved: 3 },
        { year: 2026, games: 500, gamesRemoved: 0, clubs: 2000, clubsRemoved: 41 },
      ])
    ).toBe("held 2027:60/1000:3/100,2026:0/500:41/2000");
  });
});
