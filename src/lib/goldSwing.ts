import type { GoldSwing } from "./sim";
import type { Matchup } from "./types";

/** The share of `seasons` in which `count` happened, and its standard error. */
const share = (count: number, seasons: number) => {
  const p = seasons > 0 ? count / seasons : 0;
  return { p, se: seasons > 0 ? Math.sqrt((p * (1 - p)) / seasons) : 1 };
};

/** How the followed team's Gold chance turns on one game: with each side winning it. */
type GameSwing = {
  gameId: string;
  /** The chance of making the cut with the away side winning, and with the home side winning. */
  ifAway: number;
  ifHome: number;
  /** Whether the difference between the two is more than the draws can account for. */
  clear: boolean;
};

/** Too few seasons on a side to say anything of it. */
const MIN_SEASONS_A_SIDE = 30;

const gameSwings = (swing: GoldSwing): GameSwing[] =>
  swing.gameIds.map((gameId, at) => {
    const awayWins = swing.awayWins[at] ?? 0;
    const homeWins = swing.seasons - awayWins;
    const away = share(swing.inIfAway[at] ?? 0, awayWins);
    const home = share(swing.inIfHome[at] ?? 0, homeWins);
    const enough = awayWins >= MIN_SEASONS_A_SIDE && homeWins >= MIN_SEASONS_A_SIDE;
    return {
      gameId,
      ifAway: away.p,
      ifHome: home.p,
      // Two standard errors of the difference: a gap the draws alone would rarely make.
      clear: enough && Math.abs(away.p - home.p) > 2 * Math.hypot(away.se, home.se),
    };
  });

/**
 * The followed team's Gold chance with a win in one of its own games, and with a loss, from the
 * seasons the odds were drawn from (`GoldSwing`). Null for a game it does not play, or one too
 * lopsided for the draws to say anything about the side that seldom wins it.
 */
export const ownGameSwing = (
  swing: GoldSwing,
  game: Matchup
): { ifWin: number; ifLoss: number } | null => {
  const read = gameSwings(swing).find((one) => one.gameId === game.id);
  if (!read) return null;
  const at = swing.gameIds.indexOf(game.id);
  const awayWins = swing.awayWins[at] ?? 0;
  if (awayWins < MIN_SEASONS_A_SIDE || swing.seasons - awayWins < MIN_SEASONS_A_SIDE) return null;
  if (game.away === swing.teamId) return { ifWin: read.ifAway, ifLoss: read.ifHome };
  if (game.home === swing.teamId) return { ifWin: read.ifHome, ifLoss: read.ifAway };
  return null;
};

/** A game the followed team is not in, whose result moves its Gold chance (`rootFor`). */
export type RootFor = {
  gameId: string;
  date: string;
  /** The side to root for, and the side to root against. */
  winnerId: string;
  loserId: string;
  /** The followed team's Gold chance with each result. */
  ifWin: number;
  ifLoss: number;
};

/**
 * The games the followed team is not in that matter most to it, and who to root for in each: the
 * games whose two results give it the most different Gold chances, where the difference is more
 * than the draws can account for. Most first.
 */
export const rootFor = (swing: GoldSwing, games: readonly Matchup[], limit = 3): RootFor[] => {
  const byId = new Map(games.map((game) => [game.id, game]));
  return gameSwings(swing)
    .flatMap((read): RootFor[] => {
      const game = byId.get(read.gameId);
      if (!game || !read.clear) return [];
      if (game.away === swing.teamId || game.home === swing.teamId) return [];
      const awayBetter = read.ifAway >= read.ifHome;
      return [
        {
          gameId: game.id,
          date: game.date,
          winnerId: awayBetter ? game.away : game.home,
          loserId: awayBetter ? game.home : game.away,
          ifWin: awayBetter ? read.ifAway : read.ifHome,
          ifLoss: awayBetter ? read.ifHome : read.ifAway,
        },
      ];
    })
    .sort((a, b) => b.ifWin - b.ifLoss - (a.ifWin - a.ifLoss))
    .slice(0, limit);
};
