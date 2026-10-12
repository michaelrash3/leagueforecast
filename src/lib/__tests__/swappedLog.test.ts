import { describe, expect, it } from "vitest";
import type { GameLog } from "../types";
import { swappedLog } from "../util";

/*
 * Swapping a game's home and away sides turns the game round, and every number on the card belongs
 * to a side. The swap used to move runs, hits and strikeouts and leave errors and walks where they
 * were, so a kid-pitch game swapped the right way round credited each team with the other's errors
 * and walks — in the box score, the season totals and the compare drawer.
 */
describe("a game's log with its sides swapped", () => {
  const log: GameLog = {
    awayRuns: "7",
    awayHits: "9",
    awayK: "4",
    homeRuns: "3",
    homeHits: "5",
    homeK: "8",
    awayErrors: "1",
    homeErrors: "4",
    awayWalksAllowed: "2",
    homeWalksAllowed: "6",
    innings: "6",
    isFinal: true,
  };

  it("moves every per-side number with its side", () => {
    expect(swappedLog(log)).toEqual({
      awayRuns: "3",
      awayHits: "5",
      awayK: "8",
      homeRuns: "7",
      homeHits: "9",
      homeK: "4",
      awayErrors: "4",
      homeErrors: "1",
      awayWalksAllowed: "6",
      homeWalksAllowed: "2",
      innings: "6",
      isFinal: true,
    });
  });

  it("is its own undo", () => {
    expect(swappedLog(swappedLog(log))).toEqual(log);
  });

  it("does not invent a stat a runs-only log never had", () => {
    const { awayErrors: _a, homeErrors: _h, ...runsOnly } = log;
    const swapped = swappedLog({ ...runsOnly, homeErrors: "2" });
    expect(swapped.awayErrors).toBe("2");
    expect("homeErrors" in swapped).toBe(false);
  });
});
