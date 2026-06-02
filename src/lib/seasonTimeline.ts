import { formatGameDate, parseDateValue } from "./date";
import { displayName } from "./format";
import {
  calculateTeams,
  getMathGoldStatus,
  getRemainingCounts,
  rankOptionsFromSettings,
  rankTeams,
} from "./sim";
import { isFinal, parseNumber } from "./util";
import type { GameLog, Matchup, Settings, TeamBase } from "./types";

export type SeasonTimelineEntry = {
  id: string;
  date: string;
  label: string;
  score: string;
  winnerName: string;
  movement: string[];
  cutLineImpact: string;
};

type RankedStatus = { id: string; name: string; rank: number; goldStatus: string };

const snapshot = (
  teams: TeamBase[],
  matchups: Matchup[],
  logs: Record<string, GameLog>,
  settings: Settings
): RankedStatus[] => {
  const live = calculateTeams(teams, matchups, logs);
  const ranked = rankTeams(live, rankOptionsFromSettings(settings));
  const remaining = matchups.filter((game) => !isFinal(logs[game.id]));
  const remainingCounts = getRemainingCounts(ranked, remaining);
  return ranked.map((team) => ({
    id: team.id,
    name: team.name,
    rank: team.rank ?? 99,
    goldStatus: getMathGoldStatus(team, ranked, remainingCounts, settings.goldCutoff, settings)
      .goldStatus,
  }));
};

const rankLine = (name: string, before?: RankedStatus, after?: RankedStatus) => {
  if (!before || !after || before.rank === after.rank) return null;
  const verb = after.rank < before.rank ? "climbed" : "fell";
  return `${displayName(name)} ${verb} #${before.rank} → #${after.rank}`;
};

export const buildSeasonTimeline = (
  teams: TeamBase[],
  matchups: Matchup[],
  logs: Record<string, GameLog>,
  settings: Settings,
  limit = 8
): SeasonTimelineEntry[] => {
  const finals = [...matchups]
    .filter((game) => isFinal(logs[game.id]))
    .sort((a, b) => parseDateValue(a.date) - parseDateValue(b.date) || a.id.localeCompare(b.id));
  const workingLogs: Record<string, GameLog> = {};
  const entries: SeasonTimelineEntry[] = [];

  finals.forEach((game) => {
    const log = logs[game.id];
    if (!log) return;
    const before = snapshot(teams, matchups, workingLogs, settings);
    workingLogs[game.id] = log;
    const after = snapshot(teams, matchups, workingLogs, settings);
    const beforeById = new Map(before.map((item) => [item.id, item]));
    const afterById = new Map(after.map((item) => [item.id, item]));
    const away = afterById.get(game.away);
    const home = afterById.get(game.home);
    const awayRuns = parseNumber(log.awayRuns);
    const homeRuns = parseNumber(log.homeRuns);
    const winnerName =
      awayRuns === homeRuns
        ? "Tie"
        : displayName((awayRuns > homeRuns ? away : home)?.name ?? "Winner");
    const movements = [
      rankLine(away?.name ?? game.away, beforeById.get(game.away), away),
      rankLine(home?.name ?? game.home, beforeById.get(game.home), home),
    ].filter((item): item is string => Boolean(item));

    const cutLineMessages = after
      .map((team) => {
        const prev = beforeById.get(team.id);
        if (!prev) return null;
        if (prev.rank > settings.goldCutoff && team.rank <= settings.goldCutoff) {
          return `${displayName(team.name)} moved into Gold`;
        }
        if (prev.rank <= settings.goldCutoff && team.rank > settings.goldCutoff) {
          return `${displayName(team.name)} dropped below Gold`;
        }
        if (prev.goldStatus !== team.goldStatus && team.goldStatus === "Clinched") {
          return `${displayName(team.name)} clinched Gold`;
        }
        if (prev.goldStatus !== team.goldStatus && team.goldStatus === "Eliminated") {
          return `${displayName(team.name)} were eliminated`;
        }
        return null;
      })
      .filter((item): item is string => Boolean(item));

    entries.push({
      id: game.id,
      date: formatGameDate(game.date),
      label: `${displayName(away?.name ?? game.away)} at ${displayName(home?.name ?? game.home)}`,
      score: `${awayRuns}-${homeRuns}`,
      winnerName,
      movement: movements.slice(0, 3),
      cutLineImpact: cutLineMessages[0] ?? `Gold cut line held after ${formatGameDate(game.date)}.`,
    });
  });

  return entries.reverse().slice(0, limit);
};
