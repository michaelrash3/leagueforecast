/**
 * Runs the built functions (`lib/index.js`) the way Cloud Functions will, with a fake request, and
 * fails the deploy if one does not answer as expected. No network: the upstream host is pointed at
 * a closed local port, so a pull fails fast and the failure is itself the answer checked; the
 * billing stop is handed only a reading under its budget, which it must leave alone; and the pull
 * functions are handed only what they turn away before asking Google anything.
 */
import { Worker } from "node:worker_threads";
import { gunzipSync } from "node:zlib";

process.env.GC_API_BASE = "http://127.0.0.1:9";
process.env.GCLOUD_PROJECT = "smoke-project";
const { gcTeam, billingCap, startPull, runPull } = await import("./lib/index.js");

const call = (url, headers = {}) =>
  new Promise((resolve, reject) => {
    const sent = { status: 200, headers: {} };
    const res = {
      status(code) {
        sent.status = code;
        return res;
      },
      setHeader(name, value) {
        sent.headers[name.toLowerCase()] = String(value);
        return res;
      },
      getHeader: (name) => sent.headers[name.toLowerCase()],
      json(body) {
        res.end(JSON.stringify(body));
      },
      end(body) {
        sent.body = body;
        resolve(sent);
      },
      on: () => res,
    };
    const req = {
      method: "GET",
      url,
      headers: { origin: "https://leagueforecast.vercel.app", ...headers },
      socket: { remoteAddress: "203.0.113.7" },
      get: (name) => headers[name.toLowerCase()],
    };
    Promise.resolve(gcTeam(req, res)).catch(reject);
  });

const text = (sent) =>
  sent.headers["content-encoding"] === "gzip"
    ? gunzipSync(Buffer.from(sent.body)).toString("utf8")
    : String(sent.body);

const check = (label, ok, detail) => {
  if (!ok) {
    console.error(`FAIL ${label}: ${detail}`);
    process.exitCode = 1;
  } else console.log(`ok   ${label}`);
};

const probe = await call("/?probe=1");
check(
  "probe answers JSON",
  probe.status === 200 && JSON.parse(text(probe)).functionDeployed === true,
  text(probe)
);
check(
  "the app's page may read it",
  probe.headers["access-control-allow-origin"] === "https://leagueforecast.vercel.app",
  JSON.stringify(probe.headers)
);
check(
  "Retry-After is readable across origins",
  probe.headers["access-control-expose-headers"] === "retry-after",
  JSON.stringify(probe.headers)
);

const ids = Array.from({ length: 10 }, (_, index) => `SmokeTeam${String(index).padStart(3, "0")}`);
const batch = await call(`/?ids=${ids.join(",")}&raw=1`, { "accept-encoding": "gzip, br" });
const answered = JSON.parse(text(batch));
check(
  "a batch answers one result a team",
  batch.status === 200 && answered.teams?.length === 10,
  text(batch).slice(0, 200)
);
check(
  "a large answer is gzipped",
  batch.headers["content-encoding"] === "gzip",
  JSON.stringify(batch.headers)
);

// The hard stop: deployed where the setup put its topic and its own service account, and a
// reading under the budget does nothing at all.
const trigger = billingCap.__endpoint;
check(
  "the billing stop listens on its topic, as its own account",
  trigger.eventTrigger?.eventFilters?.topic === "billing-cap" &&
    trigger.serviceAccountEmail === "billing-cap@" &&
    trigger.maxInstances === 1,
  JSON.stringify(trigger)
);
const reading = (costAmount) =>
  Buffer.from(
    JSON.stringify({ budgetDisplayName: "Smoke", costAmount, budgetAmount: 1, currencyCode: "USD" })
  ).toString("base64");
const realFetch = globalThis.fetch;
let fetched = 0;
globalThis.fetch = async (...args) => {
  fetched += 1;
  return realFetch(...args);
};
await billingCap({
  specversion: "1.0",
  id: "smoke",
  source: "//pubsub.googleapis.com/projects/smoke/topics/billing-cap",
  type: "google.cloud.pubsub.topic.v1.messagePublished",
  time: new Date().toISOString(),
  data: {
    message: { data: reading(0.4), messageId: "1", publishTime: new Date().toISOString() },
    subscription: "projects/smoke/subscriptions/billing-cap",
  },
});
check("a reading under the budget calls nobody", fetched === 0, `${fetched} requests`);
globalThis.fetch = realFetch;

// The pulls in the cloud, built only once their setup is done (`build.mjs`): left out, they are
// not there at all, so a deploy asks nothing of the project for them.
if (process.env.CLOUD_PULLS !== "on") {
  check(
    "the pulls in the cloud are left out of a build without CLOUD_PULLS",
    startPull === undefined && runPull === undefined,
    `${typeof startPull} ${typeof runPull}`
  );
} else {
  // The pulls in the cloud: deployed as the setup made them, as their own account, one leg at a time
  // with the memory a whole pool takes; and neither asks Google anything of a request it turns away.
  const leg = runPull.__endpoint;
  check(
    "a pull's legs run one at a time, as their own account, with room for the pool",
    leg.taskQueueTrigger?.retryConfig?.maxAttempts === 3 &&
      leg.taskQueueTrigger?.rateLimits?.maxConcurrentDispatches === 1 &&
      leg.serviceAccountEmail === "pull-runner@" &&
      leg.availableMemoryMb === 8192 &&
      leg.timeoutSeconds === 1800 &&
      leg.maxInstances === 1 &&
      leg.concurrency === 1,
    JSON.stringify(leg)
  );
  check(
    "a pull is started by a call, as the pull's own account",
    startPull.__endpoint.callableTrigger !== undefined &&
      startPull.__endpoint.serviceAccountEmail === "pull-runner@",
    JSON.stringify(startPull.__endpoint)
  );

  const post = (handler, body, headers = {}) =>
    new Promise((resolve, reject) => {
      const sent = { status: 200, headers: {} };
      const res = {
        status(code) {
          sent.status = code;
          return res;
        },
        setHeader(name, value) {
          sent.headers[name.toLowerCase()] = String(value);
          return res;
        },
        getHeader: (name) => sent.headers[name.toLowerCase()],
        set(name, value) {
          return res.setHeader(name, value);
        },
        send(payload) {
          res.end(typeof payload === "string" ? payload : JSON.stringify(payload));
        },
        json(payload) {
          res.end(JSON.stringify(payload));
        },
        end(payload) {
          sent.body = payload;
          resolve(sent);
        },
        on: () => res,
      };
      const lower = { "content-type": "application/json", ...headers };
      const req = {
        method: "POST",
        url: "/",
        body,
        rawBody: Buffer.from(JSON.stringify(body)),
        headers: lower,
        header: (name) => lower[name.toLowerCase()],
        get: (name) => lower[name.toLowerCase()],
        socket: { remoteAddress: "203.0.113.7" },
      };
      Promise.resolve(handler(req, res)).catch(reject);
    });

  fetched = 0;
  globalThis.fetch = async (...args) => {
    fetched += 1;
    return realFetch(...args);
  };
  const unsigned = await post(startPull, { data: { jobId: "0".repeat(32) } });
  check(
    "a pull is not started for a caller who has not signed in",
    unsigned.status === 401 && /UNAUTHENTICATED/.test(String(unsigned.body)),
    `${unsigned.status} ${unsigned.body}`
  );
  // Cloud Tasks signs its requests, and Cloud Run checks the signature before the function sees
  // one; the function only reads it. A task for something that is not a job is done with at once.
  const signed = { authorization: "Bearer e30.eyJzdWIiOiJzbW9rZSJ9.c2ln" };
  const stray = await post(runPull, { data: { jobId: "not-a-job", leg: 0 } }, signed);
  check("a task for no job is done with", stray.status === 204, `${stray.status} ${stray.body}`);
  // A leg runs in a worker of its own, bundled apart: it loads, and answers its parent.
  const answer = await new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./lib/pullLeg.js", import.meta.url), {
      workerData: { task: { jobId: "not-a-job", leg: 0 }, lastTry: false },
    });
    worker.once("message", resolve);
    worker.once("error", reject);
  });
  check("a leg's worker loads and answers", answer.outcome === "gone", JSON.stringify(answer));
  check("and neither function asked anybody anything", fetched === 0, `${fetched} requests`);
  globalThis.fetch = realFetch;
}
