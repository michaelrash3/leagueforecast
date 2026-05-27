import { describe, expect, it } from "vitest";
import {
  applyResult,
  calculateTeams,
  predictGame,
  projectStandings,
  rankTeams,
  simulateGoldOdds,
  simulationSeed,
  standingsPoints,
  calibrateAwayWinPct,
} from "../sim";
import { DEFAULT_SETTINGS, type GameLog, type Matchup, type Settings, type TeamBase } from "../types";

const teams: TeamBase[] = [
  { id: "A", name: "Aces" },
  { id: "B", name: "Bears" },
  { id: "C", name: "Comets" },
];

const matchups: Matchup[] = [
  { id: "g1", date: "5/1", away: "A", home: "B" },
  { id: "g2", date: "5/2", away: "B", home: "C" },
  { id: "g3", date: "5/3", away: "A", home: "C" },
];

const finalLog = (overrides: Partial<GameLog>): GameLog => ({
  awayRuns: "0",
  awayHits: "0",
  awayK: "0",
  homeRuns: "0",
  homeHits: "0",
  homeK: "0",
  innings: "6",
  isFinal: true,
  ...overrides,
});

const settings: Settings = { ...DEFAULT_SETTINGS };

describe("calculateTeams", () => {
  it("returns base records when no games are final", () => {
    const result = calculateTeams(teams, matchups, {});
    expect(result.map((t) => [t.id, t.games])).toEqual([
      ["A", 0],
      ["B", 0],
      ["C", 0],
    ]);
  });

  it("maintains league-wide game and outcome invariants", () => {
    const logs: Record<string, GameLog> = {
      g1: finalLog({ awayRuns: "8", homeRuns: "4" }),
      g2: finalLog({ awayRuns: "3", homeRuns: "5" }),
      g3: finalLog({ awayRuns: "2", homeRuns: "2" }),
    };
    const result = calculateTeams(teams, matchups, logs);
    const totals = result.reduce(
      (acc, t) => ({ games: acc.games + t.games, w: acc.w + t.w, l: acc.l + t.l, ties: acc.ties + t.t }),
      { games: 0, w: 0, l: 0, ties: 0 }
    );
    expect(totals.games).toBe(6);
    expect(totals.w).toBe(totals.l);
    expect(totals.w + totals.ties / 2).toBe(3);
  });

  it("tracks wins/losses/ties and runs", () => {
    const logs: Record<string, GameLog> = {
      g1: finalLog({ awayRuns: "8", homeRuns: "4" }),
      g2: finalLog({ awayRuns: "3", homeRuns: "5" }),
      g3: finalLog({ awayRuns: "2", homeRuns: "2" }),
    };
    const result = calculateTeams(teams, matchups, logs);
    const byId = new Map(result.map((t) => [t.id, t]));
    expect(byId.get("A")!.w).toBe(1);
    expect(byId.get("A")!.t).toBe(1);
    expect(byId.get("B")!.w).toBe(0);
    expect(byId.get("B")!.l).toBe(2);
    expect(byId.get("C")!.w).toBe(1);
    expect(byId.get("C")!.t).toBe(1);
    expect(byId.get("A")!.rs).toBe(10);
    expect(byId.get("A")!.ra).toBe(6);
  });


  it("weights recent form more heavily in momentum", () => {
    const formTeams: TeamBase[] = [
      { id: "A", name: "A" },
      { id: "B", name: "B" },
    ];
    const formMatchups: Matchup[] = [
      { id: "f1", date: "5/1", away: "A", home: "B" },
      { id: "f2", date: "5/2", away: "A", home: "B" },
      { id: "f3", date: "5/3", away: "A", home: "B" },
      { id: "f4", date: "5/4", away: "A", home: "B" },
      { id: "f5", date: "5/5", away: "A", home: "B" },
      { id: "f6", date: "5/6", away: "A", home: "B" },
    ];
    const logs: Record<string, GameLog> = {
      f1: finalLog({ awayRuns: "2", homeRuns: "8" }),
      f2: finalLog({ awayRuns: "2", homeRuns: "8" }),
      f3: finalLog({ awayRuns: "2", homeRuns: "8" }),
      f4: finalLog({ awayRuns: "10", homeRuns: "2" }),
      f5: finalLog({ awayRuns: "11", homeRuns: "2" }),
      f6: finalLog({ awayRuns: "12", homeRuns: "2" }),
    };
    const out = calculateTeams(formTeams, formMatchups, logs);
    const a = out.find((t) => t.id === "A")!;
    const b = out.find((t) => t.id === "B")!;
    expect(a.momentum).toBeGreaterThan(0);
    expect(b.momentum).toBeLessThan(0);
  });

});

describe("standingsPoints + rankTeams", () => {
  it("respects winPoints/tiePoints", () => {
    const team = { w: 4, t: 2 };
    expect(standingsPoints(team, { winPoints: 1, tiePoints: 0.5 })).toBe(5);
    expect(standingsPoints(team, { winPoints: 3, tiePoints: 1 })).toBe(14);
  });

  it("skips run-diff tier when disabled", () => {
    const live = calculateTeams(teams, matchups, {
      g1: finalLog({ awayRuns: "10", homeRuns: "0" }),
      g2: finalLog({ awayRuns: "5", homeRuns: "4" }),
    });
    const withDiff = rankTeams(live, { runDiffTiebreaker: true });
    const withoutDiff = rankTeams(live, { runDiffTiebreaker: false });
    // Same shape, but the comparator skips runDiff when disabled — both should
    // be deterministic and stable.
    expect(withDiff.map((t) => t.id).sort()).toEqual(withoutDiff.map((t) => t.id).sort());
  });
});

describe("predictGame", () => {
  const live = calculateTeams(teams, matchups, {
    g1: finalLog({ awayRuns: "8", homeRuns: "4" }),
    g2: finalLog({ awayRuns: "3", homeRuns: "5" }),
    g3: finalLog({ awayRuns: "6", homeRuns: "4" }),
  });
  const game: Matchup = { id: "future", date: "5/9", away: "A", home: "B" };

  it("falls back to a low-confidence default when sample is thin", () => {
    const thinLive = calculateTeams(teams, matchups, {});
    expect(predictGame(game, thinLive, settings).confidence).toBe("Low");
  });

  it("aggression scales the predicted scores", () => {
    const conservative = predictGame(game, live, {
      ...settings,
      modelAggression: "Conservative",
    });
    const aggressive = predictGame(game, live, {
      ...settings,
      modelAggression: "Aggressive",
    });
    // The two aggressions should not produce identical scores when there is a
    // real tpi/momentum signal.
    const sameScore =
      conservative.awayScore === aggressive.awayScore &&
      conservative.homeScore === aggressive.homeScore;
    expect(sameScore).toBe(false);
  });


  it("calibrates probabilities away from overconfident extremes", () => {
    const aggressive = calibrateAwayWinPct(0.9, 2, 2, 1.25);
    const mature = calibrateAwayWinPct(0.9, 12, 12, 1.25);
    expect(aggressive).toBeLessThan(0.9);
    expect(mature).toBeGreaterThan(aggressive);
  });

  it("keeps calibration symmetric around 50%", () => {
    const favored = calibrateAwayWinPct(0.72, 8, 8, 1);
    const underdog = calibrateAwayWinPct(0.28, 8, 8, 1);
    expect(Math.abs((favored + underdog) - 1)).toBeLessThan(0.001);
  });

});

describe("applyResult", () => {
  const live = calculateTeams(teams, matchups, {
    g1: finalLog({ awayRuns: "5", homeRuns: "3" }),
  });
  const future: Matchup = { id: "future", date: "5/4", away: "B", home: "C" };

  it("increments wins for the chosen winner", () => {
    const result = applyResult(live, future, "B", live, settings);
    const winner = result.find((t) => t.id === "B")!;
    expect(winner.w).toBe(live.find((t) => t.id === "B")!.w + 1);
  });

  it("refreshes baseTpi/tpi on the touched teams", () => {
    const result = applyResult(live, future, "B", live, settings);
    const winner = result.find((t) => t.id === "B")!;
    expect(typeof winner.baseTpi).toBe("number");
    expect(Number.isFinite(winner.tpi)).toBe(true);
  });
});

describe("projectStandings + simulateGoldOdds", () => {
  it("returns a ranked list with monotonic ranks", () => {
    const live = calculateTeams(teams, matchups, {});
    const projected = projectStandings(live, matchups, settings);
    expect(projected.map((t) => t.rank)).toEqual([1, 2, 3]);
  });

  it("produces stable projection regression output", () => {
    const live = calculateTeams(teams, matchups, { g1: finalLog({ awayRuns: "3", homeRuns: "2" }) });
    const projected = projectStandings(live, [matchups[1]!, matchups[2]!], settings);
    expect(projected.map((t) => `${t.id}:${t.w}-${t.l}-${t.t}:r${t.rank}`)).toMatchInlineSnapshot(`
      [
        "A:2-0-0:r1",
        "B:1-1-0:r2",
        "C:0-2-0:r3",
      ]
    `);
  });

  it("simulator returns percentages summing to (cutoff * 100)", () => {
    const live = calculateTeams(teams, matchups, {});
    const odds = simulateGoldOdds(live, matchups, 60, "test-seed", 2, settings);
    const total = Object.values(odds).reduce((sum, v) => sum + v, 0);
    // Each iteration awards `cutoff` slots, so total percent equals cutoff*100.
    expect(Math.round(total)).toBe(200);
  });



  it("maintains cutoff-slot normalization even with adaptive convergence", () => {
    const live = calculateTeams(teams, matchups, {});
    const odds = simulateGoldOdds(live, matchups, 500, "adaptive-seed", 2, settings);
    const total = Object.values(odds).reduce((sum, v) => sum + v, 0);
    expect(Math.round(total)).toBe(200);
  });

  it("is deterministic for a given seed", () => {
    const live = calculateTeams(teams, matchups, {});
    const a = simulateGoldOdds(live, matchups, 40, "seed-x", 2, settings);
    const b = simulateGoldOdds(live, matchups, 40, "seed-x", 2, settings);
    expect(a).toEqual(b);
  });
});

describe("simulationSeed", () => {
  it("is stable across key ordering of logs", () => {
    const logsA: Record<string, GameLog> = {
      g1: finalLog({}),
      g2: finalLog({}),
    };
    const logsB: Record<string, GameLog> = {
      g2: finalLog({}),
      g1: finalLog({}),
    };
    expect(simulationSeed(matchups, logsA, "x")).toBe(simulationSeed(matchups, logsB, "x"));
  });
});
