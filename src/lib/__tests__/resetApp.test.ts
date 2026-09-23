import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyPullRunLog } from "../pullTracker";
import { forgetAppKeys, resetApp } from "../resetApp";
import {
  clearTeamRankings,
  initTeamRankingsStore,
  loadAgelessCleared,
  loadAgeUnknown,
  loadDeletedGames,
  loadDroppedClubs,
  loadKeptApart,
  loadNamedAges,
  loadOrgMembership,
  loadPullLog,
  loadScoutTeams,
  loadTooYoungClubs,
  resetTeamRankingsStore,
  saveAgelessCleared,
  saveAgeUnknown,
  saveDeletedGames,
  saveDroppedClubs,
  saveKeptApart,
  saveNamedAges,
  saveOrgMembership,
  savePullLog,
  saveScoutTeams,
  saveTooYoungClubs,
  type PoolStoreIo,
} from "../teamRankingsStorage";

/** A `Storage` over a map, with the `length` and `key` a walk of every key needs. */
const backing = new Map<string, string>();
const fakeStorage = {
  get length() {
    return backing.size;
  },
  key: (at: number) => [...backing.keys()][at] ?? null,
  getItem: (key: string) => backing.get(key) ?? null,
  setItem: (key: string, value: string) => {
    backing.set(key, value);
  },
  removeItem: (key: string) => {
    backing.delete(key);
  },
  clear: () => backing.clear(),
} as Storage;

beforeEach(() => {
  resetTeamRankingsStore();
  backing.clear();
  vi.stubGlobal("localStorage", fakeStorage);
});

/** Every decision Team Rankings keeps about the world, filled in so a reset has them to forget. */
const fillDecisions = async () => {
  saveScoutTeams([{ id: "S-ICEC", name: "Ice Cats" }]);
  saveDroppedClubs(new Set(["gcTHROWNOUT1"]));
  saveDeletedGames(new Set(["gc_gcX_game1"]));
  saveKeptApart(new Set(["gcA|gcB"]));
  saveTooYoungClubs(new Set(["gcTOOYOUNG01"]));
  saveNamedAges(
    new Map([["gcNAMED00001", { teamId: "gcNAMED00001", level: 9, namedAt: "2026-09-20" }]])
  );
  saveOrgMembership({
    orgs: [{ orgId: "orgENA000001", name: "ENA 8U Fall 2026", teamIds: ["gcPISTONS001"] }],
    savedAt: "2026-09-22T12:00:00.000Z",
  });
  saveAgeUnknown([
    { teamId: "gcEAGLES0001", firstSeen: "2026-09-20", lastTried: "2026-09-21", tries: 1 },
  ]);
  await saveAgelessCleared({
    version: 1,
    clearedAt: "2026-09-22",
    rows: [
      {
        entry: {
          teamId: "gcCLEARED001",
          firstSeen: "2026-09-20",
          lastTried: "2026-09-21",
          tries: 1,
        },
        why: "not-youth",
      },
    ],
  });
  await savePullLog(emptyPullRunLog("2026-09-22T12:00:00.000Z"));
};

describe("resetting Team Rankings", () => {
  it("forgets every decision along with the pool", async () => {
    await fillDecisions();
    // Read back first, so the emptiness checked below is the reset's doing and not a save that
    // never landed.
    expect(await loadAgelessCleared()).not.toBeNull();
    expect(await loadPullLog()).not.toBeNull();
    expect(clearTeamRankings()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loadScoutTeams()).toEqual([]);
    expect(loadDroppedClubs().size).toBe(0);
    expect(loadDeletedGames().size).toBe(0);
    expect(loadKeptApart().size).toBe(0);
    expect(loadTooYoungClubs().size).toBe(0);
    expect(loadNamedAges().size).toBe(0);
    expect(loadOrgMembership().orgs).toEqual([]);
    expect(loadAgeUnknown()).toEqual([]);
    expect(await loadAgelessCleared()).toBeNull();
    expect(await loadPullLog()).toBeNull();
  });
});

describe("resetting the whole app", () => {
  it("leaves nothing of the app's in this browser, and everything that is not the app's", async () => {
    await fillDecisions();
    backing.set("league_seasons_v2", JSON.stringify([{ id: "fall2026", name: "Fall 2026" }]));
    backing.set("league_active_season_v2", JSON.stringify("fall2026"));
    backing.set("league_season_fall2026_teams_v2", JSON.stringify([{ id: "t1" }]));
    backing.set("lf_app_mode_v1", JSON.stringify("rankings"));
    backing.set("nkb_theme_v1", JSON.stringify("dark"));
    backing.set("league_forecast_last_backup_v1", JSON.stringify({ league: "2026-09-01" }));
    backing.set("league_forecast_diagnostics_v1", JSON.stringify([]));
    backing.set("some_other_site_thing", "keep me");

    expect(await resetApp(fakeStorage)).toBe("done");
    expect([...backing.keys()]).toEqual(["some_other_site_thing"]);
  });

  /** An IndexedDB-shaped store over a map; `refuse` names keys whose removal silently fails. */
  const mapIo = (store: Map<string, unknown>, refuse = new Set<string>()): PoolStoreIo => ({
    keys: async () => [...store.keys()],
    get: async (key) => store.get(key) ?? null,
    set: async (key, value) => {
      store.set(key, value);
      return true;
    },
    remove: async (key) => {
      if (!refuse.has(key)) store.delete(key);
    },
    readLocal: () => null,
    clearLocal: () => {},
  });

  it("empties the pool's IndexedDB store of every key, named or not", async () => {
    const store = new Map<string, unknown>();
    await initTeamRankingsStore(mapIo(store));
    await fillDecisions();
    // A key an older version wrote and this one no longer names.
    store.set("league_forecast_something_retired_v0", { old: true });

    expect(await resetApp(fakeStorage)).toBe("done");
    expect([...store.keys()]).toEqual([]);
    expect(loadScoutTeams()).toEqual([]);
  });

  it("says so, and leaves League Standings, when the store keeps part of the pool", async () => {
    const store = new Map<string, unknown>();
    const stuck = "league_forecast_something_retired_v0";
    await initTeamRankingsStore(mapIo(store, new Set([stuck])));
    store.set(stuck, { old: true });
    backing.set("league_seasons_v2", JSON.stringify([{ id: "fall2026", name: "Fall 2026" }]));

    expect(await resetApp(fakeStorage)).toBe("incomplete");
    expect(backing.has("league_seasons_v2")).toBe(true);
  });

  it("clears nothing at all when the pool's store cannot be reached", async () => {
    // The note says the pool moved to IndexedDB, and this browser has none to open.
    backing.set("league_forecast_pool_in_idb_v1", "1");
    backing.set("league_seasons_v2", JSON.stringify([{ id: "fall2026", name: "Fall 2026" }]));
    await initTeamRankingsStore();
    expect(await resetApp(fakeStorage)).toBe("unreachable");
    expect(backing.has("league_seasons_v2")).toBe(true);
  });

  it("counts what it removed", () => {
    backing.set("league_seasons_v2", "[]");
    backing.set("lf_summary_mode_v1", "1");
    backing.set("unrelated", "1");
    expect(forgetAppKeys(fakeStorage)).toBe(2);
  });
});
