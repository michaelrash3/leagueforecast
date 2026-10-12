/**
 * Groq model discovery, ranking and the one chat request the AI write-ups make of it.
 *
 * Groq is the second provider behind Gemini: the user added a Groq key on 28 September 2026 for
 * when Gemini's quota runs out, which it does at the busiest times, a day of results entered
 * at once. It is asked only once Gemini could not write a story, and it is asked the way Gemini
 * is: the key lists the models it can use, the list is put in this app's order of preference, and
 * the request walks down it until one answers, so a model Groq retires degrades to the next one
 * rather than breaking the write-up.
 *
 * Pure module (no network of its own, no browser or node globals) so it can be unit tested and
 * imported by the serverless function.
 */

export const GROQ_API_BASE = "https://api.groq.com/openai/v1";

/**
 * Chat models in the order they are tried, best first for a few paragraphs about a youth league.
 *
 * A general model heads it, ahead of the reasoning ones, because a reasoning model spends part of
 * its token budget thinking before it writes and a recap needs no thinking. Written by hand from
 * Groq's catalogue as this was written; the key's own list decides which of them are asked, and is
 * used as it stands where it lists none of them. When the list cannot be read at all these are
 * tried in this order, and one that has been retired answers 404 and the next is tried.
 */
export const GROQ_PREFERRED_MODEL_IDS = [
  "llama-3.3-70b-versatile",
  "meta-llama/llama-4-maverick-17b-128e-instruct",
  "moonshotai/kimi-k2-instruct",
  "openai/gpt-oss-120b",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "openai/gpt-oss-20b",
  "llama-3.1-8b-instant",
];

/**
 * What Groq also serves that cannot write the story: speech to text, text to speech, the safety
 * classifiers, and the agentic "compound" systems that search the web on their own account.
 */
const NOT_CHAT_PATTERNS = ["whisper", "tts", "playai", "orpheus", "guard", "compound"];

/** One entry of `GET /openai/v1/models`, as much of it as is read. */
export type GroqModelInfo = {
  id?: string;
  active?: boolean;
  created?: number;
};

type GroqModelListResponse = { data?: GroqModelInfo[] };

type GroqErrorResponse = { error?: { message?: string; type?: string; code?: string } };

/** True for a model that can take the story's chat request. */
export const isGroqChatModel = (model: GroqModelInfo): boolean => {
  const id = (model.id ?? "").trim().toLowerCase();
  if (!id || model.active === false) return false;
  return !NOT_CHAT_PATTERNS.some((pattern) => id.includes(pattern));
};

/**
 * The key's chat models in the order they are tried: the preferred ones in their order, then any
 * others it lists, newest first, so a model released since this list was written is still used
 * once the preferred ones are gone.
 */
export const rankGroqModels = (models: readonly GroqModelInfo[]): string[] => {
  const usable = models.filter(isGroqChatModel);
  const listed = new Set(usable.map((model) => (model.id ?? "").trim()));
  const preferred = GROQ_PREFERRED_MODEL_IDS.filter((id) => listed.has(id));
  const others = usable
    .filter((model) => !GROQ_PREFERRED_MODEL_IDS.includes((model.id ?? "").trim()))
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0) || (a.id ?? "").localeCompare(b.id ?? ""))
    .map((model) => (model.id ?? "").trim());
  return [...new Set([...preferred, ...others])];
};

/**
 * The order models are asked in: a pinned one (`GROQ_MODEL`) first, then what the key listed, or
 * the preferred list when it listed nothing, since a key that cannot list can often still write.
 */
export const buildGroqCandidates = ({
  pinned,
  discovered = [],
  limit = 3,
}: {
  pinned?: string | null;
  discovered?: readonly string[];
  limit?: number;
}): string[] => {
  const ordered: string[] = [];
  const push = (raw: string | null | undefined) => {
    const id = raw?.trim();
    if (id && !ordered.includes(id)) ordered.push(id);
  };
  push(pinned);
  (discovered.length > 0 ? discovered : GROQ_PREFERRED_MODEL_IDS).forEach(push);
  return ordered.slice(0, Math.max(1, limit));
};

/** Why a model listing failed, in Groq's own words, for the health check. */
export type GroqDiscoveryError = { status?: number; code?: string; message: string };

export type GroqDiscoveryResult = { ids: string[]; error?: GroqDiscoveryError };

export type GroqDiscoverOptions = {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  signal?: AbortSignal;
};

/** The key's chat models, ranked; on failure no ids and Groq's own status and message. */
export const discoverGroqModels = async (
  apiKey: string,
  { fetchImpl = fetch, baseUrl = GROQ_API_BASE, signal }: GroqDiscoverOptions = {}
): Promise<GroqDiscoveryResult> => {
  try {
    const response = await fetchImpl(`${baseUrl}/models`, {
      method: "GET",
      headers: { authorization: `Bearer ${apiKey}` },
      signal,
    });
    const payload = (await response.json().catch(() => ({}))) as GroqModelListResponse &
      GroqErrorResponse;
    if (!response.ok) {
      return {
        ids: [],
        error: {
          status: response.status,
          ...(payload.error?.code ? { code: payload.error.code } : {}),
          message: payload.error?.message ?? `HTTP ${response.status}`,
        },
      };
    }
    const ids = rankGroqModels(payload.data ?? []);
    return ids.length > 0
      ? { ids }
      : { ids, error: { status: response.status, message: "The key listed no chat model." } };
  } catch (error) {
    return {
      ids: [],
      error: { message: error instanceof Error ? error.message : "Model listing failed." },
    };
  }
};

/**
 * The chat request, OpenAI's shape, which Groq takes: the system instruction and the prompt the
 * Gemini request carries, at the same temperature and the same generous token cap.
 */
export const groqChatBody = (model: string, systemInstruction: string, prompt: string) => ({
  model,
  messages: [
    { role: "system", content: systemInstruction },
    { role: "user", content: prompt },
  ],
  temperature: 0.4,
  top_p: 0.9,
  max_completion_tokens: 2048,
});

export type GroqChatResponse = {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  error?: { message?: string; type?: string; code?: string };
};

/**
 * The written text of a chat answer, or why there is none.
 *
 * A reasoning model can put its thinking in the text between `<think>` tags; that is taken out,
 * since it is not the story. An answer cut off at the token cap is refused rather than shown
 * half-finished, and the next model is asked.
 */
export const readGroqChatText = (payload: GroqChatResponse): { text: string; problem?: string } => {
  const choice = payload.choices?.[0];
  if (choice?.finish_reason === "length") return { text: "", problem: "cut off at the token cap" };
  const text = (choice?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  return text
    ? { text }
    : { text: "", problem: `no usable text (${choice?.finish_reason ?? "empty"})` };
};
