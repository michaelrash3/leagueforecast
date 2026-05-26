import { beforeEach, describe, expect, it } from "vitest";
import {
  STORAGE_KEYS,
  loadLogs,
  loadMatchups,
  loadSettings,
  loadTeams,
  readUndoSnapshot,
  saveUndoSnapshot,
} from "../storage";
import { DEFAULT_SETTINGS } from "../types";


const createLocalStorageMock = () => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  } as Storage;
};

describe("storage", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: createLocalStorageMock(),
      configurable: true,
      writable: true,
    });
    localStorage.clear();
  });

  it("migrates legacy teams key to versioned key on read", () => {
    localStorage.setItem(
      "league_teams",
      JSON.stringify([{ id: "a", name: "Alpha" }])
    );

    expect(loadTeams()).toEqual([{ id: "a", name: "Alpha" }]);
    expect(localStorage.getItem(STORAGE_KEYS.teams)).toBe(
      JSON.stringify([{ id: "a", name: "Alpha" }])
    );
    expect(localStorage.getItem("league_teams")).toBeNull();
  });

  it("does not overwrite existing versioned data during migration", () => {
    localStorage.setItem(
      "league_teams",
      JSON.stringify([{ id: "legacy", name: "Legacy" }])
    );
    localStorage.setItem(
      STORAGE_KEYS.teams,
      JSON.stringify([{ id: "current", name: "Current" }])
    );

    expect(loadTeams()).toEqual([{ id: "current", name: "Current" }]);
    expect(localStorage.getItem("league_teams")).toBe(
      JSON.stringify([{ id: "legacy", name: "Legacy" }])
    );
  });

  it("filters invalid records from logs and matchups", () => {
    localStorage.setItem(
      STORAGE_KEYS.logs,
      JSON.stringify({
        g1: {
          awayRuns: "1",
          awayHits: "2",
          awayK: "3",
          homeRuns: "4",
          homeHits: "5",
          homeK: "6",
          innings: "6",
          isFinal: true,
        },
        broken: { awayRuns: 1 },
      })
    );
    localStorage.setItem(
      STORAGE_KEYS.matchups,
      JSON.stringify([
        { id: "m1", date: "2026-05-26", away: "a", home: "b" },
        { id: "bad", date: "2026-05-26", away: "a" },
      ])
    );

    expect(loadLogs()).toEqual({
      g1: {
        awayRuns: "1",
        awayHits: "2",
        awayK: "3",
        homeRuns: "4",
        homeHits: "5",
        homeK: "6",
        innings: "6",
        isFinal: true,
      },
    });
    expect(loadMatchups()).toEqual([
      { id: "m1", date: "2026-05-26", away: "a", home: "b" },
    ]);
  });

  it("coerces invalid settings values back to defaults", () => {
    localStorage.setItem(
      STORAGE_KEYS.settings,
      JSON.stringify({
        seasonLabel: 42,
        modelAggression: "Turbo",
        runDiffTiebreaker: "yes",
        winPoints: "2",
      })
    );

    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips undo snapshot through JSON parse/stringify", () => {
    const snapshot = { kind: "delete", ids: ["g1", "g2"], at: "2026-05-26" };

    expect(saveUndoSnapshot(snapshot)).toBe(true);
    expect(readUndoSnapshot()).toEqual(snapshot);
  });
  it("returns safe defaults when localStorage access throws", () => {
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
        removeItem: () => {
          throw new Error("blocked");
        },
        clear: () => {
          throw new Error("blocked");
        },
      } as unknown as Storage,
      configurable: true,
      writable: true,
    });

    expect(loadTeams()).toEqual([]);
    expect(loadMatchups()).toEqual([]);
    expect(loadLogs()).toEqual({});
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(readUndoSnapshot()).toBeNull();
  });

  it("returns false when undo snapshot write throws", () => {
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: () => null,
        setItem: () => {
          throw new Error("quota");
        },
        removeItem: () => undefined,
        clear: () => undefined,
      } as unknown as Storage,
      configurable: true,
      writable: true,
    });

    expect(saveUndoSnapshot({ kind: "delete" })).toBe(false);
  });

});
