import { describe, expect, it } from "vitest";
import { mergeHeldScores } from "../heldScores";
import type { GameLog } from "../types";

/*
 * What a tab writes as the turn moves (`mergeHeldScores`): the games it changed, over what storage
 * holds now, so a score the other tab wrote meanwhile survives it.
 */

const log = (awayRuns: string, homeRuns: string): GameLog => ({
  awayRuns,
  homeRuns,
  awayHits: "",
  homeHits: "",
  awayK: "",
  homeK: "",
  innings: "6",
  isFinal: true,
});

describe("the scores a tab writes as the turn moves", () => {
  const g1 = log("3", "2");
  const g2 = log("5", "5");
  const was = { g1, g2 };

  it("writes the games it changed over what storage holds, and leaves the rest as stored", () => {
    // The other tab scored g3, and g2 again, since this one read the season.
    const stored = { g1, g2: log("6", "5"), g3: log("1", "0") };
    const now = { g1: log("7", "2"), g2 };
    expect(mergeHeldScores(stored, was, now)).toEqual({
      g1: log("7", "2"),
      g2: log("6", "5"),
      g3: log("1", "0"),
    });
  });

  it("deletes a game it deleted, and only that one", () => {
    const stored = { g1, g2, g3: log("1", "0") };
    expect(mergeHeldScores(stored, was, { g2 })).toEqual({ g2, g3: log("1", "0") });
  });

  it("writes its own over a game both tabs changed, since it writes last", () => {
    expect(mergeHeldScores({ g1: log("0", "9"), g2 }, was, { g1: log("4", "4"), g2 })).toEqual({
      g1: log("4", "4"),
      g2,
    });
  });
});
