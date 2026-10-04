import { FIREBASE_WEB_CONFIG } from "../cloud/cloudConfig";
import { functionUrl } from "../cloud/functionsUrl";
import { coerceCommand, type PoolCommand } from "./commands";
import type { EditReply, WarmResult } from "./editHandle";
import type { EditRefusal } from "./editRun";

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
 * How long a call is waited on: past the function's own timeout (`EDIT_TIMEOUT_S`, 540 s), which
 * answers first, so the device never gives up on an edit the server is still making.
 */
export const CALL_LIMIT_MS = 600_000;

/** The edit function's address for the app's own project. */
export const EDIT_URL = functionUrl(FIREBASE_WEB_CONFIG.projectId, "edit");

/**
 * Why a call came to nothing the server said.
 * - `signed-out`, `not-member`: who is asking (no sign-in, or an account not on the list).
 * - `invalid`: the server could not read what was sent.
 * - `unavailable`: the server could not check the list, or is not there; try again.
 * - `failed`: the server failed, or answered what this build cannot read.
 * - `unanswered`: no answer came, so the edit may or may not have been made; the copy says which.
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

type Called<T> = { ok: true; value: T } | { ok: false; why: CallFailure; message: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/** The callable protocol's error statuses, as the function throws them. */
const FAILURE_OF: Record<string, CallFailure> = {
  UNAUTHENTICATED: "signed-out",
  PERMISSION_DENIED: "not-member",
  INVALID_ARGUMENT: "invalid",
  UNAVAILABLE: "unavailable",
};

const failed = (why: CallFailure, message: string): Called<never> => ({ ok: false, why, message });

/** One call: `data` sent with the sign-in, the `result` handed to `read`, or why there is none. */
const call = async <T>(
  data: unknown,
  read: (result: unknown) => T | null,
  { token, url = EDIT_URL, fetchImpl = fetch, limitMs = CALL_LIMIT_MS }: CallDeps
): Promise<Called<T>> => {
  const signIn = await token();
  if (!signIn) return failed("signed-out", "Sign in to make changes.");
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), limitMs);
  let response: Response;
  let body: unknown;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${signIn}` },
      body: JSON.stringify({ data }),
      signal: abort.signal,
    });
    body = await response.json().catch(() => null);
  } catch {
    return failed(
      "unanswered",
      "No answer came from the server, so the change may or may not have been made."
    );
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
    return failed(
      FAILURE_OF[status] ?? (response.status === 503 ? "unavailable" : "failed"),
      message
    );
  }
  const value = isRecord(body) ? read(body.result) : null;
  return value === null
    ? failed("failed", "The server's answer is not one this version of the app can read.")
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

/** Why an edit was not made, each named once. */
const EDIT_REFUSALS: Record<EditRefusal, true> = {
  ...ENSURE_REFUSALS,
  missing: true,
  refused: true,
  unsaved: true,
  "copy-replaced": true,
};

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
    !isCount(ms.load) ||
    !isCount(ms.apply) ||
    !isCount(ms.commit)
  ) {
    return null;
  }
  return {
    ok: true,
    copy,
    version,
    inverse: command,
    changed: [...changed],
    ms: { load: ms.load, apply: ms.apply, commit: ms.commit },
  };
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
    deps
  );

/** Asks the server to bring its pool up ahead of an edit. */
export const callWarm = (deps: CallDeps): Promise<Called<WarmResult>> =>
  call({ warm: true }, coerceWarmed, deps);
