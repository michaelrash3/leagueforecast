import { displayName } from "./format";
import type { GameLog, Matchup, Team } from "./types";
import { isFinal, parseNumber } from "./util";

export type ScheduleDifficulty = {
  label: "Complete" | "Easy" | "Medium" | "Hard";
  rating: number;
  opponents: string;
};

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const recordAdjustment = (team: Team) => (team.pct - 0.5) * 6;

type TeamGameVsAverage = {
  offenseVsAllowed: number;
  defenseVsScored: number;
};

const completedGamesAgainstAverages = (
  team: Team,
  matchups: Matchup[],
  logs: Record<string, GameLog>,
  teamById: Map<string, Team>
): TeamGameVsAverage[] => {
  return matchups.flatMap((game) => {
    if (game.away !== team.id && game.home !== team.id) return [];
    const log = logs[game.id];
    if (!log || !isFinal(log)) return [];

    const teamIsAway = game.away === team.id;
    const opponent = teamById.get(teamIsAway ? game.home : game.away);
    if (!opponent || opponent.games === 0) return [];

    const teamRuns = parseNumber(teamIsAway ? log.awayRuns : log.homeRuns);
    const opponentRuns = parseNumber(teamIsAway ? log.homeRuns : log.awayRuns);

    return [
      {
        offenseVsAllowed: teamRuns - opponent.rag,
        defenseVsScored: opponent.rsg - opponentRuns,
      },
    ];
  });
};

export const teamPerformanceDifficultyScore = (
  team: Team,
  leagueTeams: Team[],
  matchups: Matchup[] = [],
  logs: Record<string, GameLog> = {}
) => {
  const teamById = new Map(leagueTeams.map((item) => [item.id, item]));
  const gameSplits = completedGamesAgainstAverages(team, matchups, logs, teamById);
  const recordScore = recordAdjustment(team);

  if (gameSplits.length) {
    const offenseVsAllowed = average(gameSplits.map((game) => game.offenseVsAllowed));
    const defenseVsScored = average(gameSplits.map((game) => game.defenseVsScored));

    // Difficulty is based on opponent-adjusted performance: scoring more than
    // opponents usually allow and holding opponents below what they usually score.
    // Record is included, but the opponent-adjusted run profile is the main signal.
    return offenseVsAllowed * 0.45 + defenseVsScored * 0.45 + recordScore * 0.1;
  }

  const teamsWithGames = leagueTeams.filter((item) => item.games > 0);
  const sample = teamsWithGames.length ? teamsWithGames : leagueTeams;
  const leagueRunsScored = average(sample.map((item) => item.rsg));
  const leagueRunsAllowed = average(sample.map((item) => item.rag));
  const offenseVsLeagueAllowed = team.rsg - leagueRunsAllowed;
  const defenseVsLeagueScored = leagueRunsScored - team.rag;

  return offenseVsLeagueAllowed * 0.45 + defenseVsLeagueScored * 0.45 + recordScore * 0.1;
};

export const scheduleDifficultyForTeam = (
  teamId: string,
  remainingGames: Matchup[],
  teams: Team[],
  allMatchups: Matchup[] = [],
  logs: Record<string, GameLog> = {}
): ScheduleDifficulty => {
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const games = remainingGames.filter((game) => game.away === teamId || game.home === teamId);

  if (!games.length) {
    return { label: "Complete", rating: 0, opponents: "No games left" };
  }

  const opponents = games.map((game) => {
    const opponentId = game.away === teamId ? game.home : game.away;
    const opponent = teamById.get(opponentId);
    if (!opponent) {
      return {
        name: displayName(opponentId),
        rating: 0,
        summary: `${displayName(opponentId)} (no profile yet)`,
      };
    }

    return {
      name: displayName(opponent.name),
      rating: teamPerformanceDifficultyScore(opponent, teams, allMatchups, logs),
      summary: `${displayName(opponent.name)} (${opponent.rsg.toFixed(1)} R/G, ${opponent.rag.toFixed(1)} RA/G)`,
    };
  });

  const rating = average(opponents.map((opponent) => opponent.rating));
  const label = rating >= 1.25 ? "Hard" : rating >= -0.5 ? "Medium" : "Easy";

  return {
    label,
    rating,
    opponents: opponents
      .sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name))
      .map((opponent) => opponent.summary)
      .join(", "),
  };
};
