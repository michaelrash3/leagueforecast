import { describe, expect, it, vi } from "vitest";
import {
  CloudTimeoutError,
  commitChanges,
  fetchValues,
  sweepUploads,
  timedStore,
  type Change,
  type CloudStore,
} from "../cloudEngine";
import {
  chunkId,
  chunkIdsOf,
  DATA_SCHEMA,
  MANIFEST_FORMAT,
  type CloudManifest,
  type ManifestPart,
} from "../cloudManifest";
import { CHUNK_BYTES, hashValue } from "../cloudPack";
import { memoryCloud } from "./memoryCloud";

/*
 * Moving values to the cloud copy and back, against a stand-in store. Every piece an upload makes
 * has a name of its own, and most of what is pinned here is what that buys: a deletion, however
 * late, can only take what nobody names any more.
 */

const NOW = "2026-09-29T12:00:00.000Z";
const change = (key: string, value: unknown, at = 1): Change => ({ key, value, at });

/** Text gzip cannot shrink, so a value of it takes several pieces. */
const noise = (pieces: number): string => {
  const bytes = new Uint8Array(CHUNK_BYTES * pieces);
  for (let at = 0; at < bytes.length; at += 65_536) {
    crypto.getRandomValues(bytes.subarray(at, at + 65_536));
  }
  return Array.from(bytes.subarray(0, CHUNK_BYTES * pieces * 0.6), (byte) =>
    byte.toString(36)
  ).join("");
};

const first = async (
  store: CloudStore,
  values: Record<string, unknown>,
  device = "laptop"
): Promise<CloudManifest> => {
  const result = await commitChanges({
    store,
    base: null,
    changes: Object.entries(values).map(([key, value]) => change(key, value)),
    device,
    now: NOW,
  });
  if (!result.ok) throw new Error("first copy refused");
  return result.manifest;
};

const partOf = (manifest: CloudManifest, key: string): ManifestPart => {
  const part = manifest.parts.find((one) => one.key === key);
  if (!part) throw new Error(`no part ${key}`);
  return part;
};

const valuesOf = async (store: CloudStore, manifest: CloudManifest) => {
  const fetched = await fetchValues({ store, parts: manifest.parts });
  if (!fetched.ok) throw new Error(`fetch failed: ${fetched.reason} ${fetched.key}`);
  return Object.fromEntries(fetched.values);
};

describe("a first copy", () => {
  it("stores every value, in this build's layout and schema, and brings each back as it went", async () => {
    const sky = memoryCloud();
    const values = { league: { seasons: [{ id: "fall" }] }, teams: [["t1", "Hawks"]] };
    const manifest = await first(sky.store, values);
    expect(manifest).toMatchObject({ format: MANIFEST_FORMAT, schema: DATA_SCHEMA, version: 1 });
    expect(manifest.parts.map((part) => part.key)).toEqual(["league", "teams"]);
    expect(partOf(manifest, "teams").hash).toBe(await hashValue(values.teams));
    expect(await valuesOf(sky.store, manifest)).toEqual(values);
  });

  it("is refused where a copy appeared first, and leaves no piece of its own behind", async () => {
    const sky = memoryCloud();
    await first(sky.store, { league: { seasons: [] } }, "phone");
    const before = new Set(sky.chunks.keys());
    const second = await commitChanges({
      store: sky.store,
      base: null,
      changes: [change("league", { seasons: [{ id: "other" }] })],
      device: "laptop",
      now: NOW,
    });
    expect(second).toEqual({ ok: false, reason: "moved" });
    expect(new Set(sky.chunks.keys())).toEqual(before);
  });
});

describe("a save onto the copy", () => {
  it("uploads only what changed, and names everything else as it was", async () => {
    const sky = memoryCloud();
    const v1 = await first(sky.store, { league: { a: 1 }, teams: ["t1"] });
    const result = await commitChanges({
      store: sky.store,
      base: v1,
      changes: [change("teams", ["t1", "t2"], 5)],
      device: "phone",
      now: NOW,
    });
    if (!result.ok) throw new Error("refused");
    expect(result.uploaded).toBe(1);
    expect(partOf(result.manifest, "league")).toEqual(partOf(v1, "league"));
    expect(partOf(result.manifest, "teams")).toMatchObject({ at: 5, by: "phone" });
    expect(await valuesOf(sky.store, result.manifest)).toEqual({
      league: { a: 1 },
      teams: ["t1", "t2"],
    });
  });

  it("deletes the pieces only the old version named", async () => {
    const sky = memoryCloud();
    const v1 = await first(sky.store, { league: { a: 1 }, teams: ["t1"] });
    const old = partOf(v1, "teams");
    const result = await commitChanges({
      store: sky.store,
      base: v1,
      changes: [change("teams", ["t2"])],
      device: "phone",
      now: NOW,
    });
    if (!result.ok) throw new Error("refused");
    expect(sky.chunks.has(chunkId(old.id, 0))).toBe(false);
    expect([...sky.chunks.keys()].sort()).toEqual([...chunkIdsOf(result.manifest)].sort());
  });

  it("names a value the copy already holds from its pieces, with the stored count, not this browser's", async () => {
    const sky = memoryCloud();
    const v1 = await first(sky.store, { teams: ["t1"] });
    // Another browser's gzip cut the same value into three pieces; this one would make one.
    const theirs = { ...partOf(v1, "teams"), chunks: 3 };
    sky.setManifest({ ...v1, parts: [theirs] });
    const base = sky.manifest() as CloudManifest;
    const result = await commitChanges({
      store: sky.store,
      base,
      changes: [change("games", ["t1"])],
      device: "phone",
      now: NOW,
    });
    if (!result.ok) throw new Error("refused");
    expect(result.uploaded).toBe(0);
    expect(partOf(result.manifest, "games")).toMatchObject({ id: theirs.id, chunks: 3 });
  });

  it("is refused onto a version that moved on, and clears only its own pieces", async () => {
    const sky = memoryCloud();
    const v1 = await first(sky.store, { league: { a: 1 } });
    const laptop = await commitChanges({
      store: sky.store,
      base: v1,
      changes: [change("league", { a: 2 })],
      device: "laptop",
      now: NOW,
    });
    if (!laptop.ok) throw new Error("refused");
    const phone = await commitChanges({
      store: sky.store,
      base: v1,
      changes: [change("teams", ["t9"])],
      device: "phone",
      now: NOW,
    });
    expect(phone).toEqual({ ok: false, reason: "moved" });
    expect([...sky.chunks.keys()].sort()).toEqual([...chunkIdsOf(laptop.manifest)].sort());
  });

  it("is refused onto a copy started again at the same version, since it is another copy", async () => {
    const sky = memoryCloud();
    const v1 = await first(sky.store, { league: { a: 1 } });
    sky.setManifest(null);
    await first(sky.store, { league: { a: 9 } });
    const result = await commitChanges({
      store: sky.store,
      base: v1,
      changes: [change("league", { a: 2 })],
      device: "phone",
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "moved" });
  });

  it("knows its own commit when the reply was lost, rather than taking it for another device's", async () => {
    const sky = memoryCloud();
    const v1 = await first(sky.store, { league: { a: 1 } });
    const lossy: CloudStore = {
      ...sky.store,
      commitManifest: async (expected, next) => {
        await sky.store.commitManifest(expected, next);
        return false;
      },
    };
    const result = await commitChanges({
      store: lossy,
      base: v1,
      changes: [change("league", { a: 2 })],
      device: "phone",
      now: NOW,
    });
    expect(result.ok).toBe(true);
    expect(await valuesOf(sky.store, sky.manifest() as CloudManifest)).toEqual({
      league: { a: 2 },
    });
  });

  /*
   * The reply lost, the retried transaction finds the version moved on (by this very save), and
   * before this device reads the copy back to check, another device saves onto it. The copy it
   * reads names this save's pieces, since the other device's save kept them.
   */
  it("leaves the pieces a newer copy still names when its reply was lost and another saved on top", async () => {
    const sky = memoryCloud();
    const v1 = await first(sky.store, { league: { a: 1 } });
    const lossy: CloudStore = {
      ...sky.store,
      commitManifest: async (expected, next) => {
        await sky.store.commitManifest(expected, next);
        const laptop = await commitChanges({
          store: sky.store,
          base: sky.manifest(),
          changes: [change("teams", ["laptop"], 3)],
          device: "laptop",
          now: NOW,
        });
        if (!laptop.ok) throw new Error("the laptop's save was refused");
        return false;
      },
    };
    const phone = await commitChanges({
      store: lossy,
      base: v1,
      changes: [change("league", { a: 2 }, 2)],
      device: "phone",
      now: NOW,
    });
    expect(phone).toEqual({ ok: false, reason: "moved" });
    expect(await valuesOf(sky.store, sky.manifest() as CloudManifest)).toEqual({
      league: { a: 2 },
      teams: ["laptop"],
    });
  });

  it("keeps its pieces when it cannot tell whether its commit landed", async () => {
    const sky = memoryCloud();
    const v1 = await first(sky.store, { league: { a: 1 } });
    const blind: CloudStore = {
      ...sky.store,
      commitManifest: async () => false,
      readManifest: async () => {
        throw new Error("offline");
      },
    };
    const recorded: string[][] = [];
    const result = await commitChanges({
      store: blind,
      base: v1,
      changes: [change("teams", ["t1"])],
      device: "phone",
      now: NOW,
      onUploads: (ids) => recorded.push(ids),
    });
    expect(result).toEqual({ ok: false, reason: "moved" });
    const ids = recorded[recorded.length - 1] ?? [];
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => sky.chunks.has(id))).toBe(true);
  });

  it("writes no manifest when nothing is different", async () => {
    const sky = memoryCloud();
    const v1 = await first(sky.store, { league: { a: 1 } });
    const writes = sky.costs.writes;
    const result = await commitChanges({
      store: sky.store,
      base: v1,
      changes: [change("league", { a: 1 }, 99)],
      device: "phone",
      now: NOW,
    });
    expect(result).toMatchObject({ ok: true, uploaded: 0 });
    expect(sky.costs.writes).toBe(writes);
    expect(sky.manifest()?.version).toBe(1);
  });

  it("takes a key out of the copy, and its pieces with it", async () => {
    const sky = memoryCloud();
    const v1 = await first(sky.store, { league: { a: 1 }, archive: ["x"] });
    const result = await commitChanges({
      store: sky.store,
      base: v1,
      changes: [change("archive", null)],
      device: "phone",
      now: NOW,
    });
    if (!result.ok) throw new Error("refused");
    expect(result.manifest.parts.map((part) => part.key)).toEqual(["league"]);
    expect(result.sent).toEqual({ archive: null });
    expect(sky.chunks.has(chunkId(partOf(v1, "archive").id, 0))).toBe(false);
  });
});

describe("a save that fell asleep after its commit", () => {
  it("cannot delete a piece a later copy uploaded, even of the same value", async () => {
    const sky = memoryCloud();
    const v1 = await first(sky.store, { cadence: "weekly", league: { a: 1 } });
    // The phone sets daily; its save commits, then is frozen before its deletes.
    const release = sky.holdDeletes();
    const phone = commitChanges({
      store: sky.store,
      base: v1,
      changes: [change("cadence", "daily")],
      device: "phone",
      now: NOW,
    });
    await vi.waitFor(() => expect(sky.manifest()?.version).toBe(2));
    // The laptop sets it back: the same value as the first copy's, uploaded again.
    const laptop = await (async () => {
      const done = commitChanges({
        store: sky.store,
        base: sky.manifest(),
        changes: [change("cadence", "weekly")],
        device: "laptop",
        now: NOW,
      });
      // Its own deletes are held too, until the phone wakes.
      await vi.waitFor(() => expect(sky.manifest()?.version).toBe(3));
      release();
      return done;
    })();
    await phone;
    if (!laptop.ok) throw new Error("refused");
    expect(await valuesOf(sky.store, laptop.manifest)).toEqual({
      cadence: "weekly",
      league: { a: 1 },
    });
  });
});

describe("kept versions", () => {
  it("keeps the copy's value, pieces and all, when a later change here replaces it", async () => {
    const sky = memoryCloud();
    const v1 = await first(sky.store, { teams: ["laptop's pull"] });
    const result = await commitChanges({
      store: sky.store,
      base: v1,
      changes: [change("teams", ["phone's edit"], 9)],
      keepReplaced: ["teams"],
      device: "phone",
      now: NOW,
    });
    if (!result.ok) throw new Error("refused");
    const [kept] = result.manifest.kept;
    expect(kept).toMatchObject({ key: "teams", why: "replaced", keptAt: NOW });
    const back = await fetchValues({ store: sky.store, parts: result.manifest.kept });
    expect(back.ok && back.values.get("teams")).toEqual(["laptop's pull"]);
  });

  it("keeps a value of this device's the copy's will replace here", async () => {
    const sky = memoryCloud();
    const v1 = await first(sky.store, { teams: ["cloud's"] });
    const result = await commitChanges({
      store: sky.store,
      base: v1,
      keepLost: [change("teams", ["this phone's"], 3)],
      device: "phone",
      now: NOW,
    });
    if (!result.ok) throw new Error("refused");
    expect(result.manifest.parts).toEqual(v1.parts);
    expect(result.manifest.kept).toMatchObject([{ key: "teams", why: "lost", by: "phone", at: 3 }]);
  });

  it("keeps a value once, however many settlements would keep it again", async () => {
    const sky = memoryCloud();
    const v1 = await first(sky.store, { teams: ["cloud's"] });
    const once = await commitChanges({
      store: sky.store,
      base: v1,
      keepLost: [change("teams", ["this phone's"], 3)],
      device: "phone",
      now: NOW,
    });
    if (!once.ok) throw new Error("refused");
    const twice = await commitChanges({
      store: sky.store,
      base: once.manifest,
      keepLost: [change("teams", ["this phone's"], 3)],
      device: "phone",
      now: NOW,
    });
    if (!twice.ok) throw new Error("refused");
    expect(twice.manifest.kept).toHaveLength(1);
    expect(twice.manifest.version).toBe(once.manifest.version);
  });

  it("brings a kept version back whole, keeping what it replaces, and uploads nothing", async () => {
    const sky = memoryCloud();
    const v1 = await first(sky.store, { teams: ["old"], league: { a: 1 } });
    const v2 = await commitChanges({
      store: sky.store,
      base: v1,
      changes: [change("teams", ["new"], 9)],
      keepReplaced: ["teams"],
      device: "phone",
      now: NOW,
    });
    if (!v2.ok) throw new Error("refused");
    const group = v2.manifest.kept[0]?.group ?? "";
    const writes = sky.costs.writes;
    const v3 = await commitChanges({
      store: sky.store,
      base: v2.manifest,
      restore: group,
      device: "laptop",
      now: "2026-09-30T00:00:00.000Z",
    });
    if (!v3.ok) throw new Error("refused");
    expect(sky.costs.writes).toBe(writes + 1);
    expect(await valuesOf(sky.store, v3.manifest)).toEqual({ teams: ["old"], league: { a: 1 } });
    expect(v3.manifest.kept.map((part) => part.group)).not.toContain(group);
    const again = await fetchValues({ store: sky.store, parts: v3.manifest.kept });
    expect(again.ok && again.values.get("teams")).toEqual(["new"]);
  });

  it("lets a kept version go after thirty days, and its pieces with it", async () => {
    const sky = memoryCloud();
    const v1 = await first(sky.store, { teams: ["old"] });
    const v2 = await commitChanges({
      store: sky.store,
      base: v1,
      changes: [change("teams", ["new"])],
      keepReplaced: ["teams"],
      device: "phone",
      now: NOW,
    });
    if (!v2.ok) throw new Error("refused");
    const keptId = v2.manifest.kept[0]?.id ?? "";
    const later = await commitChanges({
      store: sky.store,
      base: v2.manifest,
      changes: [change("league", { a: 1 })],
      device: "phone",
      now: "2026-10-30T12:00:01.000Z",
    });
    if (!later.ok) throw new Error("refused");
    expect(later.manifest.kept).toEqual([]);
    expect(sky.chunks.has(chunkId(keptId, 0))).toBe(false);
  });
});

describe("pieces left by an upload that never committed", () => {
  it("are cleared, and pieces the copy names are not", async () => {
    const sky = memoryCloud();
    const v1 = await first(sky.store, { teams: ["t1"] });
    sky.chunks.set("deadbeefdeadbeefdeadbeefdeadbeef-0", new Uint8Array([1]));
    const named = chunkId(partOf(v1, "teams").id, 0);
    await sweepUploads(sky.store, v1, ["deadbeefdeadbeefdeadbeefdeadbeef-0", named]);
    expect(sky.chunks.has("deadbeefdeadbeefdeadbeefdeadbeef-0")).toBe(false);
    expect(sky.chunks.has(named)).toBe(true);
  });
});

describe("taking values from the copy", () => {
  it("brings back a value too large for one piece", async () => {
    const sky = memoryCloud();
    const big = noise(3);
    const v1 = await first(sky.store, { teams: big });
    expect(partOf(v1, "teams").chunks).toBeGreaterThan(1);
    expect((await valuesOf(sky.store, v1)).teams).toBe(big);
  }, 60_000);

  it("says a piece is missing, and returns nothing", async () => {
    const sky = memoryCloud();
    const v1 = await first(sky.store, { league: { a: 1 }, teams: ["t1"] });
    sky.chunks.delete(chunkId(partOf(v1, "teams").id, 0));
    expect(await fetchValues({ store: sky.store, parts: v1.parts })).toEqual({
      ok: false,
      reason: "missing",
      key: "teams",
    });
  });

  it("refuses pieces that do not make the value the manifest names", async () => {
    const sky = memoryCloud();
    const v1 = await first(sky.store, { league: { a: 1 }, teams: ["t1"] });
    const other = await first(memoryCloud().store, { teams: ["t2"] });
    // Pieces that unpack, but to another value.
    const liar = { ...partOf(v1, "teams"), hash: partOf(other, "teams").hash };
    expect(await fetchValues({ store: sky.store, parts: [liar] })).toMatchObject({
      ok: false,
      reason: "damaged",
    });
    sky.chunks.set(chunkId(partOf(v1, "teams").id, 0), new Uint8Array([1, 2, 3]));
    expect(await fetchValues({ store: sky.store, parts: v1.parts })).toMatchObject({
      reason: "damaged",
      key: "teams",
    });
  });
});

describe("a store call that stalls", () => {
  it("is given up on after its limit, rather than holding the device for ever", async () => {
    vi.useFakeTimers();
    try {
      const stalled: CloudStore = {
        ...memoryCloud().store,
        readManifest: () => new Promise(() => {}),
      };
      const reading = timedStore(stalled, { manifest: 1_000, chunk: 1_000 }).readManifest();
      const caught = reading.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(1_001);
      expect(await caught).toBeInstanceOf(CloudTimeoutError);
    } finally {
      vi.useRealTimers();
    }
  });
});
