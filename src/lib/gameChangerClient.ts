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
  /**
   * How many attempts this id took, counting the one that produced `result`.
   *
   * Reported because `onProgress` fires once, with the final answer, so every retry behind it was
   * invisible: a run where the backoff rescued four thousand teams read exactly like one where
   * nothing ever failed.
   */
  attempts: number;
  /** What went wrong the first time, when it did and a later attempt got through. */
  firstFailure?: GcFetchErrorReason;
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
  /**
   * Called once if the run gave up because GameChanger refused the route. The ids not reported are
   * deliberately left unsettled, so the caller's cursor keeps them and a resume asks for them
   * again rather than writing them off.
   */
  onRefused?: (refusals: number) => void;
  /**
   * How long a refusal holds every worker off, in milliseconds. Injectable for the same reason
   * `delayMs` is: a test should not have to wait out a real one to prove the counting works.
   */
  refusedHoldMs?: number;
  /**
   * Every pause the whole pull took, and what asked for it.
   *
   * Time spent held is the difference between "GameChanger was slow" and "we were waiting on
   * purpose", and an hour-long run cannot be read afterwards without it. Nothing here depends on
   * anyone listening.
   */
  onHold?: (ms: number, source: GcHoldSource) => void;
  /**
   * Every blocked answer, including the ones the give-up suppresses. The suppression is what keeps
   * a WAF from writing off the list, and it also means the reported failures understate how much
   * of the run was refused.
   */
  onBlocked?: () => void;
  /**
   * An id deliberately left unsettled after the give-up. It is not a failure — a resume asks for
   * it again — but it is also not in the pool, and nothing else records that it exists.
   */
  onSuppressed?: (teamId: string) => void;
  /**
   * Workers to grow to while nothing pushes back. Absent or lower than `concurrency` means no
   * growth, which is what every caller got before this existed.
   *
   * The fixed pool was the ceiling on a long pull, and it was set where it was because nobody knew
   * what the route would take. Eight workers of ten teams, at a second or two a batch, is around
   * two thousand teams a minute however fast the fetching itself could go — so a hundred thousand
   * teams is the better part of an hour, and the number was a guess either way.
   *
   * Rather than a bigger guess, this one asks. It starts where it always did and adds a worker for
   * every `RAMP_AFTER_CLEAN_BATCHES` batches that come back without a hold; the first hold of any
   * kind, from GameChanger's own throttle or from a refused route, stops it growing for the rest
   * of the run. Pushback is therefore paid for once, and slowly, instead of being discovered by a
   * pull that opened at full throttle and got itself blocked.
   */
  maxConcurrency?: number;
  /** Told whenever the pool grows, so a run can show what it settled at. */
  onConcurrency?: (workers: number) => void;
};

/** Who asked for a hold: GameChanger naming a wait, our own ladder, or a refused route. */
export type GcHoldSource = "retry-after" | "backoff" | "refused";

const DEFAULT_CONCURRENCY = 4;
/**
 * Clean batches between one extra worker and the next.
 *
 * A batch is a second or two, so at eight workers this steps up about every three seconds — quick
 * enough to be at the ceiling inside a minute, slow enough that a route which is going to push
 * back has said so before the pull is leaning on it.
 */
const RAMP_AFTER_CLEAN_BATCHES = 10;
const DEFAULT_RETRIES = 4;
const DEFAULT_BACKOFF_MS = [1_000, 3_000, 8_000, 15_000];

/**
 * Refusals a run tolerates before it gives up on the route.
 *
 * One is not enough to condemn a deployment — a WAF challenge can fire on a single request and
 * never again — but a real block is continuous, so the third one arrives within seconds of the
 * first. Set low on purpose: the cost of stopping early is one resume, and the cost of carrying on
 * is every remaining id recorded as a permanent failure that no resume will retry.
 */
export const MAX_REFUSALS = 3;

/** How long every worker is held off after a refusal, while the count decides whether to stop. */
export const DEFAULT_REFUSED_HOLD_MS = 5_000;

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
  const rowIds = Array.isArray(value.rowIds)
    ? value.rowIds.filter((id): id is string => typeof id === "string")
    : undefined;
  return {
    profile: profile as GcTeamSchedule["profile"],
    games: games as GcTeamSchedule["games"],
    fetchedAt: typeof value.fetchedAt === "string" ? value.fetchedAt : new Date().toISOString(),
    ...(rowIds ? { rowIds } : {}),
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
/** Ids per request, both sides: the proxy truncates anything longer. */
export const BATCH_SIZE = 10;

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
  /** Holds every worker off for at least this long, and says who asked. */
  hold: (ms: number, source: GcHoldSource) => void;
  /** Records a refusal that is about the route rather than the team. */
  refuse: () => void;
  /** How many of those this run has seen. */
  refusals: () => number;
};

const createBrake = (onHold?: (ms: number, source: GcHoldSource) => void): Brake => {
  let until = 0;
  let refused = 0;
  return {
    wait: (signal) => {
      const remaining = until - Date.now();
      return remaining > 0 ? sleep(remaining, signal) : Promise.resolve();
    },
    hold: (ms, source) => {
      if (ms <= 0) return;
      until = Math.max(until, Date.now() + ms);
      // Reported as asked for rather than as waited out: a hold that overlaps one already in force
      // costs nothing, and the caller wants to know what the pull was told, not what it slept.
      onHold?.(ms, source);
    },
    refuse: () => {
      refused += 1;
    },
    refusals: () => refused,
  };
};

/**
 * A batch, retried as a batch. Only the teams still failing for a reason another try could fix go
 * round again, so one stubborn team does not drag the nine beside it through every attempt.
 */
export type GcBatchAnswer = {
  result: GcTeamResponse;
  /** Attempts this id took, counting the one that produced `result`. */
  attempts: number;
  /** What went wrong the first time, when something did. */
  firstFailure?: GcFetchErrorReason;
};

const fetchBatchWithRetries = async (
  teamIds: readonly string[],
  retries: number,
  delayMs: (attempt: number) => number,
  options: FetchGcTeamOptions,
  brake: Brake,
  refusedHoldMs: number,
  onBlocked?: () => void
): Promise<Map<string, GcBatchAnswer>> => {
  const settled = new Map<string, GcBatchAnswer>();
  /** The reason an id failed on first contact, kept so a rescue by retry can be counted. */
  const firstFailures = new Map<string, GcFetchErrorReason>();
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
      if (!result.ok && !firstFailures.has(teamId)) firstFailures.set(teamId, result.reason);
      settled.set(teamId, {
        result,
        attempts: attempt + 1,
        ...(firstFailures.has(teamId) && result.ok
          ? { firstFailure: firstFailures.get(teamId) }
          : {}),
      });
      if (result.ok) return;
      /*
       * A refusal is about the route, not the team: GameChanger's WAF turns away the server, and
       * every other id in the list is behind the same server. Retrying it is pointless — no
       * backoff produces the token a browser would have — but letting it through untouched was
       * worse, because nothing slowed down and nothing counted it, so the workers accelerated
       * through the rest of the list turning each id into a permanent failure.
       */
      if (result.reason === "blocked") {
        onBlocked?.();
        brake.refuse();
        brake.hold(refusedHoldMs, "refused");
        return;
      }
      if (!RETRYABLE_REASONS.has(result.reason)) return;
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
      /*
       * The Retry-After off the team that was actually throttled. Reading it from the first
       * still-pending id instead meant a batch whose failures were mixed — one throttled, one
       * timed out — asked the timed-out team how long to wait, got nothing, and fell back to the
       * local ladder while GameChanger had named a figure.
       */
      const asked = again
        .map((teamId) => answers.get(teamId))
        .find((answer) => answer && !answer.ok && answer.reason === "throttled");
      const named = asked && retryAfterMs(asked);
      brake.hold(named ?? backoff, named === undefined ? "backoff" : "retry-after");
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
    onRefused,
    refusedHoldMs = DEFAULT_REFUSED_HOLD_MS,
    onHold,
    onBlocked,
    onSuppressed,
    maxConcurrency,
    onConcurrency,
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
  /*
   * Holds are counted here as well as reported, because the ramp below needs to know whether the
   * route has pushed back at all — and a hold is the only warning that comes before a refusal.
   */
  let holds = 0;
  const brake = createBrake((ms, source) => {
    holds += 1;
    onHold?.(ms, source);
  });
  let next = 0;
  let done = 0;

  /** Set once the route is refused often enough that carrying on only destroys the list. */
  let givenUp = false;
  /*
   * The ramp's own state. `frozen` latches on the first hold of any kind and never clears: a route
   * that has pushed back once is not one to lean on harder, and a run that crept up to a ceiling
   * and then got itself blocked is worse than a run that stayed where it started.
   */
  let clean = 0;
  let frozen = false;
  /** Filled in below, once the pool it grows exists. */
  let grow = (): void => {};

  const worker = async (): Promise<void> => {
    while (!signal?.aborted && !givenUp) {
      const from = next;
      next += BATCH_SIZE;
      const chunk = ids.slice(from, from + BATCH_SIZE);
      if (chunk.length === 0) return;
      const answers = await fetchBatchWithRetries(
        chunk,
        attempts,
        delayMs,
        perTeam,
        brake,
        refusedHoldMs,
        onBlocked
      );
      // Either kind of pushback freezes it: a refusal counts even when it asked for no wait.
      if (holds > 0 || brake.refusals() > 0) frozen = true;
      if (!frozen) {
        clean += 1;
        if (clean >= RAMP_AFTER_CLEAN_BATCHES) {
          clean = 0;
          grow();
        }
      }
      const refused = brake.refusals() > MAX_REFUSALS;
      if (refused && !givenUp) {
        givenUp = true;
        onRefused?.(brake.refusals());
      }
      // Reported one at a time, in the order asked for: the caller folds each schedule in as it
      // lands and has no reason to know the requests were grouped.
      for (const teamId of chunk) {
        const answer = answers.get(teamId);
        if (!answer) continue;
        const result = answer.result;
        /*
         * Once the route is refused, a refusal is not news about this team and must not be
         * reported as one. The caller settles whatever it is told about, and a settled id is one a
         * resume skips — so reporting these would write off the rest of the list on the way out.
         * What did come back is still handed over: those schedules were fetched and paid for.
         */
        if (refused && !result.ok && result.reason === "blocked") {
          onSuppressed?.(teamId);
          continue;
        }
        settled.set(teamId, result);
        done += 1;
        onProgress?.({
          done,
          total,
          teamId,
          result,
          attempts: answer.attempts,
          ...(answer.firstFailure ? { firstFailure: answer.firstFailure } : {}),
        });
      }
    }
  };

  const batches = Math.ceil(total / BATCH_SIZE);
  const floor = Math.max(1, Math.min(Math.floor(concurrency) || 1, batches));
  const ceiling = Math.max(floor, Math.min(Math.floor(maxConcurrency ?? floor), batches));
  /*
   * Grown by index rather than gathered with `Promise.all`, because the pool is allowed to get
   * bigger after it has started and a snapshot of it would not wait for the ones added later.
   * Walking the array by index drains whatever is in it by the time the walk reaches that slot.
   */
  const running: Array<Promise<void>> = [];
  const spawn = () => {
    running.push(worker());
    if (running.length > floor) onConcurrency?.(running.length);
  };
  grow = () => {
    if (running.length < ceiling) spawn();
  };
  for (let at = 0; at < floor; at += 1) spawn();
  for (let at = 0; at < running.length; at += 1) await running[at];

  // Rebuilt in input order: a Map remembers insertion order, and requests finish in any order.
  const results = new Map<string, GcTeamResponse>();
  for (const teamId of ids) {
    const result = settled.get(teamId);
    if (result) results.set(teamId, result);
  }
  return results;
};
