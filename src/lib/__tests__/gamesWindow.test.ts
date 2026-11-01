import { describe, expect, it } from "vitest";
import {
  everyGameListed,
  gamesWindowFor,
  loggedGamesOn,
  stepGamesWindow,
  windowGames,
  type GamesWindow,
} from "../teamRankings/gamesWindow";
import type { ScoutGame } from "../teamRankings";

/*
 * The Games tab's one day: today's games, or on a day in season with none, the next day that has
 * them. The day decides everything the list shows, so it is pinned from every direction: a squad
 * year today is in, its first and last days, a season already over, one not yet begun, a page with
 * no year, and a day in season with no games.
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
  it("is today, on a day with games in a squad year today is in", () => {
    expect(
      gamesWindowFor({
        today: "2026-10-02",
        year: 2027,
        games: [game("a", "2026-09-29"), game("b", "2026-10-02")],
      })
    ).toEqual({ day: "2026-10-02", basis: "today" });
  });

  it("stays today on the last day of a squad year and the first, when they have games", () => {
    const games = [
      game("g", "2026-09-12"),
      game("first", "2026-08-01"),
      game("last", "2027-07-31"),
    ];
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

/*
 * Every choice the window makes on one page, as the day it lists and what that day is, for each
 * kind of today: a change to the rule shows here as the rows it moves, and only those.
 */
describe("the window's choices on one page", () => {
  const games = [
    game("sep", "2026-09-12", [4, 2]),
    game("oct-31-played", "2026-10-31", [3, 1]),
    game("oct-31-open", "2026-10-31"),
    game("nov-7", "2026-11-07"),
    game("may", "2027-05-01"),
    game("undated", undefined),
  ];
  const choice = (today: string, year: number | undefined, list = games) => {
    const { day, basis } = gamesWindowFor({ today, year, games: list });
    return `${day} ${basis}`;
  };

  it.each([
    ["a day in season with games", "2026-10-31", 2027, "2026-10-31 today"],
    // The three days in season with no games, which open on the next day with games or the last.
    ["a day in season between two with games", "2026-11-01", 2027, "2026-11-07 next"],
    ["a day in season before its first game", "2026-08-02", 2027, "2026-09-12 next"],
    ["a day in season after its last game", "2027-06-01", 2027, "2027-05-01 last"],
    ["the day after the season", "2027-08-01", 2027, "2027-05-01 season-end"],
    ["a day before the season", "2026-07-31", 2027, "2026-09-12 season-start"],
    ["a page with no year", "2026-11-01", undefined, "2026-11-01 today"],
  ])("%s", (_, today, year, said) => {
    expect(choice(today, year)).toBe(said);
  });

  it("is today on a day in season when no game has a date", () => {
    expect(choice("2026-11-01", 2027, [game("undated", undefined)])).toBe("2026-11-01 today");
  });
});

describe("an empty day in season", () => {
  const games = [
    game("sep", "2026-09-12", [4, 2]),
    game("oct-31", "2026-10-31", [3, 1]),
    game("nov-7", "2026-11-07"),
    game("nov-8", "2026-11-08"),
  ];

  it("opens on the next day with games, with the last day with games to step back to", () => {
    expect(gamesWindowFor({ today: "2026-11-01", year: 2027, games })).toEqual({
      day: "2026-11-07",
      basis: "next",
      back: "2026-10-31",
    });
  });

  it("has no step back before the season's first game", () => {
    expect(gamesWindowFor({ today: "2026-08-20", year: 2027, games })).toEqual({
      day: "2026-09-12",
      basis: "next",
    });
  });

  it("opens on the last day with games when none is still to come", () => {
    expect(gamesWindowFor({ today: "2026-11-20", year: 2027, games })).toEqual({
      day: "2026-11-08",
      basis: "last",
    });
  });

  it("steps back to the last day with games, and forward again", () => {
    const opened = gamesWindowFor({ today: "2026-11-01", year: 2027, games });
    const back = stepGamesWindow(opened);
    expect(back).toEqual({ day: "2026-10-31", basis: "last", forward: "2026-11-07" });
    expect(stepGamesWindow(back)).toEqual(opened);
  });

  it("does not step from a day with games, a season out of reach or a day with nowhere to go", () => {
    for (const window of [
      gamesWindowFor({ today: "2026-10-31", year: 2027, games }),
      gamesWindowFor({ today: "2027-08-20", year: 2027, games }),
      gamesWindowFor({ today: "2026-08-20", year: 2027, games }),
      gamesWindowFor({ today: "2026-11-20", year: 2027, games }),
    ])
      expect(stepGamesWindow(window)).toBe(window);
  });
});

describe("everyGameListed", () => {
  const timed = (id: string, date: string, start: string, scores?: [number, number]) => ({
    ...game(id, date, scores),
    startTs: start,
  });

  it("lists the games still to play soonest first, above the rest as they came", () => {
    // As the page holds them: newest first, a day's later start first, untimed last.
    const logged = loggedGamesOn(
      [
        timed("sun-noon", "2026-11-08", "2026-11-08T17:00:00Z"),
        game("sun-untimed", "2026-11-08"),
        timed("sat-late", "2026-11-07", "2026-11-07T23:00:00Z"),
        timed("sat-early", "2026-11-07", "2026-11-07T14:30:00Z"),
        game("today-open", "2026-11-01"),
        game("today-played", "2026-11-01", [2, 1]),
        game("ahead-scored", "2026-11-14", [9, 0]),
        game("oct-played", "2026-10-31", [3, 1]),
        game("owed", "2026-10-24"),
        game("sep-played", "2026-09-12", [4, 2]),
        game("undated", undefined),
      ],
      "ag_10u_2027"
    );
    expect(everyGameListed(logged, "2026-11-01").map((one) => one.id)).toEqual([
      "today-open",
      "sat-early",
      "sat-late",
      "sun-noon",
      "sun-untimed",
      "ahead-scored",
      "today-played",
      "oct-played",
      "owed",
      "sep-played",
      "undated",
    ]);
  });

  it("leaves the list it is given as it was", () => {
    const logged = [game("later", "2026-11-08"), game("sooner", "2026-11-07")];
    everyGameListed(logged, "2026-11-01");
    expect(logged.map((one) => one.id)).toEqual(["later", "sooner"]);
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

describe("loggedGamesOn", () => {
  it("lists a page's games newest first, a day's in their stored order, and no other page's", () => {
    const stored = [
      game("old", "2027-03-01"),
      game("new", "2027-04-02"),
      { ...game("elsewhere", "2027-04-09"), ageGroupId: "ag_9u_2027" },
      game("undated", undefined),
      game("new-too", "2027-04-02"),
      game("mid", "2027-03-15"),
    ];
    expect(loggedGamesOn(stored, "ag_10u_2027").map((one) => one.id)).toEqual([
      "new",
      "new-too",
      "mid",
      "old",
      "undated",
    ]);
    // And it leaves the stored list as it was.
    expect(stored.map((one) => one.id)[0]).toBe("old");
  });
});
