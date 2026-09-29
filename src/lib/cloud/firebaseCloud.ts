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
 * The layout, and what `firestore.rules` lets through to whoever signs in with Google, and to
 * nobody else:
 * - `copies/main`: what the copy is made of (`CloudManifest`).
 * - `copies/main/chunks/{upload-n}`: the pieces, each `{ data: Bytes }`.
 *
 * The first version kept its copy under `cloud/`, in a layout nothing reads any more; the rules
 * refuse everyone there, and anything left in it is ignored.
 */
const MANIFEST = "copies/main";
const CHUNKS = "copies/main/chunks";

export type CloudAccount = { uid: string; email: string | null };

export type FirebaseCloud = {
  /** The signed-in account, once Firebase has finished remembering who that was. */
  account: () => Promise<CloudAccount | null>;
  signIn: () => Promise<CloudAccount | null>;
  signOut: () => Promise<void>;
  onAccount: (listener: (account: CloudAccount | null) => void) => () => void;
  /**
   * Whether the signed-in account may open the copy. The rules refuse a sign-in they do not let in
   * even a look, so a look answers it, and changes nothing.
   */
  owns: () => Promise<boolean>;
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
        if (current?.version !== expected.version || current.copy !== expected.copy) return false;
      }
      tx.set(doc(db, MANIFEST), {
        format: next.format,
        schema: next.schema,
        copy: next.copy,
        version: next.version,
        save: next.save,
        updatedAt: next.updatedAt,
        device: next.device,
        parts: next.parts.map((part) => ({ ...part })),
        kept: next.kept.map((part) => ({ ...part })),
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

/** `FirebaseCloud.owns` for whoever is signed in to `db`: refused a look, it is not theirs to open. */
export const ownsCopy = async (db: Firestore): Promise<boolean> => {
  try {
    await getDoc(doc(db, MANIFEST));
    return true;
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === "permission-denied") return false;
    throw error;
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
    owns: () => ownsCopy(db),
    store: firestoreStore(db),
  };
};
