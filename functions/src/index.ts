/**
 * The app's Firebase functions. Bundled with esbuild into `lib/index.js` (`npm run build`), so the
 * handler is the very file Vercel runs rather than a copy of it: see `serveGcProxy` for what a
 * function on another host adds.
 */
import { Worker } from "node:worker_threads";
import { logger } from "firebase-functions";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { onMessagePublished } from "firebase-functions/v2/pubsub";
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import gcTeamHandler from "../../api/gc-team";
import { capBilling, describeCap } from "../../src/lib/billingCap";
import { firestoreRestDocuments } from "../../src/lib/cloud/firestoreRest";
import { JOB_ID } from "../../src/lib/cloud/pullJobs";
import { restJobDocs, startPullJob, type LegTask } from "../../src/lib/cloud/pullJobRunner";
import { serveGcProxy } from "../../src/lib/firebaseProxy";
import { enqueueLeg, REGION, restAccess, zoneOf } from "./pullAccess";
import type { LegAnswer, LegRequest } from "./pullLeg";

/**
 * GET /gcTeam?ids=<id,id,…>&raw=1 — the GameChanger proxy, as `/api/gc-team` is on Vercel.
 *
 * Public, as that one is: GameChanger's endpoints need no login and nothing here is secret. A
 * handful of instances at most, each taking many requests at once, since a batch spends its time
 * waiting on GameChanger rather than computing; the per-instance limiter and profile cache in the
 * handler go further with fewer, busier instances.
 */
export const gcTeam = onRequest(
  {
    region: "us-central1",
    invoker: "public",
    memory: "256MiB",
    timeoutSeconds: 60,
    concurrency: 40,
    maxInstances: 5,
  },
  (req, res) => serveGcProxy(req, res, gcTeamHandler)
);

/**
 * The hard stop on the project's bill (`billingCap.ts`): reads each budget reading published to
 * the `billing-cap` topic and takes the project off its billing account once the month's cost has
 * reached the budget.
 *
 * It runs as a service account of its own, `billing-cap`, because it is the one thing here that
 * may turn billing off: the proxy's identity, which answers anybody, is not given that. One
 * instance, and no retry: a budget publishes several readings a day, so a stop that fails is tried
 * again by the next one, and a failure is logged as an error either way.
 */
export const billingCap = onMessagePublished(
  {
    topic: "billing-cap",
    region: "us-central1",
    serviceAccount: "billing-cap@",
    memory: "256MiB",
    timeoutSeconds: 60,
    maxInstances: 1,
    retry: false,
  },
  async (event) => {
    const outcome = await capBilling(event.data.message.data);
    const line = describeCap(outcome);
    if (outcome.kind === "failed") {
      logger.error(line);
      throw new Error(line);
    }
    if (outcome.kind === "stopped") logger.warn(line);
    else logger.info(line);
  }
);

/*
 * Pulls in the cloud (README, "Pulls in the cloud"): a device leaves a pasted list as a job beside
 * the cloud copy (`pullJobs.ts`) and asks `startPull` to run it, and `runPull` pulls it into the
 * copy a leg at a time (`pullJobRunner.ts`), each leg a Cloud Tasks task queueing the next.
 *
 * Both run as a service account of their own, `pull-runner`, which may read and write Firestore,
 * queue a task and send it to `runPull`, and nothing else; the one-time setup that makes it, and
 * turns Cloud Tasks on, is in the README.
 */

/**
 * Whether this build holds the pulls in the cloud: set by `build.mjs` from CLOUD_PULLS, the last
 * step of their one-time setup. Without them the project deploys as it did before them.
 */
declare const CLOUD_PULLS: boolean;

/** Tries a leg gets, the first included, before its job is marked failed. */
const LEG_TRIES = 3;

/**
 * The most a leg's worker may hold, of the instance's 8 GiB: the rest is for what a heap does not
 * count, the gzipped pieces and the answers' bytes, and for the function itself. The nightly
 * refresh, pulling 15,793 teams into the whole pool, held 3.5 GB at its end on 29 September 2026.
 */
const LEG_HEAP_MB = 5_120;

/**
 * POST (callable) `startPull` `{ jobId }`: queues the first leg of a job the signed-in device has
 * written. Signed in with Google, as the rules ask of anything that touches the copy; the job's
 * own document is the rest of the check.
 */
export const startPull = !CLOUD_PULLS
  ? undefined
  : onCall(
      {
        region: REGION,
        invoker: "public",
        serviceAccount: "pull-runner@",
        memory: "256MiB",
        timeoutSeconds: 30,
        maxInstances: 2,
      },
      async (request) => {
        if (request.auth?.token.firebase.sign_in_provider !== "google.com") {
          throw new HttpsError("unauthenticated", "Sign in with Google to pull in the cloud.");
        }
        const jobId = (request.data as { jobId?: unknown } | null)?.jobId;
        const started = await startPullJob(jobId, {
          jobs: restJobDocs(firestoreRestDocuments(restAccess())),
          enqueue: enqueueLeg,
        });
        if (!started.ok) {
          throw new HttpsError(
            started.refusal,
            started.refusal === "not-found" ? "There is no such pull." : "That is not a pull's id."
          );
        }
        return { status: started.status };
      }
    );

/** Runs a leg in a worker of its own, holding at most `LEG_HEAP_MB`, and hands back its answer. */
const legInWorker = (request: LegRequest): Promise<LegAnswer> =>
  new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./pullLeg.js", import.meta.url), {
      workerData: request,
      resourceLimits: { maxOldGenerationSizeMb: LEG_HEAP_MB },
    });
    let answered = false;
    worker.once("message", (answer: LegAnswer) => {
      answered = true;
      resolve(answer);
      void worker.terminate();
    });
    worker.once("error", (error: Error & { code?: string }) => {
      reject(
        error.code === "ERR_WORKER_OUT_OF_MEMORY"
          ? new Error("The pull ran out of memory on the cloud's server.")
          : error
      );
    });
    worker.once("exit", (code) => {
      if (!answered)
        reject(new Error(`The pull's worker stopped (exit ${code}) without an answer.`));
    });
  });

/**
 * One leg of a pull, as Cloud Tasks sends it. One at a time, on one instance with the memory the
 * whole pool takes. A leg has half an hour, the most a task may; one that fails is tried twice
 * more, two minutes apart and then longer, and its job marked failed after the third.
 */
export const runPull = !CLOUD_PULLS
  ? undefined
  : onTaskDispatched<LegTask>(
      {
        region: REGION,
        serviceAccount: "pull-runner@",
        memory: "8GiB",
        cpu: 2,
        timeoutSeconds: 1800,
        maxInstances: 1,
        concurrency: 1,
        retryConfig: { maxAttempts: LEG_TRIES, minBackoffSeconds: 120 },
        rateLimits: { maxConcurrentDispatches: 1 },
      },
      async (request) => {
        const task = request.data;
        const lastTry = (request.retryCount ?? 0) + 1 >= LEG_TRIES;
        const said = (what: string) => `Leg ${task.leg} of pull ${task.jobId}: ${what}`;
        if (typeof task.jobId !== "string" || !JOB_ID.test(task.jobId)) {
          logger.warn(said("not a pull's id; nothing done."));
          return;
        }
        const jobs = restJobDocs(firestoreRestDocuments(restAccess()));
        const job = await jobs.read(task.jobId);
        if (!job) {
          logger.info(said("no such pull; nothing done."));
          return;
        }
        // The day the leg files and logs in is the device's; its worker keeps the zone set here.
        process.env.TZ = zoneOf(job.timeZone);
        const started = Date.now();
        let answer: LegAnswer;
        try {
          answer = await legInWorker({ task, lastTry });
        } catch (error) {
          answer = { error: error instanceof Error ? error.message : String(error) };
        }
        const took = `${Math.round((Date.now() - started) / 1000)} s`;
        if ("error" in answer) {
          logger.error(said(`${answer.error} (${took}${lastTry ? ", its last try" : ""})`));
          // Tried again later, while tries are left.
          if (!lastTry) throw new Error(answer.error);
          // Otherwise the job says so, if its worker died before it could.
          const now = await jobs.read(task.jobId).catch(() => null);
          if (now?.status === "queued" || now?.status === "running") {
            await jobs
              .update(task.jobId, {
                status: "failed",
                stage: "waiting",
                error: answer.error,
                updatedAt: new Date().toISOString(),
              })
              .catch(() => undefined);
          }
          return;
        }
        logger.info(said(`${answer.outcome} in ${took}.`));
      }
    );
