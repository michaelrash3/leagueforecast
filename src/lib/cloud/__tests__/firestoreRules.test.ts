import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  setDoc,
  type Firestore,
} from "firebase/firestore/lite";
import { CHUNK_BYTES } from "../cloudPack";
import { commitChanges, fetchValues } from "../cloudEngine";
import { chunkId, DATA_SCHEMA, MANIFEST_FORMAT, type CloudManifest } from "../cloudManifest";
import { OWNER_STAND_IN } from "../cloudOwner";
import { firestoreStore, ownsCopy, UnreadableCopyError } from "../firebaseCloud";

/*
 * The rules that keep the cloud copy one account's, tried against a real Firestore: the emulator
 * that `npm run test:rules` starts, which loads `firestore.rules` from `firebase.json` just as a
 * deploy does. The ordinary run has no emulator to talk to and skips all of it.
 *
 * The rules as the repository holds them name a stand-in owner (`OWNER_STAND_IN`), which is who the
 * owner is here. Each "account" is its own Firebase app holding the emulator's stand-in for a
 * signed-in token, which the rules read as `request.auth` exactly as they read a real one.
 */
const HOST = import.meta.env.FIRESTORE_EMULATOR_HOST;
const PROJECT = "demo-league-forecast";

const apps: FirebaseApp[] = [];

type Account = { uid: string; email?: string; verified?: boolean };

const OWNER: Account = { uid: "owner", email: OWNER_STAND_IN, verified: true };
const MALLORY: Account = { uid: "mallory", email: "mallory@example.com", verified: true };

/** Firestore as `account` sees it, or as a browser nobody has signed in to. */
const as = (account: Account | null): Firestore => {
  const app = initializeApp({ projectId: PROJECT, apiKey: "demo-key" }, `app-${apps.length}`);
  apps.push(app);
  const db = getFirestore(app);
  const [host = "127.0.0.1", port = "8085"] = (HOST ?? "").split(":");
  connectFirestoreEmulator(
    db,
    host,
    Number(port),
    account
      ? {
          mockUserToken: {
            sub: account.uid,
            ...(account.email === undefined ? {} : { email: account.email }),
            ...(account.verified === undefined ? {} : { email_verified: account.verified }),
          },
        }
      : {}
  );
  return db;
};

const REFUSED = { code: "permission-denied" };

const manifestOf = (version: number): CloudManifest => ({
  format: MANIFEST_FORMAT,
  schema: DATA_SCHEMA,
  copy: "copy-a",
  version,
  save: `save-${version}`,
  updatedAt: "2026-09-28T00:00:00.000Z",
  device: "d",
  parts: [],
  kept: [],
});

const firstCopy = async (db: Firestore, values: Record<string, unknown>) => {
  const result = await commitChanges({
    store: firestoreStore(db),
    base: null,
    changes: Object.entries(values).map(([key, value]) => ({ key, value, at: 1 })),
    device: "phone",
    now: "2026-09-28T00:00:00.000Z",
  });
  if (!result.ok) throw new Error("first copy refused");
  return result.manifest;
};

/** Every way into the copy an account could try: read, write, list and delete. */
const expectShutOut = async (db: Firestore): Promise<void> => {
  const store = firestoreStore(db);
  await expect(store.readManifest()).rejects.toMatchObject(REFUSED);
  await expect(store.commitManifest(null, manifestOf(1))).rejects.toMatchObject(REFUSED);
  await expect(store.putChunk("a-0", new Uint8Array([1, 2, 3]))).rejects.toMatchObject(REFUSED);
  await expect(store.getChunk("a-0")).rejects.toMatchObject(REFUSED);
  await expect(store.deleteChunk("a-0")).rejects.toMatchObject(REFUSED);
};

beforeEach(async () => {
  if (!HOST) return;
  await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, {
    method: "DELETE",
  });
});

afterAll(async () => {
  await Promise.all(apps.map((app) => deleteApp(app)));
});

describe.skipIf(!HOST)("the cloud copy's rules, on the Firestore emulator", () => {
  it("give a browser nobody has signed in to nothing at all", async () => {
    await expectShutOut(as(null));
  });

  it("give any other Google account nothing, and signing in claims nothing", async () => {
    await expectShutOut(as(MALLORY));
    // The first design's claim: a document naming whoever signed in first. Nobody may write one,
    // and it would mean nothing if they could.
    await expect(
      setDoc(doc(as(MALLORY), "config/owner"), { uid: "mallory", claimedAt: "now" })
    ).rejects.toMatchObject(REFUSED);
    await expect(getDoc(doc(as(MALLORY), "config/owner"))).rejects.toMatchObject(REFUSED);
    await expectShutOut(as(MALLORY));
  });

  it("tell an account whether the copy is its own, by a look that changes nothing", async () => {
    expect(await ownsCopy(as(OWNER))).toBe(true);
    expect(await ownsCopy(as(MALLORY))).toBe(false);
    expect(await ownsCopy(as(null))).toBe(false);
    expect(await firestoreStore(as(OWNER)).readManifest()).toBeNull();
  });

  it("refuse the owner's address when nothing vouches for it", async () => {
    await expectShutOut(as({ uid: "typed", email: OWNER_STAND_IN, verified: false }));
    await expectShutOut(as({ uid: "typed", email: OWNER_STAND_IN }));
    await expectShutOut(as({ uid: "owner" }));
  });

  it("know the owner however the address is capitalised", async () => {
    const store = firestoreStore(as({ ...OWNER, email: OWNER_STAND_IN.toUpperCase() }));
    expect(await store.readManifest()).toBeNull();
  });

  it("open nothing but the copy, even to the owner", async () => {
    const owner = as(OWNER);
    await expect(setDoc(doc(owner, "config/owner"), { uid: "owner" })).rejects.toMatchObject(
      REFUSED
    );
    await expect(setDoc(doc(owner, "elsewhere/doc"), { x: 1 })).rejects.toMatchObject(REFUSED);
    await expect(getDoc(doc(owner, "elsewhere/doc"))).rejects.toMatchObject(REFUSED);
  });

  it("carry the owner's data from one device to another, and nobody else's way", async () => {
    const values = { league: { seasons: [{ name: "Spring" }] }, teams: [["a", "Hawks"]] };
    const sent = await firstCopy(as(OWNER), values);
    const laptopStore = firestoreStore(as(OWNER));
    const manifest = (await laptopStore.readManifest()) as CloudManifest;
    expect(manifest.parts.map((part) => part.key)).toEqual(["league", "teams"]);
    expect(manifest.save).toBe(sent.save);
    const fetched = await fetchValues({ store: laptopStore, parts: manifest.parts });
    expect(fetched.ok && Object.fromEntries(fetched.values)).toEqual(values);

    const mallory = firestoreStore(as(MALLORY));
    const piece = chunkId(manifest.parts[0]?.id ?? "", 0);
    await expect(mallory.readManifest()).rejects.toMatchObject(REFUSED);
    await expect(mallory.getChunk(piece)).rejects.toMatchObject(REFUSED);
    await expect(mallory.putChunk(piece, new Uint8Array([0]))).rejects.toMatchObject(REFUSED);
    await expect(mallory.deleteChunk(piece)).rejects.toMatchObject(REFUSED);
    await expect(
      mallory.commitManifest({ version: 1, copy: manifest.copy }, manifestOf(2))
    ).rejects.toMatchObject(REFUSED);
  });

  it("refuse a save onto a copy that moved on, or onto another copy, in one step with the read", async () => {
    const store = firestoreStore(as(OWNER));
    expect(await store.commitManifest(null, manifestOf(1))).toBe(true);
    expect(await store.commitManifest(null, manifestOf(1))).toBe(false);
    expect(await store.commitManifest({ version: 1, copy: "copy-a" }, manifestOf(2))).toBe(true);
    expect(await store.commitManifest({ version: 1, copy: "copy-a" }, manifestOf(3))).toBe(false);
    expect(await store.commitManifest({ version: 2, copy: "copy-b" }, manifestOf(3))).toBe(false);
    expect((await store.readManifest())?.version).toBe(2);
  });

  it("never take a manifest this build cannot read for no copy at all", async () => {
    const owner = as(OWNER);
    // A later build's layout, as this one would find it.
    await setDoc(doc(owner, "copies/main"), { ...manifestOf(4), format: MANIFEST_FORMAT + 1 });
    const store = firestoreStore(owner);
    await expect(store.readManifest()).rejects.toBeInstanceOf(UnreadableCopyError);
    // Nor write a first copy over it.
    expect(await store.commitManifest(null, manifestOf(1))).toBe(false);
    expect((await getDoc(doc(owner, "copies/main"))).get("format")).toBe(MANIFEST_FORMAT + 1);
  });

  it("fit a value too large for one document into several", async () => {
    // Random text, so gzip cannot shrink it under one piece.
    const bytes = new Uint8Array(CHUNK_BYTES * 2);
    for (let at = 0; at < bytes.length; at += 65_536) {
      crypto.getRandomValues(bytes.subarray(at, at + 65_536));
    }
    const noise = Array.from(bytes, (byte) => byte.toString(36)).join("");
    const manifest = await firstCopy(as(OWNER), { teams: noise });
    expect(manifest.parts[0]?.chunks).toBeGreaterThan(1);
    const fetched = await fetchValues({ store: firestoreStore(as(OWNER)), parts: manifest.parts });
    expect(fetched.ok && fetched.values.get("teams")).toBe(noise);
  }, 60_000);
});
