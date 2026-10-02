import { describe, expect, it } from "vitest";
import { gamesWindowFor, windowGames, type GamesWindow } from "../teamRankings/gamesWindow";
import type { ScoutGame } from "../teamRankings";

/*
 * The Games tab's one day: today's games. The day decides everything the list shows, so it is
 * pinned from every direction: a squad year today is in, its first and last days, a season already
 * over, one not yet begun, and a page with no year.
 */

const game = (id: string, date: string | undefined, scores?: [number, number]): ScoutGame => ({
  id,
  ageGroupId: "ag_10u_2027",
  teamAId: "S-A",
  teamBId: "S-B",
  ...(date === undefined ? {} : { date }),
  ...(scores ? { teamAScore: scores[0], teamBScore: scores[1] } : {}),
});

describe("gamesWindowFor", () => {
  it("is today, in a squad year today is in", () => {
    expect(
      gamesWindowFor({ today: "2026-10-02", year: 2027, games: [game("a", "2026-09-29")] })
    ).toEqual({ day: "2026-10-02", basis: "today" });
  });

  it("stays today on the last day of a squad year and the first", () => {
    const games = [game("g", "2026-09-12")];
    expect(gamesWindowFor({ today: "2027-07-31", year: 2027, games }).basis).toBe("today");
    expect(gamesWindowFor({ today: "2026-08-01", year: 2027, games }).basis).toBe("today");
  });

  it("shows a finished season its last day with games", () => {
    const games = [
      game("a", "2026-09-12"),
      game("b", "2027-06-20"),
      game("c", undefined),
      game("d", "2027-05-01"),
    ];
    expect(gamesWindowFor({ today: "2027-10-02", year: 2027, games })).toEqual({
      day: "2027-06-20",
      basis: "season-end",
    });
  });

  it("shows a season not yet begun its first day with games", () => {
    const games = [game("a", "2027-09-05"), game("b", "2027-08-15"), game("c", "2028-04-01")];
    expect(gamesWindowFor({ today: "2026-10-02", year: 2028, games })).toEqual({
      day: "2027-08-15",
      basis: "season-start",
    });
  });

  it("stays today for a season outside it that has no dated game, and for a page with no year", () => {
    expect(
      gamesWindowFor({ today: "2026-10-02", year: 2025, games: [game("u", undefined)] })
    ).toEqual({ day: "2026-10-02", basis: "today" });
    expect(
      gamesWindowFor({ today: "2026-10-02", year: undefined, games: [game("a", "2020-01-01")] })
    ).toEqual({ day: "2026-10-02", basis: "today" });
  });
});

describe("windowGames", () => {
  const window: GamesWindow = { day: "2026-10-02", basis: "today" };
  const games = [
    game("tomorrow", "2026-10-03"),
    game("today-open", "2026-10-02"),
    game("today-played", "2026-10-02", [3, 2]),
    game("yesterday-played", "2026-10-01", [5, 4]),
    game("earlier-open", "2026-09-01"),
    game("undated", undefined),
    game("blank-date", ""),
  ];

  it("keeps the day's games and no other, in the order they came", () => {
    const { shown } = windowGames(games, window, new Set());
    expect(shown.map((entry) => entry.id)).toEqual(["today-open", "today-played"]);
  });

  it("counts what it leaves out, and which of those are undated or still need a score", () => {
    // A game tomorrow without a score is not owed one yet; the one of 1 September is.
    expect(windowGames(games, window, new Set())).toMatchObject({
      hidden: 5,
      undated: 2,
      needingScore: 1,
    });
  });

  it("keeps a game it is told to keep whatever its date, and stops counting it as hidden", () => {
    const result = windowGames(games, window, new Set(["earlier-open", "undated"]));
    expect(result.shown.map((entry) => entry.id)).toEqual([
      "today-open",
      "today-played",
      "earlier-open",
      "undated",
    ]);
    expect(result).toMatchObject({ hidden: 3, undated: 1, needingScore: 0 });
  });
});
