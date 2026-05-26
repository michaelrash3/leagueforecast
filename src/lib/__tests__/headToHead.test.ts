import { describe, expect, it } from "vitest";
import { h2hCellFor } from "../headToHead";
import type { GameLog, Matchup } from "../types";
import { blankLog } from "../util";

const matchup = (id: string, away: string, home: string): Matchup => ({ id, away, home, date: "5/1" });
const finalLog = (awayRuns: string, homeRuns: string): GameLog => ({ ...blankLog(), awayRuns, homeRuns, isFinal: true });

describe("h2hCellFor", () => {
  it("returns self/none correctly", () => {
    expect(h2hCellFor("a", "a", [], {})).toBe("self");
    expect(h2hCellFor("a", "b", [matchup("g1", "a", "c")], {})).toBe("none");
  });

  it("aggregates wins/losses/ties across finalized meetings", () => {
    const matchups = [matchup("g1", "a", "b"), matchup("g2", "b", "a"), matchup("g3", "a", "b")];
    const logs: Record<string, GameLog> = {
      g1: finalLog("5", "2"),
      g2: finalLog("1", "4"),
      g3: finalLog("3", "3"),
    };

    expect(h2hCellFor("a", "b", matchups, logs)).toBe("win");
    expect(h2hCellFor("b", "a", matchups, logs)).toBe("loss");
  });

  it("returns tie when series is even", () => {
    const matchups = [matchup("g1", "a", "b"), matchup("g2", "b", "a")];
    const logs: Record<string, GameLog> = {
      g1: finalLog("4", "2"),
      g2: finalLog("7", "6"),
    };
    expect(h2hCellFor("a", "b", matchups, logs)).toBe("tie");
  });
});
