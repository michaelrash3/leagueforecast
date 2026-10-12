import { describe, expect, it } from "vitest";
import { averageRecent, buildTeamTrendSummary, trendStatusFor } from "../teamTrend";
import type { GameLog, Matchup } from "../types";

const log = (awayRuns: number, homeRuns: number, awayHits = 0, homeHits = 0): GameLog => ({
  awayRuns: String(awayRuns),
  awayHits: String(awayHits),
  awayK: "0",
  homeRuns: String(homeRuns),
  homeHits: String(homeHits),
  homeK: "0",
  innings: "6",
  isFinal: true,
});

/** A run of games for "A", scoring `runs[i]` and allowing 3 in each. */
const season = (runs: number[], opts: { away?: boolean } = {}) => {
  const matchups: Matchup[] = runs.map((_, index) => ({
    id: `g${index + 1}`,
    date: `2026-04-0${index + 1}`,
    away: opts.away ? "A" : "B",
    home: opts.away ? "B" : "A",
  }));
  const logs: Record<string, GameLog> = {};
  runs.forEach((scored, index) => {
    logs[`g${index + 1}`] = opts.away ? log(scored, 3) : log(3, scored);
  });
  return { matchups, logs };
};

describe("averageRecent", () => {
  it("averages the last n values, and says nothing about an empty run", () => {
    expect(averageRecent([1, 2, 3, 10, 20], 2)).toBe(15);
    expect(averageRecent([1, 2, 3], 10)).toBe(2);
    expect(averageRecent([], 3)).toBeNull();
  });
});

describe("trendStatusFor", () => {
  it("reads a move in the right direction as hot, whichever direction that is", () => {
    expect(trendStatusFor(1, "higher", 0.5)).toBe("Hot");
    expect(trendStatusFor(-1, "higher", 0.5)).toBe("Cold");
    // Runs allowed: down is the good way.
    expect(trendStatusFor(-1, "lower", 0.5)).toBe("Hot");
    expect(trendStatusFor(1, "lower", 0.5)).toBe("Cold");
  });

  it("holds anything inside the threshold steady, and says so when there is nothing to read", () => {
    expect(trendStatusFor(0.4, "higher", 0.5)).toBe("Steady");
    expect(trendStatusFor(-0.4, "lower", 0.5)).toBe("Steady");
    expect(trendStatusFor(null, "higher", 0.5)).toBe("No data");
  });
});

describe("buildTeamTrendSummary", () => {
  it("reads the last three games against the whole season", () => {
    const { matchups, logs } = season([1, 1, 1, 9, 9, 9]);
    const trend = buildTeamTrendSummary("A", matchups, logs, false);

    expect(trend.games).toHaveLength(6);
    expect(trend.recentWindow).toBe(3);

    const runsFor = trend.metrics.find((metric) => metric.key === "runs-for");
    expect(runsFor?.season).toBe(5);
    expect(runsFor?.recent).toBe(9);
    expect(runsFor?.status).toBe("Hot");
    expect(trend.headline).toBe("Heating up");
  });

  it("counts a team's own runs whether it batted first or last", () => {
    const atHome = season([4, 4]);
    const onTheRoad = season([4, 4], { away: true });
    const runsFor = ({ matchups, logs }: ReturnType<typeof season>) =>
      buildTeamTrendSummary("A", matchups, logs, false).metrics.find(
        (metric) => metric.key === "runs-for"
      )?.season;

    expect(runsFor(atHome)).toBe(4);
    expect(runsFor(onTheRoad)).toBe(4);
  });

  it("will not call a trend off one game", () => {
    const { matchups, logs } = season([9]);
    expect(buildTeamTrendSummary("A", matchups, logs, false).headline).toBe(
      "Need more finals for a real trend."
    );
  });

  it("leaves out games with no final score", () => {
    const { matchups, logs } = season([2, 2, 2]);
    delete logs.g3;
    const trend = buildTeamTrendSummary("A", matchups, logs, false);
    expect(trend.games).toHaveLength(2);
    expect(trend.recentWindow).toBe(2);
  });

  it("drops the hit trends in a runs-only league, where they would be flat at zero", () => {
    const { matchups, logs } = season([5, 5, 5]);
    const keys = (runsOnly: boolean) =>
      buildTeamTrendSummary("A", matchups, logs, runsOnly).metrics.map((metric) => metric.key);

    expect(keys(false)).toEqual(["runs-for", "hits-for", "runs-against", "hits-against"]);
    expect(keys(true)).toEqual(["runs-for", "runs-against"]);
  });

  it("orders by date, falling back to id so two games on one day keep a fixed order", () => {
    const matchups: Matchup[] = [
      { id: "g2", date: "2026-05-02", away: "B", home: "A" },
      { id: "g1", date: "2026-05-01", away: "B", home: "A" },
      { id: "g3", date: "2026-05-01", away: "B", home: "A" },
    ];
    const logs: Record<string, GameLog> = {
      g1: log(0, 1),
      g2: log(0, 2),
      g3: log(0, 3),
    };
    const trend = buildTeamTrendSummary("A", matchups, logs, true);
    expect(trend.games.map((game) => game.id)).toEqual(["g1", "g3", "g2"]);
  });
});
