import { describe, expect, it } from "vitest";
import { hashValue, packValue, unpackChunks } from "../cloudPack";
import { parseFirebaseConfig } from "../cloudConfig";
import { coerceManifest } from "../cloudManifest";

/*
 * The small parts of keeping data in the cloud: a value's fingerprint and packing, the Firebase
 * setting as somebody pastes it, and a manifest read back from Firestore.
 */
describe("a packed value", () => {
  it("comes back as it went, and says what it is by its content", async () => {
    const value = { teams: ["Hawks", "Owls"], note: "é – 😀" };
    const packed = await packValue(value);
    expect(await unpackChunks(packed.chunks)).toEqual(value);
    expect(packed.hash).toBe(await hashValue({ teams: ["Hawks", "Owls"], note: "é – 😀" }));
    expect(packed.hash).not.toBe(await hashValue({ ...value, note: "e" }));
    expect(packed.bytes).toBe(new TextEncoder().encode(JSON.stringify(value)).length);
  });

  it("will not unpack something that is not one", async () => {
    await expect(unpackChunks([new Uint8Array([1, 2, 3])])).rejects.toThrow();
  });
});

describe("the Firebase setting as it is pasted", () => {
  const fields = {
    apiKey: "AIzaSyExampleExampleExample000000",
    authDomain: "league-forecast-youth.firebaseapp.com",
    projectId: "league-forecast-youth",
    appId: "1:123456789:web:abcdef",
  };

  it("reads the console's block, braces and all", () => {
    const pasted = `const firebaseConfig = {
  apiKey: "${fields.apiKey}",
  authDomain: "${fields.authDomain}",
  projectId: "${fields.projectId}",
  storageBucket: "league-forecast-youth.firebasestorage.app",
  messagingSenderId: "123456789",
  appId: "${fields.appId}",
  measurementId: "G-XXXX"
};`;
    expect(parseFirebaseConfig(pasted)).toEqual({
      ...fields,
      storageBucket: "league-forecast-youth.firebasestorage.app",
      messagingSenderId: "123456789",
    });
  });

  it("reads JSON too", () => {
    expect(parseFirebaseConfig(JSON.stringify(fields))).toEqual(fields);
  });

  it("is nothing when a field the app needs is missing", () => {
    const { appId: _gone, ...rest } = fields;
    expect(parseFirebaseConfig(JSON.stringify(rest))).toBeNull();
    expect(parseFirebaseConfig("")).toBeNull();
    expect(parseFirebaseConfig(undefined)).toBeNull();
  });
});

describe("a manifest from Firestore", () => {
  const hash = "a".repeat(64);

  it("is read as stored", () => {
    const raw = {
      version: 3,
      updatedAt: "2026-09-28T23:00:00.000Z",
      device: "d1",
      parts: [{ key: "league", hash, bytes: 10, chunks: 1 }],
    };
    expect(coerceManifest(raw)).toEqual(raw);
  });

  it("is nothing when it could name the wrong pieces", () => {
    expect(coerceManifest(null)).toBeNull();
    expect(coerceManifest({ version: "3", parts: [] })).toBeNull();
    expect(
      coerceManifest({ version: 1, parts: [{ key: "league", hash: "short", chunks: 1 }] })
    ).toBeNull();
    expect(coerceManifest({ version: 1, parts: [{ key: "league", hash, chunks: 0 }] })).toBeNull();
  });
});
