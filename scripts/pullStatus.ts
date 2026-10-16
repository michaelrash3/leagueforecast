/**
 * Where each pull in the cloud is (README, "Pulls in the cloud: seeing where each one is"), read
 * with the Firebase key GitHub keeps for deploys, read only: the pull jobs of the last three days
 * and any not yet over, as their documents say; the Cloud Tasks queues their legs and the rebuilds
 * wait in, with each task waiting there and how its last try was answered; and what `startPull`
 * and `runPull` logged in the last hours, the queue's own lines among them. What a device shows as
 * "waiting to start" or "stopping" is one of these, and this says which, from the cloud's side.
 *
 * It prints states, counts, times and the cloud's own words only, through `pullStatusReport.ts`,
 * which cuts every job's id short, takes out any address but a service account's, and drops a
 * team's id, GameChanger address and body from every line: this repository is public, and so are
 * its Actions logs. A part it is refused (a key without the right
 * to read the queues or the logs) says so and the rest still prints.
 *
 *   FIREBASE_SERVICE_ACCOUNT="$(cat key.json)" npm run pull:status -- --hours 12
 */
import { fieldsOf, type FirestoreValue } from "../src/lib/cloud/firestoreRest.ts";
import { FUNCTIONS_REGION } from "../src/lib/cloud/functionsUrl.ts";
import { coercePullJob, type PullJob } from "../src/lib/cloud/pullJobs.ts";
import {
  clipped,
  jobLine,
  logLine,
  queueLine,
  taskLine,
  type LogEntry,
  type QueueInfo,
  type TaskInfo,
} from "../src/lib/cloud/pullStatusReport.ts";
import { googleAccess } from "./cloudPool.ts";

declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  exitCode?: number;
};

/** Firestore, Cloud Tasks and Cloud Logging, on one sign-in. */
const CLOUD_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

/** How far back jobs that are over are still listed. */
const JOB_DAYS = 3;

const argv = process.argv.slice(2);
const hoursAt = argv.indexOf("--hours");
const hours = Math.max(1, Math.min(72, Number(argv[hoursAt + 1]) || 12));

const keyJson = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!keyJson) {
  console.log("FIREBASE_SERVICE_ACCOUNT is not set, so there is nothing to read.");
  process.exitCode = 1;
} else {
  const { projectId, token } = googleAccess(keyJson, CLOUD_SCOPE);
  const nowMs = Date.now();

  /** A GET or POST to a Google API, as JSON; a refusal thrown with Google's own words. */
  const ask = async (url: string, body?: unknown): Promise<unknown> => {
    const response = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${await token()}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const answer = (await response.json().catch(() => null)) as {
      error?: { message?: string; status?: string };
    } | null;
    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} ${answer?.error?.status ?? ""}: ${answer?.error?.message ?? "no words"}`
      );
    }
    return answer;
  };

  /** Runs one part, saying so instead of stopping when it is refused. */
  const part = async (title: string, run: () => Promise<void>): Promise<void> => {
    console.log(`\n${title}`);
    try {
      await run();
    } catch (error) {
      console.log(
        `  Could not read it: ${clipped(error instanceof Error ? error.message : String(error))}`
      );
    }
  };

  console.log(`Pulls in the cloud, as the cloud sees them at ${new Date(nowMs).toISOString()}.`);

  await part(`Pull jobs: the last ${JOB_DAYS} days, and any not over`, async () => {
    const root = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/pullJobs`;
    const jobs: { id: string; job: PullJob }[] = [];
    let unread = 0;
    let pageToken: string | undefined;
    do {
      const page = (await ask(
        `${root}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`
      )) as {
        documents?: { name?: string; fields?: Record<string, FirestoreValue> }[];
        nextPageToken?: string;
      };
      for (const document of page.documents ?? []) {
        const job = coercePullJob(fieldsOf(document.fields ?? {}));
        const id = document.name?.split("/").pop() ?? "";
        if (job) jobs.push({ id, job });
        else unread += 1;
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    const since = nowMs - JOB_DAYS * 24 * 3_600_000;
    const shown = jobs
      .filter(
        ({ job }) =>
          Date.parse(job.createdAt) >= since || job.status === "queued" || job.status === "running"
      )
      .sort((a, b) => b.job.createdAt.localeCompare(a.job.createdAt));
    console.log(
      `  ${jobs.length} jobs in all${unread > 0 ? `, and ${unread} this build cannot read` : ""}; ${shown.length} shown, newest first.`
    );
    for (const { id, job } of shown) console.log(`  ${jobLine(id, job, nowMs)}`);
  });

  await part("Cloud Tasks queues, and the tasks waiting in them", async () => {
    const location = `projects/${projectId}/locations/${FUNCTIONS_REGION}`;
    // The beta API, since only it says how many tasks a queue holds and how many run now: the
    // first API refuses a read mask on a list (HTTP 400, "Unknown name read_mask").
    const queues = (await ask(
      `https://cloudtasks.googleapis.com/v2beta3/${location}/queues?readMask=name,state,rateLimits,retryConfig,stats`
    )) as { queues?: QueueInfo[] };
    if (!queues.queues?.length) console.log("  No queues.");
    // Every queue is said even when its tasks may not be read: the deploy account lists tasks only
    // with Cloud Tasks Viewer (README, "Seeing where each one is"), and a refusal for one queue is
    // a refusal for all, so it is said once and not asked again.
    let refused = false;
    for (const queue of queues.queues ?? []) {
      console.log(`  ${queueLine(queue, nowMs)}`);
      if (!queue.name || refused) continue;
      try {
        // Page by page: a queue backed up or paused holds more than one page of tasks, and the one
        // stuck is the one looked for.
        let pageToken: string | undefined;
        do {
          const page = (await ask(
            `https://cloudtasks.googleapis.com/v2beta3/${queue.name}/tasks?responseView=FULL&pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`
          )) as { tasks?: TaskInfo[]; nextPageToken?: string };
          for (const task of page.tasks ?? []) console.log(`    ${taskLine(task, nowMs)}`);
          pageToken = page.nextPageToken;
        } while (pageToken);
      } catch (error) {
        refused = true;
        console.log(
          `    Its tasks could not be read, nor any queue's: ${clipped(error instanceof Error ? error.message : String(error))}`
        );
      }
    }
  });

  await part(
    `What the durable importer, the boards' publish after a pull, startPull, runPull and their queue logged in the last ${hours} hours`,
    async () => {
      const from = new Date(nowMs - hours * 3_600_000).toISOString();
      const filter = [
        `timestamp>="${from}"`,
        `((resource.type="cloud_run_revision" AND resource.labels.service_name=("startpull" OR "runpull")) OR (resource.type="cloud_run_job" AND resource.labels.job_name=("team-import" OR "boards-publish")) OR resource.type="cloud_tasks_queue")`,
      ].join(" AND ");
      const listed = (await ask("https://logging.googleapis.com/v2/entries:list", {
        resourceNames: [`projects/${projectId}`],
        filter,
        orderBy: "timestamp desc",
        pageSize: 400,
      })) as { entries?: LogEntry[]; nextPageToken?: string };
      const entries = (listed.entries ?? []).slice().reverse();
      console.log(
        `  ${entries.length} entries${listed.nextPageToken ? " (the latest 400; there are more)" : ""}, oldest first.`
      );
      for (const entry of entries) console.log(`  ${logLine(entry)}`);
    }
  );
}
