import type { AiModel } from "./types";

export type GeminiSurface =
  | "team-summary"
  | "impact-recap"
  | "game-forecast"
  | "compare";

export type TeamBundle = {
  surface: "team-summary";
  team: {
    name: string;
    rank: number;
    projectedRank: number;
    goldPct: number;
    record: string;
    runDiff: number;
    rsg: number;
    rag: number;
    tpi: number;
    goldStatus: string;
    magicGold: string;
    eliminationGold: string;
  };
  cutoff: number;
  totalTeams: number;
  leaderName: string;
  nextTwo: { opp: string; home: boolean; winSeed: number; lossSeed: number; teamWinPct: number }[];
};

export type ImpactBundle = {
  surface: "impact-recap";
  seasonLabel: string;
  cutoff: number;
  scores: string[]; // ["Stallions 8, Griddy 4", ...]
  changes: string[]; // bullet list from weeklyRecap insights
};

export type GameForecastBundle = {
  surface: "game-forecast";
  awayName: string;
  homeName: string;
  date: string;
  pickName: string;
  pickPct: number;
  spread: string;
  confidence: string;
  upsetRisk: string;
  edges: {
    scoring: number; // away.rsg - home.rsg
    prevention: number; // home.rag - away.rag
    tpi: number; // away.tpi - home.tpi
    contact: number; // away contact edge
  };
  impact: { awaySeedSwing: number; homeSeedSwing: number; awayGoldSwing: number; homeGoldSwing: number; impactLabel: string };
};

export type CompareBundle = {
  surface: "compare";
  cutoff: number;
  left: { name: string; rank: number; projectedRank: number; goldPct: number; record: string; rsg: number; rag: number; tpi: number };
  right: { name: string; rank: number; projectedRank: number; goldPct: number; record: string; rsg: number; rag: number; tpi: number };
  headToHead: { leftWins: number; rightWins: number; ties: number };
  commonOpponents: string[];
};

export type GeminiBundle =
  | TeamBundle
  | ImpactBundle
  | GameForecastBundle
  | CompareBundle;

// ---------- Prompt assembly ----------

const SYSTEM_PREAMBLE =
  "You write concise sports-tracker copy for a youth baseball season tracker. " +
  "Use only the facts in the JSON payload. Do not invent records, opponents, or dates. " +
  "Avoid hedging filler. No bullet lists. No headers. Plain prose only.";

const PROMPT_FOR: Record<GeminiSurface, string> = {
  "team-summary":
    "Write 2-3 sentences summarizing where this team stands in the Gold Bracket race. " +
    "Lead with their current seed and projected seed; weave in their record, Gold odds, " +
    "and the most consequential of the two upcoming swing games. Tone: confident, " +
    "informed, slightly conversational — like a beat writer's note.",
  "impact-recap":
    "Write 2-3 sentences recapping what changed since the last update. Foreground clinches, " +
    "eliminations, or cut-line crossings if they exist; otherwise focus on the biggest mover. " +
    "Mention specific teams from the bundle by name. Tone: brisk, informative.",
  "game-forecast":
    "Write 1-2 sentences explaining why the model favors the pick. Reference the strongest " +
    "edge from the bundle (scoring, prevention, tpi, or contact). End with the confidence " +
    "level interpreted plainly. Do not list every edge — pick the most decisive one.",
  compare:
    "Write 1-2 sentences answering 'who is better right now and why', grounded in the metric " +
    "differences in the bundle. If the head-to-head is non-empty, mention it briefly. " +
    "Don't repeat the metric values verbatim — interpret them.",
};

export const buildPrompt = (bundle: GeminiBundle): string => {
  const facts = JSON.stringify(bundle, null, 2);
  return `${SYSTEM_PREAMBLE}\n\nTask: ${PROMPT_FOR[bundle.surface]}\n\nFacts:\n${facts}`;
};

// ---------- Hashing for cache key ----------

// FNV-1a over the canonical prompt — deterministic, fast, no crypto dep.
export const hashBundle = (bundle: GeminiBundle, model: AiModel): string => {
  const text = `${model}::${JSON.stringify(bundle)}`;
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
};

// ---------- API call ----------

export type GeminiError =
  | { kind: "missing-key" }
  | { kind: "auth" }
  | { kind: "rate-limit" }
  | { kind: "network"; message: string }
  | { kind: "parse"; message: string };

export type GeminiResult =
  | { ok: true; text: string }
  | { ok: false; error: GeminiError };

export async function callGemini(
  bundle: GeminiBundle,
  options: { apiKey: string; model: AiModel; signal?: AbortSignal }
): Promise<GeminiResult> {
  if (!options.apiKey) return { ok: false, error: { kind: "missing-key" } };

  const prompt = buildPrompt(bundle);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${options.model}:generateContent?key=${encodeURIComponent(options.apiKey)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          topP: 0.95,
          maxOutputTokens: 240,
        },
      }),
      signal: options.signal,
    });
  } catch (err) {
    return {
      ok: false,
      error: { kind: "network", message: err instanceof Error ? err.message : String(err) },
    };
  }

  if (response.status === 401 || response.status === 403) {
    return { ok: false, error: { kind: "auth" } };
  }
  if (response.status === 429) {
    return { ok: false, error: { kind: "rate-limit" } };
  }
  if (!response.ok) {
    return {
      ok: false,
      error: { kind: "network", message: `HTTP ${response.status}` },
    };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (err) {
    return {
      ok: false,
      error: { kind: "parse", message: err instanceof Error ? err.message : String(err) },
    };
  }

  const text = extractText(json);
  if (!text) {
    return { ok: false, error: { kind: "parse", message: "no candidates in response" } };
  }
  return { ok: true, text: text.trim() };
}

const extractText = (json: unknown): string | null => {
  if (typeof json !== "object" || json === null) return null;
  const candidates = (json as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || !candidates[0]) return null;
  const content = (candidates[0] as { content?: unknown }).content;
  if (typeof content !== "object" || content === null) return null;
  const parts = (content as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) return null;
  const text = parts
    .map((part) => (typeof part === "object" && part !== null && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : ""))
    .filter(Boolean)
    .join(" ");
  return text || null;
};

// ---------- Friendly error messages ----------

export const describeError = (error: GeminiError): string => {
  switch (error.kind) {
    case "missing-key":
      return "Add your Gemini API key in Settings to enable AI summaries.";
    case "auth":
      return "Gemini rejected the API key. Re-check it in Settings.";
    case "rate-limit":
      return "Gemini rate-limited the request. Try again in a moment.";
    case "network":
      return `Gemini call failed: ${error.message}.`;
    case "parse":
      return `Gemini response was unreadable: ${error.message}.`;
  }
};
