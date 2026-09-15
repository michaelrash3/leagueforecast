/**
 * Browser side of the GameChanger pull.
 *
 * Talks to `/api/gc-team`, the Vercel function that fetches GameChanger's public API on the app's
 * behalf (the browser cannot: GameChanger's CORS only admits web.gc.com). Every failure is
 * reported as data rather than thrown, so the import panel can show one row per team with what
 * happened to it — and `fetchGcTeams` pulls a whole pasted list with a small concurrency cap and
 * retries for the failures that are worth retrying.
 */

import {
  GC_TEAM_ENDPOINT,
  isGcFetchErrorReason,
  type GcFetchDiagnostics,
  type GcFetchErrorReason,
  type GcTeamResponse,
  type GcTeamSchedule,
} from "./gameChangerApi";

export type FetchGcTeamOptions = {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  endpoint?: string;
};

export type GcFetchProgress = {
  done: number;
  total: number;
  teamId: string;
  result: GcTeamResponse;
};

export type FetchGcTeamsOptions = {
  /** Requests in flight at once; four keeps a 2,500-team list moving without tripping throttles. */
  concurrency?: number;
  /** Extra attempts after the first for throttled/network/timeout failures. */
  retries?: number;
  onProgress?: (progress: GcFetchProgress) => void;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** Backoff before retry `attempt` (1-based), in milliseconds. Tests inject a zero delay. */
  delayMs?: (attempt: number) => number;
};

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_RETRIES = 4;
const DEFAULT_BACKOFF_MS = [1_000, 3_000, 8_000, 15_000];

/** Failures that a second try can fix; a missing team or a bad id will fail the same way again. */
const RETRYABLE_REASONS = new Set<GcFetchErrorReason>(["throttled", "network", "timeout"]);

const defaultDelayMs = (attempt: number): number =>
  DEFAULT_BACKOFF_MS[attempt - 1] ?? DEFAULT_BACKOFF_MS[DEFAULT_BACKOFF_MS.length - 1] ?? 3_000;

const UNCONFIGURED_MESSAGE = `${GC_TEAM_ENDPOINT} did not answer with JSON. The GameChanger proxy runs as a Vercel function: deploy the app to Vercel, or run it locally with \`vercel dev\` instead of \`vite\`.`;

const isAbortError = (error: unknown): boolean =>
  (error instanceof DOMException && error.name === "AbortError") ||
  (error instanceof Error && error.name === "AbortError");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Light shape check on a success body, so a half-broken proxy reads as "unrecognized". */
const readSchedule = (value: unknown): GcTeamSchedule | null => {
  if (!isRecord(value)) return null;
  const profile = value.profile;
  const games = value.games;
  if (!isRecord(profile) || typeof profile.id !== "string" || typeof profile.name !== "string") {
    return null;
  }
  if (!Array.isArray(games)) return null;
  return {
    profile: profile as GcTeamSchedule["profile"],
    games: games as GcTeamSchedule["games"],
    fetchedAt: typeof value.fetchedAt === "string" ? value.fetchedAt : new Date().toISOString(),
  };
};

/**
 * One team through the proxy. Never throws: a network failure or an abort comes back as
 * `reason: "network"`, and a 200 that is not JSON — `vite dev` serving index.html for the
 * unknown path — as `reason: "unconfigured"`, which is the cue that the function is not
 * deployed rather than that GameChanger is down.
 */
/**
 * One team's answer, as the proxy states it, turned into a result. Shared by the single-team call
 * and the batch, so both read a failure exactly the same way.
 */
const readTeamResult = (payload: unknown, endpoint: string, status?: number): GcTeamResponse => {
  if (!isRecord(payload)) {
    return {
      ok: false,
      reason: "unrecognized",
      message: `${endpoint} answered with something that is not a result.`,
      ...(status === undefined ? {} : { status }),
    };
  }
  if (payload.ok === true) {
    const schedule = readSchedule(payload.schedule);
    if (!schedule) {
      return {
        ok: false,
        reason: "unrecognized",
        message: `${endpoint} answered ok but without a readable schedule.`,
        ...(status === undefined ? {} : { status }),
      };
    }
    return { ok: true, schedule };
  }
  const reason = isGcFetchErrorReason(payload.reason) ? payload.reason : "upstream-error";
  const failure: Extract<GcTeamResponse, { ok: false }> = {
    ok: false,
    reason,
    message:
      typeof payload.message === "string" && payload.message
        ? payload.message
        : `${endpoint} failed${status === undefined ? "" : ` (HTTP ${status})`}.`,
    ...(typeof payload.status === "number"
      ? { status: payload.status }
      : status === undefined
        ? {}
        : { status }),
  };
  if (isRecord(payload.diagnostics)) {
    failure.diagnostics = payload.diagnostics as GcFetchDiagnostics;
  }
  return failure;
};

export const fetchGcTeam = async (
  teamId: string,
  { fetchImpl = fetch, signal, endpoint = GC_TEAM_ENDPOINT }: FetchGcTeamOptions = {}
): Promise<GcTeamResponse> => {
  try {
    const response = await fetchImpl(`${endpoint}?id=${encodeURIComponent(teamId)}`, {
      method: "GET",
      headers: { accept: "application/json" },
      signal,
    });

    const payload: unknown = await response.json().catch(() => null);

    if (!isRecord(payload)) {
      // The app shell (a 200 HTML page) or a static host's 404: nothing is serving the endpoint.
      if (response.status === 404 || (response.status >= 200 && response.status < 300)) {
        return {
          ok: false,
          reason: "unconfigured",
          message: UNCONFIGURED_MESSAGE,
          status: response.status,
        };
      }
      return {
        ok: false,
        reason: "upstream-error",
        message: `${endpoint} failed (HTTP ${response.status}) without a JSON body.`,
        status: response.status,
      };
    }

    return readTeamResult(payload, endpoint, response.status);
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) {
      return { ok: false, reason: "network", message: "GameChanger pull cancelled." };
    }
    return {
      ok: false,
      reason: "network",
      message: error instanceof Error ? error.message : "GameChanger pull failed.",
    };
  }
};

/** A sleep that ends early on abort, so "Stop" does not wait out a backoff. */
const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (ms <= 0 || signal?.aborted) {
      resolve();
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener("abort", finish, { once: true });
  });

/**
 * How long GameChanger asked us to wait, when it said so.
 *
 * `Retry-After` is either a number of seconds or an HTTP date. Capped, because a pull should slow
 * down rather than stop for an hour, and a nonsense value should not strand the run.
 */
/** Teams asked for in one request. Must not exceed what the proxy is willing to take. */
const BATCH_SIZE = 10;

/**
 * A batch of teams in one request.
 *
 * A browser holds only a handful of connections open to one host at a time, so asking for a team
 * per request caps a pull at that handful no matter how many workers are running — which on a
 * list of several thousand is most of the wait. Ten to a request lifts that ceiling without asking
 * GameChanger for anything more than before: the proxy fetches the same two pages per team, just
 * without a round trip of its own for each one.
 *
 * A failure that is about the request rather than a team — the endpoint missing, the proxy
 * throttling, the connection dropping — is handed back for every team in the batch, so each one
 * retries as it would have on its own.
 */
const fetchGcTeamBatch = async (
  teamIds: readonly string[],
  { fetchImpl = fetch, signal, endpoint = GC_TEAM_ENDPOINT }: FetchGcTeamOptions = {}
): Promise<Map<string, GcTeamResponse>> => {
  const results = new Map<string, GcTeamResponse>();
  const forAll = (failure: GcTeamResponse) => {
    teamIds.forEach((teamId) => results.set(teamId, failure));
    return results;
  };

  try {
    const query = teamIds.map((teamId) => encodeURIComponent(teamId)).join(",");
    const response = await fetchImpl(`${endpoint}?ids=${query}`, {
      method: "GET",
      headers: { accept: "application/json" },
      signal,
    });
    const payload: unknown = await response.json().catch(() => null);

    if (!isRecord(payload)) {
      if (response.status === 404 || (response.status >= 200 && response.status < 300)) {
        return forAll({
          ok: false,
          reason: "unconfigured",
          message: UNCONFIGURED_MESSAGE,
          status: response.status,
        });
      }
      return forAll({
        ok: false,
        reason: "upstream-error",
        message: `${endpoint} failed (HTTP ${response.status}) without a JSON body.`,
        status: response.status,
      });
    }

    // A failure for the request as a whole: the proxy's own throttle, a bad id list, a 5xx.
    if (payload.ok !== true || !Array.isArray(payload.teams)) {
      const reason = isGcFetchErrorReason(payload.reason) ? payload.reason : "upstream-error";
      const message = typeof payload.message === "string" ? payload.message : `${endpoint} failed.`;
      return forAll({
        ok: false,
        reason,
        message,
        ...(typeof payload.status === "number" ? { status: payload.status } : {}),
        ...(isRecord(payload.diagnostics) ? { diagnostics: payload.diagnostics } : {}),
      });
    }

    payload.teams.forEach((entry) => {
      if (!isRecord(entry) || typeof entry.teamId !== "string") return;
      results.set(entry.teamId, readTeamResult(entry.result, endpoint));
    });

    // A team the answer said nothing about is a failure for that team, not for the batch.
    teamIds.forEach((teamId) => {
      if (results.has(teamId)) return;
      results.set(teamId, {
        ok: false,
        reason: "unrecognized",
        message: `${endpoint} answered without a result for ${teamId}.`,
      });
    });
    return results;
  } catch (error) {
    if (isAbortError(error)) {
      return forAll({ ok: false, reason: "network", message: "GameChanger pull cancelled." });
    }
    return forAll({
      ok: false,
      reason: "network",
      message: error instanceof Error ? error.message : "GameChanger pull failed.",
    });
  }
};

const RETRY_AFTER_CAP_MS = 60_000;

const retryAfterMs = (result: GcTeamResponse): number | undefined => {
  const raw = result.ok ? undefined : result.diagnostics?.retryAfter;
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, RETRY_AFTER_CAP_MS);
  }
  const at = Date.parse(raw);
  if (!Number.isFinite(at)) return undefined;
  return Math.min(Math.max(at - Date.now(), 0), RETRY_AFTER_CAP_MS);
};

/**
 * A pause the whole pull shares.
 *
 * Backing off one request at a time does nothing when eight are in flight: the other seven carry
 * on at full rate, GameChanger goes on throttling, and the retries are spent against a service
 * that is still being hammered — so teams that only needed a breather are reported as failures.
 *
 * When any request is throttled, every worker holds off until the same moment, for as long as
 * GameChanger asked for. That keeps the pull fast while it is welcome and slows all of it at once
 * when it is not.
 */
type Brake = {
  /** Waits out any hold currently in force. */
  wait: (signal?: AbortSignal) => Promise<void>;
  /** Holds every worker off for at least this long. */
  hold: (ms: number) => void;
};

const createBrake = (): Brake => {
  let until = 0;
  return {
    wait: (signal) => {
      const remaining = until - Date.now();
      return remaining > 0 ? sleep(remaining, signal) : Promise.resolve();
    },
    hold: (ms) => {
      if (ms > 0) until = Math.max(until, Date.now() + ms);
    },
  };
};

/**
 * A batch, retried as a batch. Only the teams still failing for a reason another try could fix go
 * round again, so one stubborn team does not drag the nine beside it through every attempt.
 */
const fetchBatchWithRetries = async (
  teamIds: readonly string[],
  retries: number,
  delayMs: (attempt: number) => number,
  options: FetchGcTeamOptions,
  brake: Brake
): Promise<Map<string, GcTeamResponse>> => {
  const settled = new Map<string, GcTeamResponse>();
  let pending = [...teamIds];

  // The wait before the next attempt, worked out when this one fails so the backoff is asked for
  // once per attempt whether it is used to hold this worker, the whole pull, or both.
  let backoff = 0;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (pending.length === 0 || options.signal?.aborted) break;
    if (attempt > 0) {
      await sleep(backoff, options.signal);
      if (options.signal?.aborted) break;
    }
    await brake.wait(options.signal);
    if (options.signal?.aborted) break;

    const answers = await fetchGcTeamBatch(pending, options);
    const again: string[] = [];
    let throttled = false;
    pending.forEach((teamId) => {
      const result = answers.get(teamId);
      if (!result) return;
      settled.set(teamId, result);
      if (result.ok || !RETRYABLE_REASONS.has(result.reason)) return;
      again.push(teamId);
      if (result.reason === "throttled") throttled = true;
    });
    pending = again;
    if (pending.length === 0) break;

    // Only while there is another attempt to come: asking past the last one would count a
    // backoff that is never waited out.
    if (attempt < retries) backoff = delayMs(attempt + 1);
    /*
     * A throttled answer is about the pull, not this batch, so it holds every worker — including
     * after the last attempt, so the batch behind this one does not walk straight into it.
     */
    if (throttled) {
      const asked = answers.get(again[0]!);
      brake.hold((asked && retryAfterMs(asked)) ?? backoff);
    }
  }
  return settled;
};

/**
 * Pulls a list of teams, a few at a time, and returns one result per distinct id in the order the
 * ids were given (however the requests actually finished). Only throttled, network and timeout
 * failures are retried, with a backoff between attempts; a not-found or blocked answer is final.
 * Aborting stops new requests: ids never started are left out of the map, and any request in
 * flight comes back as a cancelled "network" failure.
 */
export const fetchGcTeams = async (
  teamIds: string[],
  {
    concurrency = DEFAULT_CONCURRENCY,
    retries = DEFAULT_RETRIES,
    onProgress,
    fetchImpl,
    signal,
    delayMs = defaultDelayMs,
  }: FetchGcTeamsOptions = {}
): Promise<Map<string, GcTeamResponse>> => {
  const ids = Array.from(new Set(teamIds.map((id) => id.trim()).filter(Boolean)));
  const settled = new Map<string, GcTeamResponse>();
  const total = ids.length;
  const perTeam: FetchGcTeamOptions = {
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(signal ? { signal } : {}),
  };
  const attempts = Math.max(0, Math.floor(retries));
  const brake = createBrake();
  let next = 0;
  let done = 0;

  const worker = async (): Promise<void> => {
    while (!signal?.aborted) {
      const from = next;
      next += BATCH_SIZE;
      const chunk = ids.slice(from, from + BATCH_SIZE);
      if (chunk.length === 0) return;
      const answers = await fetchBatchWithRetries(chunk, attempts, delayMs, perTeam, brake);
      // Reported one at a time, in the order asked for: the caller folds each schedule in as it
      // lands and has no reason to know the requests were grouped.
      for (const teamId of chunk) {
        const result = answers.get(teamId);
        if (!result) continue;
        settled.set(teamId, result);
        done += 1;
        onProgress?.({ done, total, teamId, result });
      }
    }
  };

  const batches = Math.ceil(total / BATCH_SIZE);
  const workers = Math.max(1, Math.min(Math.floor(concurrency) || 1, batches));
  await Promise.all(Array.from({ length: workers }, () => worker()));

  // Rebuilt in input order: a Map remembers insertion order, and requests finish in any order.
  const results = new Map<string, GcTeamResponse>();
  for (const teamId of ids) {
    const result = settled.get(teamId);
    if (result) results.set(teamId, result);
  }
  return results;
};
