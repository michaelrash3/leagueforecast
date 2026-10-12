import { countsTowardRating } from "./games";
import { segmentOfDate, type SeasonSegment } from "./seasons";
import type { ScoutGame } from "./types";

/**
 * How many counted games each half of a squad year holds, by the rule the fit counts a game by
 * (`countsTowardRating`) and over the list the boards are fitted from, so the count and the board
 * cannot disagree. A half with none says so on its own tab, and the board opens on a half worth
 * reading (`segmentWorthShowing`). Counted as merely scored, a score typed ahead on a day not yet
 * played, or a game kept only for the record, was a spring the board opened on in January and
 * fitted with nothing: the 26 September 2026 pool already held two scores dated March 2027.
 *
 * The page counts its pool's games with it, and a server publishing the boards counts the same
 * games for each page (`views/board.ts`), so a device reading the published counts opens on the
 * half the page would.
 */
export const countedByHalf = (
  games: readonly ScoutGame[],
  year: number | undefined,
  today: string
): Record<SeasonSegment, number> => {
  const counts: Record<SeasonSegment, number> = { fall: 0, spring: 0 };
  games.forEach((game) => {
    if (!countsTowardRating(game, today)) return;
    const half = segmentOfDate(game.date, year);
    if (half) counts[half] += 1;
  });
  return counts;
};
