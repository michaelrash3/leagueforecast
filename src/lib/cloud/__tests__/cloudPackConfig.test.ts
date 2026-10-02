import { describe, expect, it, vi } from "vitest";
import { DamagedValueError, hashJson, hashValue, packHashed, unpackChunks } from "../cloudPack";
import { FIREBASE_WEB_CONFIG, type FirebaseWebConfig } from "../cloudConfig";
import type { FirebaseCloud } from "../firebaseCloud";
import {
  coerceManifest,
  DATA_SCHEMA,
  KEEP_GROUPS,
  keptStill,
  MANIFEST_FORMAT,
  type KeptPart,
} from "../cloudManifest";
import { memoryCloud, memoryMembers } from "./memoryCloud";

/*
 * The small parts of keeping data in the cloud: a value's fingerprint and packing, the Firebase
 * project the app signs in to, and a manifest read back from Firestore.
 */
describe("a packed value", () => {
  it("comes back as it went, and says what it is by its content", async () => {
    const value = { teams: ["Hawks", "Owls"], note: "é – 😀" };
    const hashed = await hashJson(value);
    expect(await unpackChunks(await packHashed(hashed), hashed.hash)).toEqual(value);
    expect(hashed.hash).toBe(await hashValue({ teams: ["Hawks", "Owls"], note: "é – 😀" }));
    expect(hashed.hash).not.toBe(await hashValue({ ...value, note: "e" }));
    expect(hashed.bytes).toBe(new TextEncoder().encode(JSON.stringify(value)).length);
  });

  it("will not unpack something that is not one, nor anything but the value named", async () => {
    await expect(unpackChunks([new Uint8Array([1, 2, 3])], "a".repeat(64))).rejects.toBeInstanceOf(
      DamagedValueError
    );
    const hashed = await hashJson({ teams: ["Hawks"] });
    const other = await hashValue({ teams: ["Owls"] });
    await expect(unpackChunks(await packHashed(hashed), other)).rejects.toBeInstanceOf(
      DamagedValueError
    );
  });
});

describe("the Firebase project the app keeps its copy in", () => {
  it("is one project's web app, with a key of the form Google issues", () => {
    const { apiKey, appId, messagingSenderId } = FIREBASE_WEB_CONFIG;
    // "AIza" and 35 more of these: a key cut short, or carrying a quote or a space from wherever it
    // was copied, is turned down by sign-in as not valid.
    expect(apiKey).toMatch(/^AIza[\w-]{35}$/);
    // The app's id carries its project's number, so settings from two projects do not pass.
    expect(appId.split(":")[1]).toBe(messagingSenderId);
  });

  it("is the one the app offers and signs in with, with nothing set for the build", async () => {
    const items = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
      removeItem: (key: string) => void items.delete(key),
    });
    const session = await import("../cloudSession");
    try {
      await session.bootCloud();
      expect(session.cloudStatus()).toEqual({ kind: "none" });
      let opened: FirebaseWebConfig | null = null;
      const cloud: FirebaseCloud = {
        account: async () => null,
        // Closed without choosing an account.
        signIn: async () => null,
        signOut: async () => undefined,
        onAccount: () => () => undefined,
        owns: async () => false,
        members: memoryMembers([], () => null),
        store: memoryCloud().store,
      };
      session.setCloudTestHooks({
        openCloud: async (config) => {
          opened = config;
          return cloud;
        },
      });
      await session.signInToCloud();
      expect(opened).toBe(FIREBASE_WEB_CONFIG);
    } finally {
      session.resetCloudSession();
      vi.unstubAllGlobals();
    }
  });
});

describe("a manifest from Firestore", () => {
  const hash = "a".repeat(64);
  const id = "0123456789abcdef0123456789abcdef";
  const part = { key: "league", hash, bytes: 10, chunks: 1, id, at: 5, by: "d1" };
  const stored = {
    format: MANIFEST_FORMAT,
    schema: DATA_SCHEMA,
    copy: "copy-a",
    version: 3,
    save: "s1",
    updatedAt: "2026-09-28T23:00:00.000Z",
    device: "d1",
    parts: [part],
    kept: [{ ...part, key: "teams", group: "g1", keptAt: "2026-09-28T23:00:00.000Z", why: "lost" }],
  };

  it("is read as stored", () => {
    expect(coerceManifest(stored)).toEqual(stored);
  });

  it("is nothing when it could name the wrong pieces", () => {
    expect(coerceManifest(null)).toBeNull();
    expect(coerceManifest({ ...stored, version: "3" })).toBeNull();
    expect(coerceManifest({ ...stored, parts: [{ ...part, hash: "short" }] })).toBeNull();
    expect(coerceManifest({ ...stored, parts: [{ ...part, chunks: 0 }] })).toBeNull();
    expect(coerceManifest({ ...stored, parts: [{ ...part, id: "../x" }] })).toBeNull();
    expect(coerceManifest({ ...stored, parts: [part, part] })).toBeNull();
    expect(coerceManifest({ ...stored, kept: [{ ...part, group: "g", why: "?" }] })).toBeNull();
  });

  it("is nothing without the copy it belongs to, or in any layout but this build's", () => {
    expect(coerceManifest({ ...stored, copy: "" })).toBeNull();
    expect(coerceManifest({ ...stored, format: undefined })).toBeNull();
    expect(coerceManifest({ ...stored, format: MANIFEST_FORMAT + 1 })).toBeNull();
    expect(coerceManifest({ ...stored, format: 1 })).toBeNull();
    expect(coerceManifest({ ...stored, schema: undefined })).toBeNull();
  });
});

describe("kept versions over time", () => {
  const kept = (group: string, keptAt: string): KeptPart => ({
    key: "teams",
    hash: "b".repeat(64),
    bytes: 1,
    chunks: 1,
    id: `${group.padEnd(16, "0")}`,
    at: 0,
    by: "d",
    group,
    keptAt,
    why: "replaced",
  });

  it("go after thirty days", () => {
    const now = "2026-10-30T00:00:00.000Z";
    expect(
      keptStill(
        [kept("aaaa", "2026-09-29T23:59:59.000Z"), kept("bbbb", "2026-10-01T00:00:00.000Z")],
        now
      ).map((part) => part.group)
    ).toEqual(["bbbb"]);
  });

  it("are the newest settlements only, each kept whole", () => {
    const now = "2026-09-29T12:00:00.000Z";
    const many = Array.from({ length: KEEP_GROUPS + 2 }, (_, at) =>
      kept(`g${at}`, `2026-09-2${at}T00:00:00.000Z`)
    );
    const twin = kept("g7", "2026-09-27T00:00:00.000Z");
    const still = keptStill([...many, twin], now);
    expect(new Set(still.map((part) => part.group))).toEqual(
      new Set(["g2", "g3", "g4", "g5", "g6", "g7"])
    );
    expect(still.filter((part) => part.group === "g7")).toHaveLength(2);
  });
});
