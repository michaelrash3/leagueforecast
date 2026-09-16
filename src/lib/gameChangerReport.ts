import { csvEscape } from "./csv";
import {
  formatGcSeason,
  gcTeamPageUrl,
  type GcFetchErrorReason,
  type GcTeamListEntry,
  type GcSeason,
  type GcTeamProfile,
} from "./gameChangerApi";
import type { GcImportOutcome } from "./gameChangerImport";
import type { GcPullFailure } from "./gameChangerPull";
import { teamNameKey } from "./teamRankings";

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

/** Which way a team was lost — or, for the last one, why it may not be the team that was wanted. */
export type GcProblemKind =
  /** The schedule never arrived. Often worth another try. */
  | "not-reached"
  /** The schedule arrived but had nowhere to go. */
  | "not-filed"
  /** It arrived and was filed, but it does not look like the team the list named. */
  | "check-id";

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
  names: ReadonlyMap<string, string> = new Map(),
  /**
   * What the list said each id would be, beside what GameChanger returned for it. Only the ids
   * present in both are checked, so a hand-pasted id with nothing claimed about it is never
   * questioned — there is nothing to question it against.
   */
  pulled: ReadonlyMap<string, { entry: GcTeamListEntry; profile: GcTeamProfile }> = new Map()
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

  pulled.forEach(({ entry, profile }, teamId) => {
    const mismatch = checkPulledTeam(entry, profile);
    if (!mismatch) return;
    problems.push({
      teamId,
      teamName: profile.name || names.get(teamId) || "",
      kind: "check-id",
      reason: mismatch.reason,
      detail: mismatch.detail,
      url: gcTeamPageUrl(teamId),
    });
  });

  return problems;
};

/**
 * Words that say nothing about which club this is. A "Baseball Club" in common is not a name in
 * common, and a season word is about when rather than who.
 */
const NOT_A_NAME = new Set([
  "baseball",
  "bsb",
  "club",
  "travel",
  "team",
  "the",
  "and",
  "fall",
  "winter",
  "spring",
  "summer",
  "autumn",
  "season",
]);

/**
 * Whether two names have any real word in common, which is a far weaker claim than being the same
 * name and is the point: a club writes itself down a dozen ways, but "Trash Pandas Baseball Club"
 * and "Trash Pandas" still share "trash" and "pandas", while a wrong id shares nothing at all.
 * Short tokens are dropped because "FC", "the" and a squad letter match by accident.
 */
const significantWords = (name: string): Set<string> =>
  new Set(
    teamNameKey(name)
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 3 && !NOT_A_NAME.has(word) && !/^\d+$/.test(word))
  );

const sharesAWord = (a: string, b: string): boolean => {
  if (teamNameKey(a) === teamNameKey(b)) return true;
  const left = significantWords(a);
  const right = significantWords(b);
  // Nothing to compare is not a disagreement: a name of only an age label says nothing either way.
  if (left.size === 0 || right.size === 0) return true;
  for (const word of left) {
    if (right.has(word)) return true;
  }
  return false;
};

const sameSeason = (a: GcSeason, b: GcSeason): boolean =>
  a.season === b.season && a.year === b.year;

/**
 * Whether the team GameChanger returned looks like the team the list asked for.
 *
 * A twelve-character id is unreadable, so a wrong one is invisible: the pull fetches whatever that
 * id really is, files it under its own name, and says nothing. The list already carries what the
 * team was meant to be — a name, an age group, a season, a town — and the profile carries what it
 * turned out to be, so the two can simply be compared.
 *
 * Which comparisons are worth making was measured against a real pull of 40,760 teams, where the
 * list and the profile were known to be about the same teams. The rule for each is whatever fires
 * on something worth looking at without burying it:
 *
 * | Compared | Disagreed | Kept |
 * | --- | --- | --- |
 * | Name shares no significant word | 1 | yes — and that one was "SWS" for "South Wake Storm" |
 * | Season | 0 | yes — free, and it catches an id reused for last year's squad |
 * | State | 174 (0.43%) | yes |
 * | Age level, by two or more | 31 (0.08%) | yes |
 * | Age level, by one | 343 (0.84%) | **no** — in 267 of them the *name* held the list's level, so it is GameChanger's own age group that wanders, not the id |
 *
 * Nothing is corrected and nothing is held back: the schedule is filed either way, because the
 * profile is the better authority on a team it was asked about by id. This only says which rows
 * to look at.
 */
export const checkPulledTeam = (
  entry: GcTeamListEntry,
  profile: GcTeamProfile
): { reason: string; detail: string } | null => {
  const said: string[] = [];
  const got: string[] = [];
  let different = false;

  if (entry.name && profile.name && !sharesAWord(entry.name, profile.name)) {
    different = true;
    said.push(`“${entry.name}”`);
    got.push(`“${profile.name}”`);
  }
  if (entry.season && profile.season && !sameSeason(entry.season, profile.season)) {
    different = true;
    said.push(formatGcSeason(entry.season));
    got.push(formatGcSeason(profile.season));
  }
  if (entry.state && profile.state && entry.state.toUpperCase() !== profile.state.toUpperCase()) {
    said.push(entry.state.toUpperCase());
    got.push(profile.state.toUpperCase());
  }
  if (
    entry.ageLevel !== undefined &&
    profile.ageLevel !== undefined &&
    Math.abs(entry.ageLevel - profile.ageLevel) >= 2
  ) {
    said.push(`${entry.ageLevel}U`);
    got.push(`${profile.ageLevel}U`);
  }

  if (said.length === 0) return null;
  return {
    reason: different ? "Not the team the list named" : "Not quite the team the list named",
    detail: `The list said ${said.join(", ")}; GameChanger returned ${got.join(", ")}.`,
  };
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
  "check-id": "Check the id",
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
  const count = (kind: GcProblemKind) => problems.filter((problem) => problem.kind === kind).length;
  const notReached = count("not-reached");
  const checkId = count("check-id");
  const notFiled = problems.length - notReached - checkId;
  const parts: string[] = [];
  if (notReached > 0) parts.push(`${notReached} not reached`);
  if (notFiled > 0) parts.push(`${notFiled} could not be filed`);
  if (checkId > 0) parts.push(`${checkId} to check`);
  return parts.join(" · ");
};
