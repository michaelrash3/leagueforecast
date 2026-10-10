import { beforeEach, describe, expect, it } from "vitest";
import type { CloudManifest, ManifestPart } from "../../cloud/cloudManifest";
import { chunkId } from "../../cloud/cloudManifest";
import { LEAGUE_PART } from "../../cloud/cloudPlan";
import type { CopySeen } from "../../cloud/cloudSession";
import { BOARD_FAMILY, builtFrom } from "../boardInputs";
import {
  boardStanding,
  checkLiveMeta,
  forgetDecodedBoards,
  readBoard,
  readLive,
  type LiveRead,
} from "../liveClient";
import { openViewCache, type ViewCache, type ViewCacheIo } from "../viewCache";
import {
  LIVE_FORMAT,
  LIVE_SCHEMA,
  publishViews,
  type LiveMeta,
  type LiveReader,
  type PublishedView,
} from "../viewStore";
import type { BoardRow, LivePages } from "../views/boardShape";
import { memoryLive, type MemoryLive } from "./memoryLive";

/*
 * How a member's device reads the published boards (`liveClient.ts`): the meta checked before a
 * page is laid out by it, a board's pieces checked against its fingerprint and its shape before a
 * row is drawn, one read of the meta again for a piece that is gone, a refusal clearing what the
 * device kept, and whether the board is the copy's as the device last found it.
 */

const TODAY = "2027-04-15";
const T = "2027-04-15T12:00:00.000Z";

const row = (teamId: string, rank: number, more: Partial<BoardRow> = {}): BoardRow => ({
  teamId,
  teamName: `Placeholder ${teamId}`,
  rank,
  rating: 5 - rank,
  pointRating: 6 - rank,
  record: "3-1",
  wins: 3,
  losses: 1,
  ties: 0,
  games: 4,
  rawMargin: 1.5,
  strengthOfSchedule: 0.2,
  sosRank: rank,
  crossAgeGames: 0,
  componentSize: 40,
  componentId: "t1",
  comparable: true,
  fromGameChanger: true,
  ...more,
});

const BOARD_A = { rows: [row("t1", 1, { city: "Springfield", state: "OH" }), row("t2", 2)] };
const BOARD_B = { rows: [row("t3", 1, { league: true })] };
const PAGES: LivePages = {
  pulledAt: "2027-04-15T07:00:00.000Z",
  halves: { "12U": { fall: 10, spring: 20 } },
};

const h = (n: number) => n.toString(16).padStart(64, "0");
const part = (key: string, hash: string): ManifestPart => ({
  key,
  hash,
  bytes: 10,
  chunks: 1,
  id: "0123456789abcdef",
  at: 1,
  by: "phone",
});
const PARTS = [
  part(LEAGUE_PART, h(1)),
  part("league_forecast_scout_teams_v1", h(2)),
  part("league_forecast_gc_refresh_v1", h(3)),
];
const manifest = (parts = PARTS): CloudManifest => ({
  format: 2,
  schema: 1,
  copy: "c0ffee",
  version: 4,
  save: "s",
  updatedAt: T,
  device: "phone",
  parts,
  kept: [],
});
const seenOf = (copy: CloudManifest): CopySeen => ({
  copy: copy.copy,
  version: copy.version,
  parts: copy.parts.map((one) => [one.key, one.hash] as const),
});

const publish = async (
  live: MemoryLive,
  views: PublishedView[],
  { version = 4, pages = PAGES }: { version?: number; pages?: LivePages } = {}
) =>
  publishViews({
    store: live.store,
    views,
    owns: [BOARD_FAMILY],
    copy: { id: "c0ffee", version },
    today: TODAY,
    now: T,
    built: { family: BOARD_FAMILY, from: await builtFrom(manifest(), TODAY) },
    inline: { pages },
  });

/** `live/` as a device reads it, counting the reads, with a failure to throw when one is set. */
const readerOf = (live: MemoryLive) => {
  const counts = { meta: 0, pieces: 0 };
  const failing: { meta: unknown; pieces: unknown } = { meta: null, pieces: null };
  const reader: LiveReader = {
    readMeta: async () => {
      counts.meta += 1;
      if (failing.meta) throw failing.meta;
      return (await live.store.readMeta())?.meta ?? null;
    },
    getChunk: async (id) => {
      counts.pieces += 1;
      if (failing.pieces) throw failing.pieces;
      return live.store.getChunk(id);
    },
  };
  return { reader, counts, failing };
};

const mapCache = (): { cache: ViewCache; kept: Map<string, unknown> } => {
  const kept = new Map<string, unknown>();
  let clock = 0;
  const io: ViewCacheIo = {
    enabled: () => true,
    keys: async () => [...kept.keys()],
    get: async (key) => kept.get(key) ?? null,
    set: async (key, value) => {
      kept.set(key, value);
      return true;
    },
    remove: async (key) => {
      kept.delete(key);
    },
    now: () => (clock += 1),
  };
  return { cache: openViewCache(io), kept };
};

const metaOf = (read: LiveRead): LiveMeta => {
  if (!read.ok) throw new Error(`no meta: ${read.why}`);
  return read.meta;
};

const KEY_A = "board:2027:12U:year";
const KEY_B = "board:2027:12U:fall";

let live: MemoryLive;
beforeEach(async () => {
  forgetDecodedBoards();
  live = memoryLive();
  await publish(live, [
    { key: KEY_A, value: BOARD_A },
    { key: KEY_B, value: BOARD_B },
  ]);
});

describe("reading the meta", () => {
  it("lays a page out by a meta of this build's schema, with the pages' counts", async () => {
    const { reader } = readerOf(live);
    const read = await readLive(reader);
    expect(read).toMatchObject({ ok: true, pages: PAGES });
    expect(Object.keys(metaOf(read).views)).toEqual([KEY_B, KEY_A]);
  });

  it("says why it cannot: none, another schema or format, or no pages it can read", () => {
    const stored = live.meta();
    // With the copy a meta of this layout names, which an edit is made on though the boards are
    // not drawn (`useLiveBoard`); none where the layout is not this build's or will not read.
    const copy = stored?.copy;
    expect(copy?.id).toMatch(/\S/);
    expect(checkLiveMeta(null)).toEqual({ ok: false, why: "none" });
    expect(checkLiveMeta({ ...stored, schema: LIVE_SCHEMA - 1 })).toEqual({
      ok: false,
      why: "older",
      copy,
    });
    expect(checkLiveMeta({ ...stored, schema: LIVE_SCHEMA + 1 })).toEqual({
      ok: false,
      why: "newer",
      copy,
    });
    expect(checkLiveMeta({ ...stored, format: LIVE_FORMAT + 1 })).toEqual({
      ok: false,
      why: "newer",
    });
    expect(checkLiveMeta({ ...stored, views: { [KEY_A]: { h: "short" } } })).toEqual({
      ok: false,
      why: "unreadable",
    });
    expect(checkLiveMeta({ ...stored, inline: {} })).toEqual({
      ok: false,
      why: "unreadable",
      copy,
    });
    expect(
      checkLiveMeta({
        ...stored,
        inline: { pages: { halves: { "12U": { fall: -1, spring: 0 } } } },
      })
    ).toEqual({ ok: false, why: "unreadable", copy });
    expect(checkLiveMeta("meta")).toEqual({ ok: false, why: "unreadable" });
  });

  it("clears what the device kept when the rules refuse this account, and only then", async () => {
    const { reader, failing } = readerOf(live);
    const { cache, kept } = mapCache();
    await readBoard({ reader, meta: metaOf(await readLive(reader)), key: KEY_A, cache });
    expect(kept.size).toBeGreaterThan(0);
    failing.meta = { code: "unavailable" };
    expect(await readLive(reader, cache)).toEqual({ ok: false, why: "offline" });
    failing.meta = new Error("timed out");
    expect(await readLive(reader, cache)).toEqual({ ok: false, why: "offline" });
    expect(kept.size).toBeGreaterThan(0);
    failing.meta = { code: "permission-denied" };
    expect(await readLive(reader, cache)).toEqual({ ok: false, why: "refused" });
    expect(kept.size).toBe(0);
  });
});

describe("reading a board", () => {
  it("reads the board the meta names, checked, from the network, then from memory", async () => {
    const { reader, counts } = readerOf(live);
    const meta = metaOf(await readLive(reader));
    const read = await readBoard({ reader, meta, key: KEY_A });
    expect(read).toMatchObject({ ok: true, from: "network", meta });
    expect(read.ok && read.view).toStrictEqual(BOARD_A);
    expect(counts.pieces).toBe(meta.views[KEY_A]?.c);
    const again = await readBoard({ reader, meta, key: KEY_A });
    expect(again).toMatchObject({ ok: true, from: "memory" });
    expect(again.ok && again.view).toStrictEqual(BOARD_A);
    expect(counts.pieces).toBe(meta.views[KEY_A]?.c);
  });

  it("costs no piece read for a board the device kept, from a page load before", async () => {
    const { reader, counts } = readerOf(live);
    const { cache } = mapCache();
    const meta = metaOf(await readLive(reader));
    await readBoard({ reader, meta, key: KEY_A, cache });
    const fetched = counts.pieces;
    forgetDecodedBoards();
    const read = await readBoard({ reader, meta, key: KEY_A, cache });
    expect(read).toMatchObject({ ok: true, from: "cache" });
    expect(read.ok && read.view).toStrictEqual(BOARD_A);
    expect(counts.pieces).toBe(fetched);
  });

  it("says a board the meta does not name is missing, without a read", async () => {
    const { reader, counts } = readerOf(live);
    const meta = metaOf(await readLive(reader));
    const read = await readBoard({ reader, meta, key: "board:2027:13U:year" });
    expect(read).toEqual({ ok: false, why: "missing", meta });
    expect(counts).toEqual({ meta: 1, pieces: 0 });
  });

  it("reads the meta again once for a piece that is gone, and says gone if it is still", async () => {
    const { reader, counts } = readerOf(live);
    const meta = metaOf(await readLive(reader));
    const entry = meta.views[KEY_A];
    if (!entry) throw new Error("no entry");
    live.chunks.delete(chunkId(entry.id, 0));
    const read = await readBoard({ reader, meta, key: KEY_A });
    expect(read).toMatchObject({ ok: false, why: "gone" });
    expect(counts.meta).toBe(2);
  });

  it("follows the board to its new upload when the meta read again names one", async () => {
    const { reader, counts } = readerOf(live);
    const meta = metaOf(await readLive(reader));
    const entry = meta.views[KEY_A];
    if (!entry) throw new Error("no entry");
    // A later publish moved the board on, and a sweep took the old upload's pieces.
    const moved = { rows: [row("t2", 1), row("t1", 2)] };
    await publish(
      live,
      [
        { key: KEY_A, value: moved },
        { key: KEY_B, value: BOARD_B },
      ],
      {
        version: 5,
      }
    );
    live.chunks.delete(chunkId(entry.id, 0));
    const read = await readBoard({ reader, meta, key: KEY_A });
    expect(read).toMatchObject({ ok: true, from: "network" });
    expect(read.ok && read.view).toStrictEqual(moved);
    expect(read.meta.copy.version).toBe(5);
    expect(counts.meta).toBe(2);
  });

  it("never draws or keeps a board whose bytes are not the ones its fingerprint names", async () => {
    const { reader } = readerOf(live);
    const { cache, kept } = mapCache();
    const meta = metaOf(await readLive(reader));
    const entry = meta.views[KEY_A];
    const other = meta.views[KEY_B];
    if (!entry || !other) throw new Error("no entry");
    const piece = live.chunks.get(chunkId(entry.id, 0));
    const otherPiece = live.chunks.get(chunkId(other.id, 0));
    if (!piece || !otherPiece) throw new Error("no piece");
    const original = piece.data;
    // Another board's pieces under this one's upload: good gzip, a good board, the wrong one.
    piece.data = otherPiece.data;
    expect(await readBoard({ reader, meta, key: KEY_A, cache })).toMatchObject({
      ok: false,
      why: "damaged",
    });
    // One byte changed: it no longer unzips.
    const tampered = new Uint8Array(original);
    const at = tampered.length - 9;
    tampered[at] = (tampered[at] ?? 0) ^ 1;
    piece.data = tampered;
    expect(await readBoard({ reader, meta, key: KEY_A, cache })).toMatchObject({
      ok: false,
      why: "damaged",
    });
    expect([...kept.keys()].filter((key) => key.includes(entry.h))).toEqual([]);
    // The pieces put back, it reads.
    piece.data = original;
    expect(await readBoard({ reader, meta, key: KEY_A, cache })).toMatchObject({ ok: true });
  });

  it("never draws a board whose checked bytes are not rows a board can draw", async () => {
    live = memoryLive();
    await publish(live, [{ key: KEY_A, value: { rows: [{ ...row("t1", 1), rank: "1" }] } }]);
    const { reader } = readerOf(live);
    const meta = metaOf(await readLive(reader));
    expect(await readBoard({ reader, meta, key: KEY_A })).toMatchObject({
      ok: false,
      why: "damaged",
    });
  });

  it("says offline for a failed piece read, and clears what was kept for a refused one", async () => {
    const { reader, failing } = readerOf(live);
    const { cache, kept } = mapCache();
    const meta = metaOf(await readLive(reader));
    await readBoard({ reader, meta, key: KEY_B, cache });
    failing.pieces = { code: "unavailable" };
    expect(await readBoard({ reader, meta, key: KEY_A, cache })).toMatchObject({
      ok: false,
      why: "offline",
    });
    expect(kept.size).toBeGreaterThan(0);
    failing.pieces = { code: "permission-denied" };
    expect(await readBoard({ reader, meta, key: KEY_A, cache })).toMatchObject({
      ok: false,
      why: "refused",
    });
    expect(kept.size).toBe(0);
  });
});

describe("whether a board is the copy's as this device found it", () => {
  const metaWith = async (built: Partial<LiveMeta["built"][string]> = {}): Promise<LiveMeta> => {
    const stored = live.meta();
    if (!stored) throw new Error("no meta");
    const from = stored.built[BOARD_FAMILY];
    if (!from) throw new Error("no record");
    return { ...stored, built: { [BOARD_FAMILY]: { ...from, ...built } } };
  };

  it("is current when built from the very board inputs the copy held", async () => {
    const meta = await metaWith();
    expect(await boardStanding({ meta, seen: seenOf(manifest()), owed: [] })).toBe("current");
    // A part no board reads moving, or the copy's version, changes nothing.
    const other = manifest(PARTS.map((one, at) => (at === 2 ? { ...one, hash: h(9) } : one)));
    expect(await boardStanding({ meta, seen: { ...seenOf(other), version: 9 }, owed: [] })).toBe(
      "current"
    );
  });

  it("is current when built from a later version of the copy than this device holds", async () => {
    // This page's own edit, sent through the server, is in the copy and on the board, and not yet
    // in what this device read: handing over would open a copy without it.
    const before = manifest(PARTS.map((one, at) => (at === 1 ? { ...one, hash: h(9) } : one)));
    const meta = await metaWith({ v: 5 });
    expect(await boardStanding({ meta, seen: seenOf(before), owed: [] })).toBe("current");
    // Of another copy (started again since) at a later version, it vouches for nothing here.
    expect(
      await boardStanding({ meta, seen: { ...seenOf(before), copy: "another" }, owed: [] })
    ).toBe("behind-copy");
  });

  it("is behind the copy when an input moved, or no one build vouches for the boards", async () => {
    const moved = manifest(PARTS.map((one, at) => (at === 1 ? { ...one, hash: h(9) } : one)));
    expect(await boardStanding({ meta: await metaWith(), seen: seenOf(moved), owed: [] })).toBe(
      "behind-copy"
    );
    // Moved past the version the board was built from.
    expect(
      await boardStanding({
        meta: await metaWith(),
        seen: { ...seenOf(moved), version: 5 },
        owed: [],
      })
    ).toBe("behind-copy");
    const floor = await metaWith({ k: "", v: 0, inputs: "" });
    expect(await boardStanding({ meta: floor, seen: seenOf(manifest()), owed: [] })).toBe(
      "behind-copy"
    );
    const none = { ...(await metaWith()), built: {} };
    expect(await boardStanding({ meta: none, seen: seenOf(manifest()), owed: [] })).toBe(
      "behind-copy"
    );
  });

  it("is owed when this device has unsaved changes to a board input, and only to one", async () => {
    const meta = await metaWith();
    const seen = seenOf(manifest());
    expect(await boardStanding({ meta, seen, owed: [LEAGUE_PART] })).toBe("owed");
    expect(
      await boardStanding({ meta, seen: null, owed: ["league_forecast_scout_teams_v1"] })
    ).toBe("owed");
    expect(await boardStanding({ meta, seen, owed: ["league_forecast_gc_refresh_v1"] })).toBe(
      "current"
    );
  });

  it("is unknown before this device has read the copy", async () => {
    expect(await boardStanding({ meta: await metaWith(), seen: null, owed: [] })).toBe("unknown");
  });
});
