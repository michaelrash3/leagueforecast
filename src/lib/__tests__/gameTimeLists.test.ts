import { describe, expect, it } from "vitest";
import { coerceGames, encodeGames } from "../live/views/gamesShape";
import { gamesForTeam } from "../teamRankings";
import { loggedGamesOn } from "../teamRankings/gamesWindow";
import type { ScoutGame } from "../teamRankings";

/*
 * Team Rankings' lists in the order the games are played: a club's games and a page's Games list,
 * newest first, a doubleheader's later game first; and the starts carried on a page's published
 * list, so a phone reading it orders the same. Placeholder ids.
 */
const game = (id: string, date: string, startTs?: string): ScoutGame => ({
  id,
  teamAId: "A",
  teamBId: "B",
  ageGroupId: "ag_10u_2027",
  date,
  ...(startTs ? { startTs } : {}),
});
// Stored out of order, as pulls leave them: the day's second game before its first.
const stored = [
  game("first", "2026-10-24", "2026-10-24T14:00:00Z"),
  game("earlier day", "2026-10-23"),
  game("second", "2026-10-24", "2026-10-24T18:30:00Z"),
];

describe("Team Rankings' lists in playing order", () => {
  it("lists a club's games newest first, the day's later game first", () => {
    expect(gamesForTeam("A", stored).map((g) => g.id)).toEqual(["second", "first", "earlier day"]);
  });

  it("lists a page's Games newest first, the same way", () => {
    expect(loggedGamesOn(stored, "ag_10u_2027").map((g) => g.id)).toEqual([
      "second",
      "first",
      "earlier day",
    ]);
  });
});

describe("the starts on a published Games list", () => {
  const view = {
    page: "ag_10u_2027",
    games: loggedGamesOn(stored, "ag_10u_2027"),
    names: new Map([["A", "Aces"]]),
  };

  it("are carried beside the games and read back to the minute", () => {
    const read = coerceGames(JSON.parse(JSON.stringify(encodeGames(view))));
    expect(read?.games.map((g) => g.startTs)).toEqual([
      "2026-10-24T18:30:00.000Z",
      "2026-10-24T14:00:00.000Z",
      undefined,
    ]);
  });

  it("leave a list from before them readable, and each game a seven-field entry", () => {
    const wire = encodeGames(view);
    expect(wire.games.every((entry) => entry.length === 7)).toBe(true);
    const { times: _times, ...older } = wire;
    expect(coerceGames(JSON.parse(JSON.stringify(older)))?.games).toHaveLength(3);
  });
});
