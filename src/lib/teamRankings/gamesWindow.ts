import { shiftIsoDay, todayIsoDay } from "../date";
import { squadYearWindow } from "./seasons";
import { isScoutGamePlayed, type ScoutGame } from "./types";

/**
 * Which of a page's games the Games tab lists before it is asked for the rest.
 *
 * A nationwide page holds a season's worth of pulled games: on the pool of 29 September 2026 the
 * 12U page of 2027 held 45,107, and 11,348 of them fell within a week either side of that day. The
 * user asked for the list to keep only "games within 7 days of the app's last update", the days
 * either side of it, with the rest one click away rather than gone: an old game still waiting for a
 * score is entered from this list, and so is a game with no date.
 *
 * The last update is the newest GameChanger pull the pool holds (`latestImportedAt`), which the
 * nightly refresh moves every night; a pool nothing was ever pulled into has only the reader's
 * day to go by. A squad year that day is not in, a finished season or one not yet started, is
 * windowed around its own nearest day with games instead, so the page shows that season's last
 * (or first) fortnight rather than nothing.
 */

/** How many days either side of the anchor the list keeps. */
export const GAMES_WINDOW_DAYS = 7;

export type GamesWindow = {
  /** The ISO day the window is centred on. */
  anchor: string;
  /** First and last ISO day the window keeps, both included. */
  from: string;
  to: string;
  /**
   * What the anchor is: the newest pull, the reader's day when nothing was pulled, or the squad
   * year's own nearest day with games when the other two fall outside it.
   */
  basis: "pull" | "today" | "season";
};

const windowAround = (anchor: string, basis: GamesWindow["basis"]): GamesWindow => ({
  anchor,
  from: shiftIsoDay(anchor, -GAMES_WINDOW_DAYS),
  to: shiftIsoDay(anchor, GAMES_WINDOW_DAYS),
  basis,
});

/**
 * The window for a page of `year`'s games. `pulledAt` is an instant, read as the reader's own day
 * the way every other date on the page is (`todayIsoDay`); `today` is that day already.
 */
export const gamesWindowFor = ({
  pulledAt,
  today,
  year,
  games,
}: {
  pulledAt: string | null;
  today: string;
  year: number | undefined;
  games: readonly ScoutGame[];
}): GamesWindow => {
  const pulled = pulledAt === null ? NaN : Date.parse(pulledAt);
  const window = Number.isFinite(pulled)
    ? windowAround(todayIsoDay(new Date(pulled)), "pull")
    : windowAround(today, "today");
  if (year === undefined) return window;
  const { start, end } = squadYearWindow(year);
  if (window.anchor >= start && window.anchor <= end) return window;
  /*
   * The anchor is outside this squad year. A year already over is windowed around its last day
   * with games, a year not yet begun around its first: the day nearest the anchor either way.
   */
  const days = games.flatMap((game) => (game.date ? [game.date] : []));
  if (days.length === 0) return window;
  const nearest =
    window.anchor > end
      ? days.reduce((latest, day) => (day > latest ? day : latest))
      : days.reduce((earliest, day) => (day < earliest ? day : earliest));
  return windowAround(nearest, "season");
};

export type WindowedGames = {
  /** The games the window keeps, plus any in `keep`, in the order they came. */
  shown: ScoutGame[];
  /** How many it leaves out. */
  hidden: number;
  /** Of those, how many have no date to place them by. */
  undated: number;
  /** Of those, how many were due before the window and still have no score. */
  needingScore: number;
};

/**
 * `games` cut to `window`. A game in `keep` stays whatever its date: a game the reader has just
 * added is shown where they can see it went in, not hidden for being dated a month ago.
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
    const inWindow = game.date !== undefined && game.date >= window.from && game.date <= window.to;
    if (inWindow || keep.has(game.id)) {
      shown.push(game);
      return;
    }
    if (!game.date) undated += 1;
    else if (game.date < window.from && !isScoutGamePlayed(game)) needingScore += 1;
  });
  return { shown, hidden: games.length - shown.length, undated, needingScore };
};
