import { coachesOf } from "./gcStaff";
import { statesThatPlayed } from "./playedByStates";
import {
  dedupeLeagueFixtures,
  leagueStandIns,
  teamPages,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
  type TeamPage,
} from "./teamRankings";

/**
 * Find a team's list, worked out the same way wherever it is built: by Team Rankings over this
 * device's copy (`useClubSearch`) and by a server publishing it for the live board
 * (`views/search.ts`), so the two cannot drift apart.
 */

/** One club as Find a team offers it (`TeamSearchSelect`'s option, less what only pickers set). */
export type ClubSearchOption = {
  id: string;
  label: string;
  detail?: string;
  coaches?: readonly string[];
  gcIds?: readonly string[];
};

/**
 * Every game Find a team covers on a year's page: League Standings' games of that year, which a
 * page derives (`AllKnown.derivedGames`), and every stored game of every year, a club's own copy of
 * a League Standings game counted once (`dedupeLeagueFixtures`). `teams` is the year's roster, League
 * Standings' teams included.
 */
export const clubSearchGames = (
  derivedGames: readonly ScoutGame[],
  storedGames: readonly ScoutGame[],
  teams: ScoutTeam[],
  ageGroups: AgeGroup[]
): ScoutGame[] =>
  dedupeLeagueFixtures([...derivedGames, ...storedGames], leagueStandIns(teams, ageGroups));

/**
 * Where each club lives, and where the clubs that played a state-less one are from, over every
 * game the search covers (`teamPages`, `statesThatPlayed`).
 */
export const clubSearchPages = (
  teams: ScoutTeam[],
  games: ScoutGame[],
  ageGroups: AgeGroup[]
): { pagesByTeam: Map<string, TeamPage>; playedBy: Map<string, string[]> } => ({
  pagesByTeam: teamPages(teams, games, ageGroups),
  // Where a stand-in's opponents are from, read off the same games (`statesThatPlayed`).
  playedBy: statesThatPlayed(teams, games),
});

/** Find a team's options: every club with a page, in the order `pagesByTeam` holds them. */
export const clubSearchOptions = (
  teams: readonly ScoutTeam[],
  pagesByTeam: ReadonlyMap<string, TeamPage>,
  playedBy: ReadonlyMap<string, string[]>
): ClubSearchOption[] => {
  const byId = new Map(teams.map((team) => [team.id, team]));
  return [...pagesByTeam.entries()].flatMap(([teamId, page]) => {
    const team = byId.get(teamId);
    if (!team) return [];
    const where = [
      page.level === undefined ? "" : `${page.level}U`,
      page.year === undefined ? "" : String(page.year),
    ]
      .filter(Boolean)
      .join(" ");
    /*
     * The town off the team itself rather than through `placeOf`, which only knows this page's
     * rows. Every team worth searching for is on some other page, so reading it that way left
     * the place blank on exactly the results that needed it — and the place is what tells two
     * clubs of the same name apart.
     */
    // A club GameChanger gives no state is placed by the clubs that played it instead; only
    // those clubs are in `playedBy`.
    const playedByStates = playedBy.get(teamId) ?? [];
    const place = [
      team.city,
      team.state,
      playedByStates.length > 0 ? `played by ${playedByStates.join(", ")} clubs` : "",
    ]
      .filter(Boolean)
      .join(", ");
    const detail = [where, place].filter(Boolean).join(" · ");
    // And who coaches it, which is often how a person knows a club whose name forty others share.
    const coaches = coachesOf(team);
    return [
      {
        id: teamId,
        label: team.name,
        ...(detail ? { detail } : {}),
        ...(coaches.length > 0 ? { coaches } : {}),
        // Its GameChanger ids, so a pasted id or link finds it (`gcIdsInSearch`).
        ...(team.gcTeams?.length ? { gcIds: team.gcTeams.map((link) => link.teamId) } : {}),
      },
    ];
  });
};
