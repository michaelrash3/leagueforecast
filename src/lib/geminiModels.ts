/**
 * Gemini model discovery + ranking.
 *
 * The app is not pinned to a single Gemini model: it asks the Generative
 * Language API which models the key can actually use, ranks them so the newest
 * generation is attempted first, and walks down the list when a model is
 * missing, rate limited, or failing. That way a new Gemini release is picked up
 * without a code change, and a retired model degrades to the next best one
 * instead of breaking the League Story.
 *
 * Pure module (no network, no browser/node globals) so it can be unit tested
 * and shared between the browser bundle and the serverless function.
 */

export const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** Shape of one entry in the `GET /v1beta/models` response. */
export type GeminiModelInfo = {
  name?: string;
  displayName?: string;
  description?: string;
  supportedGenerationMethods?: string[];
  inputTokenLimit?: number;
  outputTokenLimit?: number;
};

export type GeminiModelListResponse = {
  models?: GeminiModelInfo[];
  nextPageToken?: string;
};

/**
 * Tier preference used to break ties inside one Gemini generation. `flash` is
 * first on purpose: the League Story is a short summarization task, so the
 * faster/cheaper tier is the better default, and it carries the most generous
 * rate limits. `pro` is still tried right after it.
 */
export const GEMINI_TIER_ORDER = ["flash", "pro", "flash-lite", "nano", "ultra"] as const;

/**
 * Used only when `GET /models` is unavailable (network failure, restricted key).
 * Ordered newest-first by hand; unknown ids simply 404 and the next one is tried.
 */
export const GEMINI_FALLBACK_MODEL_IDS = [
  "gemini-flash-latest",
  "gemini-pro-latest",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash",
  "gemini-1.5-pro",
];

/**
 * Substrings that mark a model as not usable for plain text summarization
 * (embeddings, media generation, realtime audio, robotics, and so on).
 */
const EXCLUDED_MODEL_PATTERNS = [
  "embedding",
  "embed",
  "aqa",
  "imagen",
  "image",
  "veo",
  "video",
  "tts",
  "audio",
  "live",
  "realtime",
  "vision",
  "robotics",
  "computer-use",
];

export type ParsedGeminiModel = {
  id: string;
  /** Numeric generation, e.g. 2.5 for `gemini-2.5-flash`. */
  version: number;
  tier: string;
  /** 0 = stable, 1 = preview, 2 = experimental. Lower is preferred. */
  stability: number;
  /** True for alias ids such as `gemini-flash-latest` that always track the newest release. */
  isLatestAlias: boolean;
  /** True when the id pins a dated snapshot, e.g. `gemini-2.5-flash-preview-09-2025`. */
  isDatedSnapshot: boolean;
};

/** Strips the `models/` resource prefix the API returns. */
export const modelIdFromName = (name: string): string =>
  name.startsWith("models/") ? name.slice("models/".length) : name;

const stabilityOf = (id: string): number => {
  if (id.includes("-exp") || id.includes("experimental")) return 2;
  if (id.includes("preview")) return 1;
  return 0;
};

const tierOf = (id: string): string => {
  // Longest match wins so `flash-lite` is not read as `flash`.
  const match = [...GEMINI_TIER_ORDER]
    .sort((a, b) => b.length - a.length)
    .find((tier) => id.includes(tier));
  return match ?? "";
};

const versionOf = (id: string): number => {
  // `gemini-2.5-flash` → 2.5, `gemini-3-pro-preview` → 3, `gemini-flash-latest` → 0.
  const match = /gemini-(\d+)(?:\.(\d+))?/.exec(id);
  if (!match) return 0;
  const major = Number(match[1]);
  const minor = match[2] === undefined ? 0 : Number(match[2]);
  if (!Number.isFinite(major)) return 0;
  return major + (Number.isFinite(minor) ? minor / 10 : 0);
};

export const parseGeminiModelId = (rawId: string): ParsedGeminiModel => {
  const id = modelIdFromName(rawId).trim();
  return {
    id,
    version: versionOf(id),
    tier: tierOf(id),
    stability: stabilityOf(id),
    isLatestAlias: id.endsWith("-latest"),
    isDatedSnapshot: /-\d{2}-\d{2,4}$|-\d{3,8}$/.test(id),
  };
};

/** True when the model can serve `generateContent` text output for the League Story. */
export const isTextGenerationModel = (model: GeminiModelInfo): boolean => {
  const id = modelIdFromName(model.name ?? "").toLowerCase();
  if (!id.startsWith("gemini")) return false;
  if (EXCLUDED_MODEL_PATTERNS.some((pattern) => id.includes(pattern))) return false;
  const methods = model.supportedGenerationMethods;
  // Older list responses omit the field; assume generateContent is supported.
  if (!methods || methods.length === 0) return true;
  return methods.includes("generateContent");
};

const tierRank = (tier: string): number => {
  const index = (GEMINI_TIER_ORDER as readonly string[]).indexOf(tier);
  return index === -1 ? GEMINI_TIER_ORDER.length : index;
};

/**
 * Orders candidates so the newest usable model is attempted first.
 *
 * Sort keys, in order:
 *  1. Highest generation number (3 before 2.5 before 1.5). A `*-latest` alias
 *     carries no number of its own, so it inherits the newest generation in the
 *     set — it tracks whatever Google currently ships for its tier.
 *  2. Tier preference (see `GEMINI_TIER_ORDER`).
 *  3. Stable before preview before experimental within the same generation.
 *  4. Rolling ids before dated snapshots, then alphabetical for a stable order.
 *
 * The alphabetical tiebreak leaves an explicit `gemini-<n>-flash` just ahead of
 * `gemini-flash-latest`, so the newest named model is tried first and the alias
 * sits right behind it as the safety net.
 */
export const rankGeminiModelIds = (ids: string[]): string[] => {
  const seen = new Set<string>();
  const parsed: ParsedGeminiModel[] = [];
  ids.forEach((raw) => {
    const model = parseGeminiModelId(raw);
    if (!model.id || seen.has(model.id)) return;
    seen.add(model.id);
    parsed.push(model);
  });

  const newestVersion = parsed.reduce(
    (max, model) => (model.isLatestAlias ? max : Math.max(max, model.version)),
    0
  );
  const effectiveVersion = (model: ParsedGeminiModel) =>
    model.isLatestAlias ? Math.max(newestVersion, model.version) : model.version;

  return parsed
    .sort((a, b) => {
      const versionDelta = effectiveVersion(b) - effectiveVersion(a);
      if (versionDelta !== 0) return versionDelta;
      const tierDelta = tierRank(a.tier) - tierRank(b.tier);
      if (tierDelta !== 0) return tierDelta;
      if (a.stability !== b.stability) return a.stability - b.stability;
      if (a.isDatedSnapshot !== b.isDatedSnapshot) return a.isDatedSnapshot ? 1 : -1;
      return a.id.localeCompare(b.id);
    })
    .map((model) => model.id);
};

/** Filters a `GET /models` payload down to ranked, text-capable model ids. */
export const rankGeminiModels = (models: GeminiModelInfo[]): string[] =>
  rankGeminiModelIds(
    models.filter(isTextGenerationModel).map((model) => modelIdFromName(model.name ?? ""))
  );

/**
 * Final attempt order: an explicitly pinned model first, then everything the
 * key reported, then the hand-maintained fallbacks. Duplicates are dropped
 * while keeping the first (highest priority) position.
 */
export const buildModelCandidates = ({
  pinned,
  discovered = [],
  fallbacks = GEMINI_FALLBACK_MODEL_IDS,
  limit = 6,
}: {
  pinned?: string | null;
  discovered?: string[];
  fallbacks?: string[];
  limit?: number;
}): string[] => {
  const ordered: string[] = [];
  const push = (rawId: string | null | undefined) => {
    if (!rawId) return;
    const id = modelIdFromName(rawId).trim();
    if (!id || ordered.includes(id)) return;
    ordered.push(id);
  };

  push(pinned);
  discovered.forEach(push);
  fallbacks.forEach(push);
  return ordered.slice(0, Math.max(1, limit));
};

/** Why a model listing failed, kept so the health check can report it verbatim. */
export type GeminiDiscoveryError = {
  status?: number;
  /** Google's own status code, e.g. PERMISSION_DENIED. */
  code?: string;
  message: string;
};

export type GeminiDiscoveryResult = {
  ids: string[];
  error?: GeminiDiscoveryError;
};

type GeminiErrorResponse = {
  error?: { message?: string; status?: string; code?: number };
};

export type DiscoverOptions = {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  signal?: AbortSignal;
};

/**
 * Fetches the model list and, on failure, keeps Google's own status and
 * message. The generation path does not care why listing failed — it falls
 * through to `GEMINI_FALLBACK_MODEL_IDS` — but the health check does: "the key
 * is restricted to HTTP referrers" and "the API is not enabled" need different
 * fixes, and neither is guessable from an empty list.
 */
export const discoverGeminiModelsDetailed = async (
  apiKey: string,
  { fetchImpl = fetch, baseUrl = GEMINI_API_BASE, signal }: DiscoverOptions = {}
): Promise<GeminiDiscoveryResult> => {
  try {
    const response = await fetchImpl(`${baseUrl}/models?pageSize=200`, {
      method: "GET",
      headers: { "x-goog-api-key": apiKey },
      signal,
    });

    const payload = (await response.json().catch(() => ({}))) as GeminiModelListResponse &
      GeminiErrorResponse;

    if (!response.ok) {
      return {
        ids: [],
        error: {
          status: response.status,
          code: payload.error?.status,
          message: payload.error?.message ?? `HTTP ${response.status}`,
        },
      };
    }

    const ids = rankGeminiModels(payload.models ?? []);
    if (ids.length === 0) {
      return {
        ids,
        error: {
          status: response.status,
          message: "The key listed no model that supports generateContent.",
        },
      };
    }
    return { ids };
  } catch (error) {
    return {
      ids: [],
      error: { message: error instanceof Error ? error.message : "Model listing failed." },
    };
  }
};

/**
 * Model ids only. Returns `[]` (rather than throwing) so a discovery failure
 * just falls through to `GEMINI_FALLBACK_MODEL_IDS` and generation is still
 * attempted.
 */
export const discoverGeminiModels = async (
  apiKey: string,
  options: DiscoverOptions = {}
): Promise<string[]> => (await discoverGeminiModelsDetailed(apiKey, options)).ids;

/**
 * Smallest possible generateContent call, used only by the health check.
 *
 * Listing and generating can fail independently, so knowing that one works
 * tells you which half of the setup is wrong.
 */
export const probeGeminiGeneration = async (
  apiKey: string,
  model: string,
  { fetchImpl = fetch, baseUrl = GEMINI_API_BASE, signal }: DiscoverOptions = {}
): Promise<{ ok: boolean; model: string; error?: GeminiDiscoveryError }> => {
  try {
    const response = await fetchImpl(
      `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        signal,
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "Reply with the single word OK." }] }],
          generationConfig: { maxOutputTokens: 16, temperature: 0 },
        }),
      }
    );

    const payload = (await response.json().catch(() => ({}))) as GeminiErrorResponse;
    if (!response.ok) {
      return {
        ok: false,
        model,
        error: {
          status: response.status,
          code: payload.error?.status,
          message: payload.error?.message ?? `HTTP ${response.status}`,
        },
      };
    }
    return { ok: true, model };
  } catch (error) {
    return {
      ok: false,
      model,
      error: { message: error instanceof Error ? error.message : "Generation probe failed." },
    };
  }
};
