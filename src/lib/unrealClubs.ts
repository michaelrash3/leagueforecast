import { isDatedAhead } from "./deletedGames";
import type { GcImportState } from "./gameChangerImport";
import {
  filedRowOf,
  filedTeamIds,
  isImplausibleScore,
  ownPageFor,
  ratedMargin,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
} from "./teamRankings";

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
  /**
   * Games its schedule filed that it won by more than `IMPLAUSIBLE_MARGIN` runs, and that nobody
   * has said were played that way (`isImplausibleScore`): 9,999-0, 4,612-0, 529-2.
   */
  implausible: number;
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
 * The sides of a game whose own schedule filed its result: the club pulled under `source`, and any
 * whose schedule also listed it with a score. Both sides when the game names no source it can be
 * traced to — one typed in by hand, or a source whose club has since gone — because then nothing
 * says which of the two wrote it.
 *
 * Only a schedule that scored the game. Every copy of it folded in is now on record, the other
 * club's placeholder for the fixture included, and charging that club with a result dated ahead
 * that it never posted puts the inventor's victim on the list beside it. So `source` counts unless
 * its score was borrowed from side B (`scoreFromB`), a kept row (`alsoRows`) only where it carried a
 * score of its own, and a schedule on record without its row (`alsoFrom` from before rows were
 * kept) as it always has, since nothing says what it listed.
 */
export const filedBy = (game: ScoutGame, clubOfGcId: ReadonlyMap<string, string>): string[] => {
  const kept = new Set((game.alsoRows ?? []).map((record) => record.teamId));
  const sources = [
    ...(game.source && !game.scoreFromB ? [game.source.teamId] : []),
    ...(game.alsoRows ?? [])
      .filter((record) => record.ownScore !== undefined)
      .map((record) => record.teamId),
    ...(game.alsoFrom ?? []).filter((schedule) => !kept.has(schedule)),
  ];
  const sides = [game.teamAId, game.teamBId].filter((teamId) =>
    sources.some((gcId) => clubOfGcId.get(gcId) === teamId)
  );
  return sides.length > 0 ? sides : [game.teamAId, game.teamBId];
};

/** Which club in the pool each GameChanger id was pulled as. */
export const clubsByGcId = (teams: readonly ScoutTeam[]): Map<string, string> =>
  new Map(teams.flatMap((team) => (team.gcTeams ?? []).map((link) => [link.teamId, team.id])));

/**
 * The clubs holding at least one result dated ahead or won by more than `IMPLAUSIBLE_MARGIN` runs,
 * worst first.
 *
 * The clubs whose schedules post scores like 9,999-0 come first, most such games first: the user
 * asked on 28 September 2026 for the clubs on the list of games won by more than thirty runs to
 * head the list of clubs that may not be real. After them, worst is the count of results dated
 * ahead rather than their share, because the count is what is wrong with the pool and the share is
 * what says whether the club is wrong: a club with 103 of 115 is doing more damage than one with 3
 * of 3, and both are on the list.
 *
 * A game is charged to the club whose schedule filed it, not to both sides. An invented game is
 * written by one club against another that never played it, so counting both put the victim on
 * the list with every invention against it — and a real club an inventor listed as its opponent
 * every week came out above the inventor itself, at the top of a list meant to lead with the worst.
 */
export const unrealClubs = (state: GcImportState, today: string): UnrealClub[] => {
  const ahead = new Map<string, number>();
  const implausible = new Map<string, number>();
  const played = new Map<string, number>();
  const rows = new Map<string, string[]>();
  const clubOfGcId = clubsByGcId(state.teams);
  const add = (counts: Map<string, number>, teamId: string) =>
    counts.set(teamId, (counts.get(teamId) ?? 0) + 1);

  state.games.forEach((game) => {
    if (!isPlayed(game)) return;
    [game.teamAId, game.teamBId].forEach((teamId) => add(played, teamId));
    const early = isDatedAhead(game, today);
    // Only the side that won it: a club whose own schedule records a rout against it posted a
    // loss, which is no sign it was invented, and saying it won by thirty would be untrue.
    const margin = isImplausibleScore(game) ? (ratedMargin(game) ?? 0) : 0;
    const winner = margin > 0 ? game.teamAId : margin < 0 ? game.teamBId : undefined;
    if (!early && winner === undefined) return;
    filedBy(game, clubOfGcId).forEach((teamId) => {
      if (early) add(ahead, teamId);
      if (teamId === winner) add(implausible, teamId);
    });
  });
  const suspects = new Set([...ahead.keys(), ...implausible.keys()]);
  if (suspects.size === 0) return [];

  // Every row a club is in, played or not: deleting the club takes its whole schedule with it.
  state.games.forEach((game) => {
    [game.teamAId, game.teamBId].forEach((teamId) => {
      if (!suspects.has(teamId)) return;
      const bucket = rows.get(teamId);
      if (bucket) bucket.push(game.id);
      else rows.set(teamId, [game.id]);
    });
  });

  const byId = new Map(state.teams.map((team: ScoutTeam) => [team.id, team]));
  return [...suspects]
    .map((teamId): UnrealClub => {
      const team = byId.get(teamId);
      return {
        teamId,
        name: team?.name ?? teamId,
        ...(team?.city === undefined ? {} : { city: team.city }),
        ...(team?.state === undefined ? {} : { state: team.state }),
        ahead: ahead.get(teamId) ?? 0,
        implausible: implausible.get(teamId) ?? 0,
        played: played.get(teamId) ?? 0,
        gcTeamIds: (team?.gcTeams ?? []).map((link) => link.teamId),
        gameIds: rows.get(teamId) ?? [],
      };
    })
    .sort(
      (a, b) => b.implausible - a.implausible || b.ahead - a.ahead || a.name.localeCompare(b.name)
    );
};

/**
 * The pool without `club`: every game it is in, and the club itself — but not another club's own
 * row that one of those games held as a claim (`FoldedRow.filedAgainst`), nor the club where such a
 * row elsewhere was filed against it.
 *
 * A claimed row is a game of the other club's own schedule against somebody else, read as this
 * club's copy of it by the clock: it stands back up against the team it was filed against rather
 * than go with a club that did not play it, as it does when the copy holding it is withdrawn. And a
 * club a claimed row was filed against is where that row goes back, so it stays as a name only
 * (`nameOnly`), without the GameChanger ids the deletion refuses.
 */
export const withoutClub = (
  club: Pick<UnrealClub, "teamId" | "gameIds">,
  teams: readonly ScoutTeam[],
  games: readonly ScoutGame[],
  ageGroups: AgeGroup[]
): { teams: ScoutTeam[]; games: ScoutGame[] } => {
  const drop = new Set(club.gameIds);
  const ownPage = ownPageFor(ageGroups);
  const stood: ScoutGame[] = [];
  const kept = games.filter((game) => {
    if (!drop.has(game.id)) return true;
    game.alsoRows?.forEach((record) => {
      if (record.filedAgainst === undefined || record.filedAgainst === club.teamId) return;
      stood.push({
        ...ownPage(filedRowOf(game, record)),
        ...(game.excluded ? { excluded: true } : {}),
      });
    });
    return false;
  });
  const left = [...kept, ...stood];
  const named = filedTeamIds(left);
  return {
    teams: teams.flatMap((team) => {
      if (team.id !== club.teamId) return [team];
      if (!named.has(team.id)) return [];
      const { gcTeams: _ids, ...rest } = team;
      return [{ ...rest, nameOnly: true }];
    }),
    games: left,
  };
};
