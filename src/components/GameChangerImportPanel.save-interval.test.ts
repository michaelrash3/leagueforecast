import { describe, expect, it } from "vitest";
import { SAVE_EVERY_MAX, SAVE_EVERY_MIN, saveEvery } from "./GameChangerImportPanel";

/*
 * Every save rewrites the whole pool, because the store keeps it as one value. A fixed interval
 * therefore makes the total written grow as the square of the run: the number of saves grows with
 * the teams while the cost of each grows with the pool. Measured at 169 bytes a row encoded, a
 * nationwide pull saving every five hundred teams wrote fourteen to twenty-six gigabytes to store a
 * few hundred megabytes.
 */
describe("how often a growing pool saves", () => {
  it("saves as often as it always did while the pool is small", () => {
    expect(saveEvery(0)).toBe(SAVE_EVERY_MIN);
    expect(saveEvery(1_000)).toBe(SAVE_EVERY_MIN);
    // The floor holds until the pool is big enough to be worth backing off for.
    expect(saveEvery(50_000)).toBe(SAVE_EVERY_MIN);
  });

  it("backs off as the pool grows, and stops at the ceiling", () => {
    expect(saveEvery(100_000)).toBe(1_000);
    expect(saveEvery(150_000)).toBe(1_500);
    expect(saveEvery(200_000)).toBe(SAVE_EVERY_MAX);
    expect(saveEvery(300_000)).toBe(SAVE_EVERY_MAX);
    expect(saveEvery(2_000_000)).toBe(SAVE_EVERY_MAX);
  });

  it("never lets a stop or a crash undo more than two thousand teams", () => {
    // The ceiling asked for: at five thousand, a stop or a crash could undo two or three minutes.
    expect(SAVE_EVERY_MAX).toBe(2_000);
  });

  it("never asks for a save less often than the ceiling, whatever it is handed", () => {
    [-1, Number.NaN, Number.POSITIVE_INFINITY, 1e12].forEach((games) => {
      const interval = saveEvery(games);
      expect(interval).toBeGreaterThanOrEqual(SAVE_EVERY_MIN);
      expect(interval).toBeLessThanOrEqual(SAVE_EVERY_MAX);
    });
  });

  /*
   * The whole point, as arithmetic. A hundred-thousand-team run into a pool of six hundred
   * thousand games: the fixed interval wrote about fourteen gigabytes, the scaled one writes a
   * quarter of that — fifty-eight saves against two hundred and thirty-three.
   */
  it("cuts what a nationwide run writes to a quarter", () => {
    const BYTES_PER_ROW = 169;
    const teams = 116_773;
    const games = 600_000;
    const written = (interval: number) =>
      (BYTES_PER_ROW * (teams + games) * Math.max(1, Math.floor(teams / interval))) / 2;
    const before = written(SAVE_EVERY_MIN);
    const after = written(saveEvery(games));
    expect(before / after).toBeGreaterThan(4);
  });
});
