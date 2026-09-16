import { describe, expect, it } from "vitest";
import {
  buildLeagueAverageStats,
  buildTeamSplitSummary,
  buildTeamStatRankings,
  calcBip,
  perGame,
} from "../teamStats";
import type { GameLog, Matchup, TeamBase } from "../types";

const teams: TeamBase[] = [
  { id: "A", name: "Aces" },
  { id: "B", name: "Bats" },
  { id: "C", name: "Cubs" },
];

const games: Matchup[] = [
  { id: "g1", date: "2026-04-01", away: "A", home: "B" },
  { id: "g2", date: "2026-04-08", away: "B", home: "A" },
  // Scheduled but not played: every total below has to ignore it.
  { id: "g3", date: "2026-04-15", away: "C", home: "A" },
];

const log = (over: Partial<GameLog>): GameLog => ({
  awayRuns: "0",
  awayHits: "0",
  awayK: "0",
  homeRuns: "0",
  homeHits: "0",
  homeK: "0",
  innings: "6",
  isFinal: true,
  ...over,
});

const logs: Record<string, GameLog> = {
  g1: log({
    awayRuns: "7",
    awayHits: "9",
    awayK: "4",
    homeRuns: "3",
    homeHits: "5",
    homeK: "8",
    awayErrors: "1",
    homeErrors: "2",
    awayWalksAllowed: "3",
    homeWalksAllowed: "1",
  }),
  g2: log({
    awayRuns: "2",
    awayHits: "4",
    awayK: "6",
    homeRuns: "5",
    homeHits: "8",
    homeK: "2",
    awayErrors: "0",
    homeErrors: "1",
    awayWalksAllowed: "2",
    homeWalksAllowed: "4",
  }),
};

describe("buildTeamSplitSummary", () => {
  it("splits a team's own numbers from its opponents', home from away", () => {
    const summary = buildTeamSplitSummary("A", games, logs);

    expect(summary.all.games).toBe(2);
    expect(summary.away.games).toBe(1);
    expect(summary.home.games).toBe(1);

    // A scored 7 away and 5 at home; it allowed 3 and 2.
    expect(summary.all.offense.runs).toBe(12);
    expect(summary.all.defense.runs).toBe(5);
    expect(summary.away.offense.runs).toBe(7);
    expect(summary.home.offense.runs).toBe(5);
  });

  it("leaves out a game that has no final score", () => {
    // g3 is on A's schedule with no log at all.
    expect(buildTeamSplitSummary("A", games, logs).all.games).toBe(2);
    expect(buildTeamSplitSummary("C", games, logs).all.games).toBe(0);
  });
});

describe("buildLeagueAverageStats", () => {
  it("counts each finished game once and each team-game twice", () => {
    const totals = buildLeagueAverageStats(games, logs);
    expect(totals.completedGames).toBe(2);
    expect(totals.teamGames).toBe(4);
    expect(totals.runs).toBe(7 + 3 + 2 + 5);
    expect(totals.hits).toBe(9 + 5 + 4 + 8);
  });
});

describe("buildTeamStatRankings", () => {
  it("ranks runs scored down and runs allowed up", () => {
    const rankings = buildTeamStatRankings(teams, games, logs, "player", true, false);
    const runsScored = rankings.metrics.find((m) => m.key === "runs-scored");

    expect(rankings.sampleGames).toBe(2);
    expect(runsScored?.entries.slice(0, 2).map((e) => e.teamId)).toEqual(["A", "B"]);
    // A: 12 runs in 2 games. B: 5 in 2.
    expect(runsScored?.entries[0]?.value).toBe(6);
  });

  it("sends a team with no games to the bottom of every leaderboard, ranked but blank", () => {
    const rankings = buildTeamStatRankings(teams, games, logs, "player", true, false);
    rankings.metrics.forEach((metric) => {
      const last = metric.entries[metric.entries.length - 1];
      expect(last?.teamId).toBe("C");
      expect(last?.value).toBeNull();
      expect(last?.rank).toBe(3);
    });
  });

  it("offers only runs for and against in a runs-only league", () => {
    // Nothing else is recorded there, so a hits or strikeouts board would be every team tied on 0.
    const rankings = buildTeamStatRankings(teams, games, logs, "player", true, true);
    expect(rankings.metrics.map((m) => m.key)).toEqual(["runs-scored", "runs-allowed"]);
  });

  it("swaps walks for strikeouts when the league pitches by machine", () => {
    const player = buildTeamStatRankings(teams, games, logs, "player", true, false);
    const machine = buildTeamStatRankings(teams, games, logs, "machine", true, false);

    expect(player.metrics.map((m) => m.key)).toContain("walks-drawn");
    expect(machine.metrics.map((m) => m.key)).not.toContain("walks-drawn");
    expect(machine.metrics.map((m) => m.key)).toContain("opponent-strikeouts");
  });

  it("drops the errors board when the league does not track them", () => {
    const tracked = buildTeamStatRankings(teams, games, logs, "player", true, false);
    const untracked = buildTeamStatRankings(teams, games, logs, "player", false, false);

    expect(tracked.metrics.map((m) => m.key)).toContain("errors");
    expect(untracked.metrics.map((m) => m.key)).not.toContain("errors");
  });

  it("averages over team-games rather than over teams, so a short season does not distort it", () => {
    const rankings = buildTeamStatRankings(teams, games, logs, "player", true, false);
    const runsScored = rankings.metrics.find((m) => m.key === "runs-scored");
    // 17 runs over 4 team-games. Averaging the two teams' per-game rates would give the same
    // answer only because they played the same number of games; C, with none, is left out either
    // way rather than counted as a zero.
    expect(runsScored?.average).toBeCloseTo(17 / 4);
  });
});

describe("perGame", () => {
  it("shows a dash rather than dividing by no games", () => {
    expect(perGame(12, 2)).toBe("6.0");
    expect(perGame(0, 0)).toBe("—");
  });
});

describe("calcBip", () => {
  it("falls back to runs when hits were never entered", () => {
    expect(calcBip("9", "7", "4", "6")).toBe(9 + 18 - 4);
    expect(calcBip("", "7", "4", "6")).toBe(7 + 18 - 4);
    expect(calcBip("", "", "4", "6")).toBe(0 + 18 - 4);
  });

  it("assumes six innings when the innings box is blank", () => {
    expect(calcBip("9", "7", "0", "")).toBe(calcBip("9", "7", "0", "6"));
  });
});
