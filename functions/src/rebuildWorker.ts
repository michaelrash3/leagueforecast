/**
 * The worker a rebuild builds and publishes the boards in (`rebuildWorkerProtocol.ts`), started by
 * the `rebuild` function (`index.ts`) and kept from run to run while the ledger says warm, so a
 * rebuild after a small save fetches only the pieces that moved.
 *
 * It holds one pool for its whole life. Nothing here empties the pool store but the pool itself: no
 * reset of the store, and no load of a pool by any other way, either of which would leave the pool
 * naming a copy its store no longer holds. A pool that is to go goes with the worker, which the
 * function ends.
 */
import { parentPort } from "node:worker_threads";
import { firestoreRestLive, firestoreRestStore } from "../../src/lib/cloud/firestoreRest";
import { todayIsoDay } from "../../src/lib/date";
import { createPoolCache } from "../../src/lib/live/poolCache";
import { runRebuild } from "../../src/lib/live/rebuild";
import {
  answerRebuild,
  memoryOf,
  type RebuildRequest,
} from "../../src/lib/live/rebuildWorkerProtocol";
import { restAccess } from "./pullAccess";

const pool = createPoolCache();

parentPort?.on("message", (request: RebuildRequest) => {
  void answerRebuild(request, {
    run: ({ dry, deadline }) => {
      const access = restAccess();
      return runRebuild({
        // The copy is only read; `live/` is written only by a live run.
        copyStore: firestoreRestStore({ ...access, writable: false }),
        liveStore: firestoreRestLive({ ...access, writable: !dry }),
        pool,
        // The zone is New York's: the function set it before it started this worker.
        today: () => todayIsoDay(),
        now: () => new Date().toISOString(),
        dry,
        deadline,
      });
    },
    memory: () => memoryOf(process.memoryUsage()),
  }).then((answer) => parentPort?.postMessage(answer));
});
