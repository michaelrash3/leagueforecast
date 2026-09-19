import { displayName } from "./format";
import {
  EDGE_PER_RUN_BEST_FIT,
  RATING_PRIOR_FLOOR,
  RATING_PRIOR_GROWTH,
  RATING_PRIOR_MIDPOINT,
} from "./sim";
import type { GameLog, Matchup, Team } from "./types";
import { isFinal, parseNumber } from "./util";

export type ScheduleDifficulty = {
  label: "Complete" | "Easy" | "Medium" | "Hard";
  rating: number;
  opponents: string;
};

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

/**
 * A record, as runs of margin against an average team.
 *
 * This was `(pct - 0.5) * 6`. The six came from nowhere — no sweep, no fit, nothing measured —
 * while the app already knew the answer: `EDGE_PER_RUN_BEST_FIT` is runs of margin per unit of win
 * edge, measured on simulated seasons, and a win percentage is a win edge once it is put through
 * a logit. So the conversion is the one the rest of the app uses, rather than a second one.
 *
 * The percentage is smoothed by half a win in one extra game before that. Two reasons, and both
 * were live bugs. A logit of 1.0 is infinite, so an undefeated team had no finite answer at all
 * under a principled conversion — and under the old linear one a 1-0 team read exactly as strong
 * as a 20-0 team, which is the same claim made quietly. And a team with no games at all had
 * `pct` of zero, so it read as the worst side in the league rather than as unknown; smoothing
 * lands it on 0.5, which is what "we have not seen them play" should say.
 *
 * None of this reaches a forecast. Strength of schedule is a figure on the Model view and in the
 * written summaries, and nothing in `sim.ts` reads it.
 */
const recordAdjustment = (team: Team) => {
  const smoothed = (team.w + team.t * 0.5 + 0.5) / (team.games + 1);
  return Math.log(smoothed / (1 - smoothed)) / EDGE_PER_RUN_BEST_FIT;
};

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

/**
 * Pull a run-profile difficulty score toward the opponent-adjusted rating.
 *
 * Both are expected run margin against an average team, so they are already on one scale and a
 * weighted blend needs no conversion. The weight is the one the game forecast uses for the same
 * job — it grows with the games the rating was fitted from — so a rating built on two games barely
 * moves the profile and one built on twenty largely replaces it.
 *
 * The profile alone could only ever say how a team did against this league. The rating knows who
 * it played and, where Team Rankings results are counted, knows about games this league never saw
 * — which is the difference between "they beat the teams here" and "they are good".
 */
const towardRating = (team: Team, profileScore: number) => {
  const rating = team.adjustedRating;
  if (rating === undefined || !Number.isFinite(rating)) return profileScore;
  const rated = Math.max(0, team.ratedGames ?? 0);
  if (rated <= 0) return profileScore;
  const weight =
    RATING_PRIOR_FLOOR + RATING_PRIOR_GROWTH * (rated / (rated + RATING_PRIOR_MIDPOINT));
  return profileScore + weight * (rating - profileScore);
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
    return towardRating(team, offenseVsAllowed * 0.45 + defenseVsScored * 0.45 + recordScore * 0.1);
  }

  const teamsWithGames = leagueTeams.filter((item) => item.games > 0);
  const sample = teamsWithGames.length ? teamsWithGames : leagueTeams;
  const leagueRunsScored = average(sample.map((item) => item.rsg));
  const leagueRunsAllowed = average(sample.map((item) => item.rag));
  const offenseVsLeagueAllowed = team.rsg - leagueRunsAllowed;
  const defenseVsLeagueScored = leagueRunsScored - team.rag;

  // A team with no completed league game of its own has nothing but the league average to go on —
  // unless Team Rankings has watched it play, which is exactly what the rating carries.
  return towardRating(
    team,
    offenseVsLeagueAllowed * 0.45 + defenseVsLeagueScored * 0.45 + recordScore * 0.1
  );
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
