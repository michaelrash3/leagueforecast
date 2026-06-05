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
  duplicateGames: number;
  reversedDuplicateGames: number;
  changedFinals: number;
  finalDowngrades: number;
  removedTeamsWithFinals: number;
  removedFinalGames: number;
  sampleTeams: string[];
  sampleGames: string[];
  reconciliationNotes: string[];
};

const countAdded = <T extends { id: string }>(incoming: T[], current: T[]) => {
  const currentIds = new Set(current.map((item) => item.id));
  return incoming.filter((item) => !currentIds.has(item.id)).length;
};

const countRemoved = <T extends { id: string }>(incoming: T[], current: T[]) => {
  const incomingIds = new Set(incoming.map((item) => item.id));
  return current.filter((item) => !incomingIds.has(item.id)).length;
};

const sameScore = (a?: GameLog, b?: GameLog) => {
  if (!a || !b) return false;
  return (
    a.awayRuns === b.awayRuns &&
    a.homeRuns === b.homeRuns &&
    a.awayHits === b.awayHits &&
    a.homeHits === b.homeHits &&
    a.awayK === b.awayK &&
    a.homeK === b.homeK &&
    a.innings === b.innings
  );
};

const gameSignature = (game: Matchup) => `${game.date}|${game.away}|${game.home}`;
const reversedGameSignature = (game: Matchup) => `${game.date}|${game.home}|${game.away}`;

export const buildSeasonImportPreview = (
  incomingTeams: TeamBase[],
  incomingMatchups: Matchup[],
  incomingLogs: Record<string, GameLog>,
  currentTeams: TeamBase[],
  currentMatchups: Matchup[],
  teamNameById: (teamId: string) => string,
  currentLogs: Record<string, GameLog> = {}
): SeasonImportPreview => {
  const finals = Object.values(incomingLogs).filter(isFinal).length;
  const incomingTeamIds = new Set(incomingTeams.map((team) => team.id));
  const incomingGameIds = new Set(incomingMatchups.map((game) => game.id));
  const currentById = new Map(currentMatchups.map((game) => [game.id, game]));
  const seenSignatures = new Set<string>();
  const seenReversedSignatures = new Set<string>();
  let duplicateGames = 0;
  let reversedDuplicateGames = 0;
  let changedFinals = 0;
  let finalDowngrades = 0;

  incomingMatchups.forEach((game) => {
    const signature = gameSignature(game);
    if (seenSignatures.has(signature)) duplicateGames += 1;
    seenSignatures.add(signature);

    if (seenReversedSignatures.has(signature)) reversedDuplicateGames += 1;
    seenReversedSignatures.add(reversedGameSignature(game));

    const currentGame = currentById.get(game.id);
    if (!currentGame) return;
    const currentLog = currentLogs[game.id];
    const incomingLog = incomingLogs[game.id];
    if (isFinal(currentLog) && !isFinal(incomingLog)) finalDowngrades += 1;
    if (isFinal(currentLog) && isFinal(incomingLog) && !sameScore(currentLog, incomingLog)) {
      changedFinals += 1;
    }
  });

  const removedFinalGames = currentMatchups.filter(
    (game) => !incomingGameIds.has(game.id) && isFinal(currentLogs[game.id])
  ).length;
  const removedTeamsWithFinals = currentTeams.filter((team) => {
    if (incomingTeamIds.has(team.id)) return false;
    return currentMatchups.some(
      (game) => (game.away === team.id || game.home === team.id) && isFinal(currentLogs[game.id])
    );
  }).length;

  const sampleGames = incomingMatchups.slice(0, 3).map((game) => {
    const date = game.date ? `${game.date}: ` : "";
    return `${date}${teamNameById(game.away)} at ${teamNameById(game.home)}`;
  });
  const reconciliationNotes = [
    duplicateGames
      ? `${duplicateGames} duplicate date/team game${duplicateGames === 1 ? "" : "s"}`
      : null,
    reversedDuplicateGames
      ? `${reversedDuplicateGames} possible home/away duplicate${reversedDuplicateGames === 1 ? "" : "s"}`
      : null,
    changedFinals
      ? `${changedFinals} completed score change${changedFinals === 1 ? "" : "s"}`
      : null,
    finalDowngrades
      ? `${finalDowngrades} completed game${finalDowngrades === 1 ? "" : "s"} becoming scheduled`
      : null,
    removedFinalGames
      ? `${removedFinalGames} completed game${removedFinalGames === 1 ? "" : "s"} removed`
      : null,
    removedTeamsWithFinals
      ? `${removedTeamsWithFinals} removed team${removedTeamsWithFinals === 1 ? "" : "s"} with finals`
      : null,
  ].filter((item): item is string => Boolean(item));

  return {
    teams: incomingTeams.length,
    games: incomingMatchups.length,
    finals,
    open: Math.max(0, incomingMatchups.length - finals),
    addedTeams: countAdded(incomingTeams, currentTeams),
    removedTeams: countRemoved(incomingTeams, currentTeams),
    addedGames: countAdded(incomingMatchups, currentMatchups),
    removedGames: countRemoved(incomingMatchups, currentMatchups),
    duplicateGames,
    reversedDuplicateGames,
    changedFinals,
    finalDowngrades,
    removedTeamsWithFinals,
    removedFinalGames,
    sampleTeams: incomingTeams.slice(0, 5).map((team) => teamNameById(team.id)),
    sampleGames,
    reconciliationNotes,
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
  if (preview.reconciliationNotes.length) {
    lines.push(`Reconciliation checks:\n- ${preview.reconciliationNotes.join("\n- ")}`);
  }
  if (warningLines.length) lines.push(`Warnings:\n- ${warningLines.join("\n- ")}`);

  return lines.join("\n\n");
};
