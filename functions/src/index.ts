/**
 * The app's Firebase functions. Bundled with esbuild into `lib/index.js` (`npm run build`), so the
 * handler is the very file Vercel runs rather than a copy of it: see `serveGcProxy` for what a
 * function on another host adds.
 */
import { Worker } from "node:worker_threads";
import { logger } from "firebase-functions";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { onMessagePublished } from "firebase-functions/v2/pubsub";
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import gcTeamForMembers from "../../api/gc-team";
import { capBilling, describeCap } from "../../src/lib/billingCap";
import { FIREBASE_WEB_CONFIG } from "../../src/lib/cloud/cloudConfig";
import {
  firestoreRestDocuments,
  firestoreRestLive,
  firestoreRestStore,
} from "../../src/lib/cloud/firestoreRest";
import { JOB_ID } from "../../src/lib/cloud/pullJobs";
import { restJobDocs, startPullJob, type LegTask } from "../../src/lib/cloud/pullJobRunner";
import { todayIsoDay } from "../../src/lib/date";
import { serveGcProxy } from "../../src/lib/firebaseProxy";
import { handleRebuildTask } from "../../src/lib/live/rebuild";
import { coerceLedger, restLedgerStore } from "../../src/lib/live/rebuildLedger";
import { coerceRebuildTask } from "../../src/lib/live/rebuildPlan";
import { handleCopyWrite } from "../../src/lib/live/rebuildTrigger";
import {
  REBUILD_SIZE,
  REBUILD_TIMEOUT_S,
  REBUILD_WORKER_HEAP_MB,
  rebuildRunner,
  type RebuildPort,
} from "../../src/lib/live/rebuildWorkerProtocol";
import { createMemberCheck, MEMBERS_ONLY_MESSAGES } from "../../src/lib/memberCheck";
import { enqueueLeg, enqueueRebuild, REGION, restAccess, zoneOf } from "./pullAccess";
import type { LegAnswer, LegRequest } from "./pullLeg";

/**
 * GET /gcTeam?ids=<id,id,…>&raw=1 — the GameChanger proxy, as `/api/gc-team` is on Vercel.
 *
 * For the accounts on the cloud copy's list alone, as that one is (`memberCheck.ts`): a caller
 * sends its Firebase sign-in, and the check asks Firestore for the caller's own entry with it. The
 * invoker stays public because the check is the app's own, made with the caller's sign-in rather
 * than with a Google identity of the caller's. A handful of instances at most, each taking many
 * requests at once, since a batch spends its time waiting on GameChanger rather than computing;
 * the per-instance limiter, profile cache and list answers go further with fewer, busier
 * instances.
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
  (req, res) => serveGcProxy(req, res, gcTeamForMembers)
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

/** Whether a caller of `startPull` is on the cloud copy's list, asked once per instance. */
const startPullCheck = createMemberCheck({ projectId: FIREBASE_WEB_CONFIG.projectId });

/**
 * POST (callable) `startPull` `{ jobId }`: queues the first leg of a job the signed-in device has
 * written. For the accounts on the cloud copy's list, as the rules make anything that touches the
 * copy (`memberCheck.ts`, with the sign-in the call carries); the job's own document is the rest
 * of the check.
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
        const verdict = await startPullCheck(request.rawRequest.headers.authorization);
        if (verdict === "unavailable") {
          throw new HttpsError(
            "unavailable",
            "Could not check this account against the cloud copy's list just now. Try again in a minute."
          );
        }
        if (verdict !== "member") {
          throw new HttpsError(
            verdict === "signed-out" ? "unauthenticated" : "permission-denied",
            MEMBERS_ONLY_MESSAGES[verdict]
          );
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

/*
 * Rebuilds after saves (README, "Views a server publishes"): each write of the copy's manifest asks
 * `onCopyWrite` whether it moved anything a board reads, and it queues a `rebuild` task for the
 * window the save falls in. The task builds every board in a worker that keeps the pool from run to
 * run, and publishes them, metered by the ledger in `ops/rebuild`, whose switch turns it all off.
 *
 * Both run as an account of their own, `live-runner`, which may read and write Firestore, receive
 * the copy's events, queue a task and send it to `rebuild`, and nothing else; the one-time setup
 * that makes it is in the README ("Rebuilds after saves: the one-time setup").
 */

/**
 * Whether this build holds the rebuilds: set by `build.mjs` from LIVE_REBUILD, the last step of
 * their one-time setup. Without them the project deploys as it did before them.
 */
declare const LIVE_REBUILD: boolean;

/** The account both halves of a rebuild run as. */
const LIVE_RUNNER = "live-runner@";

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Each write of `copies/main`, and nothing under it (`rebuildTrigger.ts`): a save that moved a
 * board's input queues the rebuild of its window, and each is logged for `npm run live:lag`. Not
 * tried again: a save whose rebuild could not be queued says so in its line, and the next save, or
 * the nightly, publishes it; a write that failed every time would otherwise be retried for days.
 */
export const onCopyWrite = !LIVE_REBUILD
  ? undefined
  : onDocumentWritten(
      {
        document: "copies/main",
        region: REGION,
        serviceAccount: LIVE_RUNNER,
        memory: "256MiB",
        timeoutSeconds: 60,
        maxInstances: 2,
        retry: false,
      },
      async (event) => {
        const ledger = restLedgerStore(firestoreRestDocuments(restAccess()));
        const { level, message, line } = await handleCopyWrite({
          change: event.data,
          eventTime: event.time,
          // A switch that is not there, or not one, is off; a read that throws counts as on.
          readSwitch: async () => coerceLedger((await ledger.read()).raw)?.on === true,
          enqueue: enqueueRebuild,
        });
        logger[level](message, line);
      }
    );

/** How long this instance took to start, charged once: to the first run that settles on it. */
let startup: number | null = null;
/** The worker the rebuilds run in, kept from task to task (`rebuildRunner`). */
let runner: ReturnType<typeof rebuildRunner> | null = null;

/** A worker for the rebuild's runs, with a heap capped above where it is recycled. */
const startRebuildWorker = (): RebuildPort => {
  const worker = new Worker(new URL("./rebuildWorker.js", import.meta.url), {
    resourceLimits: { maxOldGenerationSizeMb: REBUILD_WORKER_HEAP_MB },
  });
  return {
    post: (request) => worker.postMessage(request),
    listen: ({ answer, error, exit }) => {
      worker.on("message", answer);
      worker.on("error", error);
      worker.on("exit", exit);
    },
    terminate: async () => {
      await worker.terminate();
    },
  };
};

/**
 * One rebuild, as the queue sends it (`handleRebuildTask`): the switch read, the boards checked,
 * the run reserved against the ledger, built and published in the worker, and what it cost settled.
 * One at a time, on one instance with the memory the whole pool takes, which the ledger prices a run
 * at; the queue tries a task again two minutes on and then four, past the span a run another try
 * may still be making holds the ledger for. A task of any shape but the trigger's is logged and
 * done with before anything is read.
 */
export const rebuild = !LIVE_REBUILD
  ? undefined
  : onTaskDispatched(
      {
        region: REGION,
        serviceAccount: LIVE_RUNNER,
        memory: "8GiB",
        cpu: REBUILD_SIZE.cpu,
        timeoutSeconds: REBUILD_TIMEOUT_S,
        maxInstances: 1,
        concurrency: 1,
        retryConfig: { maxAttempts: 3, minBackoffSeconds: 120 },
        rateLimits: { maxConcurrentDispatches: 1 },
      },
      async (request) => {
        startup ??= process.uptime();
        const task = coerceRebuildTask(request.data);
        if (!task) {
          logger.warn("rebuild", { end: "not-a-task" });
          return;
        }
        // New York's day, as the nightly's: set before the worker starts, which keeps the zone it
        // starts in.
        process.env.TZ = "America/New_York";
        runner ??= rebuildRunner({ spawn: startRebuildWorker });
        const access = restAccess();
        let done: Awaited<ReturnType<typeof handleRebuildTask>>;
        try {
          done = await handleRebuildTask({
            ledger: restLedgerStore(firestoreRestDocuments(access)),
            copyStore: firestoreRestStore({ ...access, writable: false }),
            liveStore: firestoreRestLive({ ...access, writable: false }),
            run: runner.run,
            today: () => todayIsoDay(),
            now: () => new Date().toISOString(),
            clock: Date.now,
            size: REBUILD_SIZE,
            startupS: () => {
              const seconds = startup ?? 0;
              startup = 0;
              return seconds;
            },
            task,
            taskId: typeof request.id === "string" ? request.id : "",
          });
        } catch (error) {
          logger.error("rebuild", {
            kind: task.kind,
            savedAt: task.savedAt,
            end: "threw",
            error: messageOf(error),
          });
          throw error;
        }
        if (!done.rethrow) {
          logger.info("rebuild", done.line);
          return;
        }
        logger.warn("rebuild", done.line);
        throw new Error(`The rebuild ended ${String(done.line.end)}; the queue tries it again.`);
      }
    );
