/**
 * The worker the edit function runs edits in (`editWorkerProtocol.ts`), started by the `edit`
 * function (`index.ts`) and kept from request to request, so an edit after the first fetches only
 * what other saves moved.
 *
 * It holds one pool for its whole life, of every part a command may touch. Nothing here empties the
 * pool store but the pool itself: no reset of the store, and no load of a pool by any other way,
 * either of which would leave the pool naming a copy its store no longer holds. A pool that is to go
 * goes with the worker, which the function ends.
 */
import { getHeapStatistics } from "node:v8";
import { parentPort } from "node:worker_threads";
import { firestoreRestDocuments, firestoreRestStore } from "../../src/lib/cloud/firestoreRest";
import { restLeagueDocs } from "../../src/lib/live/cloudLeague";
import { runEdit, runQuery } from "../../src/lib/live/editRun";
import { answerEdit, type EditRequest } from "../../src/lib/live/editWorkerProtocol";
import { createEditPool } from "../../src/lib/live/poolCache";
import { memoryOf } from "../../src/lib/live/rebuildWorkerProtocol";
import { restAccess } from "./pullAccess";

const pool = createEditPool();

const now = () => new Date().toISOString();

parentPort?.on("message", (request: EditRequest) => {
  void answerEdit(request, {
    edit: (ask) =>
      runEdit({
        pool,
        // The one function that writes the copy on a member's behalf.
        store: firestoreRestStore({ ...restAccess(), writable: true }),
        command: ask.command,
        ...(ask.copy === undefined ? {} : { copy: ask.copy }),
        now,
      }),
    // A question writes nothing, so it reads the copy as the warm-up does.
    query: (ask) =>
      runQuery({
        pool,
        store: firestoreRestStore({ ...restAccess(), writable: false }),
        leagueDocs: restLeagueDocs(firestoreRestDocuments({ ...restAccess(), writable: false })),
        query: ask.query,
        ...(ask.copy === undefined ? {} : { copy: ask.copy }),
      }),
    warm: async () => {
      const started = Date.now();
      const ensured = await pool.ensure(firestoreRestStore({ ...restAccess(), writable: false }));
      return ensured.ok
        ? {
            ok: true,
            cold: ensured.cold,
            fetched: ensured.fetched.length,
            loadMs: Date.now() - started,
          }
        : { ok: false, reason: ensured.reason };
    },
    // Read here, in the worker: the main thread's heap and limit are not the worker's.
    memory: () =>
      memoryOf({ ...process.memoryUsage(), heapLimit: getHeapStatistics().heap_size_limit }),
  }).then((answer) => parentPort?.postMessage(answer));
});
