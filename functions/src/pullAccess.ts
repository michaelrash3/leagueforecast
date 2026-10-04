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

/** Queues a leg, named for its job and leg: a leg queued twice is queued once. */
export const enqueueLeg = async (task: LegTask): Promise<void> => {
  try {
    await getFunctions(adminApp())
      .taskQueue<LegTask>(`locations/${REGION}/functions/runPull`)
      .enqueue(task, { id: `${task.jobId}-${task.leg}`, dispatchDeadlineSeconds: 1800 });
  } catch (error) {
    if ((error as { code?: unknown }).code === "functions/task-already-exists") return;
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

/** The zone a job's day is kept in: its own, where that is a zone; the user's otherwise. */
export const zoneOf = (timeZone: string): string => {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions().timeZone;
  } catch {
    return "America/New_York";
  }
};
