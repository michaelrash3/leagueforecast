/**
 * A leg of a pull run by one of GitHub's servers (`cloud-pull.yml`, README "Pulls on GitHub"),
 * where the functions ask GitHub for it rather than queueing a Cloud Tasks task (`enqueueLeg`). It
 * is the leg `runPull` runs (`runLeg`), from the same build, with the deploy's Firebase key for
 * Google's default credentials: a staged list runs its importer here too, the deployed
 * `importJob.js` as Cloud Run runs it, rather than asking for another run to start it.
 *
 * A leg is asked for once (`dispatchLegOnce`), and run under the job's execution lease besides, the
 * one a staged import holds (`importLease.ts`): a run started by hand beside it waits for the lease
 * almost two minutes, as the importer does, and ends as a duplicate if the first still holds it, or
 * reads its leg done ("already-ran") once the first has let it go. The staged importer takes that
 * lease itself, so a staged list's leg leaves it alone.
 *
 * The workflow tries a leg three times, two minutes apart, as Cloud Tasks did, and tells it which
 * try it is (`PULL_ATTEMPT`, from 0): the last records its failure on the job for good.
 */
import { randomUUID } from "node:crypto";
import process from "node:process";
import { firestoreRestDocuments } from "../../src/lib/cloud/firestoreRest";
import { importLease } from "../../src/lib/cloud/importLease";
import { JOB_ID } from "../../src/lib/cloud/pullJobs";
import { restJobDocs } from "../../src/lib/cloud/pullJobRunner";
import { LEG_TRIES, runLeg } from "./legRun";
import { restAccess } from "./pullAccess";

const jobId = process.env.PULL_JOB_ID ?? "";
const leg = Number(process.env.PULL_LEG ?? "");
const attempt = Number(process.env.PULL_ATTEMPT ?? "0");
if (!JOB_ID.test(jobId) || !Number.isSafeInteger(leg) || leg < 0) {
  throw new Error("A valid PULL_JOB_ID and PULL_LEG are required.");
}
const lastTry = attempt + 1 >= LEG_TRIES;

/** The staged importer, the deployed file Cloud Run runs, on this try. */
const runImporter = async (id: string): Promise<void> => {
  process.env.IMPORT_JOB_ID = id;
  // Read by the importer as Cloud Run's own count of tries: the third, numbered 2, is its last.
  process.env.CLOUD_RUN_TASK_ATTEMPT = String(attempt);
  await import(new URL("./importJob.js", import.meta.url).href);
};

const docs = firestoreRestDocuments(restAccess());
const job = await restJobDocs(docs).read(jobId);
const task = { jobId, leg };
if (!job || (job.pipeline === "staged-v1" && !job.rota)) {
  // Nothing to hold a lease for (`runLeg` says so), or the importer, which takes its own.
  await runLeg(task, lastTry, runImporter);
} else {
  const lease = importLease(docs, jobId, randomUUID());
  // A leg asked for twice waits out the first's lease, renewed every half minute while it runs.
  let claimed = false;
  for (let wait = 0; wait < 11 && !claimed; wait++) {
    claimed = await lease.claim(Date.now());
    if (!claimed) await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  if (!claimed) {
    console.log(JSON.stringify({ event: "leg-duplicate", leg }));
  } else {
    const renewing = setInterval(() => {
      void lease.renew(Date.now()).catch(() => undefined);
    }, 30_000);
    try {
      await runLeg(task, lastTry, runImporter);
    } catch (error) {
      // Written on the job already (`runLeg`); the workflow tries the leg again.
      console.error(JSON.stringify({ event: "leg-retry", leg, error: String(error) }));
      process.exitCode = 1;
    } finally {
      clearInterval(renewing);
      await lease.release().catch(() => undefined);
    }
  }
}
