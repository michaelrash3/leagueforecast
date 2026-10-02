import { squadYearWindow } from "./seasons";
import { isScoutGamePlayed, type ScoutGame } from "./types";

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
 */

export type GamesWindow = {
  /** The one ISO day the list keeps. */
  day: string;
  /**
   * What the day is: today, or, for a squad year today is not in, the last day it has games
   * (`season-end`) or the first (`season-start`).
   */
  basis: "today" | "season-end" | "season-start";
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
  if (today >= start && today <= end) return plain;
  const days = games.flatMap((game) => (game.date ? [game.date] : []));
  if (days.length === 0) return plain;
  return today > end
    ? { day: days.reduce((latest, day) => (day > latest ? day : latest)), basis: "season-end" }
    : {
        day: days.reduce((earliest, day) => (day < earliest ? day : earliest)),
        basis: "season-start",
      };
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
