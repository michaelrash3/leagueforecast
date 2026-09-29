import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import {
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  setDoc,
  type Firestore,
} from "firebase/firestore/lite";
import { CHUNK_BYTES } from "../cloudPack";
import { sendLocal, takeCloud, type LocalSource, type SyncState } from "../cloudEngine";
import { chunkId, type CloudManifest } from "../cloudManifest";
import { claimCopy, firestoreStore } from "../firebaseCloud";

/*
 * The rules that keep the cloud copy one account's, tried against a real Firestore: the emulator
 * that `npm run test:rules` starts, which loads `firestore.rules` from `firebase.json` just as a
 * deploy does. The ordinary run has no emulator to talk to and skips all of it.
 *
 * Each "account" is its own Firebase app holding the emulator's stand-in for a signed-in token,
 * which the rules read as `request.auth` exactly as they read a real one.
 */
const HOST = import.meta.env.FIRESTORE_EMULATOR_HOST;
const PROJECT = "demo-league-forecast";

const apps: FirebaseApp[] = [];

/** Firestore as the account `uid` sees it, or as a browser nobody has signed in to. */
const as = (uid: string | null): Firestore => {
  const app = initializeApp({ projectId: PROJECT, apiKey: "demo-key" }, `app-${apps.length}`);
  apps.push(app);
  const db = getFirestore(app);
  const [host = "127.0.0.1", port = "8085"] = (HOST ?? "").split(":");
  connectFirestoreEmulator(db, host, Number(port), uid ? { mockUserToken: { sub: uid } } : {});
  return db;
};

const REFUSED = { code: "permission-denied" };

const memory = (
  entries: Record<string, unknown> = {}
): LocalSource & { map: Map<string, unknown> } => {
  const map = new Map(Object.entries(entries));
  return {
    map,
    keys: () => [...map.keys()],
    read: async (key) => map.get(key) ?? null,
    apply: async (values) => {
      for (const [key, value] of values) {
        if (value === null) map.delete(key);
        else map.set(key, value);
      }
      return true;
    },
  };
};

const fresh: SyncState = { version: null, hashes: {}, dirty: {} };

const manifestOf = (version: number): CloudManifest => ({
  version,
  updatedAt: "2026-09-28T00:00:00.000Z",
  device: "d",
  parts: [],
});

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
    await claimCopy(as("owner"), "owner");
    const nobody = as(null);
    await expect(getDoc(doc(nobody, "config/owner"))).rejects.toMatchObject(REFUSED);
    await expect(firestoreStore(nobody).readManifest()).rejects.toMatchObject(REFUSED);
    await expect(
      setDoc(doc(nobody, "cloud/manifest"), { version: 1, updatedAt: "", device: "", parts: [] })
    ).rejects.toMatchObject(REFUSED);
    expect(await claimCopy(nobody, null)).toBe("someone-else");
  });

  it("let no account near the copy before one has claimed it", async () => {
    const owner = as("owner");
    await expect(firestoreStore(owner).readManifest()).rejects.toMatchObject(REFUSED);
    await expect(
      firestoreStore(owner).putChunk("a-0", new Uint8Array([1, 2, 3]))
    ).rejects.toMatchObject(REFUSED);
    await expect(firestoreStore(owner).commitManifest(null, manifestOf(1))).rejects.toMatchObject(
      REFUSED
    );
  });

  it("let an account claim the copy only for itself, and only as the claim the app writes", async () => {
    const mallory = as("mallory");
    const at = "2026-09-28T00:00:00.000Z";
    await expect(
      setDoc(doc(mallory, "config/owner"), { uid: "owner", claimedAt: at })
    ).rejects.toMatchObject(REFUSED);
    await expect(
      setDoc(doc(mallory, "config/owner"), { uid: "mallory", claimedAt: at, admin: true })
    ).rejects.toMatchObject(REFUSED);
    await expect(
      setDoc(doc(mallory, "config/owner"), { uid: "mallory", claimedAt: 1 })
    ).rejects.toMatchObject(REFUSED);
    await setDoc(doc(mallory, "config/owner"), { uid: "mallory", claimedAt: at });
  });

  it("hand the copy to the first account to sign in, for good", async () => {
    const owner = as("owner");
    const mallory = as("mallory");
    expect(await claimCopy(owner, "owner")).toBe("mine");
    expect(await claimCopy(mallory, "mallory")).toBe("someone-else");
    // The same account on another device is still the owner.
    expect(await claimCopy(as("owner"), "owner")).toBe("mine");

    const at = "2026-09-28T00:00:00.000Z";
    await expect(
      setDoc(doc(mallory, "config/owner"), { uid: "mallory", claimedAt: at })
    ).rejects.toMatchObject(REFUSED);
    await expect(deleteDoc(doc(mallory, "config/owner"))).rejects.toMatchObject(REFUSED);
    // Not even the owner can hand it on or let it go from the app.
    await expect(
      setDoc(doc(owner, "config/owner"), { uid: "owner", claimedAt: at })
    ).rejects.toMatchObject(REFUSED);
    await expect(deleteDoc(doc(owner, "config/owner"))).rejects.toMatchObject(REFUSED);
    expect((await getDoc(doc(owner, "config/owner"))).get("uid")).toBe("owner");
  });

  it("carry the owner's data from one device to another, and nobody else's way", async () => {
    await claimCopy(as("owner"), "owner");
    const phone = memory({ league: { seasons: [{ name: "Spring" }] }, teams: [["a", "Hawks"]] });
    const sent = await sendLocal({
      store: firestoreStore(as("owner")),
      local: phone,
      state: fresh,
      device: "phone",
      now: "2026-09-28T00:00:00.000Z",
      replace: true,
    });
    expect(sent).toMatchObject({ ok: true, uploaded: 2 });

    const laptopStore = firestoreStore(as("owner"));
    const manifest = await laptopStore.readManifest();
    expect(manifest?.parts.map((part) => part.key)).toEqual(["league", "teams"]);
    const laptop = memory();
    expect(
      await takeCloud({
        store: laptopStore,
        local: laptop,
        state: fresh,
        manifest: manifest as CloudManifest,
        now: "2026-09-28T00:01:00.000Z",
      })
    ).toMatchObject({ ok: true, downloaded: 2 });
    expect(Object.fromEntries(laptop.map)).toEqual(Object.fromEntries(phone.map));

    const mallory = firestoreStore(as("mallory"));
    const piece = chunkId((manifest as CloudManifest).parts[0]?.hash ?? "", 0);
    await expect(mallory.readManifest()).rejects.toMatchObject(REFUSED);
    await expect(mallory.getChunk(piece)).rejects.toMatchObject(REFUSED);
    await expect(mallory.putChunk(piece, new Uint8Array([0]))).rejects.toMatchObject(REFUSED);
    await expect(mallory.deleteChunk(piece)).rejects.toMatchObject(REFUSED);
    await expect(mallory.commitManifest(1, manifestOf(2))).rejects.toMatchObject(REFUSED);
  });

  it("refuse a save onto a copy that moved on, in one step with the read", async () => {
    await claimCopy(as("owner"), "owner");
    const store = firestoreStore(as("owner"));
    expect(await store.commitManifest(null, manifestOf(1))).toBe(true);
    expect(await store.commitManifest(null, manifestOf(1))).toBe(false);
    expect(await store.commitManifest(1, manifestOf(2))).toBe(true);
    expect((await store.readManifest())?.version).toBe(2);
  });

  it("fit a value too large for one document into several", async () => {
    await claimCopy(as("owner"), "owner");
    // Random text, so gzip cannot shrink it under one piece.
    const bytes = new Uint8Array(CHUNK_BYTES * 2);
    for (let at = 0; at < bytes.length; at += 65_536) {
      crypto.getRandomValues(bytes.subarray(at, at + 65_536));
    }
    const noise = Array.from(bytes, (byte) => byte.toString(36)).join("");
    const big = memory({ teams: noise });
    const result = await sendLocal({
      store: firestoreStore(as("owner")),
      local: big,
      state: fresh,
      device: "phone",
      now: "2026-09-28T00:00:00.000Z",
      replace: true,
    });
    expect(result.ok).toBe(true);
    const store = firestoreStore(as("owner"));
    const manifest = (await store.readManifest()) as CloudManifest;
    expect(manifest.parts[0]?.chunks).toBeGreaterThan(1);
    const back = memory();
    await takeCloud({ store, local: back, state: fresh, manifest, now: "later" });
    expect(back.map.get("teams")).toBe(noise);
  }, 60_000);
});
