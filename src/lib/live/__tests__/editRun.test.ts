import { afterEach, describe, expect, it } from "vitest";
import { poolFixture } from "../../../../scripts/poolFixture";
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
  loadArchiveIndex,
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
import { NO_LEAGUE_DOCS } from "../cloudLeague";
import { packUpload, type PackedUpload, type UploadStore } from "../../cloud/uploads";
import type { ArchivedSeason } from "../../teamRankingsArchive";
import {
  parseTeamRankingsJson,
  teamRankingsJson,
  writeTeamRankingsBackup,
} from "../../teamRankingsBackup";
import { LEAGUE_DOC_SCHEMA } from "../leagueDocs";
import { EDIT_DEVICE, runEdit, runQuery } from "../editRun";
import type { PoolCommand } from "../commands";
import { deriveAllKnown } from "../allKnown";
import { seasonReaderOf } from "../publishCopy";
import type { PoolQuery } from "../queries";
import { runRebuild } from "../rebuild";
import { createEditPool, type EditPool } from "../poolCache";
import { docsOf, listing, seasonsOf } from "./leagueDocsFixture";
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
const poolValues = async (games = GAMES): Promise<Map<string, unknown>> => {
  resetTeamRankingsStore();
  await initTeamRankingsStore(memoryIo());
  saveAgeGroups(GROUPS);
  saveScoutTeams(TEAMS);
  saveScoutGames(games);
  saveRealClubs(new Set(["gcA"]));
  await flushPoolWrites();
  const values = new Map<string, unknown>();
  for (const key of cloudPoolKeys())
    values.set(key, structuredClone(await readCloudPoolValue(key)));
  resetTeamRankingsStore();
  return values;
};

/** A copy holding the pool, saved by a phone. */
const copyOfPool = async (games = GAMES): Promise<MemoryCloud> => {
  const cloud = memoryCloud();
  const saved = await commitChanges({
    store: cloud.store,
    base: null,
    changes: [...(await poolValues(games))].map(([key, value]) => ({ key, value, at: 1 })),
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
) =>
  runEdit({
    pool: cache,
    store,
    leagueDocs: NO_LEAGUE_DOCS,
    command,
    ...(copy ? { copy } : {}),
    now: () => NOW,
  });

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

describe("a year archived or deleted by the copy's owner", () => {
  const ARCHIVE_INDEX = "league_forecast_scout_archive_v1";
  /** The pool with 2026's game dated, so its page keeps a table of the autumn it was played in. */
  const DATED = GAMES.map((game) => (game.id === "old" ? { ...game, date: "2025-09-20" } : game));
  const rowsKeys = (manifest: CloudManifest | null) =>
    (manifest?.parts ?? []).map(({ key }) => key).filter((key) => key.includes("_archive_rows_"));

  it("archives a year in one save: its tables, their index, and the pool without the year", async () => {
    const cloud = await copyOfPool(DATED);
    const before = cloud.manifest();
    const done = await edit(editPool(), cloud.store, {
      kind: "year.archive",
      year: 2026,
      at: NOW,
    });
    if (!done.ok) throw new Error(done.why);
    // Never taken back, and one version on: every part in the one save.
    expect(done.inverse).toEqual({ kind: "none" });
    expect(done.version).toBe((before?.version ?? 0) + 1);
    const after = cloud.manifest();
    const rows = rowsKeys(after);
    expect(rows).toHaveLength(1);
    expect(done.changed).toEqual(expect.arrayContaining([ARCHIVE_INDEX, ...rows, YEAR_2026]));
    expect(after?.device).toBe(EDIT_DEVICE);
    // What a device opening the copy now reads: the year gone, its table under the archive.
    await reopen(cloud);
    expect(loadAgeGroups().map((group) => group.id)).toEqual(["ag_10u_2027", "ag_10u_2028"]);
    expect(loadScoutGamesForYear(2026)).toEqual([]);
    const index = loadArchiveIndex();
    expect(index.map((entry) => entry.year)).toEqual([2026]);
    const part = after?.parts.find(({ key }) => key === rows[0]);
    if (!part) throw new Error("no rows part");
    const fetched = await fetchValues({ store: cloud.store, parts: [part] });
    if (!fetched.ok) throw new Error("the rows did not read");
    expect(fetched.values.get(part.key)).toMatchObject({ id: index[0]?.id });
  });

  it("deletes a year in one save, its archived tables taken out of the copy with it", async () => {
    const cloud = await copyOfPool(DATED);
    const cache = editPool();
    const archived = await edit(cache, cloud.store, { kind: "year.archive", year: 2026, at: NOW });
    if (!archived.ok) throw new Error(archived.why);
    expect(rowsKeys(cloud.manifest())).toHaveLength(1);
    const deleted = await edit(cache, cloud.store, { kind: "year.delete", year: 2026 });
    expect(deleted).toMatchObject({ ok: true, inverse: { kind: "none" } });
    expect(rowsKeys(cloud.manifest())).toEqual([]);
    await reopen(cloud);
    expect(loadArchiveIndex()).toEqual([]);
  });

  it("deletes a year with nothing archived, as the device's delete does", async () => {
    const cloud = await copyOfPool();
    const done = await edit(editPool(), cloud.store, { kind: "year.delete", year: 2027 });
    expect(done).toMatchObject({ ok: true });
    await reopen(cloud);
    expect(loadAgeGroups().map((group) => group.id)).toEqual(["ag_10u_2026", "ag_10u_2028"]);
    expect(loadScoutGamesForYear(2027)).toEqual([]);
  });

  it("saves nothing for a year with nothing under it, nor for a season a newer build saved", async () => {
    const cloud = await copyOfPool();
    const version = cloud.manifest()?.version;
    for (const command of [
      { kind: "year.archive", year: 2031, at: NOW },
      { kind: "year.delete", year: 2031 },
    ] as const) {
      expect(await edit(editPool(), cloud.store, command)).toMatchObject({
        ok: false,
        why: "missing",
      });
    }
    const docs = docsOf(seasonsOf(poolFixture({ seed: 7, clubsPerPage: 10 }).seasons));
    const [first, ...rest] = docs;
    if (!first) throw new Error("no documents");
    const newer = { ...first, fields: { ...first.fields, schema: LEAGUE_DOC_SCHEMA + 1 } };
    expect(
      await runEdit({
        pool: editPool(),
        store: cloud.store,
        leagueDocs: listing([...rest, newer]),
        command: { kind: "year.archive", year: 2026, at: NOW },
        now: () => NOW,
      })
    ).toMatchObject({ ok: false, why: "newer-league" });
    expect(cloud.manifest()?.version).toBe(version);
  });
});

describe("Team Rankings started again or brought back by the copy's owner", () => {
  /** The copy holding the pool and a League Standings part beside it. */
  const withLeague = async () => {
    const cloud = await copyOfPool();
    const saved = await commitChanges({
      store: cloud.store,
      base: cloud.manifest(),
      changes: [{ key: LEAGUE_PART, value: { seasons: [] }, at: 1 }],
      device: "phone",
      now: NOW,
    });
    if (!saved.ok) throw new Error("the League part was not saved");
    return cloud;
  };
  const hashes = (manifest: CloudManifest | null) =>
    new Map((manifest?.parts ?? []).map((part) => [part.key, part.hash]));

  it("starts again in one save: every Team Rankings part out and kept whole, League left as it was", async () => {
    const cloud = await withLeague();
    const before = cloud.manifest();
    const poolKeys = (before?.parts ?? [])
      .map(({ key }) => key)
      .filter((key) => key !== LEAGUE_PART);
    const done = await edit(editPool(), cloud.store, { kind: "copy.reset" });
    if (!done.ok) throw new Error(done.why);
    const after = cloud.manifest();
    expect(after?.parts.map(({ key }) => key)).toEqual([LEAGUE_PART]);
    expect(hashes(after).get(LEAGUE_PART)).toBe(hashes(before).get(LEAGUE_PART));
    expect(done.changed).toEqual([...poolKeys].sort());
    expect(after?.device).toBe(EDIT_DEVICE);
    // Kept as one version, the whole of Team Rankings, which taking the start back brings back.
    expect(done.inverse.kind).toBe("copy.restore");
    const group = done.inverse.kind === "copy.restore" ? done.inverse.group : "";
    expect(
      after?.kept
        .filter((part) => part.group === group)
        .map(({ key }) => key)
        .sort()
    ).toEqual([...poolKeys].sort());
  });

  it("is taken back by bringing back what it kept, and the warm pool follows both", async () => {
    const cloud = await withLeague();
    const before = hashes(cloud.manifest());
    const cache = editPool();
    const started = await edit(cache, cloud.store, { kind: "copy.reset" });
    if (!started.ok) throw new Error(started.why);
    // The pool an edit then runs on is the empty one: no club to give a state.
    expect(
      await edit(cache, cloud.store, { kind: "team.state", teamId: "B", state: "KY" })
    ).toMatchObject({ ok: false, why: "missing" });
    const back = await edit(cache, cloud.store, started.inverse);
    expect(back).toMatchObject({ ok: true, inverse: { kind: "none" } });
    expect(hashes(cloud.manifest())).toEqual(before);
    // And an edit on the pool brought back is made on it.
    expect(
      await edit(cache, cloud.store, { kind: "team.state", teamId: "B", state: "KY" })
    ).toMatchObject({ ok: true, changed: [TEAMS_KEY] });
    await pool?.drop();
    await reopen(cloud);
    expect(loadScoutTeams().find((team) => team.id === "B")).toMatchObject({ state: "KY" });
    expect(loadScoutGamesForYear(2027).map((game) => game.id)).toEqual(["g1", "open"]);
  });

  it("keeps the whole of Team Rankings, a part some version kept already included", async () => {
    const cloud = await copyOfPool();
    const before = hashes(cloud.manifest());
    // A device's own roster, the very one the copy holds, kept as lost when it joined.
    const roster = await fetchValues({
      store: cloud.store,
      parts: (cloud.manifest()?.parts ?? []).filter(({ key }) => key === TEAMS_KEY),
    });
    if (!roster.ok) throw new Error("the roster did not read");
    const joined = await commitChanges({
      store: cloud.store,
      base: cloud.manifest(),
      keepLost: [{ key: TEAMS_KEY, value: roster.values.get(TEAMS_KEY), at: 2 }],
      device: "phone",
      now: NOW,
    });
    if (!joined.ok) throw new Error("the phone did not join");
    const cache = editPool();
    const started = await edit(cache, cloud.store, { kind: "copy.reset" });
    if (!started.ok) throw new Error(started.why);
    expect(await edit(cache, cloud.store, started.inverse)).toMatchObject({ ok: true });
    expect(hashes(cloud.manifest())).toEqual(before);
  });

  it("brings back a version a device kept, keeping what it replaces in turn", async () => {
    const cloud = await copyOfPool();
    const kept = await commitChanges({
      store: cloud.store,
      base: cloud.manifest(),
      changes: [{ key: TEAMS_KEY, value: encodeScoutTeams([{ id: "A", name: "Club A" }]), at: 2 }],
      keepReplaced: [TEAMS_KEY],
      device: "phone",
      now: NOW,
    });
    if (!kept.ok) throw new Error("the phone's save did not land");
    const group = kept.manifest.kept[0]?.group ?? "";
    const done = await edit(editPool(), cloud.store, { kind: "copy.restore", group });
    expect(done).toMatchObject({ ok: true, changed: [TEAMS_KEY], inverse: { kind: "none" } });
    const after = cloud.manifest();
    expect(after?.kept.map((part) => part.group)).not.toContain(group);
    expect(after?.kept.map(({ key }) => key)).toEqual([TEAMS_KEY]);
    await pool?.drop();
    await reopen(cloud);
    expect(loadScoutTeams().map((team) => team.id)).toEqual(["A", "B"]);
  });

  it("saves nothing for a version no longer kept, an empty Team Rankings, or League kept live", async () => {
    const cloud = await withLeague();
    expect(
      await edit(editPool(), cloud.store, { kind: "copy.restore", group: "gone" })
    ).toMatchObject({ ok: false, why: "missing" });
    // A version carrying League Standings, once its seasons live in their own documents.
    const leagueKept = await commitChanges({
      store: cloud.store,
      base: cloud.manifest(),
      changes: [{ key: LEAGUE_PART, value: { seasons: [{ id: "s" }] }, at: 2 }],
      keepReplaced: [LEAGUE_PART],
      device: "phone",
      now: NOW,
    });
    if (!leagueKept.ok) throw new Error("the phone's save did not land");
    const group = leagueKept.manifest.kept[0]?.group ?? "";
    const docs = docsOf(seasonsOf(poolFixture({ seed: 7, clubsPerPage: 10 }).seasons));
    const restore = (leagueDocs: Parameters<typeof runEdit>[0]["leagueDocs"]) =>
      runEdit({
        pool: editPool(),
        store: cloud.store,
        leagueDocs,
        command: { kind: "copy.restore", group },
        now: () => NOW,
      });
    const version = cloud.manifest()?.version;
    expect(await restore(listing(docs))).toMatchObject({ ok: false, why: "league-kept-live" });
    expect(
      await restore(async () => {
        throw new Error("would not list");
      })
    ).toMatchObject({ ok: false, why: "store-refused" });
    expect(cloud.manifest()?.version).toBe(version);
    // Without the documents, the copy's part is League, and it comes back as on a device.
    expect(await restore(NO_LEAGUE_DOCS)).toMatchObject({ ok: true, changed: [LEAGUE_PART] });

    const started = await edit(editPool(), cloud.store, { kind: "copy.reset" });
    if (!started.ok) throw new Error(started.why);
    const empty = cloud.manifest()?.version;
    expect(await edit(editPool(), cloud.store, { kind: "copy.reset" })).toMatchObject({
      ok: false,
      why: "missing",
    });
    expect(cloud.manifest()?.version).toBe(empty);
  });

  it("starts again on the copy as it now is when another save lands first, keeping that save", async () => {
    const cloud = await copyOfPool();
    const cache = editPool();
    await cache.ensure(cloud.store);
    let landed = false;
    const store: CloudStore = {
      ...cloud.store,
      commitManifest: async (expected, next) => {
        if (!landed) {
          landed = true;
          await phoneSaves(cloud, "TN");
        }
        return cloud.store.commitManifest(expected, next);
      },
    };
    const done = await edit(cache, store, { kind: "copy.reset" });
    if (!done.ok || done.inverse.kind !== "copy.restore") throw new Error("not started again");
    expect(done.tries).toBe(2);
    // The phone's roster is the one kept, so bringing it back brings back the phone's save too.
    const group = done.inverse.group;
    await edit(cache, cloud.store, done.inverse);
    await cache.drop();
    await reopen(cloud);
    expect(group).not.toBe("");
    expect(loadScoutTeams().find((team) => team.id === "B")?.state).toBe("TN");
  });
});

describe("Team Rankings restored from a backup by the copy's owner", () => {
  /** Uploads as Firestore holds what `stageUpload` wrote, and as the server deletes them. */
  const memoryUploads = () => {
    const held = new Map<string, PackedUpload>();
    const store: UploadStore = {
      record: async (id) => structuredClone(held.get(id)?.record ?? null),
      getChunk: async (id, chunk) =>
        held.get(id)?.pieces.find((piece) => piece.id === chunk)?.data ?? null,
      remove: async (id) => {
        held.delete(id);
      },
      list: async () => [...held].map(([id, packed]) => ({ id, record: packed.record })),
    };
    /** Stages `json` as a device stages a file: its text. */
    const stage = async (json: string) => {
      const packed = await packUpload("team-rankings", [json], NOW);
      held.set(packed.id, packed);
      return packed.id;
    };
    return { store, stage, held };
  };
  /** The file a device would stage for the pool `games` makes: its Team Rankings JSON. */
  const backupOf = (games: ScoutGame[], teams = TEAMS) =>
    teamRankingsJson({ ageGroups: GROUPS, teams, games }, NOW);
  const restore = (cache: EditPool, store: CloudStore, uploads: UploadStore, upload: string) =>
    runEdit({
      pool: cache,
      store,
      leagueDocs: NO_LEAGUE_DOCS,
      uploads,
      command: { kind: "backup.restore", upload },
      now: () => NOW,
    });

  it("writes the file's pool in one save, keeps whole what it replaced, and deletes the upload", async () => {
    const cloud = await copyOfPool();
    const before = new Map(cloud.manifest()!.parts.map((part) => [part.key, part.hash]));
    const renamed = TEAMS.map((team) => ({ ...team, name: `${team.name} restored` }));
    const scored = GAMES.map((game) =>
      game.id === "open" ? { ...game, teamAScore: 1, teamBScore: 0 } : game
    );
    const uploads = memoryUploads();
    const id = await uploads.stage(backupOf(scored, renamed));
    const done = await restore(editPool(), cloud.store, uploads.store, id);
    if (!done.ok) throw new Error(done.why);
    expect(done.inverse).toEqual({ kind: "none" });
    expect(done.changed).toEqual(expect.arrayContaining([TEAMS_KEY, YEAR_2027]));
    expect(uploads.held.size).toBe(0);
    // What it replaced, kept as one version the Cloud panel brings back.
    const after = cloud.manifest()!;
    const group = after.kept.find((part) => part.key === TEAMS_KEY)?.group;
    const keptKeys = after.kept.filter((part) => part.group === group).map(({ key }) => key);
    // Team Rankings whole, as it stood: every part, moved or not, marked as the area whole.
    expect([...keptKeys].sort()).toEqual([...before.keys()].sort());
    for (const part of after.kept.filter((one) => one.group === group)) {
      expect(part).toMatchObject({ hash: before.get(part.key), whole: true });
    }
    await pool?.drop();
    await reopen(cloud);
    expect(loadScoutTeams().map((team) => team.name)).toEqual([
      "Club A restored",
      "Club B restored",
    ]);
    expect(loadScoutGamesForYear(2027).find((game) => game.id === "open")).toMatchObject({
      teamAScore: 1,
      teamBScore: 0,
    });
  });

  it("is undone whole by bringing back what it replaced, a year it added included", async () => {
    const cloud = await copyOfPool();
    const before = new Map(cloud.manifest()!.parts.map((part) => [part.key, part.hash]));
    const uploads = memoryUploads();
    const added: ScoutGame[] = [
      ...GAMES,
      {
        id: "new",
        ageGroupId: "ag_10u_2028",
        teamAId: "A",
        teamBId: "B",
        teamAScore: 9,
        teamBScore: 0,
      },
    ];
    const cache = editPool();
    const done = await restore(
      cache,
      cloud.store,
      uploads.store,
      await uploads.stage(backupOf(added))
    );
    if (!done.ok) throw new Error(done.why);
    const YEAR_2028 = "league_forecast_scout_games_v2:2028";
    expect(cloud.manifest()!.parts.map(({ key }) => key)).toContain(YEAR_2028);
    const group = cloud.manifest()!.kept.find((part) => part.key === TEAMS_KEY)?.group ?? "";
    const back = await edit(cache, cloud.store, { kind: "copy.restore", group });
    if (!back.ok) throw new Error(back.why);
    // The copy's Team Rankings is what it was, part for part, and the year the file added is gone.
    expect(new Map(cloud.manifest()!.parts.map((part) => [part.key, part.hash]))).toEqual(before);
    await pool?.drop();
    await reopen(cloud);
    expect(loadScoutGamesForYear(2028)).toEqual([]);
    // What that replaced is kept whole in its turn: the restore can be made again from it.
    const again = cloud.manifest()!.kept.filter((part) => part.key === YEAR_2028);
    expect(again[again.length - 1]).toMatchObject({ whole: true });
  });

  it("keeps nothing, and saves nothing, for a file the copy already holds", async () => {
    const cloud = await copyOfPool();
    const uploads = memoryUploads();
    const first = await restore(
      editPool(),
      cloud.store,
      uploads.store,
      await uploads.stage(backupOf(GAMES))
    );
    if (!first.ok) throw new Error(first.why);
    const after = cloud.manifest()!;
    const second = await restore(
      editPool(),
      cloud.store,
      uploads.store,
      await uploads.stage(backupOf(GAMES))
    );
    expect(second).toMatchObject({ ok: true });
    // The same version, and the same kept versions: a version that differs is not pushed out.
    expect(cloud.manifest()!.version).toBe(after.version);
    expect(cloud.manifest()!.kept).toEqual(after.kept);
  });

  it("is the pool a device restoring the same file writes for itself", async () => {
    const cloud = await copyOfPool();
    const uploads = memoryUploads();
    const file = backupOf(GAMES.filter((game) => game.id !== "old"));
    const done = await restore(editPool(), cloud.store, uploads.store, await uploads.stage(file));
    if (!done.ok) throw new Error(done.why);
    await pool?.drop();
    await reopen(cloud);
    const server = {
      groups: loadAgeGroups(),
      teams: loadScoutTeams(),
      games: loadScoutGamesForYear(2026),
    };
    // The device's own restore of the same file, on a store of its own.
    resetTeamRankingsStore();
    await initTeamRankingsStore(memoryIo());
    const parsed = parseTeamRankingsJson(file);
    if (!parsed || !writeTeamRankingsBackup(parsed)) throw new Error("the device did not restore");
    expect(server).toEqual({
      groups: loadAgeGroups(),
      teams: loadScoutTeams(),
      games: loadScoutGamesForYear(2026),
    });
    // The year the file has nothing for is gone on both.
    expect(server.games).toEqual([]);
  });

  it("leaves the archive alone for a file that says nothing of it, and replaces it for one that does", async () => {
    const DATED = GAMES.map((game) => (game.id === "old" ? { ...game, date: "2025-09-20" } : game));
    const cloud = await copyOfPool(DATED);
    const cache = editPool();
    const archived = await edit(cache, cloud.store, { kind: "year.archive", year: 2026, at: NOW });
    if (!archived.ok) throw new Error(archived.why);
    const uploads = memoryUploads();
    const silent = await restore(
      cache,
      cloud.store,
      uploads.store,
      await uploads.stage(backupOf(GAMES))
    );
    expect(silent).toMatchObject({ ok: true });
    await pool?.drop();
    await reopen(cloud);
    expect(loadArchiveIndex().map((entry) => entry.year)).toEqual([2026]);
    // A file that carries an archive of its own replaces the one the copy holds.
    // The table as the copy keeps it, its rows a part of their own.
    const rowsPart = cloud.manifest()?.parts.find(({ key }) => key.includes("_archive_rows_"));
    if (!rowsPart) throw new Error("no rows part");
    const fetched = await fetchValues({ store: cloud.store, parts: [rowsPart] });
    const table = fetched.ok
      ? (fetched.values.get(rowsPart.key) as ArchivedSeason | undefined)
      : undefined;
    if (!table) throw new Error("no archived table");
    const carried = teamRankingsJson(
      {
        ageGroups: GROUPS,
        teams: TEAMS,
        games: GAMES,
        archives: [{ ...table, name: "Placeholder Kept" }],
      },
      NOW
    );
    await pool?.drop();
    expect(
      await restore(editPool(), cloud.store, uploads.store, await uploads.stage(carried))
    ).toMatchObject({
      ok: true,
    });
    await pool?.drop();
    await reopen(cloud);
    expect(loadArchiveIndex().map((one) => one.name)).toEqual(["Placeholder Kept"]);
  });

  it("saves nothing for an upload not there, not whole, or not a Team Rankings backup", async () => {
    const cloud = await copyOfPool();
    const version = cloud.manifest()?.version;
    const uploads = memoryUploads();
    expect(await restore(editPool(), cloud.store, uploads.store, "f".repeat(32))).toMatchObject({
      ok: false,
      why: "missing",
    });
    const cut = await uploads.stage(backupOf(GAMES));
    uploads.held.set(cut, { ...uploads.held.get(cut)!, pieces: [] });
    expect(await restore(editPool(), cloud.store, uploads.store, cut)).toMatchObject({
      ok: false,
      why: "missing",
    });
    for (const value of ['{"format":"something else"}', '{"not":"a backup"}', '"text"']) {
      const id = await uploads.stage(value);
      expect(await restore(editPool(), cloud.store, uploads.store, id)).toMatchObject({
        ok: false,
        why: "refused",
      });
    }
    // Whole, but its pieces are another file's: refused, not read as a file that never came.
    const swapped = await uploads.stage(backupOf(GAMES));
    const other = await packUpload("team-rankings", [backupOf([])], NOW);
    const held = uploads.held.get(swapped)!;
    uploads.held.set(swapped, {
      ...held,
      pieces: held.pieces.map((piece, index) => ({
        ...piece,
        data: other.pieces[index]?.data ?? piece.data,
      })),
    });
    expect(await restore(editPool(), cloud.store, uploads.store, swapped)).toMatchObject({
      ok: false,
      why: "refused",
    });
    expect(cloud.manifest()?.version).toBe(version);
    // Kept for the nightly to sweep, rather than taken on a refusal the owner may want to see.
    expect(uploads.held.size).toBe(5);
  });
});

describe("games added by their clubs' names, resolved on the server", () => {
  const IMPORT: Extract<PoolCommand, { kind: "game.import" }> = {
    kind: "game.import",
    year: 2027,
    page: "ag_10u_2027",
    games: [
      { id: "imp1", teamA: "club a", teamB: "Club Z", stateB: "KY", teamAScore: 4, teamBScore: 1 },
      { id: "imp2", teamA: "Club Z", teamB: "Club B" },
    ],
  };

  it("resolves the names against the cloud's clubs, adds a club it lacks, and is undone exactly", async () => {
    const cloud = await copyOfPool();
    const before = new Map(cloud.manifest()!.parts.map((part) => [part.key, part.hash]));
    const cache = editPool();
    const done = await edit(cache, cloud.store, IMPORT);
    if (!done.ok) throw new Error(done.why);
    expect(done.changed).toEqual(expect.arrayContaining([TEAMS_KEY, YEAR_2027]));
    await pool?.drop();
    await reopen(cloud);
    const clubZ = loadScoutTeams().find((team) => team.name === "Club Z");
    expect(clubZ).toMatchObject({ state: "KY" });
    // "club a" is Club A, by name; Club Z one club, minted once, for both of its games.
    expect(
      loadScoutGamesForYear(2027)
        .filter((game) => game.id.startsWith("imp"))
        .map(({ id, teamAId, teamBId, teamAScore, teamBScore }) => ({
          id,
          teamAId,
          teamBId,
          teamAScore,
          teamBScore,
        }))
    ).toEqual([
      { id: "imp1", teamAId: "A", teamBId: clubZ?.id, teamAScore: 4, teamBScore: 1 },
      {
        id: "imp2",
        teamAId: clubZ?.id,
        teamBId: "B",
        teamAScore: undefined,
        teamBScore: undefined,
      },
    ]);
    // Its Undo takes the games back out, and the club they brought.
    const undone = await edit(editPool(), cloud.store, done.inverse);
    if (!undone.ok) throw new Error(undone.why);
    expect(new Map(cloud.manifest()!.parts.map((part) => [part.key, part.hash]))).toEqual(before);
  });

  it("knows League Standings' clubs: asked about, and adopted by name rather than made again", async () => {
    const cloud = await copyOfPool();
    // A season on the 2027 page, with a club the roster does not hold.
    const league = {
      seasons: [
        {
          id: "s",
          name: "Season 1",
          createdAt: "2026-08-01T12:00:00.000Z",
          // Two clubs the roster does not hold, whose names mint from one stem.
          teams: [
            { id: "a", name: "Club A" },
            { id: "f", name: "League Foxes" },
            { id: "o", name: "League Owls" },
          ],
          matchups: [
            { id: "m", date: "4/3", away: "a", home: "f" },
            { id: "n", date: "4/4", away: "o", home: "a" },
          ],
          logs: {},
          bracketLogs: {},
        },
      ],
    };
    const leagued = await commitChanges({
      store: cloud.store,
      base: cloud.manifest(),
      changes: [{ key: LEAGUE_PART, value: league, at: 2 }],
      device: "phone",
      now: NOW,
    });
    if (!leagued.ok) throw new Error("not saved");
    const cache = editPool();
    const paged = await edit(cache, cloud.store, {
      kind: "group.put",
      group: { ...GROUPS[1]!, seasonIds: ["s"] },
    });
    if (!paged.ok) throw new Error(paged.why);
    const asked = await runQuery({
      pool: cache,
      store: cloud.store,
      leagueDocs: NO_LEAGUE_DOCS,
      query: {
        kind: "games.check",
        page: "ag_10u_2027",
        games: [{ id: "r", teamA: "Club A", teamB: "League Foxez" }],
      },
    });
    // A near miss of the club League Standings made, which only its season names.
    const checked = asked.ok && asked.answer.kind === "games.check" ? asked.answer.checks : null;
    expect(checked?.[0]?.notes[1]).toEqual({ kind: "similar", to: "League Foxes" });
    // The ids the page knows League Standings' clubs by, which its board and cards carry.
    const knownAs = () => {
      const read = seasonReaderOf(league);
      if (!read) throw new Error("no seasons");
      const known = deriveAllKnown({
        ageGroups: loadAgeGroups(),
        teams: loadScoutTeams(),
        yearGames: loadScoutGamesForYear(2027),
        readSeason: read,
      });
      return new Map(known.teams.map((team) => [team.name, team.id]));
    };
    const before = knownAs();
    const done = await edit(cache, cloud.store, {
      kind: "game.import",
      year: 2027,
      page: "ag_10u_2027",
      games: [{ id: "imp", teamA: "Club A", teamB: "League Owls" }],
    });
    if (!done.ok) throw new Error(done.why);
    await pool?.drop();
    await reopen(cloud);
    // The Owls League Standings made, adopted under the id the page knew them by: minted afresh
    // from the roster alone, the name would take the stem's first id, which is the Foxes', and
    // every club of that stem would be known by another id after.
    const owls = loadScoutTeams().filter((team) => team.name === "League Owls");
    expect(owls.map(({ id }) => id)).toEqual([before.get("League Owls")]);
    expect(loadScoutGamesForYear(2027).find((game) => game.id === "imp")?.teamBId).toBe(
      before.get("League Owls")
    );
    expect(knownAs()).toEqual(before);
  });

  it("refuses a page the copy does not hold, or a year the page is not in, and saves nothing", async () => {
    const cloud = await copyOfPool();
    const version = cloud.manifest()?.version;
    expect(await edit(editPool(), cloud.store, { ...IMPORT, page: "gone" })).toMatchObject({
      ok: false,
      why: "missing",
    });
    expect(await edit(editPool(), cloud.store, { ...IMPORT, year: 2026 })).toMatchObject({
      ok: false,
      why: "refused",
    });
    expect(cloud.manifest()?.version).toBe(version);
  });
});

describe("a question about the cloud copy", () => {
  const ask = (cache: EditPool, store: CloudStore, copy?: string) =>
    runQuery({
      pool: cache,
      store,
      leagueDocs: NO_LEAGUE_DOCS,
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
      leagueDocs: NO_LEAGUE_DOCS,
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

  it("are none once Team Rankings is started again, and back once it is brought back", async () => {
    const cloud = await copyOfPool();
    const live = memoryLive();
    const cache = editPool();
    const rebuild = () =>
      runRebuild({
        copyStore: cloud.store,
        liveStore: live.store,
        pool: cache,
        leagueDocs: NO_LEAGUE_DOCS,
        today: () => "2026-10-04",
        now: () => NOW,
        locale: "en-US",
      });
    expect(await rebuild()).toMatchObject({ end: "published" });
    const boards = Object.keys(live.meta()?.views ?? {}).filter((key) => key.startsWith("board:"));
    expect(boards.length).toBeGreaterThan(0);
    const started = await edit(cache, cloud.store, { kind: "copy.reset" });
    if (!started.ok) throw new Error(started.why);
    expect(await rebuild()).toMatchObject({ end: "published", version: started.version });
    expect(Object.keys(live.meta()?.views ?? {}).filter((key) => key.startsWith("board:"))).toEqual(
      []
    );
    const back = await edit(cache, cloud.store, started.inverse);
    if (!back.ok) throw new Error(back.why);
    expect(await rebuild()).toMatchObject({ end: "published", version: back.version });
    expect(Object.keys(live.meta()?.views ?? {}).filter((key) => key.startsWith("board:"))).toEqual(
      boards
    );
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
    expect(
      await runQuery({ pool: cache, store, leagueDocs: NO_LEAGUE_DOCS, query: WHAT_IF })
    ).toMatchObject({
      ok: true,
      answer: { kind: "scouting.whatIf" },
    });
    await saveLeague(cloud, { seasons: [] });
    const warm = read.length;
    // Not for a question that refits nothing.
    expect(
      await runQuery({ pool: cache, store, leagueDocs: NO_LEAGUE_DOCS, query: RENAME })
    ).toMatchObject({ ok: true });
    expect(read).toHaveLength(warm);
    expect(
      await runQuery({ pool: cache, store, leagueDocs: NO_LEAGUE_DOCS, query: WHAT_IF })
    ).toMatchObject({ ok: true });
    const once = read.length;
    expect(once).toBeGreaterThan(warm);
    expect(
      await runQuery({ pool: cache, store, leagueDocs: NO_LEAGUE_DOCS, query: WHAT_IF })
    ).toMatchObject({ ok: true });
    expect(read).toHaveLength(once);
    // A new version of the part is read again.
    await saveLeague(cloud, { seasons: [], kept: 1 });
    expect(
      await runQuery({ pool: cache, store, leagueDocs: NO_LEAGUE_DOCS, query: WHAT_IF })
    ).toMatchObject({ ok: true });
    expect(read.length).toBeGreaterThan(once);
  });

  it("refuses a question that refits a year when the part would not read, and no other", async () => {
    const cloud = await copyOfPool();
    await saveLeague(cloud, "not a league");
    const cache = editPool();
    for (const query of [WHAT_IF, MODEL_CHECK])
      expect(
        await runQuery({ pool: cache, store: cloud.store, leagueDocs: NO_LEAGUE_DOCS, query })
      ).toEqual({
        ok: false,
        why: "league-unreadable",
      });
    expect(
      await runQuery({ pool: cache, store: cloud.store, leagueDocs: NO_LEAGUE_DOCS, query: RENAME })
    ).toMatchObject({
      ok: true,
    });
  });

  it("is the seasons' documents' once there are any, listed for each question, and never the copy's part", async () => {
    const cloud = await copyOfPool();
    // A part no browser would take in: read, it would refuse the question.
    await saveLeague(cloud, "not a league");
    const docs = docsOf(seasonsOf(poolFixture({ seed: 7, clubsPerPage: 10 }).seasons));
    let listed = 0;
    const leagueDocs = async () => {
      listed += 1;
      return docs;
    };
    const cache = editPool();
    for (const query of [WHAT_IF, MODEL_CHECK, WHAT_IF]) {
      expect(await runQuery({ pool: cache, store: cloud.store, leagueDocs, query })).toMatchObject({
        ok: true,
      });
    }
    expect(listed).toBe(3);
    // Not for a question that refits nothing.
    await runQuery({ pool: cache, store: cloud.store, leagueDocs, query: RENAME });
    expect(listed).toBe(3);
    // A season a newer build saved, and a listing that fails: refused, not thrown out of.
    const [first, ...rest] = docs;
    if (!first) throw new Error("no documents");
    const newer = { ...first, fields: { ...first.fields, schema: LEAGUE_DOC_SCHEMA + 1 } };
    expect(
      await runQuery({
        pool: cache,
        store: cloud.store,
        leagueDocs: listing([...rest, newer]),
        query: MODEL_CHECK,
      })
    ).toEqual({ ok: false, why: "newer-league" });
    expect(
      await runQuery({
        pool: cache,
        store: cloud.store,
        leagueDocs: () => Promise.reject(new Error("unavailable")),
        query: MODEL_CHECK,
      })
    ).toEqual({ ok: false, why: "store-refused" });
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
    expect(
      await runQuery({
        pool: editPool(),
        store: gone,
        leagueDocs: NO_LEAGUE_DOCS,
        query: MODEL_CHECK,
      })
    ).toEqual({
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
    expect(
      await runQuery({
        pool: editPool(),
        store: replaced,
        leagueDocs: NO_LEAGUE_DOCS,
        query: MODEL_CHECK,
      })
    ).toEqual({
      ok: false,
      why: "kept-moving",
    });
    const unread = goneThen(() => Promise.reject(new Error("unavailable")));
    expect(
      await runQuery({
        pool: editPool(),
        store: unread,
        leagueDocs: NO_LEAGUE_DOCS,
        query: MODEL_CHECK,
      })
    ).toEqual({
      ok: false,
      why: "store-refused",
    });
    // A store that fails mid-read: the question is refused, not thrown out of.
    const failing: CloudStore = {
      ...cloud.store,
      getChunk: (id) =>
        ofLeague(id) ? Promise.reject(new Error("unavailable")) : cloud.store.getChunk(id),
    };
    expect(
      await runQuery({
        pool: editPool(),
        store: failing,
        leagueDocs: NO_LEAGUE_DOCS,
        query: MODEL_CHECK,
      })
    ).toEqual({
      ok: false,
      why: "store-refused",
    });
  });
});
