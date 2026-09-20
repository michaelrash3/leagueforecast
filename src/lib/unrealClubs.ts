import { isDatedAhead } from "./deletedGames";
import type { GcImportState } from "./gameChangerImport";
import type { ScoutGame, ScoutTeam } from "./teamRankings";

/**
 * A club carrying results on days that have not happened, and how much of its record they are.
 *
 * Some of what a nationwide pull brings back is not a club. The tell is arithmetic rather than
 * judgement: a game cannot be scored before it is played, so a club whose record is mostly — or
 * entirely — made of such games did not play them. In one pool: "Test team" with 68 of 68,
 * "ShotByKoRob Scout Team" with 13 of 13, "CA Wildcatters 2031" with 19 of 19, and one carrying
 * 103 of 115 with a 106-13 mark and scores of 20-0 against opponents that appear nowhere else.
 *
 * Both numbers are here because they are a different question each. `ahead` is how much is
 * impossible; `played` is how much there is. All of one and none of the other is an invention;
 * a handful out of eighty is a club with some wrong dates on it.
 */
export type UnrealClub = {
  teamId: string;
  name: string;
  city?: string;
  state?: string;
  /** Played games dated after today. */
  ahead: number;
  /** Played games in total, so the share can be seen. */
  played: number;
  /** The GameChanger ids it was pulled under, which is what a deletion has to remember. */
  gcTeamIds: string[];
  /** Every row it appears in, which all go with it. */
  gameIds: string[];
};

const isPlayed = (game: ScoutGame): boolean =>
  game.teamAScore !== undefined && game.teamBScore !== undefined;

/**
 * The clubs holding at least one result dated ahead, worst first.
 *
 * Worst is the count rather than the share, because the count is what is wrong with the pool and
 * the share is what says whether the club is wrong: a club with 103 of 115 is doing more damage
 * than one with 3 of 3, and both are on the list.
 */
export const unrealClubs = (state: GcImportState, today: string): UnrealClub[] => {
  const ahead = new Map<string, number>();
  const played = new Map<string, number>();
  const rows = new Map<string, string[]>();

  state.games.forEach((game) => {
    if (!isPlayed(game)) return;
    const impossible = isDatedAhead(game, today);
    [game.teamAId, game.teamBId].forEach((teamId) => {
      played.set(teamId, (played.get(teamId) ?? 0) + 1);
      if (!impossible) return;
      ahead.set(teamId, (ahead.get(teamId) ?? 0) + 1);
    });
  });
  if (ahead.size === 0) return [];

  // Every row a club is in, played or not: deleting the club takes its whole schedule with it.
  state.games.forEach((game) => {
    [game.teamAId, game.teamBId].forEach((teamId) => {
      if (!ahead.has(teamId)) return;
      const bucket = rows.get(teamId);
      if (bucket) bucket.push(game.id);
      else rows.set(teamId, [game.id]);
    });
  });

  const byId = new Map(state.teams.map((team: ScoutTeam) => [team.id, team]));
  return [...ahead.entries()]
    .map(([teamId, count]): UnrealClub => {
      const team = byId.get(teamId);
      return {
        teamId,
        name: team?.name ?? teamId,
        ...(team?.city === undefined ? {} : { city: team.city }),
        ...(team?.state === undefined ? {} : { state: team.state }),
        ahead: count,
        played: played.get(teamId) ?? 0,
        gcTeamIds: (team?.gcTeams ?? []).map((link) => link.teamId),
        gameIds: rows.get(teamId) ?? [],
      };
    })
    .sort((a, b) => b.ahead - a.ahead || a.name.localeCompare(b.name));
};
