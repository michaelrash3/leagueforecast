/**
 * POST /api/league-summary — Gemini-written recap of standings movement, and Groq's when Gemini
 * cannot write one.
 *
 * Runs as a Vercel Serverless Function so `GEMINI_API_KEY` and `GROQ_API_KEY` stay on the server.
 * A key inlined into the Vite bundle (any `VITE_*` variable) ships to every
 * visitor, so the browser never sees it: it posts recap facts here instead.
 *
 * Model selection is deliberately not pinned. Each cold start asks the key
 * which models it can use, ranks them newest-generation-first, and the request
 * walks down that list until one answers — so a newly released Gemini is used
 * as soon as it appears, and a retired one degrades to the next best model.
 *
 * Every failure path returns a non-200 with a machine-readable `reason`; the
 * client then keeps showing the deterministic story, so the app works unchanged
 * when the key is absent or Gemini is unreachable.
 */

import {
  buildLeagueSummaryPrompt,
  normalizeSummaryText,
  sanitizeLeagueSummaryRequest,
  LEAGUE_SUMMARY_LIMITS,
  systemInstructionForKind,
  type LeagueSummaryError,
  type LeagueSummaryRequest,
  type LeagueSummaryResponse,
} from "../src/lib/leagueSummary.js";
import {
  buildModelCandidates,
  discoverGeminiModels,
  discoverGeminiModelsDetailed,
  probeGeminiGeneration,
  GEMINI_API_BASE,
  GEMINI_FALLBACK_MODEL_IDS,
} from "../src/lib/geminiModels.js";
import {
  buildGroqCandidates,
  discoverGroqModels,
  groqChatBody,
  readGroqChatText,
  GROQ_API_BASE,
  type GroqChatResponse,
} from "../src/lib/groqModels.js";
import {
  clientKey,
  createRateLimiter,
  type ApiRequest,
  type ApiResponse,
} from "../src/lib/apiShared.js";

/**
 * The one Node global this function needs. Declared here rather than via
 * `@types/node`: installing that package also changes global timer typings for
 * the browser project, and Vercel type-checks this entrypoint with its own
 * config, which would not pick up a sibling declaration file.
 */
declare const process: { env: Record<string, string | undefined> };

/** Total wall-clock budget for one request, across every model attempt. */
const TOTAL_BUDGET_MS = 25_000;
const PER_ATTEMPT_TIMEOUT_MS = 8_000;
const DISCOVERY_TIMEOUT_MS = 5_000;
/** Model list is stable for hours; re-listing on every warm call is wasted latency. */
const MODEL_CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_MODEL_ATTEMPTS = 4;
/** Groq is the fallback, and three of its models is as far down its list as is worth going. */
const MAX_GROQ_ATTEMPTS = 3;
/**
 * Time kept back for Groq when both keys are set, so a Gemini walk that spends the whole budget
 * failing (four timeouts) still leaves Groq one attempt; Groq does not list its models then
 * (`resolveGroqCandidates`), since the listing would eat the attempt. Gemini's usual failure,
 * its quota, is a quick 429 on every model, which leaves Groq nearly all of it.
 */
const GROQ_RESERVE_MS = 8_000;

const RATE_LIMIT_MAX_REQUESTS = 12;
const DAILY_RATE_LIMIT_MAX_REQUESTS = 100;
/**
 * The health probe gets its own, smaller budget under its own key. It shares
 * the summary limiter's window but not its bucket, so a burst of retries can
 * never starve the diagnostic that explains why they are failing.
 */
const PROBE_RATE_LIMIT_MAX_REQUESTS = 6;

type ModelCache = { ids: string[]; expiresAt: number };
let modelCache: ModelCache | null = null;
let groqModelCache: ModelCache | null = null;

/** Forgets both providers' model lists, so each test starts from a cold instance. */
export const clearModelCaches = (): void => {
  modelCache = null;
  groqModelCache = null;
};

/** Gemini's own quota remains the hard limit; this only caps runaway retries from one client. */
const isRateLimited = createRateLimiter(RATE_LIMIT_MAX_REQUESTS);

const sendError = (res: ApiResponse, status: number, payload: LeagueSummaryError) => {
  res.setHeader("cache-control", "private, no-store, max-age=0");
  res.status(status).json(payload);
};

type Identity = { uid: string };
type QuotaAnswer = { allowed: boolean; retryAfter: number };
let verifyIdentityOverride: ((token: string) => Promise<Identity | null>) | null = null;
let consumeQuotaOverride: ((uid: string) => Promise<QuotaAnswer>) | null = null;

/** Dependency seams for deterministic security tests; production always uses the durable paths. */
export const setSummarySecurityTestHooks = (
  hooks: {
    verify?: (token: string) => Promise<Identity | null>;
    quota?: (uid: string) => Promise<QuotaAnswer>;
  } | null
): void => {
  verifyIdentityOverride = hooks?.verify ?? null;
  consumeQuotaOverride = hooks?.quota ?? null;
};

const bearer = (req: ApiRequest): string | null => {
  const raw = req.headers.authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(value ?? "");
  return match?.[1] ?? null;
};

const verifyIdentity = async (token: string): Promise<Identity | null> => {
  if (verifyIdentityOverride) return verifyIdentityOverride(token);
  const key = process.env.FIREBASE_WEB_API_KEY?.trim() || process.env.VITE_FIREBASE_API_KEY?.trim();
  if (!key) throw new Error("Firebase token verification is not configured.");
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: token }),
      signal: AbortSignal.timeout(5_000),
    }
  );
  if (!response.ok) return null;
  const body = (await response.json()) as {
    users?: { localId?: string; providerUserInfo?: { providerId?: string }[] }[];
  };
  const user = body.users?.[0];
  return user?.localId &&
    user.providerUserInfo?.some((provider) => provider.providerId === "google.com")
    ? { uid: user.localId }
    : null;
};

const consumeQuota = async (uid: string): Promise<QuotaAnswer> => {
  if (consumeQuotaOverride) return consumeQuotaOverride(uid);
  const url = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Durable summary quota is not configured.");
  const minute = Math.floor(Date.now() / 60_000);
  const day = new Date().toISOString().slice(0, 10);
  const script =
    "local a=redis.call('INCR',KEYS[1]); if a==1 then redis.call('EXPIRE',KEYS[1],60) end; local b=redis.call('INCR',KEYS[2]); if b==1 then redis.call('EXPIRE',KEYS[2],172800) end; return {a,b,redis.call('TTL',KEYS[1])}";
  const response = await fetch(
    `${url}/eval/${encodeURIComponent(script)}/2/ai:${encodeURIComponent(uid)}:${minute}/ai:${encodeURIComponent(uid)}:${day}`,
    {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    }
  );
  if (!response.ok) throw new Error("Durable summary quota is unavailable.");
  const result = (await response.json()) as { result?: number[] };
  const [short = RATE_LIMIT_MAX_REQUESTS + 1, daily = DAILY_RATE_LIMIT_MAX_REQUESTS + 1, ttl = 60] =
    result.result ?? [];
  return {
    allowed: short <= RATE_LIMIT_MAX_REQUESTS && daily <= DAILY_RATE_LIMIT_MAX_REQUESTS,
    retryAfter: Math.max(1, ttl),
  };
};

/** `req.body` is pre-parsed for JSON content types, but tolerate a raw string. */
const readBody = (req: ApiRequest): unknown => {
  const { body } = req;
  if (typeof body !== "string") return body;
  if (body.length > LEAGUE_SUMMARY_LIMITS.requestBytes) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
};

const resolveModelCandidates = async (apiKey: string): Promise<string[]> => {
  const pinned = process.env.GEMINI_MODEL?.trim() || null;
  const now = Date.now();

  if (!modelCache || modelCache.expiresAt <= now) {
    const discovered = await discoverGeminiModels(apiKey, {
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    // Only cache a successful listing; a transient failure should be retried.
    if (discovered.length > 0) {
      modelCache = { ids: discovered, expiresAt: now + MODEL_CACHE_TTL_MS };
    }
  }

  return buildModelCandidates({
    pinned,
    discovered: modelCache?.ids ?? [],
    limit: MAX_MODEL_ATTEMPTS,
  });
};

type GenerateContentResponse = {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string };
};

/**
 * Outcome of one model attempt. Deliberately a flat shape rather than a
 * discriminated union: Vercel type-checks this file with its own non-strict
 * TypeScript defaults, where narrowing a union by a boolean field after an
 * early return does not work.
 */
type AttemptResult = {
  ok: boolean;
  summary: string;
  status?: number;
  message?: string;
  fatal?: boolean;
};

/** An auth failure repeats on every model, so it stops the walk immediately. */
const isAuthFailure = (status: number, message: string): boolean =>
  status === 401 ||
  status === 403 ||
  (status === 400 && /api[ _-]?key|api_key_invalid|unauthenticat/i.test(message));

const generateWithModel = async (
  apiKey: string,
  model: string,
  prompt: string,
  systemInstruction: string,
  timeoutMs: number
): Promise<AttemptResult> => {
  try {
    const response = await fetch(
      `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          systemInstruction: { parts: [{ text: systemInstruction }] },
          generationConfig: {
            temperature: 0.4,
            topP: 0.9,
            // Generous cap: the analysis runs several paragraphs, and reasoning
            // models spend part of this budget on thinking tokens. A truncated
            // answer is treated as a failure and falls through to the next model.
            maxOutputTokens: 2048,
          },
        }),
      }
    );

    const payload = (await response.json().catch(() => ({}))) as GenerateContentResponse;

    if (!response.ok) {
      const message = payload.error?.message ?? `HTTP ${response.status}`;
      return {
        ok: false,
        summary: "",
        status: response.status,
        message,
        fatal: isAuthFailure(response.status, message),
      };
    }

    if (payload.promptFeedback?.blockReason) {
      return { ok: false, summary: "", message: `blocked: ${payload.promptFeedback.blockReason}` };
    }

    const text = normalizeSummaryText(
      (payload.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join("")
    );

    if (!text) {
      const finish = payload.candidates?.[0]?.finishReason ?? "empty response";
      return { ok: false, summary: "", message: `no usable text (${finish})` };
    }

    return { ok: true, summary: text };
  } catch (error) {
    const message = error instanceof Error ? error.message : "request failed";
    return { ok: false, summary: "", message };
  }
};

/** Flat for the same non-strict-narrowing reason as `AttemptResult`. */
type SummaryResult = {
  ok: boolean;
  summary: string;
  model: string;
  source: LeagueSummaryResponse["source"];
  status: number;
  error: LeagueSummaryError | null;
};

const summaryFailure = (
  source: LeagueSummaryResponse["source"],
  status: number,
  error: LeagueSummaryError
): SummaryResult => ({
  ok: false,
  summary: "",
  model: "",
  source,
  status,
  error,
});

const generateWithGemini = async (
  apiKey: string,
  request: LeagueSummaryRequest,
  deadline: number
): Promise<SummaryResult> => {
  const candidates = await resolveModelCandidates(apiKey);
  if (candidates.length === 0) {
    return summaryFailure("gemini", 502, {
      error: "No Gemini model is available for this API key.",
      reason: "no-model",
    });
  }

  const prompt = buildLeagueSummaryPrompt(request);
  const systemInstruction = systemInstructionForKind(request.kind);
  const failures: string[] = [];
  let sawRateLimit = false;

  for (const model of candidates) {
    const remaining = deadline - Date.now();
    if (remaining <= 500) break;

    const attempt = await generateWithModel(
      apiKey,
      model,
      prompt,
      systemInstruction,
      Math.min(PER_ATTEMPT_TIMEOUT_MS, remaining)
    );
    if (attempt.ok) {
      return {
        ok: true,
        summary: attempt.summary,
        model,
        source: "gemini",
        status: 200,
        error: null,
      };
    }

    failures.push(`${model}: ${attempt.message}`);
    if (attempt.status === 429) sawRateLimit = true;
    if (attempt.fatal) {
      console.error("[league-summary] Gemini rejected the API key:", attempt.message);
      return summaryFailure("gemini", 502, {
        error: "Gemini rejected the configured API key.",
        reason: "upstream-error",
      });
    }
    // Any other failure (missing model, 5xx, timeout, empty text) falls through
    // to the next-newest candidate.
  }

  console.error("[league-summary] all Gemini candidates failed:", failures.join(" | "));
  return sawRateLimit
    ? summaryFailure("gemini", 429, {
        error: `Gemini rate-limited every model tried (${candidates.join(", ")}).`,
        reason: "rate-limited",
      })
    : summaryFailure("gemini", 502, {
        error: "Gemini could not generate a summary.",
        reason: "upstream-error",
      });
};

const resolveGroqCandidates = async (apiKey: string, deadline: number): Promise<string[]> => {
  const pinned = process.env.GROQ_MODEL?.trim() || null;
  const now = Date.now();
  // Listing can take DISCOVERY_TIMEOUT_MS, which out of what Gemini left would leave too little
  // for an answer. With less than a listing and a whole attempt to go, the list already known is
  // used as it stands, or the preferred one, and the reserve buys Groq a whole attempt.
  const timeToList = deadline - now >= DISCOVERY_TIMEOUT_MS + PER_ATTEMPT_TIMEOUT_MS;
  if (timeToList && (!groqModelCache || groqModelCache.expiresAt <= now)) {
    const discovered = await discoverGroqModels(apiKey, {
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    // As with Gemini, only a listing that worked is kept; a failed one is asked again next time.
    if (discovered.ids.length > 0) {
      groqModelCache = { ids: discovered.ids, expiresAt: now + MODEL_CACHE_TTL_MS };
    }
  }
  return buildGroqCandidates({
    pinned,
    discovered: groqModelCache?.ids ?? [],
    limit: MAX_GROQ_ATTEMPTS,
  });
};

const generateWithGroqModel = async (
  apiKey: string,
  model: string,
  prompt: string,
  systemInstruction: string,
  timeoutMs: number
): Promise<AttemptResult> => {
  try {
    const response = await fetch(`${GROQ_API_BASE}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify(groqChatBody(model, systemInstruction, prompt)),
    });
    const payload = (await response.json().catch(() => ({}))) as GroqChatResponse;
    if (!response.ok) {
      const message = payload.error?.message ?? `HTTP ${response.status}`;
      // A key Groq does not accept fails the same way on every model.
      return {
        ok: false,
        summary: "",
        status: response.status,
        message,
        fatal: response.status === 401 || response.status === 403,
      };
    }
    const read = readGroqChatText(payload);
    const text = normalizeSummaryText(read.text);
    if (!text) return { ok: false, summary: "", message: read.problem ?? "no usable text" };
    return { ok: true, summary: text };
  } catch (error) {
    const message = error instanceof Error ? error.message : "request failed";
    return { ok: false, summary: "", message };
  }
};

/**
 * Groq's turn, once Gemini could not write the story: the same prompt and system instruction,
 * walked down the key's models the way Gemini's are.
 */
const generateWithGroq = async (
  apiKey: string,
  request: LeagueSummaryRequest,
  deadline: number
): Promise<SummaryResult> => {
  const candidates = await resolveGroqCandidates(apiKey, deadline);
  const prompt = buildLeagueSummaryPrompt(request);
  const systemInstruction = systemInstructionForKind(request.kind);
  const failures: string[] = [];
  let sawRateLimit = false;

  for (const model of candidates) {
    const remaining = deadline - Date.now();
    if (remaining <= 500) break;
    const attempt = await generateWithGroqModel(
      apiKey,
      model,
      prompt,
      systemInstruction,
      Math.min(PER_ATTEMPT_TIMEOUT_MS, remaining)
    );
    if (attempt.ok) {
      return {
        ok: true,
        summary: attempt.summary,
        model,
        source: "groq",
        status: 200,
        error: null,
      };
    }
    failures.push(`${model}: ${attempt.message}`);
    if (attempt.status === 429) sawRateLimit = true;
    if (attempt.fatal) {
      console.error("[league-summary] Groq rejected the API key:", attempt.message);
      return summaryFailure("groq", 502, {
        error: "Groq rejected the configured API key.",
        reason: "upstream-error",
      });
    }
  }

  console.error("[league-summary] all Groq candidates failed:", failures.join(" | "));
  return sawRateLimit
    ? summaryFailure("groq", 429, {
        error: `Groq rate-limited every model tried (${candidates.join(", ")}).`,
        reason: "rate-limited",
      })
    : summaryFailure("groq", 502, {
        error: "Groq could not generate a summary.",
        reason: "upstream-error",
      });
};

/** A limit passes, so a failure that is one says to try again rather than to fix anything. */
const withRetryHint = (result: SummaryResult): SummaryResult =>
  result.status === 429 && result.error
    ? { ...result, error: { ...result.error, error: `${result.error.error} Try again shortly.` } }
    : result;

/**
 * Gemini first, and Groq when Gemini could not write the story, for whatever reason: its quota,
 * which is what the Groq key was added for, but also a key it rejects or a model list it cannot
 * serve, since a second provider is as much use then. Either key alone is enough.
 */
const generateSummary = async (
  keys: { gemini?: string; groq?: string },
  request: LeagueSummaryRequest,
  deadline: number
): Promise<SummaryResult> => {
  const failed: SummaryResult[] = [];
  if (keys.gemini) {
    const gemini = await generateWithGemini(
      keys.gemini,
      request,
      keys.groq ? deadline - GROQ_RESERVE_MS : deadline
    );
    if (gemini.ok) return gemini;
    failed.push(gemini);
  }
  if (keys.groq) {
    const groq = await generateWithGroq(keys.groq, request, deadline);
    if (groq.ok) return groq;
    failed.push(groq);
  }
  const last = failed[failed.length - 1];
  if (!last) {
    return summaryFailure("gemini", 503, {
      error: "Neither GEMINI_API_KEY nor GROQ_API_KEY is configured.",
      reason: "unconfigured",
    });
  }
  if (failed.length === 1) return withRetryHint(last);
  // Both tried and both failed: a limit only if both were at theirs, so the label says what to
  // wait for; otherwise Groq's reason, the last word, with both providers' messages.
  const bothLimited = failed.every((result) => result.status === 429);
  return withRetryHint(
    summaryFailure("groq", bothLimited ? 429 : last.status, {
      error: failed
        .map((result) => result.error?.error ?? "")
        .join(" ")
        .trim(),
      reason: bothLimited ? "rate-limited" : (last.error?.reason ?? "upstream-error"),
    })
  );
};

/**
 * GET handler: a health check you can open in a phone browser.
 *
 * The POST path deliberately fails quietly, which makes a misconfigured deploy
 * hard to tell apart from a missing endpoint. Opening this URL answers both at
 * once: a 404 means the function was never deployed, and a JSON body means it
 * was, with `keyConfigured` saying whether the Gemini key actually reaches the
 * runtime. `?probe=1` additionally asks Gemini which models the key can use.
 *
 * It reports no secret material: booleans, a key length (to catch a truncated
 * paste), the deployed commit, and the Vercel environment. The same for the
 * Groq key under `groq`, whose probe asks Groq which models the key can use.
 */
const sendHealth = async (req: ApiRequest, res: ApiResponse): Promise<void> => {
  const rawKey = process.env.GEMINI_API_KEY;
  const apiKey = rawKey?.trim();
  const url = typeof req.url === "string" ? req.url : "";
  const wantsProbe = /[?&]probe=1(&|$)/.test(url);

  // A plain health response is public and contacts nobody. A probe spends provider quota and has
  // exactly the same authentication and shared-quota boundary as generation.
  if (wantsProbe) {
    const token = bearer(req);
    if (!token) {
      sendError(res, 401, {
        error: "Authentication is required to probe providers.",
        reason: "invalid-request",
      });
      return;
    }
    let identity: Identity | null;
    try {
      identity = await verifyIdentity(token);
      if (identity && !(await consumeQuota(identity.uid)).allowed) {
        sendError(res, 429, {
          error: "Summary quota exhausted. Try again later.",
          reason: "throttled",
        });
        return;
      }
    } catch {
      sendError(res, 503, {
        error: "Authentication or quota is temporarily unavailable.",
        reason: "upstream-error",
      });
      return;
    }
    if (!identity) {
      sendError(res, 401, {
        error: "The credential is invalid or expired.",
        reason: "invalid-request",
      });
      return;
    }
  }

  const health: Record<string, unknown> = {
    endpoint: "league-summary",
    functionDeployed: true,
    keyConfigured: Boolean(apiKey),
    // Length only, never the value: catches a truncated or whitespace-padded paste.
    keyLength: apiKey?.length ?? 0,
    keyHadSurroundingWhitespace: Boolean(rawKey && rawKey !== rawKey.trim()),
    pinnedModel: process.env.GEMINI_MODEL?.trim() || null,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    probe: wantsProbe ? "requested" : "add ?probe=1 to test the key against Gemini",
  };
  const rawGroqKey = process.env.GROQ_API_KEY;
  const groqKey = rawGroqKey?.trim();
  const groq: Record<string, unknown> = {
    keyConfigured: Boolean(groqKey),
    keyLength: groqKey?.length ?? 0,
    keyHadSurroundingWhitespace: Boolean(rawGroqKey && rawGroqKey !== rawGroqKey.trim()),
    pinnedModel: process.env.GROQ_MODEL?.trim() || null,
  };
  health.groq = groq;

  // One throttle for the whole probe, which may ask both providers.
  const probeThrottled =
    wantsProbe &&
    Boolean(apiKey || groqKey) &&
    isRateLimited(`probe:${clientKey(req)}`, PROBE_RATE_LIMIT_MAX_REQUESTS);
  const throttledProbe = {
    ok: false,
    error: `The key was not tested: this browser used all ${PROBE_RATE_LIMIT_MAX_REQUESTS} health checks allowed in a minute. That is this app's own limit, not the AI provider's. Wait a minute and check again.`,
  };

  if (wantsProbe && groqKey) {
    if (probeThrottled) {
      groq.probe = throttledProbe;
    } else {
      const discovery = await discoverGroqModels(groqKey, {
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      });
      groq.probe = {
        ok: discovery.ids.length > 0,
        modelCount: discovery.ids.length,
        candidates: buildGroqCandidates({
          pinned: process.env.GROQ_MODEL?.trim() || null,
          discovered: discovery.ids,
          limit: MAX_GROQ_ATTEMPTS,
        }),
        listError: discovery.error ?? null,
      };
    }
  }

  if (wantsProbe && apiKey) {
    if (probeThrottled) {
      health.probe = {
        ok: false,
        error: `The key was not tested: this browser used all ${PROBE_RATE_LIMIT_MAX_REQUESTS} health checks allowed in a minute. That is this app's own limit, not Gemini's. Wait a minute and check again.`,
      };
    } else {
      const pinned = process.env.GEMINI_MODEL?.trim() || null;
      const discovery = await discoverGeminiModelsDetailed(apiKey, {
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      });
      const candidates = buildModelCandidates({
        pinned,
        discovered: discovery.ids,
        limit: MAX_MODEL_ATTEMPTS,
      });

      // Listing and generating can fail independently, so when listing fails,
      // try one tiny generation too: the app falls back to a static model list
      // and may work anyway, and the two errors point at different fixes.
      const generation =
        discovery.ids.length === 0
          ? await probeGeminiGeneration(apiKey, pinned ?? GEMINI_FALLBACK_MODEL_IDS[0] ?? "", {
              signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
            })
          : null;

      health.probe = {
        ok: discovery.ids.length > 0 || generation?.ok === true,
        modelCount: discovery.ids.length,
        candidates,
        // Google's own words, so a restricted key or a disabled API is named
        // rather than guessed at.
        listError: discovery.error ?? null,
        generation: generation
          ? { ok: generation.ok, model: generation.model, error: generation.error ?? null }
          : null,
        note:
          discovery.ids.length > 0
            ? "The key can list models; the newest is attempted first."
            : generation?.ok
              ? "The key cannot list models but can generate, so the app still works using its built-in model list."
              : "The key could not list models or generate.",
      };
    }
  } else if (wantsProbe) {
    health.probe = { ok: false, error: "No API key configured, so there is nothing to probe." };
  }

  res.setHeader("cache-control", "no-store");
  res.status(200).json(health);
};

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  res.setHeader("cache-control", "private, no-store, max-age=0");
  if (req.method === "GET") {
    await sendHealth(req, res);
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    sendError(res, 405, { error: "Use POST.", reason: "invalid-request" });
    return;
  }

  const contentType = req.headers["content-type"];
  const content = Array.isArray(contentType) ? contentType[0] : contentType;
  if (!content?.toLowerCase().startsWith("application/json")) {
    sendError(res, 415, { error: "Use application/json.", reason: "invalid-request" });
    return;
  }
  const token = bearer(req);
  if (!token) {
    sendError(res, 401, { error: "Authentication is required.", reason: "invalid-request" });
    return;
  }
  let identity: Identity | null;
  try {
    identity = await verifyIdentity(token);
  } catch {
    sendError(res, 503, {
      error: "Authentication is temporarily unavailable.",
      reason: "upstream-error",
    });
    return;
  }
  if (!identity) {
    sendError(res, 401, {
      error: "The credential is invalid or expired.",
      reason: "invalid-request",
    });
    return;
  }

  const bodyBytes =
    typeof req.body === "string"
      ? new TextEncoder().encode(req.body).byteLength
      : new TextEncoder().encode(JSON.stringify(req.body ?? null)).byteLength;
  if (bodyBytes > LEAGUE_SUMMARY_LIMITS.requestBytes) {
    sendError(res, 413, { error: "Request is too large.", reason: "invalid-request" });
    return;
  }
  let quota: QuotaAnswer;
  try {
    quota = await consumeQuota(identity.uid);
  } catch {
    sendError(res, 503, {
      error: "The shared quota service is unavailable.",
      reason: "upstream-error",
    });
    return;
  }
  if (!quota.allowed) {
    res.setHeader("retry-after", String(quota.retryAfter));
    sendError(res, 429, {
      error: "Summary quota exhausted. Try again later.",
      reason: "throttled",
    });
    return;
  }

  const geminiKey = process.env.GEMINI_API_KEY?.trim() || undefined;
  const groqKey = process.env.GROQ_API_KEY?.trim() || undefined;
  if (!geminiKey && !groqKey) {
    // Expected on local dev and any deployment without a key: the client
    // treats this as "AI story off" and keeps the deterministic story.
    sendError(res, 503, {
      error: "Neither GEMINI_API_KEY nor GROQ_API_KEY is configured.",
      reason: "unconfigured",
    });
    return;
  }

  // This app's own throttle, not Gemini's, and it fires before any model is
  // attempted — so it gets its own reason rather than reading as a Gemini quota.
  if (isRateLimited(identity.uid)) {
    sendError(res, 429, {
      error: `Too many summary requests from this browser: ${RATE_LIMIT_MAX_REQUESTS} a minute is this app's own limit, and no AI model was attempted. Wait a minute and retry.`,
      reason: "throttled",
    });
    return;
  }

  const request = sanitizeLeagueSummaryRequest(readBody(req));
  if (!request) {
    sendError(res, 400, {
      error: "Request must include standings movement, projections, or game forecasts.",
      reason: "invalid-request",
    });
    return;
  }

  const result = await generateSummary(
    { gemini: geminiKey, groq: groqKey },
    request,
    Date.now() + TOTAL_BUDGET_MS
  );
  if (!result.ok || !result.summary) {
    sendError(
      res,
      result.status,
      result.error ?? { error: "No AI model could generate a summary.", reason: "upstream-error" }
    );
    return;
  }

  // Recaps change whenever results are entered, so this must never be cached.
  res.setHeader("cache-control", "no-store");
  const body: LeagueSummaryResponse = {
    summary: result.summary,
    model: result.model,
    source: result.source,
  };
  res.status(200).json(body);
}
