import type { FullFirestore } from "../cloud/firebaseCloud";
import {
  createdApart,
  isRecord,
  LEAGUE_COLLECTION,
  type LeagueDoc,
  type LeagueDocChange,
} from "./leagueDocs";

/**
 * Where League Standings seasons live for the accounts on the list: a season's document, listened
 * to and written into (`leagueDocs.ts`). An interface so the live store (`useLiveLeague`) is tried
 * against a store in memory, and runs against Firestore.
 */

/** A season's document as the cloud holds it, or none. */
export type LeagueRemote = { exists: false } | { exists: true; data: unknown };

export type LeagueHeard = {
  /**
   * The document as it now is. `fromServer` false is Firestore's own copy, handed over when the
   * connection drops: what the page last had, and no word from the cloud.
   */
  next: (remote: LeagueRemote, fromServer: boolean) => void;
  /** The watch has ended: the rules refused it, or the SDK would not load. */
  error: (error: unknown) => void;
};

/**
 * What a delete found: the season, now deleted; no season at all; or another season under its id,
 * made at another moment, which is left alone.
 */
export type LeagueRemoved = "deleted" | "absent" | "other";

/** What one write makes of a season's document: the whole of it, or some of its fields. */
export type LeagueWrite = { create: LeagueDoc } | { changes: readonly LeagueDocChange[] };

export type LeagueStore = {
  /** Listens to a season's document until the returned function is called. */
  watch: (docId: string, heard: LeagueHeard) => () => void;
  /**
   * One transaction on a season's document: `plan` is handed the document as the cloud holds it,
   * and says what to write, if anything. Firestore runs `plan` again if the document changes before
   * the write lands, so it must work from what it is handed, and the write never lands over a
   * version `plan` did not see. Resolves to what the last run of `plan` returned. Fails, rather
   * than waits, with no connection.
   */
  update: <T>(
    docId: string,
    plan: (remote: LeagueRemote) => { write: LeagueWrite | null; result: T }
  ) => Promise<T>;
  /**
   * Every season in the cloud as the server answers, refused offline rather than answered from a
   * cache: a read for each, so asked for once a visit.
   */
  list: () => Promise<{ docId: string; data: unknown }[]>;
  /**
   * Deletes a season's document if it is the season made at `createdAt`; the rules let only the
   * owner. A season kept apart from this device's under the same id (`leagueSync.ts`) is another
   * device's, and deleting this device's must not delete it. In a transaction, so it reads what it
   * deletes, fails rather than waits with no connection, and no listener hears it before the cloud
   * has agreed.
   */
  remove: (docId: string, createdAt: string) => Promise<LeagueRemoved>;
};

/** When a season's document says its season was made, if it says. */
export const madeAt = (data: unknown): string | null =>
  isRecord(data) && typeof data.createdAt === "string" ? data.createdAt : null;

/** The seasons in Firestore, through the full SDK `load` gives: the one that listens. */
export const firestoreLeague = (load: () => Promise<FullFirestore>): LeagueStore => ({
  watch: (docId, heard) => {
    let stop: (() => void) | null = null;
    let stopped = false;
    load().then(
      ({ sdk, db }) => {
        if (stopped) return;
        stop = sdk.onSnapshot(
          sdk.doc(db, LEAGUE_COLLECTION, docId),
          { includeMetadataChanges: true },
          (snap) =>
            heard.next(
              snap.exists() ? { exists: true, data: snap.data() } : { exists: false },
              !snap.metadata.fromCache
            ),
          (error) => heard.error(error)
        );
      },
      (error: unknown) => {
        if (!stopped) heard.error(error);
      }
    );
    return () => {
      stopped = true;
      stop?.();
    };
  },
  update: async (docId, plan) => {
    const { sdk, db } = await load();
    const where = sdk.doc(db, LEAGUE_COLLECTION, docId);
    return sdk.runTransaction(db, async (transaction) => {
      const snap = await transaction.get(where);
      const { write, result } = plan(
        snap.exists() ? { exists: true, data: snap.data() } : { exists: false }
      );
      if (write && "create" in write) transaction.set(where, write.create);
      else if (write && write.changes.length > 0) {
        const [first, ...rest] = write.changes.map(
          (change) =>
            [
              new sdk.FieldPath(...change.path),
              "remove" in change ? sdk.deleteField() : change.value,
            ] as const
        );
        if (first) transaction.update(where, first[0], first[1], ...rest.flat());
      }
      return result;
    });
  },
  list: async () => {
    const { sdk, db } = await load();
    // As the server answers, or not at all: offline, the SDK's own `getDocs` answers from its
    // cache, which on a page that has listened to none of them holds no season, and a meeting
    // would take that for a cloud holding none (1.6e review).
    const snaps = await sdk.getDocsFromServer(sdk.collection(db, LEAGUE_COLLECTION));
    return snaps.docs.map((snap) => ({ docId: snap.id, data: snap.data() }));
  },
  remove: async (docId, createdAt) => {
    const { sdk, db } = await load();
    const where = sdk.doc(db, LEAGUE_COLLECTION, docId);
    return sdk.runTransaction(db, async (transaction): Promise<LeagueRemoved> => {
      const snap = await transaction.get(where);
      if (!snap.exists()) return "absent";
      if (createdApart(madeAt(snap.data()) ?? "", createdAt)) return "other";
      transaction.delete(where);
      return "deleted";
    });
  },
});
