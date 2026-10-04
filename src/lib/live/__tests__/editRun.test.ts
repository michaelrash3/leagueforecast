import { afterEach, describe, expect, it } from "vitest";
import { memoryCloud, type MemoryCloud } from "../../cloud/__tests__/memoryCloud";
import { commitChanges, fetchValues, type CloudStore } from "../../cloud/cloudEngine";
import type { CloudManifest } from "../../cloud/cloudManifest";
import { LEAGUE_PART } from "../../cloud/cloudPlan";
import { loadPoolFrom, memoryIo } from "../../cloud/cloudRunner";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../../teamRankings";
import { decodePoolGames, encodeScoutGames, encodeScoutTeams } from "../../teamRankingsCompact";
import {
  cloudPoolKeys,
  flushPoolWrites,
  initTeamRankingsStore,
  LEGACY_GAMES_KEY,
  loadAgeGroups,
  loadRealClubs,
  loadOrgMembership,
  loadRefreshCadence,
  loadScoutGamesForYear,
  loadScoutTeams,
  readCloudPoolValue,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveRealClubs,
  saveScoutGames,
  saveScoutTeams,
} from "../../teamRankingsStorage";
import { EDIT_DEVICE, runEdit, runQuery } from "../editRun";
import type { PoolQuery } from "../queries";
import { runRebuild } from "../rebuild";
import { createEditPool, type EditPool } from "../poolCache";
import { memoryLive } from "./memoryLive";

/*
 * Edits run on the server, on the cloud copy (`editRun.ts`): the command applied to the warm pool
 * and the parts it changed committed as one save, again on the copy as it now is when another save
 * lands first, and the pool left standing exactly as the copy does whatever happened. Placeholder
 * names throughout.
 */

const NOW = "2026-10-04T12:00:00.000Z";
const YEAR_2026 = "league_forecast_scout_games_v2:2026";
const YEAR_2027 = "league_forecast_scout_games_v2:2027";
const YEAR_2028 = "league_forecast_scout_games_v2:2028";
const TEAMS_KEY = "league_forecast_scout_teams_v1";
const REAL_KEY = "league_forecast_gc_real_clubs_v1";
const INDEX_KEY = "league_forecast_scout_games_v2_index";

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

let pool: EditPool | null = null;
const editPool = () => {
  pool = createEditPool();
  return pool;
};
afterEach(async () => {
  await pool?.drop();
  pool = null;
  resetTeamRankingsStore();
});

const edit = (
  cache: EditPool,
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

  it("keeps how much the nightly pulls, and an Organizations file, as parts of the copy", async () => {
    const cloud = await copyOfPool();
    const cache = editPool();
    expect(
      await edit(cache, cloud.store, { kind: "refresh.cadence", cadence: "rotation" })
    ).toMatchObject({ ok: true, changed: ["league_forecast_gc_cadence_v1"] });
    const org = { orgId: "o1", name: "Placeholder 9U", teamIds: ["gcA"] };
    expect(
      await edit(cache, cloud.store, { kind: "orgs.merge", orgs: [org], at: NOW })
    ).toMatchObject({ ok: true, changed: ["league_forecast_gc_org_membership_v1"] });
    await pool?.drop();
    await reopen(cloud);
    expect(loadRefreshCadence()).toBe("rotation");
    expect(loadOrgMembership()).toEqual({ orgs: [org], savedAt: NOW });
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

describe("a question about the cloud copy", () => {
  const ask = (cache: EditPool, store: CloudStore, copy?: string) =>
    runQuery({
      pool: cache,
      store,
      query: { kind: "rename.preview", teamId: "A", name: "Club Z" },
      ...(copy ? { copy } : {}),
    });

  it("is answered on the copy as it stands, of its version, writing nothing", async () => {
    const cloud = await copyOfPool();
    const writes = cloud.costs.writes;
    expect(await ask(editPool(), cloud.store)).toMatchObject({
      ok: true,
      copy: cloud.manifest()!.copy,
      version: cloud.manifest()!.version,
      answer: { kind: "rename.preview", name: "Club Z", into: null, games: 0, dropped: 0 },
      cold: true,
    });
    expect(cloud.costs.writes).toBe(writes);
  });

  it("is answered on the copy another save has since moved, the warm pool brought to it", async () => {
    const cloud = await copyOfPool();
    const cache = editPool();
    expect(await ask(cache, cloud.store)).toMatchObject({ ok: true, answer: { into: null } });
    const saved = await commitChanges({
      store: cloud.store,
      base: cloud.manifest(),
      changes: [
        {
          key: TEAMS_KEY,
          value: encodeScoutTeams(
            TEAMS.map((team) => (team.id === "B" ? { ...team, name: "Club Z" } : team))
          ),
          at: 2,
        },
      ],
      device: "phone",
      now: NOW,
    });
    if (!saved.ok) throw new Error("the phone's save did not land");
    expect(await ask(cache, cloud.store)).toMatchObject({
      ok: true,
      version: saved.manifest.version,
      answer: { into: { id: "B", name: "Club Z" }, games: 3, dropped: 3 },
      cold: false,
      fetched: 1,
    });
  });

  it("is refused on another copy than the one asked about, and on a copy it cannot vouch for", async () => {
    const cloud = await copyOfPool();
    expect(await ask(editPool(), cloud.store, "another")).toEqual({
      ok: false,
      why: "copy-replaced",
    });
    expect(await ask(editPool(), memoryCloud().store)).toEqual({ ok: false, why: "no-copy" });
  });
});

describe("the boards after an edit", () => {
  it("are published from the pool the edit left, at the version it saved, fetching nothing", async () => {
    const cloud = await copyOfPool();
    const live = memoryLive();
    const cache = editPool();
    const done = await edit(cache, cloud.store, { kind: "team.state", teamId: "B", state: "KY" });
    if (!done.ok) throw new Error(done.why);
    const published = await runRebuild({
      copyStore: cloud.store,
      liveStore: live.store,
      pool: cache,
      today: () => "2026-10-04",
      now: () => NOW,
      locale: "en-US",
    });
    expect(published).toMatchObject({
      end: "published",
      copy: done.copy,
      version: done.version,
      cold: false,
      fetched: 0,
      wrote: true,
    });
    expect(live.meta()?.copy).toEqual({ id: done.copy, version: done.version });
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

describe("a copy keeping an older pool's games under one key", () => {
  /** The copy as an older build saved it: every game under the one key, no years and no index. */
  const oneKeyCopy = async (): Promise<MemoryCloud> => {
    const values = new Map(
      [...(await poolValues())].filter(([key]) => !key.startsWith("league_forecast_scout_games_v2"))
    );
    values.set(LEGACY_GAMES_KEY, encodeScoutGames(GAMES));
    const cloud = memoryCloud();
    const saved = await commitChanges({
      store: cloud.store,
      base: null,
      changes: [...values].map(([key, value]) => ({ key, value, at: 1 })),
      device: "phone",
      now: NOW,
    });
    if (!saved.ok) throw new Error("the copy was not saved");
    return cloud;
  };
  const SCORE = {
    kind: "game.score",
    year: 2027,
    gameId: "open",
    teamAScore: 6,
    teamBScore: 3,
  } as const;

  it("carries the split into years with the edit, so a device opening the copy reads the edit", async () => {
    const cloud = await oneKeyCopy();
    expect(await edit(editPool(), cloud.store, SCORE)).toMatchObject({ ok: true });
    const keys = cloud.manifest()?.parts.map(({ key }) => key) ?? [];
    expect(keys).not.toContain(LEGACY_GAMES_KEY);
    expect(keys).toEqual(expect.arrayContaining([YEAR_2026, YEAR_2027, INDEX_KEY]));
    await pool?.drop();
    await reopen(cloud);
    expect(loadScoutGamesForYear(2027).find((game) => game.id === "open")).toMatchObject({
      teamAScore: 6,
      teamBScore: 3,
    });
    expect(loadScoutGamesForYear(2026).map((game) => game.id)).toEqual(["old"]);
  });

  it("keeps the edit on the pool's next read, and a second edit to the year keeps the first", async () => {
    const cloud = await oneKeyCopy();
    const cache = editPool();
    expect(await edit(cache, cloud.store, SCORE)).toMatchObject({ ok: true });
    expect(await cache.ensure(cloud.store)).toMatchObject({ ok: true, cold: false, fetched: [] });
    expect(loadScoutGamesForYear(2027).find((game) => game.id === "open")).toMatchObject({
      teamAScore: 6,
      teamBScore: 3,
    });
    expect(
      await edit(cache, cloud.store, {
        kind: "game.exclude",
        year: 2027,
        gameId: "g1",
        excluded: true,
      })
    ).toMatchObject({ ok: true });
    // The year's own part in the copy, read as it is stored.
    const year = cloud.manifest()?.parts.find((part) => part.key === YEAR_2027);
    if (!year) throw new Error("no year");
    const fetched = await fetchValues({ store: cloud.store, parts: [year] });
    if (!fetched.ok) throw new Error("not fetched");
    const games = decodePoolGames(fetched.values.get(YEAR_2027));
    expect(games.find((game) => game.id === "g1")).toMatchObject({ excluded: true });
    expect(games.find((game) => game.id === "open")).toMatchObject({
      teamAScore: 6,
      teamBScore: 3,
    });
  });
});

describe("an edit whose save's answer was lost", () => {
  const STATE = { kind: "team.state", teamId: "B", state: "KY" } as const;

  it("is the edit made, with its inverse, when the commit threw after it landed", async () => {
    const cloud = await copyOfPool();
    const dropped: CloudStore = {
      ...cloud.store,
      commitManifest: async (expected, next) => {
        await cloud.store.commitManifest(expected, next);
        throw new TypeError("fetch failed");
      },
    };
    expect(await edit(editPool(), dropped, STATE)).toMatchObject({
      ok: true,
      changed: [TEAMS_KEY],
      inverse: { kind: "team.put", team: { id: "B", name: "Club B" } },
      tries: 1,
    });
    expect(cloud.manifest()?.device).toBe(EDIT_DEVICE);
  });

  it("says it cannot tell when the copy would not read after, and fetches what it wrote again", async () => {
    const cloud = await copyOfPool();
    let down = false;
    const blind: CloudStore = {
      ...cloud.store,
      commitManifest: async () => {
        down = true;
        throw new TypeError("fetch failed");
      },
      readManifest: async () => {
        if (down) throw new TypeError("fetch failed");
        return cloud.store.readManifest();
      },
    };
    const cache = editPool();
    expect(await edit(cache, blind, STATE)).toEqual({ ok: false, why: "unsure", tries: 1 });
    // The copy never took it, and the pool reads the copy's own roster back.
    expect(await cache.ensure(cloud.store)).toMatchObject({
      ok: true,
      cold: false,
      fetched: [TEAMS_KEY],
    });
    expect(loadScoutTeams().find((team) => team.id === "B")?.state).toBeUndefined();
  });

  it("says it cannot tell when the commit threw and is not in the copy, since it may land yet", async () => {
    const cloud = await copyOfPool();
    const slow: CloudStore = {
      ...cloud.store,
      commitManifest: async () => {
        throw new TypeError("fetch failed");
      },
    };
    expect(await edit(editPool(), slow, STATE)).toEqual({ ok: false, why: "unsure", tries: 1 });
    expect(cloud.manifest()?.device).toBe("phone");
  });

  it("throws a save that never went, a piece refused, for the function to say it was not made", async () => {
    const cloud = await copyOfPool();
    const refusing: CloudStore = {
      ...cloud.store,
      putChunk: async () => {
        throw new TypeError("fetch failed");
      },
    };
    await expect(edit(editPool(), refusing, STATE)).rejects.toThrow("fetch failed");
    expect(cloud.manifest()?.device).toBe("phone");
  });
});

describe("League Standings in the copy", () => {
  it("is nothing to an edit: a part that would not read refuses none, and is left as it was", async () => {
    const cloud = await copyOfPool();
    const added = await commitChanges({
      store: cloud.store,
      base: cloud.manifest(),
      changes: [{ key: LEAGUE_PART, value: "not a league", at: 2 }],
      device: "phone",
      now: NOW,
    });
    if (!added.ok) throw new Error("not saved");
    const league = cloud.manifest()?.parts.find((part) => part.key === LEAGUE_PART);
    expect(league).toBeDefined();
    expect(
      await edit(editPool(), cloud.store, { kind: "team.state", teamId: "B", state: "KY" })
    ).toMatchObject({ ok: true, changed: [TEAMS_KEY] });
    expect(cloud.manifest()?.parts.find((part) => part.key === LEAGUE_PART)).toEqual(league);
  });
  /** A what-if about the open game, named as club A's card holds it (its second game). */
  const WHAT_IF: PoolQuery = {
    kind: "scouting.whatIf",
    page: "ag_10u_2027",
    segment: null,
    forTeamId: "A",
    game: { id: "1", teamAId: "B", teamBId: "A", ageGroupId: "ag_10u_2027" },
    today: "2027-04-15",
  };
  const MODEL_CHECK: PoolQuery = { kind: "model.check", page: "ag_10u_2027" };
  const RENAME: PoolQuery = { kind: "rename.preview", teamId: "A", name: "Club Z" };
  const saveLeague = async (cloud: MemoryCloud, value: unknown) => {
    const saved = await commitChanges({
      store: cloud.store,
      base: cloud.manifest(),
      changes: [{ key: LEAGUE_PART, value, at: 2 }],
      device: "phone",
      now: NOW,
    });
    if (!saved.ok) throw new Error("not saved");
  };

  it("is read for a question that refits a year, once for each version of the part", async () => {
    const cloud = await copyOfPool();
    const read: string[] = [];
    const store: CloudStore = {
      ...cloud.store,
      getChunk: (id) => {
        read.push(id);
        return cloud.store.getChunk(id);
      },
    };
    const cache = editPool();
    // With no part, as a copy that never held League Standings: nothing to read.
    expect(await runQuery({ pool: cache, store, query: WHAT_IF })).toMatchObject({
      ok: true,
      answer: { kind: "scouting.whatIf" },
    });
    await saveLeague(cloud, { seasons: [] });
    const warm = read.length;
    // Not for a question that refits nothing.
    expect(await runQuery({ pool: cache, store, query: RENAME })).toMatchObject({ ok: true });
    expect(read).toHaveLength(warm);
    expect(await runQuery({ pool: cache, store, query: WHAT_IF })).toMatchObject({ ok: true });
    const once = read.length;
    expect(once).toBeGreaterThan(warm);
    expect(await runQuery({ pool: cache, store, query: WHAT_IF })).toMatchObject({ ok: true });
    expect(read).toHaveLength(once);
    // A new version of the part is read again.
    await saveLeague(cloud, { seasons: [], kept: 1 });
    expect(await runQuery({ pool: cache, store, query: WHAT_IF })).toMatchObject({ ok: true });
    expect(read.length).toBeGreaterThan(once);
  });

  it("refuses a question that refits a year when the part would not read, and no other", async () => {
    const cloud = await copyOfPool();
    await saveLeague(cloud, "not a league");
    const cache = editPool();
    for (const query of [WHAT_IF, MODEL_CHECK])
      expect(await runQuery({ pool: cache, store: cloud.store, query })).toEqual({
        ok: false,
        why: "league-unreadable",
      });
    expect(await runQuery({ pool: cache, store: cloud.store, query: RENAME })).toMatchObject({
      ok: true,
    });
  });

  it("says why the part could not be had, and is refused rather than thrown when the store fails", async () => {
    const cloud = await copyOfPool();
    await saveLeague(cloud, { seasons: [] });
    const league = cloud.manifest()?.parts.find(({ key }) => key === LEAGUE_PART);
    if (!league) throw new Error("no League part");
    const ofLeague = (id: string) => id.startsWith(league.id);
    // Its pieces gone while the copy still names the part: damaged, not a copy that kept moving.
    const gone: CloudStore = {
      ...cloud.store,
      getChunk: (id) => (ofLeague(id) ? Promise.resolve(null) : cloud.store.getChunk(id)),
    };
    expect(await runQuery({ pool: editPool(), store: gone, query: MODEL_CHECK })).toEqual({
      ok: false,
      why: "damaged",
    });
    /*
     * Its pieces gone once the question has read the copy, which then names the part at another
     * hash (replaced since), or cannot be read again: the copy kept moving, or the store would not
     * answer.
     */
    const goneThen = (manifest: () => Promise<CloudManifest | null>): CloudStore => {
      let missed = false;
      return {
        ...cloud.store,
        getChunk: (id) => {
          if (!ofLeague(id)) return cloud.store.getChunk(id);
          missed = true;
          return Promise.resolve(null);
        },
        readManifest: () => (missed ? manifest() : cloud.store.readManifest()),
      };
    };
    const replaced = goneThen(async () => {
      const now = await cloud.store.readManifest();
      return (
        now && {
          ...now,
          parts: now.parts.map((one) =>
            one.key === LEAGUE_PART ? { ...one, hash: `${one.hash}-next` } : one
          ),
        }
      );
    });
    expect(await runQuery({ pool: editPool(), store: replaced, query: MODEL_CHECK })).toEqual({
      ok: false,
      why: "kept-moving",
    });
    const unread = goneThen(() => Promise.reject(new Error("unavailable")));
    expect(await runQuery({ pool: editPool(), store: unread, query: MODEL_CHECK })).toEqual({
      ok: false,
      why: "store-refused",
    });
    // A store that fails mid-read: the question is refused, not thrown out of.
    const failing: CloudStore = {
      ...cloud.store,
      getChunk: (id) =>
        ofLeague(id) ? Promise.reject(new Error("unavailable")) : cloud.store.getChunk(id),
    };
    expect(await runQuery({ pool: editPool(), store: failing, query: MODEL_CHECK })).toEqual({
      ok: false,
      why: "store-refused",
    });
  });
});
