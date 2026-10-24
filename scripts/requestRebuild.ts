/** Queue current rankings after deployment, without loading or fitting the cloud pool on CI. */
import { todayIsoDay } from "../src/lib/date.ts";
import {
  firestoreRestDocuments,
  firestoreRestLive,
  firestoreRestStore,
} from "../src/lib/cloud/firestoreRest.ts";
import { FUNCTIONS_REGION } from "../src/lib/cloud/functionsUrl.ts";
import { dispatchPull, pullDispatchToken } from "../src/lib/cloud/githubDispatch.ts";
import { restLeagueDocs } from "../src/lib/live/cloudLeague.ts";
import { requestRebuildJob } from "../src/lib/live/rebuildJobLaunch.ts";
import { restLedgerStore, updateLedger } from "../src/lib/live/rebuildLedger.ts";
import { googleAccess } from "./cloudPool.ts";
declare const process: { env: Record<string, string | undefined> };

const key = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!key) throw new Error("The deploy's Firebase service account is required.");
const signed = googleAccess(key, "https://www.googleapis.com/auth/cloud-platform");
const access = { ...signed, projectId: process.env.PROJECT ?? signed.projectId };
const docs = firestoreRestDocuments(access);
const copyStore = firestoreRestStore({ ...access, writable: false });
const manifest = await copyStore.readManifest();
if (manifest) {
  // The runtime changed. Lift only the old settled failure pause; retain switches and spending.
  await updateLedger(restLedgerStore(docs), (held) => ({
    next:
      held?.on && !held.open && held.engine !== "job-v1"
        ? { ...held, engine: "job-v1", failures: 0, pausedDay: null }
        : null,
    answer: null,
  }));
  /*
   * Where the pulls are on GitHub the rebuilds do not run (`rebuildsRun`): the boards are asked of
   * the boards' publish there instead, which publishes them only where they are behind, as a save's
   * check does. The deploy hands this script the same token it writes for the functions.
   */
  const token = pullDispatchToken(process.env);
  if (token) {
    await dispatchPull({ task: "boards" }, token);
    console.log("Boards after deployment: asked of the boards' publish on GitHub.");
  } else await requestOnGoogle(manifest.copy);
} else console.log("No cloud copy to rebuild after deployment.");

/** The rebuild job on Google, launched where its preflight finds the boards want it. */
async function requestOnGoogle(copy: string): Promise<void> {
  const task = {
    copy,
    kind: "server" as const,
    window: Math.floor(Date.now() / 900000),
    savedAt: new Date().toISOString(),
  };
  const post = async (url: string, body: unknown) => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await access.token()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok)
      throw new Error(`The deploy's rebuild request failed (HTTP ${response.status}).`);
  };
  const done = await requestRebuildJob(task, {
    docs,
    copyStore,
    liveStore: firestoreRestLive({ ...access, writable: false }),
    leagueDocs: restLeagueDocs(docs),
    launch: () =>
      post(
        `https://run.googleapis.com/v2/projects/${access.projectId}/locations/${FUNCTIONS_REGION}/jobs/ranking-rebuild:run`,
        {}
      ),
    // A deferred worker queued its continuation before recording this state. Join that request.
    enqueue: async () => {},
    now: Date.now,
    today: () => todayIsoDay(),
  });
  console.log(`Ranking rebuild after deployment: ${done.end}.`);
}
