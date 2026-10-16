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

const reap = async (): Promise<Record<string, unknown>> => {
  try {
    const docs = firestoreRestDocuments(restAccess());
    const { ended } = await reapSilentPulls({
      running: () => docs.where(JOBS_COLLECTION, "status", ["running"]),
      jobs: restJobDocs(docs),
      leaseUntil: (jobId) => importLeaseUntil(docs, jobId),
      now: () => new Date(),
    });
    return ended > 0 ? { deadPullsEnded: ended } : {};
  } catch (error) {
    return { deadPullsUnread: failureWords(error) };
  }
};

/**
 * For the caller's line: how many dead pulls were ended, where any were, and nothing otherwise.
 * Waited on for `withinMs` at most, so a slow Firestore never holds a caller past its own time
 * (`startPull` answers a device within thirty seconds); one not done by then is left to finish
 * meanwhile, every write of it made only on a job as read, or to the next round.
 */
export const endDeadPulls = async (
  withinMs = Number.POSITIVE_INFINITY
): Promise<Record<string, unknown>> => {
  const ending = reap();
  if (withinMs === Number.POSITIVE_INFINITY) return ending;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      ending,
      new Promise<Record<string, unknown>>((resolve) => {
        timer = setTimeout(
          () => resolve({ deadPullsUnread: "out of time" }),
          Math.max(0, withinMs)
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
