import { describe, expect, it, vi } from "vitest";
import {
  changedOnBothSides,
  chunkId,
  decideOnOpen,
  MANIFEST_FORMAT,
  type CloudManifest,
} from "../cloudManifest";
import {
  matchesCloud,
  sendLocal,
  takeCloud,
  withoutSent,
  type CloudStore,
  type LocalSource,
  type SaveMode,
  type SyncState,
} from "../cloudEngine";
import { CHUNK_BYTES, hashValue } from "../cloudPack";

/*
 * Keeping this browser's data in the cloud: what is sent, what is fetched, and above all what is
 * never lost without somebody choosing to lose it. Firestore and the browser's stores are stood in
 * for by maps; the rules are the same ones the app runs.
 */

/** A cloud copy in memory, counting what it is asked to do. */
const cloud = () => {
  let manifest: CloudManifest | null = null;
  const chunks = new Map<string, Uint8Array>();
  const calls = { put: 0, get: 0, del: 0, commit: 0 };
  const store: CloudStore = {
    readManifest: async () => (manifest ? structuredClone(manifest) : null),
    commitManifest: async (expected, next) => {
      calls.commit += 1;
      if ((manifest?.version ?? null) !== expected) return false;
      manifest = structuredClone(next);
      return true;
    },
    putChunk: async (id, data) => {
      calls.put += 1;
      chunks.set(id, new Uint8Array(data));
    },
    getChunk: async (id) => {
      calls.get += 1;
      return chunks.get(id) ?? null;
    },
    deleteChunk: async (id) => {
      calls.del += 1;
      chunks.delete(id);
    },
  };
  return {
    store,
    calls,
    chunks,
    manifest: () => manifest,
    /** Another device's save, landing between this one's read and its write. */
    moveOn: () => {
      if (manifest) manifest = { ...manifest, version: manifest.version + 1 };
    },
  };
};

/** A browser's stored keys in memory. */
const device = (entries: Record<string, unknown>) => {
  const values = new Map<string, unknown>(Object.entries(entries));
  const reads: string[] = [];
  const local: LocalSource = {
    keys: () => [...values.keys()],
    read: async (key) => {
      reads.push(key);
      return values.get(key) ?? null;
    },
    apply: vi.fn(async (next: ReadonlyMap<string, unknown>) => {
      next.forEach((value, key) => {
        if (value === null) values.delete(key);
        else values.set(key, value);
      });
      return true;
    }),
    usable: () => true,
  };
  return { local, values, reads };
};

const fresh: SyncState = { version: null, copy: null, hashes: {}, dirty: {} };
const NOW = "2026-09-28T23:00:00.000Z";

const league = { seasons: [{ id: "s1", name: "Fall", teams: ["Hawks"] }] };
const teams = { v: 3, names: ["Hawks", "Owls", "Rays"] };
const games2027 = { v: 1, rows: [["g1", "Hawks", "Owls"]] };

const save = (
  sky: ReturnType<typeof cloud>,
  local: LocalSource,
  state: SyncState,
  mode: SaveMode,
  name = "laptop"
) => sendLocal({ store: sky.store, local, state, device: name, now: NOW, mode });

/** A copy saved by a laptop holding three values, and the laptop's state after. */
const saved = async () => {
  const sky = cloud();
  const laptop = device({ league, teams, games2027 });
  const first = await save(sky, laptop.local, fresh, "first");
  if (!first.ok) throw new Error("the first save did not land");
  sky.calls.put = 0;
  sky.calls.del = 0;
  laptop.reads.length = 0;
  return { sky, laptop, state: first.state };
};

describe("the first save from a device with data", () => {
  it("sends every value, names each, and starts a copy of its own", async () => {
    const { sky, state } = await saved();
    const manifest = sky.manifest();
    expect(manifest).toMatchObject({
      format: MANIFEST_FORMAT,
      version: 1,
      device: "laptop",
      updatedAt: NOW,
    });
    expect(manifest?.copy).toMatch(/.{8,}/);
    expect(manifest?.parts.map((part) => part.key)).toEqual(["league", "teams", "games2027"]);
    expect(state).toMatchObject({ version: 1, copy: manifest?.copy, dirty: {}, syncedAt: NOW });
    expect(state.hashes.teams).toBe(await hashValue(teams));
  });

  it("is refused when another device made the first copy first", async () => {
    const { sky } = await saved();
    const phone = device({ league: { seasons: [] } });
    expect(await save(sky, phone.local, fresh, "first", "phone")).toEqual({
      ok: false,
      reason: "moved",
    });
    expect(sky.manifest()?.device).toBe("laptop");
  });
});

describe("a later save", () => {
  it("reads and sends only what changed here, and carries the rest as it is", async () => {
    const { sky, laptop, state } = await saved();
    laptop.values.set("league", { seasons: [] });
    const result = await save(sky, laptop.local, { ...state, dirty: { league: 5 } }, "patch");
    expect(result).toMatchObject({ ok: true, sent: { league: 5 }, uploaded: 1 });
    expect(laptop.reads).toEqual(["league"]);
    expect(sky.manifest()?.parts.map((part) => part.key)).toEqual(["league", "teams", "games2027"]);
    expect(sky.manifest()?.version).toBe(2);
  });

  it("never drops a value only because this device cannot find it", async () => {
    // A device whose Team Rankings store did not open lists nothing but its seasons.
    const { sky, laptop, state } = await saved();
    laptop.values.delete("teams");
    laptop.values.delete("games2027");
    laptop.values.set("league", { seasons: [] });
    const before = sky.manifest()!;
    const result = await save(sky, laptop.local, { ...state, dirty: { league: 5 } }, "patch");
    expect(result.ok).toBe(true);
    const after = sky.manifest()!;
    expect(after.parts.map((part) => part.key)).toEqual(["league", "teams", "games2027"]);
    expect(after.parts.find((part) => part.key === "teams")).toEqual(
      before.parts.find((part) => part.key === "teams")
    );
    for (const part of after.parts) expect(sky.chunks.has(chunkId(part.hash, 0))).toBe(true);
  });

  it("sends nothing when a value this device lists cannot be read", async () => {
    const { sky, laptop, state } = await saved();
    const read = laptop.local.read;
    laptop.local.read = async (key) => (key === "teams" ? null : read(key));
    await expect(
      save(sky, laptop.local, { ...state, dirty: { teams: 1, league: 2 } }, "patch")
    ).rejects.toThrow(/could not read/);
    expect(sky.manifest()?.version).toBe(1);
    expect(sky.manifest()?.parts.map((part) => part.key)).toEqual(["league", "teams", "games2027"]);
  });

  it("drops a value this device recorded removing, and the pieces only it named", async () => {
    const { sky, laptop, state } = await saved();
    const gone = sky.manifest()!.parts.find((part) => part.key === "games2027")!;
    laptop.values.delete("games2027");
    const result = await save(sky, laptop.local, { ...state, dirty: { games2027: 7 } }, "patch");
    expect(result.ok).toBe(true);
    expect(sky.manifest()?.parts.map((part) => part.key)).toEqual(["league", "teams"]);
    expect(sky.chunks.has(chunkId(gone.hash, 0))).toBe(false);
  });

  it("writes no manifest when nothing is actually different", async () => {
    const { sky, laptop, state } = await saved();
    sky.calls.commit = 0;
    const result = await save(sky, laptop.local, { ...state, dirty: { teams: 3 } }, "patch");
    expect(result).toMatchObject({ ok: true, uploaded: 0, sent: { teams: 3 } });
    expect(sky.calls).toMatchObject({ commit: 0, put: 0 });
  });

  it("overwrites nothing when another device saved since", async () => {
    const { sky, laptop, state } = await saved();
    sky.moveOn();
    laptop.values.set("league", { seasons: [] });
    expect(await save(sky, laptop.local, { ...state, dirty: { league: 1 } }, "patch")).toEqual({
      ok: false,
      reason: "moved",
    });
    expect(sky.calls.put).toBe(0);
  });

  it("overwrites nothing on a copy it never met, whatever its version", async () => {
    const { sky, laptop, state } = await saved();
    laptop.values.set("league", { seasons: [] });
    const elsewhere = { ...state, copy: "another-copy", dirty: { league: 1 } };
    expect(await save(sky, laptop.local, elsewhere, "patch")).toEqual({
      ok: false,
      reason: "moved",
    });
  });

  it("finds nothing to patch when the copy is gone", async () => {
    const { sky, laptop, state } = await saved();
    const empty = cloud();
    expect(await save(empty, laptop.local, { ...state, dirty: { league: 1 } }, "patch")).toEqual({
      ok: false,
      reason: "gone",
    });
    expect(sky.manifest()).not.toBeNull();
  });

  it("clears away the pieces of a save that lands too late", async () => {
    const { sky, laptop, state } = await saved();
    laptop.values.set("league", { seasons: [{ id: "s9", name: "New" }] });
    const commit = sky.store.commitManifest;
    sky.store.commitManifest = async (expected, next) => {
      sky.moveOn();
      return commit(expected, next);
    };
    const result = await save(sky, laptop.local, { ...state, dirty: { league: 1 } }, "patch");
    expect(result).toEqual({ ok: false, reason: "moved" });
    expect(sky.calls.put).toBeGreaterThan(0);
    const named = new Set(
      sky
        .manifest()!
        .parts.flatMap((part) =>
          Array.from({ length: part.chunks }, (_, at) => chunkId(part.hash, at))
        )
    );
    expect([...sky.chunks.keys()].every((id) => named.has(id))).toBe(true);
  });

  it("reads everything it sends before the first piece goes", async () => {
    const { sky, laptop, state } = await saved();
    const order: string[] = [];
    const read = laptop.local.read;
    laptop.local.read = async (key) => {
      order.push(`read ${key}`);
      return read(key);
    };
    const put = sky.store.putChunk;
    sky.store.putChunk = async (id, data) => {
      order.push("put");
      return put(id, data);
    };
    laptop.values.set("league", { seasons: [] });
    laptop.values.set("teams", { v: 4 });
    await save(sky, laptop.local, { ...state, dirty: { league: 1, teams: 2 } }, "patch");
    expect(order.slice(0, 2)).toEqual(["read league", "read teams"]);
    expect(order.lastIndexOf("read teams")).toBeLessThan(order.indexOf("put"));
  });

  it("replaces the copy with this device's data when that is the answer somebody chose", async () => {
    const { sky, state } = await saved();
    const copy = sky.manifest()!.copy;
    const phone = device({ league: { seasons: [] } });
    const result = await save(sky, phone.local, { ...fresh, dirty: {} }, "replace", "phone");
    expect(result.ok).toBe(true);
    expect(sky.manifest()).toMatchObject({ copy, version: 2, device: "phone" });
    expect(sky.manifest()?.parts.map((part) => part.key)).toEqual(["league"]);
    expect(state.version).toBe(1);
  });
});

describe("taking the cloud copy", () => {
  it("brings every value to a device that has none", async () => {
    const { sky } = await saved();
    const phone = device({});
    const result = await takeCloud({
      store: sky.store,
      local: phone.local,
      state: fresh,
      manifest: sky.manifest()!,
      now: NOW,
      mode: "update",
    });
    expect(result).toMatchObject({ ok: true, downloaded: 3 });
    expect(Object.fromEntries(phone.values)).toEqual({ league, teams, games2027 });
  });

  it("fetches only what changed, and removes what the copy dropped of what this device synced", async () => {
    const { sky, laptop, state } = await saved();
    const phone = device({ league, teams, games2027, localOnly: { mine: true } });
    const phoneState = state;
    laptop.values.set("teams", { v: 4 });
    laptop.values.delete("games2027");
    await save(sky, laptop.local, { ...state, dirty: { teams: 1, games2027: 2 } }, "patch");
    sky.calls.get = 0;
    const result = await takeCloud({
      store: sky.store,
      local: phone.local,
      state: phoneState,
      manifest: sky.manifest()!,
      now: NOW,
      mode: "update",
    });
    expect(result).toMatchObject({ ok: true, downloaded: 1 });
    expect(sky.calls.get).toBe(1);
    expect(phone.values.get("teams")).toEqual({ v: 4 });
    expect(phone.values.has("games2027")).toBe(false);
    // Never synced, so never the copy's to take away.
    expect(phone.values.get("localOnly")).toEqual({ mine: true });
  });

  it("leaves what this device changed and has not sent, and keeps it owed", async () => {
    const { sky, laptop, state } = await saved();
    laptop.values.set("teams", { v: 4 });
    await save(sky, laptop.local, { ...state, dirty: { teams: 1 } }, "patch");
    const phone = device({ league: { seasons: ["mine"] }, teams, games2027 });
    const result = await takeCloud({
      store: sky.store,
      local: phone.local,
      state: { ...state, dirty: { league: 9 } },
      manifest: sky.manifest()!,
      now: NOW,
      mode: "update",
    });
    expect(result).toMatchObject({ ok: true, state: { version: 2, dirty: { league: 9 } } });
    expect(phone.values.get("league")).toEqual({ seasons: ["mine"] });
    expect(phone.values.get("teams")).toEqual({ v: 4 });
  });

  it("makes this device the copy exactly when that is the answer somebody chose", async () => {
    const { sky } = await saved();
    const phone = device({ league: { seasons: ["mine"] }, localOnly: 1 });
    const result = await takeCloud({
      store: sky.store,
      local: phone.local,
      state: { ...fresh, dirty: { league: 9 } },
      manifest: sky.manifest()!,
      now: NOW,
      mode: "replace",
    });
    expect(result).toMatchObject({ ok: true, state: { dirty: {} } });
    expect(Object.fromEntries(phone.values)).toEqual({ league, teams, games2027 });
  });

  it("knows no fingerprints of a copy it never met, and fetches all of it", async () => {
    const { sky, state } = await saved();
    const phone = device({ league, teams, games2027 });
    sky.calls.get = 0;
    await takeCloud({
      store: sky.store,
      local: phone.local,
      state: { ...state, copy: "another-copy" },
      manifest: sky.manifest()!,
      now: NOW,
      mode: "update",
    });
    expect(sky.calls.get).toBe(3);
  });

  it("changes nothing on this device when a piece is missing", async () => {
    const { sky } = await saved();
    sky.chunks.delete(chunkId(sky.manifest()!.parts[1]!.hash, 0));
    const phone = device({ league: { seasons: ["mine"] } });
    const result = await takeCloud({
      store: sky.store,
      local: phone.local,
      state: fresh,
      manifest: sky.manifest()!,
      now: NOW,
      mode: "replace",
    });
    expect(result).toEqual({ ok: false, reason: "missing" });
    expect(phone.local.apply).not.toHaveBeenCalled();
    expect(phone.values.get("league")).toEqual({ seasons: ["mine"] });
  });

  it("says so when this device will not store what arrived", async () => {
    const { sky } = await saved();
    const phone = device({});
    phone.local.apply = vi.fn(async () => false);
    const result = await takeCloud({
      store: sky.store,
      local: phone.local,
      state: fresh,
      manifest: sky.manifest()!,
      now: NOW,
      mode: "update",
    });
    expect(result).toEqual({ ok: false, reason: "refused" });
  });
});

describe("a value larger than one document", () => {
  it("goes up in pieces and comes back whole", async () => {
    const sky = cloud();
    const bytes = new Uint8Array(CHUNK_BYTES * 2);
    for (let at = 0; at < bytes.length; at += 65_536) {
      crypto.getRandomValues(bytes.subarray(at, at + 65_536));
    }
    const noise = Array.from(bytes, (byte) => byte.toString(36)).join("");
    const laptop = device({ teams: noise });
    const result = await save(sky, laptop.local, fresh, "first");
    expect(result.ok).toBe(true);
    expect(sky.manifest()?.parts[0]?.chunks).toBeGreaterThan(1);
    const phone = device({});
    await takeCloud({
      store: sky.store,
      local: phone.local,
      state: fresh,
      manifest: sky.manifest()!,
      now: NOW,
      mode: "update",
    });
    expect(phone.values.get("teams")).toBe(noise);
  });
});

describe("what a device does when the app opens", () => {
  const manifest: CloudManifest = {
    format: MANIFEST_FORMAT,
    copy: "copy-a",
    version: 3,
    updatedAt: NOW,
    device: "laptop",
    parts: [],
  };
  const met = { version: 3, copy: "copy-a", dirty: {} };

  it("sends its data as the first copy, or has nothing to do with none", () => {
    expect(decideOnOpen(null, fresh, false)).toBe("send-local");
    expect(decideOnOpen(null, fresh, true)).toBe("in-step");
  });

  it("stops at a copy that is gone, rather than starting it again unasked", () => {
    expect(decideOnOpen(null, met, false)).toBe("gone");
    expect(decideOnOpen(null, { ...met, dirty: { league: 1 } }, true)).toBe("gone");
  });

  it("takes a copy it never met when it holds nothing, and meets it otherwise", () => {
    expect(decideOnOpen(manifest, fresh, true)).toBe("take-cloud");
    expect(decideOnOpen(manifest, fresh, false)).toBe("meet");
    // A copy started again is not a later version of the one it knew.
    expect(decideOnOpen(manifest, { ...met, copy: "copy-old" }, false)).toBe("meet");
    expect(decideOnOpen({ ...manifest, version: 1 }, { ...met, copy: "copy-old" }, true)).toBe(
      "take-cloud"
    );
  });

  it("keeps step, sends its changes, or takes another device's", () => {
    expect(decideOnOpen(manifest, met, false)).toBe("in-step");
    expect(decideOnOpen(manifest, { ...met, dirty: { league: 1 } }, false)).toBe("send-local");
    expect(decideOnOpen(manifest, { ...met, version: 2 }, false)).toBe("take-cloud");
  });

  it("merges when both have changed since they last met", () => {
    expect(decideOnOpen(manifest, { ...met, version: 2, dirty: { league: 1 } }, false)).toBe(
      "merge"
    );
  });
});

describe("the values changed on both sides", () => {
  const part = (key: string, hash: string) => ({ key, hash, bytes: 1, chunks: 1 });
  const manifest: CloudManifest = {
    format: MANIFEST_FORMAT,
    copy: "copy-a",
    version: 5,
    updatedAt: NOW,
    device: "laptop",
    parts: [part("league", "a".repeat(64)), part("teams", "c".repeat(64))],
  };
  const known = { league: "a".repeat(64), teams: "b".repeat(64), games: "d".repeat(64) };

  it("are none when each side changed something different", () => {
    expect(changedOnBothSides(manifest, known, { league: 1 })).toEqual([]);
  });

  it("are the values both changed, a value the copy dropped counting as changed there", () => {
    expect(changedOnBothSides(manifest, known, { teams: 1, league: 2 })).toEqual(["teams"]);
    expect(changedOnBothSides(manifest, known, { games: 1 })).toEqual(["games"]);
  });
});

describe("the changes a save leaves owed", () => {
  it("are the ones made since it read them", () => {
    expect(withoutSent({ league: 5, teams: 9 }, { league: 5, teams: 8 })).toEqual({ teams: 9 });
    expect(withoutSent({ league: 5 }, {})).toEqual({ league: 5 });
  });
});

describe("a device meeting the cloud copy for the first time", () => {
  it("need not choose when its data is the cloud's already", async () => {
    const { sky } = await saved();
    expect(await matchesCloud(device({ league, teams, games2027 }).local, sky.manifest()!)).toBe(
      true
    );
    expect(await matchesCloud(device({ league, teams }).local, sky.manifest()!)).toBe(false);
    expect(
      await matchesCloud(device({ league, teams, games2027: { v: 2 } }).local, sky.manifest()!)
    ).toBe(false);
  });
});
