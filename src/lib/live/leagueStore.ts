import type { FullFirestore } from "../cloud/firebaseCloud";
import { LEAGUE_COLLECTION, type LeagueDoc, type LeagueDocChange } from "./leagueDocs";

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
};

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
});
