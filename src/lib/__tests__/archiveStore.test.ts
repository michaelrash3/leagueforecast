import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearTeamRankings,
  forgetArchivedSeason,
  initTeamRankingsStore,
  loadArchiveIndex,
  loadArchivedSeason,
  notePoolChangedElsewhere,
  resetTeamRankingsStore,
  saveArchivedSeasons,
  saveScoutTeams,
  type PoolStoreIo,
} from "../teamRankingsStorage";
import { ARCHIVE_VERSION, type ArchivedSeason } from "../teamRankingsArchive";

const ARCHIVE_KEY = "league_forecast_scout_archive_v1";
const ROWS_PREFIX = "league_forecast_scout_archive_rows_v1:";
const TEAMS_KEY = "league_forecast_scout_teams_v1";

const fakeIo = (
  overrides: Partial<PoolStoreIo> = {}
): PoolStoreIo & { store: Map<string, unknown> } => {
  const store = new Map<string, unknown>();
  return {
    store,
    keys: async () => [...store.keys()],
    get: async (key) => store.get(key) ?? null,
    set: async (key, value) => {
      store.set(key, value);
      return true;
    },
    readLocal: () => null,
    clearLocal: () => {},
    ...overrides,
  };
};

/** A season of the size that matters: the rows are the reason any of this is on demand. */
const season = (name: string, year: number, rows = 3): ArchivedSeason => ({
  version: ARCHIVE_VERSION,
  id: `arc_${year}_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
  name,
  ageLevel: 9,
  year,
  archivedAt: "2026-09-17T00:00:00.000Z",
  fromGames: rows * 4,
  fromTeams: rows,
  rows: Array.from({ length: rows }, (_unused, at) => ({
    rank: at + 1,
    teamName: `Club ${at}`,
    rating: 5 - at,
    record: "4-1",
    wins: 4,
    losses: 1,
    ties: 0,
    games: 5,
    strengthOfSchedule: 0.5,
    sosRank: at + 1,
    state: "KY",
    ageLevel: 9,
    crossAgeGames: 0,
  })),
});

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

describe("keeping an archive where it does not cost anything to have", () => {
  it("lists without loading, and loads when asked", async () => {
    const io = fakeIo();
    await initTeamRankingsStore(io);
    const stored = await saveArchivedSeasons([season("9U 2026", 2026)]);
    expect(stored).not.toBeNull();

    // The index is what loaded with the pool: names and counts, no rows anywhere in it.
    const index = loadArchiveIndex();
    expect(index).toHaveLength(1);
    expect(index[0]!.name).toBe("9U 2026");
    expect(index[0]!.teams).toBe(3);
    expect(JSON.stringify(index)).not.toContain("Club 0");

    const loaded = await loadArchivedSeason(stored![0]!.id);
    expect(loaded?.rows.map((row) => row.teamName)).toEqual(["Club 0", "Club 1", "Club 2"]);
  });

  it("keeps the rows out of the cache the whole pool sits in", async () => {
    const io = fakeIo();
    await initTeamRankingsStore(io);
    const stored = await saveArchivedSeasons([season("9U 2026", 2026)]);
    const key = `${ROWS_PREFIX}${stored![0]!.id}`;

    // Written straight to the store, and the index separately — so a tab that never asks for the
    // rows never holds them.
    expect(io.store.has(key)).toBe(true);
    expect(io.store.get(ARCHIVE_KEY)).toHaveLength(1);
  });

  it("is not pulled into memory just because another tab wrote it", async () => {
    const io = fakeIo();
    await initTeamRankingsStore(io);
    const stored = await saveArchivedSeasons([season("9U 2026", 2026)]);
    const key = `${ROWS_PREFIX}${stored![0]!.id}`;
    const reads: string[] = [];
    io.get = async (asked) => {
      reads.push(asked);
      return io.store.get(asked) ?? null;
    };

    // A blob's key is never broadcast, but hearing about one must not load it either: the cache is
    // what every tab keeps for as long as it is open.
    await notePoolChangedElsewhere(key);
    expect(reads).toEqual([]);
    // A pool key still re-reads, which is the point of the notification.
    await notePoolChangedElsewhere(TEAMS_KEY);
    expect(reads).toEqual([TEAMS_KEY]);
  });

  it("gives a name already archived a fresh id rather than overwriting it", async () => {
    const io = fakeIo();
    await initTeamRankingsStore(io);
    const first = await saveArchivedSeasons([season("9U 2026", 2026)]);
    const again = await saveArchivedSeasons([season("9U 2026", 2026, 5)]);

    expect(again![0]!.id).not.toBe(first![0]!.id);
    expect(loadArchiveIndex().map((entry) => entry.teams)).toEqual([3, 5]);
    // The older freeze is still readable, and still has its own rows.
    expect((await loadArchivedSeason(first![0]!.id))?.rows).toHaveLength(3);
    expect((await loadArchivedSeason(again![0]!.id))?.rows).toHaveLength(5);
  });

  it("writes nothing at all when a blob refuses, so a delete cannot follow it", async () => {
    const io = fakeIo({
      set: async (key, value) => {
        // The second season's rows will not go; the first's already have.
        if (key === `${ROWS_PREFIX}arc_2026_10u_2026`) return false;
        io.store.set(key, value);
        return true;
      },
    });
    await initTeamRankingsStore(io);
    const done = await saveArchivedSeasons([season("9U 2026", 2026), season("10U 2026", 2026)]);

    expect(done).toBeNull();
    expect(loadArchiveIndex()).toEqual([]);
    // And the one that did write is taken back out, rather than left as a half-archive.
    expect(io.store.get(`${ROWS_PREFIX}arc_2026_9u_2026`)).toBeNull();
  });

  it("does nothing, successfully, for nothing to archive", async () => {
    const io = fakeIo();
    await initTeamRankingsStore(io);
    expect(await saveArchivedSeasons([])).toEqual([]);
    expect(io.store.get(ARCHIVE_KEY) ?? null).toBeNull();
  });

  it("drops an archive's rows and its line together", async () => {
    const io = fakeIo();
    await initTeamRankingsStore(io);
    const stored = await saveArchivedSeasons([season("9U 2026", 2026), season("10U 2026", 2026)]);
    expect(await forgetArchivedSeason(stored![0]!.id)).toBe(true);

    expect(loadArchiveIndex().map((entry) => entry.name)).toEqual(["10U 2026"]);
    expect(await loadArchivedSeason(stored![0]!.id)).toBeNull();
    expect(await loadArchivedSeason(stored![1]!.id)).not.toBeNull();
  });

  it("takes the rows with it on a reset, rather than orphaning them", async () => {
    const io = fakeIo();
    await initTeamRankingsStore(io);
    const stored = await saveArchivedSeasons([season("9U 2026", 2026)]);
    saveScoutTeams([{ id: "S-A", name: "Aces" }]);

    expect(clearTeamRankings()).toBe(true);
    expect(loadArchiveIndex()).toEqual([]);
    // The rows do not live in a pool key, so walking POOL_KEYS alone would have left them behind
    // with nothing naming them: megabytes nothing can read or find again.
    expect(await loadArchivedSeason(stored![0]!.id)).toBeNull();
  });

  it("works with no IndexedDB at all, like the rest of the pool", async () => {
    // No store: the whole module falls back to localStorage, synchronously, and so does this.
    const stored = await saveArchivedSeasons([season("9U 2026", 2026)]);
    expect(stored).not.toBeNull();
    expect(loadArchiveIndex()).toHaveLength(1);
    expect((await loadArchivedSeason(stored![0]!.id))?.rows).toHaveLength(3);
    expect(await forgetArchivedSeason(stored![0]!.id)).toBe(true);
    expect(await loadArchivedSeason(stored![0]!.id)).toBeNull();
  });

  it("reads a damaged index as no archives rather than throwing", () => {
    backing.set(ARCHIVE_KEY, JSON.stringify([{ name: "no id" }, "nope", { id: "arc_1" }]));
    expect(loadArchiveIndex()).toEqual([]);
  });
});
