import { standingsPoints } from "./sim";
import type { Settings, TeamWithProjection } from "./types";

export const formatGoldPct = (team: TeamWithProjection) => {
  if (team.goldStatus !== "Eliminated" && team.goldPct > 0 && team.goldPct < 1) return "<1%";
  if (team.goldStatus !== "Clinched" && team.goldPct >= 99.5) return "99%+";
  if (team.goldStatus !== "Eliminated" && team.goldPct <= 0.5) return "<1%";
  return `${Math.round(team.goldPct)}%`;
};

export const titleRaceBadgeForTeam = (
  team: TeamWithProjection,
  dashboardRows: TeamWithProjection[],
  remainingCounts: Record<string, number>,
  settings: Settings
) => {
  const leader = dashboardRows[0];
  if (!leader || leader.id === team.id) return team.rank === 1 ? "Title Leader" : "";
  const teamBack = (leader.w - team.w + (team.l - leader.l) + (leader.t - team.t) * 0.5) / 2;
  const teamMax = standingsPoints(team, settings) + (remainingCounts[team.id] ?? 0) * settings.winPoints;
  const leaderCurrent = standingsPoints(leader, settings);
  if (teamMax < leaderCurrent) return "Title Eliminated";
  if (teamBack <= 2 && (team.rank ?? 99) <= 5) return "Title Contender";
  return "";
};
