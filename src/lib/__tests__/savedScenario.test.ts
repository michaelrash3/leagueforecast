import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  coerceSavedScenario,
  createSavedScenario,
  decodeSharedScenario,
  duplicateSavedScenario,
  encodeSharedScenario,
  loadSavedScenarios,
  rebaseSavedScenario,
  renameSavedScenario,
  saveSavedScenarios,
  scenarioFingerprint,
  staleScenarioReasons,
} from "../savedScenario";
import type { GameLog, Matchup } from "../types";

const games: Matchup[] = [
  { id: "g1", date: "10/1", away: "A", home: "B" },
  { id: "g2", date: "10/2", away: "B", home: "C" },
];
const final: GameLog = {
  awayRuns: "4",
  homeRuns: "2",
  awayHits: "",
  homeHits: "",
  awayK: "",
  homeK: "",
  innings: "6",
  isFinal: true,
};
const NOW = "2026-09-30T12:00:00.000Z";

const saved = () =>
  createSavedScenario(
    {
      id: "scenario-1",
      name: "Win out",
      seasonId: "fall-2026",
      picks: { g1: { winnerId: "A" }, g2: { winnerId: "C", awayRuns: 2, homeRuns: 5 } },
      sourceFingerprint: scenarioFingerprint(games, {}),
    },
    NOW
  );

describe("saved playoff scenarios", () => {
  it("creates, renames, and duplicates without changing the original", () => {
    const scenario = saved();
    expect(renameSavedScenario(scenario, "Upset path", "later")).toMatchObject({
      name: "Upset path",
      modifiedAt: "later",
    });
    expect(duplicateSavedScenario(scenario, "scenario-2", "later")).toMatchObject({
      id: "scenario-2",
      name: "Win out copy",
      createdAt: "later",
    });
    expect(scenario.name).toBe("Win out");
  });

  it("detects final, removed, and changed-participant picks", () => {
    const scenario = saved();
    expect(staleScenarioReasons(scenario, [{ ...games[0]!, away: "D" }], { g1: final })).toEqual([
      { gameId: "g1", kind: "became-final" },
      { gameId: "g2", kind: "removed" },
    ]);
    expect(
      staleScenarioReasons(scenario, [{ ...games[0]!, away: "D" }, games[1]!], {})
    ).toContainEqual({ gameId: "g1", kind: "participants-changed" });
  });

  it("rebases unaffected picks and reports every removed assumption", () => {
    const result = rebaseSavedScenario(saved(), [games[0]!], {}, "later");
    expect(result.scenario.picks).toEqual({ g1: { winnerId: "A" } });
    expect(result.removed).toEqual([{ gameId: "g2", kind: "removed" }]);
    expect(result.scenario.modifiedAt).toBe("later");
  });

  it("round-trips a share without applying it to season data", () => {
    const scenario = saved();
    expect(decodeSharedScenario(encodeSharedScenario(scenario))).toEqual(scenario);
    expect(decodeSharedScenario("not-json")).toBeNull();
  });

  it("rejects unknown persisted versions", () => {
    expect(coerceSavedScenario({ ...saved(), version: 99 })).toBeNull();
  });
});

describe("scenario persistence", () => {
  const values = new Map<string, string>();
  beforeEach(() => {
    values.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
  });

  it("stores only scenarios belonging to the requested season", () => {
    const scenario = saved();
    expect(saveSavedScenarios("fall-2026", [scenario, { ...scenario, seasonId: "other" }])).toBe(
      true
    );
    expect(loadSavedScenarios("fall-2026")).toEqual([scenario]);
  });

  it("treats an unreadable old value as an empty list", () => {
    values.set("league_forecast_scenarios_v1_fall-2026", "broken");
    expect(loadSavedScenarios("fall-2026")).toEqual([]);
  });
});
