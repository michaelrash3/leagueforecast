import { FIREBASE_WEB_CONFIG } from "../cloud/cloudConfig";
import { functionUrl } from "../cloud/functionsUrl";
import { JOB_ID } from "../cloud/pullJobs";
import { coerceCommand, type PoolCommand } from "./commands";
import type { EditReply, WarmResult } from "./editHandle";
import type { EditRefusal, QueryRefusal } from "./editRun";
import type { AnswerOf, QueryKind, QueryOf } from "./queries";
import { coerceQueryAnswer } from "./queryAnswers";

/**
 * A member's device asking the edit function (`edit`, `functions/src/index.ts`) to make an edit or
 * to bring its pool up; the sections that send them come in 1.5. The callable protocol over
 * `fetch`, with the member's sign-in: Firebase's functions SDK would add a download to the app for
 * the one call, and the protocol is a POST of `{ data }` answered with `{ result }` or `{ error }`.
 *
 * Nothing the server answers is taken on trust: a reply that does not read back as one the function
 * makes is a failure, never half an answer, and an inverse is taken only when it is exactly a
 * command (`coerceCommand`), since it is what the device will send back for an Undo.
 */

/**
 * How long a call is waited on: past the function's own timeout (`EDIT_TIMEOUT_S`, 540 s), by which
 * the function has answered every call it took, made or turned away (`EDIT_CALL_S`), so the device
 * never gives up on an edit the server is still making.
 */
export const CALL_LIMIT_MS = 600_000;

/** The edit function's address for the app's own project. */
export const EDIT_URL = functionUrl(FIREBASE_WEB_CONFIG.projectId, "edit");
export const POOL_QUERY_URL = functionUrl(FIREBASE_WEB_CONFIG.projectId, "poolQuery");

/** `startPull`, which queues the first leg of a pull a member has left for the cloud. */
export const START_PULL_URL = functionUrl(FIREBASE_WEB_CONFIG.projectId, "startPull");

/**
 * Why a call came to nothing the server said.
 * - `signed-out`, `not-member`: who is asking (no sign-in, or an account not on the list).
 * - `invalid`: the server could not read what was sent.
 * - `unavailable`: the sign-in or the list could not be checked just now; try again.
 * - `failed`: the server says the edit was not made (it failed short of saving it, or could not
 *   reach it in time), or, for a warm-up, anything went wrong.
 * - `unanswered`: no answer this device can use, so an edit may or may not have been made, and the
 *   copy says which: the request was lost, or the server failed in a way that does not say, or
 *   answered what this build cannot read.
 *
 * Every other answer of the server's is its reply, or a refusal in it. An edit is only ever said
 * not made where the server said so: anything else may have followed a save that landed.
 */
export type CallFailure =
  "signed-out" | "not-member" | "invalid" | "unavailable" | "failed" | "unanswered";

export type CallDeps = {
  /** The member's sign-in, or null when there is none. */
  token: () => Promise<string | null>;
  url?: string;
  /** A new read endpoint falls back while the preceding server deployment is still live. */
  fallbackUrl?: string;
  fetchImpl?: typeof fetch;
  limitMs?: number;
  /** Safe reads and job starts reconnect with bounded backoff until confirmed. */
  retry?: boolean;
  signal?: AbortSignal;
  onRetry?: (attempt: number) => void;
  retryDelayMs?: (attempt: number) => number;
  /** A capability check waits for an older deployed server to gain the requested capability. */
  retryStatuses?: readonly string[];
  /**
   * Statuses that end the call where it is, though a lost connection would be asked again: for a
   * question or a warm-up, the server having given up on it (`GAVE_UP`).
   */
  finalStatuses?: readonly string[];
};

/**
 * How many times a call that may only have been lost on the way is sent again before its last
 * answer is handed back: with the backoff below, about half a minute of trying. It had no bound
 * until 16 Oct 2026, and a Setup question the server had given up on was sent again for a day.
 */
export const MAX_RECONNECTS = 5;

/**
 * What the edit function answers a question or a warm-up it gave up on (`handleQuery`,
 * `handleWarm`): not answered in its time, or past the call's own. Each try is a cold load of the
 * whole pool on an 8 GiB instance, so asking again at once only spends that again; the card that
 * asked says so and offers to ask again. Asked again on its own on 13 and 14 Oct 2026, it spent
 * October's compute with no rebuild run, and the boards stopped updating for the month.
 */
const GAVE_UP = ["ABORTED", "DEADLINE_EXCEEDED"] as const;

/** A call's outcome: the server's answer, or why there is none, said for a person. */
export type Called<T> = { ok: true; value: T } | { ok: false; why: CallFailure; message: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/**
 * The callable protocol's error statuses the function answers before or instead of an edit, as it
 * throws them (`functions/src/index.ts`): each proves no edit was made. Any other is not taken to.
 */
const FAILURE_OF: ReadonlyMap<string, CallFailure> = new Map([
  ["UNAUTHENTICATED", "signed-out"],
  ["PERMISSION_DENIED", "not-member"],
  ["INVALID_ARGUMENT", "invalid"],
  ["UNAVAILABLE", "unavailable"],
  ["ABORTED", "failed"],
]);

const failed = (why: CallFailure, message: string): Called<never> => ({ ok: false, why, message });

const LOST =
  "The connection was interrupted. Checking the cloud copy will confirm whether the change was saved.";
class RetryableCall extends Error {
  readonly answer: Called<never>;
  constructor(answer: Called<never>) {
    super("Reconnect");
    this.answer = answer;
  }
}
const reconnect = async <T>(work: () => Promise<Called<T>>, deps: CallDeps): Promise<Called<T>> => {
  let attempt = 0;
  for (;;) {
    if (deps.signal?.aborted) return failed("failed", "Request cancelled.");
    try {
      return await work();
    } catch (error) {
      if (!(error instanceof RetryableCall)) throw error;
      if (!deps.retry || attempt >= MAX_RECONNECTS) return error.answer;
      deps.onRetry?.(++attempt);
      const delay =
        deps.retryDelayMs?.(attempt) ?? Math.min(30_000, 1_000 * 2 ** Math.min(attempt - 1, 5));
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          deps.signal?.removeEventListener("abort", finish);
          resolve();
        };
        const timer = setTimeout(finish, delay);
        deps.signal?.addEventListener("abort", finish, { once: true });
        if (deps.signal?.aborted) finish();
      });
    }
  }
};

/**
 * One call: `data` sent with the sign-in, the `result` handed to `read`, or why there is none.
 * `unclear` is what an answer that proves nothing comes to: for an edit, that it may or may not have
 * been made; for a warm-up, that it failed.
 */
const callOnce = async <T>(
  data: unknown,
  read: (result: unknown) => T | null,
  {
    token,
    url = EDIT_URL,
    fetchImpl = fetch,
    limitMs = CALL_LIMIT_MS,
    signal,
    retryStatuses,
    fallbackUrl,
    finalStatuses,
  }: CallDeps,
  unclear: CallFailure,
  failures: ReadonlyMap<string, CallFailure> = FAILURE_OF
): Promise<Called<T>> => {
  let signIn: string | null;
  try {
    signIn = await token();
  } catch {
    // Nothing was sent: an offline device whose sign-in needed renewing, say.
    throw new RetryableCall(failed("unavailable", "Reconnecting to check your sign-in…"));
  }
  if (!signIn) return failed("signed-out", "Sign in to make changes.");
  const lost = unclear === "unanswered" ? LOST : "Reconnecting to the cloud…";
  const abort = new AbortController();
  const cancel = () => abort.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) abort.abort();
  const timer = setTimeout(cancel, limitMs);
  let response: Response;
  let body: unknown;
  try {
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${signIn}` },
        body: JSON.stringify({ data }),
        signal: abort.signal,
      });
      if (response.status === 404 && fallbackUrl)
        response = await fetchImpl(fallbackUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${signIn}` },
          body: JSON.stringify({ data }),
          signal: abort.signal,
        });
    } catch {
      throw new RetryableCall(failed(unclear, lost));
    }
    try {
      body = await response.json();
    } catch {
      // An answer cut off or not the protocol's: whatever the server did, this device cannot say.
      if (
        response.ok ||
        response.status >= 500 ||
        response.status === 429 ||
        response.status === 408
      )
        throw new RetryableCall(failed(unclear, lost));
      return failed(unclear, `The server answered HTTP ${response.status}.`);
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  if (!response.ok || error) {
    const status = typeof error?.status === "string" ? error.status : "";
    const message =
      typeof error?.message === "string" && error.message
        ? error.message
        : `The server answered HTTP ${response.status}.`;
    if (
      !finalStatuses?.includes(status) &&
      (["UNAVAILABLE", "INTERNAL", "ABORTED", "UNKNOWN", "DEADLINE_EXCEEDED"].includes(status) ||
        retryStatuses?.includes(status) ||
        (!status && (response.status >= 500 || response.status === 429 || response.status === 408)))
    ) {
      throw new RetryableCall(failed(failures.get(status) ?? unclear, message));
    }
    return failed(failures.get(status) ?? unclear, message);
  }
  const value = isRecord(body) ? read(body.result) : null;
  return value === null
    ? failed(unclear, "The server's answer is not one this version of the app can read.")
    : { ok: true, value };
};

const call = <T>(
  data: unknown,
  read: (result: unknown) => T | null,
  deps: CallDeps,
  unclear: CallFailure,
  failures?: ReadonlyMap<string, CallFailure>
): Promise<Called<T>> => reconnect(() => callOnce(data, read, deps, unclear, failures), deps);

type EnsureRefusal = Extract<WarmResult, { ok: false }>["reason"];

/** Why the pool could not come up, each named once. */
const ENSURE_REFUSALS: Record<EnsureRefusal, true> = {
  "no-copy": true,
  "newer-schema": true,
  "newer-rules": true,
  "unknown-key": true,
  damaged: true,
  "league-unreadable": true,
  "store-refused": true,
  "kept-moving": true,
};

/** Why a question went unanswered, each named once. */
const QUERY_REFUSALS: Record<QueryRefusal, true> = {
  ...ENSURE_REFUSALS,
  "copy-replaced": true,
  "day-spent": true,
  "month-spent": true,
  "newer-league": true,
};

/** Why an edit was not made, each named once. */
const EDIT_REFUSALS: Record<EditRefusal, true> = {
  ...ENSURE_REFUSALS,
  "newer-league": true,
  "league-kept-live": true,
  logged: true,
  "too-many": true,
  missing: true,
  refused: true,
  unsaved: true,
  "copy-replaced": true,
  unsure: true,
};

/** A time in ms as a reply gives one: any finite number, which a reply clamps at none. */
const isTime = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Whether `value` is one of `names`' keys, its own rather than one every object has. */
const isOneOf = <K extends string>(names: Record<K, true>, value: unknown): value is K =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(names, value);

/** An edit's reply as the function makes one, or null for anything else. */
export const coerceEditReply = (raw: unknown): EditReply | null => {
  if (!isRecord(raw)) return null;
  if (raw.ok === false) return isOneOf(EDIT_REFUSALS, raw.why) ? { ok: false, why: raw.why } : null;
  if (raw.ok !== true) return null;
  const { copy, version, inverse, changed, ms } = raw;
  const command = coerceCommand(inverse);
  if (
    typeof copy !== "string" ||
    !isCount(version) ||
    !Number.isInteger(version) ||
    !command ||
    !Array.isArray(changed) ||
    !changed.every((key) => typeof key === "string") ||
    !isRecord(ms) ||
    !isTime(ms.load) ||
    !isTime(ms.apply) ||
    !isTime(ms.commit)
  ) {
    return null;
  }
  return {
    ok: true,
    copy,
    version,
    inverse: command,
    changed: [...changed],
    // Timings only, so one a server's clock stepped back for reads as none rather than refusing
    // a reply whose edit was made.
    ms: {
      load: Math.max(0, ms.load),
      apply: Math.max(0, ms.apply),
      commit: Math.max(0, ms.commit),
    },
  };
};

/** What a question of kind `K` is answered: its answer, of which copy and version, or why none. */
export type QueryReplyOf<K extends QueryKind> =
  | { ok: true; copy: string; version: number; answer: AnswerOf<K> }
  | { ok: false; why: QueryRefusal };

/** A question's reply as the function makes one, for a question of kind `kind`, or null. */
export const coerceQueryReply = <K extends QueryKind>(
  raw: unknown,
  kind: K
): QueryReplyOf<K> | null => {
  if (!isRecord(raw)) return null;
  if (raw.ok === false)
    return isOneOf(QUERY_REFUSALS, raw.why) ? { ok: false, why: raw.why } : null;
  if (raw.ok !== true) return null;
  const { copy, version } = raw;
  const answer = coerceQueryAnswer(raw.answer, kind);
  return typeof copy === "string" && isCount(version) && Number.isInteger(version) && answer
    ? { ok: true, copy, version, answer }
    : null;
};

/** A warm-up's answer as the function makes one, or null for anything else. */
export const coerceWarmed = (raw: unknown): WarmResult | null => {
  const warmed = isRecord(raw) && isRecord(raw.warmed) ? raw.warmed : null;
  if (!warmed) return null;
  if (warmed.ok === true) {
    const { cold, fetched, loadMs } = warmed;
    return typeof cold === "boolean" && isCount(fetched) && isCount(loadMs)
      ? { ok: true, cold, fetched, loadMs }
      : null;
  }
  return warmed.ok === false && isOneOf(ENSURE_REFUSALS, warmed.reason)
    ? { ok: false, reason: warmed.reason }
    : null;
};

/**
 * Asks the server to run `command` on the copy, as made on `copy` when given. The answer is the
 * server's: the edit made, with its inverse, or why the command was refused. The boards follow a
 * little later, published by the rebuild the save asks for (`REBUILD_WINDOW_S.live`).
 */
export const callEdit = (
  ask: { command: PoolCommand; copy?: string },
  deps: CallDeps
): Promise<Called<EditReply>> =>
  call(
    { command: ask.command, ...(ask.copy === undefined ? {} : { copy: ask.copy }) },
    coerceEditReply,
    { ...deps, retry: false },
    "unanswered"
  );

/** Asks the server to bring its pool up ahead of an edit. */
export const callWarm = (deps: CallDeps): Promise<Called<WarmResult>> =>
  call({ warm: true }, coerceWarmed, { finalStatuses: GAVE_UP, ...deps }, "failed");

/**
 * Asks the server a question about the copy (`queries.ts`), about `copy` when given. It changes
 * nothing, so an answer that never came is only a question to ask again (`failed`).
 */
export const callQuery = <K extends QueryKind>(
  ask: { query: QueryOf<K>; copy?: string },
  deps: CallDeps
): Promise<Called<QueryReplyOf<K>>> =>
  call(
    { query: ask.query, ...(ask.copy === undefined ? {} : { copy: ask.copy }) },
    (result) => coerceQueryReply(result, ask.query.kind),
    {
      url: ask.query.kind.startsWith("year.") ? EDIT_URL : POOL_QUERY_URL,
      fallbackUrl: ask.query.kind.startsWith("year.") || deps.url ? undefined : EDIT_URL,
      finalStatuses: GAVE_UP,
      ...deps,
    },
    "failed"
  );

/**
 * Asks the cloud to start pull `jobId`, which this device has just written (`cloudPulls.ts`). An
 * answer that never came may still have started it: the job's own document says, once read.
 */
/** What `startPull` answers a refresh: its job, its status, and whether it was one under way. */
export type RefreshStart = { status: string; jobId: string; already: boolean };

/**
 * The refusals `startPull` makes of a refresh before starting one, each proving none was started:
 * the nightly pulling (`failed-precondition`), the day's legs spent (`resource-exhausted`), and two
 * presses at once that could not be settled (`aborted`), with those the edit function makes too.
 */
const REFRESH_FAILURES: ReadonlyMap<string, CallFailure> = new Map([
  ...FAILURE_OF,
  ["FAILED_PRECONDITION", "failed"],
  ["RESOURCE_EXHAUSTED", "failed"],
]);

/**
 * Asks `startPull` for "Refresh now" (README, "Refresh now in the cloud"): the server works the
 * teams out and makes the job, and answers with its id, or with the id of the refresh already
 * under way, for this device to watch. A job's id is read exactly, since the device reads the job
 * by it; an answer that does not say which job is no answer, and the refresh may have started.
 */
export const callStartRefresh = (
  ask: { device: string },
  deps: CallDeps
): Promise<Called<RefreshStart>> =>
  call(
    { refresh: ask },
    (result) =>
      isRecord(result) &&
      typeof result.status === "string" &&
      typeof result.jobId === "string" &&
      JOB_ID.test(result.jobId) &&
      typeof result.already === "boolean"
        ? { status: result.status, jobId: result.jobId, already: result.already }
        : null,
    { url: START_PULL_URL, limitMs: 60_000, ...deps },
    "unanswered",
    REFRESH_FAILURES
  );

/**
 * What `startPull` answers a list's start with that proves the pull was not started, beyond what
 * any call does: an error it did not mean to throw (INTERNAL), since nothing it does after queueing
 * the leg can throw, and a job it cannot find (NOT_FOUND). Both were once taken for answers that
 * may have started the pull, which left it "waiting to start" with nothing that would run it.
 */
const START_PULL_FAILURES: ReadonlyMap<string, CallFailure> = new Map([
  ...FAILURE_OF,
  ["INTERNAL", "failed"],
  ["NOT_FOUND", "failed"],
]);

/** Prevent a frontend deployed first from handing staged jobs to the previous leg runner. */
export const callImportReady = (deps: CallDeps): Promise<Called<{ status: string }>> =>
  call(
    { importReady: true },
    (result) =>
      isRecord(result) && result.status === "staged-ready" ? { status: result.status } : null,
    { url: START_PULL_URL, limitMs: 60_000, ...deps, retryStatuses: ["INVALID_ARGUMENT"] },
    "unanswered"
  );

/**
 * Asks `startPull` to queue the first leg of the job `jobId`, which this device wrote. On an ask
 * after the first, `waitedMs` is how long this device has waited for it by its own clock, which
 * the server reads to end a job queued an hour that nothing started (`startPullJob`).
 */
export const callStartPull = (
  jobId: string,
  deps: CallDeps,
  waitedMs?: number,
  resume = false
): Promise<Called<{ status: string }>> =>
  call(
    {
      jobId,
      ...(waitedMs === undefined ? {} : { waited: Math.max(0, Math.round(waitedMs)) }),
      ...(resume ? { resume: true } : {}),
    },
    (result) =>
      isRecord(result) && typeof result.status === "string" ? { status: result.status } : null,
    { url: START_PULL_URL, limitMs: 60_000, ...deps },
    "unanswered",
    START_PULL_FAILURES
  );
