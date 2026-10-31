import { describe, expect, it } from "vitest";
import { seasonDaysFromToday } from "../leagueFindings";
import { inPlayingOrder } from "../stillToCome";

/*
 * The order a team's games still to play come in (`stillToCome.ts`), for Our team's next game and
 * the team panel's next two. A game rained out keeps its old date until it is given a new one,
 * and it was read as the next game, days after it was not played.
 */
const game = (id: string, date: string) => ({ id, date });

describe("a team's games still to play", () => {
  const today = new Date(2026, 9, 26);
  const games = [
    game("rained-out", "10/20"),
    game("undated", ""),
    game("next-week", "11/2"),
    game("today", "10/26"),
    game("earlier-rainout", "10/13"),
  ];
  const season = ["9/6", "9/13", ...games.map((one) => one.date)];

  it("come by date from today on, then the ones whose date has passed, then the undated", () => {
    const order = inPlayingOrder(games, seasonDaysFromToday(season, today));
    expect(order.map((one) => one.id)).toEqual([
      "today",
      "next-week",
      "earlier-rainout",
      "rained-out",
      "undated",
    ]);
  });

  it("are all past-dated at the season's end, and come in their own order", () => {
    const late = [game("b", "10/20"), game("a", "10/13")];
    const order = inPlayingOrder(late, seasonDaysFromToday(season, today));
    expect(order.map((one) => one.id)).toEqual(["a", "b"]);
  });

  /*
   * A doubleheader stored late game first, as a pasted schedule can be: the next game was the late
   * one, though the README has each team's next game go by day and then start.
   */
  it("come by start within a day, a game with none after the day's timed ones", () => {
    const day = [
      { ...game("late", "10/26"), startTs: "2026-10-26T23:00:00.000Z" },
      game("untimed", "10/26"),
      { ...game("early", "10/26"), startTs: "2026-10-26T17:00:00.000Z" },
      game("next-week", "11/2"),
    ];
    const order = inPlayingOrder(day, seasonDaysFromToday(season, today));
    expect(order.map((one) => one.id)).toEqual(["early", "late", "untimed", "next-week"]);
    // Games with no start keep the order they came in, as before.
    const plain = [game("b", "10/26"), game("a", "10/26")];
    expect(inPlayingOrder(plain, seasonDaysFromToday(season, today)).map((one) => one.id)).toEqual([
      "b",
      "a",
    ]);
  });
});
