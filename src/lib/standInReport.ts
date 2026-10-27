import {
  ageGroupYear,
  isScoutGamePlayed,
  teamNameKey,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
} from "./teamRankings";

/*
 * The stand-ins of a squad year (the stand-ins plan's Part 3, measured rather than assumed): the
 * clubs a pool holds only because somebody else's schedule named them (`nameOnly`), or a bracket
 * slot (`placeholder`), and the games that lean on them. A stand-in stands in the fit as the
 * opponent it was, and is listed on no board; a game against one counts for the club that played
 * it only as far as the stand-in's own record, a fraction of a season, says.
 *
 * What is left once the nightly's tidy has run, which is the cloud copy as it is: the tidy already
 * folds every stand-in it can prove is a club. So the report asks what it could not: of the clubs
 * known only by name, how many share a name with a club pulled in the same year (a matching gap,
 * where a region or a picture might settle it), and how many have nothing of that name at all.
 */

export type StandInClub = {
  teamId: string;
  name: string;
  /** Games of the year it holds, and how many of them are played. */
  games: number;
  played: number;
  /** Clubs pulled in the year whose name reads the same (`teamNameKey`). */
  namesakes: number;
};

export type StandInReport = {
  year: number;
  /** The year's games, and how many have a stand-in on at least one side. */
  games: number;
  withStandIn: number;
  played: number;
  playedWithStandIn: number;
  nameOnly: number;
  placeholders: number;
  /** Clubs known only by name with a pulled namesake in the year, and with none. */
  withNamesake: number;
  withoutNamesake: number;
  /** The clubs known only by name holding the most games, most first: these name clubs. */
  top: StandInClub[];
};

const isStandIn = (team: ScoutTeam | undefined) =>
  team?.placeholder === true || team?.nameOnly === true;

export const standInReport = (
  teams: readonly ScoutTeam[],
  games: readonly ScoutGame[],
  ageGroups: readonly AgeGroup[],
  year: number,
  top = 25
): StandInReport => {
  const yearPages = new Set(
    ageGroups.filter((group) => ageGroupYear(group) === year).map((group) => group.id)
  );
  const byId = new Map(teams.map((team) => [team.id, team]));
  const yearGames = games.filter((game) => yearPages.has(game.ageGroupId));
  const held = new Map<string, { games: number; played: number }>();
  let withStandIn = 0;
  let played = 0;
  let playedWithStandIn = 0;
  const inYear = new Set<string>();
  for (const game of yearGames) {
    const isPlayed = isScoutGamePlayed(game);
    if (isPlayed) played += 1;
    let leans = false;
    for (const id of [game.teamAId, game.teamBId]) {
      inYear.add(id);
      if (!isStandIn(byId.get(id))) continue;
      leans = true;
      const tally = held.get(id) ?? { games: 0, played: 0 };
      tally.games += 1;
      if (isPlayed) tally.played += 1;
      held.set(id, tally);
    }
    if (leans) {
      withStandIn += 1;
      if (isPlayed) playedWithStandIn += 1;
    }
  }
  // The year's pulled clubs by name, the ones a stand-in might be.
  const pulledByName = new Map<string, number>();
  for (const id of inYear) {
    const team = byId.get(id);
    if (!team || isStandIn(team)) continue;
    const key = teamNameKey(team.name);
    pulledByName.set(key, (pulledByName.get(key) ?? 0) + 1);
  }
  const clubs: StandInClub[] = [];
  let placeholders = 0;
  for (const [teamId, tally] of held) {
    const team = byId.get(teamId);
    if (!team) continue;
    if (team.placeholder) {
      placeholders += 1;
      continue;
    }
    clubs.push({
      teamId,
      name: team.name,
      ...tally,
      namesakes: pulledByName.get(teamNameKey(team.name)) ?? 0,
    });
  }
  clubs.sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
  return {
    year,
    games: yearGames.length,
    withStandIn,
    played,
    playedWithStandIn,
    nameOnly: clubs.length,
    placeholders,
    withNamesake: clubs.filter((club) => club.namesakes > 0).length,
    withoutNamesake: clubs.filter((club) => club.namesakes === 0).length,
    top: clubs.slice(0, top),
  };
};
