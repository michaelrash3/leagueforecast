import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgeGroup, ScoutGame } from "../teamRankings";
import { encodeScoutGames } from "../teamRankingsCompact";
import {
  clearTeamRankings,
  initTeamRankingsStore,
  loadScoutGames,
  loadScoutGamesForGroups,
  loadScoutGamesForYear,
  notePoolChangedElsewhere,
  resetTeamRankingsStore,
  replaceScoutGames,
  saveAgeGroups,
  saveScoutGames,
  saveScoutGamesForYear,
  storedGamesByYear,
  type PoolStoreIo,
} from "../teamRankingsStorage";

/**
 * The games are stored one key per squad year, so the season on screen can be decoded without
 * the seasons that are not. These pin what that must never break: a save of one year cannot
 * touch another, a game filed under another year's page lands there, a pool written the old way
 * is moved across whole, and a reset takes every year with it.
 */

const LEGACY_KEY = "league_forecast_scout_games_v1";
const INDEX_KEY = "league_forecast_scout_games_v2_index";
const shardKey = (label: string) => `league_forecast_scout_games_v2:${label}`;

const groups: AgeGroup[] = [
  { id: "u10_2026", name: "10U 2026", ageLevel: 10, year: 2026, seasonIds: ["s1"] },
  { id: "u10_2027", name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] },
  { id: "loose", name: "Loose", seasonIds: [] },
];
const game = (id: string, ageGroupId: string): ScoutGame => ({
  id,
  ageGroupId,
  teamAId: "A",
  teamBId: "B",
  teamAScore: 5,
  teamBScore: 3,
  date: "2026-09-12",
});
const a26 = game("a26", "u10_2026");
const b26 = game("b26", "u10_2026");
const a27 = game("a27", "u10_2027");
const loose = game("loose", "loose");
const orphan = game("orphan", "gone");

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

const idbIo = () => {
  const store = new Map<string, unknown>();
  const io: PoolStoreIo & { store: Map<string, unknown> } = {
    store,
    keys: async () => [...store.keys()],
    get: async (key) => store.get(key) ?? null,
    set: async (key, value) => {
      store.set(key, value);
      return true;
    },
    readLocal: () => null,
    clearLocal: () => {},
  };
  return io;
};

const ids = (games: ScoutGame[]) => games.map((entry) => entry.id);

describe("games stored by squad year", () => {
  it("files a whole save by year and reads it back whole, years first and the yearless last", () => {
    saveAgeGroups(groups);
    expect(saveScoutGames([loose, a27, orphan, a26, b26]).written).toBe(true);

    expect(ids(loadScoutGames())).toEqual(["a26", "b26", "a27", "loose", "orphan"]);
    expect(ids(loadScoutGamesForYear(2026))).toEqual(["a26", "b26"]);
    expect(ids(loadScoutGamesForYear(2027))).toEqual(["a27"]);
    expect(ids(loadScoutGamesForYear(undefined))).toEqual(["loose", "orphan"]);
    expect(JSON.parse(backing.get(INDEX_KEY)!)).toEqual(["2026", "2027", "none"]);
    expect(backing.has(LEGACY_KEY)).toBe(false);
  });

  it("saves one year without touching what the others hold", async () => {
    const io = idbIo();
    await initTeamRankingsStore(io);
    saveAgeGroups(groups);
    saveScoutGames([a26, b26, a27]);
    const stored2027 = io.store.get(shardKey("2027"));

    expect(saveScoutGamesForYear(2026, [a26])).toBe(true);

    expect(ids(loadScoutGamesForYear(2026))).toEqual(["a26"]);
    expect(ids(loadScoutGamesForYear(2027))).toEqual(["a27"]);
    // Not rewritten, not even re-encoded: the very value that was there.
    expect(io.store.get(shardKey("2027"))).toBe(stored2027);
  });

  it("files a game handed in under another year's page in that year, over its stored copy", () => {
    saveAgeGroups(groups);
    saveScoutGames([a26, a27]);
    const moved: ScoutGame = { ...a27, teamAScore: 9 };

    // The 2026 page saves its list; one of the games on it is a 2027 game.
    saveScoutGamesForYear(2026, [a26, moved]);

    expect(ids(loadScoutGamesForYear(2026))).toEqual(["a26"]);
    expect(loadScoutGamesForYear(2027)).toEqual([moved]);
  });

  /*
   * This used to drop the year, and that was the bug rather than the feature.
   *
   * "The whole pool" is a claim about the caller, not something the array can say for itself, and
   * the save took it on trust: a caller handed an empty array by a wiring mistake deleted every
   * squad year and was told it had succeeded. So a year the save has nothing for is now left as
   * it was unless the save names it, and the save reports the ones it spared.
   */
  it("leaves a year a whole save has nothing for, and says which", () => {
    saveAgeGroups(groups);
    saveScoutGames([a26, a27]);

    const write = saveScoutGames([a26]);

    expect(write.spared).toEqual([2027]);
    expect(ids(loadScoutGames())).toEqual(["a26", "a27"]);
    expect(JSON.parse(backing.get(INDEX_KEY)!)).toEqual(["2026", "2027"]);
  });

  it("empties a year the save names, and only that one", () => {
    saveAgeGroups(groups);
    saveScoutGames([a26, a27, loose]);

    const write = saveScoutGames([a26], [2027]);

    expect(write).toEqual({ written: true, spared: [undefined] });
    expect(backing.has(shardKey("2027"))).toBe(false);
    // The yearless shard was not named and so is still there, untouched.
    expect(ids(loadScoutGames())).toEqual(["a26", "loose"]);
  });

  it("keeps nothing back from a save that holds every year", () => {
    saveAgeGroups(groups);
    saveScoutGames([a26, a27, loose]);

    // What a tidy, a merge or a pull does: the whole pool in, the whole pool out.
    const write = saveScoutGames([{ ...a26, teamAScore: 9 }, a27, loose]);

    expect(write).toEqual({ written: true, spared: [] });
    expect(loadScoutGamesForYear(2026)).toEqual([{ ...a26, teamAScore: 9 }]);
  });

  it("saves nothing at all over a pool and leaves every year standing", () => {
    saveAgeGroups(groups);
    saveScoutGames([a26, a27, loose]);

    // The shape of the bug: a caller seeded from a pool it was never given, saving its nothing.
    const write = saveScoutGames([]);

    expect(write.spared).toEqual([2026, 2027, undefined]);
    expect(ids(loadScoutGames())).toEqual(["a26", "a27", "loose"]);
  });

  it("lets a restore replace the pool outright, emptying what the file has nothing for", () => {
    saveAgeGroups(groups);
    saveScoutGames([a26, a27, loose]);

    // A backup is the pool now, so a year it has no games for is meant to go.
    expect(replaceScoutGames([a26])).toBe(true);

    expect(backing.has(shardKey("2027"))).toBe(false);
    expect(JSON.parse(backing.get(INDEX_KEY)!)).toEqual(["2026"]);
    expect(ids(loadScoutGames())).toEqual(["a26"]);
  });

  it("hands back the caller's own array for the year it just saved", async () => {
    // On IndexedDB, where the cache holds one value per key; localStorage re-parses every read.
    await initTeamRankingsStore(idbIo());
    saveAgeGroups(groups);
    const list = [a26, b26];
    saveScoutGamesForYear(2026, list);
    expect(loadScoutGamesForYear(2026)).toBe(list);
    expect(loadScoutGamesForYear(2026)).toBe(list);
  });

  it("moves a group's games to the year it was moved to", () => {
    saveAgeGroups(groups);
    saveScoutGames([a26, b26, a27]);

    saveAgeGroups(
      groups.map((group) => (group.id === "u10_2026" ? { ...group, year: 2025 } : group))
    );

    expect(ids(loadScoutGamesForYear(2025))).toEqual(["a26", "b26"]);
    expect(loadScoutGamesForYear(2026)).toEqual([]);
    expect(ids(loadScoutGamesForYear(2027))).toEqual(["a27"]);
    expect(JSON.parse(backing.get(INDEX_KEY)!)).toEqual(["2025", "2027"]);
  });

  it("files a deleted group's games with the yearless, where nothing shows them but nothing loses them", () => {
    saveAgeGroups(groups);
    saveScoutGames([a26, a27]);
    saveAgeGroups(groups.filter((group) => group.id !== "u10_2027"));
    expect(ids(loadScoutGamesForYear(undefined))).toEqual(["a27"]);
    expect(ids(loadScoutGames())).toEqual(["a26", "a27"]);
  });

  it("reads the years a season's age groups sit in, and no other", () => {
    saveAgeGroups(groups);
    saveScoutGames([a26, b26, a27, loose]);
    expect(ids(loadScoutGamesForGroups(["u10_2026"]))).toEqual(["a26", "b26"]);
    expect(ids(loadScoutGamesForGroups(["u10_2027", "loose"]))).toEqual(["a27", "loose"]);
    expect(loadScoutGamesForGroups(["nobody"])).toEqual([]);
  });

  it("counts what each year holds without decoding it", () => {
    saveAgeGroups(groups);
    saveScoutGames([a26, b26, { ...a27, teamAId: "C", teamBId: "D" }, loose]);
    expect(storedGamesByYear()).toEqual([
      { year: 2026, games: 2, teams: 2 },
      { year: 2027, games: 1, teams: 2 },
      { year: undefined, games: 1, teams: 2 },
    ]);
  });

  it("is taken whole by a reset", () => {
    saveAgeGroups(groups);
    saveScoutGames([a26, a27]);
    expect(clearTeamRankings()).toBe(true);
    expect(loadScoutGames()).toEqual([]);
    expect(backing.has(shardKey("2026"))).toBe(false);
    expect(backing.has(INDEX_KEY)).toBe(false);
  });
});

describe("a pool written before the years were split", () => {
  it("is moved across on startup, and the old key emptied only once every year has landed", async () => {
    const io = idbIo();
    io.store.set("league_forecast_scout_age_groups_v1", groups);
    io.store.set(LEGACY_KEY, encodeScoutGames([a26, a27, loose]));
    await initTeamRankingsStore(io);

    expect(io.store.get(LEGACY_KEY)).toBeNull();
    expect(io.store.get(INDEX_KEY)).toEqual(["2026", "2027", "none"]);
    expect(ids(loadScoutGamesForYear(2027))).toEqual(["a27"]);
    expect(ids(loadScoutGames())).toEqual(["a26", "a27", "loose"]);
  });

  it("stays where it was when a year will not write, and is read from there", async () => {
    const io = idbIo();
    io.store.set("league_forecast_scout_age_groups_v1", groups);
    io.store.set(LEGACY_KEY, encodeScoutGames([a26, a27]));
    io.set = async (key, value) => {
      if (key === shardKey("2027")) return false;
      io.store.set(key, value);
      return true;
    };
    await initTeamRankingsStore(io);

    // Nothing was let go of: the old value is still the pool, and every game is still read.
    expect(io.store.get(LEGACY_KEY)).not.toBeNull();
    expect(ids(loadScoutGames()).sort()).toEqual(["a26", "a27"]);
    expect(ids(loadScoutGamesForYear(2027))).toEqual(["a27"]);
  });

  it("is moved across on localStorage the first time anything reads it", () => {
    saveAgeGroups(groups);
    backing.set(LEGACY_KEY, JSON.stringify(encodeScoutGames([a26, a27])));
    expect(ids(loadScoutGamesForYear(2026))).toEqual(["a26"]);
    expect(backing.has(LEGACY_KEY)).toBe(false);
    expect(JSON.parse(backing.get(INDEX_KEY)!)).toEqual(["2026", "2027"]);
  });
});

describe("two tabs on the years", () => {
  it("takes in a year another tab wrote, index and all", async () => {
    const io = idbIo();
    await initTeamRankingsStore(io);
    saveAgeGroups(groups);
    saveScoutGames([a26]);

    // The other tab writes 2027 straight into the store and says so, key by key.
    io.store.set(shardKey("2027"), encodeScoutGames([a27]));
    io.store.set(INDEX_KEY, ["2026", "2027"]);
    await notePoolChangedElsewhere(shardKey("2027"));
    await notePoolChangedElsewhere(INDEX_KEY);

    expect(ids(loadScoutGamesForYear(2027))).toEqual(["a27"]);
    expect(ids(loadScoutGames())).toEqual(["a26", "a27"]);
  });
});
