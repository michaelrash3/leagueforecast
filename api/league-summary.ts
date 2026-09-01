/**
 * POST /api/league-summary — Gemini-written recap of standings movement.
 *
 * Runs as a Vercel Serverless Function so `GEMINI_API_KEY` stays on the server.
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
  LEAGUE_SUMMARY_SYSTEM_INSTRUCTION,
  type LeagueSummaryError,
  type LeagueSummaryRequest,
  type LeagueSummaryResponse,
} from "../src/lib/leagueSummary.js";
import {
  buildModelCandidates,
  discoverGeminiModels,
  GEMINI_API_BASE,
} from "../src/lib/geminiModels.js";

/**
 * The one Node global this function needs. Declared here rather than via
 * `@types/node`: installing that package also changes global timer typings for
 * the browser project, and Vercel type-checks this entrypoint with its own
 * config, which would not pick up a sibling declaration file.
 */
declare const process: { env: Record<string, string | undefined> };

/**
 * Minimal structural types for the Vercel Node handler. Declared locally so the
 * project keeps its two-dependency footprint instead of pulling in @vercel/node
 * purely for type definitions.
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

/** Total wall-clock budget for one request, across every model attempt. */
const TOTAL_BUDGET_MS = 25_000;
const PER_ATTEMPT_TIMEOUT_MS = 8_000;
const DISCOVERY_TIMEOUT_MS = 5_000;
/** Model list is stable for hours; re-listing on every warm call is wasted latency. */
const MODEL_CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_MODEL_ATTEMPTS = 4;

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 12;

type ModelCache = { ids: string[]; expiresAt: number };
let modelCache: ModelCache | null = null;

/**
 * Best-effort per-IP throttle. Serverless instances do not share memory, so
 * this caps runaway retries from one client rather than enforcing a global
 * quota — Gemini's own quota remains the hard limit.
 */
const requestLog = new Map<string, number[]>();

const clientKey = (req: ApiRequest): string => {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const first = raw?.split(",")[0]?.trim();
  return first || req.socket?.remoteAddress || "unknown";
};

const isRateLimited = (key: string): boolean => {
  const now = Date.now();
  const recent = (requestLog.get(key) ?? []).filter((at) => now - at < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    requestLog.set(key, recent);
    return true;
  }
  recent.push(now);
  requestLog.set(key, recent);
  if (requestLog.size > 5000) requestLog.clear();
  return false;
};

const sendError = (res: ApiResponse, status: number, payload: LeagueSummaryError) => {
  res.status(status).json(payload);
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
          systemInstruction: { parts: [{ text: LEAGUE_SUMMARY_SYSTEM_INSTRUCTION }] },
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
  status: number;
  error: LeagueSummaryError | null;
};

const summaryFailure = (status: number, error: LeagueSummaryError): SummaryResult => ({
  ok: false,
  summary: "",
  model: "",
  status,
  error,
});

const generateSummary = async (
  apiKey: string,
  request: LeagueSummaryRequest,
  deadline: number
): Promise<SummaryResult> => {
  const candidates = await resolveModelCandidates(apiKey);
  if (candidates.length === 0) {
    return summaryFailure(502, {
      error: "No Gemini model is available for this API key.",
      reason: "no-model",
    });
  }

  const prompt = buildLeagueSummaryPrompt(request);
  const failures: string[] = [];
  let sawRateLimit = false;

  for (const model of candidates) {
    const remaining = deadline - Date.now();
    if (remaining <= 500) break;

    const attempt = await generateWithModel(
      apiKey,
      model,
      prompt,
      Math.min(PER_ATTEMPT_TIMEOUT_MS, remaining)
    );
    if (attempt.ok) {
      return { ok: true, summary: attempt.summary, model, status: 200, error: null };
    }

    failures.push(`${model}: ${attempt.message}`);
    if (attempt.status === 429) sawRateLimit = true;
    if (attempt.fatal) {
      console.error("[league-summary] Gemini rejected the API key:", attempt.message);
      return summaryFailure(502, {
        error: "Gemini rejected the configured API key.",
        reason: "upstream-error",
      });
    }
    // Any other failure (missing model, 5xx, timeout, empty text) falls through
    // to the next-newest candidate.
  }

  console.error("[league-summary] all Gemini candidates failed:", failures.join(" | "));
  return sawRateLimit
    ? summaryFailure(429, {
        error: "Gemini rate limit reached. Try again shortly.",
        reason: "rate-limited",
      })
    : summaryFailure(502, {
        error: "Gemini could not generate a summary.",
        reason: "upstream-error",
      });
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
 * paste), the deployed commit, and the Vercel environment.
 */
const sendHealth = async (req: ApiRequest, res: ApiResponse): Promise<void> => {
  const rawKey = process.env.GEMINI_API_KEY;
  const apiKey = rawKey?.trim();
  const url = typeof req.url === "string" ? req.url : "";
  const wantsProbe = /[?&]probe=1(&|$)/.test(url);

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

  if (wantsProbe && apiKey) {
    if (isRateLimited(clientKey(req))) {
      health.probe = { ok: false, error: "Rate limited; try again in a minute." };
    } else {
      const discovered = await discoverGeminiModels(apiKey, {
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      });
      health.probe = {
        ok: discovered.length > 0,
        modelCount: discovered.length,
        candidates: buildModelCandidates({
          pinned: process.env.GEMINI_MODEL?.trim() || null,
          discovered,
          limit: MAX_MODEL_ATTEMPTS,
        }),
        note:
          discovered.length > 0
            ? "The key can list models; the newest is attempted first."
            : "The key could not list any usable model. Check that it is a Generative Language API key and is not restricted.",
      };
    }
  } else if (wantsProbe) {
    health.probe = { ok: false, error: "No API key configured, so there is nothing to probe." };
  }

  res.setHeader("cache-control", "no-store");
  res.status(200).json(health);
};

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method === "GET") {
    await sendHealth(req, res);
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    sendError(res, 405, { error: "Use POST.", reason: "invalid-request" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    // Expected on local dev and any deployment without the key: the client
    // treats this as "AI story off" and keeps the deterministic story.
    sendError(res, 503, {
      error: "GEMINI_API_KEY is not configured.",
      reason: "unconfigured",
    });
    return;
  }

  if (isRateLimited(clientKey(req))) {
    sendError(res, 429, { error: "Too many summary requests.", reason: "rate-limited" });
    return;
  }

  const request = sanitizeLeagueSummaryRequest(readBody(req));
  if (!request) {
    sendError(res, 400, {
      error: "Request must include at least one standings-movement fact.",
      reason: "invalid-request",
    });
    return;
  }

  const result = await generateSummary(apiKey, request, Date.now() + TOTAL_BUDGET_MS);
  if (!result.ok || !result.summary) {
    sendError(
      res,
      result.status,
      result.error ?? { error: "Gemini could not generate a summary.", reason: "upstream-error" }
    );
    return;
  }

  // Recaps change whenever results are entered, so this must never be cached.
  res.setHeader("cache-control", "no-store");
  const body: LeagueSummaryResponse = {
    summary: result.summary,
    model: result.model,
    source: "gemini",
  };
  res.status(200).json(body);
}
