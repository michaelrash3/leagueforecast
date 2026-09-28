/**
 * Runs the built functions (`lib/index.js`) the way Cloud Functions will, with a fake request, and
 * fails the deploy if one does not answer as expected. No network: the upstream host is pointed at
 * a closed local port, so a pull fails fast and the failure is itself the answer checked, and the
 * billing stop is handed only a reading under its budget, which it must leave alone.
 */
import { gunzipSync } from "node:zlib";

process.env.GC_API_BASE = "http://127.0.0.1:9";
const { gcTeam, billingCap } = await import("./lib/index.js");

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
