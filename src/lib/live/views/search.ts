import { clubSearchGames, clubSearchOptions, clubSearchPages } from "../../clubSearch";
import type { AgeGroup, ScoutGame } from "../../teamRankings";
import type { BoardsBuilt } from "./board";
import { encodeSearch, searchKey, type HeldGcIds, type SearchWire } from "./searchShape";

/**
 * Every squad year's Find a team list, as views to publish (`searchShape.ts`). Each is the list the
 * year's pages search, worked out by the page's own code (`clubSearch.ts`) from what the boards'
 * build derived for the year (`BoardsBuilt.known`): the year's roster, League Standings' teams
 * included, over League Standings' games of the year and every stored game of every year.
 *
 * `storedGames` is every stored game of every year (`loadScoutGames`), and `held` the copy's lists
 * of GameChanger ids kept off every page, which every year's list carries.
 */
export const searchViews = ({
  ageGroups,
  built,
  storedGames,
  held,
}: {
  ageGroups: AgeGroup[];
  built: Pick<BoardsBuilt, "known">;
  storedGames: readonly ScoutGame[];
  held: HeldGcIds;
}): Array<{ key: string; value: SearchWire }> =>
  [...built.known].map(([year, known]) => {
    const games = clubSearchGames(known.derivedGames, storedGames, known.teams, ageGroups);
    const { pagesByTeam, playedBy } = clubSearchPages(known.teams, games, ageGroups);
    const options = clubSearchOptions(known.teams, pagesByTeam, playedBy);
    const pageOf = new Map(
      [...pagesByTeam].map(([teamId, page]): [string, string] => [teamId, page.ageGroupId])
    );
    return { key: searchKey(year), value: encodeSearch({ options, pageOf, held }) };
  });
