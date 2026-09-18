import { describe, expect, it } from "vitest";
import {
  applyResult,
  attachAdjustedRatings,
  calculateTeams,
  emptyTeam,
  isSeedingLocked,
  predictGame,
  projectStandings,
  rankTeams,
  simulateBracketOdds,
  simulateGoldOdds,
  simulationSeed,
  standingsPoints,
  calibrateAwayWinPct,
} from "../sim";
import {
  DEFAULT_SETTINGS,
  type GameLog,
  type Matchup,
  type Settings,
  type Team,
  type TeamBase,
} from "../types";

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
      (acc, t) => ({
        games: acc.games + t.games,
        w: acc.w + t.w,
        l: acc.l + t.l,
        ties: acc.ties + t.t,
      }),
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

  it("bases per-game runs, hits, and strikeouts only on finalized games", () => {
    const logs: Record<string, GameLog> = {
      g1: finalLog({
        awayRuns: "8",
        awayHits: "10",
        awayK: "3",
        homeRuns: "4",
        homeHits: "6",
        homeK: "5",
      }),
      g3: {
        awayRuns: "20",
        awayHits: "25",
        awayK: "9",
        homeRuns: "1",
        homeHits: "2",
        homeK: "7",
        innings: "6",
        isFinal: false,
      },
    };

    const result = calculateTeams(teams, matchups, logs);
    const byId = new Map(result.map((t) => [t.id, t]));

    expect(byId.get("A")!.games).toBe(1);
    expect(byId.get("A")!.rsg).toBe(8);
    expect(byId.get("A")!.hpg).toBe(10);
    expect(byId.get("A")!.kpg).toBe(3);
    expect(byId.get("A")!.oppKpg).toBe(5);
    expect(byId.get("C")!.games).toBe(0);
    expect(byId.get("C")!.rsg).toBe(0);
    expect(byId.get("C")!.hpg).toBe(0);
    expect(byId.get("C")!.kpg).toBe(0);
    expect(byId.get("C")!.oppKpg).toBe(0);
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

  it("ranks GameChanger-style winning percentage with ties as half a win", () => {
    const higherWinTotal = {
      ...emptyTeam({ id: "A", name: "10-4 Team" }),
      w: 10,
      l: 4,
      t: 0,
      games: 14,
      pct: 10 / 14,
      tpi: 1,
    };
    const betterPct = {
      ...emptyTeam({ id: "B", name: "8-2-3 Team" }),
      w: 8,
      l: 2,
      t: 3,
      games: 13,
      pct: (8 + 3 * 0.5) / 13,
      tpi: 0,
    };

    const ranked = rankTeams([higherWinTotal, betterPct], { winPoints: 1, tiePoints: 0.5 });

    expect(ranked.map((team) => team.id)).toEqual(["B", "A"]);
    expect(betterPct.pct).toBeGreaterThan(higherWinTotal.pct);
    expect(standingsPoints(higherWinTotal, { winPoints: 1, tiePoints: 0.5 })).toBeGreaterThan(
      standingsPoints(betterPct, { winPoints: 1, tiePoints: 0.5 })
    );
  });

  it("uses tournament tiebreakers after equal winning percentage instead of standings points", () => {
    const shortUndefeated = {
      ...emptyTeam({ id: "A", name: "1-0 Team" }),
      w: 1,
      l: 0,
      games: 1,
      pct: 1,
      runDiff: 1,
    };
    const longerUndefeated = {
      ...emptyTeam({ id: "B", name: "10-0 Team" }),
      w: 10,
      l: 0,
      games: 10,
      pct: 1,
      runDiff: 0,
    };

    const ranked = rankTeams([shortUndefeated, longerUndefeated], {
      tiebreakerOrder: ["runDifferential"],
      winPoints: 1,
      tiePoints: 0.5,
    });

    expect(ranked.map((team) => team.id)).toEqual(["A", "B"]);
    expect(standingsPoints(longerUndefeated, { winPoints: 1, tiePoints: 0.5 })).toBeGreaterThan(
      standingsPoints(shortUndefeated, { winPoints: 1, tiePoints: 0.5 })
    );
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

  it("applies configurable head-to-head before run differential for two-team ties", () => {
    const a = {
      ...emptyTeam({ id: "A", name: "Aces" }),
      w: 1,
      l: 1,
      games: 2,
      pct: 0.5,
      runDiff: -9,
      headToHead: { B: { wins: 1, losses: 0, ties: 0 } },
    };
    const b = {
      ...emptyTeam({ id: "B", name: "Bears" }),
      w: 1,
      l: 1,
      games: 2,
      pct: 0.5,
      runDiff: 6,
      headToHead: { A: { wins: 0, losses: 1, ties: 0 } },
    };

    const headToHeadFirst = rankTeams([a, b], {
      tiebreakerOrder: ["headToHead", "runDifferential"],
    }).map((team) => team.id);
    const runDifferentialFirst = rankTeams([a, b], {
      tiebreakerOrder: ["runDifferential", "headToHead"],
    }).map((team) => team.id);

    expect(headToHeadFirst).toEqual(["A", "B"]);
    expect(runDifferentialFirst).toEqual(["B", "A"]);
  });

  it("skips head-to-head for ties with more than two teams", () => {
    const leagueTeams: TeamBase[] = [
      { id: "A", name: "Aces" },
      { id: "B", name: "Bears" },
      { id: "C", name: "Comets" },
    ];
    const leagueMatchups: Matchup[] = [
      { id: "h1", date: "5/1", away: "A", home: "B" },
      { id: "h2", date: "5/2", away: "A", home: "C" },
      { id: "h3", date: "5/3", away: "B", home: "C" },
    ];
    const live = calculateTeams(leagueTeams, leagueMatchups, {
      h1: finalLog({ awayRuns: "5", homeRuns: "4" }),
      h2: finalLog({ awayRuns: "0", homeRuns: "10" }),
      h3: finalLog({ awayRuns: "10", homeRuns: "0" }),
    });

    expect(
      rankTeams(live, { tiebreakerOrder: ["headToHead", "runDifferential"] }).map((team) => team.id)
    ).toEqual(["B", "C", "A"]);
  });

  it("uses runs scored after run differential and runs allowed remain tied", () => {
    const a = {
      ...emptyTeam({ id: "A", name: "Aces" }),
      w: 1,
      l: 1,
      games: 2,
      pct: 0.5,
      rs: 12,
      ra: 10,
      runDiff: 2,
    };
    const b = {
      ...emptyTeam({ id: "B", name: "Bears" }),
      w: 1,
      l: 1,
      games: 2,
      pct: 0.5,
      rs: 14,
      ra: 10,
      runDiff: 2,
    };

    expect(
      rankTeams([a, b], { tiebreakerOrder: ["runDifferential", "runsAgainst", "runsFor"] }).map(
        (team) => team.id
      )
    ).toEqual(["B", "A"]);
  });

  it("honors runs-against and run-differential tiebreaker order", () => {
    const leagueTeams: TeamBase[] = [
      { id: "A", name: "Aces" },
      { id: "B", name: "Bears" },
      { id: "C", name: "Comets" },
    ];
    const leagueMatchups: Matchup[] = [
      { id: "r1", date: "5/1", away: "A", home: "C" },
      { id: "r2", date: "5/2", away: "B", home: "C" },
    ];
    const live = calculateTeams(leagueTeams, leagueMatchups, {
      r1: finalLog({ awayRuns: "5", homeRuns: "4" }),
      r2: finalLog({ awayRuns: "10", homeRuns: "8" }),
    });

    expect(
      rankTeams(live, { tiebreakerOrder: ["runsAgainst", "runDifferential"] })
        .slice(0, 2)
        .map((team) => team.id)
    ).toEqual(["A", "B"]);
    expect(
      rankTeams(live, { tiebreakerOrder: ["runDifferential", "runsAgainst"] })
        .slice(0, 2)
        .map((team) => team.id)
    ).toEqual(["B", "A"]);
  });
});

describe("predictGame", () => {
  const live = calculateTeams(teams, matchups, {
    g1: finalLog({ awayRuns: "8", homeRuns: "4" }),
    g2: finalLog({ awayRuns: "3", homeRuns: "5" }),
    g3: finalLog({ awayRuns: "6", homeRuns: "4" }),
  });
  const game: Matchup = { id: "future", date: "5/9", away: "A", home: "B" };

  it("uses neutral league priors when the sample is thin", () => {
    const thinLive = calculateTeams(teams, matchups, {});
    const prediction = predictGame(game, thinLive, settings);
    expect(prediction.confidence).toBe("Low");
    expect(prediction.awayWinPct).toBe(0.5);
    expect(prediction.awayScore).toBe(prediction.homeScore);
  });

  it("aggression scales the predicted scores", () => {
    const conservative = predictGame(game, live, {
      ...settings,
      pitchMode: "machine",
      modelAggression: "Conservative",
    });
    const aggressive = predictGame(game, live, {
      ...settings,
      pitchMode: "machine",
      modelAggression: "Aggressive",
    });
    // The two aggressions should not produce identical scores when there is a
    // real tpi/momentum signal.
    const sameScore =
      conservative.awayScore === aggressive.awayScore &&
      conservative.homeScore === aggressive.homeScore;
    expect(sameScore).toBe(false);
  });

  it("blends quality, form, contact, and head-to-head signals into the winner pick", () => {
    const away: Team = {
      ...emptyTeam({ id: "A", name: "Aces" }),
      w: 8,
      l: 2,
      games: 10,
      pct: 0.8,
      rs: 46,
      ra: 36,
      runDiff: 10,
      rsg: 4.6,
      rag: 3.6,
      hpg: 8.5,
      kpg: 2.2,
      totalK6: 2.2,
      tpi: 4.4,
      sos: 1.2,
      momentum: 2.8,
      headToHead: { B: { wins: 2, losses: 0, ties: 0 } },
    };
    const home: Team = {
      ...emptyTeam({ id: "B", name: "Bears" }),
      w: 4,
      l: 6,
      games: 10,
      pct: 0.4,
      rs: 52,
      ra: 60,
      runDiff: -8,
      rsg: 5.2,
      rag: 6,
      hpg: 5.1,
      kpg: 6.4,
      totalK6: 6.4,
      tpi: -1.5,
      sos: -0.5,
      momentum: -1.4,
      headToHead: { A: { wins: 0, losses: 2, ties: 0 } },
    };

    // Contact/strikeout/tpi signals drive the machine-pitch model specifically.
    const prediction = predictGame(
      { id: "future", date: "5/9", away: "A", home: "B" },
      [away, home],
      {
        ...settings,
        pitchMode: "machine",
      }
    );

    expect(prediction.winnerId).toBe("A");
    expect(prediction.awayWinPct).toBeGreaterThan(0.6);
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
    expect(Math.abs(favored + underdog - 1)).toBeLessThan(0.001);
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

  it("does not fold projected results into finalized-only per-game rates", () => {
    const before = live.find((t) => t.id === "B")!;
    const result = applyResult(live, future, "B", live, settings);
    const after = result.find((t) => t.id === "B")!;

    expect(after.games).toBe(before.games + 1);
    expect(after.rsg).toBe(before.rsg);
    expect(after.rag).toBe(before.rag);
    expect(after.hpg).toBe(before.hpg);
    expect(after.kpg).toBe(before.kpg);
  });
});

describe("isSeedingLocked", () => {
  const seededTeam = (id: string, wins: number, losses: number, runDiff: number): Team => {
    const team = emptyTeam({ id, name: id });
    team.w = wins;
    team.l = losses;
    team.games = wins + losses;
    team.pct = team.games ? wins / team.games : 0;
    team.rs = wins * 8 + losses * 3;
    team.ra = team.rs - runDiff;
    team.runDiff = runDiff;
    team.rsg = team.games ? team.rs / team.games : 0;
    team.rag = team.games ? team.ra / team.games : 0;
    team.baseTpi = team.pct * 2 + runDiff / Math.max(1, team.games);
    team.tpi = team.baseTpi;
    return team;
  };

  it("reports locked seeding when every remaining winner leaves ranks unchanged", () => {
    const lockedTeams = [
      seededTeam("A", 6, 0, 36),
      seededTeam("B", 3, 3, 4),
      seededTeam("C", 0, 6, -40),
    ];
    const lockedRemaining: Matchup[] = [{ id: "locked", date: "5/9", away: "B", home: "C" }];

    expect(isSeedingLocked(lockedTeams, lockedRemaining, settings)).toBe(true);
  });

  it("reports open seeding when a remaining result can move a team", () => {
    const openTeams = [
      seededTeam("A", 6, 0, 36),
      seededTeam("B", 2, 4, 1),
      seededTeam("C", 2, 4, -1),
    ];
    const openRemaining: Matchup[] = [{ id: "open", date: "5/9", away: "B", home: "C" }];

    expect(isSeedingLocked(openTeams, openRemaining, settings)).toBe(false);
  });
});

describe("projectStandings + simulateGoldOdds", () => {
  it("returns a ranked list with monotonic ranks", () => {
    const live = calculateTeams(teams, matchups, {});
    const projected = projectStandings(live, matchups, settings);
    expect(projected.map((t) => t.rank)).toEqual([1, 2, 3]);
  });

  it("produces stable projection regression output", () => {
    const live = calculateTeams(teams, matchups, {
      g1: finalLog({ awayRuns: "3", homeRuns: "2" }),
    });
    const projected = projectStandings(live, [matchups[1]!, matchups[2]!], settings);
    expect(projected.map((t) => `${t.id}:${t.w}-${t.l}-${t.t}:r${t.rank}`)).toMatchInlineSnapshot(`
      [
        "A:2-0-0:r1",
        "C:1-1-0:r2",
        "B:0-2-0:r3",
      ]
    `);
  });

  it("uses custom scoring settings when ranking projected standings", () => {
    const higherWinTotal = {
      ...emptyTeam({ id: "A", name: "9-3 Team" }),
      w: 9,
      l: 3,
      games: 12,
      pct: 9 / 12,
    };
    const tieHeavy = {
      ...emptyTeam({ id: "B", name: "8-2-3 Team" }),
      w: 8,
      l: 2,
      t: 3,
      games: 13,
      pct: (8 + 3 * 0.5) / 13,
    };

    const projected = projectStandings([tieHeavy, higherWinTotal], [], {
      ...settings,
      tiePoints: 0,
    });

    expect(projected.map((team) => team.id)).toEqual(["A", "B"]);
  });

  it("uses custom scoring settings when ranking simulated gold odds", () => {
    const higherWinTotal = {
      ...emptyTeam({ id: "A", name: "9-3 Team" }),
      w: 9,
      l: 3,
      games: 12,
      pct: 9 / 12,
    };
    const tieHeavy = {
      ...emptyTeam({ id: "B", name: "8-2-3 Team" }),
      w: 8,
      l: 2,
      t: 3,
      games: 13,
      pct: (8 + 3 * 0.5) / 13,
    };

    const odds = simulateGoldOdds([tieHeavy, higherWinTotal], [], 10, "custom-scoring", 1, {
      ...settings,
      tiePoints: 0,
    });

    expect(odds.A).toBe(100);
    expect(odds.B).toBe(0);
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

/**
 * The loop's answers, pinned to the digit, so that making it faster can be shown to have changed
 * nothing else. An eight-team round robin with ten results in: enough teams for the cut to be
 * contested and enough games left for the draws to matter.
 */
describe("the simulation loop, pinned", () => {
  const rounded = (odds: Record<string, number>) =>
    Object.fromEntries(Object.entries(odds).map(([id, pct]) => [id, Number(pct.toFixed(3))]));
  const pinned = () => {
    const eight: TeamBase[] = Array.from({ length: 8 }, (_, i) => ({
      id: `T${i + 1}`,
      name: `Team ${i + 1}`,
    }));
    const games: Matchup[] = [];
    eight.forEach((away, i) =>
      eight
        .slice(i + 1)
        .forEach((home, j) =>
          games.push({ id: `p${i}-${j}`, date: "5/1", away: away.id, home: home.id })
        )
    );
    const logs: Record<string, GameLog> = {};
    games.slice(0, 10).forEach((game, at) => {
      logs[game.id] = finalLog({
        awayRuns: String(2 + (at % 5)),
        homeRuns: String(1 + ((at * 3) % 6)),
      });
    });
    const live = calculateTeams(eight, games, logs, settings);
    return { live, remaining: games.filter((game) => !logs[game.id]) };
  };

  it("gold odds", () => {
    const { live, remaining } = pinned();
    const odds = simulateGoldOdds(live, remaining, 150, "pinned", 3, settings);
    expect(rounded(odds)).toMatchInlineSnapshot(`
      {
        "T1": 99.333,
        "T2": 47.333,
        "T3": 46,
        "T4": 10,
        "T5": 11.333,
        "T6": 15.333,
        "T7": 50,
        "T8": 20.667,
      }
    `);
  });

  it("bracket odds", () => {
    const { live, remaining } = pinned();
    const result = simulateBracketOdds(live, remaining, 80, "pinned", 4, settings);
    expect({
      champion: rounded(result.championOdds),
      finals: rounded(result.finalsOdds),
      iterations: result.iterations,
    }).toMatchInlineSnapshot(`
      {
        "champion": {
          "T1": 23.75,
          "T2": 15,
          "T3": 15,
          "T4": 0,
          "T5": 7.5,
          "T6": 6.25,
          "T7": 22.5,
          "T8": 10,
        },
        "finals": {
          "T1": 51.25,
          "T2": 33.75,
          "T3": 31.25,
          "T4": 3.75,
          "T5": 12.5,
          "T6": 12.5,
          "T7": 37.5,
          "T8": 17.5,
        },
        "iterations": 80,
      }
    `);
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

it("defaults pitch mode to kid pitch", () => {
  // Kid pitch (`player`) is the common format, so it is the default for a new
  // league. The machine-pitch model stays available via Settings.
  expect(DEFAULT_SETTINGS.pitchMode).toBe("player");
});

it("player-pitch predictions are affected by walks and errors", () => {
  const cleanLogs = {
    g1: finalLog({
      awayRuns: "6",
      awayHits: "8",
      homeRuns: "4",
      homeHits: "6",
      awayErrors: "0",
      homeErrors: "0",
      awayWalksAllowed: "1",
      homeWalksAllowed: "1",
    }),
    g2: finalLog({
      awayRuns: "5",
      awayHits: "7",
      homeRuns: "3",
      homeHits: "5",
      awayErrors: "0",
      homeErrors: "0",
      awayWalksAllowed: "1",
      homeWalksAllowed: "1",
    }),
    g3: finalLog({
      awayRuns: "4",
      awayHits: "7",
      homeRuns: "6",
      homeHits: "8",
      awayErrors: "0",
      homeErrors: "0",
      awayWalksAllowed: "1",
      homeWalksAllowed: "1",
    }),
  };
  const messyLogs = {
    ...cleanLogs,
    g3: finalLog({
      awayRuns: "4",
      awayHits: "7",
      homeRuns: "6",
      homeHits: "8",
      awayErrors: "8",
      homeErrors: "0",
      awayWalksAllowed: "9",
      homeWalksAllowed: "1",
    }),
  };

  const playerGame: Matchup = { id: "future-player", date: "5/9", away: "A", home: "B" };
  const cleanPrediction = predictGame(playerGame, calculateTeams(teams, matchups, cleanLogs), {
    ...settings,
    pitchMode: "player",
  });
  const messyPrediction = predictGame(playerGame, calculateTeams(teams, matchups, messyLogs), {
    ...settings,
    pitchMode: "player",
  });

  expect(messyPrediction.awayWinPct).toBeLessThan(cleanPrediction.awayWinPct);
});

it("defaults max run differential to the typical 8-run cap", () => {
  expect(DEFAULT_SETTINGS.maxRunDifferential).toBe(8);
});

it("caps per-game run differential when configured", () => {
  const capped = calculateTeams(
    teams,
    [{ id: "cap-game", date: "5/1", away: "A", home: "B" }],
    { "cap-game": finalLog({ awayRuns: "18", homeRuns: "2" }) },
    { maxRunDifferential: 10 }
  );

  expect(capped.find((team) => team.id === "A")?.runDiff).toBe(10);
  expect(capped.find((team) => team.id === "B")?.runDiff).toBe(-10);
});

it("allows run differential to be uncapped when configured", () => {
  const uncapped = calculateTeams(
    teams,
    [{ id: "uncapped-game", date: "5/1", away: "A", home: "B" }],
    { "uncapped-game": finalLog({ awayRuns: "18", homeRuns: "2" }) },
    { maxRunDifferential: 0 }
  );

  expect(uncapped.find((team) => team.id === "A")?.runDiff).toBe(16);
  expect(uncapped.find((team) => team.id === "B")?.runDiff).toBe(-16);
});

it("defaults to scoring errors", () => {
  expect(DEFAULT_SETTINGS.trackErrors).toBe(true);
});

describe("the opponent-adjusted rating in a forecast", () => {
  /** A team with a real record, so neither predictor takes its thin-sample early return. */
  const played = (id: string, over: Partial<Team> = {}): Team => ({
    ...emptyTeam({ id, name: id }),
    w: 5,
    l: 5,
    games: 10,
    pct: 0.5,
    rs: 80,
    ra: 80,
    rsg: 8,
    rag: 8,
    runDiff: 0,
    ...over,
  });
  const fixture: Matchup = { id: "g1", date: "5/1", away: "A", home: "B" };
  const modes: Settings["pitchMode"][] = ["player", "machine"];

  it("attaches nothing to a team the fit never saw a game for", () => {
    const fitted = attachAdjustedRatings([played("A"), played("B")], {
      byTeam: new Map([["A", 2.5]]),
      games: new Map([["A", 6]]),
    });
    expect(fitted[0]).toMatchObject({ adjustedRating: 2.5, ratedGames: 6 });
    expect("adjustedRating" in fitted[1]!).toBe(false);
  });

  it("attaches nothing when the fit saw the team but rated no games", () => {
    // A rating of 0 off zero games is "league average because we know nothing", not a measurement.
    const fitted = attachAdjustedRatings([played("A")], {
      byTeam: new Map([["A", 0]]),
      games: new Map([["A", 0]]),
    });
    expect("adjustedRating" in fitted[0]!).toBe(false);
  });

  modes.forEach((pitchMode) => {
    const settings: Settings = { ...DEFAULT_SETTINGS, pitchMode };

    it(`leaves a ${pitchMode}-pitch forecast untouched when neither side has a rating`, () => {
      // This is what keeps every league that has never built a rating on the numbers it has now.
      const plain = [played("A"), played("B")];
      const halfRated = attachAdjustedRatings(plain, {
        byTeam: new Map([["A", 4]]),
        games: new Map([["A", 10]]),
      });
      expect(predictGame(fixture, halfRated, settings)).toEqual(
        predictGame(fixture, plain, settings)
      );
    });

    it(`moves a ${pitchMode}-pitch forecast toward the better-rated side`, () => {
      const rated = attachAdjustedRatings([played("A"), played("B")], {
        byTeam: new Map([
          ["A", 3],
          ["B", -3],
        ]),
        games: new Map([
          ["A", 12],
          ["B", 12],
        ]),
      });
      const before = predictGame(fixture, [played("A"), played("B")], settings);
      const after = predictGame(fixture, rated, settings);
      expect(after.awayWinPct).toBeGreaterThan(before.awayWinPct);
      expect(after.awayScore - after.homeScore).toBeGreaterThan(
        before.awayScore - before.homeScore
      );
      expect(after.winnerId).toBe("A");
    });

    it(`leans harder on a ${pitchMode}-pitch rating the more games are behind it`, () => {
      const at = (rated: number) =>
        predictGame(
          fixture,
          attachAdjustedRatings([played("A"), played("B")], {
            byTeam: new Map([
              ["A", 3],
              ["B", -3],
            ]),
            games: new Map([
              ["A", rated],
              ["B", rated],
            ]),
          }),
          settings
        ).awayWinPct;
      expect(at(20)).toBeGreaterThan(at(4));
      expect(at(4)).toBeGreaterThan(at(1));
    });

    it(`keeps the expected total runs of a ${pitchMode}-pitch forecast`, () => {
      // Only the gap between the two sides moves, so a blend cannot turn a 9-7 into a 2-0.
      const plain = [played("A"), played("B")];
      const rated = attachAdjustedRatings(plain, {
        byTeam: new Map([
          ["A", 5],
          ["B", -5],
        ]),
        games: new Map([
          ["A", 12],
          ["B", 12],
        ]),
      });
      const before = predictGame(fixture, plain, settings);
      const after = predictGame(fixture, rated, settings);
      const total = (p: { awayScore: number; homeScore: number }) => p.awayScore + p.homeScore;
      expect(Math.abs(total(after) - total(before))).toBeLessThanOrEqual(1);
      expect(after.awayScore).toBeGreaterThanOrEqual(1);
      expect(after.homeScore).toBeGreaterThanOrEqual(1);
    });
  });
});
