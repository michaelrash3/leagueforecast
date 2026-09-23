/**
 * A whole squad year taken out of Team Rankings, with nothing kept.
 *
 * The other way a year leaves is archiving it, which freezes its tables before the games go. This
 * is for a year nobody wants a record of — pulled by mistake, or simply done with — and it takes
 * everything the year is made of: its pages, every stored game filed under them, the clubs that
 * played in no other year, and the year's archived tables if it has any.
 *
 * A whole year rather than a page, for the reason archiving gives: every age on a year is rated
 * together, so taking one page would quietly change the tables of the pages left behind.
 *
 * A club that also plays in another year stays, because a team is not owned by a page — one copy
 * of a club is the only way a rename in one year is a rename in both. What it loses is what tied
 * it to this year: the GameChanger ids filed under the year's pages. GameChanger mints an id per
 * team per season, so those ids *are* this year's squads, and a link left pointing at a page that
 * no longer exists would be the one trace of the year still in the pool.
 *
 * League Standings keeps its own seasons; this does not reach into them. The pages carried the
 * links to them, and those links go with the pages, so the league's fixtures stop feeding a
 * ranking for the year. The ids come back so the caller can say which seasons that is.
 */

import { ageGroupYear, type AgeGroup } from "./teamRankings";
import type { ArchiveEntry, StoredPool } from "./teamRankingsArchive";

export type SquadYearDeletion = {
  /** The pool with the year gone. */
  state: StoredPool;
  /** What the year's pages were called, for the confirmation. */
  pages: string[];
  /** Stored games the delete takes. League fixtures are not among them — they were never stored. */
  droppedGames: number;
  /** Clubs no remaining game mentions. */
  droppedTeams: number;
  /** Clubs that stay, because they play in another year, and lose the ids filed under this one. */
  unlinkedTeams: number;
  /** The league seasons the year's pages were attached to, which stop feeding rankings. */
  leagueSeasonIds: string[];
  /** The year's archived tables, which go too. */
  archiveIds: string[];
};

/** The years there is anything to delete from: a page or an archived table. Newest first. */
export const deletableYears = (
  ageGroups: readonly AgeGroup[],
  archives: readonly ArchiveEntry[]
): number[] =>
  [
    ...new Set([
      ...ageGroups.flatMap((group) => {
        const year = ageGroupYear(group);
        return year === undefined ? [] : [year];
      }),
      ...archives.flatMap((entry) => (entry.year === undefined ? [] : [entry.year])),
    ]),
  ].sort((a, b) => b - a);

export const deleteSquadYear = (
  year: number,
  stored: StoredPool,
  archives: readonly ArchiveEntry[]
): SquadYearDeletion => {
  /*
   * `ageGroupYear`, not `group.year`, for the reason `archiveSquadYear` gives: a page whose name
   * says the year and whose field does not is rated with that year, and has to go with it.
   */
  const ofYear = stored.ageGroups.filter((group) => ageGroupYear(group) === year);
  const going = new Set(ofYear.map((group) => group.id));

  const games = stored.games.filter((game) => !going.has(game.ageGroupId));
  const wanted = new Set(games.flatMap((game) => [game.teamAId, game.teamBId]));
  let unlinkedTeams = 0;
  const teams = stored.teams.flatMap((team) => {
    if (!wanted.has(team.id)) return [];
    const links = team.gcTeams;
    if (!links?.some((link) => going.has(link.ageGroupId))) return [team];
    unlinkedTeams += 1;
    const kept = links.filter((link) => !going.has(link.ageGroupId));
    if (kept.length > 0) return [{ ...team, gcTeams: kept }];
    const { gcTeams: _gone, ...rest } = team;
    return [rest];
  });

  // A page that carried a squad on from one of this year's has nothing to carry it from now.
  const ageGroups = stored.ageGroups.flatMap((group) => {
    if (going.has(group.id)) return [];
    if (group.continuesFromId === undefined || !going.has(group.continuesFromId)) return [group];
    const { continuesFromId: _gone, ...rest } = group;
    return [rest];
  });

  return {
    state: { ageGroups, teams, games },
    pages: ofYear.map((group) => group.name),
    droppedGames: stored.games.length - games.length,
    droppedTeams: stored.teams.length - teams.length,
    unlinkedTeams,
    leagueSeasonIds: [...new Set(ofYear.flatMap((group) => group.seasonIds))],
    archiveIds: archives.filter((entry) => entry.year === year).map((entry) => entry.id),
  };
};
