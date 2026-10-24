/**
 * One leg of a pull in the cloud, as `runPull` (`index.ts`) runs it for a Cloud Tasks task and as
 * a GitHub run of `cloud-pull.yml` runs it where the pulls are on GitHub (`legJob.ts`): the job
 * read, a staged list handed to its importer, any other leg run in a worker of its own, and the
 * leg's failure written on the job, while it is still the job's current leg, before it is tried
 * again. The leg that ends its job publishes the boards where no rebuild is coming to.
 */
import { Worker } from "node:worker_threads";
import { logger } from "firebase-functions";
import { firestoreRestDocuments } from "../../src/lib/cloud/firestoreRest";
import { JOB_ID } from "../../src/lib/cloud/pullJobs";
import { restJobDocs, type LegTask } from "../../src/lib/cloud/pullJobRunner";
import { PULL_WORKER_TIMEOUT_MS, waitForPullWorker } from "../../src/lib/cloud/pullWorkerLifetime";
import { publishBoardsIfDue } from "./afterPullLaunch";
import { endDeadPulls } from "./deadPulls";
import { restAccess, zoneOf } from "./pullAccess";
import type { LegAnswer, LegRequest } from "./pullLeg";

/** Tries a leg gets, the first included, before its job is marked failed. */
export const LEG_TRIES = 3;

/**
 * The most a leg's worker may hold, of the instance's 8 GiB: the rest is for what a heap does not
 * count, the gzipped pieces and the answers' bytes, and for the function itself. The nightly
 * refresh, pulling 15,793 teams into the whole pool, held 3.5 GB at its end on 29 September 2026.
 */
const LEG_HEAP_MB = 5_120;

/** Runs a leg in a worker of its own, holding at most `LEG_HEAP_MB`, and hands back its answer. */
const legInWorker = (request: LegRequest, deadlineMs: number): Promise<LegAnswer> => {
  const remainingMs = deadlineMs - Date.now();
  if (remainingMs <= 0)
    throw new Error("The pull could not start its worker before the request deadline.");
  const worker = new Worker(new URL("./pullLeg.js", import.meta.url), {
    workerData: request,
    resourceLimits: { maxOldGenerationSizeMb: LEG_HEAP_MB },
  });
  return waitForPullWorker<LegAnswer>(
    {
      onMessage: (listener) => {
        worker.once("message", listener);
      },
      onError: (listener) => {
        worker.once("error", listener);
      },
      onExit: (listener) => {
        worker.once("exit", listener);
      },
      stop: () => worker.terminate(),
    },
    remainingMs
  );
};

/** A leg's task's time limit, which the ask after its pull keeps five seconds inside. */
export const LEG_TIMEOUT_S = 1800;

/** How a leg that ended its job ends (`LegOutcome`): finished, stopped, or failed for good. */
const PULL_ENDED: ReadonlySet<string> = new Set(["done", "cancelled", "failed"]);

/**
 * Runs `task`'s leg, on its `lastTry` or not. A staged list is handed to `launchStaged`, which
 * starts its importer; a failure that is not the last try throws, for the leg to be tried again.
 */
export const runLeg = async (
  task: LegTask,
  lastTry: boolean,
  launchStaged: (jobId: string) => Promise<void>
): Promise<void> => {
  const said = (what: string) => `Leg ${task.leg} of pull ${task.jobId}: ${what}`;
  if (typeof task.jobId !== "string" || !JOB_ID.test(task.jobId)) {
    logger.warn(said("not a pull's id; nothing done."));
    return;
  }
  const jobs = restJobDocs(firestoreRestDocuments(restAccess()));
  const started = Date.now();
  let answer: LegAnswer;
  try {
    // Inside the try, so a read that fails on the last try still ends the job below rather
    // than leaving it "waiting to start" with no task left to run it.
    const job = await jobs.read(task.jobId);
    if (!job) {
      logger.info(said("no such pull; nothing done."));
      return;
    }
    if (job.pipeline === "staged-v1" && !job.rota) {
      if (!["done", "failed", "cancelled"].includes(job.status)) {
        await launchStaged(task.jobId);
        logger.info("import-launched", { jobId: task.jobId });
      }
      return;
    }
    // The day the leg files and logs in is the job's: the device's for a list it sent, New
    // York's for "Refresh now" (`REFRESH_ZONE`). Its worker keeps the zone set here.
    process.env.TZ = zoneOf(job.timeZone);
    answer = await legInWorker({ task, lastTry }, started + PULL_WORKER_TIMEOUT_MS);
  } catch (error) {
    answer = { error: error instanceof Error ? error.message : String(error) };
  }
  const took = `${Math.round((Date.now() - started) / 1000)} s`;
  if ("error" in answer) {
    logger.error(said(`${answer.error} (${took}${lastTry ? ", its last try" : ""})`));
    await legFailed(task, answer.error, lastTry, started);
    if (!lastTry) throw new Error(answer.error);
    return;
  }
  logger.info(said(`${answer.outcome} in ${took}.`));
  // The leg that ended its job, however it ended: what its legs saved goes on the boards now,
  // where no rebuild is coming to (`afterPull.ts`).
  if (PULL_ENDED.has(answer.outcome)) {
    logger.info("boards-after-pull", {
      jobId: task.jobId,
      // Dead pulls ended first: one still taken for a writer would hold the boards back.
      ...(await endDeadPulls(
        Math.min(10_000, started + LEG_TIMEOUT_S * 1000 - 5_000 - Date.now())
      )),
      ...(await publishBoardsIfDue(started + LEG_TIMEOUT_S * 1000 - 5_000)),
    });
  }
};

/**
 * Writes a leg's failure, `error`, on its job, on every try and only while the leg is still the
 * job's current one: as cancelled where a stop was asked, failed for good on the `lastTry`, and
 * otherwise left for the next try with the reason beside it. On the last try the boards are
 * published too, as its earlier legs' saves may want. A leg that failed in its worker comes here
 * from `runLeg`, and one on GitHub whose run failed before it could reach `runLeg` from `legJob.ts`.
 * Never throws.
 */
export const legFailed = async (
  task: LegTask,
  error: string,
  lastTry: boolean,
  started: number
): Promise<void> => {
  const jobs = restJobDocs(firestoreRestDocuments(restAccess()));
  const said = (what: string) => `Leg ${task.leg} of pull ${task.jobId}: ${what}`;
  // A killed worker cannot record its own failure. Record it on every try, while this
  // leg is still current; a stopped or advanced job must never be overwritten by it.
  const now = await jobs.read(task.jobId).catch(() => null);
  if (now && (now.status === "queued" || now.status === "running") && now.legsDone === task.leg) {
    await jobs
      .updateIfUnchanged(task.jobId, now, {
        ...(now.stopAsked ? { status: "cancelled" } : lastTry ? { status: "failed" } : {}),
        stage: "waiting",
        error,
        updatedAt: new Date().toISOString(),
      })
      .catch((failure: unknown) => {
        logger.error(
          said(
            `could not record its failure: ${failure instanceof Error ? failure.message : String(failure)}`
          )
        );
      });
  }
  if (!lastTry) return;
  // The job is failed now, and its earlier legs' saves may want publishing.
  logger.info("boards-after-pull", {
    jobId: task.jobId,
    // Dead pulls ended first: one still taken for a writer would hold the boards back.
    ...(await endDeadPulls(Math.min(10_000, started + LEG_TIMEOUT_S * 1000 - 5_000 - Date.now()))),
    ...(await publishBoardsIfDue(started + LEG_TIMEOUT_S * 1000 - 5_000)),
  });
};
