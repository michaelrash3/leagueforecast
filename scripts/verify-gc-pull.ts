/**
 * Pulls one real GameChanger team through the deployed proxy and says what it proved.
 *
 * Everything about the import is tested against recorded fixtures. Fixtures prove the code and
 * prove nothing about GameChanger: whether its AWS WAF lets a server through at all, whether
 * today's payload is still the shape the normalizer expects, whether the schedules coming back
 * carry scores. Those need one real request, and this is it.
 *
 *   npm run verify:gc -- --base https://your-app.vercel.app --id FtEExZwB4b8E
 *
 * `--base` defaults to http://localhost:3000, which is where `vercel dev` serves the function.
 * Several `--id`s may be given; the last one also exercises the batch endpoint. Exits non-zero if
 * anything essential failed, so CI or a shell script can rely on it.
 */

import type { GcTeamResponse } from "../src/lib/gameChangerApi.ts";
import { checkTeamResponse, verdict, type PullCheck } from "../src/lib/gcPullCheck.ts";

/**
 * The one Node global this script needs. Declared here rather than via `@types/node`, for the same
 * reason `api/gc-team.ts` does it: installing that package changes global timer typings for the
 * browser project too.
 */
declare const process: { argv: string[]; exit: (code: number) => never };

const DEFAULT_BASE = "http://localhost:3000";
/** A team id known to exist publicly, so the script is runnable with no arguments at all. */
const SAMPLE_ID = "FtEExZwB4b8E";

type Args = { base: string; ids: string[] };

const parseArgs = (argv: string[]): Args => {
  const ids: string[] = [];
  let base = DEFAULT_BASE;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if ((flag === "--base" || flag === "-b") && value) {
      base = value.replace(/\/+$/, "");
      index += 1;
    } else if ((flag === "--id" || flag === "-i") && value) {
      ids.push(value);
      index += 1;
    }
  }
  return { base, ids: ids.length > 0 ? ids : [SAMPLE_ID] };
};

const MARK: Record<PullCheck["status"], string> = { pass: "  ok ", warn: "warn ", fail: "FAIL " };

const report = (checks: PullCheck[]): void => {
  checks.forEach((check) => {
    console.log(`${MARK[check.status]} ${check.step}: ${check.detail}`);
    if (check.advice) console.log(`        → ${check.advice}`);
  });
};

const getJson = async (url: string): Promise<unknown> => {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `${url} answered ${response.status} with something that is not JSON:\n${text.slice(0, 400)}`
    );
  }
};

const main = async (): Promise<number> => {
  const { base, ids } = parseArgs(process.argv.slice(2));
  console.log(`Verifying the GameChanger pull through ${base}\n`);

  // Does the function exist at all, and with what configuration? This never touches GameChanger,
  // so a failure here is about the deployment rather than about the WAF.
  try {
    const probe = await getJson(`${base}/api/gc-team?probe=1`);
    console.log("Proxy:", JSON.stringify(probe));
  } catch (error) {
    console.log(`FAIL  Proxy: ${error instanceof Error ? error.message : String(error)}`);
    console.log("        → The function is not answering. Is it deployed, and is --base right?");
    return 1;
  }
  console.log("");

  const all: PullCheck[] = [];
  for (const id of ids) {
    const response = (await getJson(`${base}/api/gc-team?id=${encodeURIComponent(id)}`)) as
      GcTeamResponse | undefined;
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
  const batch = (await getJson(
    `${base}/api/gc-team?ids=${ids.map(encodeURIComponent).join(",")}`
  )) as { ok?: boolean; teams?: Array<{ teamId: string; result: GcTeamResponse }> } | undefined;
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
