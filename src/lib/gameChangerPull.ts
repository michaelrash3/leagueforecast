/**
 * Keeping track of a pull that is too long to finish in one go.
 *
 * A team list runs to thousands of ids and every one of them is two requests through the proxy, so
 * a full pull is measured in minutes and will meet a closed tab, a reload, a flat battery or
 * GameChanger deciding it has had enough. None of that should cost the work already done.
 *
 * What is remembered is only the cursor: which ids this run was asked for, and which have been
 * settled. The schedules themselves are folded into the pool as they arrive and never held here —
 * keeping a few thousand fetched schedules alongside the pool they were just folded into would
 * double the storage for no gain, and the pool is the thing worth keeping anyway.
 *
 * So resuming is just "the ids that are not settled yet", and a re-run of a finished list is a
 * cheap no-op rather than a second pull.
 */

import { isGcFetchErrorReason, type GcFetchErrorReason } from "./gameChangerApi";
import { isNumber, isRecord, isString } from "./validate";

/** A team that could not be pulled, and why, so the panel can say so and offer a retry. */
export type GcPullFailure = {
  teamId: string;
  reason: GcFetchErrorReason;
  message: string;
};

export type GcPullProgress = {
  /** Every id this run was asked for, in the order they were given. */
  ids: string[];
  /** Ids that have been dealt with — pulled and folded in, or failed for good. */
  settled: string[];
  failures: GcPullFailure[];
  /** ISO timestamps, so the panel can say how old an interrupted run is. */
  startedAt: string;
  updatedAt: string;
};

export const emptyPullProgress = (startedAt: string): GcPullProgress => ({
  ids: [],
  settled: [],
  failures: [],
  startedAt,
  updatedAt: startedAt,
});

/**
 * A run over these ids. An existing run for the same list keeps its place, so reopening the panel
 * and pressing the button again continues rather than starting over; a different list is a new
 * run, because the user has asked for something else.
 */
export const startPull = (
  ids: string[],
  now: string,
  previous?: GcPullProgress | null
): GcPullProgress => {
  const wanted = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
  if (previous && sameList(previous.ids, wanted)) {
    return { ...previous, updatedAt: now };
  }
  return { ...emptyPullProgress(now), ids: wanted };
};

const sameList = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/** The ids still to fetch, in the order they were given. */
export const remainingIds = (progress: GcPullProgress): string[] => {
  const settled = new Set(progress.settled);
  return progress.ids.filter((id) => !settled.has(id));
};

/**
 * Records a team as dealt with. A failure worth retrying is *not* settled — the run should come
 * back to it — so only permanent failures are recorded here alongside the successes; the retrying
 * is `fetchGcTeams`' own business while the run is live, and an id left unsettled is simply picked
 * up again next time.
 */
export const settleTeam = (
  progress: GcPullProgress,
  teamId: string,
  now: string,
  failure?: Omit<GcPullFailure, "teamId">
): GcPullProgress => {
  if (progress.settled.includes(teamId)) return progress;
  return {
    ...progress,
    settled: [...progress.settled, teamId],
    failures: failure
      ? [...progress.failures.filter((entry) => entry.teamId !== teamId), { teamId, ...failure }]
      : progress.failures,
    updatedAt: now,
  };
};

/** Whether every id has been dealt with one way or another. */
export const isPullComplete = (progress: GcPullProgress): boolean =>
  progress.ids.length > 0 && progress.settled.length >= progress.ids.length;

/** Just the failures that another attempt could plausibly fix. */
const RETRYABLE: ReadonlySet<GcFetchErrorReason> = new Set<GcFetchErrorReason>([
  "throttled",
  "network",
  "timeout",
  "upstream-error",
]);

/**
 * Ids worth another go — the ones that failed for a reason a later attempt might not hit. A team
 * that does not exist, or an id that is not one, will fail the same way forever and is left alone.
 */
export const retryableIds = (progress: GcPullProgress): string[] =>
  progress.failures.filter((entry) => RETRYABLE.has(entry.reason)).map((entry) => entry.teamId);

/** Clears the record of the retryable failures so they are fetched again. */
export const retryFailures = (progress: GcPullProgress, now: string): GcPullProgress => {
  const retrying = new Set(retryableIds(progress));
  if (retrying.size === 0) return progress;
  return {
    ...progress,
    settled: progress.settled.filter((id) => !retrying.has(id)),
    failures: progress.failures.filter((entry) => !retrying.has(entry.teamId)),
    updatedAt: now,
  };
};

/** A line for the panel: where the run has got to. */
export const describePull = (progress: GcPullProgress): string => {
  const total = progress.ids.length;
  const done = Math.min(progress.settled.length, total);
  const failed = progress.failures.length;
  if (total === 0) return "Nothing to pull yet.";
  if (done >= total) {
    return `${total} team${total === 1 ? "" : "s"} pulled${
      failed ? `, ${failed} that could not be reached` : ""
    }.`;
  }
  return `${done} of ${total} pulled${failed ? `, ${failed} failed so far` : ""}.`;
};

const coerceFailure = (raw: unknown): GcPullFailure | null => {
  if (!isRecord(raw)) return null;
  if (!isString(raw.teamId) || !raw.teamId) return null;
  if (!isGcFetchErrorReason(raw.reason)) return null;
  return {
    teamId: raw.teamId,
    reason: raw.reason,
    message: isString(raw.message) ? raw.message : "",
  };
};

const strings = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((value): value is string => isString(value) && value !== "") : [];

/**
 * A stored run, re-checked rather than trusted. A run whose shape cannot be read is no run at all,
 * which starts the next pull from the beginning — slower than resuming, and the only safe reading
 * of a cursor nobody can vouch for.
 */
export const coercePullProgress = (raw: unknown): GcPullProgress | null => {
  if (!isRecord(raw)) return null;
  const ids = strings(raw.ids);
  if (ids.length === 0) return null;
  const known = new Set(ids);
  return {
    ids,
    // A settled id that is not in the list means the list changed under the cursor; drop it.
    settled: strings(raw.settled).filter((id) => known.has(id)),
    failures: Array.isArray(raw.failures)
      ? raw.failures
          .map(coerceFailure)
          .filter((entry): entry is GcPullFailure => entry !== null && known.has(entry.teamId))
      : [],
    startedAt: isString(raw.startedAt) ? raw.startedAt : "",
    updatedAt: isString(raw.updatedAt) ? raw.updatedAt : "",
  };
};

/** Progress reported to the panel as a run goes, so it can draw a bar without doing the sums. */
export type GcPullView = {
  done: number;
  total: number;
  failed: number;
  /** 0 to 1, or 0 when there is nothing to do. */
  fraction: number;
};

export const pullView = (progress: GcPullProgress): GcPullView => {
  const total = progress.ids.length;
  const done = Math.min(progress.settled.length, total);
  return {
    done,
    total,
    failed: progress.failures.length,
    fraction: total === 0 ? 0 : done / total,
  };
};

/** Guards the stored shape when something else hands us a number where a count belongs. */
export const isPullProgress = (value: unknown): value is GcPullProgress =>
  isRecord(value) &&
  Array.isArray(value.ids) &&
  Array.isArray(value.settled) &&
  !isNumber(value.ids);
