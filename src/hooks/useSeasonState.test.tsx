import { act, render, renderHook } from "@testing-library/react";
import { useLayoutEffect, useTransition } from "react";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type GameLog } from "../lib/types";
import { useSeasonState, type SeasonState, type SeasonStateControls } from "./useSeasonState";

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

  it("renders a change made in a transition as one, the scores as they were first", () => {
    const commits: string[] = [];
    const held: {
      controls: SeasonStateControls | null;
      start: ((change: () => void) => void) | null;
    } = { controls: null, start: null };
    const Probe = () => {
      const season = useSeasonState(() => ({ id: "s1", season: START }));
      const [pending, startTransition] = useTransition();
      held.controls = season;
      held.start = startTransition;
      const shown = `${pending}:${season.logs.g1?.awayRuns ?? "-"}`;
      useLayoutEffect(() => {
        commits.push(shown);
      });
      return null;
    };
    render(<Probe />);
    act(() => held.start?.(() => held.controls?.setLogs({ g1: score("7", "4") })));
    // Pending over the scores as they were, then the new ones, as a score box's keystroke renders.
    expect(commits).toEqual(["false:-", "true:-", "false:7"]);
    // What reads the store sees the score at once, whatever the page is still rendering.
    expect(held.controls?.store.get().season.logs.g1?.awayRuns).toBe("7");
  });
});

describe("the open season locked against the page's edits", () => {
  it("refuses every setter's edit, saying why, and changes nothing", () => {
    const { result } = renderHook(() => useSeasonState(() => ({ id: "s1", season: START })));
    const { store } = result.current;
    const refused: string[] = [];
    store.onRefused((why) => refused.push(why));
    let told = 0;
    store.subscribe(() => (told += 1));
    store.lock("Offline.");
    act(() => result.current.setLogs({ g1: score("1", "0") }));
    act(() => result.current.setTeams([]));
    act(() =>
      store.setSeason((prev) => ({ ...prev, settings: { ...prev.settings, winPoints: 9 } }))
    );
    expect(refused).toEqual(["Offline.", "Offline.", "Offline."]);
    expect(told).toBe(0);
    expect(result.current.season).toBe(START);
  });

  it("still takes another device's edits, and another season opened", () => {
    const { result } = renderHook(() => useSeasonState(() => ({ id: "s1", season: START })));
    const { store } = result.current;
    store.lock("Offline.");
    act(() => store.apply({ ...START, logs: { g1: score("5", "2") } }));
    expect(result.current.logs).toEqual({ g1: score("5", "2") });
    act(() => store.open("s2", START));
    expect(store.get().id).toBe("s2");
    expect(result.current.season).toBe(START);
  });

  it("takes the page's edits again once unlocked", () => {
    const { result } = renderHook(() => useSeasonState(() => ({ id: "s1", season: START })));
    const { store } = result.current;
    const refused: string[] = [];
    store.onRefused((why) => refused.push(why));
    store.lock("Offline.");
    store.lock(null);
    act(() => result.current.setLogs({ g1: score("3", "1") }));
    expect(result.current.logs).toEqual({ g1: score("3", "1") });
    expect(refused).toEqual([]);
  });
});
