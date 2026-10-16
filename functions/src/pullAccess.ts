/**
 * What the functions that work on the cloud copy reach Google with: both halves of a pull in the
 * cloud (`runPull` in `index.ts`, and the worker it runs a leg in, `pullLeg.ts`), and both of a
 * rebuild after a save (`onCopyWrite` and `rebuild` in `index.ts`, and the rebuild's worker,
 * `rebuildWorker.ts`). Each is bundled separately and holds its own copy of this, since a worker
 * shares no module with its parent.
 */
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFunctions } from "firebase-admin/functions";
import { FUNCTIONS_REGION } from "../../src/lib/cloud/functionsUrl";
import type { LegTask } from "../../src/lib/cloud/pullJobRunner";
import type { BoardsCheckTask } from "../../src/lib/live/boardsCheck";
import type { RebuildTask } from "../../src/lib/live/rebuildPlan";
import { REBUILD_DISPATCH_S } from "../../src/lib/live/rebuildWorkerProtocol";

/** Where every function is deployed, and where the app sends its calls (`functionsUrl.ts`). */
export const REGION = FUNCTIONS_REGION;

const projectId = (): string => {
  const named =
    process.env.GCLOUD_PROJECT ??
    process.env.GOOGLE_CLOUD_PROJECT ??
    (JSON.parse(process.env.FIREBASE_CONFIG ?? "{}") as { projectId?: string }).projectId;
  if (!named) throw new Error("This function cannot tell which project it runs in.");
  return named;
};

/**
 * The default admin app, made the first time it is needed. Not whichever app there is: a function
 * an event triggers has firebase-functions make one of its own (`__FIREBASE_FUNCTIONS_SDK__`) to
 * read the event before the handler runs, and so does a call that carries a sign-in, and asking for
 * the default app then throws `app/no-app` though an app exists.
 */
const adminApp = () => getApps().find((app) => app.name === "[DEFAULT]") ?? initializeApp();

/** The function's own account's token for Google's APIs, asked for again before its hour is up. */
const accessToken = (() => {
  let held: { token: string; until: number } | null = null;
  return async (): Promise<string> => {
    if (held && Date.now() < held.until) return held.token;
    const fresh = await applicationDefault().getAccessToken();
    held = {
      token: fresh.access_token,
      until: Date.now() + Math.max(0, fresh.expires_in - 300) * 1000,
    };
    return held.token;
  };
})();

/** Firestore's REST API as the function's own account (`firestoreRest.ts`). */
export const restAccess = () => ({ projectId: projectId(), token: accessToken });

/** Launches a durable job and returns as soon as Google accepts the execution. */
export const launchImport = async (jobId: string): Promise<void> => {
  const access = restAccess();
  const response = await fetch(
    `https://run.googleapis.com/v2/projects/${access.projectId}/locations/${REGION}/jobs/team-import:run`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await access.token()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        overrides: { containerOverrides: [{ env: [{ name: "IMPORT_JOB_ID", value: jobId }] }] },
      }),
      signal: AbortSignal.timeout(25_000),
    }
  );
  if (!response.ok)
    throw new Error(`The durable importer could not be started (HTTP ${response.status}).`);
};

/** A rebuild's input is the latest durable request, so launches need no environment overrides. */
export const launchRebuild = async (): Promise<void> => {
  const access = restAccess();
  const response = await fetch(
    `https://run.googleapis.com/v2/projects/${access.projectId}/locations/${REGION}/jobs/ranking-rebuild:run`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await access.token()}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(25_000),
    }
  );
  if (!response.ok)
    throw new Error(`The ranking rebuild job could not be started (HTTP ${response.status}).`);
};

/**
 * Starts the `boards-publish` job (`boardsPublish.ts`), which publishes the boards once a pull has
 * ended with no rebuild coming to (`afterPull.ts`). It reads what it publishes from the cloud, so it
 * needs nothing handed over; two started at once both publish, the later finding the boards current
 * or publishing over the earlier, which a publish never puts back.
 */
export const launchBoardsPublish = async (): Promise<void> => {
  const access = restAccess();
  const response = await fetch(
    `https://run.googleapis.com/v2/projects/${access.projectId}/locations/${REGION}/jobs/boards-publish:run`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await access.token()}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(25_000),
    }
  );
  if (!response.ok)
    throw new Error(`The boards' publish could not be started (HTTP ${response.status}).`);
};

/**
 * Queues a leg, named for its job and leg: a leg queued twice is queued once, and the second
 * queueing answers "already". Cloud Tasks gives that answer, too, for a name a task had until it
 * ran or was dropped, for some time after: a job whose first task was refused at every delivery
 * cannot be queued again under its name, which is why a start ends such a job instead
 * (`startPullJob`).
 */
export const enqueueLeg = async (task: LegTask): Promise<void | "already"> => {
  try {
    await getFunctions(adminApp())
      .taskQueue<LegTask>(`locations/${REGION}/functions/runPull`)
      .enqueue(task, { id: `${task.jobId}-${task.leg}`, dispatchDeadlineSeconds: 1800 });
  } catch (error) {
    if ((error as { code?: unknown }).code === "functions/task-already-exists") return "already";
    throw error;
  }
};

/**
 * Queues a rebuild under the id its window gives it (`rebuildTask`): every save in a window asks for
 * the one task, and the first to ask queued it, so the rest are done. Run after its window, and
 * waited on longer than the rebuild may run (`REBUILD_DISPATCH_S`).
 */
export const enqueueRebuild = async ({
  id,
  scheduleTime,
  task,
}: {
  id: string;
  scheduleTime: Date;
  task: RebuildTask;
}): Promise<void> => {
  try {
    await getFunctions(adminApp())
      .taskQueue<RebuildTask>(`locations/${REGION}/functions/rebuild`)
      .enqueue(task, { id, scheduleTime, dispatchDeadlineSeconds: REBUILD_DISPATCH_S });
  } catch (error) {
    if ((error as { code?: unknown }).code === "functions/task-already-exists") return;
    throw error;
  }
};

/**
 * Queues a save's check of the boards (`boardsCheck.ts`) on the rebuilds' own queue, which tells
 * it from a rebuild's task by its shape: one a minute under one name, so a check asked for twice is
 * queued once, as a rebuild's task is.
 */
export const enqueueBoardsCheck = async ({
  id,
  scheduleTime,
  task,
}: {
  id: string;
  scheduleTime: Date;
  task: BoardsCheckTask;
}): Promise<void> => {
  try {
    await getFunctions(adminApp())
      .taskQueue<BoardsCheckTask>(`locations/${REGION}/functions/rebuild`)
      .enqueue(task, { id, scheduleTime, dispatchDeadlineSeconds: REBUILD_DISPATCH_S });
  } catch (error) {
    if ((error as { code?: unknown }).code === "functions/task-already-exists") return;
    throw error;
  }
};

/** The zone a job's day is kept in: its own, where that is a zone; the user's otherwise. */
export const zoneOf = (timeZone: string): string => {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions().timeZone;
  } catch {
    return "America/New_York";
  }
};
