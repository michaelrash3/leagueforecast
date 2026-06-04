import type { TeamWithProjection } from "./types";

export type ProjectionConfidence = {
  label: "Stable" | "Volatile" | "Too close";
  tone: "emerald" | "amber" | "red";
  detail: string;
};

export const projectionConfidenceForTeam = (team: TeamWithProjection): ProjectionConfidence => {
  const margin = team.goldPctMargin ?? 0;
  const nearCutLine = Math.abs(team.goldPct - 50);
  const seedDelta = Math.abs((team.projectedRank ?? team.rank ?? 99) - (team.rank ?? 99));

  if (margin >= 12 || nearCutLine <= 12 || seedDelta >= 3) {
    return {
      label: "Too close",
      tone: "red",
      detail: "Gold odds are near the cut line, have a wide interval, or move multiple seeds.",
    };
  }

  if (margin >= 7 || nearCutLine <= 25 || seedDelta >= 2) {
    return {
      label: "Volatile",
      tone: "amber",
      detail: "Projection can still swing with remaining results.",
    };
  }

  return {
    label: "Stable",
    tone: "emerald",
    detail: "Projection is separated from the cut line with a tighter odds interval.",
  };
};
