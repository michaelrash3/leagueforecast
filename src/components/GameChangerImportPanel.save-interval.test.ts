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
  it("never saves sooner than every two thousand teams", () => {
    // Asked for: a save costs the whole pool however few teams came with it.
    expect(SAVE_EVERY_MIN).toBe(2_000);
    expect(saveEvery(0)).toBe(SAVE_EVERY_MIN);
    expect(saveEvery(1_000)).toBe(SAVE_EVERY_MIN);
    // The floor holds until the pool is big enough to be worth backing off for.
    expect(saveEvery(50_000)).toBe(SAVE_EVERY_MIN);
    expect(saveEvery(200_000)).toBe(SAVE_EVERY_MIN);
  });

  it("backs off as the pool grows, and stops at the ceiling", () => {
    expect(saveEvery(300_000)).toBe(3_000);
    expect(saveEvery(500_000)).toBe(SAVE_EVERY_MAX);
    expect(saveEvery(2_000_000)).toBe(SAVE_EVERY_MAX);
    expect(SAVE_EVERY_MAX).toBe(5_000);
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
   * thousand games: the fixed interval every pull used to save at wrote about fourteen gigabytes,
   * the scaled one writes a tenth of that — twenty-three saves against two hundred and thirty-three.
   */
  it("cuts what a nationwide run writes by an order of magnitude", () => {
    const BYTES_PER_ROW = 169;
    const FIXED_INTERVAL = 500;
    const teams = 116_773;
    const games = 600_000;
    const written = (interval: number) =>
      (BYTES_PER_ROW * (teams + games) * Math.max(1, Math.floor(teams / interval))) / 2;
    const before = written(FIXED_INTERVAL);
    const after = written(saveEvery(games));
    expect(before / after).toBeGreaterThan(8);
  });
});
