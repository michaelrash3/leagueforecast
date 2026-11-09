/**
 * Browser side of the AI League Story.
 *
 * Talks to Firebase’s `leagueSummary` function, which holds the Gemini key. Every failure is
 * reported as data rather than thrown: the caller keeps rendering the
 * deterministic story, so a missing key or an offline deploy is invisible to
 * the reader.
 *
 * The function answers the accounts on the cloud copy's list alone, so every ask carries the
 * browser's sign-in (`gcAuthorization`, the same the GameChanger pulls carry), and a browser
 * with none asks nothing: the answer is known without the call.
 */

import { displayName, recordText } from "./format";
import { gcAuthorization } from "./gcAuthorization";
import type { RecapItem } from "./insights";
import {
  type AiProvider,
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
  SUMMARY_MEMBERS_ONLY_MESSAGES,
} from "./leagueSummary";

export type LeagueSummaryOutcome =
  | { ok: true; summary: string; model: string; provider: AiProvider }
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
  hasCutLine = true,
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
  hasCutLine?: boolean;
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
      insideCut: hasCutLine && rank <= cutoff,
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
    hasCutLine,
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
  /** The favourite's chance of winning, as a percent from 0 to 100. */
  winPct: number;
  impact?: string;
  date?: string;
};

/** One row of the Forecast board's game list, as much of it as the write-up is told. */
export type BoardGameForecast = {
  awayName: string;
  homeName: string;
  winnerName: string;
  /** The favourite's chance of winning, as the fraction from 0 to 1 the model gives. */
  winnerPct: number;
  impact?: { impactLabel: string };
  game: { date?: string };
};

/**
 * The Forecast board's game rows as the write-up's request takes them. The board holds each
 * favourite's chance as the model's fraction and the request takes a percent: the server clamps
 * it to 0–100 and prints it with a % sign. Sent as the fraction, a 63% favourite reached the
 * writer as "favored at 1%". It goes rounded as the board's Chance column rounds it, so the
 * write-up and the row it writes about name the same number.
 */
export const forecastGamesFor = (games: readonly BoardGameForecast[]): ForecastGameInput[] =>
  games.map((item) => ({
    awayName: item.awayName,
    homeName: item.homeName,
    favoriteName: item.winnerName,
    winPct: Math.round(item.winnerPct * 100),
    impact: item.impact?.impactLabel,
    date: item.game.date,
  }));

/**
 * Packs the Forecast board into a request: the projected finish for every team,
 * the model's upcoming game predictions, the games the app flags as highest
 * leverage, and the backtested accuracy so the write-up can say how much weight
 * the projection deserves.
 */
export const buildForecastSummaryRequest = ({
  seasonLabel,
  cutoff,
  hasCutLine = true,
  projections,
  gameForecasts = [],
  keyGames = [],
  modelAccuracy,
  season,
}: {
  seasonLabel: string;
  cutoff: number;
  hasCutLine?: boolean;
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
    insideCut: hasCutLine && row.projectedRank <= cutoff,
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
    hasCutLine,
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
  const signIn = await gcAuthorization();
  if (!signIn) {
    return {
      ok: false,
      reason: "members-only",
      message: SUMMARY_MEMBERS_ONLY_MESSAGES["signed-out"],
    };
  }
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${signIn}` },
      body: JSON.stringify(request),
      signal,
    });

    if (!response.ok) {
      // The door that turns away a caller not on the list says why in `message`.
      const payload = (await response.json().catch(() => null)) as
        (Partial<LeagueSummaryError> & { message?: string }) | null;
      // A 404 means the function is not deployed or not routed (for example
      // a Firebase deploy missing the summary function). That is a different problem from a
      // deployed function that cannot see the key, so it gets its own reason —
      // reporting it as "no API key" sends you looking in the wrong place.
      const reason =
        payload?.reason ?? (response.status === 404 ? "endpoint-missing" : "upstream-error");
      return {
        ok: false,
        reason,
        message:
          payload?.error ??
          payload?.message ??
          (response.status === 404
            ? `No summary function is deployed at ${endpoint}.`
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
        message: `${endpoint} did not return JSON; the summary function is probably not deployed.`,
      };
    }
    const summary = typeof payload.summary === "string" ? payload.summary.trim() : "";
    if (!summary) {
      return { ok: false, reason: "upstream-error", message: "The AI returned an empty summary." };
    }
    // Groq writes one when Gemini could not; a function from before it says nothing, and was Gemini.
    const provider: AiProvider = payload.source === "groq" ? "groq" : "gemini";
    return { ok: true, summary, model: payload.model ?? provider, provider };
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

/** Shape of the Firebase `GET /leagueSummary` health payload. */
