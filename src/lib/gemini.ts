import type { RecapItem } from "./insights";

export const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";

export type GeminiRecapInput = {
  apiKey: string;
  seasonLabel: string;
  title: string;
  scores: string[];
  items: RecapItem[];
  model?: string;
  fetcher?: typeof fetch;
};

type GeminiPart = { text?: string };
type GeminiResponse = {
  candidates?: {
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }[];
  error?: { message?: string };
};

const GEMINI_NETWORK_ERROR_MESSAGE =
  "Could not reach Gemini from this browser. Check your internet connection, API key browser restrictions, and that generativelanguage.googleapis.com is allowed.";

const cleanApiKey = (apiKey: string) => apiKey.trim();

const isFetchNetworkError = (error: unknown) =>
  error instanceof TypeError && /fetch|network|load|cors/i.test(error.message);

const buildGeminiEndpoint = (model: string, apiKey?: string) => {
  const endpoint = new URL(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent`
  );
  if (apiKey) endpoint.searchParams.set("key", apiKey);
  return endpoint.toString();
};

export const buildGeminiRecapPrompt = ({
  seasonLabel,
  title,
  scores,
  items,
}: Pick<GeminiRecapInput, "seasonLabel" | "title" | "scores" | "items">) => {
  const facts = items
    .slice(0, 10)
    .map((item, index) => {
      const why = item.why?.length ? ` Why: ${item.why.join(" ")}` : "";
      return `${index + 1}. [${item.kind}] ${item.text}${why}`;
    })
    .join("\n");
  const scoreLines = scores.length ? scores.map((score) => `- ${score}`).join("\n") : "- None";

  return [
    "You are a concise, conversational youth sports standings writer.",
    "Write a short league recap using ONLY the facts below. Do not invent scores, teams, ranks, odds, injuries, quotes, dates, or future games.",
    "Keep it accurate, energetic, and easy to paste into a league update.",
    "Return 2 short paragraphs followed by 2-3 bullet takeaways. Avoid markdown headings.",
    "",
    `Season: ${seasonLabel}`,
    `Update: ${title}`,
    "Final scores:",
    scoreLines,
    "Key standings facts:",
    facts || "No major standings-impact items were generated.",
  ].join("\n");
};

export const extractGeminiText = (response: GeminiResponse): string => {
  if (response.error?.message) throw new Error(response.error.message);

  const text = response.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();

  if (!text) throw new Error("Gemini did not return recap text.");
  return text;
};

export const generateGeminiRecap = async ({
  apiKey,
  seasonLabel,
  title,
  scores,
  items,
  model = DEFAULT_GEMINI_MODEL,
  fetcher = fetch,
}: GeminiRecapInput): Promise<string> => {
  const key = cleanApiKey(apiKey);
  if (!key) throw new Error("Add a Gemini API key in Settings first.");

  const body = JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [{ text: buildGeminiRecapPrompt({ seasonLabel, title, scores, items }) }],
      },
    ],
    generationConfig: {
      temperature: 0.7,
      topP: 0.9,
      maxOutputTokens: 450,
    },
  });

  let response: Response;
  try {
    response = await fetcher(buildGeminiEndpoint(model), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key,
      },
      body,
    });
  } catch (error) {
    if (!isFetchNetworkError(error)) throw error;

    try {
      response = await fetcher(buildGeminiEndpoint(model, key), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
    } catch {
      throw new Error(GEMINI_NETWORK_ERROR_MESSAGE);
    }
  }

  const payload = (await response.json().catch(() => ({}))) as GeminiResponse;
  if (!response.ok) {
    throw new Error(payload.error?.message || `Gemini request failed (${response.status}).`);
  }

  return extractGeminiText(payload);
};
