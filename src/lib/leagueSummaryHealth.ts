import { gcAuthorization } from "./gcAuthorization";
import { LEAGUE_SUMMARY_ENDPOINT, SUMMARY_MEMBERS_ONLY_MESSAGES } from "./leagueSummary";

/*
 * The AI write-ups' health check, and what it says of the answer: run only when the AI panel's
 * Check is pressed, so fetched then (`App.tsx`) rather than carried in the first download beside
 * the write-ups' client (`leagueSummaryClient.ts`).
 */

export type LeagueSummaryHealth = {
  endpoint?: string;
  functionDeployed?: boolean;
  keyConfigured?: boolean;
  keyLength?: number;
  keyHadSurroundingWhitespace?: boolean;
  pinnedModel?: string | null;
  /** The Cloud Run revision serving the function. */
  revision?: string | null;
  probe?: unknown;
  /** The Groq key's side of it; absent from a function deployed before Groq was added. */
  groq?: {
    keyConfigured?: boolean;
    keyLength?: number;
    keyHadSurroundingWhitespace?: boolean;
    pinnedModel?: string | null;
    probe?: unknown;
  };
};

export type LeagueSummaryHealthOutcome =
  | { ok: true; health: LeagueSummaryHealth }
  | { ok: false; reason: "endpoint-missing" | "unreachable" | "members-only"; message: string };

/**
 * Runs the health check from inside the app.
 *
 * This is a `fetch`, not a navigation, so a stale service worker cannot answer
 * it from the cached app shell the way it does when the URL is typed into the
 * address bar. That makes this the reliable way to find out why the AI write-up
 * is off, without needing a private window or a fresh worker.
 */
export const fetchLeagueSummaryHealth = async ({
  probe = true,
  fetchImpl = fetch,
  endpoint = LEAGUE_SUMMARY_ENDPOINT,
  signal,
}: {
  probe?: boolean;
  fetchImpl?: typeof fetch;
  endpoint?: string;
  signal?: AbortSignal;
} = {}): Promise<LeagueSummaryHealthOutcome> => {
  const signIn = await gcAuthorization();
  if (!signIn) {
    return {
      ok: false,
      reason: "members-only",
      message: SUMMARY_MEMBERS_ONLY_MESSAGES["signed-out"],
    };
  }
  try {
    const response = await fetchImpl(probe ? `${endpoint}?probe=1` : endpoint, {
      method: "GET",
      headers: { accept: "application/json", authorization: `Bearer ${signIn}` },
      signal,
    });

    const health = (await response.json().catch(() => null)) as LeagueSummaryHealth | null;

    // Turned away at the door: an account not on the list, or a sign-in the list would not take.
    const refused = health as { reason?: unknown; message?: unknown } | null;
    if (
      (response.status === 401 || response.status === 403) &&
      refused?.reason === "members-only"
    ) {
      return {
        ok: false,
        reason: "members-only",
        message:
          typeof refused.message === "string"
            ? refused.message
            : SUMMARY_MEMBERS_ONLY_MESSAGES["not-member"],
      };
    }

    // A 404, or a 200 that is not JSON (the app shell), both mean nothing is
    // serving the endpoint.
    if (response.status === 404 || !health || typeof health !== "object") {
      return {
        ok: false,
        reason: "endpoint-missing",
        message: `No JSON from ${endpoint} (HTTP ${response.status}).`,
      };
    }

    return { ok: true, health };
  } catch (error) {
    return {
      ok: false,
      reason: "unreachable",
      message: error instanceof Error ? error.message : "Request failed.",
    };
  }
};

type HealthProbeError = { status?: number; code?: string; message?: string } | null;

type HealthProbe = {
  ok?: boolean;
  modelCount?: number;
  candidates?: string[];
  note?: string;
  /** Set when the probe never reached Gemini at all (the app's own throttle). */
  error?: string;
  listError?: HealthProbeError;
  generation?: { ok?: boolean; model?: string; error?: HealthProbeError } | null;
};

/**
 * Turns Google's rejection into the specific thing to change.
 *
 * A key restricted to HTTP referrers is the one that catches people out: it
 * works from a browser and fails from a server, which reads as "the key is
 * fine, the server is broken" when the opposite is true.
 */
const explainGeminiRejection = (error: HealthProbeError): string => {
  const message = error?.message ?? "";
  const code = error?.code ?? "";
  const combined = `${code} ${message}`.toLowerCase();

  if (combined.includes("referer") || combined.includes("referrer")) {
    return "That key is restricted to HTTP referrers, which only works from a browser — a server has no referrer, so Google blocks it. Remove the referrer restriction, or make a second unrestricted key for the server.";
  }
  if (combined.includes("api key not valid") || combined.includes("api_key_invalid")) {
    return "Google says the key itself is not valid. Check that GEMINI_API_KEY holds the right key — not another project's, and not a partial paste.";
  }
  if (combined.includes("has not been used") || combined.includes("is disabled")) {
    return "The Generative Language API is not enabled for this key's Google Cloud project. Enable it, then retry.";
  }
  if (combined.includes("ip") && combined.includes("blocked")) {
    return "That key is restricted by IP address, and serverless functions do not have a fixed one. Remove the IP restriction, or use a separate unrestricted key for the server.";
  }
  if (combined.includes("quota") || combined.includes("resource_exhausted")) {
    return "The key is over its quota rather than misconfigured. It should work again once the quota resets.";
  }
  return "";
};

type GroqHealthProbe = {
  ok?: boolean;
  modelCount?: number;
  candidates?: string[];
  /** Set when the probe never reached Groq (the app's own throttle). */
  error?: string;
  listError?: HealthProbeError;
};

/**
 * The Groq key's sentence: whether it reaches the function and, when the probe asked, whether Groq
 * lists models for it. Empty for a function from before Groq, which says nothing about it.
 */
const describeGroqHealth = (groq: LeagueSummaryHealth["groq"], alone: boolean): string => {
  if (!groq) return "";
  if (!groq.keyConfigured) {
    return "No GROQ_API_KEY reaches the function, so nothing writes the story when Gemini cannot. If one is set, check its name and environment, and redeploy.";
  }
  const whitespace = groq.keyHadSurroundingWhitespace
    ? " The stored Groq key has stray whitespace around it, which is worth removing."
    : "";
  const set = `A GROQ_API_KEY is set (${groq.keyLength ?? 0} characters)`;
  const probe = groq.probe as GroqHealthProbe | undefined;
  if (!probe || typeof probe !== "object") {
    return `${set}${alone ? "" : " for when Gemini cannot write the story"}.${whitespace}`;
  }
  if (probe.ok === true) {
    const first = probe.candidates?.[0];
    const lists = `lists ${probe.modelCount ?? 0} usable models${first ? `, ${first} first` : ""}`;
    return `${alone ? `Groq's key ${lists}` : `Groq takes over when Gemini cannot: its key ${lists}`}.${whitespace}`;
  }
  if (!probe.listError && probe.error) return `${set}. ${probe.error}${whitespace}`;
  const said = probe.listError?.message ? ` Groq said: "${probe.listError.message}"` : "";
  const advice =
    probe.listError?.status === 401
      ? " Check that GROQ_API_KEY holds the whole key from the Groq console."
      : "";
  return `${set}, but Groq would not list models for it.${said}${advice}${whitespace}`;
};

const describeGeminiHealth = (outcome: LeagueSummaryHealthOutcome): string => {
  if (!outcome.ok) {
    if (outcome.reason === "members-only") return outcome.message;
    return outcome.reason === "endpoint-missing"
      ? "The Firebase leagueSummary function is unavailable. Check the Firebase functions deployment."
      : `Could not reach the Firebase leagueSummary function: ${outcome.message}`;
  }

  const { health } = outcome;
  const suffix = health.revision ? ` (revision ${health.revision})` : "";

  if (!health.keyConfigured) {
    // Groq's key alone is a working setup, not a missing variable: say which writes the stories
    // rather than prescribe a redeploy nobody needs.
    if (health.groq?.keyConfigured) {
      return `The function is deployed${suffix} with no GEMINI_API_KEY, so Groq writes every story.`;
    }
    return `The function is deployed${suffix} but GEMINI_API_KEY is not reaching it. Set the GEMINI_API_KEY GitHub Actions secret and redeploy Firebase functions.`;
  }

  const whitespace = health.keyHadSurroundingWhitespace
    ? " The stored key has stray whitespace around it, which is worth removing."
    : "";
  const probe = (health.probe ?? {}) as HealthProbe;

  if (probe.ok === true) {
    const first = probe.candidates?.[0];
    // Generation can work while listing does not; the app falls back to its
    // built-in model list, so that is still a working setup.
    if ((probe.modelCount ?? 0) === 0 && probe.generation?.ok) {
      return `Working, with a caveat: the function is deployed${suffix} and the key can generate, but it cannot list models, so the app uses its built-in model list instead of picking up new Gemini releases automatically.${whitespace}`;
    }
    return `Working: the function is deployed${suffix}, the key lists ${probe.modelCount ?? 0} usable models${first ? `, and ${first} is first in line` : ""}.${whitespace}`;
  }

  if (probe.ok === false) {
    const error = probe.generation?.error ?? probe.listError ?? null;
    // The probe can fail before Gemini is ever contacted — this app's own
    // throttle is the usual reason. Saying "Gemini would not accept it" there
    // sends people to check a key that was never tried, so report our own
    // reason in our own words instead.
    if (!error && probe.error) {
      return `The function is deployed${suffix} and a key is set (${health.keyLength ?? 0} characters). ${probe.error}${whitespace}`;
    }
    const google = error?.message ? ` Google said: "${error.message}"` : "";
    const advice = explainGeminiRejection(error);
    return `The function is deployed${suffix} and a key is set (${health.keyLength ?? 0} characters), but Gemini would not accept it.${google}${advice ? ` ${advice}` : ""}${whitespace}`;
  }

  return `The function is deployed${suffix} and a key is set (${health.keyLength ?? 0} characters).${whitespace}`;
};

/** Turns a health result into one sentence a person can act on, and one about Groq. */
export const describeLeagueSummaryHealth = (outcome: LeagueSummaryHealthOutcome): string => {
  if (!outcome.ok) return describeGeminiHealth(outcome);
  const gemini = describeGeminiHealth(outcome);
  const { health } = outcome;
  const groq = describeGroqHealth(health.groq, !health.keyConfigured);
  return groq ? `${gemini} ${groq}` : gemini;
};
