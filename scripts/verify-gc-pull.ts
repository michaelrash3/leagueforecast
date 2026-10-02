/**
 * Checks the deployed GameChanger proxy, then pulls real GameChanger teams and says what it proved.
 *
 * Everything about the import is tested against recorded fixtures. Fixtures prove the code and
 * prove nothing about GameChanger: whether its AWS WAF lets a server through at all, whether
 * today's payload is still the shape the normalizer expects, whether the schedules coming back
 * carry scores. Those need real requests, and these are them.
 *
 * The deployed proxy is for the accounts on the cloud copy's list (`memberCheck.ts`), and this
 * script has none to sign in with. So it asks the deployed proxy two things a stranger can: that
 * it is up (`?probe=1`), and that it turns a request with no sign-in away. The teams themselves
 * are pulled through the proxy's own handler in this process (`handlerFetch`), as the nightly
 * refresh pulls them, which asks GameChanger from wherever this runs: one of GitHub's servers, in
 * the workflow (`verify-gc.yml`).
 *
 *   npm run verify:gc -- --base https://your-app.vercel.app --id FtEExZwB4b8E
 *
 * `--base` defaults to http://localhost:3000, which is where `vercel dev` serves the function.
 * `--proxy` names the proxy itself instead, for one that is not at `<base>/api/gc-team` — the
 * Firebase function (`functions/`), whose own URL is the endpoint:
 *
 *   npm run verify:gc -- --proxy https://us-central1-<project>.cloudfunctions.net/gcTeam
 *
 * Several `--id`s may be given; the last one also exercises the batch endpoint. Exits non-zero if
 * anything essential failed, so CI or a shell script can rely on it.
 */

import type { GcTeamResponse } from "../src/lib/gameChangerApi.ts";
import {
  checkStrangerRefused,
  checkTeamResponse,
  verdict,
  type PullCheck,
} from "../src/lib/gcPullCheck.ts";
import { handlerFetch } from "./handlerFetch.ts";

/**
 * The one Node global this script needs. Declared here rather than via `@types/node`, for the same
 * reason `api/gc-team.ts` does it: installing that package changes global timer typings for the
 * browser project too.
 */
declare const process: { argv: string[]; exit: (code: number) => never };

const DEFAULT_BASE = "http://localhost:3000";
/** A team id known to exist publicly, so the script is runnable with no arguments at all. */
const SAMPLE_ID = "FtEExZwB4b8E";

type Args = { endpoint: string; ids: string[] };

const parseArgs = (argv: string[]): Args => {
  const ids: string[] = [];
  let base = DEFAULT_BASE;
  let proxy: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if ((flag === "--base" || flag === "-b") && value) {
      base = value.replace(/\/+$/, "");
      index += 1;
    } else if (flag === "--proxy" && value) {
      proxy = value.replace(/\/+$/, "");
      index += 1;
    } else if ((flag === "--id" || flag === "-i") && value) {
      ids.push(value);
      index += 1;
    }
  }
  return { endpoint: proxy ?? `${base}/api/gc-team`, ids: ids.length > 0 ? ids : [SAMPLE_ID] };
};

const MARK: Record<PullCheck["status"], string> = { pass: "  ok ", warn: "warn ", fail: "FAIL " };

const report = (checks: PullCheck[]): void => {
  checks.forEach((check) => {
    console.log(`${MARK[check.status]} ${check.step}: ${check.detail}`);
    if (check.advice) console.log(`        → ${check.advice}`);
  });
};

/** An answer's status and its JSON, through `fetchImpl`: the network's, or the handler's own. */
const getJsonVia = async (
  fetchImpl: typeof fetch,
  url: string
): Promise<{ status: number; body: unknown }> => {
  const response = await fetchImpl(url, { headers: { accept: "application/json" } });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    throw new Error(
      `${url} answered ${response.status} with something that is not JSON:\n${text.slice(0, 400)}`
    );
  }
};

const getJson = async (url: string): Promise<unknown> =>
  (await getJsonVia((input, init) => fetch(input, init), url)).body;

/** The proxy's handler in this process: where the teams are pulled from (see the top). */
const IN_PROCESS = "/api/gc-team";

/**
 * How long a proxy that answers a stranger is asked again before that counts. A check run on a
 * push can reach the deployment from before the push, which a slow build keeps serving past the
 * workflow's wait, and every deployment before 2 October 2026 answered anyone.
 */
const STRANGER_TRIES = 5;
const STRANGER_WAIT_MS = 30_000;

/**
 * A request with no sign-in, as anybody who found the URL could make. Read whatever comes back:
 * a host's own login page in front of the function is an answer worth naming, not a crash.
 */
const askAsStranger = async (url: string): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: null };
  }
};

const main = async (): Promise<number> => {
  const { endpoint, ids } = parseArgs(process.argv.slice(2));
  console.log(`Verifying the GameChanger pull through ${endpoint}\n`);

  // Does the function exist at all, and with what configuration? This never touches GameChanger,
  // so a failure here is about the deployment rather than about the WAF.
  try {
    const probe = await getJson(`${endpoint}?probe=1`);
    console.log("Proxy:", JSON.stringify(probe));
  } catch (error) {
    console.log(`FAIL  Proxy: ${error instanceof Error ? error.message : String(error)}`);
    console.log(
      "        → The function is not answering. Is it deployed, and is --base (or --proxy) right?"
    );
    return 1;
  }
  console.log("");

  const all: PullCheck[] = [];

  // A request with no sign-in, which the deployed proxy must turn away.
  const strangerUrl = `${endpoint}?id=${encodeURIComponent(ids[0] ?? SAMPLE_ID)}`;
  let stranger = await askAsStranger(strangerUrl);
  for (
    let tries = 1;
    tries < STRANGER_TRIES && stranger.status >= 200 && stranger.status < 300;
    tries += 1
  ) {
    console.log(
      `The proxy answered a request with no sign-in. Asking again in ${STRANGER_WAIT_MS / 1_000} s, in case it is the deployment from before this push.`
    );
    await new Promise((resolve) => setTimeout(resolve, STRANGER_WAIT_MS));
    stranger = await askAsStranger(strangerUrl);
  }
  const strangerCheck = checkStrangerRefused(stranger.status, stranger.body);
  report([strangerCheck]);
  console.log("");
  all.push(strangerCheck);

  console.log("Pulling through the proxy's handler in this process\n");
  const inProcess = handlerFetch();
  for (const id of ids) {
    const response = (await getJsonVia(inProcess, `${IN_PROCESS}?id=${encodeURIComponent(id)}`))
      .body as GcTeamResponse | undefined;
    if (!response || typeof response !== "object" || !("ok" in response)) {
      all.push({
        step: `Pull ${id}`,
        status: "fail",
        detail: "The proxy answered with something that is not a GcTeamResponse.",
      });
      continue;
    }
    const checks = checkTeamResponse(id, response);
    report(checks);
    console.log("");
    all.push(...checks);
  }

  // The batch path is what a real pull uses; a single id never exercises it.
  const batch = (
    await getJsonVia(inProcess, `${IN_PROCESS}?ids=${ids.map(encodeURIComponent).join(",")}`)
  ).body as { ok?: boolean; teams?: Array<{ teamId: string; result: GcTeamResponse }> } | undefined;
  const returned = Array.isArray(batch?.teams) ? batch.teams.length : 0;
  const batchCheck: PullCheck = {
    step: "Batch endpoint",
    status: returned === ids.length ? "pass" : "fail",
    detail: `Asked for ${ids.length}, got ${returned} back.`,
    ...(returned === ids.length
      ? {}
      : { advice: "A real pull asks ten at a time. If this path is broken, every pull is." }),
  };
  report([batchCheck]);
  all.push(batchCheck);

  const result = verdict(all);
  console.log(`\n${result.line}`);
  return result.ok ? 0 : 1;
};

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
);
