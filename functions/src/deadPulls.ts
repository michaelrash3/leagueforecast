/**
 * Pulls whose worker died without a word, ended by the cloud on its own rounds (`reapSilentPulls`;
 * README, "A pull gone silent"): every ask of `startPull`, the end of every
 * pull (`importJob.ts`, `runPull`), and every check of the boards a save queues. Never throws: what
 * stopped it is said in the line its caller logs, and the next round tries again.
 */
import { failureWords, firestoreRestDocuments } from "../../src/lib/cloud/firestoreRest";
import { importLeaseUntil } from "../../src/lib/cloud/importLease";
import { reapSilentPullsWithin, restJobDocs } from "../../src/lib/cloud/pullJobRunner";
import { JOBS_COLLECTION } from "../../src/lib/cloud/pullJobs";
import { restAccess } from "./pullAccess";

/**
 * For the caller's line: how many dead pulls were ended, where any were, that time ran out where it
 * did, and nothing otherwise. Given `withinMs` at most, so a slow Firestore never holds a caller past
 * its own time (`startPull` answers a device within thirty seconds), and ending nothing once that is
 * up, so no pull is ended behind a caller gone on to ask about the boards (`reapSilentPullsWithin`).
 * `skip` is a job the caller acts on itself.
 */
export const endDeadPulls = async (
  withinMs = Number.POSITIVE_INFINITY,
  skip?: string
): Promise<Record<string, unknown>> => {
  try {
    const docs = firestoreRestDocuments(restAccess());
    const { ended, late } = await reapSilentPullsWithin(
      {
        running: () => docs.where(JOBS_COLLECTION, "status", ["running"]),
        jobs: restJobDocs(docs),
        leaseUntil: (jobId) => importLeaseUntil(docs, jobId),
        now: () => new Date(),
        ...(skip !== undefined ? { skip } : {}),
      },
      withinMs
    );
    return {
      ...(ended > 0 ? { deadPullsEnded: ended } : {}),
      ...(late ? { deadPullsUnread: "out of time" } : {}),
    };
  } catch (error) {
    return { deadPullsUnread: failureWords(error) };
  }
};
