import { displayName } from "./format";
import type { Prediction, Team } from "./types";

/**
 * The small things a league view needs that are about the app's shape rather than its state.
 *
 * They lived in App.tsx, which meant a view could not be lifted out of that file without importing
 * back into it. Pure, none of them read state, and all of them are wanted in more than one place.
 */

/** `?team=` — which team's data page a link opens. */
export const TEAM_QUERY_PARAM = "team";

/** The team a link named, or nothing. */
export const linkedTeamIdFromUrl = (): string | null => {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(TEAM_QUERY_PARAM);
};

/** A link to one team's data page, keeping the rest of the URL and dropping any share hash. */
export const buildTeamDataHref = (teamId: string): string => {
  const encodedTeamId = encodeURIComponent(teamId);
  if (typeof window === "undefined") return `?${TEAM_QUERY_PARAM}=${encodedTeamId}`;

  const url = new URL(window.location.href);
  url.searchParams.set(TEAM_QUERY_PARAM, teamId);
  url.hash = "";
  return `${url.pathname}${url.search}`;
};

/** The forecast as a betting line would write it: "Aces -2.5". */
export const projectedRunLine = (prediction: Prediction, byId: Map<string, Team>): string => {
  const favorite = byId.get(prediction.winnerId);
  const favoriteName = favorite ? displayName(favorite.name) : prediction.winnerId;
  const rawMargin = Math.abs(prediction.awayScore - prediction.homeScore);
  const halfRunLine = Math.max(0.5, rawMargin - 0.5);
  return `${favoriteName} -${halfRunLine.toFixed(1)}`;
};

/** How safe the favourite looks: a close call on a thin margin is where upsets live. */
export const upsetRiskLabel = (winnerPct: number, margin: number): "High" | "Medium" | "Low" => {
  if (winnerPct < 0.58 || margin <= 2) return "High";
  if (winnerPct < 0.7 || margin <= 5) return "Medium";
  return "Low";
};
