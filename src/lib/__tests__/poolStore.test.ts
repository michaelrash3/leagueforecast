import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fillPoolCache,
  initTeamRankingsStore,
  loadScoutGames,
  loadScoutTeams,
  resetTeamRankingsStore,
  saveScoutGames,
  saveScoutTeams,
  type PoolStoreIo,
} from "../teamRankingsStorage";
import { idbAvailable, openPoolDb } from "../idb";
import type { ScoutGame, ScoutTeam } from "../teamRankings";

const TEAMS_KEY = "league_forecast_scout_teams_v1";
const GAMES_KEY = "league_forecast_scout_games_v1";

/** A store that behaves like IndexedDB does for these purposes, without being it. */
const fakeIo = (
  overrides: Partial<PoolStoreIo> = {},
  seedLocal: Record<string, unknown> = {}
): PoolStoreIo & { store: Map<string, unknown>; local: Record<string, unknown> } => {
  const store = new Map<string, unknown>();
  const local: Record<string, unknown> = { ...seedLocal };
  return {
    store,
    local,
    keys: async () => [...store.keys()],
    get: async (key) => store.get(key) ?? null,
    set: async (key, value) => {
      store.set(key, value);
      return true;
    },
    readLocal: (key) => local[key] ?? null,
    clearLocal: (key) => {
      delete local[key];
    },
    ...overrides,
  };
};

const teams: ScoutTeam[] = [{ id: "S-LEXI", name: "Lexington Legends", state: "KY" }];
const games: ScoutGame[] = [
  { id: "g1", teamAId: "S-LEXI", teamBId: "S-OWEN", ageGroupId: "ag_1", date: "2026-08-22" },
];

// The suite runs in node, so localStorage is stood in for the same way the storage tests do.
const backing = new Map<string, string>();

beforeEach(() => {
  resetTeamRankingsStore();
  backing.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => {
      backing.set(key, value);
    },
    removeItem: (key: string) => {
      backing.delete(key);
    },
  });
});

describe("moving the pool into the store", () => {
  it("carries what localStorage had, then clears it", async () => {
    const io = fakeIo({}, { [TEAMS_KEY]: { v: 2, r: [] }, [GAMES_KEY]: { v: 2, r: [] } });
    const filled = await fillPoolCache(io);

    expect(filled).not.toBeNull();
    expect(io.store.get(TEAMS_KEY)).toEqual({ v: 2, r: [] });
    // Left behind, the old copy would go on occupying the quota this was done to escape.
    expect(io.local[TEAMS_KEY]).toBeUndefined();
    expect(io.local[GAMES_KEY]).toBeUndefined();
  });

  it("leaves localStorage alone when the store already has a pool", async () => {
    const io = fakeIo({}, { [TEAMS_KEY]: { v: 2, r: ["local"] } });
    io.store.set(TEAMS_KEY, { v: 2, r: ["already here"] });

    const filled = await fillPoolCache(io);
    expect(filled?.get(TEAMS_KEY)).toEqual({ v: 2, r: ["already here"] });
    expect(io.local[TEAMS_KEY]).toEqual({ v: 2, r: ["local"] });
  });

  // Half in one store and half in another is worse than never having moved.
  it("abandons the whole move when a write will not land, and keeps localStorage", async () => {
    let writes = 0;
    const io = fakeIo(
      {
        set: async (key, value) => {
          writes += 1;
          if (writes > 1) return false;
          return Boolean(key) && Boolean(value);
        },
      },
      { [TEAMS_KEY]: { v: 2, r: [1] }, [GAMES_KEY]: { v: 2, r: [2] } }
    );

    expect(await fillPoolCache(io)).toBeNull();
    expect(io.local[TEAMS_KEY]).toEqual({ v: 2, r: [1] });
    expect(io.local[GAMES_KEY]).toEqual({ v: 2, r: [2] });
  });

  it("is happy with nothing to carry", async () => {
    const io = fakeIo();
    const filled = await fillPoolCache(io);
    expect(filled).not.toBeNull();
    expect(filled?.get(TEAMS_KEY)).toBeNull();
    expect(io.store.size).toBe(0);
  });
});

describe("the pool once the store is in use", () => {
  it("reads back what it was given", async () => {
    const io = fakeIo();
    await initTeamRankingsStore(io);

    expect(saveScoutTeams(teams)).toBe(true);
    expect(saveScoutGames(games)).toBe(true);
    expect(loadScoutTeams()).toEqual(teams);
    expect(loadScoutGames()).toEqual(games);
  });

  // The write goes out behind the caller, so the value has to be readable the moment it is set.
  it("does not wait for the write to answer a read", async () => {
    const io = fakeIo({
      set: () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(true), 50);
        }),
    });
    await initTeamRankingsStore(io);

    saveScoutTeams(teams);
    expect(loadScoutTeams()).toEqual(teams);
  });

  it("keeps using localStorage when the store cannot be had", async () => {
    // No io and no IndexedDB in this environment: the old path, unchanged.
    await initTeamRankingsStore();
    expect(saveScoutTeams(teams)).toBe(true);
    expect(loadScoutTeams()).toEqual(teams);
    expect(localStorage.getItem(TEAMS_KEY)).not.toBeNull();
  });

  it("carries a pool already in localStorage across into the store", async () => {
    // Saved the old way first…
    saveScoutTeams(teams);
    saveScoutGames(games);
    expect(localStorage.getItem(TEAMS_KEY)).not.toBeNull();

    const io = fakeIo();
    io.readLocal = (key) => {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as unknown) : null;
    };
    io.clearLocal = (key) => localStorage.removeItem(key);
    await initTeamRankingsStore(io);

    // …and found again after the move, with localStorage freed.
    expect(loadScoutTeams()).toEqual(teams);
    expect(loadScoutGames()).toEqual(games);
    expect(localStorage.getItem(TEAMS_KEY)).toBeNull();
  });
});

describe("a browser without IndexedDB", () => {
  it("says so rather than pretending", () => {
    // Node has none, which stands in for the private-window case this must survive.
    expect(idbAvailable()).toBe(false);
  });

  it("hands back no database instead of throwing", async () => {
    await expect(openPoolDb()).resolves.toBeNull();
  });

  it("starts up without complaint", async () => {
    await expect(initTeamRankingsStore()).resolves.toBeUndefined();
  });
});
