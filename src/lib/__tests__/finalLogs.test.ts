import { describe, expect, it } from "vitest";
import { finalLogsOf } from "../finalLogs";
import type { GameLog } from "../types";

const log = (awayRuns: string, homeRuns: string, isFinal: boolean): GameLog => ({
  awayRuns,
  homeRuns,
  awayHits: "",
  homeHits: "",
  awayK: "",
  homeK: "",
  innings: "6",
  isFinal,
});

const done = log("5", "3", true);
const playing = log("2", "", false);

describe("the final games' scores", () => {
  it("are the final games alone", () => {
    expect(finalLogsOf({ g1: done, g2: playing })).toEqual({ g1: done });
  });

  it("stay the same object while only a game still being played changes", () => {
    const first = finalLogsOf({ g1: done, g2: playing });
    const typed = finalLogsOf({ g1: done, g2: log("2", "4", false) }, first);
    expect(typed).toBe(first);
    // Cleared, too: a game with no score at all is still not final.
    expect(finalLogsOf({ g1: done }, first)).toBe(first);
  });

  it("are new once a game is marked final, unmarked, or corrected", () => {
    const first = finalLogsOf({ g1: done, g2: playing });
    const marked = finalLogsOf({ g1: done, g2: log("2", "4", true) }, first);
    expect(marked).not.toBe(first);
    expect(Object.keys(marked)).toEqual(["g1", "g2"]);
    const unmarked = finalLogsOf({ g1: log("5", "3", false), g2: playing }, first);
    expect(unmarked).toEqual({});
    const corrected = finalLogsOf({ g1: log("6", "3", true), g2: playing }, first);
    expect(corrected).not.toBe(first);
    expect(corrected.g1?.awayRuns).toBe("6");
  });

  it("are new when one final game takes another's place, the count unchanged", () => {
    const first = finalLogsOf({ g1: done, g2: playing });
    expect(finalLogsOf({ g1: playing, g2: done }, first)).toEqual({ g2: done });
  });

  it("hold a game whose id is a name every object answers to", () => {
    const first = finalLogsOf({ constructor: playing });
    expect(first).toEqual({});
    expect(finalLogsOf({ constructor: done }, first)).toEqual({ constructor: done });
    expect(Object.getPrototypeOf(finalLogsOf({ ["__proto__"]: done }))).toBe(Object.prototype);
  });
});
