import type { CloudStore } from "../cloud/cloudEngine";
import {
  firestoreRestDocuments,
  firestoreRestLive,
  firestoreRestStore,
  firestoreRestUploads,
  MANIFEST_PATH,
  type RestAccess,
} from "../cloud/firestoreRest";
import { coercePullJob, jobPath, JOBS_COLLECTION, type PullJob } from "../cloud/pullJobs";
import type { GateDocs } from "../cloud/refreshGate";
import type { UploadStore } from "../cloud/uploads";
import { LEAGUE_DELETED_PATH, leagueDeletedAt } from "./boardsCheck";
import { restLeagueDocs, type LeagueDocsList } from "./cloudLeague";
import { REBUILD_JOB_CONTROL } from "./rebuildJobControl";
import { REBUILD_LEDGER_PATH } from "./rebuildLedger";
import { CLOSED_LEVEL_PATH, type ClosedLevelRecord } from "./closedLevelRecord";
import type { LiveStore } from "./viewStore";

/**
 * What a job on GitHub opens of the cloud on one sign-in (`scripts/cloudPool.ts`, which signs in
 * with the Firebase key): the copy's store, the published views' (`live/`), the League Standings
 * seasons' documents, a read of the rebuilds' ledger (`rebuildLedger.ts`, its fields as written or
 * null where there is none), and what the owner staged for the server (`uploads.ts`).
 */
export type ServerStores = {
  copy: CloudStore;
  live: LiveStore;
  leagueDocs: LeagueDocsList;
  readLedger: () => Promise<unknown>;
  /** The rebuild job's control document (`rebuildJobControl.ts`), its fields or null. */
  readRebuildJob: () => Promise<unknown>;
  uploads: UploadStore;
  /**
   * The refresh gate (`refreshGate.ts`): the nightly waits there for a "Refresh now" under way, and
   * names itself while it pulls.
   */
  gate: GateDocs;
  /** A pull's job, as the gate names one: the refresh the nightly waits on. */
  readJob: (jobId: string) => Promise<PullJob | null>;
  /**
   * The copy's manifest, its fields as stored, and when Firestore last wrote it, by Firestore's own
   * clock (its update time), or null where there is no copy: what the catch-up between nights holds
   * the boards to, and how long the copy has been still (`catchUp.ts`).
   */
  readCopyAt: () => Promise<{ manifest: unknown; savedAt: string } | null>;
  /**
   * Every pull queued or running (`pullJobs`), "Refresh now" and pasted lists alike, as
   * `coercePullJob` reads each: one it cannot read is left out.
   */
  pullsUnderWay: () => Promise<PullJob[]>;
  /**
   * When a League Standings season was last deleted, as noted (`noteLeagueDeleted`), or undefined
   * where none is: the settle counts it as a save (`afterPullDecision`).
   */
  leagueDeletedAt?: () => Promise<string | undefined>;
  /**
   * Keeps the weekly re-measure of where a rating starts for the Model check card
   * (`closedLevelRecord.ts`), beside the views, in place of the last one: written as the views
   * are, so refused by a store opened to read.
   */
  writeClosedLevel: (record: ClosedLevelRecord) => Promise<void>;
};

const refuseWrite = () => Promise.reject(new Error("This store was opened to read, not to write."));

/**
 * Those stores, read only unless `writable`: `true` for the nightly's live run, which saves the
 * copy, publishes the views and keeps the starting level's weekly record beside them, deletes staged
 * uploads and takes its turn at the refresh gate; `false`
 * for its dry run, which writes nothing; and `"live"` for the republish after a deploy and the
 * catch-up between nights, which write the views and nothing else, so a slip in either cannot touch
 * the copy it builds them from. The seasons, the ledger, the jobs and the rebuild job's control are
 * never written, whatever the stores are opened for.
 */
export const restServerStores = (access: RestAccess, writable: boolean | "live"): ServerStores => {
  const copyWrites = { ...access, writable: writable === true };
  const docs = firestoreRestDocuments(access);
  return {
    copy: firestoreRestStore(copyWrites),
    live: firestoreRestLive({ ...access, writable: writable !== false }),
    leagueDocs: restLeagueDocs(docs),
    readLedger: () => docs.read(REBUILD_LEDGER_PATH),
    readRebuildJob: () => docs.read(REBUILD_JOB_CONTROL),
    uploads: firestoreRestUploads(copyWrites),
    gate: {
      readAt: (path) => docs.readAt(path),
      replace:
        writable === true
          ? (path, fields, token) => docs.replace(path, fields, token)
          : refuseWrite,
    },
    readJob: async (jobId) => coercePullJob(await docs.read(jobPath(jobId))),
    readCopyAt: async () => {
      const at = await docs.readAt(MANIFEST_PATH);
      return at ? { manifest: at.fields, savedAt: at.token } : null;
    },
    leagueDeletedAt: async () => leagueDeletedAt(await docs.read(LEAGUE_DELETED_PATH)),
    writeClosedLevel:
      writable === false
        ? refuseWrite
        : async (record) => {
            // In place of whatever is there: read its version, and write over that version only,
            // a few times over should another write land between the two.
            for (let tries = 0; tries < 3; tries += 1) {
              const kept = await docs.readAt(CLOSED_LEVEL_PATH);
              if (await docs.replace(CLOSED_LEVEL_PATH, record, kept?.token ?? null)) return;
            }
            throw new Error("The starting level's record kept changing while it was written.");
          },
    pullsUnderWay: async () =>
      (await docs.where(JOBS_COLLECTION, "status", ["queued", "running"])).flatMap(
        ({ fields }) => coercePullJob(fields) ?? []
      ),
  };
};
