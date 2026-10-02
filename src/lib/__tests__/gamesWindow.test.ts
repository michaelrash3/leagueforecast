import { describe, expect, it } from "vitest";
import {
  GAMES_WINDOW_DAYS,
  gamesWindowFor,
  windowGames,
  type GamesWindow,
} from "../teamRankings/gamesWindow";
import type { ScoutGame } from "../teamRankings";
import { inTimeZone } from "../../test/timeZone";

/*
 * The Games tab's week either side of the last update. The day the window is centred on decides
 * everything the list shows, so it is pinned from every direction: the newest pull, the reader's
 * day when nothing was pulled, and a squad year that day is not in.
 */

const game = (id: string, date: string | undefined, scores?: [number, number]): ScoutGame => ({
  id,
  ageGroupId: "ag_10u_2027",
  teamAId: "S-A",
  teamBId: "S-B",
  ...(date === undefined ? {} : { date }),
  ...(scores ? { teamAScore: scores[0], teamBScore: scores[1] } : {}),
});

const NOON_29_SEP = new Date(2026, 8, 29, 12).toISOString();
/** A pull a season later, when 2027 is over. */
const NOON_1_OCT_2027 = new Date(2027, 9, 1, 12).toISOString();

describe("gamesWindowFor", () => {
  it("centres on the day of the newest pull, a week either side, both ends included", () => {
    const window = gamesWindowFor({
      pulledAt: NOON_29_SEP,
      today: "2026-10-02",
      year: 2027,
      games: [],
    });
    expect(GAMES_WINDOW_DAYS).toBe(7);
    expect(window).toEqual({
      anchor: "2026-09-29",
      from: "2026-09-22",
      to: "2026-10-06",
      basis: "pull",
    });
  });

  it("reads an evening pull as the reader's own day, though it is tomorrow in UTC", () => {
    inTimeZone("America/Los_Angeles", () => {
      // 9:30 in the evening of 29 September in California is 04:30 on 30 September in UTC.
      const evening = new Date(2026, 8, 29, 21, 30).toISOString();
      expect(evening.startsWith("2026-09-30")).toBe(true);
      expect(
        gamesWindowFor({ pulledAt: evening, today: "2026-10-02", year: 2027, games: [] }).anchor
      ).toBe("2026-09-29");
    });
  });

  it("reads the pull as the reader's own day, as every other date on the page is", () => {
    // Late evening locally can be tomorrow in UTC; the window must not move a day for it.
    const lateEvening = new Date(2026, 8, 29, 23, 30).toISOString();
    expect(
      gamesWindowFor({ pulledAt: lateEvening, today: "2026-10-02", year: 2027, games: [] }).anchor
    ).toBe("2026-09-29");
  });

  it("uses the reader's day when nothing was ever pulled, or the pull time is not a time", () => {
    for (const pulledAt of [null, "not a time"]) {
      expect(gamesWindowFor({ pulledAt, today: "2026-10-02", year: 2027, games: [] })).toEqual({
        anchor: "2026-10-02",
        from: "2026-09-25",
        to: "2026-10-09",
        basis: "today",
      });
    }
  });

  it("keeps the anchor on the last day of a squad year and the first", () => {
    const games = [game("g", "2026-09-12")];
    expect(gamesWindowFor({ pulledAt: null, today: "2027-07-31", year: 2027, games }).basis).toBe(
      "today"
    );
    expect(gamesWindowFor({ pulledAt: null, today: "2026-08-01", year: 2027, games }).basis).toBe(
      "today"
    );
  });

  it("windows a finished season around its last day with games", () => {
    const games = [
      game("a", "2026-09-12"),
      game("b", "2027-06-20"),
      game("c", undefined),
      game("d", "2027-05-01"),
    ];
    expect(
      gamesWindowFor({ pulledAt: NOON_1_OCT_2027, today: "2027-10-02", year: 2027, games })
    ).toEqual({
      anchor: "2027-06-20",
      from: "2027-06-13",
      to: "2027-06-27",
      basis: "season",
    });
  });

  it("windows a season not yet begun around its first day with games", () => {
    const games = [game("a", "2027-09-05"), game("b", "2027-08-15"), game("c", "2028-04-01")];
    expect(
      gamesWindowFor({ pulledAt: NOON_29_SEP, today: "2026-10-02", year: 2028, games }).anchor
    ).toBe("2027-08-15");
  });

  it("keeps the anchor for a season outside it that has no dated game, and for a page with no year", () => {
    expect(
      gamesWindowFor({
        pulledAt: null,
        today: "2026-10-02",
        year: 2025,
        games: [game("u", undefined)],
      }).basis
    ).toBe("today");
    expect(
      gamesWindowFor({
        pulledAt: null,
        today: "2026-10-02",
        year: undefined,
        games: [game("a", "2020-01-01")],
      }).anchor
    ).toBe("2026-10-02");
  });
});

describe("windowGames", () => {
  const window: GamesWindow = {
    anchor: "2026-09-29",
    from: "2026-09-22",
    to: "2026-10-06",
    basis: "pull",
  };
  const games = [
    game("ahead-out", "2026-10-07"),
    game("ahead-in", "2026-10-06"),
    game("anchor", "2026-09-29", [3, 2]),
    game("behind-in", "2026-09-22", [1, 0]),
    game("behind-out-played", "2026-09-21", [5, 4]),
    game("behind-out-open", "2026-09-01"),
    game("undated", undefined),
    game("blank-date", ""),
  ];

  it("keeps the games from the first day to the last, both included, in the order they came", () => {
    const { shown } = windowGames(games, window, new Set());
    expect(shown.map((entry) => entry.id)).toEqual(["ahead-in", "anchor", "behind-in"]);
  });

  it("counts what it leaves out, and which of those are undated or still need a score", () => {
    expect(windowGames(games, window, new Set())).toMatchObject({
      hidden: 5,
      undated: 2,
      needingScore: 1,
    });
  });

  it("keeps a game it is told to keep whatever its date, and stops counting it as hidden", () => {
    const result = windowGames(games, window, new Set(["behind-out-open", "undated"]));
    expect(result.shown.map((entry) => entry.id)).toEqual([
      "ahead-in",
      "anchor",
      "behind-in",
      "behind-out-open",
      "undated",
    ]);
    expect(result).toMatchObject({ hidden: 3, undated: 1, needingScore: 0 });
  });
});
