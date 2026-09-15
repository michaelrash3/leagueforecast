import { csvEscape } from "./csv";
import { gcTeamPageUrl, type GcFetchErrorReason } from "./gameChangerApi";
import type { GcImportOutcome } from "./gameChangerImport";
import type { GcPullFailure } from "./gameChangerPull";

/**
 * What a pull could not import, and why — every team, not a sample.
 *
 * A run over a few thousand teams will always leave some behind, and two quite different things
 * are meant by that. A schedule may never have arrived: GameChanger did not answer, or answered
 * with something unreadable. Or it arrived and could not be filed: no age group, no season, a
 * level below the youngest this app ranks. Both leave a team out of the rankings, and both are
 * invisible in a count. The reader needs the list, because the fix differs per team — retry one,
 * correct another on GameChanger, ignore the third — and with thousands of rows it has to be
 * something they can take away rather than scroll.
 */

/** Which way a team was lost. */
export type GcProblemKind =
  /** The schedule never arrived. Often worth another try. */
  | "not-reached"
  /** The schedule arrived but had nowhere to go. */
  | "not-filed";

export type GcImportProblem = {
  teamId: string;
  /** What the team is called, when anything knew — GameChanger's own name, or the list's. */
  teamName?: string;
  kind: GcProblemKind;
  /** A few words naming the kind of failure. */
  reason: string;
  /** The whole sentence, as the layer that failed put it. */
  detail: string;
  url: string;
};

/** Short names for the ways a fetch can fail, so the list and the file agree on the wording. */
export const GC_FETCH_REASON_LABEL: Record<GcFetchErrorReason, string> = {
  "invalid-id": "Not a GameChanger id",
  "not-found": "No such team",
  blocked: "GameChanger refused the request",
  throttled: "Too many requests",
  "upstream-error": "GameChanger errored",
  unrecognized: "Unreadable answer",
  network: "Could not reach it",
  unconfigured: "Proxy not deployed",
  timeout: "Timed out",
};

const reasonLabel = (reason: string): string =>
  GC_FETCH_REASON_LABEL[reason as GcFetchErrorReason] ?? reason;

/**
 * The teams a run did not import, in one list: the ones it could not fetch, then the ones it
 * fetched and could not file. `names` fills in a team the pull never got far enough to name,
 * from whatever the pasted list said about it.
 */
export const collectGcImportProblems = (
  failures: readonly GcPullFailure[],
  outcomes: readonly GcImportOutcome[],
  names: ReadonlyMap<string, string> = new Map()
): GcImportProblem[] => {
  const problems: GcImportProblem[] = failures.map((failure) => {
    const teamName = names.get(failure.teamId);
    return {
      teamId: failure.teamId,
      ...(teamName ? { teamName } : {}),
      kind: "not-reached" as const,
      reason: reasonLabel(failure.reason),
      detail: failure.message,
      url: gcTeamPageUrl(failure.teamId),
    };
  });

  outcomes.forEach((outcome) => {
    if (!outcome.issue) return;
    const teamName = outcome.teamName || names.get(outcome.gcTeamId);
    problems.push({
      teamId: outcome.gcTeamId,
      ...(teamName ? { teamName } : {}),
      kind: "not-filed",
      reason: "Nowhere to file it",
      detail: outcome.issue,
      url: gcTeamPageUrl(outcome.gcTeamId),
    });
  });

  return problems;
};

const PROBLEM_HEADERS = [
  "Team ID",
  "Team Name",
  "Problem",
  "Reason",
  "Detail",
  "GameChanger URL",
] as const;

const KIND_LABEL: Record<GcProblemKind, string> = {
  "not-reached": "Not reached",
  "not-filed": "Not filed",
};

/**
 * The same list as a CSV, because a few hundred rows is something to work through in a
 * spreadsheet rather than read off a phone. Free text is flattened so one problem stays one row.
 */
export const gcImportProblemsCsv = (problems: readonly GcImportProblem[]): string => {
  const flat = (value: string | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
  const rows = problems.map((problem) =>
    [
      problem.teamId,
      flat(problem.teamName),
      KIND_LABEL[problem.kind],
      flat(problem.reason),
      flat(problem.detail),
      problem.url,
    ]
      .map(csvEscape)
      .join(",")
  );
  return [PROBLEM_HEADERS.join(","), ...rows].join("\n");
};

/** One line saying how many were lost each way, for the panel's heading. */
export const describeGcProblems = (problems: readonly GcImportProblem[]): string => {
  const notReached = problems.filter((problem) => problem.kind === "not-reached").length;
  const notFiled = problems.length - notReached;
  const parts: string[] = [];
  if (notReached > 0) parts.push(`${notReached} not reached`);
  if (notFiled > 0) parts.push(`${notFiled} could not be filed`);
  return parts.join(" · ");
};
