import { describe, expect, it } from "vitest";
import { calculateTeams, getRemainingCounts, rankTeams, standingsPoints } from "../sim";
import type { GameLog, Matchup, TeamBase } from "../types";
import { DEFAULT_SETTINGS } from "../types";
import { blankLog } from "../util";

const teams: TeamBase[] = [
  { id: "a", name: "A" },
  { id: "b", name: "B" },
];

const log = (awayRuns: string, homeRuns: string, isFinal = true): GameLog => ({
  ...blankLog(),
  awayRuns,
  homeRuns,
  awayHits: "5",
  homeHits: "4",
  awayK: "2",
  homeK: "3",
  innings: "6",
  isFinal,
});

describe("critical flows integration", () => {
  it("calculates standings from finalized logs and leaves no remaining games", () => {
    const matchups: Matchup[] = [{ id: "g1", away: "a", home: "b", date: "5/1" }];
    const logs: Record<string, GameLog> = { g1: log("3", "1") };

    const calculated = calculateTeams(teams, matchups, logs);
    const ranked = rankTeams(calculated, { runDiffTiebreaker: DEFAULT_SETTINGS.runDiffTiebreaker });
    const remainingCounts = getRemainingCounts(calculated, matchups.filter((m) => !logs[m.id]?.isFinal));

    expect(ranked[0]?.id).toBe("a");
    expect(standingsPoints(ranked[0]!, DEFAULT_SETTINGS)).toBeGreaterThan(standingsPoints(ranked[1]!, DEFAULT_SETTINGS));
    expect(remainingCounts["a"]).toBe(0);
    expect(remainingCounts["b"]).toBe(0);
  });

  it("applies tie game points and keeps ranking level when only tie played", () => {
    const matchups: Matchup[] = [{ id: "g1", away: "a", home: "b", date: "5/1" }];
    const logs: Record<string, GameLog> = { g1: log("2", "2") };

    const calculated = calculateTeams(teams, matchups, logs);
    const ranked = rankTeams(calculated, { runDiffTiebreaker: true });

    expect(standingsPoints(calculated[0]!, DEFAULT_SETTINGS)).toBe(DEFAULT_SETTINGS.tiePoints);
    expect(standingsPoints(calculated[1]!, DEFAULT_SETTINGS)).toBe(DEFAULT_SETTINGS.tiePoints);
    expect(ranked.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("changes winner when run-diff tiebreaker toggles", () => {
    const matchups: Matchup[] = [
      { id: "g1", away: "a", home: "b", date: "5/1" },
      { id: "g2", away: "b", home: "a", date: "5/2" },
    ];
    const logs: Record<string, GameLog> = {
      g1: { ...log("4", "2"), awayHits: "3", homeHits: "8", awayK: "5", homeK: "1" },
      g2: { ...log("2", "1"), awayHits: "9", homeHits: "2", awayK: "1", homeK: "6" },
    };

    const calculated = calculateTeams(teams, matchups, logs);
    const withDiff = rankTeams(calculated, { runDiffTiebreaker: true });
    const withoutDiff = rankTeams(calculated, { runDiffTiebreaker: false });

    expect(withDiff[0]?.id).toBe("a");
    expect(withoutDiff[0]?.id).toBe("b");
  });

  it("recalculates remaining counts with mixed finalized and unfinalized logs", () => {
    const matchups: Matchup[] = [
      { id: "g1", away: "a", home: "b", date: "5/1" },
      { id: "g2", away: "a", home: "b", date: "5/3" },
      { id: "g3", away: "b", home: "a", date: "5/5" },
    ];
    const logs: Record<string, GameLog> = {
      g1: log("3", "1", true),
      g2: log("", "", false),
      g3: log("", "", false),
    };

    const calculated = calculateTeams(teams, matchups, logs);
    const remaining = matchups.filter((m) => !logs[m.id]?.isFinal);
    const remainingCounts = getRemainingCounts(calculated, remaining);

    expect(remaining.length).toBe(2);
    expect(remainingCounts["a"]).toBe(2);
    expect(remainingCounts["b"]).toBe(2);
  });
  it("keeps unfinalized games out of standings until finalized", () => {
    const matchups: Matchup[] = [{ id: "g1", away: "a", home: "b", date: "5/1" }];

    const pendingLogs: Record<string, GameLog> = { g1: log("5", "1", false) };
    const pendingTeams = calculateTeams(teams, matchups, pendingLogs);

    expect(pendingTeams.find((t) => t.id === "a")?.w).toBe(0);
    expect(pendingTeams.find((t) => t.id === "b")?.l).toBe(0);

    const finalLogs: Record<string, GameLog> = { g1: log("5", "1", true) };
    const finalTeams = calculateTeams(teams, matchups, finalLogs);
    const ranked = rankTeams(finalTeams, { runDiffTiebreaker: DEFAULT_SETTINGS.runDiffTiebreaker });

    expect(finalTeams.find((t) => t.id === "a")?.w).toBe(1);
    expect(finalTeams.find((t) => t.id === "b")?.l).toBe(1);
    expect(ranked[0]?.id).toBe("a");
  });

});
