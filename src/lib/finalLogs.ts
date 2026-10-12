import type { GameLog } from "./types";
import { isFinal } from "./util";

/**
 * The scores of the games marked final, and no others, as the same object for as long as those
 * are unchanged (2.2).
 *
 * Every number League Standings works out from its scores (the table, the ratings, the stats, the
 * forecast, the trend, the backtest, the timeline) reads only the games marked final, so a score
 * typed into a game still being played moves none of them. They were all keyed on the whole score
 * map all the same, which changes with each keystroke, so each key worked the season out again:
 * measured on a twelve-team season with 54 games left, a phone (the CPU slowed four times) took a
 * median 384 ms from a key to the box showing it. Keyed on this instead, a keystroke in a game
 * still being played leaves them where they are, and the work is done once, when the game is
 * marked final.
 *
 * Unchanged means the same games, each with the very score it had: a score is replaced whole when
 * it changes (`updateLog`), so identity says exactly when one did, including a correction to a game
 * already final.
 */
export const finalLogsOf = (
  logs: Readonly<Record<string, GameLog>>,
  previous?: Readonly<Record<string, GameLog>>
): Record<string, GameLog> => {
  const finals = Object.entries(logs).filter(([, log]) => isFinal(log));
  if (
    previous &&
    finals.length === Object.keys(previous).length &&
    finals.every(
      ([id, log]) => Object.prototype.hasOwnProperty.call(previous, id) && previous[id] === log
    )
  ) {
    return previous;
  }
  return Object.fromEntries(finals);
};
