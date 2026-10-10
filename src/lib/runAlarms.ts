/**
 * The alarms GitHub's runs raise on this repository (README, "When a run fails"): an issue opened
 * when the nightly refresh fails, when the republish after a deploy fails, and when the nightly
 * finds the rebuilds after saves failing in their ledger. Each alarm keeps one issue: a run that
 * fails again comments on the one open, and the first run that is fine closes it with a comment.
 * The nightly of 10 October 2026 failed at 03:52 UTC and the owner learned of it from a board
 * nobody looks at; an issue is what GitHub tells the owner of, by email and on the phone.
 *
 * Every word of an issue is public, as the repository is, so what it says is made here from fixed
 * phrases, the time and the run's link only, never from a log. All of it is pure, so it is tested;
 * `scripts/alarm.ts` reads the run's variables, lists the open issues and runs the `gh` commands
 * this names, and the workflows only call it.
 */

export type AlarmKind = "nightly" | "republish" | "rebuilds";

/** The title each alarm's issue is found again by, among the issues the workflows opened. */
export const ALARM_TITLES: Record<AlarmKind, string> = {
  nightly: "The nightly refresh failed",
  republish: "Publishing the views after a deploy failed",
  rebuilds: "The rebuilds after saves are failing",
};

/**
 * What a run found of one alarm: failing, as `said` in a word or two, or fine, which settles it;
 * `how` the nightly ran, scheduled or by hand, where it is the nightly's own.
 */
export type Verdict = {
  kind: AlarmKind;
  how?: string;
} & ({ failing: true; said: string } | { failing: false });

/** A step's outcome as GitHub gives it (`steps.<id>.outcome`), where it is a failure. */
const FAILED_AS: Record<string, string> = {
  failure: "failed",
  // Cut off by its timeout, or stopped by hand: either way the night's work was not done.
  cancelled: "was stopped before it finished",
  // A step before it failed. Said only where the alarm can run at all: never after a failed
  // checkout, whose script it is, and after a failed setup of Node only on a runner whose own Node
  // runs it.
  skipped: "did not start",
};

/** The rebuilds' trouble as the nightly hands it over (`rebuildsTrouble`), in words. */
const REBUILDS_AS: Record<string, string> = { paused: "paused", failing: "failing in a row" };

/**
 * The alarms a nightly raises or settles: its own from how its refresh step ended, and the
 * rebuilds' from their ledger as it read it (`rebuilds`: `paused`, `failing` or `none`, and
 * anything else, a ledger not read, leaves it as it is). Its own is settled only by a live run that
 * succeeded: a dry run saves nothing, so its success says nothing of a night that failed saving,
 * as the night of 10 October did.
 */
export const nightlyVerdicts = ({
  outcome,
  event,
  mode,
  rebuilds = "",
}: {
  outcome: string;
  event: string;
  mode: string;
  rebuilds?: string;
}): Verdict[] => {
  const live = mode === "live";
  const how = event === "schedule" ? "scheduled" : live ? "by hand, live" : "by hand, dry run";
  const verdicts: Verdict[] = [];
  const failed = FAILED_AS[outcome];
  if (failed !== undefined) verdicts.push({ kind: "nightly", failing: true, said: failed, how });
  else if (outcome === "success" && live) verdicts.push({ kind: "nightly", failing: false, how });
  const trouble = REBUILDS_AS[rebuilds];
  if (trouble !== undefined) verdicts.push({ kind: "rebuilds", failing: true, said: trouble });
  else if (rebuilds === "none") verdicts.push({ kind: "rebuilds", failing: false });
  return verdicts;
};

/** The alarm a republish after a deploy raises or settles, from how its step ended. */
export const republishVerdicts = ({ outcome }: { outcome: string }): Verdict[] => {
  const failed = FAILED_AS[outcome];
  if (failed !== undefined) return [{ kind: "republish", failing: true, said: failed }];
  return outcome === "success" ? [{ kind: "republish", failing: false }] : [];
};

/** What each alarm's issue says, in its own words: failing, failing again, and fine. */
const WORDS: Record<
  AlarmKind,
  { failed: (said: string, how: string) => string; fine: (how: string) => string; closes: string }
> = {
  nightly: {
    failed: (said, how) => `the nightly refresh ${said}${how}`,
    fine: (how) => `The nightly refresh succeeded${how}`,
    closes: "Each run that fails again comments here, and the next live run that succeeds",
  },
  republish: {
    failed: (said) => `the republish after a deploy ${said}`,
    fine: () => "The republish after a deploy succeeded",
    closes: "Each republish that fails again comments here, and the next that succeeds",
  },
  rebuilds: {
    failed: (said) => `the nightly found the rebuilds after saves ${said} in their ledger`,
    fine: () => "The nightly found no failures in a row and no pause in the rebuilds' ledger",
    closes:
      "Each nightly that finds them so again comments here, and the first to find no failures in a row and no pause",
  },
};

const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** An instant as a person reads it in an issue: the day and the minute, in UTC. */
export const stampOf = (iso: string): string => {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "not known";
  const stamp = new Date(time).toISOString();
  return `${stamp.slice(0, 10)} ${stamp.slice(11, 16)} UTC`;
};

/**
 * The run's own page, from the variables GitHub sets on its runners, or null where any is missing
 * or not what GitHub sets: only a link GitHub made goes into a public issue.
 */
export const runLinkOf = (env: Record<string, string | undefined>): string | null => {
  const server = env.GITHUB_SERVER_URL ?? "";
  const repo = env.GITHUB_REPOSITORY ?? "";
  const run = env.GITHUB_RUN_ID ?? "";
  if (!/^https:\/\/[A-Za-z0-9.-]+$/.test(server)) return null;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return null;
  if (!/^\d+$/.test(run)) return null;
  return `${server}/${repo}/actions/runs/${run}`;
};

/** An open issue as `gh issue list --json number,title,author` gives it. */
export type OpenIssue = { number: number; title: string; author: { login: string } | null };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The open issues `gh` listed, each with what this needs of it, or null for anything but a list. */
export const coerceOpenIssues = (raw: unknown): OpenIssue[] | null => {
  if (!Array.isArray(raw)) return null;
  return raw.flatMap((item): OpenIssue[] => {
    if (!isRecord(item)) return [];
    const { number, title, author } = item;
    if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1) return [];
    if (typeof title !== "string") return [];
    const login = isRecord(author) && typeof author.login === "string" ? author.login : null;
    return [{ number, title, author: login === null ? null : { login } }];
  });
};

/**
 * Whether an issue was opened by a workflow's own token, which `gh` names `app/github-actions` and
 * GitHub's REST interface `github-actions[bot]`. An issue anybody else opened under the same title
 * is theirs, and an alarm neither comments on it nor closes it.
 */
const byWorkflow = (author: OpenIssue["author"]): boolean =>
  author !== null && /^(app\/)?github-actions(\[bot\])?$/.test(author.login);

/** What `gh` is asked to do for one alarm. */
export type AlarmStep =
  | { do: "open"; title: string; body: string }
  | { do: "comment"; issue: number; body: string }
  | { do: "close"; issue: number; body: string };

/**
 * What one alarm does, given the open issues and the run: a failure opens its issue, or comments on
 * the one open (the oldest, were there two), and a run that is fine closes it with a comment, or
 * does nothing where none is open.
 */
export const alarmStep = (
  verdict: Verdict,
  open: readonly OpenIssue[],
  run: { at: string; link: string | null }
): AlarmStep | null => {
  const words = WORDS[verdict.kind];
  const title = ALARM_TITLES[verdict.kind];
  const mine = open
    .filter((one) => one.title === title && byWorkflow(one.author))
    .sort((a, b) => a.number - b.number)[0];
  const how = verdict.how === undefined ? "" : ` (${verdict.how})`;
  const where = `When: ${stampOf(run.at)}\nRun: ${run.link ?? "not known"}`;
  if (verdict.failing) {
    const failed = words.failed(verdict.said, how);
    if (mine) return { do: "comment", issue: mine.number, body: `Again: ${failed}.\n\n${where}` };
    return {
      do: "open",
      title,
      body: `${capitalized(failed)}.\n\n${where}\n\n${words.closes} closes this issue.`,
    };
  }
  if (!mine) return null;
  return {
    do: "close",
    issue: mine.number,
    body: `${words.fine(how)}, so this is closed.\n\n${where}`,
  };
};

/** The `gh` command that lists the open issues on `repo`, as `coerceOpenIssues` reads them. */
export const GH_LIST_ARGS = (repo: string): string[] => [
  "issue",
  "list",
  "--repo",
  repo,
  "--state",
  "open",
  "--limit",
  "200",
  "--json",
  "number,title,author",
];

/** The `gh` command that takes `step` on `repo`. */
export const ghArgsOf = (step: AlarmStep, repo: string): string[] => {
  switch (step.do) {
    case "open":
      return ["issue", "create", "--repo", repo, "--title", step.title, "--body", step.body];
    case "comment":
      return ["issue", "comment", String(step.issue), "--repo", repo, "--body", step.body];
    case "close":
      return ["issue", "close", String(step.issue), "--repo", repo, "--comment", step.body];
  }
};
