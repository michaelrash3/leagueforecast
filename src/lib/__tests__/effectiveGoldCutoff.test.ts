import { describe, expect, it } from "vitest";
import { effectiveGoldCutoff } from "../sim";
import type { PostseasonFormat } from "../types";

/*
 * Pinned before the expression left App.tsx: each expected number is what App's own `goldCutoff`
 * gave for these settings and team counts at 62493aa, worked out by running that expression as it
 * stood. The helper is the same expression moved, so every row has to match to the digit.
 */
describe("effectiveGoldCutoff", () => {
  it.each<[PostseasonFormat, number, number, number]>([
    // A cut line takes its setting, rounded, and never more teams than the season has.
    ["cut", 4, 12, 4],
    ["cut", 7, 12, 7],
    ["cut", 12, 12, 12],
    ["cut", 20, 12, 12],
    ["cut", 3.4, 12, 3],
    ["cut", 3.5, 12, 4],
    // No setting (0 or not a number) falls back to the default of 7, held to the season's size.
    ["cut", 0, 12, 7],
    ["cut", 0, 5, 5],
    ["cut", Number.NaN, 12, 7],
    ["cut", -2, 12, 1],
    // A season with no teams yet is held to the default rather than to nothing.
    ["cut", 4, 0, 4],
    ["cut", 9, 0, 7],
    ["cut", 4, 1, 1],
    // Every team qualifies with no cut, at least one; nobody does with no postseason.
    ["all", 4, 12, 12],
    ["all", 4, 0, 1],
    ["all", 4, 1, 1],
    ["none", 4, 12, 0],
    ["none", 4, 0, 0],
  ])("%s with a cutoff of %s and %s teams qualifies %s", (format, cutoff, teams, expected) => {
    expect(effectiveGoldCutoff({ postseasonFormat: format, goldCutoff: cutoff }, teams)).toBe(
      expected
    );
  });
});
