/**
 * Runs the built function (`lib/index.js`) the way Cloud Functions will, with a fake request, and
 * fails the deploy if it does not answer as the app expects. No network: the upstream host is
 * pointed at a closed local port, so a pull fails fast and the failure is itself the answer checked.
 */
import { gunzipSync } from "node:zlib";

process.env.GC_API_BASE = "http://127.0.0.1:9";
const { gcTeam } = await import("./lib/index.js");

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
