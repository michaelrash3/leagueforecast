import { ageGroupYear, type AgeGroup, type ScoutGame } from "../../teamRankings";
import { loggedGamesOn } from "../../teamRankings/gamesWindow";
import type { BoardsBuilt } from "./board";
import { encodeGames, gamesKey, type GamesWire } from "./gamesShape";

/**
 * Every page's Games list, as views to publish (`gamesShape.ts`): the page's stored games as the
 * tab lists them (`loggedGamesOn`), named by the year's roster the boards' build derived
 * (`BoardsBuilt.known`), League Standings' teams included, as the page names them. A page with no
 * stored games has a list with none, so the tab says so rather than going to this device's copy.
 * A page is listed once, under its first copy's year, as the boards and the page find it: ids are
 * minted unique, but a hand-edited restore can repeat one, and two lists under one key would stop
 * the whole publish.
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
      .filter(
        (group, index) =>
          ageGroupYear(group) === year &&
          ageGroups.findIndex((other) => other.id === group.id) === index
      )
      .map((group) => ({
        key: gamesKey(year, group.id),
        value: encodeGames({ page: group.id, games: loggedGamesOn(yearGames, group.id), names }),
      }));
  });
