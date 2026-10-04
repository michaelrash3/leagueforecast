import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FIXTURE_TODAY, poolFixture } from "../../../../scripts/poolFixture";
import { memoryCloud, type MemoryCloud } from "../../cloud/__tests__/memoryCloud";
import { commitChanges, type Change, type CloudStore } from "../../cloud/cloudEngine";
import { DATA_SCHEMA, UnreadableCopyError, type CloudManifest } from "../../cloud/cloudManifest";
import { LEAGUE_PART } from "../../cloud/cloudPlan";
import { loadPoolFrom, memoryIo } from "../../cloud/cloudRunner";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../../teamRankings";
import {
  cloudPoolKeys,
  flushPoolWrites,
  initTeamRankingsStore,
  readCloudPoolValue,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveRefreshLog,
  saveScoutGames,
  saveScoutTeams,
  saveTidyStamp,
} from "../../teamRankingsStorage";
import { BOARD_FAMILY, builtFrom } from "../boardInputs";
import { createPoolCache, type PoolCache, type PoolEnsure } from "../poolCache";
import { publishCopyViews } from "../publishCopy";
import {
  handleRebuildTask,
  isRebuildFailure,
  liveLags,
  RECYCLE_AT,
  saveLineOf,
  runRebuild,
  shouldRecycle,
  type RebuildResult,
} from "../rebuild";
import { coerceLedger, type Ledger, type LedgerStore } from "../rebuildLedger";
import { BOARD_RULES } from "../views/board";
import { LIVE_SCHEMA, type LiveMeta, type LiveStore } from "../viewStore";
import { memoryLive, type MemoryLive } from "./memoryLive";

/*
 * One rebuild of the boards after a save (`rebuild.ts`): the worker's half, which brings the pool
 * to the copy and publishes from it, against the copy and `live/` in memory and a seeded pool; and
 * the main thread's, which decides whether to run it at all and meters what it spent.
 */

const fixture = poolFixture({ seed: 5, clubsPerPage: 40 });
const NOW = "2027-04-15T14:00:00.000Z";
const TODAY = FIXTURE_TODAY;
const now = () => NOW;
const today = () => TODAY;

type Pool = { ageGroups: AgeGroup[]; teams: ScoutTeam[]; games: ScoutGame[] };
const POOL: Pool = { ageGroups: fixture.ageGroups, teams: fixture.teams, games: fixture.games };
const LEAGUE = {
  seasons: Object.entries(fixture.seasons).map(([id, season], index) => ({
    id,
    name: `Season ${index + 1}`,
    createdAt: "2026-08-01T12:00:00.000Z",
    ...season,
    bracketLogs: {},
  })),
};

/** Every value a browser holding `pool` puts in its cloud copy, as stored. */
const copyValues = async (pool: Pool): Promise<Map<string, unknown>> => {
  resetTeamRankingsStore();
  await initTeamRankingsStore(memoryIo());
  saveAgeGroups(pool.ageGroups);
  saveScoutTeams(pool.teams);
  saveScoutGames(pool.games);
  saveTidyStamp("r1|0|0|0|");
  saveRefreshLog({ "9": "2027-04-14" });
  await flushPoolWrites();
  const values = new Map<string, unknown>();
  for (const key of cloudPoolKeys()) {
    values.set(key, structuredClone(await readCloudPoolValue(key)));
  }
  values.set(LEAGUE_PART, structuredClone(LEAGUE));
  resetTeamRankingsStore();
  return values;
};

const changesBetween = (
  from: ReadonlyMap<string, unknown> | null,
  to: ReadonlyMap<string, unknown>
): Change[] =>
  [...to]
    .filter(([key, value]) => JSON.stringify(from?.get(key)) !== JSON.stringify(value))
    .map(([key, value]) => ({ key, value, at: 2 }));

/** Saves the copy as a phone would. */
const save = async (
  cloud: MemoryCloud,
  from: ReadonlyMap<string, unknown> | null,
  to: ReadonlyMap<string, unknown>
): Promise<CloudManifest> => {
  const saved = await commitChanges({
    store: cloud.store,
    base: cloud.manifest(),
    changes: changesBetween(from, to),
    device: "phone",
    now: NOW,
  });
  if (!saved.ok) throw new Error("the copy was not saved");
  return saved.manifest;
};

/** Every write a rebuild tried on the copy. It must try none. */
const wrote: string[] = [];
afterEach(() => {
  expect(wrote).toEqual([]);
  wrote.length = 0;
});
afterAll(() => {
  resetTeamRankingsStore();
});

/** Pieces of the copy read through `readOnly`. */
const piecesRead = { count: 0 };

/** The copy as a rebuild reads it, every write refused and recorded. */
const readOnly = (cloud: MemoryCloud, manifestOf?: () => CloudManifest | null): CloudStore => {
  const refuse = (what: string) => {
    wrote.push(what);
    return Promise.reject(new Error(`the rebuild wrote the copy (${what})`));
  };
  return {
    readManifest: async () => (manifestOf ? manifestOf() : cloud.store.readManifest()),
    getChunk: (id) => {
      piecesRead.count += 1;
      return cloud.store.getChunk(id);
    },
    commitManifest: () => refuse("commitManifest"),
    putChunk: (id) => refuse(`putChunk ${id}`),
    deleteChunk: (id) => refuse(`deleteChunk ${id}`),
  };
};

/** `live/` with every call counted by name. */
const counted = (live: MemoryLive) => {
  const calls: Record<string, number> = {};
  const count =
    <A extends unknown[], R>(name: string, call: (...args: A) => R) =>
    (...args: A): R => {
      calls[name] = (calls[name] ?? 0) + 1;
      return call(...args);
    };
  const store: LiveStore = {
    readMeta: count("readMeta", live.store.readMeta),
    commitMeta: count("commitMeta", live.store.commitMeta),
    putChunk: count("putChunk", live.store.putChunk),
    getChunk: count("getChunk", live.store.getChunk),
    deleteChunk: count("deleteChunk", live.store.deleteChunk),
    listChunks: count("listChunks", live.store.listChunks),
  };
  return { store, calls };
};

/** Each published view's fingerprint, by key: equal exactly when the views are. */
const viewsOf = (meta: LiveMeta | null) =>
  Object.fromEntries(Object.entries(meta?.views ?? {}).map(([key, entry]) => [key, entry.h]));

/** A rebuild in the worker, under the collation the members' browsers order ties by. */
const rebuild = (
  over: Partial<Parameters<typeof runRebuild>[0]> &
    Pick<Parameters<typeof runRebuild>[0], "copyStore" | "liveStore" | "pool">
) => runRebuild({ today, now, locale: "en-US", ...over });

/** The boards a nightly publishes from what `cloud` holds now, into `live`. */
const nightly = async (cloud: MemoryCloud, live: MemoryLive) => {
  const loaded = await loadPoolFrom(cloud.store);
  if (!loaded) throw new Error("no copy");
  const published = await publishCopyViews({
    copyStore: cloud.store,
    liveStore: live.store,
    manifest: loaded.manifest,
    today: TODAY,
    now,
    locale: "en-US",
  });
  if (!published.ok) throw new Error(`the nightly did not publish: ${published.reason}`);
  resetTeamRankingsStore();
  return loaded.manifest;
};

let V1 = new Map<string, unknown>();
let V2 = new Map<string, unknown>();
beforeAll(async () => {
  V1 = await copyValues(POOL);
  // A score changed in one year: one shard moves.
  const scored = fixture.games.findIndex((game) => game.teamAScore !== undefined);
  const games = fixture.games.map((game, index) =>
    index === scored ? { ...game, teamAScore: (game.teamAScore ?? 0) + 5 } : game
  );
  V2 = await copyValues({ ...POOL, games });
});

describe("a rebuild in the worker", () => {
  it("publishes the very boards the nightly does from the same copy, and then finds them current", async () => {
    const cloud = memoryCloud();
    const manifest = await save(cloud, null, V1);
    const fromNightly = memoryLive();
    await nightly(cloud, fromNightly);

    const live = memoryLive();
    const { store, calls } = counted(live);
    const pool = createPoolCache();
    const read = piecesRead.count;
    const first = await rebuild({ copyStore: readOnly(cloud), liveStore: store, pool, today, now });
    // Every piece read once, by the pool: the publish takes its League seasons from it.
    expect(piecesRead.count - read).toBe(first.pieces);
    expect(first).toMatchObject({
      end: "published",
      retryable: false,
      tries: 1,
      copy: manifest.copy,
      version: 1,
      cold: true,
      wrote: true,
    });
    expect(first.uploaded).toBeGreaterThan(0);
    expect(viewsOf(live.meta())).toEqual(viewsOf(fromNightly.meta()));
    expect(live.meta()?.built[BOARD_FAMILY]).toEqual(await builtFrom(manifest, TODAY));
    // One meta commit, the due pieces taken out by it, and no listing.
    expect(calls.commitMeta).toBe(1);
    expect(calls.listChunks).toBeUndefined();

    const writes = live.costs.writes;
    const again = await rebuild({ copyStore: readOnly(cloud), liveStore: store, pool, today, now });
    expect(again).toMatchObject({ end: "current", cold: false, fetched: 0, pieces: 0 });
    expect(live.costs.writes).toBe(writes);
    await pool.drop();
  });

  it("publishes the version a save mid-load moved the copy to", async () => {
    const cloud = memoryCloud();
    await save(cloud, null, V1);
    // The boards are version 1's: checked against the manifest it read before the save, the run
    // would find them current and leave version 2 unpublished.
    const live = memoryLive();
    await nightly(cloud, live);
    expect(live.meta()?.built[BOARD_FAMILY]?.v).toBe(1);
    const pool = createPoolCache();
    let saving: Promise<CloudManifest> | null = null;
    const store = readOnly(cloud);
    const racing: CloudStore = {
      ...store,
      getChunk: async (id) => {
        // The phone saves the next version, and deletes the pieces it replaced, before the first
        // piece of the load is read; the pieces are read four at a time, so once for them all.
        saving ??= save(cloud, V1, V2);
        await saving;
        return store.getChunk(id);
      },
    };
    const result = await rebuild({ copyStore: racing, liveStore: live.store, pool, today, now });
    expect(result).toMatchObject({ end: "published", version: 2 });
    expect(live.meta()?.copy).toEqual({ id: (await saving!).copy, version: 2 });
    await pool.drop();
  });

  it("leaves a newer version's boards in place when it was late with an older one", async () => {
    const cloud = memoryCloud();
    const first = await save(cloud, null, V1);
    const pieces = new Map(cloud.chunks);
    const live = memoryLive();
    await save(cloud, V1, V2);
    await nightly(cloud, live);
    const newer = live.meta();
    // The rebuild read the copy before that save: version 1, its pieces still there.
    const stale = memoryCloud();
    pieces.forEach((data, id) => stale.chunks.set(id, data));
    stale.setManifest(first);
    const pool = createPoolCache();
    const result = await rebuild({
      copyStore: readOnly(stale),
      liveStore: live.store,
      pool,
      today,
      now,
    });
    expect(result).toMatchObject({ end: "published", version: 1, wrote: false });
    expect(live.meta()).toEqual(newer);
    await pool.drop();
  });

  it("goes once more when the New York day turned while it ran, and only then", async () => {
    const cloud = memoryCloud();
    await save(cloud, null, V1);
    const loaded = await loadPoolFrom(cloud.store);
    const live = memoryLive();
    const published = await publishCopyViews({
      copyStore: cloud.store,
      liveStore: live.store,
      manifest: loaded!.manifest,
      today: "2027-04-16",
      now,
      locale: "en-US",
    });
    expect(published.ok).toBe(true);
    resetTeamRankingsStore();

    // The day it read has passed, and stays passed.
    const pool = createPoolCache();
    const stuck = await rebuild({
      copyStore: readOnly(cloud),
      liveStore: live.store,
      pool,
      today,
      now,
    });
    expect(stuck).toMatchObject({ end: "older-day", tries: 1 });
    // It turned: read again, and the boards are the new day's already.
    const days = ["2027-04-15", "2027-04-16", "2027-04-16", "2027-04-16"];
    const turning = () => days.shift() ?? "2027-04-16";
    const turned = await rebuild({
      copyStore: readOnly(cloud),
      liveStore: live.store,
      pool,
      today: turning,
      now,
    });
    expect(turned).toMatchObject({ end: "current", tries: 2 });
    // Once more at most, however often the day turns.
    const twice = ["2027-04-14", "2027-04-15", "2027-04-15", "2027-04-16"];
    const turningAgain = await rebuild({
      copyStore: readOnly(cloud),
      liveStore: live.store,
      pool,
      today: () => twice.shift() ?? "2027-04-16",
      now,
    });
    expect(turningAgain).toMatchObject({ end: "older-day", tries: 2 });
    // Not past the deadline.
    const late = await rebuild({
      copyStore: readOnly(cloud),
      liveStore: live.store,
      pool,
      today: (() => {
        const more = ["2027-04-15", "2027-04-16"];
        return () => more.shift() ?? "2027-04-16";
      })(),
      now,
      clock: () => 10,
      deadline: 5,
    });
    expect(late).toMatchObject({ end: "older-day", tries: 1 });
    await pool.drop();
  });

  it("leaves boards newer rules or a newer build published, and a meta it cannot read", async () => {
    const cloud = memoryCloud();
    await save(cloud, null, V1);
    const live = memoryLive();
    await nightly(cloud, live);
    const meta = live.meta()!;
    const pool = createPoolCache();
    const run = async () => {
      const result = await rebuild({
        copyStore: readOnly(cloud),
        liveStore: live.store,
        pool,
        today,
        now,
      });
      // Turned away before any board was built.
      expect(result).not.toHaveProperty("publishMs");
      return result;
    };

    live.setMeta({
      ...meta,
      built: { [BOARD_FAMILY]: { ...meta.built[BOARD_FAMILY]!, rules: BOARD_RULES + 1, v: 0 } },
    });
    expect(await run()).toMatchObject({ end: "older-rules", retryable: false });
    live.setMeta({ ...meta, schema: LIVE_SCHEMA + 1 });
    expect(await run()).toMatchObject({ end: "newer-live-schema", retryable: false });
    live.setMeta({ format: "nonsense" });
    expect(await run()).toMatchObject({ end: "unreadable", retryable: false });
    // None of them wrote.
    expect(live.meta()).toEqual({ format: "nonsense" });
    await pool.drop();
  });

  it("publishes the version it loaded, not one a save moved the copy to after", async () => {
    const cloud = memoryCloud();
    const first = await save(cloud, null, V1);
    const fromNightly = memoryLive();
    await nightly(cloud, fromNightly);
    const live = memoryLive();
    let saving: Promise<CloudManifest> | null = null;
    // The phone saves the next version once the pool has loaded, before the boards are built.
    const racing: LiveStore = {
      ...live.store,
      readMeta: async () => {
        saving ??= save(cloud, V1, V2);
        await saving;
        return live.store.readMeta();
      },
    };
    const pool = createPoolCache();
    const result = await rebuild({ copyStore: readOnly(cloud), liveStore: racing, pool });
    expect(result).toMatchObject({ end: "published", version: 1 });
    expect(live.meta()?.copy).toEqual({ id: first.copy, version: 1 });
    expect(live.meta()?.built[BOARD_FAMILY]?.v).toBe(1);
    expect(viewsOf(live.meta())).toEqual(viewsOf(fromNightly.meta()));
    await pool.drop();
  });

  it("goes once more when a later day's boards went up while it built, and the day turned", async () => {
    const cloud = memoryCloud();
    await save(cloud, null, V1);
    const later = memoryLive();
    const loaded = await loadPoolFrom(cloud.store);
    await publishCopyViews({
      copyStore: cloud.store,
      liveStore: later.store,
      manifest: loaded!.manifest,
      today: "2027-04-16",
      now,
      locale: "en-US",
    });
    resetTeamRankingsStore();
    const live = memoryLive();
    let checked = false;
    // The nightly publishes the next day's boards just after this run looked.
    const racing: LiveStore = {
      ...live.store,
      readMeta: async () => {
        const read = await live.store.readMeta();
        if (!checked) {
          checked = true;
          live.setMeta(later.meta());
        }
        return read;
      },
    };
    const days = ["2027-04-15", "2027-04-16"];
    const pool = createPoolCache();
    const result = await rebuild({
      copyStore: readOnly(cloud),
      liveStore: racing,
      pool,
      today: () => days.shift() ?? "2027-04-16",
    });
    expect(result).toMatchObject({ end: "current", tries: 2 });
    await pool.drop();
  });

  it("asks for a retry when the published meta kept changing under its commits", async () => {
    const cloud = memoryCloud();
    await save(cloud, null, V1);
    const live = memoryLive();
    await nightly(cloud, live);
    await save(cloud, V1, V2);
    const restless: LiveStore = {
      ...live.store,
      commitMeta: async (token, next) => {
        // Another publisher's commit lands first, every time.
        live.setMeta(live.meta());
        return live.store.commitMeta(token, next);
      },
    };
    const pool = createPoolCache();
    const result = await rebuild({ copyStore: readOnly(cloud), liveStore: restless, pool });
    expect(result).toMatchObject({ end: "kept-changing", retryable: true });
    await pool.drop();
  });

  it("ends copy-replaced when the copy was started again under it", async () => {
    const cloud = memoryCloud();
    const manifest = await save(cloud, null, V1);
    const live = memoryLive();
    let replaced = false;
    // The copy reads as another once the first piece is up, as after a reset.
    const uploading: LiveStore = {
      ...live.store,
      putChunk: async (id, data) => {
        replaced = true;
        await live.store.putChunk(id, data);
      },
    };
    const store = readOnly(cloud, () => (replaced ? { ...manifest, copy: "another" } : manifest));
    const pool = createPoolCache();
    const result = await rebuild({ copyStore: store, liveStore: uploading, pool });
    expect(result).toMatchObject({ end: "copy-replaced", retryable: false });
    expect(live.meta()).toBeNull();
    expect(live.chunks.size).toBe(0);
    await pool.drop();
  });

  it("writes nothing on a dry run, and says what it would have", async () => {
    const cloud = memoryCloud();
    await save(cloud, null, V1);
    const live = memoryLive();
    const pool = createPoolCache();
    const result = await rebuild({
      copyStore: readOnly(cloud),
      liveStore: live.store,
      pool,
      today,
      now,
      dry: true,
    });
    expect(result).toMatchObject({ end: "published", wrote: true });
    expect(result.uploaded).toBeGreaterThan(0);
    expect(live.costs).toMatchObject({ writes: 0, deletes: 0 });
    expect(live.meta()).toBeNull();
    await pool.drop();
  });

  it("ends as the pool or the publish refused, retrying only what moved under it", async () => {
    const live = memoryLive();
    const refusing = (reason: Extract<PoolEnsure, { ok: false }>["reason"]): PoolCache => ({
      ensure: async () => ({ ok: false, reason }),
      drop: async () => undefined,
      held: () => ({ copy: null, version: null, keys: 0 }),
      written: () => new Set(),
      committed: async () => undefined,
      forget: async () => undefined,
    });
    const ends: Array<[Extract<PoolEnsure, { ok: false }>["reason"], boolean]> = [
      ["no-copy", false],
      ["newer-schema", false],
      ["damaged", false],
      ["kept-moving", true],
      ["store-refused", true],
    ];
    for (const [reason, retryable] of ends) {
      const result = await rebuild({
        copyStore: readOnly(memoryCloud()),
        liveStore: live.store,
        pool: refusing(reason),
        today,
        now,
      });
      expect(result, reason).toMatchObject({ end: reason, retryable, tries: 1 });
    }
    // Under another collation the boards would order ties otherwise: nothing is published.
    const cloud = memoryCloud();
    await save(cloud, null, V1);
    const pool = createPoolCache();
    expect(
      await rebuild({
        copyStore: readOnly(cloud),
        liveStore: live.store,
        pool,
        today,
        now,
        locale: "de-DE",
      })
    ).toMatchObject({ end: "locale", retryable: false });
    await pool.drop();
  });

  it("counts as failures only the ends that are not its job done or a newer one's", () => {
    for (const end of [
      "published",
      "current",
      "older-rules",
      "older-day",
      "copy-replaced",
      "no-copy",
      // A newer build's boards or copy: this build is due to be replaced, which a pause of every
      // save's rebuild for the rest of the day would only outlast.
      "newer-live-schema",
      "newer-schema",
      "newer-rules",
      "unknown-key",
    ] as const) {
      expect(isRebuildFailure(end), end).toBe(false);
    }
    for (const end of [
      "damaged",
      "league-unreadable",
      "store-refused",
      "kept-moving",
      "kept-changing",
      "locale",
      "too-large",
      "unreadable",
    ] as const) {
      expect(isRebuildFailure(end), end).toBe(true);
    }
  });
});

/** The ledger's document in memory, refusing a write over a version it was not read at. */
const memoryLedger = (raw: unknown) => {
  let doc: { raw: unknown; token: string } | null = raw === null ? null : { raw, token: "t0" };
  let version = 0;
  const reads = { count: 0 };
  const store: LedgerStore = {
    read: async () => {
      reads.count += 1;
      return doc ? { raw: structuredClone(doc.raw), token: doc.token } : { raw: null, token: null };
    },
    replace: async (token, next) => {
      if ((doc?.token ?? null) !== token) return false;
      version += 1;
      doc = { raw: structuredClone(next), token: `t${version}` };
      return true;
    },
  };
  return { store, reads, held: () => coerceLedger(doc?.raw ?? null) };
};

const SWITCH: Partial<Ledger> = { on: true, mode: "live", warm: true };
const SIZE = { gib: 8, cpu: 2 };

describe("a rebuild task on the main thread", () => {
  /** A copy saved and published by the nightly, so the boards are current; then a newer save. */
  const setUp = async ({ current }: { current: boolean }) => {
    const cloud = memoryCloud();
    await save(cloud, null, V1);
    const live = memoryLive();
    await nightly(cloud, live);
    if (!current) await save(cloud, V1, V2);
    return { cloud, live };
  };
  const handle = (
    over: Partial<Parameters<typeof handleRebuildTask>[0]> & {
      ledger: LedgerStore;
      cloud: MemoryCloud;
      live: MemoryLive;
    }
  ) => {
    let clock = 1_000;
    const { cloud, live, ...rest } = over;
    return handleRebuildTask({
      copyStore: readOnly(cloud),
      liveStore: live.store,
      run: async () => {
        clock += 61_200;
        return { end: "published", retryable: false, tries: 1 };
      },
      today,
      now,
      clock: () => clock,
      size: SIZE,
      startupS: () => 0,
      ...rest,
    });
  };

  it("does nothing while switched off, or with no switch", async () => {
    const { cloud, live } = await setUp({ current: false });
    const run = vi.fn<() => Promise<RebuildResult>>();
    for (const raw of [null, { on: false }, { on: true, dayGiBs: "lots" }]) {
      const ledger = memoryLedger(raw);
      expect(await handle({ ledger: ledger.store, cloud, live, run })).toEqual({
        line: { end: "off" },
        rethrow: false,
      });
      expect(ledger.reads.count).toBe(1);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("reserves nothing and starts no worker when the boards are current, for three reads", async () => {
    const { cloud, live } = await setUp({ current: true });
    const ledger = memoryLedger(SWITCH);
    const run = vi.fn<() => Promise<RebuildResult>>();
    const reads = cloud.costs.reads + live.costs.reads;
    const done = await handle({ ledger: ledger.store, cloud, live, run });
    expect(done).toEqual({
      line: { end: "current", copy: cloud.manifest()!.copy, version: 1 },
      rethrow: false,
    });
    expect(run).not.toHaveBeenCalled();
    expect(ledger.reads.count + cloud.costs.reads + live.costs.reads - reads).toBe(3);
    expect(ledger.held()).toMatchObject({ dayGiBs: 0, open: null });
  });

  it("leaves newer rules' boards before reserving anything", async () => {
    const { cloud, live } = await setUp({ current: false });
    const meta = live.meta()!;
    live.setMeta({
      ...meta,
      built: { [BOARD_FAMILY]: { ...meta.built[BOARD_FAMILY]!, rules: BOARD_RULES + 1 } },
    });
    const ledger = memoryLedger(SWITCH);
    const run = vi.fn<() => Promise<RebuildResult>>();
    expect((await handle({ ledger: ledger.store, cloud, live, run })).line.end).toBe("older-rules");
    expect(run).not.toHaveBeenCalled();
    expect(ledger.held()?.open).toBeNull();
  });

  it("starts no worker when the ledger refuses the run", async () => {
    const { cloud, live } = await setUp({ current: false });
    const run = vi.fn<() => Promise<RebuildResult>>();
    const paused = memoryLedger({
      ...SWITCH,
      day: TODAY,
      month: "2027-04",
      failures: 3,
      pausedDay: TODAY,
    });
    expect(await handle({ ledger: paused.store, cloud, live, run })).toEqual({
      line: { end: "failing", copy: cloud.manifest()!.copy, version: 2 },
      rethrow: false,
    });
    const full = memoryLedger({ ...SWITCH, day: TODAY, month: "2027-04", dayGiBs: 9_000 });
    expect((await handle({ ledger: full.store, cloud, live, run })).line.end).toBe("day-cap");
    expect(run).not.toHaveBeenCalled();
  });

  it("runs as the switch says, and settles what the run cost in place of its ceiling", async () => {
    const { cloud, live } = await setUp({ current: false });
    const ledger = memoryLedger({ ...SWITCH, mode: "dry", warm: false, failures: 2 });
    const asked: Array<{ dry: boolean; warm: boolean }> = [];
    let clock = 1_000;
    const done = await handle({
      ledger: ledger.store,
      cloud,
      live,
      clock: () => clock,
      startupS: () => 4,
      task: { copy: "c", kind: "edit", window: 1, savedAt: "2027-04-15T13:58:00.000Z" },
      taskId: "T1",
      run: async (request) => {
        asked.push(request);
        // Reserved under the queue's name for the task.
        expect(ledger.held()?.open).toMatchObject({ at: NOW, task: "T1" });
        clock += 57_000;
        return {
          end: "published",
          retryable: false,
          tries: 1,
          version: 2,
          boards: 33,
          wrote: true,
        };
      },
    });
    expect(asked).toEqual([{ dry: true, warm: false }]);
    // 57 s and 4 s of start-up, at 8 GiB and two vCPUs.
    expect(done).toEqual({
      line: {
        kind: "edit",
        savedAt: "2027-04-15T13:58:00.000Z",
        end: "published",
        tries: 1,
        version: 2,
        boards: 33,
        wrote: true,
        copy: cloud.manifest()!.copy,
        mode: "dry",
        gibs: 488,
        vcpuS: 122,
        settled: true,
      },
      rethrow: false,
    });
    expect(ledger.held()).toMatchObject({
      dayGiBs: 488,
      monthGiBs: 488,
      monthVcpuS: 122,
      failures: 0,
      open: null,
    });
  });

  it("says when its boards went up only for a live run that wrote them", async () => {
    const { cloud, live } = await setUp({ current: false });
    for (const [wrote, at] of [
      [true, NOW],
      [false, undefined],
    ] as const) {
      const done = await handle({
        ledger: memoryLedger(SWITCH).store,
        cloud,
        live,
        run: async () => ({ end: "published", retryable: false, tries: 1, version: 2, wrote }),
      });
      expect(done.line.publishedAt).toBe(at);
    }
  });

  it("leaves boards for a later day, a newer build's, and a meta it cannot read before reserving", async () => {
    const { cloud, live } = await setUp({ current: false });
    const meta = live.meta()!;
    const run = vi.fn<() => Promise<RebuildResult>>();
    const cases: Array<[unknown, string]> = [
      [
        {
          ...meta,
          built: { [BOARD_FAMILY]: { ...meta.built[BOARD_FAMILY]!, today: "9999-12-31" } },
        },
        "older-day",
      ],
      [{ ...meta, schema: LIVE_SCHEMA + 1 }, "newer-live-schema"],
      [{ format: "nonsense" }, "unreadable"],
    ];
    for (const [raw, end] of cases) {
      live.setMeta(raw);
      const ledger = memoryLedger(SWITCH);
      expect((await handle({ ledger: ledger.store, cloud, live, run })).line.end, end).toBe(end);
      expect(ledger.held()).toMatchObject({ dayGiBs: 0, open: null });
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("leaves a copy a newer build saved before reserving anything", async () => {
    const { cloud, live } = await setUp({ current: false });
    const ledger = memoryLedger(SWITCH);
    const run = vi.fn<() => Promise<RebuildResult>>();
    const newer = () => ({ ...cloud.manifest()!, schema: DATA_SCHEMA + 1 });
    expect(
      await handle({ ledger: ledger.store, cloud, live, run, copyStore: readOnly(cloud, newer) })
    ).toEqual({
      line: { end: "newer-schema", copy: cloud.manifest()!.copy, version: 2 },
      rethrow: false,
    });
    expect(run).not.toHaveBeenCalled();
    expect(ledger.held()).toMatchObject({ dayGiBs: 0, failures: 0, open: null });
    // A part under a key this build does not keep, which a newer build's new key would be.
    const keyed = (): CloudManifest => {
      const held = cloud.manifest()!;
      return { ...held, parts: [...held.parts, { ...held.parts[0]!, key: "a-newer-builds-key" }] };
    };
    expect(
      await handle({ ledger: ledger.store, cloud, live, run, copyStore: readOnly(cloud, keyed) })
    ).toEqual({
      line: { end: "unknown-key", copy: cloud.manifest()!.copy, version: 2 },
      rethrow: false,
    });
    expect(run).not.toHaveBeenCalled();
    expect(ledger.held()).toMatchObject({ dayGiBs: 0, failures: 0, open: null });
  });

  it("leaves a copy that is gone before reserving, with nothing to try again", async () => {
    const { cloud, live } = await setUp({ current: false });
    const ledger = memoryLedger(SWITCH);
    const run = vi.fn<() => Promise<RebuildResult>>();
    expect(
      await handle({
        ledger: ledger.store,
        cloud,
        live,
        run,
        copyStore: { ...readOnly(cloud), readManifest: async () => null },
      })
    ).toEqual({ line: { end: "no-copy" }, rethrow: false });
    expect(run).not.toHaveBeenCalled();
    expect(ledger.held()).toMatchObject({ dayGiBs: 0, failures: 0, open: null });
  });

  it("leaves a copy it cannot read before reserving, and throws a read that failed", async () => {
    const { cloud, live } = await setUp({ current: false });
    const ledger = memoryLedger(SWITCH);
    const run = vi.fn<() => Promise<RebuildResult>>();
    const reading = (thrown: Error): CloudStore => ({
      ...readOnly(cloud),
      readManifest: () => Promise.reject(thrown),
    });
    expect(
      await handle({
        ledger: ledger.store,
        cloud,
        live,
        run,
        copyStore: reading(new UnreadableCopyError()),
      })
    ).toEqual({ line: { end: "unreadable-copy" }, rethrow: false });
    // Firestore busy for a moment: the queue tries the task again, nothing spent or counted.
    await expect(
      handle({
        ledger: ledger.store,
        cloud,
        live,
        run,
        copyStore: reading(new Error("Firestore answered HTTP 503 reading copies/main.")),
      })
    ).rejects.toThrow(/503/);
    expect(run).not.toHaveBeenCalled();
    expect(ledger.held()).toMatchObject({ dayGiBs: 0, failures: 0, open: null });
  });

  it("asks the queue to try again when other writers took the ledger on every try", async () => {
    const { cloud, live } = await setUp({ current: false });
    const ledger = memoryLedger(SWITCH);
    // An owner's edits to the switch, say, each landing between this run's read and its write.
    const moving: LedgerStore = { read: ledger.store.read, replace: async () => false };
    const run = vi.fn<() => Promise<RebuildResult>>();
    expect(await handle({ ledger: moving, cloud, live, run })).toEqual({
      line: { end: "contended", copy: cloud.manifest()!.copy, version: 2 },
      rethrow: true,
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("waits on another task's run still going, and asks the queue to try again", async () => {
    const { cloud, live } = await setUp({ current: false });
    const going = {
      ...SWITCH,
      day: TODAY,
      month: "2027-04",
      dayGiBs: 2_560,
      monthGiBs: 2_560,
      monthVcpuS: 640,
      open: {
        at: "2027-04-15T13:59:00.000Z",
        day: TODAY,
        cost: { gibs: 2_560, vcpuS: 640 },
        task: "other",
      },
    };
    const ledger = memoryLedger(going);
    const run = vi.fn<() => Promise<RebuildResult>>();
    expect(await handle({ ledger: ledger.store, cloud, live, run, taskId: "mine" })).toMatchObject({
      line: { end: "busy" },
      rethrow: true,
    });
    expect(run).not.toHaveBeenCalled();
    expect(ledger.held()).toMatchObject({ failures: 0, open: { task: "other" } });
  });

  it("waits on its own task's earlier try still going, which may yet settle", async () => {
    // The queue delivered the task again, twice at once or past its dispatch deadline: a minute
    // after the first, or in the very same moment, which only the handlings' ids tell apart.
    const { cloud, live } = await setUp({ current: false });
    for (const at of ["2027-04-15T13:59:00.000Z", NOW]) {
      const ledger = memoryLedger({
        ...SWITCH,
        day: TODAY,
        month: "2027-04",
        dayGiBs: 2_560,
        monthGiBs: 2_560,
        monthVcpuS: 640,
        open: { at, day: TODAY, cost: { gibs: 2_560, vcpuS: 640 }, task: "T1", by: "first" },
      });
      const run = vi.fn<() => Promise<RebuildResult>>();
      expect(
        await handle({ ledger: ledger.store, cloud, live, run, taskId: "T1", runId: "second" }),
        at
      ).toMatchObject({ line: { end: "busy" }, rethrow: true });
      expect(run).not.toHaveBeenCalled();
      expect(ledger.held()).toMatchObject({ failures: 0, open: { at, task: "T1", by: "first" } });
    }
  });

  it("keeps its own reservation whose answer was lost, and runs once", async () => {
    const { cloud, live } = await setUp({ current: false });
    const ledger = memoryLedger(SWITCH);
    let lost = false;
    const losing: LedgerStore = {
      read: ledger.store.read,
      replace: async (token, next) => {
        const landed = await ledger.store.replace(token, next);
        if (!lost) {
          lost = true;
          throw new Error("Firestore answered HTTP 503 replacing ops/rebuild.");
        }
        return landed;
      },
    };
    const run = vi.fn(async (): Promise<RebuildResult> => ({
      end: "published",
      retryable: false,
      tries: 1,
    }));
    const done = await handle({ ledger: losing, cloud, live, run, taskId: "T1" });
    expect(run).toHaveBeenCalledTimes(1);
    expect(done).toMatchObject({ line: { end: "published", settled: true }, rethrow: false });
    // Charged once, and settled at what the run took (no time on this clock).
    expect(ledger.held()).toMatchObject({ dayGiBs: 0, failures: 0, open: null });
  });

  it("runs once on a reservation whose last write landed though its answer was lost", async () => {
    const { cloud, live } = await setUp({ current: false });
    const ledger = memoryLedger(SWITCH);
    let writes = 0;
    const flaky: LedgerStore = {
      read: ledger.store.read,
      replace: async (token, next) => {
        writes += 1;
        // The first two fail outright; the third lands and its answer is lost.
        if (writes <= 2) throw new Error("Firestore answered HTTP 503 replacing ops/rebuild.");
        const landed = await ledger.store.replace(token, next);
        if (writes === 3) throw new Error("Firestore answered HTTP 503 replacing ops/rebuild.");
        return landed;
      },
    };
    const run = vi.fn(async (): Promise<RebuildResult> => ({
      end: "published",
      retryable: false,
      tries: 1,
    }));
    const done = await handle({ ledger: flaky, cloud, live, run });
    expect(run).toHaveBeenCalledTimes(1);
    expect(done).toMatchObject({ line: { end: "published", settled: true }, rethrow: false });
    expect(ledger.held()).toMatchObject({ failures: 0, open: null });
  });

  it("runs once on a reservation whose answer was lost before the reads that would tell failed", async () => {
    // The first write fails outright, the second lands with its answer lost, and the third try's
    // read fails: the reservation is read back after the last try, and is this handling's.
    const { cloud, live } = await setUp({ current: false });
    const ledger = memoryLedger(SWITCH);
    let writes = 0;
    let reads = 0;
    const flaky: LedgerStore = {
      read: async () => {
        reads += 1;
        // The switch's read, then the reserve's three tries: the third fails.
        if (reads === 4) throw new Error("Firestore answered HTTP 503 reading ops/rebuild.");
        return ledger.store.read();
      },
      replace: async (token, next) => {
        writes += 1;
        if (writes === 1) throw new Error("Firestore answered HTTP 503 replacing ops/rebuild.");
        const landed = await ledger.store.replace(token, next);
        if (writes === 2) throw new Error("Firestore answered HTTP 503 replacing ops/rebuild.");
        return landed;
      },
    };
    const run = vi.fn(async (): Promise<RebuildResult> => ({
      end: "published",
      retryable: false,
      tries: 1,
    }));
    const done = await handle({ ledger: flaky, cloud, live, run });
    expect(run).toHaveBeenCalledTimes(1);
    expect(done).toMatchObject({ line: { end: "published", settled: true }, rethrow: false });
    expect(ledger.held()).toMatchObject({ dayGiBs: 0, failures: 0, open: null });
  });

  it("says a settle whose answer was lost as made, and one with nothing left to settle as not", async () => {
    const { cloud, live } = await setUp({ current: false });
    const ledger = memoryLedger(SWITCH);
    let writes = 0;
    const losing: LedgerStore = {
      read: ledger.store.read,
      replace: async (token, next) => {
        writes += 1;
        const landed = await ledger.store.replace(token, next);
        // The reserve's answer comes back; the settle's is lost though it landed.
        if (writes === 2) throw new Error("Firestore answered HTTP 503 replacing ops/rebuild.");
        return landed;
      },
    };
    expect(await handle({ ledger: losing, cloud, live })).toMatchObject({
      line: { end: "published", settled: true },
      rethrow: false,
    });
    expect(writes).toBe(2);
    expect(ledger.held()).toMatchObject({ failures: 0, open: null });

    // The owner cleared the reservation while the run went: nothing of this run's is left to settle.
    const cleared = memoryLedger(SWITCH);
    const clearing = vi.fn(async (): Promise<RebuildResult> => {
      const held = cleared.held()!;
      await cleared.store.replace((await cleared.store.read()).token, { ...held, open: null });
      return { end: "published", retryable: false, tries: 1 };
    });
    expect(await handle({ ledger: cleared.store, cloud, live, run: clearing })).toMatchObject({
      line: { end: "published", settled: false },
      rethrow: false,
    });
    expect(clearing).toHaveBeenCalledTimes(1);
  });

  it("says a settle it could not write, and leaves the retry to how the run ended", async () => {
    const { cloud, live } = await setUp({ current: false });
    const ledger = memoryLedger(SWITCH);
    let ran = false;
    const failing: LedgerStore = {
      read: async () => {
        if (ran) throw new Error("Firestore answered HTTP 503 reading ops/rebuild.");
        return ledger.store.read();
      },
      replace: ledger.store.replace,
    };
    const done = await handle({
      ledger: failing,
      cloud,
      live,
      run: async () => {
        ran = true;
        return { end: "published", retryable: false, tries: 1, version: 2, wrote: true };
      },
    });
    expect(done).toMatchObject({
      line: { end: "published", settled: false, settleError: expect.stringMatching(/503/) },
      rethrow: false,
    });
    // The reservation stands, its ceiling charged, for the next reserve to count.
    expect(ledger.held()?.open).toMatchObject({ at: NOW });
  });

  it("settles a worker that threw as failed, and throws for the queue to try again", async () => {
    const { cloud, live } = await setUp({ current: false });
    const ledger = memoryLedger(SWITCH);
    const done = await handle({
      ledger: ledger.store,
      cloud,
      live,
      run: async () => {
        throw new Error("the worker ran out of memory");
      },
    });
    expect(done.rethrow).toBe(true);
    expect(done.line).toMatchObject({
      end: "threw",
      error: "the worker ran out of memory",
      settled: true,
    });
    expect(ledger.held()).toMatchObject({ failures: 1, open: null });
  });

  it("settles a refusal as failed, and does not ask for a retry it cannot get past", async () => {
    const { cloud, live } = await setUp({ current: false });
    const ledger = memoryLedger({ ...SWITCH, failures: 2 });
    const done = await handle({
      ledger: ledger.store,
      cloud,
      live,
      run: async () => ({ end: "damaged", retryable: false, tries: 1 }),
    });
    expect(done).toMatchObject({ line: { end: "damaged" }, rethrow: false });
    expect(ledger.held()).toMatchObject({ failures: 3, pausedDay: TODAY });
    // A copy newer rules tidied, which a run finds only once loaded, stands aside: two failures
    // already counted are cleared rather than made the third that pauses every save's rebuild.
    const newer = memoryLedger({ ...SWITCH, failures: 2 });
    expect(
      await handle({
        ledger: newer.store,
        cloud,
        live,
        run: async () => ({ end: "newer-rules", retryable: false, tries: 1 }),
      })
    ).toMatchObject({ line: { end: "newer-rules", settled: true }, rethrow: false });
    expect(newer.held()).toMatchObject({ failures: 0, pausedDay: null, open: null });
    // Something that moved under it is retried, and counted all the same.
    const moving = memoryLedger(SWITCH);
    const again = await handle({
      ledger: moving.store,
      cloud,
      live,
      run: async () => ({ end: "kept-moving", retryable: true, tries: 1 }),
    });
    expect(again.rethrow).toBe(true);
    expect(moving.held()?.failures).toBe(1);
  });
});

describe("when to start a fresh worker", () => {
  it("is past the heap's or the process's size, or after enough runs", () => {
    expect(shouldRecycle({ heapUsedMb: 3_072, rssMb: 6_144 }, 199)).toBe(false);
    expect(shouldRecycle({ heapUsedMb: 3_073, rssMb: 100 }, 1)).toBe(true);
    expect(shouldRecycle({ heapUsedMb: 100, rssMb: 6_145 }, 1)).toBe(true);
    expect(shouldRecycle({ heapUsedMb: 100, rssMb: 100 }, RECYCLE_AT.runs)).toBe(true);
  });
});

describe("how long a save took to reach the boards", () => {
  const ask = (copy: string, version: number) => ({
    kind: "edit" as const,
    copy,
    version,
    reset: false,
  });
  const ran = (
    copy: string,
    version: number,
    publishedAt: string,
    more: Record<string, unknown> = {}
  ) => ({ end: "published", mode: "live", wrote: true, copy, version, publishedAt, ...more });

  it("is each logged save's wait for the first live run that wrote its version or a later one", () => {
    const lines = [
      saveLineOf(ask("c", 4), "2027-04-15T10:00:00.000Z"),
      saveLineOf(ask("c", 5), "2027-04-15T10:01:00.000Z"),
      // Its own window's run was refused; the next window's covers it.
      saveLineOf(ask("c", 6), "2027-04-15T10:05:00.000Z"),
      saveLineOf(ask("c", 7), "2027-04-15T10:09:00.000Z"),
      // Covered by nothing logged here (the nightly, say): counted, not read as quick.
      saveLineOf(ask("c", 9), "2027-04-15T11:00:00.000Z"),
      // Lines in any order: the run of version 7 is logged first.
      ran("c", 7, "2027-04-15T10:11:30.000Z"),
      ran("c", 5, "2027-04-15T10:03:05.000Z"),
      // A late run of an older version, after a newer save: not that save's publish.
      ran("c", 5, "2027-04-15T10:06:00.000Z"),
      // Stamped before the save, by a clock behind the trigger's: not a wait below nothing.
      ran("c", 9, "2027-04-15T10:59:00.000Z"),
      // Not reaching anyone: a dry run, one that wrote nothing, another copy's, one before the save.
      ran("c", 9, "2027-04-15T11:01:00.000Z", { mode: "dry" }),
      ran("c", 9, "2027-04-15T11:02:00.000Z", { wrote: false }),
      ran("other", 9, "2027-04-15T11:03:00.000Z"),
      { end: "busy", copy: "c", version: 9 },
      "a line of text",
      null,
    ];
    // 10:00 → 10:03:05 is 185 s; 10:01 → 185 - 60 = 125 s; 10:05 → 10:11:30 is 390 s; 10:09 → 150 s.
    expect(liveLags(lines)).toEqual({
      saves: 5,
      unmatched: 1,
      medianS: (150 + 185) / 2,
      p90S: 390,
      maxS: 390,
    });
    expect(liveLags(lines.slice(1, 4).concat(lines.slice(5, 9)))).toMatchObject({
      saves: 3,
      unmatched: 0,
      medianS: 150,
    });
    expect(liveLags([ran("c", 1, "2027-04-15T10:00:00.000Z")])).toBeNull();
    expect(liveLags([saveLineOf(ask("c", 1), "2027-04-15T10:00:00.000Z")])).toEqual({
      saves: 1,
      unmatched: 1,
      medianS: 0,
      p90S: 0,
      maxS: 0,
    });
  });
});
