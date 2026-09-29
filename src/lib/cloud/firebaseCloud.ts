import { initializeApp } from "firebase/app";
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import {
  Bytes,
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  runTransaction,
  setDoc,
  type Firestore,
} from "firebase/firestore/lite";
import type { FirebaseWebConfig } from "./cloudConfig";
import type { CloudStore } from "./cloudEngine";
import { coerceManifest } from "./cloudManifest";

/**
 * The cloud copy in Firestore, and the Google sign-in that says whose it is.
 *
 * Run only when a browser keeps a cloud copy (`cloudSession.ts` imports it on demand), so the
 * Firebase SDK is no part of the first download and never runs for anyone who has not signed in.
 * (The service worker still fetches the file in the background with the rest of each release, as
 * it does every file the build makes.) `firestore/lite` rather than the full SDK: this reads and
 * writes documents and never listens to them, and lite is a fraction the size.
 *
 * The layout, and what `firestore.rules` lets through:
 * - `config/owner`: the account the copy belongs to, `{ uid, claimedAt }`. Created once by the
 *   first account to sign in, and never changed after.
 * - `cloud/manifest`: what the copy is made of (`CloudManifest`). Owner only.
 * - `cloud/manifest/chunks/{hash-n}`: the pieces, each `{ data: Bytes }`. Owner only.
 */
const MANIFEST = "cloud/manifest";
const CHUNKS = "cloud/manifest/chunks";
const OWNER = "config/owner";

export type CloudAccount = { uid: string; email: string | null };

export type FirebaseCloud = {
  /** The signed-in account, once Firebase has finished remembering who that was. */
  account: () => Promise<CloudAccount | null>;
  signIn: () => Promise<CloudAccount | null>;
  signOut: () => Promise<void>;
  onAccount: (listener: (account: CloudAccount | null) => void) => () => void;
  /**
   * Whose the copy is. The first account to ask claims it; the rules refuse a second claim, so an
   * account that finds one already made is told the copy is somebody else's.
   */
  claim: () => Promise<"mine" | "someone-else">;
  store: CloudStore;
};

const accountOf = (user: User | null): CloudAccount | null =>
  user ? { uid: user.uid, email: user.email } : null;

/** Thrown for a manifest this build cannot read, which is never to be taken for no copy at all. */
export class UnreadableCopyError extends Error {
  constructor() {
    super(
      "The cloud copy was saved by a newer version of the app, or is damaged. Reload to update the app; nothing here has been changed."
    );
    this.name = "UnreadableCopyError";
  }
}

/** The copy's documents in one Firestore database, as the sync engine reads and writes them. */
export const firestoreStore = (db: Firestore): CloudStore => ({
  readManifest: async () => {
    const snap = await getDoc(doc(db, MANIFEST));
    if (!snap.exists()) return null;
    const manifest = coerceManifest(snap.data());
    if (!manifest) throw new UnreadableCopyError();
    return manifest;
  },
  commitManifest: (expected, next) =>
    runTransaction(db, async (tx) => {
      const snap = await tx.get(doc(db, MANIFEST));
      if (expected === null) {
        // The first copy: only if there is still none at all, readable or not.
        if (snap.exists()) return false;
      } else {
        const current = snap.exists() ? coerceManifest(snap.data()) : null;
        if (current?.version !== expected) return false;
      }
      tx.set(doc(db, MANIFEST), {
        format: next.format,
        copy: next.copy,
        version: next.version,
        updatedAt: next.updatedAt,
        device: next.device,
        parts: next.parts.map((part) => ({ ...part })),
      });
      return true;
    }),
  putChunk: async (id, data) => {
    await setDoc(doc(db, CHUNKS, id), { data: Bytes.fromUint8Array(data) });
  },
  getChunk: async (id) => {
    const snap = await getDoc(doc(db, CHUNKS, id));
    const data: unknown = snap.exists() ? snap.get("data") : null;
    return data instanceof Bytes ? data.toUint8Array() : null;
  },
  deleteChunk: async (id) => {
    await deleteDoc(doc(db, CHUNKS, id));
  },
});

const ownerIs = async (db: Firestore, uid: string): Promise<boolean | null> => {
  const snap = await getDoc(doc(db, OWNER));
  return snap.exists() ? snap.get("uid") === uid : null;
};

/** `FirebaseCloud.claim` for the account `uid` signed in to `db`, or for nobody. */
export const claimCopy = async (
  db: Firestore,
  uid: string | null
): Promise<"mine" | "someone-else"> => {
  if (!uid) return "someone-else";
  const known = await ownerIs(db, uid);
  if (known !== null) return known ? "mine" : "someone-else";
  try {
    await setDoc(doc(db, OWNER), { uid, claimedAt: new Date().toISOString() });
    return "mine";
  } catch {
    // Refused: another account claimed it between the read and the write.
    return (await ownerIs(db, uid)) === true ? "mine" : "someone-else";
  }
};

export const openFirebaseCloud = (config: FirebaseWebConfig): FirebaseCloud => {
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app);
  return {
    account: async () => {
      await auth.authStateReady();
      return accountOf(auth.currentUser);
    },
    signIn: async () => accountOf((await signInWithPopup(auth, new GoogleAuthProvider())).user),
    signOut: () => signOut(auth),
    onAccount: (listener) => onAuthStateChanged(auth, (user) => listener(accountOf(user))),
    claim: () => claimCopy(db, auth.currentUser?.uid ?? null),
    store: firestoreStore(db),
  };
};
