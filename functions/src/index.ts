/**
 * The app's Firebase functions. Bundled with esbuild into `lib/index.js` (`npm run build`), so the
 * handlers live under `server/`: see `serveGcProxy` for what a
 * function on another host adds.
 */
import { Worker } from "node:worker_threads";
import { logger } from "firebase-functions";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { onMessagePublished } from "firebase-functions/v2/pubsub";
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import gcTeamForMembers from "../../server/gc-team";
import leagueSummaryHandler from "../../server/league-summary";
import { capBilling, describeCap } from "../../src/lib/billingCap";
import { FIREBASE_WEB_CONFIG } from "../../src/lib/cloud/cloudConfig";
import {
  firestoreRestDocuments,
  firestoreRestStore,
  firestoreRestLive,
  MANIFEST_PATH,
} from "../../src/lib/cloud/firestoreRest";
import { randomId } from "../../src/lib/cloud/cloudManifest";
import { importLeaseUntil } from "../../src/lib/cloud/importLease";
import { JOB_ID, JOBS_COLLECTION } from "../../src/lib/cloud/pullJobs";
import {
  reapPullJob,
  restJobDocs,
  resumePullJob,
  startPullJob,
  stopPullsUnderWay,
  type LegTask,
} from "../../src/lib/cloud/pullJobRunner";
import { coerceRefreshAsk, startRefresh } from "../../src/lib/cloud/refreshGate";
import { todayIsoDay } from "../../src/lib/date";
import { serveGcProxy } from "../../src/lib/firebaseProxy";
import { coerceCommand, isOwnerCommand } from "../../src/lib/live/commands";
import { chargeQueue, handleEdit, handleQuery, handleWarm } from "../../src/lib/live/editHandle";
import {
  EDIT_CONCURRENCY,
  EDIT_SIZE,
  EDIT_TIMEOUT_S,
  EDIT_WORKER_HEAP_MB,
  editRunner,
  type EditPort,
} from "../../src/lib/live/editWorkerProtocol";
import { coerceQuery } from "../../src/lib/live/queries";
import { requestRebuildJob } from "../../src/lib/live/rebuildJobLaunch";
import { restLeagueDocs } from "../../src/lib/live/cloudLeague";
import { coerceLedger, restLedgerStore } from "../../src/lib/live/rebuildLedger";
import { coerceRebuildTask } from "../../src/lib/live/rebuildPlan";
import { handleCopyWrite, handleLeagueWrite } from "../../src/lib/live/rebuildTrigger";
import { startupCharge } from "../../src/lib/live/rebuildWorkerProtocol";
import {
  createMemberCheck,
  EDIT_MEMBERS_ONLY_MESSAGES,
  MEMBERS_ONLY_MESSAGES,
  onTheList,
  OWNER_ONLY_MESSAGE,
  WRITE_CHECK_TTL_MS,
} from "../../src/lib/memberCheck";
import {
  enqueueLeg,
  enqueueRebuild,
  launchImport,
  launchRebuild,
  REGION,
  restAccess,
  zoneOf,
} from "./pullAccess";
import { publishBoardsIfDue } from "./afterPullLaunch";
import type { LegAnswer, LegRequest } from "./pullLeg";
import { PULL_WORKER_TIMEOUT_MS, waitForPullWorker } from "../../src/lib/cloud/pullWorkerLifetime";

/**
 * GET /gcTeam?ids=<id,id,…>&raw=1 — the GameChanger proxy.
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

/** Both standings stories and ranking explanations use this Firebase endpoint. */
export const leagueSummary = onRequest(
  {
    region: REGION,
    invoker: "public",
    memory: "256MiB",
    timeoutSeconds: 60,
    concurrency: 10,
    maxInstances: 2,
  },
  (req, res) =>
    serveGcProxy(req, res, leagueSummaryHandler, {
      methods: "GET, POST",
      headers: "accept, content-type",
    })
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
 * Both run as `PULL_RUNNER`: an account that may read and write Firestore, queue a task and send it
 * to a function, and nothing else; the one-time setups that make the accounts, and turn Cloud Tasks
 * on, are in the README.
 */

/**
 * Whether this build holds the pulls in the cloud: set by `build.mjs` from CLOUD_PULLS, the last
 * step of their one-time setup. Without them the project deploys as it did before them.
 */
declare const CLOUD_PULLS: boolean;

/**
 * The account the pulls run as. With the rebuilds set up (`LIVE_REBUILD`), theirs, `live-runner`:
 * its one-time setup grants everything a pull needs (Firestore, queueing a task, sending one to a
 * function, and acting as itself to sign it), and rebuilds have queued and run tasks on it every
 * day. The pulls' own account was made out of order on 9 October 2026, after the first deploy that
 * needed it had failed for want of it, and two pulls sent from the live page on 10 October never
 * started under it; running them as an account known to work takes that setup out of the way.
 * Without the rebuilds, the pulls' own account, `pull-runner`, as their setup makes it.
 */
const PULL_RUNNER = LIVE_REBUILD ? "live-runner@" : "pull-runner@";

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
 *
 * Or `{ refresh: { device } }`: "Refresh now" from the live Import tab (README, "Refresh now in
 * the cloud"). The server makes the job itself, in New York's day as the nightly's, and its first
 * leg works out the teams as the nightly works them out, so a device names none, nor its own day;
 * it is started through the gate in `ops/refresh` (`startRefresh`), which hands back a refresh
 * already under way rather than starting another, turns a press away while the nightly pulls, and
 * counts the day's legs. Answered with the job's id, for the device to watch it as it watches a
 * list it sent.
 */
export const startPull = !CLOUD_PULLS
  ? undefined
  : onCall(
      {
        region: REGION,
        invoker: "public",
        serviceAccount: PULL_RUNNER,
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
        if (!onTheList(verdict)) {
          throw new HttpsError(
            verdict === "signed-out" ? "unauthenticated" : "permission-denied",
            MEMBERS_ONLY_MESSAGES[verdict]
          );
        }
        const data = (request.data ?? null) as { jobId?: unknown; refresh?: unknown } | null;
        if ((data as { importReady?: unknown } | null)?.importReady === true)
          return { status: "staged-ready" };
        if (data?.refresh !== undefined) {
          // One of the two, read exactly: a request naming a job beside a refresh is neither.
          const ask = data.jobId === undefined ? coerceRefreshAsk(data.refresh) : null;
          if (!ask)
            throw new HttpsError("invalid-argument", "That is not a refresh this server knows.");
          const docs = firestoreRestDocuments(restAccess());
          const refreshed = await startRefresh(ask, {
            gate: docs,
            jobs: restJobDocs(docs),
            enqueue: async (task) => {
              await enqueueLeg(task);
            },
            now: () => new Date(),
            newId: randomId,
          });
          // Counts and words only: the job's id is the device's to watch, not the log's.
          logger.info("startPull", {
            kind: "refresh",
            ...(refreshed.ok
              ? { status: refreshed.status, already: refreshed.already }
              : { refused: refreshed.refusal }),
          });
          if (!refreshed.ok) throw new HttpsError(refreshed.refusal, refreshed.message);
          return { status: refreshed.status, jobId: refreshed.jobId, already: refreshed.already };
        }
        const jobId = data?.jobId;
        const resume = (data as { resume?: unknown } | null)?.resume;
        if (resume !== undefined && resume !== true)
          throw new HttpsError("invalid-argument", "Invalid resume request.");
        const docs = firestoreRestDocuments(restAccess());
        // Any ask about a job ends it first if its worker died without a word (`reapPullJob`):
        // Dismiss, Stop and Resume on a pull gone silent all come here. Counts and words only.
        if (typeof jobId === "string" && JOB_ID.test(jobId)) {
          const reaped = await reapPullJob(jobId, {
            jobs: restJobDocs(docs),
            leaseUntil: (id) => importLeaseUntil(docs, id),
            now: () => new Date(),
          }).catch((error: unknown) => {
            logger.warn("startPull", { kind: "reap", failed: messageOf(error) });
            return null;
          });
          if (reaped) logger.info("startPull", { kind: "reap", ended: reaped });
        }
        if (resume === true) {
          const resumed = await resumePullJob(jobId, {
            jobs: restJobDocs(docs),
            launch: launchImport,
            now: () => new Date(),
          });
          logger.info("startPull", {
            kind: "resume",
            ...(resumed.ok ? { status: resumed.status } : { refused: resumed.refusal }),
          });
          if (!resumed.ok) throw new HttpsError(resumed.refusal, resumed.message);
          return { status: resumed.status };
        }
        // On an ask after the first, how long the sending device has waited, by its own clock.
        const waited = (data as { waited?: unknown } | null)?.waited;
        const started = await startPullJob(
          jobId,
          {
            jobs: restJobDocs(docs),
            enqueue: enqueueLeg,
            now: () => new Date(),
          },
          typeof waited === "number" && Number.isFinite(waited) && waited >= 0 ? waited : undefined
        );
        // Counts and words only, as the refresh's line: the job's id is the device's to watch.
        if (started.ok) {
          logger.info("startPull", {
            kind: "list",
            status: started.status,
            again: waited !== undefined,
          });
        } else if (started.refusal === "unavailable" || started.refusal === "unknown") {
          // The cloud's own words for why the pull could not be read or queued: what a missing
          // grant or a paused queue says, and what the device now shows the person who sent it.
          logger.error("startPull", {
            kind: "list",
            refused: started.refusal,
            why: started.message,
          });
        } else {
          logger.info("startPull", { kind: "list", refused: started.refusal });
        }
        if (!started.ok) {
          throw new HttpsError(
            started.refusal,
            started.message ??
              (started.refusal === "not-found"
                ? "There is no such pull."
                : "That is not a pull's id.")
          );
        }
        return { status: started.status };
      }
    );

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

/**
 * Legs that may run at once, each on an instance of its own with the memory the whole pool takes.
 * One at a time left a pull sent while another ran "waiting to start" for as long as that one's
 * leg took: on 11 October 2026 two catch-ups sent beside a 9,270-team pull waited behind it, and a
 * leg of that pull took 199 to 379 s. Legs of different jobs saving at once cost the later one a
 * second filing onto the copy as the other left it (`runCloudPull`), never a lost save; a job's own
 * legs are never at once, since each queues the next only as it ends.
 */
const LEGS_AT_ONCE = 3;

/** A leg's task's time limit, which the ask after its pull keeps five seconds inside. */
const LEG_TIMEOUT_S = 1800;

/** How a leg that ended its job ends (`LegOutcome`): finished, stopped, or failed for good. */
const PULL_ENDED: ReadonlySet<string> = new Set(["done", "cancelled", "failed"]);

/**
 * One leg of a pull, as Cloud Tasks sends it, beside at most `LEGS_AT_ONCE - 1` others. A leg has
 * a worker limit 30 seconds inside the task's half hour, so its thread ends and its error can be
 * recorded before the request times out. One that fails is tried twice more, two minutes apart and then
 * longer, and its job marked failed after the third.
 */
export const runPull = !CLOUD_PULLS
  ? undefined
  : onTaskDispatched<LegTask>(
      {
        region: REGION,
        serviceAccount: PULL_RUNNER,
        memory: "8GiB",
        cpu: 2,
        timeoutSeconds: LEG_TIMEOUT_S,
        maxInstances: LEGS_AT_ONCE,
        concurrency: 1,
        retryConfig: { maxAttempts: LEG_TRIES, minBackoffSeconds: 120 },
        rateLimits: { maxConcurrentDispatches: LEGS_AT_ONCE },
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
              await launchImport(task.jobId);
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
          // A killed worker cannot record its own failure. Record it on every try, while this
          // leg is still current; a stopped or advanced job must never be overwritten by it.
          const now = await jobs.read(task.jobId).catch(() => null);
          if (
            now &&
            (now.status === "queued" || now.status === "running") &&
            now.legsDone === task.leg
          ) {
            await jobs
              .updateIfUnchanged(task.jobId, now, {
                ...(now.stopAsked ? { status: "cancelled" } : lastTry ? { status: "failed" } : {}),
                stage: "waiting",
                error: answer.error,
                updatedAt: new Date().toISOString(),
              })
              .catch((error: unknown) => {
                logger.error(
                  said(
                    `could not record its failure: ${error instanceof Error ? error.message : String(error)}`
                  )
                );
              });
          }
          if (!lastTry) throw new Error(answer.error);
          // The job is failed now, and its earlier legs' saves may want publishing.
          logger.info("boards-after-pull", {
            jobId: task.jobId,
            ...(await publishBoardsIfDue(started + LEG_TIMEOUT_S * 1000 - 5_000)),
          });
          return;
        }
        logger.info(said(`${answer.outcome} in ${took}.`));
        // The leg that ended its job, however it ended: what its legs saved goes on the boards now,
        // where no rebuild is coming to (`afterPull.ts`).
        if (PULL_ENDED.has(answer.outcome)) {
          logger.info("boards-after-pull", {
            jobId: task.jobId,
            ...(await publishBoardsIfDue(started + LEG_TIMEOUT_S * 1000 - 5_000)),
          });
        }
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

/**
 * Each write of a League Standings season's document, `league/{season}` (`rebuildTrigger.ts`): one
 * that moved a team, a game or a score queues the rebuild of its window, since the boards are built
 * with the seasons' documents (`cloudLeague.ts`) and a device writes them straight to Firestore,
 * with no server in between to ask. Not tried again, as the copy's trigger is not.
 */
export const onLeagueWrite = !LIVE_REBUILD
  ? undefined
  : onDocumentWritten(
      {
        document: "league/{season}",
        region: REGION,
        serviceAccount: LIVE_RUNNER,
        memory: "256MiB",
        timeoutSeconds: 60,
        maxInstances: 2,
        retry: false,
      },
      async (event) => {
        const ledger = restLedgerStore(firestoreRestDocuments(restAccess()));
        const { level, message, line } = await handleLeagueWrite({
          change: event.data,
          docId: event.params.season,
          eventTime: event.time,
          // As the copy's trigger reads it: absent or not one is off, a read that throws is on.
          readSwitch: async () => coerceLedger((await ledger.read()).raw)?.on === true,
          enqueue: enqueueRebuild,
        });
        logger[level](message, line);
      }
    );

/**
 * This instance's start-up, charged once, to the first run that settles on it: how long its code
 * took to load, read as the module loads, not the idle time before its first task (`startupCharge`).
 */
const startupS = startupCharge(process.uptime());
/**
 * The task function records a request and launches the durable worker. Saves arriving during a
 * rebuild join its request; the worker checks for them before finishing. No rankings are fitted
 * inside this HTTP request.
 */
export const rebuild = !LIVE_REBUILD
  ? undefined
  : onTaskDispatched(
      {
        region: REGION,
        serviceAccount: LIVE_RUNNER,
        memory: "256MiB",
        cpu: 1,
        timeoutSeconds: 120,
        maxInstances: 1,
        concurrency: 1,
        retryConfig: { maxAttempts: 3, minBackoffSeconds: 120 },
        rateLimits: { maxConcurrentDispatches: 1 },
      },
      async (request) => {
        process.env.TZ = "America/New_York";
        const task = coerceRebuildTask(request.data);
        if (!task) {
          logger.warn("rebuild", { end: "not-a-task" });
          return;
        }
        const access = restAccess();
        const docs = firestoreRestDocuments(access);
        const done = await requestRebuildJob(task, {
          docs,
          copyStore: firestoreRestStore({ ...access, writable: false }),
          liveStore: firestoreRestLive({ ...access, writable: false }),
          leagueDocs: restLeagueDocs(docs),
          launch: launchRebuild,
          enqueue: enqueueRebuild,
          now: Date.now,
          today: () => todayIsoDay(),
          taskId: request.id,
        });
        logger.info("rebuild", { ...done, kind: task.kind, savedAt: task.savedAt });
      }
    );

/*
 * Edits on the server (README, "Team Rankings edits as commands"): a member's device sends a
 * command, and `edit` runs it on the cloud copy in a worker that keeps every part of the pool warm,
 * answering once the save has landed; the save's own rebuild publishes the boards soon after. Built
 * with the rebuilds (LIVE_REBUILD), whose account it runs as and whose ledger meters it; it needs
 * nothing of the project they do not.
 */

/**
 * Whether a caller of `edit` is on the cloud copy's list, kept a minute (`WRITE_CHECK_TTL_MS`):
 * the function writes the copy as its own account, past the rules.
 */
const editCheck = createMemberCheck({
  projectId: FIREBASE_WEB_CONFIG.projectId,
  ttlMs: WRITE_CHECK_TTL_MS,
});

/** A worker for the edits, with a heap cap of its own for the smaller instance (`EDIT_SIZE`). */
const startEditWorker = (): EditPort => {
  const worker = new Worker(new URL("./editWorker.js", import.meta.url), {
    resourceLimits: { maxOldGenerationSizeMb: EDIT_WORKER_HEAP_MB },
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

/** The worker the edits run in, kept from request to request (`editRunner`). */
let edits: ReturnType<typeof editRunner> | null = null;

/** The instance's charges to the ledger, one at a time (`chargeQueue`). */
const editCharges = chargeQueue();

/** The copy's id as the manifest holds one (`randomId`), or nothing; anything else is refused. */
const COPY_ID = /^[0-9a-f]{8,64}$/;

/**
 * POST (callable) `edit` `{ command, copy? }`, `{ query, copy? }` or `{ warm: true }`: runs a command
 * on the cloud copy (`handleEdit`), answers a question about it (`handleQuery`), or brings the pool
 * up ahead of either (`handleWarm`). For the accounts on the cloud
 * copy's list, as the rules make anything that touches the copy (`memberCheck.ts`, with the sign-in
 * the call carries). One instance, taking several calls at once and running them one at a time in
 * its worker, since the pool is one. A call is never left to the platform's timeout with its edit
 * still to come: one whose caller has gone, or whose time is up, before its turn is never sent
 * (`EDIT_CALL_S`), and is answered as an edit not made (`aborted`); a worker lost with an edit in
 * its hands answers that the edit may or may not be in the copy (`unsure`).
 */
const poolEndpoint = (queriesOnly = false) =>
  !LIVE_REBUILD
    ? undefined
    : onCall(
        {
          region: REGION,
          invoker: "public",
          serviceAccount: LIVE_RUNNER,
          memory: "8GiB",
          cpu: EDIT_SIZE.cpu,
          timeoutSeconds: EDIT_TIMEOUT_S,
          maxInstances: 1,
          concurrency: EDIT_CONCURRENCY,
        },
        async (request, response) => {
          const verdict = await editCheck(request.rawRequest.headers.authorization);
          if (verdict === "unavailable") {
            throw new HttpsError(
              "unavailable",
              "Could not check this account against the cloud copy's list just now. Try again in a minute."
            );
          }
          if (!onTheList(verdict)) {
            throw new HttpsError(
              verdict === "signed-out" ? "unauthenticated" : "permission-denied",
              EDIT_MEMBERS_ONLY_MESSAGES[verdict]
            );
          }
          const data = (request.data ?? null) as {
            command?: unknown;
            query?: unknown;
            copy?: unknown;
            warm?: unknown;
          } | null;
          // One of the three, read exactly: a request naming more than one is none of them.
          const asks = [data?.command, data?.query, data?.warm].filter((one) => one !== undefined);
          const warm = asks.length === 1 && data?.warm === true;
          const command = asks.length === 1 && !warm ? coerceCommand(data?.command) : null;
          const query = asks.length === 1 && !warm && !command ? coerceQuery(data?.query) : null;
          const copy = data?.copy;
          if (queriesOnly && !query)
            throw new HttpsError("invalid-argument", "This endpoint only answers questions.");
          if (!warm && !command && !query) {
            throw new HttpsError("invalid-argument", "That is not an edit this server knows.");
          }
          // A year's archive or delete is the owner's alone: the rules let only the owner delete a
          // season, and this is the pool's like of it.
          if (command && isOwnerCommand(command) && verdict !== "owner") {
            throw new HttpsError("permission-denied", OWNER_ONLY_MESSAGE);
          }
          if (copy !== undefined && (typeof copy !== "string" || !COPY_ID.test(copy))) {
            throw new HttpsError("invalid-argument", "That is not a copy's id.");
          }
          // New York's day, as the rebuilds': set before the worker starts, which keeps the zone it
          // starts in.
          process.env.TZ = "America/New_York";
          edits ??= editRunner({ spawn: startEditWorker });
          const deps = {
            ledger: restLedgerStore(firestoreRestDocuments(restAccess())),
            worker: edits,
            today: () => todayIsoDay(),
            size: EDIT_SIZE,
            startupS,
            charges: editCharges,
            // The request's own end: a call whose caller has gone is never sent to the worker.
            ...(response?.signal ? { signal: response.signal } : {}),
          };
          if (query) {
            const handled = await handleQuery({
              ...deps,
              ask: { query, ...(typeof copy === "string" ? { copy } : {}) },
            });
            logger.info("edit", handled.line);
            if ("notAnswered" in handled) throw new HttpsError("aborted", handled.notAnswered);
            return handled.reply;
          }
          if (!command) {
            const { warmed, line } = await handleWarm(deps);
            logger.info("edit", line);
            if (!warmed) {
              throw new HttpsError(
                "aborted",
                "The pool could not be brought up just now; the next edit brings it up itself."
              );
            }
            return { warmed };
          }
          let handled: Awaited<ReturnType<typeof handleEdit>>;
          try {
            handled = await handleEdit({
              ...deps,
              ask: { command, ...(typeof copy === "string" ? { copy } : {}) },
              // Once Team Rankings is started again, every pull under way is asked to stop.
              stopPulls: (start) => {
                const docs = firestoreRestDocuments(restAccess());
                return stopPullsUnderWay({
                  start,
                  landed: () => docs.readAt(MANIFEST_PATH),
                  // Only the pulls still under way, found by their status in one query, rather
                  // than every pull there has been listed page by page while the owner waits.
                  list: () => docs.where(JOBS_COLLECTION, "status", ["queued", "running"]),
                  jobs: restJobDocs(docs),
                  gate: docs,
                  now: () => new Date(),
                });
              },
            });
          } catch (error) {
            // Nothing it hands back throws, so this is not an answer anyone made: the edit may be in.
            logger.error("edit", { kind: command.kind, end: "threw", error: messageOf(error) });
            throw new HttpsError(
              "internal",
              "The edit may or may not have been made. Check it before making it again."
            );
          }
          logger.info("edit", handled.line);
          if ("notMade" in handled) throw new HttpsError("aborted", handled.notMade);
          return handled.reply;
        }
      );

export const edit = poolEndpoint();
/** Background diagnostics have their own worker and cannot queue ahead of edits or year controls. */
export const poolQuery = poolEndpoint(true);
