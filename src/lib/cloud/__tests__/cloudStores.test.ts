import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyCloudPoolValues,
  cloudPoolKeys,
  initTeamRankingsStore,
  onCloudPoolWrite,
  poolHoldsNoTeams,
  readCloudPoolValue,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveArchivedSeasons,
  savePullProgress,
  saveScoutGames,
  saveScoutTeams,
  type PoolStoreIo,
} from "../../teamRankingsStorage";
import { onLeagueWrite, readLeagueSnapshot, saveTeams, saveUndoSnapshot } from "../../storage";
import { ARCHIVE_VERSION, type ArchivedSeason } from "../../teamRankingsArchive";
import { appLocalSource, LEAGUE_PART, localHoldsNothing } from "../cloudLocal";
import type { GcPullProgress } from "../../gameChangerPull";

/*
 * The cloud copy against the app's own stores: which keys travel, which stay on the device that
 * wrote them, that a write to one is noticed, and that a copy from the cloud lands where the app
 * reads it.
 */
const TEAMS_KEY = "league_forecast_scout_teams_v1";
const PULL_KEY = "league_forecast_gc_pull_v1";
const INDEX_KEY = "league_forecast_scout_games_v2_index";
const SHARD_2027 = "league_forecast_scout_games_v2:2027";
const ARCHIVE_KEY = "league_forecast_scout_archive_v1";
const ROWS_PREFIX = "league_forecast_scout_archive_rows_v1:";

const fakeIo = (): PoolStoreIo & { store: Map<string, unknown> } => {
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
  };
};

const backing = new Map<string, string>();

beforeEach(() => {
  resetTeamRankingsStore();
  onCloudPoolWrite(null);
  onLeagueWrite(null);
  backing.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => void backing.set(key, value),
    removeItem: (key: string) => void backing.delete(key),
    key: (at: number) => [...backing.keys()][at] ?? null,
    get length() {
      return backing.size;
    },
  });
});

const archived: ArchivedSeason = {
  version: ARCHIVE_VERSION,
  id: "arc_2026_9u",
  name: "9U 2026",
  ageLevel: 9,
  year: 2026,
  archivedAt: "2026-09-17T00:00:00.000Z",
  fromGames: 4,
  fromTeams: 1,
  rows: [
    {
      rank: 1,
      teamName: "Club A",
      rating: 5,
      record: "4-0",
      wins: 4,
      losses: 0,
      ties: 0,
      games: 4,
      strengthOfSchedule: 0.5,
      sosRank: 1,
      state: "KY",
      ageLevel: 9,
      crossAgeGames: 0,
    },
  ],
};

const withPool = async () => {
  const io = fakeIo();
  await initTeamRankingsStore(io);
  saveAgeGroups([{ id: "ag9", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] }]);
  saveScoutTeams([
    { id: "a", name: "Hawks" },
    { id: "b", name: "Owls" },
  ]);
  saveScoutGames([{ id: "g1", ageGroupId: "ag9", teamAId: "a", teamBId: "b" }]);
  savePullProgress({ ids: ["x"], cursor: 0 } as unknown as GcPullProgress);
  await saveArchivedSeasons([archived]);
  return io;
};

describe("the keys a cloud copy holds", () => {
  it("are the pool's, each year's games and each archive's rows, but not a pull's place", async () => {
    await withPool();
    const keys = cloudPoolKeys();
    expect(keys).toEqual(
      expect.arrayContaining([
        TEAMS_KEY,
        INDEX_KEY,
        SHARD_2027,
        ARCHIVE_KEY,
        `${ROWS_PREFIX}arc_2026_9u`,
      ])
    );
    expect(keys).not.toContain(PULL_KEY);
    expect((await readCloudPoolValue(`${ROWS_PREFIX}arc_2026_9u`)) as ArchivedSeason).toMatchObject(
      {
        name: "9U 2026",
      }
    );
  });

  it("are noticed when written here, and a pull's place is not", async () => {
    await withPool();
    const noticed: string[] = [];
    onCloudPoolWrite((key) => noticed.push(key));
    saveScoutTeams([{ id: "a", name: "Hawks" }]);
    savePullProgress({ ids: ["y"], cursor: 1 } as unknown as GcPullProgress);
    expect(noticed).toEqual([TEAMS_KEY]);
  });
});

describe("a copy from the cloud", () => {
  it("lands in the store and in what the app reads, and a null takes a key away", async () => {
    const io = await withPool();
    const teams = await readCloudPoolValue(TEAMS_KEY);

    resetTeamRankingsStore();
    const fresh = fakeIo();
    await initTeamRankingsStore(fresh);
    expect(poolHoldsNoTeams()).toBe(true);
    const ok = await applyCloudPoolValues(
      new Map<string, unknown>([
        [TEAMS_KEY, teams],
        [`${ROWS_PREFIX}arc_2026_9u`, archived],
        // Never taken from a copy, whatever it holds.
        [PULL_KEY, { ids: ["theirs"] }],
      ])
    );
    expect(ok).toBe(true);
    expect(fresh.store.get(TEAMS_KEY)).toEqual(io.store.get(TEAMS_KEY));
    expect(await readCloudPoolValue(TEAMS_KEY)).toEqual(teams);
    expect(fresh.store.has(PULL_KEY)).toBe(false);
    expect(poolHoldsNoTeams()).toBe(false);

    await applyCloudPoolValues(new Map([[TEAMS_KEY, null]]));
    expect(cloudPoolKeys()).not.toContain(TEAMS_KEY);
  });
});

describe("League Standings in the cloud copy", () => {
  it("is noticed when a season changes, and not for an undo snapshot", () => {
    const noticed = vi.fn();
    onLeagueWrite(noticed);
    saveTeams([{ id: "t1", name: "Hawks" } as never]);
    expect(noticed).toHaveBeenCalled();
    noticed.mockClear();
    saveUndoSnapshot({ anything: true });
    expect(noticed).not.toHaveBeenCalled();
  });

  it("is not noticed for a write of what is already stored, as the app makes on opening", () => {
    saveTeams([{ id: "t1", name: "Hawks" } as never]);
    const noticed = vi.fn();
    onLeagueWrite(noticed);
    saveTeams([{ id: "t1", name: "Hawks" } as never]);
    expect(noticed).not.toHaveBeenCalled();
    saveTeams([{ id: "t1", name: "Owls" } as never]);
    expect(noticed).toHaveBeenCalledTimes(1);
  });

  it("travels as every season, and a malformed one is refused", async () => {
    saveTeams([{ id: "t1", name: "Hawks" } as never]);
    const snapshot = (await appLocalSource.read(LEAGUE_PART)) as ReturnType<
      typeof readLeagueSnapshot
    >;
    expect(snapshot.seasons[0]?.teams.map((team) => team.name)).toEqual(["Hawks"]);

    backing.clear();
    expect(readLeagueSnapshot().seasons[0]?.teams).toEqual([]);
    expect(await appLocalSource.apply(new Map([[LEAGUE_PART, snapshot]]))).toBe(true);
    expect(readLeagueSnapshot().seasons[0]?.teams.map((team) => team.name)).toEqual(["Hawks"]);

    expect(await appLocalSource.apply(new Map([[LEAGUE_PART, { nonsense: 1 }]]))).toBe(false);
    expect(readLeagueSnapshot().seasons[0]?.teams.map((team) => team.name)).toEqual(["Hawks"]);
  });

  it("refuses a copy whose seasons are malformed before writing any of its pool", async () => {
    await withPool();
    const before = await readCloudPoolValue(TEAMS_KEY);
    const ok = await appLocalSource.apply(
      new Map<string, unknown>([
        [LEAGUE_PART, { nonsense: 1 }],
        [TEAMS_KEY, null],
      ])
    );
    expect(ok).toBe(false);
    expect(await readCloudPoolValue(TEAMS_KEY)).toEqual(before);
  });

  it("counts toward whether this browser holds anything", async () => {
    const io = fakeIo();
    await initTeamRankingsStore(io);
    expect(localHoldsNothing()).toBe(true);
    saveTeams([{ id: "t1", name: "Hawks" } as never]);
    expect(localHoldsNothing()).toBe(false);
  });
});
