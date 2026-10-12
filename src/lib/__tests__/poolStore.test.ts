import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fillPoolCache,
  initTeamRankingsStore,
  loadScoutGames,
  loadScoutTeams,
  notePoolChangedElsewhere,
  onPoolChangedElsewhere,
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

  it("leaves a key alone when the store already has it", async () => {
    const io = fakeIo({}, { [TEAMS_KEY]: { v: 2, r: ["local"] } });
    io.store.set(TEAMS_KEY, { v: 2, r: ["already here"] });

    const filled = await fillPoolCache(io);
    expect(filled?.get(TEAMS_KEY)).toEqual({ v: 2, r: ["already here"] });
    expect(io.local[TEAMS_KEY]).toEqual({ v: 2, r: ["local"] });
  });

  /**
   * Per key, not per store. A key is cleared from localStorage only once the store has it, so a
   * key is never in neither place; one that will not write stays where it is and is carried next
   * time. Gating the whole move on an empty store instead meant a half-finished migration was
   * never retried, and the keys left behind became unreachable for good.
   */
  it("keeps a key that will not write, and carries the ones that will", async () => {
    let writes = 0;
    const io = fakeIo({}, { [TEAMS_KEY]: { v: 2, r: [1] }, [GAMES_KEY]: { v: 2, r: [2] } });
    // The first write lands; everything after it is refused, as a quota abort would be.
    io.set = async (key, value) => {
      writes += 1;
      if (writes > 1) return false;
      io.store.set(key, value);
      return true;
    };

    const filled = await fillPoolCache(io);
    // The one that landed is in the store and gone from localStorage.
    expect(io.store.get(TEAMS_KEY)).toEqual({ v: 2, r: [1] });
    expect(io.local[TEAMS_KEY]).toBeUndefined();
    // The one that did not is still where it was, and still readable.
    expect(io.local[GAMES_KEY]).toEqual({ v: 2, r: [2] });
    expect(filled?.get(GAMES_KEY)).toEqual({ v: 2, r: [2] });
  });

  it("carries a key left behind by an earlier half-finished move", async () => {
    const io = fakeIo({}, { [GAMES_KEY]: { v: 2, r: [2] } });
    io.store.set(TEAMS_KEY, { v: 2, r: [1] });

    await fillPoolCache(io);
    expect(io.store.get(GAMES_KEY)).toEqual({ v: 2, r: [2] });
    expect(io.local[GAMES_KEY]).toBeUndefined();
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
    expect(saveScoutGames(games).written).toBe(true);
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

describe("two tabs on one pool", () => {
  it("tells a listener when another tab changes a key", async () => {
    const io = fakeIo();
    await initTeamRankingsStore(io);
    let told = 0;
    onPoolChangedElsewhere(() => {
      told += 1;
    });

    // What the channel's message handler does when the other tab says a key moved.
    await notePoolChangedElsewhere(TEAMS_KEY);
    expect(told).toBe(1);
  });

  it("re-reads the key before telling anyone, so a listener sees the new value", async () => {
    const io = fakeIo();
    await initTeamRankingsStore(io);
    let seen: ScoutTeam[] = [];
    onPoolChangedElsewhere(() => {
      seen = loadScoutTeams();
    });

    // The other tab's write, landing in the store this tab shares but not in its cache.
    io.store.set(TEAMS_KEY, { v: 2, r: [["S-OTHER", "Someone else"]] });
    await notePoolChangedElsewhere(TEAMS_KEY);

    // Told first and re-read second would hand the listener the pool from before the change, which
    // is the stale copy this whole mechanism exists to stop being written back.
    expect(seen.map((team) => team.name)).toEqual(["Someone else"]);
  });

  it("does not tell a listener about this tab's own writes", async () => {
    const io = fakeIo();
    await initTeamRankingsStore(io);
    let told = 0;
    onPoolChangedElsewhere(() => {
      told += 1;
    });

    saveScoutTeams(teams);
    // The caller made this change and already has the value; sending it back would be a loop.
    expect(told).toBe(0);
  });

  it("stops telling a listener that has unsubscribed", async () => {
    const io = fakeIo();
    await initTeamRankingsStore(io);
    let told = 0;
    const stop = onPoolChangedElsewhere(() => {
      told += 1;
    });

    stop();
    await notePoolChangedElsewhere(TEAMS_KEY);
    expect(told).toBe(0);
  });

  it("keeps telling the others when one listener throws", async () => {
    const io = fakeIo();
    await initTeamRankingsStore(io);
    let told = 0;
    onPoolChangedElsewhere(() => {
      throw new Error("this view cannot cope");
    });
    onPoolChangedElsewhere(() => {
      told += 1;
    });

    await notePoolChangedElsewhere(TEAMS_KEY);
    expect(told).toBe(1);
  });
});
