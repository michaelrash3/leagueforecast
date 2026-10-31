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
import { importLease, watchLease } from "../../src/lib/cloud/importLease";
import { memoryFields, memoryUseOf } from "../../src/lib/cloud/memoryUse";
import { JOB_ID } from "../../src/lib/cloud/pullJobs";
import { restJobDocs } from "../../src/lib/cloud/pullJobRunner";
import { LEG_TRIES, legFailed, runLeg } from "./legRun";
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

const started = Date.now();
const task = { jobId, leg };
const docs = firestoreRestDocuments(restAccess());

/**
 * What the run found before the leg: a job with nothing to hold a lease for (`runLeg` says why),
 * or a staged list's, whose importer takes its own; the lease, for any other; or the lease still
 * another run's after waiting almost two minutes for it, as the importer waits.
 */
type Setup =
  | { kind: "unleased" }
  | { kind: "leased"; lease: ReturnType<typeof importLease> }
  | {
      kind: "duplicate";
    };

const setUp = async (): Promise<Setup> => {
  const job = await restJobDocs(docs).read(jobId);
  if (!job || (job.pipeline === "staged-v1" && !job.rota)) return { kind: "unleased" };
  const lease = importLease(docs, jobId, randomUUID());
  for (let wait = 0; wait < 11; wait++) {
    if (await lease.claim(Date.now())) return { kind: "leased", lease };
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  return { kind: "duplicate" };
};

let setup: Setup | null = null;
try {
  setup = await setUp();
} catch (error) {
  /*
   * The job or its lease could not be read before the leg began. Written on the job as a leg that
   * failed in its worker is (`legFailed`), so the last try ends the pull with why rather than
   * leaving it running for the reaper to end as silent (Codex, on #440).
   */
  const said = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ event: "leg-setup-failed", leg, error: said }));
  await legFailed(task, said, lastTry, started);
  process.exitCode = 1;
}
if (setup?.kind === "unleased") {
  await runLeg(task, lastTry, runImporter);
} else if (setup?.kind === "duplicate") {
  console.log(JSON.stringify({ event: "leg-duplicate", leg }));
} else if (setup?.kind === "leased") {
  const { lease } = setup;
  // A lease lost is a leg another execution may be running: this one stops at once, writing
  // nothing, and the workflow's next try waits for the lease or finds the leg done.
  const stopWatching = watchLease(lease, (why) => {
    console.error(JSON.stringify({ event: "leg-lease-lost", leg, why }));
    process.exit(1);
  });
  try {
    await runLeg(task, lastTry, runImporter);
  } catch (error) {
    // Written on the job already (`runLeg`); the workflow tries the leg again.
    console.error(JSON.stringify({ event: "leg-retry", leg, error: String(error) }));
    process.exitCode = 1;
  } finally {
    stopWatching();
    await lease.release().catch(() => undefined);
  }
}
// What the run held at its end and at most, its leg's worker thread included, as the nightly says
// it (`memoryUse.ts`): a leg loads the whole pool, which grows with every night.
console.log(
  JSON.stringify({
    event: "leg-memory",
    leg,
    ...memoryFields(memoryUseOf(process.memoryUsage().rss, process.resourceUsage().maxRSS)),
  })
);
