import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSimulationBracket, useSimulationOdds, useSimulationTrend } from "./useSimulationWorker";
import {
  attachAdjustedRatings,
  calculateTeams,
  simulateBracketOdds,
  simulateGoldOdds,
  simulateGoldOddsRun,
  simulationSeed,
} from "../lib/sim";
import { DEFAULT_SETTINGS, type GameLog, type Matchup, type Settings } from "../lib/types";

/*
 * The odds follow the ratings they are simulated with.
 *
 * The runs were keyed on counts, the seed and the settings, and the seed is built from the league's
 * final scores. A league team linked to its club in Settings, or a pull in Team Rankings, moves the
 * ratings and none of those, so the Gold % stayed the one simulated from the old ratings while the
 * game picks beside it moved: 9.8 points on a rebuilt league after a preseason first pull. Here the
 * only thing that changes between the two renders is the rating each team carries.
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
const logs = { f1: final(6, 5), f2: final(5, 6) };
const records = calculateTeams(bases, matchups, logs, settings);
const remaining = matchups.filter((game) => !(game.id in logs));
const seedText = simulationSeed(matchups, logs, "odds");
const rated = (ratings: Record<string, number>) =>
  attachAdjustedRatings(records, {
    byTeam: new Map(Object.entries(ratings)),
    games: new Map(Object.keys(ratings).map((id) => [id, 6])),
  });
const before = rated({ a: 1, b: -1, c: -1, d: 1 });
const after = rated({ a: -3, b: 3, c: -3, d: 3 });
const inputFor = (teams: typeof before) => ({
  teams,
  remaining,
  iterations: 1000,
  seedText,
  cutoff: 2,
  settings,
});

describe("simulated odds after only the ratings change", () => {
  it("are simulated again, for the Gold %", async () => {
    const expected = simulateGoldOddsRun(after, remaining, 1000, seedText, 2, settings).odds;
    const stale = simulateGoldOddsRun(before, remaining, 1000, seedText, 2, settings).odds;
    // The fixture is worth something: the two sets of ratings give different odds.
    expect(Math.abs((expected.b ?? 0) - (stale.b ?? 0))).toBeGreaterThan(5);

    const { result, rerender } = renderHook(
      ({ teams }: { teams: typeof before }) => useSimulationOdds(inputFor(teams), 0),
      { initialProps: { teams: before } }
    );
    await waitFor(() => expect(result.current.odds).toEqual(stale));
    rerender({ teams: after });
    await waitFor(() => expect(result.current.odds).toEqual(expected));
    expect(result.current.pending).toBe(false);
  });

  it("are simulated again, for the bracket", async () => {
    const expected = simulateBracketOdds(after, remaining, 1000, seedText, 2, settings);
    const { result, rerender } = renderHook(
      ({ teams }: { teams: typeof before }) =>
        useSimulationBracket({ ...inputFor(teams), enabled: true }, 0),
      { initialProps: { teams: before } }
    );
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.bracketOdds.championOdds).not.toEqual(expected.championOdds);
    rerender({ teams: after });
    await waitFor(() =>
      expect(result.current.bracketOdds.championOdds).toEqual(expected.championOdds)
    );
  });

  it("are simulated again, for each point of the trend", async () => {
    const trendInput = (teams: typeof before) => ({
      teamIds: bases.map((team) => team.id),
      states: [{ teams, remaining, seedText }],
      iterations: 1000,
      cutoff: 2,
      settings,
    });
    const expected = simulateGoldOdds(after, remaining, 1000, seedText, 2, settings);
    const { result, rerender } = renderHook(
      ({ teams }: { teams: typeof before }) => useSimulationTrend(trendInput(teams), 0),
      { initialProps: { teams: before } }
    );
    await waitFor(() => expect(result.current.b).toHaveLength(1));
    rerender({ teams: after });
    await waitFor(() => expect(result.current.b).toEqual([expected.b ?? 0]));
  });
});
