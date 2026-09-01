/**
 * Browser side of the AI League Story.
 *
 * Talks to `/api/league-summary`, which holds the Gemini key. Every failure is
 * reported as data rather than thrown: the caller keeps rendering the
 * deterministic story, so a missing key or an offline deploy is invisible to
 * the reader.
 */

import { displayName, recordText } from "./format";
import type { RecapItem } from "./insights";
import {
  LEAGUE_SUMMARY_ENDPOINT,
  type LeagueSummaryError,
  type LeagueSummaryErrorReason,
  type LeagueSummaryGameForecast,
  type LeagueSummaryKeyGame,
  type LeagueSummaryModelAccuracy,
  type LeagueSummaryProjectionRow,
  type LeagueSummaryRequest,
  type LeagueSummaryResponse,
  type LeagueSummarySeasonContext,
} from "./leagueSummary";

export type LeagueSummaryOutcome =
  | { ok: true; summary: string; model: string }
  | { ok: false; reason: LeagueSummaryErrorReason; message: string };

export type LeagueSummaryStandingsInput = {
  rank?: number;
  name: string;
  w: number;
  l: number;
  t: number;
  goldPct?: number;
  status?: string;
  projectedRank?: number;
  runDiff?: number;
};

export type LeagueSummaryPowerInput = {
  rank: number;
  teamName: string;
  rating: number;
  record: string;
  trend: string;
  recentForm: number;
  sosRank: number;
};

export type LeagueSummaryStatMetricInput = {
  label: string;
  direction: "asc" | "desc";
  average: number | null;
  entries: { teamName: string; value: number | null }[];
};

/**
 * Packs everything the manager has entered into the request body: the recap
 * facts, the full standings table, the model's power ratings, and the stat
 * leaderboards. Only derived values are sent — ranks, odds, ratings, per-game
 * averages — never raw game logs.
 */
export const buildLeagueSummaryRequest = ({
  seasonLabel,
  cutoff,
  updateTitle,
  finalScores = [],
  recapItems,
  standings = [],
  powerRatings = [],
  statMetrics = [],
  season,
  fallback,
}: {
  seasonLabel: string;
  cutoff: number;
  updateTitle?: string;
  finalScores?: string[];
  recapItems: RecapItem[];
  standings?: LeagueSummaryStandingsInput[];
  powerRatings?: LeagueSummaryPowerInput[];
  statMetrics?: LeagueSummaryStatMetricInput[];
  season?: LeagueSummarySeasonContext;
  fallback?: string;
}): LeagueSummaryRequest => {
  const rows = standings.map((team, index) => {
    const rank = team.rank ?? index + 1;
    return {
      rank,
      name: displayName(team.name),
      record: recordText(team),
      goldPct: team.goldPct ?? 0,
      status: team.status ?? "",
      insideCut: rank <= cutoff,
      projectedRank: team.projectedRank,
      runDiff: team.runDiff,
    };
  });

  const power = powerRatings.map((row) => ({
    rank: row.rank,
    name: displayName(row.teamName),
    rating: row.rating,
    record: row.record,
    trend: row.trend,
    recentForm: row.recentForm,
    sosRank: row.sosRank,
  }));

  // One leader (plus the runner-up for context) per metric; metrics with no
  // finalized games yet have null values and are dropped rather than sent as 0.
  const statLeaders = statMetrics.flatMap((metric) => {
    const ranked = metric.entries.filter((entry) => entry.value !== null);
    const leader = ranked[0];
    if (!leader || leader.value === null) return [];
    const runnerUp = ranked[1];
    return [
      {
        metric: metric.label,
        leaderName: displayName(leader.teamName),
        leaderValue: leader.value,
        runnerUpName: runnerUp ? displayName(runnerUp.teamName) : undefined,
        runnerUpValue: runnerUp?.value ?? undefined,
        leagueAverage: metric.average,
        direction: metric.direction,
      },
    ];
  });

  return {
    kind: "league-story",
    seasonLabel,
    cutoff,
    updateTitle,
    finalScores,
    facts: recapItems.map((item) => ({
      kind: item.kind,
      text: item.text,
      impactScore: item.impactScore,
    })),
    standings: rows,
    powerRatings: power,
    statLeaders,
    season,
    fallback,
  };
};

export type ForecastProjectionInput = {
  name: string;
  projectedRank: number;
  currentRank?: number;
  projectedRecord: string;
  goldPct: number;
  goldMargin?: number;
  bestSeed?: number;
  worstSeed?: number;
};

export type ForecastGameInput = {
  awayName: string;
  homeName: string;
  favoriteName: string;
  winPct: number;
  impact?: string;
  date?: string;
};

/**
 * Packs the Forecast board into a request: the projected finish for every team,
 * the model's upcoming game predictions, the games the app flags as highest
 * leverage, and the backtested accuracy so the write-up can say how much weight
 * the projection deserves.
 */
export const buildForecastSummaryRequest = ({
  seasonLabel,
  cutoff,
  projections,
  gameForecasts = [],
  keyGames = [],
  modelAccuracy,
  season,
}: {
  seasonLabel: string;
  cutoff: number;
  projections: ForecastProjectionInput[];
  gameForecasts?: ForecastGameInput[];
  keyGames?: LeagueSummaryKeyGame[];
  modelAccuracy?: LeagueSummaryModelAccuracy;
  season?: LeagueSummarySeasonContext;
}): LeagueSummaryRequest => {
  const rows: LeagueSummaryProjectionRow[] = projections.map((row) => ({
    projectedRank: row.projectedRank,
    name: displayName(row.name),
    currentRank: row.currentRank,
    projectedRecord: row.projectedRecord,
    goldPct: row.goldPct,
    goldMargin: row.goldMargin,
    bestSeed: row.bestSeed,
    worstSeed: row.worstSeed,
    insideCut: row.projectedRank <= cutoff,
  }));

  const games: LeagueSummaryGameForecast[] = gameForecasts.map((game) => ({
    matchup: `${displayName(game.awayName)} at ${displayName(game.homeName)}`,
    favorite: displayName(game.favoriteName),
    winPct: game.winPct,
    impact: game.impact,
    date: game.date,
  }));

  return {
    kind: "forecast",
    seasonLabel,
    cutoff,
    facts: [],
    projections: rows,
    gameForecasts: games,
    keyGames,
    modelAccuracy,
    season,
  };
};

export const requestLeagueSummary = async (
  request: LeagueSummaryRequest,
  {
    signal,
    fetchImpl = fetch,
    endpoint = LEAGUE_SUMMARY_ENDPOINT,
  }: { signal?: AbortSignal; fetchImpl?: typeof fetch; endpoint?: string } = {}
): Promise<LeagueSummaryOutcome> => {
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as LeagueSummaryError | null;
      // A 404 means the function is not deployed or not routed (for example
      // `vite dev` without `vercel dev`). That is a different problem from a
      // deployed function that cannot see the key, so it gets its own reason —
      // reporting it as "no API key" sends you looking in the wrong place.
      const reason =
        payload?.reason ?? (response.status === 404 ? "endpoint-missing" : "upstream-error");
      return {
        ok: false,
        reason,
        message:
          payload?.error ??
          (response.status === 404
            ? "No function is deployed at /api/league-summary."
            : `Summary request failed (${response.status}).`),
      };
    }

    // A 200 that is not JSON means an SPA/static fallback answered instead of
    // the function, which is the same "no endpoint here" situation as a 404.
    const payload = (await response
      .json()
      .catch(() => null)) as Partial<LeagueSummaryResponse> | null;
    if (!payload) {
      return {
        ok: false,
        reason: "endpoint-missing",
        message: "/api/league-summary did not return JSON; the function is probably not deployed.",
      };
    }
    const summary = typeof payload.summary === "string" ? payload.summary.trim() : "";
    if (!summary) {
      return { ok: false, reason: "upstream-error", message: "Gemini returned an empty summary." };
    }
    return { ok: true, summary, model: payload.model ?? "gemini" };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, reason: "upstream-error", message: "Summary request cancelled." };
    }
    return {
      ok: false,
      reason: "upstream-error",
      message: error instanceof Error ? error.message : "Summary request failed.",
    };
  }
};

/** Shape of the `GET /api/league-summary` health payload. */
export type LeagueSummaryHealth = {
  endpoint?: string;
  functionDeployed?: boolean;
  keyConfigured?: boolean;
  keyLength?: number;
  keyHadSurroundingWhitespace?: boolean;
  pinnedModel?: string | null;
  vercelEnv?: string | null;
  commit?: string | null;
  probe?: unknown;
};

export type LeagueSummaryHealthOutcome =
  | { ok: true; health: LeagueSummaryHealth }
  | { ok: false; reason: "endpoint-missing" | "unreachable"; message: string };

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
  try {
    const response = await fetchImpl(probe ? `${endpoint}?probe=1` : endpoint, {
      method: "GET",
      headers: { accept: "application/json" },
      signal,
    });

    const health = (await response.json().catch(() => null)) as LeagueSummaryHealth | null;

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
    return "Google says the key itself is not valid. Check it was copied whole and belongs to this project.";
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

/** Turns a health result into one sentence a person can act on. */
export const describeLeagueSummaryHealth = (outcome: LeagueSummaryHealthOutcome): string => {
  if (!outcome.ok) {
    return outcome.reason === "endpoint-missing"
      ? "Nothing is serving /api/league-summary, so the function is not deployed. That is a build or routing problem, not the API key."
      : `Could not reach /api/league-summary: ${outcome.message}`;
  }

  const { health } = outcome;
  const where = [
    health.vercelEnv ? `env ${health.vercelEnv}` : "",
    health.commit ? `build ${health.commit}` : "",
  ]
    .filter(Boolean)
    .join(", ");
  const suffix = where ? ` (${where})` : "";

  if (!health.keyConfigured) {
    return `The function is deployed${suffix} but GEMINI_API_KEY is not reaching it. Set the variable for this environment and redeploy — Vercel scopes variables per environment and does not apply a new one until the next build.`;
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
    const google = error?.message ? ` Google said: "${error.message}"` : "";
    const advice = explainGeminiRejection(error);
    return `The function is deployed${suffix} and a key is set (${health.keyLength ?? 0} characters), but Gemini would not accept it.${google}${advice ? ` ${advice}` : ""}${whitespace}`;
  }

  return `The function is deployed${suffix} and a key is set (${health.keyLength ?? 0} characters).${whitespace}`;
};
