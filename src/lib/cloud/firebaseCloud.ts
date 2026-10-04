import { initializeApp, type FirebaseApp } from "firebase/app";
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
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  runTransaction,
  setDoc,
  type Firestore,
} from "firebase/firestore/lite";
import type * as FullSdk from "./firestoreListen";
import type { FirebaseWebConfig } from "./cloudConfig";
import type { CloudStore } from "./cloudEngine";
import { firestoreLeague, type LeagueStore } from "../live/leagueStore";
import type { LiveReader, MetaWatch } from "../live/viewStore";
import { coerceManifest, UnreadableCopyError } from "./cloudManifest";
import { restoreBackupOnServer, restoreOnServer, type RestoreAnswer } from "./serverRestore";
import { uploadChunksPath, uploadPath, type PackedUpload } from "./uploads";
import {
  coerceMember,
  memberAddress,
  MEMBERS,
  sortMembers,
  type Member,
  type MemberRole,
} from "./members";

/**
 * The cloud copy in Firestore, and the Google sign-in that says whose it is.
 *
 * Run only when a browser keeps a cloud copy (`cloudSession.ts` imports it on demand), so the
 * Firebase SDK is no part of the first download and never runs for anyone who has not signed in.
 * (The service worker still fetches the file in the background with the rest of each release, as
 * it does every file the build makes.) `firestore/lite` rather than the full SDK: this reads and
 * writes documents and never listens to them, and lite is a fraction the size.
 *
 * The layout, and what `firestore.rules` lets through to the Google accounts on the owner's list,
 * and to nobody else:
 * - `copies/main`: what the copy is made of (`CloudManifest`).
 * - `copies/main/chunks/{upload-n}`: the pieces, each `{ data: Bytes }`.
 * - `members/{address}`: the list itself (`members.ts`), each account's own entry readable by it,
 *   and the whole of it by the owner, who adds to it and takes off it.
 * - `live/meta` and `live/meta/chunks/{upload-n}`: the views a server publishes from the copy
 *   (`viewStore.ts`), each document got by name, never listed, and written by no browser.
 *
 * The first version kept its copy under `cloud/`, in a layout nothing reads any more; the rules
 * refuse everyone there, and anything left in it is ignored.
 */
const MANIFEST = "copies/main";
const CHUNKS = "copies/main/chunks";
const LIVE_META = "live/meta";
const LIVE_CHUNKS = "live/meta/chunks";

export type CloudAccount = { uid: string; email: string | null };

export type FirebaseCloud = {
  /** The signed-in account, once Firebase has finished remembering who that was. */
  account: () => Promise<CloudAccount | null>;
  signIn: () => Promise<CloudAccount | null>;
  signOut: () => Promise<void>;
  onAccount: (listener: (account: CloudAccount | null) => void) => () => void;
  /**
   * The signed-in account's Firebase sign-in token, refreshed when it is near its hour's end, or
   * null when nobody is signed in: what a GameChanger pull carries to the proxy (`memberCheck.ts`).
   */
  idToken: () => Promise<string | null>;
  /**
   * Whether the signed-in account may open the copy. The rules refuse a sign-in they do not let in
   * even a look, so a look answers it, and changes nothing.
   */
  owns: () => Promise<boolean>;
  /** The list of who may, as the signed-in account may see and change it. */
  members: CloudMembers;
  store: CloudStore;
  /** The views a server publishes from the copy, as the signed-in member may read them. */
  live: LiveReader;
  /** League Standings seasons, one document each, as the signed-in member may keep them live. */
  league: LeagueStore;
  /**
   * Brings kept version `group` of copy `copy` back, by asking the server (`serverRestore.ts`):
   * the copy's owner's to do.
   */
  restore: (group: string, copy: string) => Promise<RestoreAnswer>;
  /**
   * Stages a packed upload for the server (`uploads.ts`): its record first, then its pieces, so an
   * upload cut short leaves a record the server finds a piece missing from, and the nightly sweeps.
   * The owner's to do: the rules refuse anyone else.
   */
  stageUpload: (packed: PackedUpload) => Promise<void>;
  /** Restores Team Rankings in copy `copy` from staged upload `upload`, by asking the server. */
  restoreBackup: (upload: string, copy: string) => Promise<RestoreAnswer>;
};

export type CloudMembers = {
  /** The signed-in account's own place on the list, or null when it is not on it. */
  role: () => Promise<MemberRole | null>;
  /** The whole list, owner first: for the owner, whom the rules alone let read it. */
  list: () => Promise<Member[]>;
  /** Puts an account on the list as a member; the owner's to do. */
  add: (address: string, addedAt: string) => Promise<void>;
  /** Takes an account off the list; the owner's to do, and never to the owner's own entry. */
  remove: (address: string) => Promise<void>;
};

const accountOf = (user: User | null): CloudAccount | null =>
  user ? { uid: user.uid, email: user.email } : null;

export { UnreadableCopyError };

/** Writes `packed` under `uploads/`: its record, then each piece, a few at a time. */
export const stageUploadIn = async (db: Firestore, packed: PackedUpload): Promise<void> => {
  await setDoc(doc(db, uploadPath(packed.id)), packed.record);
  for (let at = 0; at < packed.pieces.length; at += 4) {
    await Promise.all(
      packed.pieces
        .slice(at, at + 4)
        .map(({ id, data }) =>
          setDoc(doc(db, uploadChunksPath(packed.id), id), { data: Bytes.fromUint8Array(data) })
        )
    );
  }
};

/** A piece's bytes, as `{ data: Bytes }` holds them, or null when it is not there or not bytes. */
const bytesOf = async (db: Firestore, collectionPath: string, id: string) => {
  const snap = await getDoc(doc(db, collectionPath, id));
  const data: unknown = snap.exists() ? snap.get("data") : null;
  return data instanceof Bytes ? data.toUint8Array() : null;
};

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
  getChunk: (id) => bytesOf(db, CHUNKS, id),
  deleteChunk: async (id) => {
    await deleteDoc(doc(db, CHUNKS, id));
  },
});

/**
 * The views a server publishes (`live/`), read by name as a member's device reads them: the meta's
 * fields as stored, and each piece's bytes. What they say is for the reader to check
 * (`liveClient.ts`): nothing here trusts them.
 */
export const firestoreLive = (db: Firestore): LiveReader => ({
  readMeta: async () => {
    const snap = await getDoc(doc(db, LIVE_META));
    return snap.exists() ? snap.data() : null;
  },
  getChunk: (id) => bytesOf(db, LIVE_CHUNKS, id),
});

/** The full Firestore SDK, and its client of an app. */
export type FullFirestore = { sdk: typeof FullSdk; db: FullSdk.Firestore };

/**
 * The full Firestore SDK's client of `app`, loaded when first asked for. The lite Firestore the copy
 * uses reads but cannot listen; the two share the app and its sign-in, each with a client of its
 * own. Asked for only when a page watches, so a browser that only syncs its copy, or opens no live
 * page, never downloads it.
 */
const fullFirestoreOf = (app: FirebaseApp) => (): Promise<FullFirestore> =>
  import("./firestoreListen").then((sdk) => ({ sdk, db: sdk.getFirestore(app) }));

/**
 * `live/meta` as it changes, for a page that keeps its board the latest published while it is open,
 * through the full Firestore `load` gives. Its snapshots say whether they came from the server, and
 * Firestore delivers one from its cache when the connection drops, which is how a page learns it is
 * cut off; it errors only to end, a refusal by the rules among the reasons.
 */
export const watchLiveMeta =
  (load: () => Promise<FullFirestore>): MetaWatch =>
  (heard) => {
    let stop: (() => void) | null = null;
    let stopped = false;
    load().then(
      ({ sdk, db }) => {
        if (stopped) return;
        stop = sdk.onSnapshot(
          sdk.doc(db, LIVE_META),
          { includeMetadataChanges: true },
          (snap) => heard.next(snap.exists() ? snap.data() : null, !snap.metadata.fromCache),
          (error) => heard.error(error)
        );
      },
      // The SDK would not load: offline before it ever came down, which a later open retries.
      (error: unknown) => {
        if (!stopped) heard.error(error);
      }
    );
    return () => {
      stopped = true;
      stop?.();
    };
  };

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

/**
 * The list in one Firestore database, for whoever is signed in to it as `email`. Each call is one
 * document read or written, or one query; the rules decide what each account gets.
 */
export const firestoreMembers = (db: Firestore, email: () => string | null): CloudMembers => ({
  role: async () => {
    const own = email();
    if (!own) return null;
    try {
      const snap = await getDoc(doc(db, MEMBERS, memberAddress(own)));
      return snap.exists() ? (coerceMember(snap.id, snap.data())?.role ?? null) : null;
    } catch (error) {
      // Not on the list: the rules refuse the account even its own entry.
      if ((error as { code?: unknown } | null)?.code === "permission-denied") return null;
      throw error;
    }
  },
  list: async () =>
    sortMembers(
      (await getDocs(collection(db, MEMBERS))).docs.flatMap((snap) => {
        const member = coerceMember(snap.id, snap.data());
        return member ? [member] : [];
      })
    ),
  add: async (address, addedAt) => {
    await setDoc(doc(db, MEMBERS, memberAddress(address)), { role: "member", addedAt });
  },
  remove: async (address) => {
    await deleteDoc(doc(db, MEMBERS, memberAddress(address)));
  },
});

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
    idToken: async () => (auth.currentUser ? auth.currentUser.getIdToken() : null),
    owns: () => ownsCopy(db),
    members: firestoreMembers(db, () => auth.currentUser?.email ?? null),
    store: firestoreStore(db),
    live: { ...firestoreLive(db), watchMeta: watchLiveMeta(fullFirestoreOf(app)) },
    league: firestoreLeague(fullFirestoreOf(app)),
    stageUpload: (packed) => stageUploadIn(db, packed),
    restoreBackup: (upload, copy) =>
      restoreBackupOnServer(upload, copy, {
        token: async () => (auth.currentUser ? auth.currentUser.getIdToken() : null),
      }),
    restore: (group, copy) =>
      restoreOnServer(group, copy, {
        token: async () => (auth.currentUser ? auth.currentUser.getIdToken() : null),
      }),
  };
};
