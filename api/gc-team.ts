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

/**
 * The one Node global this function needs. Declared here rather than via `@types/node`: installing
 * that package also changes global timer typings for the browser project, and Vercel type-checks
 * this entrypoint with its own config, which would not pick up a sibling declaration file.
 */
declare const process: { env: Record<string, string | undefined> };

/**
 * Minimal structural types for the Vercel Node handler. Declared locally so the project keeps its
 * two-dependency footprint instead of pulling in @vercel/node purely for type definitions.
 */
type ApiRequest = {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  socket?: { remoteAddress?: string };
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
};

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

const RATE_LIMIT_WINDOW_MS = 60_000;
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

/**
 * Best-effort per-IP throttle. Serverless instances do not share memory, so this caps runaway
 * retries from one client rather than enforcing a global quota.
 */
const requestLog = new Map<string, number[]>();

const clientKey = (req: ApiRequest): string => {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const first = raw?.split(",")[0]?.trim();
  return first || req.socket?.remoteAddress || "unknown";
};

const isRateLimited = (key: string, max: number = RATE_LIMIT_MAX_REQUESTS): boolean => {
  const now = Date.now();
  const recent = (requestLog.get(key) ?? []).filter((at) => now - at < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= max) {
    requestLog.set(key, recent);
    return true;
  }
  recent.push(now);
  requestLog.set(key, recent);
  if (requestLog.size > 5000) requestLog.clear();
  return false;
};

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
  });
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

  const [profileResult, gamesResult] = await Promise.all([
    fetchUpstream(gcProfileApiUrl(teamId, config.base), GC_PROFILE_ACCEPT, config),
    fetchUpstream(gcGamesApiUrl(teamId, config.base), GC_GAMES_ACCEPT, config),
  ]);

  const profileFailure = failureFor(profileResult, "profile");
  if (profileFailure) {
    if (profileFailure.reason === "throttled" && profileResult.retryAfter) {
      res.setHeader("retry-after", profileResult.retryAfter);
    }
    sendError(res, profileFailure.status ?? 502, profileFailure);
    return;
  }

  const profile: GcTeamProfile | null = normalizeGcTeamProfile(profileResult.json, teamId);
  if (!profile) {
    sendError(res, 502, unrecognized(profileResult, "profile"));
    return;
  }

  // A team with a profile but no schedule endpoint yet (nothing scheduled) is still a team.
  let games: GcGame[] = [];
  if (gamesResult.status !== 404) {
    const gamesFailure = failureFor(gamesResult, "schedule");
    if (gamesFailure) {
      if (gamesFailure.reason === "throttled" && gamesResult.retryAfter) {
        res.setHeader("retry-after", gamesResult.retryAfter);
      }
      sendError(res, gamesFailure.status ?? 502, gamesFailure);
      return;
    }
    if (!gcGameListFrom(gamesResult.json)) {
      sendError(res, 502, unrecognized(gamesResult, "schedule"));
      return;
    }
    games = normalizeGcGames(gamesResult.json);
  }

  // Schedules change whenever a score is entered, so this must never be cached.
  res.setHeader("cache-control", "no-store");
  const body: GcTeamResponse = {
    ok: true,
    schedule: { profile, games, fetchedAt: new Date().toISOString() },
  };
  res.status(200).json(body);
}
