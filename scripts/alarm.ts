/**
 * Raises or settles the alarms a run on GitHub keeps as issues on this repository (`runAlarms.ts`,
 * README "When a run fails"), run by the workflows as the run's last step, whatever came before:
 *
 *   npm run alarm -- nightly      after the nightly refresh (OUTCOME, MODE and REBUILDS set)
 *   npm run alarm -- republish    after the republish that follows a deploy (OUTCOME set)
 *
 * What to raise or settle, and every word an issue says, is worked out in `runAlarms.ts`, from the
 * outcome of the run's own step, the rebuilds' trouble the nightly handed over, the time and the
 * run's link; this lists the open issues and runs the `gh` commands it names, with the workflow's
 * own token (`GH_TOKEN`). Nothing from the run's log is read. What it prints is which issue it
 * opened, commented on or closed, by number.
 */
import { execFileSync } from "node:child_process";
import {
  alarmStep,
  coerceOpenIssues,
  ghArgsOf,
  GH_LIST_ARGS,
  nightlyVerdicts,
  republishVerdicts,
  runLinkOf,
  type Verdict,
} from "../src/lib/runAlarms.ts";

declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  exit: (code?: number) => never;
};

const env = process.env;
const which = process.argv[2];
const verdicts: Verdict[] | null =
  which === "nightly"
    ? nightlyVerdicts({
        outcome: env.OUTCOME ?? "",
        event: env.GITHUB_EVENT_NAME ?? "",
        mode: env.MODE ?? "",
        rebuilds: env.REBUILDS ?? "",
      })
    : which === "republish"
      ? republishVerdicts({ outcome: env.OUTCOME ?? "" })
      : null;
if (verdicts === null) {
  console.log("Say which run's alarms: nightly or republish.");
  process.exit(2);
}
const repo = env.GITHUB_REPOSITORY ?? "";
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
  console.log(
    "GITHUB_REPOSITORY does not name a repository, so there is nowhere to raise an alarm."
  );
  process.exit(1);
}
if (verdicts.length === 0) {
  console.log("Nothing to raise or settle.");
  process.exit(0);
}

/**
 * Runs `gh`, and says why where it would not: the first line of what it said, which names the
 * refusal (a token without `issues: write`, say) and never the token.
 */
const gh = (args: readonly string[]): string | null => {
  try {
    // What it says on stderr is kept for the one line below, not passed on to the log whole.
    return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const said = (error as { stderr?: unknown } | null)?.stderr;
    const line = typeof said === "string" ? said.trim().split("\n")[0]?.slice(0, 200) : undefined;
    console.log(`gh ${args.slice(0, 2).join(" ")} failed${line ? `: ${line}` : ""}.`);
    return null;
  }
};

const parsed = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const listed = gh(GH_LIST_ARGS(repo));
const open = listed === null ? null : coerceOpenIssues(parsed(listed));
if (open === null) {
  console.log("The open issues could not be listed, so no alarm was raised or settled.");
  process.exit(1);
}
const run = { at: new Date().toISOString(), link: runLinkOf(env) };
let failed = false;
for (const verdict of verdicts) {
  const step = alarmStep(verdict, open, run);
  if (!step) {
    console.log(`${verdict.kind}: fine, and no issue of its own is open.`);
    continue;
  }
  // Each alarm on its own: one that could not be raised does not keep the next from it.
  if (gh(ghArgsOf(step, repo)) === null) {
    failed = true;
    continue;
  }
  console.log(
    `${verdict.kind}: ${
      step.do === "open"
        ? "opened an issue"
        : step.do === "comment"
          ? `commented on #${step.issue}`
          : `closed #${step.issue}`
    }.`
  );
}
process.exit(failed ? 1 : 0);
