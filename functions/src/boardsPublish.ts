/**
 * The `boards-publish` Cloud Run job (`afterPull.ts`; README, "Boards published when a pull ends"):
 * started at the end of a pull whose save no rebuild is coming to publish, it asks again, and where
 * the boards still want it, publishes them from the copy as it stands. One execution, no retries:
 * a publish that fails is the catch-up's and the nightly's to make, and it fails nothing of the
 * pull, which is over. It logs counts, sizes and timings only, as the nightly does.
 */
import { randomUUID } from "node:crypto";
import process from "node:process";
import { failureWords, firestoreRestDocuments } from "../../src/lib/cloud/firestoreRest";
import { budgetDay } from "../../src/lib/cloud/refreshGate";
import { publishAfterPull } from "../../src/lib/live/afterPull";
import { publishLease } from "../../src/lib/live/publishLease";
import { restServerStores } from "../../src/lib/live/serverStores";
import { resetTeamRankingsStore } from "../../src/lib/teamRankingsStorage";
import { restAccess } from "./pullAccess";

/** Whether this build holds the rebuilds after saves: set by `build.mjs` from LIVE_REBUILD. */
declare const LIVE_REBUILD: boolean;

const started = Date.now();
const log = (event: string, fields: Record<string, unknown> = {}) =>
  console.log(
    JSON.stringify({
      message: "boards-publish",
      event,
      execution: process.env.CLOUD_RUN_EXECUTION,
      seconds: Math.round((Date.now() - started) / 1000),
      ...fields,
    })
  );

try {
  // The views written, and the lease this job holds while it publishes (`publishLease.ts`), and
  // nothing else: the copy, the seasons, the jobs and the ledger only read.
  const access = restAccess();
  const run = await publishAfterPull(restServerStores(access, "live"), {
    lease: publishLease(firestoreRestDocuments(access)),
    owner: randomUUID(),
    today: () => budgetDay(new Date()),
    now: () => new Date(),
    rebuilds: LIVE_REBUILD,
    onViews: (views) =>
      log(
        "boards-views",
        views.ok
          ? {
              ok: true,
              boards: views.boards,
              clubs: views.clubs,
              searches: views.searches,
              games: views.games,
              buildMs: views.buildMs,
            }
          : { ok: false, reason: views.reason }
      ),
  });
  log(
    "boards-after-pull",
    run.decided.publish
      ? {
          behind: run.decided.behind,
          end: run.result?.end,
          tries: run.result?.tries,
          rounds: run.rounds,
        }
      : { left: run.decided.because, rounds: run.rounds }
  );
} catch (error) {
  // The message and the network's code only.
  log("boards-after-pull-failed", { error: failureWords(error) });
} finally {
  // The store opens a channel to other tabs that would keep the process alive.
  resetTeamRankingsStore();
}
process.exit(0);
