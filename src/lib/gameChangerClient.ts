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
const DEFAULT_RETRIES = 2;
const DEFAULT_BACKOFF_MS = [1_000, 3_000];

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

    if (payload.ok === true) {
      const schedule = readSchedule(payload.schedule);
      if (!schedule) {
        return {
          ok: false,
          reason: "unrecognized",
          message: `${endpoint} answered ok but without a readable schedule.`,
          status: response.status,
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
          : `${endpoint} failed (HTTP ${response.status}).`,
      status: typeof payload.status === "number" ? payload.status : response.status,
    };
    if (isRecord(payload.diagnostics)) {
      failure.diagnostics = payload.diagnostics as GcFetchDiagnostics;
    }
    return failure;
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

const fetchWithRetries = async (
  teamId: string,
  retries: number,
  delayMs: (attempt: number) => number,
  options: FetchGcTeamOptions
): Promise<GcTeamResponse> => {
  let result = await fetchGcTeam(teamId, options);
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    if (result.ok || !RETRYABLE_REASONS.has(result.reason) || options.signal?.aborted) break;
    await sleep(delayMs(attempt), options.signal);
    if (options.signal?.aborted) break;
    result = await fetchGcTeam(teamId, options);
  }
  return result;
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
  let next = 0;
  let done = 0;

  const worker = async (): Promise<void> => {
    while (!signal?.aborted) {
      const index = next;
      next += 1;
      const teamId = ids[index];
      if (teamId === undefined) return;
      const result = await fetchWithRetries(teamId, attempts, delayMs, perTeam);
      settled.set(teamId, result);
      done += 1;
      onProgress?.({ done, total, teamId, result });
    }
  };

  const workers = Math.max(1, Math.min(Math.floor(concurrency) || 1, total));
  await Promise.all(Array.from({ length: workers }, () => worker()));

  // Rebuilt in input order: a Map remembers insertion order, and requests finish in any order.
  const results = new Map<string, GcTeamResponse>();
  for (const teamId of ids) {
    const result = settled.get(teamId);
    if (result) results.set(teamId, result);
  }
  return results;
};
