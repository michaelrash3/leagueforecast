/**
 * POST /api/parse-schedule-image — reads a schedule screenshot into structured games via Gemini.
 *
 * Runs as a Vercel Serverless Function so `GEMINI_API_KEY` stays on the server, exactly like
 * `league-summary.ts`. Model selection is not pinned: each cold start asks the key which models it
 * can use, ranks them newest-first, and walks that list until one answers. Every modern Gemini
 * `generateContent` model accepts inline image parts, so the same candidate list works here.
 *
 * The scaffolding below (request/response types, the `process` declaration, the rate limiter, the
 * model cache, the flat result shapes) is deliberately copied from `league-summary.ts` rather than
 * shared: those are module-local there, that endpoint is in production, and duplicating ~60 lines
 * beats refactoring a working function to add a second one. The flat shapes in particular are
 * required because Vercel type-checks this directory with its own non-strict TypeScript defaults,
 * where narrowing a union by a boolean field after an early return does not work.
 */

import {
  SCHEDULE_IMAGE_LIMITS,
  SCHEDULE_IMAGE_PROMPT,
  SCHEDULE_IMAGE_RESPONSE_SCHEMA,
  SCHEDULE_IMAGE_SYSTEM_INSTRUCTION,
  sanitizeScheduleImageResponse,
  type ParsedScheduleGame,
  type ScheduleImageError,
  type ScheduleImageResponse,
} from "../src/lib/scheduleImage.js";
import {
  buildModelCandidates,
  discoverGeminiModels,
  GEMINI_API_BASE,
} from "../src/lib/geminiModels.js";

declare const process: { env: Record<string, string | undefined> };

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

/** Vision on a full screenshot is slower than a text summary, and `vercel.json` allows 30s. */
const TOTAL_BUDGET_MS = 26_000;
const PER_ATTEMPT_TIMEOUT_MS = 15_000;
const DISCOVERY_TIMEOUT_MS = 5_000;
const MODEL_CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_MODEL_ATTEMPTS = 3;

const RATE_LIMIT_WINDOW_MS = 60_000;
/** Lower than the summary endpoint's: an image call costs more, and nobody imports 12 a minute. */
const RATE_LIMIT_MAX_REQUESTS = 6;

type ModelCache = { ids: string[]; expiresAt: number };
let modelCache: ModelCache | null = null;

/** Best-effort per-IP throttle; serverless instances do not share memory, so this caps one
 * client's runaway retries rather than enforcing a global quota. */
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

const sendError = (res: ApiResponse, status: number, payload: ScheduleImageError) => {
  res.status(status).json(payload);
};

const readBody = (req: ApiRequest): unknown => {
  const { body } = req;
  if (typeof body !== "string") return body;
  // Generous: the whole JSON envelope is the base64 image plus a short mime type.
  if (body.length > SCHEDULE_IMAGE_LIMITS.imageBase64Length + 10_000) return null;
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

/** Flat rather than a discriminated union — see the file header. */
type AttemptResult = {
  ok: boolean;
  games: ParsedScheduleGame[];
  subjectTeam?: string;
  status?: number;
  message?: string;
  fatal?: boolean;
};

/** An auth failure repeats on every model, so it stops the walk immediately. */
const isAuthFailure = (status: number, message: string): boolean =>
  status === 401 ||
  status === 403 ||
  (status === 400 && /api[ _-]?key|api_key_invalid|unauthenticat/i.test(message));

const parseWithModel = async (
  apiKey: string,
  model: string,
  imageBase64: string,
  mimeType: string,
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
          contents: [
            {
              role: "user",
              parts: [
                { inlineData: { mimeType, data: imageBase64 } },
                { text: SCHEDULE_IMAGE_PROMPT },
              ],
            },
          ],
          systemInstruction: { parts: [{ text: SCHEDULE_IMAGE_SYSTEM_INSTRUCTION }] },
          generationConfig: {
            // Transcription, not writing: never paraphrase a score.
            temperature: 0,
            responseMimeType: "application/json",
            responseSchema: SCHEDULE_IMAGE_RESPONSE_SCHEMA,
            maxOutputTokens: 4096,
          },
        }),
      }
    );

    const payload = (await response.json().catch(() => ({}))) as GenerateContentResponse;

    if (!response.ok) {
      const message = payload.error?.message ?? `HTTP ${response.status}`;
      return {
        ok: false,
        games: [],
        status: response.status,
        message,
        fatal: isAuthFailure(response.status, message),
      };
    }

    if (payload.promptFeedback?.blockReason) {
      return { ok: false, games: [], message: `blocked: ${payload.promptFeedback.blockReason}` };
    }

    const text = (payload.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("")
      .trim();
    if (!text) {
      const finish = payload.candidates?.[0]?.finishReason ?? "empty response";
      return { ok: false, games: [], message: `no usable text (${finish})` };
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return { ok: false, games: [], message: "model did not return JSON" };
    }

    const { subjectTeam, games } = sanitizeScheduleImageResponse(raw);
    if (games.length === 0) {
      return { ok: false, games: [], message: "no games found in the image" };
    }
    return { ok: true, games, ...(subjectTeam ? { subjectTeam } : {}) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "request failed";
    return { ok: false, games: [], message };
  }
};

type ParseResult = {
  ok: boolean;
  games: ParsedScheduleGame[];
  subjectTeam?: string;
  model: string;
  status: number;
  error: ScheduleImageError | null;
};

const parseFailure = (status: number, error: ScheduleImageError): ParseResult => ({
  ok: false,
  games: [],
  model: "",
  status,
  error,
});

const parseImage = async (
  apiKey: string,
  imageBase64: string,
  mimeType: string,
  deadline: number
): Promise<ParseResult> => {
  const candidates = await resolveModelCandidates(apiKey);
  if (candidates.length === 0) {
    return parseFailure(502, {
      error: "No Gemini model is available for this API key.",
      reason: "no-model",
    });
  }

  const failures: string[] = [];
  let sawRateLimit = false;

  for (const model of candidates) {
    const remaining = deadline - Date.now();
    if (remaining <= 500) break;

    const attempt = await parseWithModel(
      apiKey,
      model,
      imageBase64,
      mimeType,
      Math.min(PER_ATTEMPT_TIMEOUT_MS, remaining)
    );
    if (attempt.ok) {
      return {
        ok: true,
        games: attempt.games,
        ...(attempt.subjectTeam ? { subjectTeam: attempt.subjectTeam } : {}),
        model,
        status: 200,
        error: null,
      };
    }

    failures.push(`${model}: ${attempt.message}`);
    if (attempt.status === 429) sawRateLimit = true;
    if (attempt.fatal) {
      console.error("[parse-schedule-image] Gemini rejected the API key:", attempt.message);
      return parseFailure(502, {
        error: "Gemini rejected the configured API key.",
        reason: "upstream-error",
      });
    }
  }

  console.error("[parse-schedule-image] all Gemini candidates failed:", failures.join(" | "));
  return sawRateLimit
    ? parseFailure(429, {
        error: `Gemini rate-limited every model tried (${candidates.join(", ")}). Try again shortly.`,
        reason: "rate-limited",
      })
    : parseFailure(502, {
        error: "Gemini could not read that screenshot.",
        reason: "upstream-error",
      });
};

/**
 * GET handler: a health check you can open in a phone browser. A 404 means the function was never
 * deployed; a JSON body means it was, with `keyConfigured` saying whether the key reaches the
 * runtime. Reports no secret material — booleans, a key length, the deployed commit.
 */
const sendHealth = (res: ApiResponse): void => {
  const rawKey = process.env.GEMINI_API_KEY;
  const apiKey = rawKey?.trim();
  res.setHeader("cache-control", "no-store");
  res.status(200).json({
    endpoint: "parse-schedule-image",
    functionDeployed: true,
    keyConfigured: Boolean(apiKey),
    keyLength: apiKey?.length ?? 0,
    keyHadSurroundingWhitespace: Boolean(rawKey && rawKey !== rawKey.trim()),
    pinnedModel: process.env.GEMINI_MODEL?.trim() || null,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
  });
};

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method === "GET") {
    sendHealth(res);
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    sendError(res, 405, { error: "Use POST.", reason: "invalid-request" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    sendError(res, 503, {
      error: "GEMINI_API_KEY is not configured, so screenshots cannot be read.",
      reason: "unconfigured",
    });
    return;
  }

  // This app's own throttle, not Gemini's, and it fires before any model is attempted.
  if (isRateLimited(clientKey(req))) {
    sendError(res, 429, {
      error: `Too many screenshots from this browser: ${RATE_LIMIT_MAX_REQUESTS} a minute is this app's own limit, and no Gemini model was attempted. Wait a minute and retry.`,
      reason: "throttled",
    });
    return;
  }

  const body = readBody(req) as { imageBase64?: unknown; mimeType?: unknown } | null;
  const imageBase64 = typeof body?.imageBase64 === "string" ? body.imageBase64 : "";
  const mimeType = typeof body?.mimeType === "string" ? body.mimeType : "";
  if (!imageBase64 || !mimeType.startsWith("image/")) {
    sendError(res, 400, {
      error: "Request must include an image as base64 plus its image/* mime type.",
      reason: "invalid-request",
    });
    return;
  }
  if (imageBase64.length > SCHEDULE_IMAGE_LIMITS.imageBase64Length) {
    sendError(res, 400, {
      error: "That image is too large. Send a screenshot rather than a full-resolution photo.",
      reason: "invalid-request",
    });
    return;
  }

  const result = await parseImage(apiKey, imageBase64, mimeType, Date.now() + TOTAL_BUDGET_MS);
  if (!result.ok) {
    sendError(
      res,
      result.status,
      result.error ?? { error: "Gemini could not read that screenshot.", reason: "upstream-error" }
    );
    return;
  }

  res.setHeader("cache-control", "no-store");
  const payload: ScheduleImageResponse = {
    ...(result.subjectTeam ? { subjectTeam: result.subjectTeam } : {}),
    games: result.games,
    model: result.model,
  };
  res.status(200).json(payload);
}
