import { describe, expect, it } from "vitest";
import { calculateTeams, simulateBracketOdds } from "../sim";
import { DEFAULT_SETTINGS, type GameLog, type Matchup, type TeamBase } from "../types";

const teams: TeamBase[] = [
  { id: "A", name: "Aces" },
  { id: "B", name: "Bears" },
  { id: "C", name: "Comets" },
  { id: "D", name: "Ducks" },
];

// A round-robin where results clearly separate the teams (A best … D worst).
const matchups: Matchup[] = [
  { id: "g1", date: "5/1", away: "A", home: "B" },
  { id: "g2", date: "5/2", away: "A", home: "C" },
  { id: "g3", date: "5/3", away: "A", home: "D" },
  { id: "g4", date: "5/4", away: "B", home: "C" },
  { id: "g5", date: "5/5", away: "B", home: "D" },
  { id: "g6", date: "5/6", away: "C", home: "D" },
];

const final = (awayRuns: string, homeRuns: string): GameLog => ({
  awayRuns,
  homeRuns,
  awayHits: "0",
  homeHits: "0",
  awayK: "0",
  homeK: "0",
  innings: "6",
  isFinal: true,
});

const logs: Record<string, GameLog> = {
  g1: final("8", "2"),
  g2: final("8", "3"),
  g3: final("9", "1"),
  g4: final("7", "3"),
  g5: final("8", "2"),
  g6: final("7", "4"),
};

const buildState = () => calculateTeams(teams, matchups, logs, DEFAULT_SETTINGS);

describe("simulateBracketOdds", () => {
  it("produces coherent seed, finals, and championship probabilities", () => {
    const state = buildState();
    const result = simulateBracketOdds(state, [], 200, "seed-test", 4, DEFAULT_SETTINGS);

    // Championship odds should sum to ~100% across all teams.
    const totalChampion = Object.values(result.championOdds).reduce((sum, v) => sum + v, 0);
    expect(totalChampion).toBeGreaterThan(95);
    expect(totalChampion).toBeLessThan(105);

    // Each team's seed distribution sums to ~100%.
    teams.forEach((team) => {
      const dist = result.seedDistribution[team.id] ?? [];
      const sum = dist.reduce((s, v) => s + v, 0);
      expect(sum).toBeGreaterThan(95);
      expect(sum).toBeLessThan(105);
    });

    // Reaching the final is at least as likely as winning it.
    teams.forEach((team) => {
      expect(result.finalsOdds[team.id]!).toBeGreaterThanOrEqual(result.championOdds[team.id]! - 0.001);
    });

    // The dominant team should be the title favorite and most often the top seed.
    expect(result.championOdds.A!).toBeGreaterThan(result.championOdds.D!);
    const aSeeds = result.seedDistribution.A ?? [];
    const topSeed = aSeeds.indexOf(Math.max(...aSeeds));
    expect(topSeed).toBe(0);
  });

  it("is deterministic for a fixed seed", () => {
    const state = buildState();
    const a = simulateBracketOdds(state, [], 120, "same-seed", 4, DEFAULT_SETTINGS);
    const b = simulateBracketOdds(state, [], 120, "same-seed", 4, DEFAULT_SETTINGS);
    expect(a.championOdds).toEqual(b.championOdds);
    expect(a.seedDistribution).toEqual(b.seedDistribution);
  });
});
