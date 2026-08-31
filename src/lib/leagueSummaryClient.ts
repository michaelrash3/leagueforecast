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
};

/**
 * Packs the deterministic recap into the request body. Only derived values
 * (recap lines, ranks, odds) are sent — never raw game logs — and the standings
 * table is trimmed to the teams around the cut line plus the top of the table,
 * which is the context the story actually needs.
 */
export const buildLeagueSummaryRequest = ({
  seasonLabel,
  cutoff,
  updateTitle,
  finalScores = [],
  recapItems,
  standings = [],
  fallback,
}: {
  seasonLabel: string;
  cutoff: number;
  updateTitle?: string;
  finalScores?: string[];
  recapItems: RecapItem[];
  standings?: LeagueSummaryStandingsInput[];
  fallback?: string;
}): LeagueSummaryRequest => {
  const rows = standings
    .map((team, index) => {
      const rank = team.rank ?? index + 1;
      return {
        rank,
        name: displayName(team.name),
        record: recordText(team),
        goldPct: team.goldPct ?? 0,
        status: team.status ?? "",
        insideCut: rank <= cutoff,
      };
    })
    .filter((row) => row.rank <= cutoff + 3 || row.rank <= 5);

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
      // A 404 means the function is not deployed at all (for example `vite dev`
      // without `vercel dev`), which is the same situation as a missing key.
      const reason =
        payload?.reason ?? (response.status === 404 ? "unconfigured" : "upstream-error");
      return {
        ok: false,
        reason,
        message: payload?.error ?? `Summary request failed (${response.status}).`,
      };
    }

    const payload = (await response.json()) as Partial<LeagueSummaryResponse>;
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
