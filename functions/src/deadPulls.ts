/**
 * Pulls whose worker died without a word, ended by the cloud on its own rounds (`reapSilentPulls`;
 * README, "A pull gone silent"): every ask of `startPull`, the end of every
 * pull (`importJob.ts`, `runPull`), and every check of the boards a save queues. Never throws: what
 * stopped it is said in the line its caller logs, and the next round tries again.
 */
import { failureWords, firestoreRestDocuments } from "../../src/lib/cloud/firestoreRest";
import { importLeaseUntil } from "../../src/lib/cloud/importLease";
import { reapSilentPulls, restJobDocs } from "../../src/lib/cloud/pullJobRunner";
import { JOBS_COLLECTION } from "../../src/lib/cloud/pullJobs";
import { restAccess } from "./pullAccess";

const reap = async (
  skip: string | undefined,
  stopped: () => boolean
): Promise<Record<string, unknown>> => {
  try {
    const docs = firestoreRestDocuments(restAccess());
    const { ended } = await reapSilentPulls({
      running: () => docs.where(JOBS_COLLECTION, "status", ["running"]),
      jobs: restJobDocs(docs),
      leaseUntil: (jobId) => importLeaseUntil(docs, jobId),
      now: () => new Date(),
      ...(skip !== undefined ? { skip } : {}),
      stopped,
    });
    return ended > 0 ? { deadPullsEnded: ended } : {};
  } catch (error) {
    return { deadPullsUnread: failureWords(error) };
  }
};

/**
 * For the caller's line: how many dead pulls were ended, where any were, and nothing otherwise.
 * Waited on for `withinMs` at most, so a slow Firestore never holds a caller past its own time
 * (`startPull` answers a device within thirty seconds); one not done by then is told to stop, and
 * ends no more pulls after the one it is on. `skip` is a job the caller acts on itself.
 */
export const endDeadPulls = async (
  withinMs = Number.POSITIVE_INFINITY,
  skip?: string
): Promise<Record<string, unknown>> => {
  let late = false;
  const ending = reap(skip, () => late);
  if (withinMs === Number.POSITIVE_INFINITY) return ending;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      ending,
      new Promise<Record<string, unknown>>((resolve) => {
        timer = setTimeout(
          () => {
            late = true;
            resolve({ deadPullsUnread: "out of time" });
          },
          Math.max(0, withinMs)
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
