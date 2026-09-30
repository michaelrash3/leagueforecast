/**
 * What both halves of a pull in the cloud reach Google with: the function that takes a task
 * (`runPull`, `index.ts`) and the worker it runs the leg in (`pullLeg.ts`). Each is bundled
 * separately and holds its own copy of this, since a worker shares no module with its parent.
 */
import { applicationDefault, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getFunctions } from "firebase-admin/functions";
import type { LegTask } from "../../src/lib/cloud/pullJobRunner";

export const REGION = "us-central1";

const projectId = (): string => {
  const named =
    process.env.GCLOUD_PROJECT ??
    process.env.GOOGLE_CLOUD_PROJECT ??
    (JSON.parse(process.env.FIREBASE_CONFIG ?? "{}") as { projectId?: string }).projectId;
  if (!named) throw new Error("This function cannot tell which project it runs in.");
  return named;
};

const adminApp = () => (getApps().length > 0 ? getApp() : initializeApp());

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
export const restAccess = (ownerUid: string) => ({
  projectId: projectId(),
  ownerUid,
  token: accessToken,
});

/** Queues a leg, named for its job and leg: a leg queued twice is queued once. */
export const enqueueLeg = async (task: LegTask): Promise<void> => {
  try {
    await getFunctions(adminApp())
      .taskQueue<LegTask>(`locations/${REGION}/functions/runPull`)
      .enqueue(task, {
        id: `${task.ownerUid}-${task.jobId}-${task.leg}`,
        dispatchDeadlineSeconds: 1800,
      });
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
