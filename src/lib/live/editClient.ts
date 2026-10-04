import { FIREBASE_WEB_CONFIG } from "../cloud/cloudConfig";
import { functionUrl } from "../cloud/functionsUrl";
import { coerceCommand, type PoolCommand } from "./commands";
import type { EditReply, WarmResult } from "./editHandle";
import type { EditRefusal, QueryRefusal } from "./editRun";
import { coerceQueryAnswer, type PoolQuery, type QueryAnswers, type QueryKind } from "./queries";

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
  fetchImpl?: typeof fetch;
  limitMs?: number;
};

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

const LOST = "No answer came from the server, so the change may or may not have been made.";

/**
 * One call: `data` sent with the sign-in, the `result` handed to `read`, or why there is none.
 * `unclear` is what an answer that proves nothing comes to: for an edit, that it may or may not have
 * been made; for a warm-up, that it failed.
 */
const call = async <T>(
  data: unknown,
  read: (result: unknown) => T | null,
  { token, url = EDIT_URL, fetchImpl = fetch, limitMs = CALL_LIMIT_MS }: CallDeps,
  unclear: CallFailure
): Promise<Called<T>> => {
  let signIn: string | null;
  try {
    signIn = await token();
  } catch {
    // Nothing was sent: an offline device whose sign-in needed renewing, say.
    return failed(
      "unavailable",
      "Your sign-in could not be checked just now. Try again in a minute."
    );
  }
  if (!signIn) return failed("signed-out", "Sign in to make changes.");
  const lost = unclear === "unanswered" ? LOST : "No answer came from the server.";
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), limitMs);
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
    } catch {
      return failed(unclear, lost);
    }
    try {
      body = await response.json();
    } catch {
      // An answer cut off or not the protocol's: whatever the server did, this device cannot say.
      return failed(unclear, response.ok ? lost : `The server answered HTTP ${response.status}.`);
    }
  } finally {
    clearTimeout(timer);
  }
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  if (!response.ok || error) {
    const status = typeof error?.status === "string" ? error.status : "";
    const message =
      typeof error?.message === "string" && error.message
        ? error.message
        : `The server answered HTTP ${response.status}.`;
    return failed(FAILURE_OF.get(status) ?? unclear, message);
  }
  const value = isRecord(body) ? read(body.result) : null;
  return value === null
    ? failed(unclear, "The server's answer is not one this version of the app can read.")
    : { ok: true, value };
};

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
const QUERY_REFUSALS: Record<QueryRefusal, true> = { ...ENSURE_REFUSALS, "copy-replaced": true };

/** Why an edit was not made, each named once. */
const EDIT_REFUSALS: Record<EditRefusal, true> = {
  ...ENSURE_REFUSALS,
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
  | { ok: true; copy: string; version: number; answer: { kind: K } & QueryAnswers[K] }
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
    deps,
    "unanswered"
  );

/** Asks the server to bring its pool up ahead of an edit. */
export const callWarm = (deps: CallDeps): Promise<Called<WarmResult>> =>
  call({ warm: true }, coerceWarmed, deps, "failed");

/**
 * Asks the server a question about the copy (`queries.ts`), about `copy` when given. It changes
 * nothing, so an answer that never came is only a question to ask again (`failed`).
 */
export const callQuery = <K extends QueryKind>(
  ask: { query: PoolQuery & { kind: K }; copy?: string },
  deps: CallDeps
): Promise<Called<QueryReplyOf<K>>> =>
  call(
    { query: ask.query, ...(ask.copy === undefined ? {} : { copy: ask.copy }) },
    (result) => coerceQueryReply(result, ask.query.kind),
    deps,
    "failed"
  );
