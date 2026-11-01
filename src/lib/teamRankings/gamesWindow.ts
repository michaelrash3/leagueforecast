import { squadYearWindow } from "./seasons";
import { isScoutGamePlayed, type ScoutGame, type ScoutTeam } from "./types";
import { byGameTime, byGameTimeNewest } from "../date";

/**
 * Which of a page's games the Games tab lists before it is asked for the rest: today's.
 *
 * A nationwide page holds a season's worth of pulled games: on the pool of 29 September 2026 the
 * 12U page of 2027 held 45,107. The user first asked for the week either side of the app's last
 * update, 11,348 games on that page, then on 2 October for less: the last update and the three
 * days after it, 1,228, and then for today's games alone. The rest stays one click away rather
 * than gone: an old game still waiting for a score is entered from this list, and so is a game
 * with no date.
 *
 * Today is the reader's own day (`todayIsoDay`), the way every other date on the page is read. A
 * squad year today is not in has no today to show: a finished season shows its last day with
 * games instead, and one not yet begun its first, rather than nothing.
 *
 * A day in season with no games has nothing to show either, and most weekdays are such a day: a
 * parent opening the tab on a Friday night for Saturday's games found "No games today", and Show
 * all put the farthest-off game first, Saturday's first game 497 rows down on a seeded page of
 * 2,693. So a day with none opens on the next day that has games, saying so, with a step back to
 * the last day that had them; a day with games is still today's alone, the user's rule of 2
 * October 2026.
 */

/**
 * A page's stored games as the Games tab lists them, newest first by day and start
 * (`byGameTimeNewest`): the games filed on `pageId` out of a squad year's stored ones
 * (`loadScoutGamesForYear`).
 * League Standings fixtures are not among them.
 */
export const loggedGamesOn = (yearGames: readonly ScoutGame[], pageId: string): ScoutGame[] =>
  yearGames.filter((game) => game.ageGroupId === pageId).sort(byGameTimeNewest);

/** What a club taken off as plainly made up is called on a Games list. */
export const REMOVED_ON_LIST = " (removed for you)";

/**
 * The names a page's Games list gives its sides: a year's derived roster (`AllKnown.teams`), and
 * each club it left out as plainly made up (`AllKnown.removed`) by its stored name (`roster`), said
 * to be removed. The list is of the page's stored games, which a mark leaves filed, so a removed
 * club's games are still listed (and found again by their place, `findListed`); without its name
 * the club was a bare "?" or an id, and without the word the user would read its games as counted.
 */
export const listedTeamNames = (
  teams: readonly ScoutTeam[],
  removed: ReadonlySet<string>,
  roster: readonly ScoutTeam[]
): Map<string, string> => {
  const names = new Map(teams.map((team) => [team.id, team.name]));
  if (removed.size === 0) return names;
  roster.forEach((team) => {
    if (removed.has(team.id)) names.set(team.id, `${team.name}${REMOVED_ON_LIST}`);
  });
  return names;
};

export type GamesWindow = {
  /** The one ISO day the list keeps. */
  day: string;
  /**
   * What the day is: today; on a day in season with no games, the next day that has them
   * (`next`), or with none to come the last (`last`); for a squad year today is not in, the last
   * day it has games (`season-end`) or the first (`season-start`).
   */
  basis: "today" | "next" | "last" | "season-end" | "season-start";
  /** From the next day with games: the last day before today that had them, to step back to. */
  back?: string;
  /** Stepped back: the next day with games, to step forward to again. */
  forward?: string;
};

/** The day the Games tab lists for a page of `year`'s games, on `today`. */
export const gamesWindowFor = ({
  today,
  year,
  games,
}: {
  today: string;
  year: number | undefined;
  games: readonly ScoutGame[];
}): GamesWindow => {
  const plain: GamesWindow = { day: today, basis: "today" };
  if (year === undefined) return plain;
  const { start, end } = squadYearWindow(year);
  const days = games.flatMap((game) => (game.date ? [game.date] : []));
  if (days.length === 0) return plain;
  if (today >= start && today <= end) {
    // The game days either side of today, read in one pass over a page of tens of thousands.
    let last: string | undefined;
    let next: string | undefined;
    for (const day of days) {
      if (day === today) return plain;
      if (day < today) {
        if (last === undefined || day > last) last = day;
      } else if (next === undefined || day < next) next = day;
    }
    if (next !== undefined)
      return { day: next, basis: "next", ...(last === undefined ? {} : { back: last }) };
    return last === undefined ? plain : { day: last, basis: "last" };
  }
  return today > end
    ? { day: days.reduce((latest, day) => (day > latest ? day : latest)), basis: "season-end" }
    : {
        day: days.reduce((earliest, day) => (day < earliest ? day : earliest)),
        basis: "season-start",
      };
};

/**
 * The other way from an empty day: back from the next day with games to the last one, and forward
 * again. Any other window is returned as it was, having nowhere to step.
 */
export const stepGamesWindow = (window: GamesWindow): GamesWindow => {
  if (window.basis === "next" && window.back !== undefined)
    return { day: window.back, basis: "last", forward: window.day };
  if (window.basis === "last" && window.forward !== undefined)
    return { day: window.forward, basis: "next", back: window.day };
  return window;
};

/**
 * A page's games as Show all lists them: the games still to play, today's on, soonest first by
 * day and start (`byGameTime`), above the rest in the order they came, which is newest first
 * (`loggedGamesOn`) with the undated last. The rest are the games played, wherever their day, and
 * the ones owed a score from before today. Listed newest first throughout, the farthest-off game
 * came first and this weekend's were hundreds of rows down.
 */
export const everyGameListed = (games: readonly ScoutGame[], today: string): ScoutGame[] => {
  const toPlay: ScoutGame[] = [];
  const rest: ScoutGame[] = [];
  games.forEach((game) => {
    if (game.date && game.date >= today && !isScoutGamePlayed(game)) toPlay.push(game);
    else rest.push(game);
  });
  return [...toPlay.sort(byGameTime), ...rest];
};

export type WindowedGames = {
  /** The games on the day, plus any in `keep`, in the order they came. */
  shown: ScoutGame[];
  /** How many it leaves out. */
  hidden: number;
  /** Of those, how many have no date to place them by. */
  undated: number;
  /** Of those, how many were due before the day and still have no score. */
  needingScore: number;
};

/**
 * `games` cut to the window's day. A game in `keep` stays whatever its date: a game the reader has
 * just added is shown where they can see it went in, not hidden for being dated a month ago.
 */
export const windowGames = (
  games: readonly ScoutGame[],
  window: GamesWindow,
  keep: ReadonlySet<string>
): WindowedGames => {
  const shown: ScoutGame[] = [];
  let undated = 0;
  let needingScore = 0;
  games.forEach((game) => {
    if (game.date === window.day || keep.has(game.id)) {
      shown.push(game);
      return;
    }
    if (!game.date) undated += 1;
    else if (game.date < window.day && !isScoutGamePlayed(game)) needingScore += 1;
  });
  return { shown, hidden: games.length - shown.length, undated, needingScore };
};
