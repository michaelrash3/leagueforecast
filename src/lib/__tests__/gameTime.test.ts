import { describe, expect, it } from "vitest";
import { byGameTime, byGameTimeNewest, startMinutes, startTsOfMinutes } from "../gameTime";

/*
 * Games in the order they are played: by day, then by start time, untimed games after the day's
 * timed ones. A doubleheader's second game used to come first as often as not.
 */
const game = (id: string, date: string, startTs?: string) => ({
  id,
  date,
  ...(startTs ? { startTs } : {}),
});
const games = [
  game("late", "2026-10-24", "2026-10-24T18:30:00Z"),
  game("untimed", "2026-10-24"),
  game("early", "2026-10-24", "2026-10-24T14:00:00Z"),
  game("next day", "2026-10-25", "2026-10-25T13:00:00Z"),
  game("day before", "2026-10-23"),
];

describe("games in the order they are played", () => {
  it("earliest first: by day, then start, untimed after the day's timed games", () => {
    expect([...games].sort(byGameTime).map((g) => g.id)).toEqual([
      "day before",
      "early",
      "late",
      "untimed",
      "next day",
    ]);
  });

  it("newest first: the latest day first, the latest start first, untimed still last", () => {
    expect([...games].sort(byGameTimeNewest).map((g) => g.id)).toEqual([
      "next day",
      "late",
      "early",
      "untimed",
      "day before",
    ]);
  });

  it("carries a start as whole minutes and reads it back", () => {
    const minutes = startMinutes("2026-10-24T18:30:00Z");
    expect(minutes).toBe(Date.parse("2026-10-24T18:30:00Z") / 60_000);
    expect(startTsOfMinutes(minutes as number)).toBe("2026-10-24T18:30:00.000Z");
    expect(startMinutes(undefined)).toBeUndefined();
    expect(startMinutes("not a time")).toBeUndefined();
  });
});
