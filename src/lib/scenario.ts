import {
  attachAdjustedRatings,
  calculateTeams,
  predictGame,
  rankOptionsFromSettings,
  rankTeams,
} from "./sim";
import { isFinal } from "./util";
import type { GameLog, Matchup, Settings, Team, TeamBase } from "./types";

/**
 * One game settled by hand in the playoff machine: who wins, and by what score if the reader said.
 * Without a score it is the model's expected one, turned round where the pick goes against it.
 */
export type ScenarioPick = { winnerId: string; awayRuns?: number; homeRuns?: number };

/**
 * The score a pick is played out at.
 *
 * The standings need one — run differential breaks ties and caps a margin — and a winner alone
 * does not give it. The model's expected score is the honest default, since it is what the
 * forecast already assumes for that game; where the pick goes against the model, the two scores
 * swap sides so the picked side wins by what the model thought the other would. A tie the model
 * cannot break goes to the pick by a run. A typed score is used as typed, so long as it has the
 * picked side ahead; one that does not is read the same way as no score.
 */
export const pickedScore = (
  game: Matchup,
  pick: ScenarioPick,
  prediction: { awayScore: number; homeScore: number }
): { awayRuns: number; homeRuns: number } => {
  const awayWins = pick.winnerId === game.away;
  if (pick.awayRuns !== undefined && pick.homeRuns !== undefined) {
    const typedAwayWins = pick.awayRuns > pick.homeRuns;
    if (pick.awayRuns !== pick.homeRuns && typedAwayWins === awayWins) {
      return { awayRuns: pick.awayRuns, homeRuns: pick.homeRuns };
    }
  }
  const high = Math.max(Math.round(prediction.awayScore), Math.round(prediction.homeScore));
  const low = Math.min(Math.round(prediction.awayScore), Math.round(prediction.homeScore));
  const winner = high > low ? high : low + 1;
  return awayWins ? { awayRuns: winner, homeRuns: low } : { awayRuns: low, homeRuns: winner };
};

/** The season as it would stand with the picks played, ready to rank and to simulate the rest of. */
export type Scenario = {
  /** Every team, its record rebuilt with the picks as finals and its rating as it is now. */
  teams: Team[];
  /** The standings those records give, in order. */
  ranked: Array<Team & { rank: number }>;
  /** The games still to play once the picks are played. */
  remaining: Matchup[];
  /** The score each pick was played out at, by game. */
  scores: Record<string, { awayRuns: number; homeRuns: number }>;
};

/**
 * A season with some of its remaining games settled by hand.
 *
 * The picks go in as finals and every record is rebuilt from the logs, so wins, points, run
 * differential and head-to-head all come out of the same code the real standings do, and the
 * tiebreakers are the league's own. Ratings are left as they are: a pick is "what if we win", not
 * evidence about how good anybody is, and refitting on made-up results would move every other
 * forecast on the page. A pick on a game that has since been played is ignored — the real result
 * stands. Nothing here is saved.
 */
export const scenarioSeason = (
  base: {
    teams: TeamBase[];
    matchups: Matchup[];
    logs: Record<string, GameLog>;
    settings: Settings;
    /** The teams the forecast reads now, for each game's expected score. */
    liveTeams: Team[];
    ratings: { byTeam: Map<string, number>; games: Map<string, number> };
  },
  picks: Readonly<Record<string, ScenarioPick>>
): Scenario => {
  const liveById = new Map(base.liveTeams.map((team) => [team.id, team]));
  const logs = { ...base.logs };
  const scores: Scenario["scores"] = {};
  base.matchups.forEach((game) => {
    const pick = picks[game.id];
    if (!pick || isFinal(base.logs[game.id])) return;
    if (pick.winnerId !== game.away && pick.winnerId !== game.home) return;
    const prediction = predictGame(game, base.liveTeams, base.settings, liveById);
    const score = pickedScore(game, pick, prediction);
    scores[game.id] = score;
    const innings = base.logs[game.id]?.innings || String(base.settings.defaultGameInnings);
    logs[game.id] = {
      awayRuns: String(score.awayRuns),
      homeRuns: String(score.homeRuns),
      awayHits: "",
      homeHits: "",
      awayK: "",
      homeK: "",
      innings,
      isFinal: true,
    };
  });
  const teams = attachAdjustedRatings(
    calculateTeams(base.teams, base.matchups, logs, base.settings),
    base.ratings
  );
  return {
    teams,
    ranked: rankTeams(teams, rankOptionsFromSettings(base.settings)),
    remaining: base.matchups.filter((game) => !isFinal(logs[game.id])),
    scores,
  };
};
