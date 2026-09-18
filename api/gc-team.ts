/**
 * GET /api/gc-team?id=<teamId> — one GameChanger team's public profile and schedule.
 *
 * Runs as a Vercel Serverless Function because GameChanger's public API only answers browsers on
 * web.gc.com (its CORS allows nothing else), so the app's own origin has to ask from a server.
 * Nothing here is secret: the upstream endpoints need no login. The function's job is to look
 * like the schedule page (the `Accept` versions, `gc-app-name`, origin and referer that page
 * sends), fetch the two JSON bodies in parallel, and hand back one normalized `GcTeamResponse`.
 *
 * Every failure is a non-200 with the same `ok: false` shape and a machine-readable `reason`, so
 * the import panel can say precisely what went wrong: an id that does not exist, GameChanger
 * throttling, an AWS WAF challenge (the browser sent a WAF token; a server may be challenged
 * too), or a payload this code does not recognise — in which case the diagnostics carry enough of
 * the body to fix the normalizer without a debugger.
 *
 * Env: `GC_API_BASE` overrides the upstream host (a mirror or a local recorder), `GC_EXTRA_HEADERS`
 * is a JSON object merged into every upstream request (the escape hatch if the WAF demands a
 * token), and `GC_TOKEN` is sent as a `gc-token` header.
 */

import {
  GC_GAMES_ACCEPT,
  GC_PROFILE_ACCEPT,
  GC_PUBLIC_API_BASE,
  gcGamesApiUrl,
  gcProfileApiUrl,
  gcGameListFrom,
  normalizeGcGames,
  normalizeGcTeamProfile,
  parseGcTeamId,
  type GcFetchDiagnostics,
  type GcFetchErrorReason,
  type GcGame,
  type GcTeamProfile,
  type GcTeamResponse,
} from "../src/lib/gameChangerApi.js";
import { createTtlCache } from "../src/lib/ttlCache.js";
import {
  clientKey,
  createRateLimiter,
  type ApiRequest,
  type ApiResponse,
} from "../src/lib/apiShared.js";

/**
 * The one Node global this function needs. Declared here rather than via `@types/node`: installing
 * that package also changes global timer typings for the browser project, and Vercel type-checks
 * this entrypoint with its own config, which would not pick up a sibling declaration file.
 */
declare const process: { env: Record<string, string | undefined> };

/** The error half of `GcTeamResponse`, spelled out so the non-strict Vercel check narrows it. */
type GcTeamFailure = {
  ok: false;
  reason: GcFetchErrorReason;
  message: string;
  status?: number;
  diagnostics?: GcFetchDiagnostics;
};

const UPSTREAM_TIMEOUT_MS = 8_000;
/** How much of an unrecognised body to echo back: enough to see what it is, never the whole page. */
const BODY_PREVIEW_CHARS = 300;

/**
 * This cap is here to stop a runaway loop, and it has to stay well clear of what the feature
 * actually does or it becomes the thing that breaks it.
 *
 * It was set at 240 a minute when the panel pulled four teams at a time. A nationwide list is
 * thousands of teams pulled eight at a time, which is something like twenty a second — so the
 * import spent its life tripping this app's own limiter, reported the refusals as failed teams,
 * and was held to 240 teams a minute whatever else was tuned. That is a cap of half an hour on a
 * seven-thousand team list, and none of it was GameChanger's doing.
 *
 * GameChanger's own limits are the real ceiling. Those come back as "throttled" with a
 * Retry-After, and the client now holds the whole pull back when it sees one.
 */
const RATE_LIMIT_MAX_REQUESTS = 3_000;

/** What web.gc.com sends; GameChanger's WAF is happier with a request that looks like the page. */
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const WEB_ORIGIN = "https://web.gc.com";

/** GameChanger's own limits are the real ceiling; this only stops a runaway loop. */
const isRateLimited = createRateLimiter(RATE_LIMIT_MAX_REQUESTS);

const sendError = (res: ApiResponse, status: number, payload: GcTeamFailure): void => {
  res.setHeader("cache-control", "no-store");
  res.status(status).json(payload);
};

type UpstreamConfig = {
  base: string;
  extraHeaders: Record<string, string>;
  token: string;
};

/**
 * Read per request rather than at cold start so a changed env var applies on the next call (and
 * so tests can set it). `GC_EXTRA_HEADERS` that fails to parse is ignored rather than fatal: a
 * typo in an optional escape hatch should not take the feature down.
 */
const readConfig = (): UpstreamConfig => {
  const base = (process.env.GC_API_BASE?.trim() || GC_PUBLIC_API_BASE).replace(/\/+$/, "");
  const extraHeaders: Record<string, string> = {};
  const rawExtra = process.env.GC_EXTRA_HEADERS?.trim();
  if (rawExtra) {
    try {
      const parsed: unknown = JSON.parse(rawExtra);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof value === "string" || typeof value === "number") {
            extraHeaders[name] = String(value);
          }
        }
      }
    } catch {
      console.error("[gc-team] GC_EXTRA_HEADERS is not a JSON object; ignoring it.");
    }
  }
  return { base, extraHeaders, token: process.env.GC_TOKEN?.trim() ?? "" };
};

/** Headers as the schedule page sends them; env extras go last so they can override anything. */
const upstreamHeaders = (accept: string, config: UpstreamConfig): Record<string, string> => ({
  accept,
  "gc-app-name": "web",
  origin: WEB_ORIGIN,
  referer: `${WEB_ORIGIN}/`,
  "user-agent": BROWSER_USER_AGENT,
  "accept-language": "en-US,en;q=0.9",
  ...(config.token ? { "gc-token": config.token } : {}),
  ...config.extraHeaders,
});

/**
 * Outcome of one upstream fetch. Deliberately a flat shape rather than a discriminated union:
 * Vercel type-checks this file with its own non-strict TypeScript defaults, where narrowing a
 * union by a boolean field after an early return does not work.
 */
type UpstreamResult = {
  url: string;
  /** HTTP status, or 0 when no response came back at all. */
  status: number;
  contentType: string;
  text: string;
  /** Parsed JSON body, or undefined when the body was not JSON. */
  json: unknown;
  isJson: boolean;
  timedOut: boolean;
  networkError: string;
  retryAfter: string;
};

const isTimeoutError = (error: unknown): boolean =>
  error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");

const fetchUpstream = async (
  url: string,
  accept: string,
  config: UpstreamConfig
): Promise<UpstreamResult> => {
  const result: UpstreamResult = {
    url,
    status: 0,
    contentType: "",
    text: "",
    json: undefined,
    isJson: false,
    timedOut: false,
    networkError: "",
    retryAfter: "",
  };
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: upstreamHeaders(accept, config),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      redirect: "follow",
    });
    result.status = response.status;
    result.contentType = response.headers.get("content-type") ?? "";
    result.retryAfter = response.headers.get("retry-after") ?? "";
    result.text = await response.text();
    try {
      result.json = JSON.parse(result.text);
      result.isJson = true;
    } catch {
      result.isJson = false;
    }
  } catch (error) {
    if (isTimeoutError(error)) {
      result.timedOut = true;
    } else {
      result.networkError = error instanceof Error ? error.message : "fetch failed";
    }
  }
  return result;
};

const diagnosticsFor = (result: UpstreamResult): GcFetchDiagnostics => {
  const diagnostics: GcFetchDiagnostics = { url: result.url };
  if (result.status > 0) diagnostics.status = result.status;
  if (result.contentType) diagnostics.contentType = result.contentType;
  if (result.text) diagnostics.bodyPreview = result.text.slice(0, BODY_PREVIEW_CHARS);
  if (result.isJson && result.json && typeof result.json === "object") {
    diagnostics.topLevelKeys = Array.isArray(result.json)
      ? ["[array]"]
      : Object.keys(result.json as Record<string, unknown>).slice(0, 20);
  }
  if (result.retryAfter) diagnostics.retryAfter = result.retryAfter;
  return diagnostics;
};

const WAF_BODY_PATTERN = /awswaf|aws-waf|challenge/i;

const blockedMessage = (what: string, status: number, viaChallenge: boolean): string =>
  `GameChanger blocked the ${what} request (HTTP ${status}${
    viaChallenge ? ", AWS WAF challenge" : ""
  }). Its AWS WAF wants a token the schedule page gets from a browser challenge. Set the GC_EXTRA_HEADERS env var to a JSON object of the extra headers a browser sends (for example {"x-aws-waf-token": "..."}) and redeploy.`;

/**
 * The failure a non-OK upstream result means, or `null` when the result is a 2xx JSON body that
 * still has to be normalised. `what` names the endpoint in messages ("profile" or "schedule").
 */
const failureFor = (result: UpstreamResult, what: string): GcTeamFailure | null => {
  if (result.timedOut) {
    return {
      ok: false,
      reason: "timeout",
      message: `GameChanger did not answer the ${what} request within ${UPSTREAM_TIMEOUT_MS / 1000} seconds.`,
      status: 504,
      diagnostics: { url: result.url },
    };
  }
  if (result.networkError) {
    return {
      ok: false,
      reason: "network",
      message: `Could not reach GameChanger for the ${what}: ${result.networkError}`,
      status: 502,
      diagnostics: { url: result.url },
    };
  }
  const { status } = result;
  if (status === 404) {
    return {
      ok: false,
      reason: "not-found",
      message: `GameChanger has no public ${what} for this team id.`,
      status: 404,
      diagnostics: diagnosticsFor(result),
    };
  }
  if (status === 429) {
    const wait = result.retryAfter ? ` Retry after ${result.retryAfter} seconds.` : "";
    return {
      ok: false,
      reason: "throttled",
      message: `GameChanger is rate-limiting the ${what} request.${wait}`,
      status: 429,
      diagnostics: diagnosticsFor(result),
    };
  }
  const challenged =
    (status === 202 || (status >= 200 && status < 300 && !result.isJson)) &&
    WAF_BODY_PATTERN.test(result.text);
  if (status === 401 || status === 403 || status === 405 || challenged) {
    return {
      ok: false,
      reason: "blocked",
      message: blockedMessage(what, status, challenged || WAF_BODY_PATTERN.test(result.text)),
      status: 502,
      diagnostics: diagnosticsFor(result),
    };
  }
  if (status < 200 || status >= 300) {
    return {
      ok: false,
      reason: "upstream-error",
      message: `GameChanger answered the ${what} request with HTTP ${status}.`,
      status: 502,
      diagnostics: diagnosticsFor(result),
    };
  }
  if (!result.isJson) {
    return {
      ok: false,
      reason: "unrecognized",
      message: `GameChanger's ${what} response was not JSON (${result.contentType || "no content-type"}).`,
      status: 502,
      diagnostics: diagnosticsFor(result),
    };
  }
  return null;
};

const unrecognized = (result: UpstreamResult, what: string): GcTeamFailure => ({
  ok: false,
  reason: "unrecognized",
  message: `GameChanger's ${what} JSON is not in a shape this app can read; the diagnostics show what came back.`,
  status: 502,
  diagnostics: diagnosticsFor(result),
});

/**
 * Health check, without touching GameChanger: which upstream base is in use, which extra header
 * names are configured (names only, never values — a WAF token is as good as a password), and
 * whether a token is set.
 */
const sendProbe = (res: ApiResponse, config: UpstreamConfig): void => {
  res.setHeader("cache-control", "no-store");
  res.status(200).json({
    endpoint: "gc-team",
    functionDeployed: true,
    base: config.base,
    extraHeaderNames: Object.keys(config.extraHeaders),
    hasToken: Boolean(config.token),
    // How warm this instance is. Zero on a cold start, which is how it should read.
    cachedProfiles: profileCache.size(),
  });
};

/**
 * A team's profile, kept for a little while.
 *
 * Every request fetches two things: the profile — the club's name, city, state and season — and
 * the schedule. Only the second of those actually moves: a schedule changes the moment somebody
 * enters a score, while a profile changes perhaps once a season. Fetching both every time asked
 * GameChanger for a name it had just given us.
 *
 * It matters most exactly when it is most wanted. A pull that is being throttled retries, and a
 * retry that already has the profile asks for one thing instead of two — so the request that goes
 * out while GameChanger is telling us to slow down is half the size. A weekly rota that re-pulls
 * the same age level, and a batch that happens to name a team twice, are the other cases.
 *
 * Ten minutes, because a serverless instance rarely outlives that by much and a profile corrected
 * upstream should not be pinned to a stale copy for longer than a pull takes. Two thousand
 * entries, so a pull of twenty thousand teams cannot grow the instance by twenty thousand
 * profiles; the oldest go first.
 */
const PROFILE_TTL_MS = 10 * 60_000;
const MAX_CACHED_PROFILES = 2_000;
const profileCache = createTtlCache<GcTeamProfile>(PROFILE_TTL_MS, MAX_CACHED_PROFILES);

/**
 * Empties the profile cache. Vercel routes only the default export, so this is here for tests —
 * without it one test's cached profile answers the next one's request and the fetch under test
 * never happens.
 */
export const clearProfileCache = (): void => profileCache.clear();

/** Teams one request may ask for. Enough to be worth batching, few enough to finish in time. */
const MAX_BATCH = 10;

type PulledTeam = { teamId: string; result: GcTeamResponse; retryAfter?: string };

/**
 * One team's profile and schedule, fetched together. Separated from the request handling so a
 * batch can run several of these at once and report on each of them independently: one team
 * GameChanger will not answer for must not cost the other nine in the same request.
 */
const pullTeam = async (teamId: string, config: UpstreamConfig): Promise<PulledTeam> => {
  const cachedProfile = profileCache.get(teamId);

  // The schedule is always fetched; the profile only when it is not already here.
  const [profileResult, gamesResult] = await Promise.all([
    cachedProfile
      ? Promise.resolve(null)
      : fetchUpstream(gcProfileApiUrl(teamId, config.base), GC_PROFILE_ACCEPT, config),
    fetchUpstream(gcGamesApiUrl(teamId, config.base), GC_GAMES_ACCEPT, config),
  ]);

  let profile: GcTeamProfile;
  if (cachedProfile) {
    profile = cachedProfile;
  } else {
    // Not cached, so `profileResult` is the fetch above; the fallback keeps the non-strict Vercel
    // check happy about a value it cannot see is always present here.
    const fetched = profileResult ?? {
      url: gcProfileApiUrl(teamId, config.base),
      status: 0,
      contentType: "",
      text: "",
      json: undefined,
      isJson: false,
      timedOut: false,
      networkError: "profile fetch did not run",
      retryAfter: "",
    };
    const profileFailure = failureFor(fetched, "profile");
    if (profileFailure) {
      return {
        teamId,
        result: profileFailure,
        ...(fetched.retryAfter ? { retryAfter: fetched.retryAfter } : {}),
      };
    }

    const normalized: GcTeamProfile | null = normalizeGcTeamProfile(fetched.json, teamId);
    if (!normalized) return { teamId, result: unrecognized(fetched, "profile") };
    profile = normalized;
    // Only a profile we actually got and understood. A failure is never cached: the next request
    // is the one that should find out whether GameChanger has stopped refusing.
    profileCache.set(teamId, profile);
  }

  // A team with a profile but no schedule endpoint yet (nothing scheduled) is still a team.
  let games: GcGame[] = [];
  if (gamesResult.status !== 404) {
    const gamesFailure = failureFor(gamesResult, "schedule");
    if (gamesFailure) {
      return {
        teamId,
        result: gamesFailure,
        ...(gamesResult.retryAfter ? { retryAfter: gamesResult.retryAfter } : {}),
      };
    }
    if (!gcGameListFrom(gamesResult.json)) {
      return { teamId, result: unrecognized(gamesResult, "schedule") };
    }
    games = normalizeGcGames(gamesResult.json);
  }

  return {
    teamId,
    result: { ok: true, schedule: { profile, games, fetchedAt: new Date().toISOString() } },
  };
};

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    sendError(res, 405, { ok: false, reason: "upstream-error", message: "Use GET.", status: 405 });
    return;
  }

  const config = readConfig();
  const url = new URL(typeof req.url === "string" ? req.url : "/", "http://localhost");
  if (url.searchParams.get("probe") === "1") {
    sendProbe(res, config);
    return;
  }

  // This app's own throttle, not GameChanger's, so it gets a message saying so.
  if (isRateLimited(clientKey(req))) {
    sendError(res, 429, {
      ok: false,
      reason: "throttled",
      message: `Too many GameChanger pulls from this browser: ${RATE_LIMIT_MAX_REQUESTS} a minute is this app's own limit. Wait a minute and retry.`,
      status: 429,
    });
    return;
  }

  /*
   * A list of ids in one request. A browser will only hold a handful of connections open to one
   * host at a time, so asking for a team per request caps a pull at that handful however many
   * workers there are. Ten teams to a request lifts the ceiling without changing how much
   * GameChanger is asked for.
   */
  const rawIds = url.searchParams.get("ids");
  if (rawIds !== null) {
    const wanted = rawIds
      .split(",")
      .map((entry) => parseGcTeamId(entry))
      .filter((id): id is string => Boolean(id));
    const unique = Array.from(new Set(wanted)).slice(0, MAX_BATCH);
    if (unique.length === 0) {
      sendError(res, 400, {
        ok: false,
        reason: "invalid-id",
        message: "None of those are GameChanger team ids.",
        status: 400,
      });
      return;
    }

    const pulled = await Promise.all(unique.map((teamId) => pullTeam(teamId, config)));
    const throttled = pulled.find((entry) => entry.retryAfter);
    if (throttled?.retryAfter) res.setHeader("retry-after", throttled.retryAfter);
    // Schedules change whenever a score is entered, so this must never be cached.
    res.setHeader("cache-control", "no-store");
    res.status(200).json({
      ok: true,
      teams: pulled.map(({ teamId, result }) => ({ teamId, result })),
    });
    return;
  }

  const rawId = url.searchParams.get("id") ?? "";
  const teamId = parseGcTeamId(rawId);
  if (!teamId) {
    sendError(res, 400, {
      ok: false,
      reason: "invalid-id",
      message: rawId
        ? `"${rawId.slice(0, 40)}" is not a GameChanger team id (the 12 characters after web.gc.com/teams/).`
        : "Add ?id=<GameChanger team id>.",
      status: 400,
    });
    return;
  }

  const { result, retryAfter } = await pullTeam(teamId, config);
  if (!result.ok) {
    if (retryAfter) res.setHeader("retry-after", retryAfter);
    sendError(res, result.status ?? 502, result);
    return;
  }

  // Schedules change whenever a score is entered, so this must never be cached.
  res.setHeader("cache-control", "no-store");
  res.status(200).json(result);
}
