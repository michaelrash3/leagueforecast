import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type GameLog } from "../lib/types";
import { useSeasonState, type SeasonState } from "./useSeasonState";

const score = (away: string, home: string): GameLog => ({
  awayRuns: away,
  awayHits: "",
  awayK: "",
  homeRuns: home,
  homeHits: "",
  homeK: "",
  innings: "6",
  isFinal: true,
});

const START: SeasonState = {
  teams: [
    { id: "A", name: "Club A" },
    { id: "B", name: "Club B" },
  ],
  matchups: [{ id: "g1", date: "4/3", away: "A", home: "B" }],
  logs: {},
  bracketLogs: {},
  settings: DEFAULT_SETTINGS,
};

describe("the open season as one piece of state", () => {
  it("sets each part by a value or an updater, as its own state's setter did", () => {
    const { result } = renderHook(() => useSeasonState(() => ({ id: "s1", season: START })));
    act(() => result.current.setLogs({ g1: score("1", "0") }));
    act(() => result.current.setLogs((prev) => ({ ...prev, g1: score("7", "4") })));
    act(() => result.current.setSettings((prev) => ({ ...prev, winPoints: 2 })));
    expect(result.current.logs).toEqual({ g1: score("7", "4") });
    expect(result.current.settings.winPoints).toBe(2);
    expect(result.current.season.logs).toBe(result.current.logs);
  });

  it("keeps every part it did not change, and the whole, when nothing changed", () => {
    const { result } = renderHook(() => useSeasonState(() => ({ id: "s1", season: START })));
    const before = result.current;
    act(() => result.current.setLogs({ g1: score("1", "0") }));
    expect(result.current.teams).toBe(before.teams);
    expect(result.current.matchups).toBe(before.matchups);
    expect(result.current.settings).toBe(before.settings);
    const season = result.current.season;
    let told = 0;
    result.current.store.subscribe(() => (told += 1));
    act(() => result.current.setTeams((prev) => prev));
    act(() => result.current.setSeason((prev) => prev));
    expect(result.current.season).toBe(season);
    expect(told).toBe(0);
  });

  it("is read and changed at once, before anything renders", () => {
    const { result } = renderHook(() => useSeasonState(() => ({ id: "s1", season: START })));
    const { store } = result.current;
    let read: SeasonState | null = null;
    act(() => {
      result.current.setLogs({ g1: score("2", "1") });
      read = store.get().season;
      store.setSeason((prev) => ({ ...prev, bracketLogs: { final: score("1", "0") } }));
    });
    expect((read as SeasonState | null)?.logs).toEqual({ g1: score("2", "1") });
    expect(result.current.logs).toEqual({ g1: score("2", "1") });
    expect(result.current.bracketLogs).toEqual({ final: score("1", "0") });
  });

  it("opens another season's id and data in one step, and keeps the id through every edit", () => {
    const { result } = renderHook(() => useSeasonState(() => ({ id: "s1", season: START })));
    const { store } = result.current;
    const seen: string[] = [];
    store.subscribe(() => {
      const open = store.get();
      seen.push(`${open.id}:${open.season.teams.length}`);
    });
    act(() => result.current.setLogs({ g1: score("1", "0") }));
    expect(store.get().id).toBe("s1");
    act(() => result.current.openSeason("s2", { ...START, teams: [], matchups: [], logs: {} }));
    expect(seen).toEqual(["s1:2", "s2:0"]);
    expect(result.current.seasonId).toBe("s2");
    expect(result.current.teams).toEqual([]);
  });

  it("hands the whole-season setter every update queued before it", () => {
    const { result } = renderHook(() => useSeasonState(() => ({ id: "s1", season: START })));
    let seen: SeasonState | null = null;
    act(() => {
      result.current.setLogs({ g1: score("3", "2") });
      result.current.setMatchups((prev) => [
        ...prev,
        { id: "g2", date: "4/10", away: "B", home: "A" },
      ]);
      result.current.setSeason((prev) => {
        seen = prev;
        return prev;
      });
    });
    expect(seen).toMatchObject({ logs: { g1: score("3", "2") } });
    expect((seen as SeasonState | null)?.matchups.map((game) => game.id)).toEqual(["g1", "g2"]);
  });

  it("keeps its setters for the life of the page", () => {
    const { result, rerender } = renderHook(() =>
      useSeasonState(() => ({ id: "s1", season: START }))
    );
    const setters = [result.current.setTeams, result.current.setLogs, result.current.setSettings];
    act(() => result.current.setLogs({ g1: score("1", "0") }));
    rerender();
    expect([result.current.setTeams, result.current.setLogs, result.current.setSettings]).toEqual(
      setters
    );
  });
});
