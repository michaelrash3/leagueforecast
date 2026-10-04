import { afterEach, describe, expect, it } from "vitest";
import { memoryCloud, type MemoryCloud } from "../../cloud/__tests__/memoryCloud";
import { commitChanges, type CloudStore } from "../../cloud/cloudEngine";
import type { CloudManifest } from "../../cloud/cloudManifest";
import { loadPoolFrom, memoryIo } from "../../cloud/cloudRunner";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../../teamRankings";
import { encodeScoutTeams } from "../../teamRankingsCompact";
import {
  cloudPoolKeys,
  flushPoolWrites,
  initTeamRankingsStore,
  loadAgeGroups,
  loadRealClubs,
  loadScoutGamesForYear,
  loadScoutTeams,
  readCloudPoolValue,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveRealClubs,
  saveScoutGames,
  saveScoutTeams,
} from "../../teamRankingsStorage";
import { EDIT_DEVICE, runEdit } from "../editRun";
import { createPoolCache, everyPart, type PoolCache } from "../poolCache";

/*
 * Edits run on the server, on the cloud copy (`editRun.ts`): the command applied to the warm pool
 * and the parts it changed committed as one save, again on the copy as it now is when another save
 * lands first, and the pool left standing exactly as the copy does whatever happened. Placeholder
 * names throughout.
 */

const NOW = "2026-10-04T12:00:00.000Z";
const YEAR_2027 = "league_forecast_scout_games_v2:2027";
const YEAR_2028 = "league_forecast_scout_games_v2:2028";
const TEAMS_KEY = "league_forecast_scout_teams_v1";
const REAL_KEY = "league_forecast_gc_real_clubs_v1";

const GROUPS: AgeGroup[] = [
  { id: "ag_10u_2026", name: "10U 2026", ageLevel: 10, year: 2026, seasonIds: [] },
  { id: "ag_10u_2027", name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] },
  { id: "ag_10u_2028", name: "10U 2028", ageLevel: 10, year: 2028, seasonIds: [] },
];
const TEAMS: ScoutTeam[] = [
  { id: "A", name: "Club A" },
  { id: "B", name: "Club B" },
];
const GAMES: ScoutGame[] = [
  {
    id: "old",
    ageGroupId: "ag_10u_2026",
    teamAId: "A",
    teamBId: "B",
    teamAScore: 2,
    teamBScore: 1,
  },
  { id: "g1", ageGroupId: "ag_10u_2027", teamAId: "A", teamBId: "B", teamAScore: 5, teamBScore: 4 },
  { id: "open", ageGroupId: "ag_10u_2027", teamAId: "B", teamBId: "A" },
];

/** Every value a browser holding the pool would put in its copy, as stored. */
const poolValues = async (): Promise<Map<string, unknown>> => {
  resetTeamRankingsStore();
  await initTeamRankingsStore(memoryIo());
  saveAgeGroups(GROUPS);
  saveScoutTeams(TEAMS);
  saveScoutGames(GAMES);
  saveRealClubs(new Set(["gcA"]));
  await flushPoolWrites();
  const values = new Map<string, unknown>();
  for (const key of cloudPoolKeys())
    values.set(key, structuredClone(await readCloudPoolValue(key)));
  resetTeamRankingsStore();
  return values;
};

/** A copy holding the pool, saved by a phone. */
const copyOfPool = async (): Promise<MemoryCloud> => {
  const cloud = memoryCloud();
  const saved = await commitChanges({
    store: cloud.store,
    base: null,
    changes: [...(await poolValues())].map(([key, value]) => ({ key, value, at: 1 })),
    device: "phone",
    now: NOW,
  });
  if (!saved.ok) throw new Error("the copy was not saved");
  return cloud;
};

/** The copy as a device opening it would read it, in the module's store. */
const reopen = async (cloud: MemoryCloud) => {
  const loaded = await loadPoolFrom(cloud.store);
  if (!loaded) throw new Error("no copy");
  return loaded.manifest;
};

/**
 * A save from a phone onto whatever the copy now holds: one club's state, the roster encoded as the
 * store encodes it, made off this process's store, which the server's pool is.
 */
const phoneSaves = async (cloud: MemoryCloud, state: string) => {
  const saved = await commitChanges({
    store: cloud.store,
    base: cloud.manifest(),
    changes: [
      {
        key: TEAMS_KEY,
        value: encodeScoutTeams(TEAMS.map((team) => (team.id === "B" ? { ...team, state } : team))),
        at: 2,
      },
    ],
    device: "phone",
    now: NOW,
  });
  if (!saved.ok) throw new Error("the phone's save did not land");
};

let pool: PoolCache | null = null;
const editPool = () => {
  pool = createPoolCache({ loads: everyPart });
  return pool;
};
afterEach(async () => {
  await pool?.drop();
  pool = null;
  resetTeamRankingsStore();
});

const edit = (
  cache: PoolCache,
  store: CloudStore,
  command: Parameters<typeof runEdit>[0]["command"],
  copy?: string
) => runEdit({ pool: cache, store, command, ...(copy ? { copy } : {}), now: () => NOW });

describe("an edit on the cloud copy", () => {
  it("commits the parts the command changed, and only those, as the server's save", async () => {
    const cloud = await copyOfPool();
    const before = cloud.manifest()!;
    const done = await edit(editPool(), cloud.store, {
      kind: "game.score",
      year: 2027,
      gameId: "open",
      teamAScore: 6,
      teamBScore: 3,
    });
    expect(done).toMatchObject({ ok: true, changed: [YEAR_2027], version: before.version + 1 });
    const after = cloud.manifest()!;
    const moved = after.parts.filter(
      (part) => before.parts.find((was) => was.key === part.key)?.hash !== part.hash
    );
    expect(moved.map((part) => [part.key, part.by])).toEqual([[YEAR_2027, EDIT_DEVICE]]);
    await pool?.drop();
    await reopen(cloud);
    expect(loadScoutGamesForYear(2027).find((game) => game.id === "open")).toMatchObject({
      teamAScore: 6,
      teamBScore: 3,
    });
  });

  it("takes the edit back with its inverse, leaving the copy's parts as they were", async () => {
    const cloud = await copyOfPool();
    const before = new Map(cloud.manifest()!.parts.map((part) => [part.key, part.hash]));
    const cache = editPool();
    const done = await edit(cache, cloud.store, { kind: "team.state", teamId: "B", state: "KY" });
    if (!done.ok) throw new Error(done.why);
    const undone = await edit(cache, cloud.store, done.inverse);
    expect(undone).toMatchObject({ ok: true, changed: ["league_forecast_scout_teams_v1"] });
    expect(new Map(cloud.manifest()!.parts.map((part) => [part.key, part.hash]))).toEqual(before);
  });

  it("fetches nothing back for its own save on the next edit", async () => {
    const cloud = await copyOfPool();
    const cache = editPool();
    expect(
      await edit(cache, cloud.store, { kind: "team.state", teamId: "B", state: "KY" })
    ).toMatchObject({
      ok: true,
      cold: true,
    });
    expect(
      await edit(cache, cloud.store, { kind: "game.confirm", year: 2027, gameId: "g1" })
    ).toMatchObject({ ok: true, cold: false, fetched: 0 });
  });

  it("writes nothing for a change the copy already holds", async () => {
    const cloud = await copyOfPool();
    const before = cloud.manifest()!;
    const done = await edit(editPool(), cloud.store, {
      kind: "answers",
      list: "realClubs",
      add: ["gcA"],
      remove: [],
    });
    expect(done).toMatchObject({ ok: true, changed: [], version: before.version });
    expect(cloud.manifest()).toEqual(before);
  });

  it("writes nothing for an edit that ends where it began", async () => {
    const cloud = await copyOfPool();
    const before = cloud.manifest()!;
    const done = await edit(editPool(), cloud.store, {
      kind: "batch",
      commands: [
        { kind: "team.state", teamId: "B", state: "KY" },
        { kind: "team.state", teamId: "B", state: null },
      ],
    });
    expect(done).toMatchObject({ ok: true, changed: [], version: before.version });
    expect(cloud.manifest()).toEqual(before);
  });

  it("runs again on the copy as it now is when another save lands first, keeping that save", async () => {
    const cloud = await copyOfPool();
    const cache = editPool();
    // Warm, so the phone's save lands between this read and the edit's commit.
    await cache.ensure(cloud.store);
    let landed = false;
    const store: CloudStore = {
      ...cloud.store,
      commitManifest: async (expected, next) => {
        if (!landed) {
          landed = true;
          await phoneSaves(cloud, "OH");
        }
        return cloud.store.commitManifest(expected, next);
      },
    };
    const done = await edit(cache, store, {
      kind: "answers",
      list: "realClubs",
      add: ["gcB1"],
      remove: [],
    });
    // Brought up to the phone's save, not started again.
    expect(done).toMatchObject({ ok: true, tries: 2, cold: false });
    await cache.drop();
    await reopen(cloud);
    expect(loadScoutTeams().find((team) => team.id === "B")?.state).toBe("OH");
    expect([...loadRealClubs()].sort()).toEqual(["gcA", "gcB1"]);
  });

  it("gives up on a copy that keeps moving, its pool left as the copy is", async () => {
    const cloud = await copyOfPool();
    const before = cloud.manifest()!;
    const store: CloudStore = { ...cloud.store, commitManifest: async () => false };
    const cache = editPool();
    // A game in a year the copy has none of: the year's key is one the copy does not hold.
    const done = await edit(cache, store, {
      kind: "game.add",
      year: 2028,
      games: [{ id: "new", ageGroupId: "ag_10u_2028", teamAId: "A", teamBId: "B" }],
      adopt: [],
    });
    expect(done).toEqual({ ok: false, why: "kept-moving", tries: 3 });
    expect(cloud.manifest()).toEqual(before);
    // The next read finds the store as the copy holds it, the year it made taken out again.
    expect(await cache.ensure(cloud.store)).toMatchObject({ ok: true, cold: false });
    expect(await readCloudPoolValue(YEAR_2028)).toBeNull();
    expect(loadScoutGamesForYear(2028)).toEqual([]);
  });

  it("refuses what the command refuses, writing nothing and keeping the pool warm", async () => {
    const cloud = await copyOfPool();
    const cache = editPool();
    const writes = cloud.costs.writes;
    expect(
      await edit(cache, cloud.store, { kind: "game.confirm", year: 2027, gameId: "nope" })
    ).toEqual({
      ok: false,
      why: "missing",
      tries: 1,
    });
    expect(cloud.costs.writes).toBe(writes);
    expect(
      await edit(cache, cloud.store, { kind: "team.state", teamId: "B", state: "KY" })
    ).toMatchObject({ ok: true, cold: false });
  });

  it("refuses an edit made on another copy, or on one started again under it", async () => {
    const cloud = await copyOfPool();
    const cache = editPool();
    expect(
      await edit(cache, cloud.store, { kind: "team.state", teamId: "B", state: "KY" }, "another")
    ).toEqual({ ok: false, why: "copy-replaced", tries: 1 });
    let reset = false;
    const store: CloudStore = {
      ...cloud.store,
      commitManifest: async (expected, next) => {
        if (reset) return cloud.store.commitManifest(expected, next);
        reset = true;
        // The owner starts the copy again, from the same pool, under a new id.
        cloud.setManifest({ ...(cloud.manifest() as CloudManifest), copy: "started-again" });
        return false;
      },
    };
    expect(
      // Named by the device or not: the copy the run started on is the one it edits.
      await edit(cache, store, { kind: "team.state", teamId: "B", state: "TN" })
    ).toEqual({
      ok: false,
      why: "copy-replaced",
      tries: 2,
    });
    expect(cloud.manifest()!.copy).toBe("started-again");
  });

  it("refuses a copy it cannot vouch for before touching it", async () => {
    const cloud = memoryCloud();
    expect(
      await edit(editPool(), cloud.store, { kind: "team.state", teamId: "B", state: "KY" })
    ).toEqual({ ok: false, why: "no-copy", tries: 1 });
  });

  it("adds a year the copy has no games in yet, as a key of its own", async () => {
    const cloud = await copyOfPool();
    const done = await edit(editPool(), cloud.store, {
      kind: "game.add",
      year: 2028,
      games: [{ id: "new", ageGroupId: "ag_10u_2028", teamAId: "A", teamBId: "B" }],
      adopt: [],
    });
    expect(done).toMatchObject({ ok: true });
    expect(done.ok && done.changed).toContain(YEAR_2028);
    await pool?.drop();
    await reopen(cloud);
    expect(loadScoutGamesForYear(2028).map((game) => game.id)).toEqual(["new"]);
    expect(loadAgeGroups()).toEqual(GROUPS);
  });
});

describe("the pool an edit keeps", () => {
  it("lists what a command wrote, and fetches none of it back once committed", async () => {
    const cloud = await copyOfPool();
    const cache = editPool();
    await cache.ensure(cloud.store);
    saveRealClubs(new Set(["gcA", "gcB1"]));
    expect([...cache.written()]).toEqual([REAL_KEY]);
    const saved = await commitChanges({
      store: cloud.store,
      base: cloud.manifest(),
      changes: [{ key: REAL_KEY, value: await readCloudPoolValue(REAL_KEY), at: 3 }],
      device: EDIT_DEVICE,
      now: NOW,
    });
    if (!saved.ok) throw new Error("not saved");
    await cache.committed(saved.manifest);
    expect([...cache.written()]).toEqual([]);
    expect(await cache.ensure(cloud.store)).toMatchObject({ ok: true, cold: false, fetched: [] });
  });

  it("starts afresh after a commit said to be on another copy than the one it holds", async () => {
    const cloud = await copyOfPool();
    const cache = editPool();
    await cache.ensure(cloud.store);
    await cache.committed({ ...(cloud.manifest() as CloudManifest), copy: "another" });
    expect(await cache.ensure(cloud.store)).toMatchObject({ ok: true, cold: true });
  });
});
