import { afterEach, describe, expect, it, vi } from "vitest";
import { calculateTeams, simulateGoldOdds, simulateTrendPoint, simulationSeed } from "../lib/sim";
import { DEFAULT_SETTINGS, type GameLog, type Matchup, type Settings } from "../lib/types";
import type { TrendRequest, WorkerResponse } from "./sim.worker";

/*
 * The simulation worker's port itself (`sim.worker.ts`): the trend's points are drawn there as the
 * page draws them where no worker runs (`simulateTrendPoint`), the last two paired. A worker that
 * dropped the pairing would put the Our Team card's step back to two runs' worth of chance, and
 * nothing on the page could tell.
 */

const settings: Settings = { ...DEFAULT_SETTINGS, goldCutoff: 2 };
const bases = ["a", "b", "c", "d"].map((id) => ({ id, name: id }));
const matchups: Matchup[] = [
  { id: "f1", date: "9/10", away: "a", home: "b" },
  { id: "f2", date: "9/10", away: "c", home: "d" },
  { id: "u1", date: "10/1", away: "a", home: "c" },
  { id: "u2", date: "10/1", away: "b", home: "d" },
  { id: "u3", date: "10/8", away: "a", home: "d" },
  { id: "u4", date: "10/8", away: "b", home: "c" },
];
const final = (away: number, home: number): GameLog => ({
  awayRuns: String(away),
  awayHits: "",
  awayK: "",
  homeRuns: String(home),
  homeHits: "",
  homeK: "",
  innings: "6",
  isFinal: true,
});

describe("the simulation worker's port", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("draws a trend's points as the page does, the paired ones paired", async () => {
    const before = { f1: final(6, 5) };
    const after = { ...before, f2: final(5, 6) };
    const state = (logs: Record<string, GameLog>, paired?: true) => ({
      teams: calculateTeams(bases, matchups, logs, settings),
      remaining: matchups.filter((game) => !(game.id in logs)),
      seedText: simulationSeed(matchups, after, "trend"),
      ...(paired ? { paired } : {}),
    });
    const states = [state({}), state(before, true), state(after, true)];
    const posted: WorkerResponse[] = [];
    const scope: {
      onmessage: ((event: { data: TrendRequest }) => void) | null;
      postMessage: (answer: WorkerResponse) => void;
    } = { onmessage: null, postMessage: (answer) => posted.push(answer) };
    vi.stubGlobal("self", scope);
    await import("./sim.worker");
    scope.onmessage?.({
      data: {
        kind: "trend",
        id: 1,
        teamIds: ["b"],
        states,
        iterations: 600,
        cutoff: 2,
        settings,
      },
    });

    const expected = states.map((one) => simulateTrendPoint(one, 600, 2, settings).b ?? 0);
    expect(posted[0]).toEqual({ kind: "trend", id: 1, trend: { b: expected } });
    // The fixture is worth something: drawn on one stream, the paired points come out otherwise.
    const unpaired = states.map(
      (one) => simulateGoldOdds(one.teams, one.remaining, 600, one.seedText, 2, settings).b ?? 0
    );
    expect(expected.slice(1)).not.toEqual(unpaired.slice(1));
    expect(expected[0]).toBe(unpaired[0]);
  });
});
