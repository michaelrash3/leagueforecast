import { describe, expect, it } from "vitest";
import { hashJson, packHashed } from "../../cloud/cloudPack";
import { openViewCache, type ViewCacheIo } from "../viewCache";

/*
 * The views a device keeps (`viewCache.ts`): every read checked against its fingerprint, the least
 * recently read going first past the limit, the meta and the last board kept for one account, and
 * nothing kept at all where the pool is not in IndexedDB.
 */

const mapIo = (enabled = true) => {
  const kept = new Map<string, unknown>();
  let clock = 0;
  const io: ViewCacheIo = {
    enabled: () => enabled,
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
  return { io, kept };
};

/** A value as a view is kept: its gzipped JSON's bytes, and the fingerprint they unzip to. */
const packed = async (value: unknown) => {
  const hashed = await hashJson(value);
  const [bytes] = await packHashed(hashed);
  if (!bytes) throw new Error("nothing packed");
  return { h: hashed.hash, bytes };
};

const VIEW = "league_forecast_live_view_v1:";
const INDEX = "league_forecast_live_index_v1";

describe("the views a device keeps", () => {
  it("reads a kept view back by its fingerprint", async () => {
    const { io } = mapIo();
    const cache = openViewCache(io);
    const board = await packed({ rows: [{ teamId: "t1" }] });
    expect(await cache.view(board.h)).toBeNull();
    await cache.keepView(board.h, board.bytes);
    expect(await cache.view(board.h)).toEqual({ rows: [{ teamId: "t1" }] });
  });

  it("deletes a kept view whose bytes no longer unzip to its fingerprint, and reads it as none", async () => {
    const { io, kept } = mapIo();
    const cache = openViewCache(io);
    const board = await packed({ rows: [1, 2, 3] });
    const other = await packed({ rows: [4] });
    await cache.keepView(board.h, board.bytes);
    await cache.keepView(other.h, other.bytes);
    // The bytes of another view under this one's fingerprint: they unzip, to the wrong value.
    kept.set(`${VIEW}${board.h}`, other.bytes);
    expect(await cache.view(board.h)).toBeNull();
    expect(kept.has(`${VIEW}${board.h}`)).toBe(false);
    expect(Object.keys(kept.get(INDEX) as object)).toEqual([other.h]);
    // Bytes that are not bytes at all, and bytes that are not gzip.
    kept.set(`${VIEW}${other.h}`, "text");
    expect(await cache.view(other.h)).toBeNull();
    expect(kept.has(`${VIEW}${other.h}`)).toBe(false);
    await cache.keepView(board.h, new Uint8Array([1, 2, 3]));
    expect(await cache.view(board.h)).toBeNull();
    expect(kept.has(`${VIEW}${board.h}`)).toBe(false);
  });

  it("lets the least recently read views go once they pass the limit, never the one just kept", async () => {
    const { io, kept } = mapIo();
    const a = await packed({ rows: ["a"] });
    const b = await packed({ rows: ["b"] });
    const c = await packed({ rows: ["c"] });
    // Room for two views of these sizes, not three.
    const cache = openViewCache(io, a.bytes.length + b.bytes.length + 1);
    await cache.keepView(a.h, a.bytes);
    await cache.keepView(b.h, b.bytes);
    // Reading `a` makes `b` the least recently read.
    expect(await cache.view(a.h)).toEqual({ rows: ["a"] });
    await cache.keepView(c.h, c.bytes);
    expect(kept.has(`${VIEW}${b.h}`)).toBe(false);
    expect(await cache.view(b.h)).toBeNull();
    expect(await cache.view(a.h)).toEqual({ rows: ["a"] });
    expect(await cache.view(c.h)).toEqual({ rows: ["c"] });
    expect(Object.keys(kept.get(INDEX) as object).sort()).toEqual([a.h, c.h].sort());
    // A view bigger than the limit on its own is still kept, as the one just kept.
    const tiny = openViewCache(io, 1);
    await tiny.keepView(b.h, b.bytes);
    expect(await tiny.view(b.h)).toEqual({ rows: ["b"] });
    expect(Object.keys(kept.get(INDEX) as object)).toEqual([b.h]);
  });

  it("keeps the meta and the last board for one account, and clears both for another", async () => {
    const { io, kept } = mapIo();
    const cache = openViewCache(io);
    const h = "a".repeat(64);
    await cache.keepMeta("uid-1", { format: 1 }, "2027-04-15T12:00:00.000Z");
    await cache.keepLastShown("uid-1", { key: "board:2027:12U:year", h });
    expect(await cache.meta("uid-1")).toEqual({
      meta: { format: 1 },
      readAt: "2027-04-15T12:00:00.000Z",
    });
    expect(await cache.lastShown("uid-1")).toEqual({ key: "board:2027:12U:year", h });
    expect(await cache.lastShown("uid-2")).toBeNull();
    expect(await cache.meta("uid-1")).toBeNull();
    expect(await cache.lastShown("uid-1")).toBeNull();
    expect([...kept.keys()]).toEqual([]);
  });

  it("keeps and reads nothing where the pool is not in IndexedDB", async () => {
    const { io, kept } = mapIo(false);
    const cache = openViewCache(io);
    const board = await packed({ rows: [] });
    await cache.keepView(board.h, board.bytes);
    await cache.keepMeta("uid-1", { format: 1 }, "x");
    await cache.keepLastShown("uid-1", { key: "k", h: board.h });
    expect(kept.size).toBe(0);
    kept.set(`${VIEW}${board.h}`, board.bytes);
    expect(await cache.view(board.h)).toBeNull();
  });

  it("clears its own keys and leaves the rest of the store alone", async () => {
    const { io, kept } = mapIo();
    const cache = openViewCache(io);
    const board = await packed({ rows: [] });
    kept.set("league_forecast_saved_board_v1", { page: "p", rows: [] });
    await cache.keepView(board.h, board.bytes);
    await cache.keepMeta("uid-1", { format: 1 }, "x");
    await cache.keepLastShown("uid-1", { key: "k", h: board.h });
    // A view's bytes the index lost track of go too.
    kept.set(`${VIEW}${"b".repeat(64)}`, board.bytes);
    await cache.clear();
    expect([...kept.keys()]).toEqual(["league_forecast_saved_board_v1"]);
  });
});
