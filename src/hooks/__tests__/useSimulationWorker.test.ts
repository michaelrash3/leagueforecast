import { describe, expect, it } from "vitest";
import {
  buildOddsRerunKey,
  buildTrendRerunKey,
} from "../useSimulationWorker";
import type { Matchup, Settings, Team } from "../../lib/types";

const settings: Settings = {
  goldCutoff: 4,
  seasonLabel: "Spring 26",
  modelAggression: "Balanced",
  maxScoreCap: 18,
  winPoints: 1,
  tiePoints: 0.5,
  runDiffTiebreaker: true,
};

const teams: Team[] = [
  {
    id: "a",
    name: "A",
    w: 1,
    l: 0,
    t: 0,
    rs: 10,
    ra: 8,
    games: 1,
    pct: 1,
    runDiff: 2,
    rsg: 10,
    rag: 8,
    hpg: 8,
    kpg: 4,
    tpi: 0,
    baseTpi: 0,
    sos: 0,
    momentum: 0,
    awayK6: null,
    homeK6: null,
    totalK6: null,
    machineDifficulty: 0,
  },
];

const remaining: Matchup[] = [{ id: "g1", date: "2026-05-25", away: "a", home: "b" }];

describe("simulation rerun keys", () => {
  it("keeps odds key stable across identity-only input changes", () => {
    const key1 = buildOddsRerunKey({
      teams,
      remaining,
      iterations: 2000,
      seedText: "seed-1",
      cutoff: 4,
      settings,
    });

    const key2 = buildOddsRerunKey({
      teams: [...teams],
      remaining: [...remaining],
      iterations: 2000,
      seedText: "seed-1",
      cutoff: 4,
      settings: { ...settings },
    });

    expect(key2).toBe(key1);
  });

  it("changes trend key only when simulation-critical inputs change", () => {
    const base = buildTrendRerunKey({
      teamIds: ["a"],
      states: [{ teams, remaining, seedText: "state-1" }],
      iterations: 70,
      cutoff: 4,
      settings,
    });

    const identityOnly = buildTrendRerunKey({
      teamIds: ["a"],
      states: [{ teams: [...teams], remaining: [...remaining], seedText: "state-1" }],
      iterations: 70,
      cutoff: 4,
      settings: { ...settings },
    });
    expect(identityOnly).toBe(base);

    const changedSeed = buildTrendRerunKey({
      teamIds: ["a"],
      states: [{ teams, remaining, seedText: "state-2" }],
      iterations: 70,
      cutoff: 4,
      settings,
    });
    expect(changedSeed).not.toBe(base);
  });
});
