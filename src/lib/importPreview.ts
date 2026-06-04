import { isFinal } from "./util";
import type { GameLog, Matchup, TeamBase } from "./types";

export type SeasonImportPreview = {
  teams: number;
  games: number;
  finals: number;
  open: number;
  addedTeams: number;
  removedTeams: number;
  addedGames: number;
  removedGames: number;
  sampleTeams: string[];
  sampleGames: string[];
};

const countAdded = <T extends { id: string }>(incoming: T[], current: T[]) => {
  const currentIds = new Set(current.map((item) => item.id));
  return incoming.filter((item) => !currentIds.has(item.id)).length;
};

const countRemoved = <T extends { id: string }>(incoming: T[], current: T[]) => {
  const incomingIds = new Set(incoming.map((item) => item.id));
  return current.filter((item) => !incomingIds.has(item.id)).length;
};

export const buildSeasonImportPreview = (
  incomingTeams: TeamBase[],
  incomingMatchups: Matchup[],
  incomingLogs: Record<string, GameLog>,
  currentTeams: TeamBase[],
  currentMatchups: Matchup[],
  teamNameById: (teamId: string) => string
): SeasonImportPreview => {
  const finals = Object.values(incomingLogs).filter(isFinal).length;
  const sampleGames = incomingMatchups.slice(0, 3).map((game) => {
    const date = game.date ? `${game.date}: ` : "";
    return `${date}${teamNameById(game.away)} at ${teamNameById(game.home)}`;
  });

  return {
    teams: incomingTeams.length,
    games: incomingMatchups.length,
    finals,
    open: Math.max(0, incomingMatchups.length - finals),
    addedTeams: countAdded(incomingTeams, currentTeams),
    removedTeams: countRemoved(incomingTeams, currentTeams),
    addedGames: countAdded(incomingMatchups, currentMatchups),
    removedGames: countRemoved(incomingMatchups, currentMatchups),
    sampleTeams: incomingTeams.slice(0, 5).map((team) => teamNameById(team.id)),
    sampleGames,
  };
};

export const formatSeasonImportPreview = (
  preview: SeasonImportPreview,
  warningLines: string[] = []
) => {
  const lines = [
    `${preview.teams} teams · ${preview.games} games · ${preview.finals} finals · ${preview.open} open`,
    `Change summary: +${preview.addedTeams}/-${preview.removedTeams} teams · +${preview.addedGames}/-${preview.removedGames} games`,
  ];

  if (preview.sampleTeams.length) lines.push(`Teams preview: ${preview.sampleTeams.join(", ")}`);
  if (preview.sampleGames.length) lines.push(`Games preview: ${preview.sampleGames.join("; ")}`);
  if (warningLines.length) lines.push(`Warnings:\n- ${warningLines.join("\n- ")}`);

  return lines.join("\n\n");
};
