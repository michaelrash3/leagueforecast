import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyCloudPoolValues,
  cloudPoolKeys,
  initTeamRankingsStore,
  onCloudPoolWrite,
  flushPoolWrites,
  poolHoldsNoTeams,
  poolKeysNotStored,
  readCloudPoolValue,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveArchivedSeasons,
  savePullProgress,
  saveScoutGames,
  saveScoutTeams,
  type PoolStoreIo,
} from "../../teamRankingsStorage";
import {
  createSeason,
  deleteSeason,
  getActiveSeasonId,
  listSeasons,
  onLeagueWrite,
  readLeagueSnapshot,
  replaceLeagueSnapshot,
  saveTeams,
  saveUndoSnapshot,
  setActiveSeason,
} from "../../storage";
import { readOurTeam, writeOurTeam } from "../../preferences";
import { resetApp } from "../../resetApp";
import { markTaken, onStaleWrite, resetCloudGuard } from "../cloudGuard";
import { CLOUD_STATE_KEY, loadCloudState, markCloudDirty, owedChanges } from "../cloudState";
import { ARCHIVE_VERSION, type ArchivedSeason } from "../../teamRankingsArchive";
import { appLocalSource, LEAGUE_PART } from "../cloudLocal";
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
  resetCloudGuard();
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
      ])
    );
    expect(ok).toBe(true);
    expect(fresh.store.get(TEAMS_KEY)).toEqual(io.store.get(TEAMS_KEY));
    expect(await readCloudPoolValue(TEAMS_KEY)).toEqual(teams);
    expect(poolHoldsNoTeams()).toBe(false);

    await applyCloudPoolValues(new Map([[TEAMS_KEY, null]]));
    expect(cloudPoolKeys()).not.toContain(TEAMS_KEY);
  });

  it("is refused whole when it carries a key this build does not keep, before writing any", async () => {
    const io = await withPool();
    const teams = io.store.get(TEAMS_KEY);
    const pull = io.store.get(PULL_KEY);
    const ok = await applyCloudPoolValues(
      new Map<string, unknown>([
        [TEAMS_KEY, null],
        // A pull's place is never the copy's, and a newer build's key is none of this one's.
        [PULL_KEY, { ids: ["theirs"] }],
      ])
    );
    expect(ok).toBe(false);
    expect(await readCloudPoolValue(TEAMS_KEY)).not.toBeNull();
    expect(io.store.get(TEAMS_KEY)).toEqual(teams);
    expect(io.store.get(PULL_KEY)).toEqual(pull);
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
    expect(noticed).toHaveBeenCalled();
  });

  it("is not noticed when this device opens another season, which is its own affair", () => {
    const other = createSeason("Spring");
    const noticed = vi.fn();
    onLeagueWrite(noticed);
    setActiveSeason(other.id);
    expect(getActiveSeasonId()).toBe(other.id);
    expect(noticed).not.toHaveBeenCalled();
  });

  it("travels as every season, and a malformed one is refused", async () => {
    saveTeams([{ id: "t1", name: "Hawks" } as never]);
    const snapshot = (await appLocalSource.read(LEAGUE_PART)) as ReturnType<
      typeof readLeagueSnapshot
    >;
    expect(snapshot.seasons[0]?.teams.map((team) => team.name)).toEqual(["Hawks"]);
    // Which season a device has open is not the copy's.
    expect(snapshot).not.toHaveProperty("activeSeasonId");

    backing.clear();
    expect(readLeagueSnapshot().seasons[0]?.teams).toEqual([]);
    expect(await appLocalSource.apply(new Map([[LEAGUE_PART, snapshot]]))).toBe(true);
    expect(readLeagueSnapshot().seasons[0]?.teams.map((team) => team.name)).toEqual(["Hawks"]);

    expect(await appLocalSource.apply(new Map([[LEAGUE_PART, { nonsense: 1 }]]))).toBe(false);
    expect(readLeagueSnapshot().seasons[0]?.teams.map((team) => team.name)).toEqual(["Hawks"]);
  });

  it("keeps the season this device has open, and each season's last-changed time", async () => {
    const first = listSeasons()[0]!;
    const second = createSeason("Spring");
    setActiveSeason(second.id);
    saveTeams([{ id: "t2", name: "Owls" } as never]);
    const snapshot = (await appLocalSource.read(LEAGUE_PART)) as ReturnType<
      typeof readLeagueSnapshot
    >;
    const stamped = snapshot.seasons.find((season) => season.id === second.id)?.updatedAt;
    expect(stamped).toBeDefined();

    setActiveSeason(first.id);
    expect(await appLocalSource.apply(new Map([[LEAGUE_PART, snapshot]]))).toBe(true);
    expect(getActiveSeasonId()).toBe(first.id);
    expect(listSeasons().find((season) => season.id === second.id)?.updatedAt).toBe(stamped);
    // Read back, it is the same value it arrived as, so it is not a change to send again.
    expect(await appLocalSource.read(LEAGUE_PART)).toEqual(snapshot);
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

  it("leaves the seasons as they were when the copy's pool has a key this build does not keep", async () => {
    await withPool();
    saveTeams([{ id: "t1", name: "Hawks" } as never]);
    const snapshot = (await appLocalSource.read(LEAGUE_PART)) as ReturnType<
      typeof readLeagueSnapshot
    >;
    saveTeams([{ id: "t1", name: "Owls" } as never]);
    const ok = await appLocalSource.apply(
      new Map<string, unknown>([
        [LEAGUE_PART, snapshot],
        [PULL_KEY, { ids: ["theirs"] }],
      ])
    );
    expect(ok).toBe(false);
    expect(readLeagueSnapshot().seasons[0]?.teams.map((team) => team.name)).toEqual(["Owls"]);
  });

  it("counts as holding nothing until a season has anything in it", async () => {
    const io = fakeIo();
    await initTeamRankingsStore(io);
    expect(appLocalSource.empty("league")).toBe(true);
    expect(appLocalSource.empty("pool")).toBe(true);
    saveTeams([{ id: "t1", name: "Hawks" } as never]);
    expect(appLocalSource.empty("league")).toBe(false);
  });

  // A squad year archived, and its teams tidied away: the archive's tables cannot be made again,
  // so a pool that holds one is not nothing, and meeting a copy must keep it rather than drop it.
  it("counts a pool that holds only archived seasons as holding something", async () => {
    await initTeamRankingsStore(fakeIo());
    expect(appLocalSource.empty("pool")).toBe(true);
    await saveArchivedSeasons([archived]);
    expect(appLocalSource.empty("pool")).toBe(false);
  });

  it("keeps this device on its open season when a merge gave that season a new id", async () => {
    saveTeams([{ id: "t1", name: "Hawks" } as never]);
    const open = getActiveSeasonId();
    writeOurTeam(open, "t1");
    const snapshot = (await appLocalSource.read(LEAGUE_PART)) as ReturnType<
      typeof readLeagueSnapshot
    >;
    const moved = {
      seasons: snapshot.seasons.map((season) =>
        season.id === open ? { ...season, id: "season-7" } : season
      ),
    };
    expect(
      await appLocalSource.apply(new Map([[LEAGUE_PART, moved]]), {
        renamed: { [open]: "season-7" },
      })
    ).toBe(true);
    expect(getActiveSeasonId()).toBe("season-7");
    // What this device keeps of the season goes with it to its new id (`forgetSeasons`).
    expect(readOurTeam("season-7")).toBe("t1");
    expect(readOurTeam(open)).toBeNull();
  });
});

describe("the cloud copy's own values arriving", () => {
  it("are not changes made here, in the pool or the seasons", async () => {
    await withPool();
    saveTeams([{ id: "t1", name: "Hawks" } as never]);
    const arriving = {
      activeSeasonId: getActiveSeasonId(),
      seasons: readLeagueSnapshot().seasons.map((season) => ({
        ...season,
        teams: [{ id: "t1", name: "Owls" }],
      })),
    };
    const pool = vi.fn();
    const seasons = vi.fn();
    onCloudPoolWrite(pool);
    onLeagueWrite(seasons);
    await applyCloudPoolValues(new Map([[TEAMS_KEY, [["a", "Hawks"]]]]));
    replaceLeagueSnapshot(arriving, { fromCloud: true });
    expect(readLeagueSnapshot().seasons[0]?.teams.map((team) => team.name)).toEqual(["Owls"]);
    expect(pool).not.toHaveBeenCalled();
    expect(seasons).not.toHaveBeenCalled();
    // An edit a moment later is.
    saveTeams([{ id: "t9", name: "Wrens" } as never]);
    expect(seasons).toHaveBeenCalled();
  });
});

describe("a tab that read its data before another tab took a copy in", () => {
  it("may not write the seasons or the pool back over it, and is told to reload", async () => {
    await withPool();
    saveTeams([{ id: "t1", name: "Hawks" } as never]);
    const stale = vi.fn();
    onStaleWrite(stale);
    // Another tab takes a copy in: its token changes under this one.
    backing.set("league_forecast_cloud_taken_league", "another-tab");
    backing.set("league_forecast_cloud_taken_pool", "another-tab");
    const before = readLeagueSnapshot().seasons[0]?.teams;
    expect(saveTeams([{ id: "t1", name: "Stale" } as never])).toBe(false);
    expect(readLeagueSnapshot().seasons[0]?.teams).toEqual(before);
    expect(saveScoutTeams([{ id: "z", name: "Stale" }])).toBe(false);
    expect(stale).toHaveBeenCalledWith("league");
    expect(stale).toHaveBeenCalledWith("pool");
    onStaleWrite(null);
  });

  it("may not take a season's data away, nor file an archive's rows, over it either", async () => {
    const io = await withPool();
    const spring = createSeason("Spring");
    setActiveSeason(spring.id);
    saveTeams([{ id: "t1", name: "Hawks" } as never]);
    const teams = () =>
      readLeagueSnapshot().seasons.find((season) => season.id === spring.id)?.teams;
    const before = teams();
    backing.set("league_forecast_cloud_taken_league", "another-tab");
    backing.set("league_forecast_cloud_taken_pool", "another-tab");
    // The list of seasons cannot be written, and neither can the season's data be removed: a
    // season whose data went while the list kept naming it would open empty.
    deleteSeason(spring.id);
    expect(teams()).toEqual(before);
    expect(await saveArchivedSeasons([{ ...archived, id: "arc_2026_10u" }])).toBeNull();
    expect(io.store.has(`${ROWS_PREFIX}arc_2026_10u`)).toBe(false);
  });

  it("may still write after taking a copy in itself, before anything read it", () => {
    markTaken("league", true);
    expect(saveTeams([{ id: "t1", name: "Fresh" } as never])).toBe(true);
    markTaken("league", false);
    expect(saveTeams([{ id: "t1", name: "Stale" } as never])).toBe(false);
  });
});

describe("a pool write the store refuses", () => {
  it("is known, until a write of the key lands", async () => {
    const io = fakeIo();
    let refuse = true;
    await initTeamRankingsStore({
      ...io,
      set: async (key, value) => {
        if (refuse && key === TEAMS_KEY) return false;
        return io.set(key, value);
      },
    });
    saveScoutTeams([{ id: "a", name: "Hawks" }]);
    await flushPoolWrites();
    expect(poolKeysNotStored().has(TEAMS_KEY)).toBe(true);
    refuse = false;
    saveScoutTeams([{ id: "a", name: "Hawks" }]);
    await flushPoolWrites();
    expect(poolKeysNotStored().has(TEAMS_KEY)).toBe(false);
  });
});

describe("wiping the browser with Delete everything", () => {
  it("forgets the cloud copy before a key goes, so no removal is owed to it", async () => {
    await withPool();
    backing.set(
      CLOUD_STATE_KEY,
      JSON.stringify({
        enabled: true,
        device: "d",
        uid: "owner-1",
        met: {},
        hashes: {},
        uploads: [],
      })
    );
    markCloudDirty(TEAMS_KEY);
    expect(Object.keys(owedChanges())).toEqual([TEAMS_KEY]);
    onCloudPoolWrite(markCloudDirty);
    await resetApp();
    expect(loadCloudState().uid).toBeNull();
    expect(owedChanges()).toEqual({});
    onCloudPoolWrite(null);
  });
});
