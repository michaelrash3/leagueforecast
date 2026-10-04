/**
 * Runs the built functions (`lib/index.js`) the way Cloud Functions will, with a fake request, and
 * fails the deploy if one does not answer as expected. No network: the upstream host is pointed at
 * a closed local port, so a pull fails fast and the failure is itself the answer checked; Firestore,
 * which the proxy asks whose a sign-in is (`memberCheck.ts`), is a stand-in that knows one member;
 * the billing stop is handed only a reading under its budget, which it must leave alone; and the
 * pull functions are handed only what they turn away before asking Google anything.
 */
import { createServer } from "node:http";
import { Worker } from "node:worker_threads";
import { gunzipSync } from "node:zlib";

process.env.GC_API_BASE = "http://127.0.0.1:9";
process.env.GCLOUD_PROJECT = "smoke-project";
// A call's sign-in is read as the emulator reads it, without asking Google to verify it, so the
// edit function's own check of who is calling can be tried here (it reads the caller's entry on
// the list, which the stand-in below answers). Read once, as the SDK loads.
process.env.FIREBASE_DEBUG_MODE = "true";
process.env.FIREBASE_DEBUG_FEATURES = JSON.stringify({ skipTokenVerification: true });
const { gcTeam, billingCap, startPull, runPull, onCopyWrite, rebuild, edit } =
  await import("./lib/index.js");

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

// The proxy is for the accounts on the cloud copy's list. Firestore answers the check's read of a
// caller's own entry: there for the one member, refused for anyone else.
const realFetch = globalThis.fetch;
const listReads = [];
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (!url.startsWith("https://firestore.googleapis.com/")) return realFetch(input, init);
  listReads.push(url);
  return new Response("{}", {
    status: url.endsWith("/documents/members/member%40example.com") ? 200 : 403,
  });
};
const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const signedInAs = (email) => ({
  authorization: `Bearer ${part({ alg: "RS256" })}.${part({ email, exp: Math.floor(Date.now() / 1000) + 3600 })}.signature`,
});

const ids = Array.from({ length: 10 }, (_, index) => `SmokeTeam${String(index).padStart(3, "0")}`);
const unsignedPull = await call(`/?ids=${ids.join(",")}&raw=1`);
check(
  "a pull with no sign-in is turned away, before anything is asked",
  unsignedPull.status === 401 &&
    JSON.parse(text(unsignedPull)).reason === "members-only" &&
    listReads.length === 0,
  `${unsignedPull.status} ${text(unsignedPull).slice(0, 200)} after ${listReads.length} reads`
);
const outsider = await call(`/?ids=${ids.join(",")}&raw=1`, signedInAs("outsider@example.com"));
check(
  "a pull by an account not on the list is turned away",
  outsider.status === 403 && JSON.parse(text(outsider)).reason === "members-only",
  `${outsider.status} ${text(outsider).slice(0, 200)}`
);
const batch = await call(`/?ids=${ids.join(",")}&raw=1`, {
  "accept-encoding": "gzip, br",
  ...signedInAs("member@example.com"),
});
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
globalThis.fetch = realFetch;

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

/** A POST to an HTTP-shaped handler, answered as Express would. */
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

// The rebuilds after saves, built only once their setup is done (`build.mjs`), as the pulls are,
// and the edit function with them.
if (process.env.LIVE_REBUILD !== "on") {
  check(
    "the rebuilds after saves and the edits are left out of a build without LIVE_REBUILD",
    onCopyWrite === undefined && rebuild === undefined && edit === undefined,
    `${typeof onCopyWrite} ${typeof rebuild} ${typeof edit}`
  );
} else {
  const called = edit.__endpoint;
  check(
    "an edit is a call, as the rebuilds' account, one instance taking several at half the rebuild's size",
    called.callableTrigger !== undefined &&
      called.serviceAccountEmail === "live-runner@" &&
      called.availableMemoryMb === 4096 &&
      called.cpu === 2 &&
      called.timeoutSeconds === 540 &&
      called.maxInstances === 1 &&
      called.concurrency === 8,
    JSON.stringify(called)
  );
  // Who may call: the list's answer comes from the stand-in, there for the one member alone. Every
  // call here is turned away before the worker starts or the copy is read.
  const reads = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (!url.startsWith("https://firestore.googleapis.com/")) return realFetch(input, init);
    reads.push(url);
    return new Response("{}", {
      status: url.endsWith("/documents/members/member%40example.com") ? 200 : 403,
    });
  };
  const command = { kind: "team.state", teamId: "B", state: "KY" };
  const unsignedEdit = await post(edit, { data: { command } });
  check(
    "an edit is not made for a caller who has not signed in",
    unsignedEdit.status === 401 && /UNAUTHENTICATED/.test(String(unsignedEdit.body)),
    `${unsignedEdit.status} ${unsignedEdit.body}`
  );
  const outsiderEdit = await post(edit, { data: { command } }, signedInAs("outsider@example.com"));
  check(
    "nor for an account not on the list",
    outsiderEdit.status === 403 && /PERMISSION_DENIED/.test(String(outsiderEdit.body)),
    `${outsiderEdit.status} ${outsiderEdit.body}`
  );
  const memberReads = reads.length;
  const junk = await post(
    edit,
    { data: { command: { kind: "game.drop", gameId: "g1" } } },
    signedInAs("member@example.com")
  );
  const badCopy = await post(
    edit,
    { data: { command, copy: "../copies/other" } },
    signedInAs("member@example.com")
  );
  check(
    "and a member's call that is not an edit, or names no copy, is refused as such",
    junk.status === 400 &&
      /INVALID_ARGUMENT/.test(String(junk.body)) &&
      badCopy.status === 400 &&
      /INVALID_ARGUMENT/.test(String(badCopy.body)),
    `${junk.status} ${junk.body} / ${badCopy.status} ${badCopy.body}`
  );
  check(
    "having read nothing but the caller's own entry on the list, once while it holds",
    reads.length === memberReads + 1 && reads.every((url) => url.includes("/documents/members/")),
    JSON.stringify(reads)
  );
  globalThis.fetch = realFetch;
  // The edit's worker, bundled apart: it loads, and answers a ping without reading anything.
  const editPong = await new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./lib/editWorker.js", import.meta.url));
    worker.once("message", (answer) => {
      resolve(answer);
      void worker.terminate();
    });
    worker.once("error", reject);
    worker.postMessage({ kind: "ping", id: 1 });
  });
  check(
    "an edit's worker loads and answers",
    editPong.kind === "pong" && editPong.id === 1,
    JSON.stringify(editPong)
  );

  const written = onCopyWrite.__endpoint;
  check(
    "a write of the copy's manifest, and of nothing under it, triggers the rebuilds' account",
    written.eventTrigger?.eventType === "google.cloud.firestore.document.v1.written" &&
      written.eventTrigger?.eventFilters?.document === "copies/main" &&
      Object.keys(written.eventTrigger?.eventFilterPathPatterns ?? {}).length === 0 &&
      written.eventTrigger?.retry === false &&
      written.serviceAccountEmail === "live-runner@",
    JSON.stringify(written)
  );
  const queued = rebuild.__endpoint;
  check(
    "a rebuild runs one at a time, as the rebuilds' account, at the size the ledger prices",
    queued.taskQueueTrigger?.retryConfig?.maxAttempts === 3 &&
      queued.taskQueueTrigger?.retryConfig?.minBackoffSeconds === 120 &&
      queued.taskQueueTrigger?.rateLimits?.maxConcurrentDispatches === 1 &&
      queued.serviceAccountEmail === "live-runner@" &&
      queued.availableMemoryMb === 8192 &&
      queued.cpu === 2 &&
      queued.timeoutSeconds === 300 &&
      queued.maxInstances === 1 &&
      queued.concurrency === 1,
    JSON.stringify(queued)
  );

  // Firestore's event, as it sends one, through the SDK's own reading of it. A write that asks for
  // no rebuild is decided before anything is read, so these need no network.
  const MANIFEST = "projects/smoke-project/databases/(default)/documents/copies/main";
  const str = (value) => ({ stringValue: value });
  const int = (value) => ({ integerValue: String(value) });
  const manifest = (version, leagueHash) => ({
    name: MANIFEST,
    createTime: "2026-10-03T00:00:00Z",
    updateTime: "2026-10-03T00:00:00Z",
    fields: {
      format: int(2),
      schema: int(1),
      copy: str("c0ffee"),
      version: int(version),
      save: str("s"),
      updatedAt: str("2026-10-03T00:00:00.000Z"),
      device: str("phone"),
      parts: {
        arrayValue: {
          values: [
            {
              mapValue: {
                fields: {
                  key: str("league"),
                  hash: str(leagueHash.repeat(64)),
                  bytes: int(10),
                  chunks: int(1),
                  id: str("0123456789abcdef"),
                  at: int(1),
                  by: str("phone"),
                },
              },
            },
          ],
        },
      },
      kept: { arrayValue: {} },
    },
  });
  const event = (oldValue, value) => ({
    specversion: "1.0",
    id: "smoke-write",
    source: "//firestore.googleapis.com/projects/smoke-project/databases/(default)",
    type: "google.cloud.firestore.document.v1.written",
    time: new Date().toISOString(),
    datacontenttype: "application/json",
    project: "smoke-project",
    database: "(default)",
    namespace: "(default)",
    document: "copies/main",
    data: { ...(oldValue ? { oldValue } : {}), ...(value ? { value } : {}) },
  });
  /** The lines a call logs: the functions logger writes one JSON line each. */
  const logged = async (call) => {
    const lines = [];
    const out = process.stdout.write;
    const err = process.stderr.write;
    const keep = (chunk) => {
      lines.push(...String(chunk).split("\n").filter(Boolean));
      return true;
    };
    process.stdout.write = keep;
    process.stderr.write = keep;
    try {
      await call();
    } finally {
      process.stdout.write = out;
      process.stderr.write = err;
    }
    return lines.flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  };
  fetched = 0;
  globalThis.fetch = async (...args) => {
    fetched += 1;
    return realFetch(...args);
  };
  const skips = [];
  for (const [label, before, after] of [
    ["a delete", manifest(4, "a"), undefined],
    [
      "a manifest this build cannot read",
      manifest(4, "a"),
      { ...manifest(5, "a"), fields: { format: int(9) } },
    ],
    ["a save that moved no board's input", manifest(4, "a"), manifest(5, "a")],
  ]) {
    const lines = await logged(() => onCopyWrite(event(before, after)));
    skips.push([label, lines.find((line) => line.event === "skip")?.why]);
  }
  check(
    "a delete, an unreadable manifest and a save no board reads are skipped as such",
    JSON.stringify(skips.map(([, why]) => why)) ===
      JSON.stringify(["deleted", "unreadable", "no-board-input"]),
    JSON.stringify(skips)
  );

  // Cloud Tasks signs its requests and Cloud Run checks them; a task of any other shape than the
  // trigger's is done with at once.
  const signed = { authorization: "Bearer e30.eyJzdWIiOiJzbW9rZSJ9.c2ln" };
  // Checked once the lines are back: a check made while they are taken would print nothing.
  let stray = null;
  const strayLines = await logged(async () => {
    stray = await post(rebuild, { data: { copy: "", kind: "nightly" } }, signed);
  });
  check("a task of another shape is done with", stray?.status === 204, `${stray?.status}`);
  check(
    "and said",
    strayLines.some((line) => line.end === "not-a-task"),
    JSON.stringify(strayLines)
  );
  // The rebuild's worker, bundled apart: it loads, and answers a ping without reading anything.
  const pong = await new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./lib/rebuildWorker.js", import.meta.url));
    worker.once("message", (answer) => {
      resolve(answer);
      void worker.terminate();
    });
    worker.once("error", reject);
    worker.postMessage({ kind: "ping", id: 1 });
  });
  check(
    "a rebuild's worker loads and answers",
    pong.kind === "pong" && pong.id === 1,
    JSON.stringify(pong)
  );
  check("and nothing asked anybody anything", fetched === 0, `${fetched} requests`);

  // A save that moves a board, queued through firebase-admin to a stand-in for Cloud Tasks, which
  // takes the task's first queueing and refuses the same name after, as Cloud Tasks does. The
  // switch's read finds no credentials (no metadata server is asked), which counts as on. This is
  // the first queueing the smoke test makes, so firebase-admin reads the stand-in's address here.
  const tasks = [];
  const names = new Set();
  const queue = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const task = JSON.parse(body || "{}").task ?? {};
      tasks.push({ url: req.url, ...task });
      const again = names.has(task.name);
      names.add(task.name);
      res.writeHead(again ? 409 : 200, { "content-type": "application/json" });
      res.end(
        JSON.stringify(
          again ? { error: { code: 409, status: "ALREADY_EXISTS", message: "exists" } } : task
        )
      );
    });
  });
  await new Promise((resolve) => queue.listen(0, "127.0.0.1", resolve));
  process.env.CLOUD_TASKS_EMULATOR_HOST = `127.0.0.1:${queue.address().port}`;
  process.env.METADATA_SERVER_DETECTION = "none";
  const saves = await logged(async () => {
    await onCopyWrite(event(manifest(4, "a"), manifest(5, "b")));
    await onCopyWrite(event(manifest(5, "b"), manifest(6, "c")));
  });
  queue.close();
  const saved = saves.filter((line) => line.event === "save");
  check(
    "a save that moves a board queues its window's rebuild, waited on past the timeout",
    tasks.length === 2 &&
      tasks.every(
        (task) =>
          task.url === "/projects/smoke-project/locations/us-central1/queues/rebuild/tasks" &&
          /\/tasks\/[0-9a-f]{40}$/.test(task.name) &&
          task.name === tasks[0].name &&
          task.dispatchDeadline === "600s" &&
          typeof task.scheduleTime === "string"
      ),
    JSON.stringify(tasks)
  );
  check(
    "and a second save in the window finds it queued, which is done",
    saved.length === 2 &&
      saved.every((line) => line.queued === true && line.task === tasks[0]?.name.slice(-40)),
    JSON.stringify(saves)
  );
  globalThis.fetch = realFetch;
}
