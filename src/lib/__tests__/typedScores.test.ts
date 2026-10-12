import { describe, expect, it } from "vitest";
import { typedScores } from "../teamRankings";

/*
 * The two scores somebody typed for a game (`typedScores`), which both Games tabs save: whole runs,
 * or nothing at all.
 */

describe("two typed scores", () => {
  it("are whole runs, spaces around them let go", () => {
    expect(typedScores("6", "3")).toEqual({ teamAScore: 6, teamBScore: 3 });
    expect(typedScores(" 0 ", "12")).toEqual({ teamAScore: 0, teamBScore: 12 });
  });

  it("are nothing when a box is empty or holds anything but whole runs", () => {
    for (const [a, b] of [
      ["", ""],
      ["6", ""],
      ["", "3"],
      [" ", "3"],
      ["-1", "3"],
      ["1.5", "3"],
      ["1e2", "3"],
      ["six", "3"],
      ["6", "0x3"],
    ] as const)
      expect(typedScores(a, b)).toBeNull();
  });
});
