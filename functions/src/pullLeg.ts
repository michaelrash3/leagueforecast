/**
 * One leg of a pull in the cloud, run in a worker thread of its own by `runPull` (`index.ts`),
 * which sets how much memory it may hold and, before starting it, the job's time zone: a worker
 * cannot change its own, and one started after its parent changes the zone keeps the new one.
 *
 * It answers its parent once, with how the leg ended or why it could not run, and then ends, and
 * everything the leg held goes with it.
 */
import { parentPort, workerData } from "node:worker_threads";
import { handlerFetch } from "../../scripts/handlerFetch";
import { firestoreRestDocuments, firestoreRestStore } from "../../src/lib/cloud/firestoreRest";
import { restJobDocs, runPullLeg, type LegTask } from "../../src/lib/cloud/pullJobRunner";
import { fetchGcTeams } from "../../src/lib/gameChangerClient";
import { resetTeamRankingsStore } from "../../src/lib/teamRankingsStorage";
import { enqueueLeg, restAccess, zoneOf } from "./pullAccess";

export type LegRequest = { task: LegTask; lastTry: boolean };
export type LegAnswer = { outcome: string } | { error: string };

const { task, lastTry } = workerData as LegRequest;
let answer: LegAnswer;
try {
  const access = restAccess(task.ownerUid);
  const outcome = await runPullLeg(task, {
    jobs: restJobDocs(firestoreRestDocuments(access), task.ownerUid),
    store: firestoreRestStore({ ...access, writable: true }),
    fetchTeams: (ids, options) => fetchGcTeams(ids, { ...options, fetchImpl: handlerFetch() }),
    now: () => new Date(),
    enqueue: enqueueLeg,
    inTimeZone: (timeZone) => {
      // The parent set it; a leg filed in another zone's day would log the wrong day as pulled.
      const running = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (running !== zoneOf(timeZone)) {
        throw new Error(`The leg runs in ${running}, not the pull's ${zoneOf(timeZone)}.`);
      }
    },
    lastTry,
  });
  answer = { outcome };
} catch (error) {
  answer = { error: error instanceof Error ? error.message : String(error) };
} finally {
  resetTeamRankingsStore();
}
parentPort?.postMessage(answer);
