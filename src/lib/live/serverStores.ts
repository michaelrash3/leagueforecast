import type { CloudStore } from "../cloud/cloudEngine";
import {
  firestoreRestDocuments,
  firestoreRestLive,
  firestoreRestStore,
  firestoreRestUploads,
  type RestAccess,
} from "../cloud/firestoreRest";
import { coercePullJob, jobPath, type PullJob } from "../cloud/pullJobs";
import type { GateDocs } from "../cloud/refreshGate";
import type { UploadStore } from "../cloud/uploads";
import { restLeagueDocs, type LeagueDocsList } from "./cloudLeague";
import { REBUILD_LEDGER_PATH } from "./rebuildLedger";
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
  uploads: UploadStore;
  /**
   * The refresh gate (`refreshGate.ts`): the nightly waits there for a "Refresh now" under way, and
   * names itself while it pulls.
   */
  gate: GateDocs;
  /** A pull's job, as the gate names one: the refresh the nightly waits on. */
  readJob: (jobId: string) => Promise<PullJob | null>;
};

const refuseWrite = () => Promise.reject(new Error("This store was opened to read, not to write."));

/**
 * Those stores, read only unless `writable`: `true` for the nightly's live run, which saves the
 * copy, publishes the views, deletes staged uploads and takes its turn at the refresh gate; `false`
 * for its dry run, which writes nothing; and `"live"` for the republish after a deploy, which writes
 * the views and nothing else, so a slip in it cannot touch the copy it builds them from. The
 * seasons, the ledger and the jobs are never written, whatever the stores are opened for.
 */
export const restServerStores = (access: RestAccess, writable: boolean | "live"): ServerStores => {
  const copyWrites = { ...access, writable: writable === true };
  const docs = firestoreRestDocuments(access);
  return {
    copy: firestoreRestStore(copyWrites),
    live: firestoreRestLive({ ...access, writable: writable !== false }),
    leagueDocs: restLeagueDocs(docs),
    readLedger: () => docs.read(REBUILD_LEDGER_PATH),
    uploads: firestoreRestUploads(copyWrites),
    gate: {
      readAt: (path) => docs.readAt(path),
      replace:
        writable === true
          ? (path, fields, token) => docs.replace(path, fields, token)
          : refuseWrite,
    },
    readJob: async (jobId) => coercePullJob(await docs.read(jobPath(jobId))),
  };
};
