/**
 * The reasons a GameChanger fetch can fail, as a pull records them.
 *
 * Split out of `gameChangerApi.ts`, which re-exports them, because the pool's store reads a saved
 * pull's reasons back (`coercePullProgress`) and loads at start, and the rest of that file only
 * Team Rankings runs.
 */

export type GcFetchErrorReason =
  | "invalid-id"
  | "not-found"
  | "blocked"
  | "throttled"
  | "upstream-error"
  | "unrecognized"
  | "network"
  | "unconfigured"
  | "timeout"
  /** The proxy is for the cloud copy's list, and this browser is not signed in with an account on it. */
  | "members-only";

export const GC_FETCH_ERROR_REASONS: readonly GcFetchErrorReason[] = [
  "invalid-id",
  "not-found",
  "blocked",
  "throttled",
  "upstream-error",
  "unrecognized",
  "network",
  "unconfigured",
  "timeout",
  "members-only",
];

export const isGcFetchErrorReason = (value: unknown): value is GcFetchErrorReason =>
  typeof value === "string" && (GC_FETCH_ERROR_REASONS as readonly string[]).includes(value);
