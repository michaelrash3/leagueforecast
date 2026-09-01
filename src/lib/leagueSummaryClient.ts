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
