/**
 * The end of a pull asks whether the boards want publishing now (`afterPull.ts`; README, "Boards
 * published when a pull ends"), and where they do, starts the `boards-publish` job: from the import
 * job (`importJob.ts`) once an import or a part of a list has ended, and from `runPull` (`index.ts`)
 * once the last leg of "Refresh now", or of a list of the older kind, has. It only reads, and it
 * never throws: whatever stops it is said in the line its caller logs, and the catch-up and the
 * nightly publish the boards later.
 */
import { failureWords } from "../../src/lib/cloud/firestoreRest";
import { budgetDay } from "../../src/lib/cloud/refreshGate";
import { askInTime, launchAfterPull } from "../../src/lib/live/afterPull";
import { restServerStores } from "../../src/lib/live/serverStores";
import { launchBoardsPublish, restAccess } from "./pullAccess";

/** `deadline`: when the caller's own time is up, in milliseconds since the epoch (`askInTime`). */
export const publishBoardsIfDue = async (
  deadline = Number.POSITIVE_INFINITY
): Promise<Record<string, unknown>> => {
  try {
    const now = new Date();
    const decided = await askInTime(
      () =>
        launchAfterPull(
          restServerStores(restAccess(), false),
          launchBoardsPublish,
          budgetDay(now),
          now
        ),
      deadline,
      now.getTime()
    );
    if (decided === null) return { boards: "not-asked", because: "no-time" };
    return decided.publish
      ? { boards: "publishing", behind: decided.behind }
      : { boards: "left", because: decided.because };
  } catch (error) {
    return { boards: "not-asked", error: failureWords(error) };
  }
};
