import { ageGroupYear, type AgeGroup, type ScoutGame } from "../../teamRankings";
import { loggedGamesOn } from "../../teamRankings/gamesWindow";
import type { BoardsBuilt } from "./board";
import { encodeGames, gamesKey, type GamesWire } from "./gamesShape";

/**
 * Every page's Games list, as views to publish (`gamesShape.ts`): the page's stored games as the
 * tab lists them (`loggedGamesOn`), named by the year's roster the boards' build derived
 * (`BoardsBuilt.known`), League Standings' teams included, as the page names them. A page with no
 * stored games has a list with none, so the tab says so rather than going to this device's copy.
 *
 * `gamesOfYear` reads a squad year's stored games (`loadScoutGamesForYear`).
 */
export const gamesViews = ({
  ageGroups,
  built,
  gamesOfYear,
}: {
  ageGroups: AgeGroup[];
  built: Pick<BoardsBuilt, "known">;
  gamesOfYear: (year: number | undefined) => ScoutGame[];
}): Array<{ key: string; value: GamesWire }> =>
  [...built.known].flatMap(([year, known]) => {
    const yearGames = gamesOfYear(year);
    const names = new Map(known.teams.map((team) => [team.id, team.name]));
    return ageGroups
      .filter((group) => ageGroupYear(group) === year)
      .map((group) => ({
        key: gamesKey(year, group.id),
        value: encodeGames({ page: group.id, games: loggedGamesOn(yearGames, group.id), names }),
      }));
  });
