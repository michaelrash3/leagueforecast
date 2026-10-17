/** Cloud Run Job supervisor: heartbeats and ownership survive a CPU-bound tidy in its worker. */
import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { firestoreRestDocuments } from "../../src/lib/cloud/firestoreRest";
import { importBeat, importLease, IMPORT_STALLED } from "../../src/lib/cloud/importLease";
import { restJobDocs, startNextPart } from "../../src/lib/cloud/pullJobRunner";
import { JOB_ID } from "../../src/lib/cloud/pullJobs";
import { publishBoardsIfDue } from "./afterPullLaunch";
import { endDeadPulls } from "./deadPulls";
import { enqueueLeg, restAccess, zoneOf } from "./pullAccess";

const jobId = process.env.IMPORT_JOB_ID ?? "";
if (!JOB_ID.test(jobId)) throw new Error("A valid IMPORT_JOB_ID is required.");
const docs = firestoreRestDocuments(restAccess());
const jobs = restJobDocs(docs);
const lease = importLease(docs, jobId, randomUUID());
// A retry can start while a killed predecessor's last lease is still live. Wait beyond it.
let claimed = false;
for (let attempt = 0; attempt < 11 && !claimed; attempt++) {
  claimed = await lease.claim(Date.now());
  if (!claimed) await new Promise((resolve) => setTimeout(resolve, 10_000));
}
if (!claimed) {
  console.log(JSON.stringify({ event: "import-duplicate", jobId }));
} else {
  let worker: Worker | null = null;
  let beat: ReturnType<typeof setInterval> | undefined;
  let ticking = false;
  let lastRenew = Date.now();
  // When the worker last said anything: a try it goes quiet in for too long is ended as stuck.
  let heardAt = Date.now();
  let latestDetail: { detail: string; progressAt: string } | null = null;
  /*
   * Cloud Run sends SIGTERM, and ten seconds later SIGKILL, when it ends an execution: a cancel, the
   * task's time limit, the machine taken away. Ended without a word, the job said "running" until
   * the page's Dismiss or Resume asked about it (`reapPullJob`). Taken as a failure of this try
   * instead, it is written down below as any other is: stage waiting with the reason, failed on the
   * last try, and the lease let go, so a retry or Resume starts at once. One that comes before
   * the worker starts is kept, and fails the try as soon as it can.
   */
  let termination: Error | null = null;
  let terminated: ((error: Error) => void) | null = null;
  process.once("SIGTERM", () => {
    termination = new Error(
      "Cloud Run stopped this execution. Downloads are kept; the next execution, or Resume, continues from the saved checkpoints."
    );
    terminated?.(termination);
  });
  try {
    const job = await jobs.read(jobId);
    if (!job) throw new Error("The import job is missing.");
    process.env.TZ = zoneOf(job.timeZone);
    worker = new Worker(new URL("./importWorker.js", import.meta.url), {
      workerData: { jobId },
      resourceLimits: { maxOldGenerationSizeMb: 12_288 },
    });
    heardAt = Date.now();
    const running = worker;
    let completed = false;
    let stopping = false;
    await new Promise<void>((resolve, reject) => {
      const fail = (error: unknown) => {
        void running.terminate();
        reject(error);
      };
      terminated = fail;
      if (termination) fail(termination);
      beat = setInterval(() => {
        const next = importBeat({ now: Date.now(), renewedAt: lastRenew, heardAt });
        if (next === "lost-contact") {
          fail(
            new Error(
              "Lost contact with the import checkpoint store. The next execution will resume."
            )
          );
          return;
        }
        if (next === "stalled") {
          fail(new Error(IMPORT_STALLED));
          return;
        }
        if (ticking) return;
        ticking = true;
        void lease
          .renew(Date.now())
          .then(async (owned) => {
            if (!owned) {
              fail(new Error("Another execution owns this import."));
              return;
            }
            lastRenew = Date.now();
            const current = await jobs.read(jobId);
            if (current?.stopAsked && current.stage !== "saving") {
              stopping = true;
              await running.terminate();
              await jobs.update(jobId, {
                status: "cancelled",
                stage: "waiting",
                error: "Downloads are kept. Resume this import when ready.",
                updatedAt: new Date().toISOString(),
              });
              completed = true;
              resolve();
              return;
            }
            const detail = latestDetail;
            latestDetail = null;
            await jobs.update(jobId, { heartbeatAt: new Date().toISOString(), ...detail });
          })
          .catch(() => undefined)
          .finally(() => {
            ticking = false;
          });
      }, 10_000);
      running.on(
        "message",
        (message: { done?: boolean; error?: string; progress?: boolean; detail?: string }) => {
          heardAt = Date.now();
          if (message.detail) {
            latestDetail = { detail: message.detail, progressAt: new Date().toISOString() };
          }
          if (message.done) {
            completed = true;
            resolve();
          }
          if (message.error) reject(new Error(message.error));
        }
      );
      running.once("error", reject);
      running.once("exit", (code) => {
        if (!completed && !stopping)
          reject(new Error(`Import worker exited without completing, code ${code}.`));
      });
    });
    console.log(JSON.stringify({ event: "import-complete", jobId }));
    const finished = await jobs.read(jobId);
    if (finished?.status === "done") {
      // A list sent in parts carries on here, before the clean-up below, which can take minutes
      // (`startNextPart`). A read that throws fails this try, and Cloud Run's retry, finding the
      // import done, asks again; a start the cloud refuses has already ended that part with why.
      const next = await startNextPart(jobId, { jobs, enqueue: enqueueLeg, now: () => new Date() });
      if (next.kind !== "none") {
        console.log(
          JSON.stringify({
            event: "import-next-part",
            jobId,
            part: next.part,
            ...(next.kind === "started"
              ? next.answer.ok
                ? { status: next.answer.status }
                : { refused: next.answer.refusal }
              : { left: true }),
          })
        );
      }
      const db = getFirestore(getApps().find((app) => app.name === "[DEFAULT]") ?? initializeApp());
      await db.recursiveDelete(db.collection(`pullJobs/${jobId}/artifacts`)).catch((error) => {
        console.error(
          JSON.stringify({ event: "import-cleanup-retry-needed", jobId, error: String(error) })
        );
      });
    }
  } catch (error) {
    const last = Number(process.env.CLOUD_RUN_TASK_ATTEMPT ?? 0) >= 2;
    const message = error instanceof Error ? error.message : String(error);
    const job = await jobs.read(jobId).catch(() => null);
    if (job && !["done", "failed", "cancelled"].includes(job.status)) {
      await jobs
        .update(jobId, {
          ...(last ? { status: "failed" as const } : {}),
          stage: "waiting",
          error: message,
          updatedAt: new Date().toISOString(),
        })
        .catch(() => undefined);
    }
    console.error(JSON.stringify({ event: "import-retry", jobId, error: message, last }));
    process.exitCode = 1;
  } finally {
    if (beat) clearInterval(beat);
    await worker?.terminate();
    await lease.release().catch(() => undefined);
  }
  // Once the worker is gone, and however the import ended: done, stopped, or failed on its last
  // try, any of which may have saved what it filed. What it saved goes on the boards now, where no
  // rebuild is coming to (`afterPull.ts`); a try to be tried again leaves it to that try.
  const ended = await jobs.read(jobId).catch(() => null);
  if (
    ended &&
    (ended.status === "done" || ended.status === "failed" || ended.status === "cancelled")
  )
    console.log(
      JSON.stringify({
        event: "import-boards",
        jobId,
        // Dead pulls ended first: one still taken for a writer would hold the boards back.
        ...(await endDeadPulls()),
        ...(await publishBoardsIfDue()),
      })
    );
}
