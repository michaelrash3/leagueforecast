/**
 * The end of a pull, and a save's check, ask whether the boards want publishing now
 * (`afterPull.ts`; README, "Boards published when a pull ends"), and where they do, start the
 * `boards-publish` job: from the import job (`importJob.ts`) once an import or a part of a list has
 * ended, from `runPull` (`index.ts`) once the last leg of "Refresh now", or of a list of the older
 * kind, has, and from the rebuilds' queue for the check an edit or a League score queues
 * (`boardsCheck.ts`). They only read, but for the lease a launch claims (`publishLease.ts`), and
 * they never throw: whatever stops them is said in the line their caller logs, and the catch-up and
 * the nightly publish the boards later.
 */
import { failureWords, firestoreRestDocuments } from "../../src/lib/cloud/firestoreRest";
import { budgetDay } from "../../src/lib/cloud/refreshGate";
import { askInTime, launchAfterPull, rebuildWillPublish } from "../../src/lib/live/afterPull";
import { boardsCheckTask } from "../../src/lib/live/boardsCheck";
import { publishLease } from "../../src/lib/live/publishLease";
import { restLedgerStore } from "../../src/lib/live/rebuildLedger";
import { restServerStores } from "../../src/lib/live/serverStores";
import { enqueueBoardsCheck, launchBoardsPublish, restAccess } from "./pullAccess";

/** Whether this build holds the rebuilds after saves: set by `build.mjs` from LIVE_REBUILD. */
declare const LIVE_REBUILD: boolean;

/**
 * `deadline`: when the caller's own time is up, in milliseconds since the epoch (`askInTime`).
 * `settleMs`: how long the copy and the seasons must have been still, none at a pull's end.
 */
export const publishBoardsIfDue = async (
  deadline = Number.POSITIVE_INFINITY,
  settleMs = 0
): Promise<Record<string, unknown>> => {
  try {
    const now = new Date();
    const access = restAccess();
    const decided = await askInTime(
      () =>
        launchAfterPull(
          restServerStores(access, false),
          launchBoardsPublish,
          budgetDay(now),
          now,
          LIVE_REBUILD,
          publishLease(firestoreRestDocuments(access)),
          settleMs
        ),
      deadline,
      now.getTime()
    );
    if (decided === null) return { boards: "not-asked", because: "no-time" };
    if (decided.publish) return { boards: "publishing", behind: decided.behind };
    return decided.because === "publishing" && decided.until !== undefined
      ? { boards: "left", because: decided.because, until: decided.until }
      : { boards: "left", because: decided.because };
  } catch (error) {
    return { boards: "not-asked", error: failureWords(error) };
  }
};

/**
 * After a save at `savedAt` (Firestore's commit time): its check of the boards queued, where no
 * rebuild is coming to publish it (`rebuildWillPublish`, as the decision itself asks), and nothing
 * where one is, which is the boards' way after any save while the rebuilds' budget lasts.
 */
export const queueBoardsCheck = async (savedAt: string): Promise<Record<string, unknown>> => {
  try {
    const now = new Date();
    const ledger = await restLedgerStore(firestoreRestDocuments(restAccess())).read();
    if (rebuildWillPublish(ledger.raw, budgetDay(now), now)) return { check: "rebuild-coming" };
    await enqueueBoardsCheck(await boardsCheckTask(savedAt));
    return { check: "queued" };
  } catch (error) {
    return { check: "not-queued", error: failureWords(error) };
  }
};
