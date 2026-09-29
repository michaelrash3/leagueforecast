import { describe, expect, it, vi } from "vitest";
import { chunkId, decideOnOpen, type CloudManifest } from "../cloudManifest";
import {
  matchesCloud,
  sendLocal,
  takeCloud,
  withoutSent,
  type CloudStore,
  type LocalSource,
  type SyncState,
} from "../cloudEngine";
import { CHUNK_BYTES, hashValue } from "../cloudPack";

/*
 * Keeping this browser's data in the cloud: what is sent, what is fetched, and above all what is
 * never overwritten without somebody choosing to. Firestore and the browser's stores are stood in
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
  };
  return { local, values, reads };
};

const fresh: SyncState = { version: null, hashes: {}, dirty: {} };
const NOW = "2026-09-28T23:00:00.000Z";

const league = { activeSeasonId: "s1", seasons: [{ id: "s1", name: "Fall", teams: ["Hawks"] }] };
const teams = { v: 3, names: ["Hawks", "Owls", "Rays"] };

describe("the first save from a device with data", () => {
  it("sends every value and names each in the manifest", async () => {
    const sky = cloud();
    const laptop = device({ league, teams });
    const result = await sendLocal({
      store: sky.store,
      local: laptop.local,
      state: fresh,
      device: "laptop",
      now: NOW,
    });
    if (!result.ok) throw new Error("the save did not land");
    expect(sky.manifest()).toMatchObject({ version: 1, device: "laptop", updatedAt: NOW });
    expect(sky.manifest()?.parts.map((part) => part.key)).toEqual(["league", "teams"]);
    expect(result.state).toMatchObject({ version: 1, dirty: {}, syncedAt: NOW });
    expect(result.state.hashes.teams).toBe(await hashValue(teams));
    expect(result.uploaded).toBe(2);
  });
});

describe("a later save", () => {
  const saved = async () => {
    const sky = cloud();
    const laptop = device({ league, teams });
    const first = await sendLocal({
      store: sky.store,
      local: laptop.local,
      state: fresh,
      device: "laptop",
      now: NOW,
    });
    if (!first.ok) throw new Error("the first save did not land");
    sky.calls.put = 0;
    laptop.reads.length = 0;
    return { sky, laptop, state: first.state };
  };

  it("reads and sends only what changed here", async () => {
    const { sky, laptop, state } = await saved();
    laptop.values.set("league", { ...league, activeSeasonId: "s2" });
    const result = await sendLocal({
      store: sky.store,
      local: laptop.local,
      state: { ...state, dirty: { league: 5 } },
      device: "laptop",
      now: NOW,
    });
    if (!result.ok) throw new Error("the save did not land");
    expect(laptop.reads).toEqual(["league"]);
    expect(result.uploaded).toBe(1);
    expect(sky.manifest()?.version).toBe(2);
    expect(result.sent).toEqual({ league: 5 });
  });

  it("writes no manifest when nothing is actually different", async () => {
    const { sky, laptop, state } = await saved();
    sky.calls.commit = 0;
    const result = await sendLocal({
      store: sky.store,
      local: laptop.local,
      state: { ...state, dirty: { league: 7 } },
      device: "laptop",
      now: NOW,
    });
    if (!result.ok) throw new Error("the save did not land");
    expect(sky.calls.commit).toBe(0);
    expect(sky.calls.put).toBe(0);
    expect(result.state.version).toBe(1);
  });

  it("drops a key this device no longer holds, and the pieces only it named", async () => {
    const { sky, laptop, state } = await saved();
    const oldTeams = sky.manifest()?.parts.find((part) => part.key === "teams");
    laptop.values.delete("teams");
    const result = await sendLocal({
      store: sky.store,
      local: laptop.local,
      state: { ...state, dirty: { teams: 9 } },
      device: "laptop",
      now: NOW,
    });
    if (!result.ok) throw new Error("the save did not land");
    expect(sky.manifest()?.parts.map((part) => part.key)).toEqual(["league"]);
    expect(sky.chunks.has(chunkId(oldTeams!.hash, 0))).toBe(false);
  });

  it("overwrites nothing when another device saved since", async () => {
    const { sky, laptop, state } = await saved();
    sky.moveOn();
    laptop.values.set("league", { ...league, activeSeasonId: "s3" });
    const result = await sendLocal({
      store: sky.store,
      local: laptop.local,
      state: { ...state, dirty: { league: 3 } },
      device: "laptop",
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "moved" });
    expect(sky.calls.put).toBe(0);
    expect(sky.manifest()?.version).toBe(2);
  });

  it("overwrites nothing when the other device's save lands mid-send", async () => {
    const { sky, laptop, state } = await saved();
    const commit = sky.store.commitManifest;
    sky.store.commitManifest = async (expected, next) => {
      sky.moveOn();
      return commit(expected, next);
    };
    laptop.values.set("league", { ...league, activeSeasonId: "s4" });
    const result = await sendLocal({
      store: sky.store,
      local: laptop.local,
      state: { ...state, dirty: { league: 4 } },
      device: "laptop",
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "moved" });
  });

  it("replaces the cloud copy when that is the answer somebody chose", async () => {
    const { sky, laptop, state } = await saved();
    sky.moveOn();
    laptop.values.set("league", { ...league, activeSeasonId: "mine" });
    const result = await sendLocal({
      store: sky.store,
      local: laptop.local,
      state,
      device: "laptop",
      now: NOW,
      replace: true,
    });
    expect(result.ok).toBe(true);
    expect(sky.manifest()?.version).toBe(3);
  });
});

describe("taking the cloud copy", () => {
  const withCopy = async () => {
    const sky = cloud();
    const laptop = device({ league, teams });
    const first = await sendLocal({
      store: sky.store,
      local: laptop.local,
      state: fresh,
      device: "laptop",
      now: NOW,
    });
    if (!first.ok) throw new Error("the first save did not land");
    return { sky, laptop, laptopState: first.state };
  };

  it("brings every value to a device that has none", async () => {
    const { sky } = await withCopy();
    const phone = device({});
    const result = await takeCloud({
      store: sky.store,
      local: phone.local,
      state: fresh,
      manifest: sky.manifest()!,
      now: NOW,
    });
    expect(result).toMatchObject({ ok: true, downloaded: 2 });
    expect(Object.fromEntries(phone.values)).toEqual({ league, teams });
  });

  it("fetches only what changed, and removes what the cloud copy no longer holds", async () => {
    const { sky, laptop, laptopState } = await withCopy();
    const phone = device({});
    const took = await takeCloud({
      store: sky.store,
      local: phone.local,
      state: fresh,
      manifest: sky.manifest()!,
      now: NOW,
    });
    if (!took.ok) throw new Error("the phone did not take the copy");

    // The laptop renames a season and drops the teams.
    laptop.values.set("league", { ...league, activeSeasonId: "s9" });
    laptop.values.delete("teams");
    await sendLocal({
      store: sky.store,
      local: laptop.local,
      state: { ...laptopState, dirty: { league: 1, teams: 1 } },
      device: "laptop",
      now: NOW,
    });

    sky.calls.get = 0;
    const again = await takeCloud({
      store: sky.store,
      local: phone.local,
      state: took.state,
      manifest: sky.manifest()!,
      now: NOW,
    });
    expect(again).toMatchObject({ ok: true, downloaded: 1 });
    expect(sky.calls.get).toBe(1);
    expect(Object.fromEntries(phone.values)).toEqual({
      league: { ...league, activeSeasonId: "s9" },
    });
  });

  it("changes nothing on this device when a piece is missing", async () => {
    const { sky } = await withCopy();
    sky.chunks.clear();
    const phone = device({ league: { mine: true } });
    const result = await takeCloud({
      store: sky.store,
      local: phone.local,
      state: fresh,
      manifest: sky.manifest()!,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "missing" });
    expect(phone.local.apply).not.toHaveBeenCalled();
    expect(Object.fromEntries(phone.values)).toEqual({ league: { mine: true } });
  });

  it("fetches a key changed here again, whatever its old fingerprint", async () => {
    const { sky, laptopState } = await withCopy();
    const laptop2 = device({ league: { edited: "here" }, teams });
    const result = await takeCloud({
      store: sky.store,
      local: laptop2.local,
      state: { ...laptopState, dirty: { league: 2 } },
      manifest: sky.manifest()!,
      now: NOW,
    });
    expect(result).toMatchObject({ ok: true, downloaded: 1 });
    expect(laptop2.values.get("league")).toEqual(league);
  });
});

describe("a value larger than one document", () => {
  it("goes up in pieces and comes back whole", async () => {
    // Text that does not compress to nothing: each entry differs.
    const big = Array.from(
      { length: 180_000 },
      (_, at) => `club-${at * 7919}-${(at * 104729) % 9973}`
    );
    const sky = cloud();
    const laptop = device({ big });
    await sendLocal({ store: sky.store, local: laptop.local, state: fresh, device: "a", now: NOW });
    const part = sky.manifest()!.parts[0]!;
    expect(part.chunks).toBeGreaterThan(1);
    expect(sky.chunks.get(chunkId(part.hash, 0))!.length).toBeLessThanOrEqual(CHUNK_BYTES);

    const phone = device({});
    await takeCloud({
      store: sky.store,
      local: phone.local,
      state: fresh,
      manifest: sky.manifest()!,
      now: NOW,
    });
    expect(phone.values.get("big")).toEqual(big);
  });
});

describe("what a device does when the app opens", () => {
  const manifest = (version: number): CloudManifest => ({
    version,
    updatedAt: NOW,
    device: "x",
    parts: [],
  });
  const at = (version: number | null, dirty: Record<string, number> = {}) => ({ version, dirty });

  it("sends its data to an empty cloud, and has nothing to do with none", () => {
    expect(decideOnOpen(null, at(null), false)).toBe("send-local");
    expect(decideOnOpen(null, at(null), true)).toBe("in-step");
  });

  it("takes the cloud copy when it has nothing of its own", () => {
    expect(decideOnOpen(manifest(4), at(null), true)).toBe("take-cloud");
  });

  it("asks when its own data and the cloud's have never met", () => {
    expect(decideOnOpen(manifest(4), at(null), false)).toBe("choose");
  });

  it("keeps step, sends its changes, or takes another device's", () => {
    expect(decideOnOpen(manifest(4), at(4), false)).toBe("in-step");
    expect(decideOnOpen(manifest(4), at(4, { league: 1 }), false)).toBe("send-local");
    expect(decideOnOpen(manifest(5), at(4), false)).toBe("take-cloud");
  });

  it("asks when both have changed since they last met", () => {
    expect(decideOnOpen(manifest(5), at(4, { league: 1 }), false)).toBe("choose");
  });
});

describe("the changes a save leaves owed", () => {
  it("are the ones made since it read them", () => {
    expect(withoutSent({ league: 5, teams: 8, ages: 2 }, { league: 5, teams: 6 })).toEqual({
      teams: 8,
      ages: 2,
    });
  });
});

describe("a device meeting the cloud copy for the first time", () => {
  it("need not choose when its data is the cloud's already", async () => {
    const sky = cloud();
    const laptop = device({ league, teams });
    await sendLocal({ store: sky.store, local: laptop.local, state: fresh, device: "a", now: NOW });
    expect(await matchesCloud(device({ league, teams }).local, sky.manifest()!)).toBe(true);
    expect(await matchesCloud(device({ league }).local, sky.manifest()!)).toBe(false);
    expect(await matchesCloud(device({ league, teams: { v: 4 } }).local, sky.manifest()!)).toBe(
      false
    );
  });
});
