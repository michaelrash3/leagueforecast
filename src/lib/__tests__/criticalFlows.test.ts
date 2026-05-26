import { describe, expect, it } from "vitest";
import { calculateTeams, getRemainingCounts, rankTeams, standingsPoints } from "../sim";
import type { GameLog, Matchup, TeamBase } from "../types";
import { DEFAULT_SETTINGS } from "../types";
import { blankLog } from "../util";

describe("critical flows integration", () => {
  it("calculates standings from finalized logs and leaves no remaining games", () => {
    const teams: TeamBase[] = [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ];
    const matchups: Matchup[] = [{ id: "g1", away: "a", home: "b", date: "5/1" }];
    const logs: Record<string, GameLog> = {
      g1: { ...blankLog(), awayRuns: "3", homeRuns: "1", awayHits: "5", homeHits: "4", awayK: "2", homeK: "3", innings: "6", isFinal: true },
    };

    const calculated = calculateTeams(teams, matchups, logs);
    const ranked = rankTeams(calculated, { runDiffTiebreaker: DEFAULT_SETTINGS.runDiffTiebreaker });
    const remaining = matchups.filter((m) => !logs[m.id]?.isFinal);
    const remainingCounts = getRemainingCounts(calculated, remaining);

    expect(ranked[0]?.id).toBe("a");
    expect(standingsPoints(ranked[0]!, DEFAULT_SETTINGS)).toBeGreaterThan(standingsPoints(ranked[1]!, DEFAULT_SETTINGS));
    expect(remainingCounts["a"]).toBe(0);
    expect(remainingCounts["b"]).toBe(0);
  });
});
