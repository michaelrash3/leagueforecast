import { countsTowardRating } from "./games";
import { segmentOfDate, segmentOn, type SeasonSegment } from "./seasons";
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

/**
 * Which half a year opens on when the URL does not say.
 *
 * The half we are in now for the year we are in now, and the spring for any other — a finished
 * season is read at its end, and the spring is both the later half and, on real data, much the
 * larger table.
 *
 * The calendar's answer, which is not always the useful one: a year with nothing in its spring
 * would open on an empty board. Preferring a half that has games is `segmentWorthShowing`'s job,
 * and it applies only where the URL named no half — a reader who asked for Spring 2027 and was
 * silently moved to Fall 2026 would be looking at a board the URL disagrees with.
 */
export const defaultSegmentFor = (
  year: number | undefined,
  today: string
): SeasonSegment | undefined => {
  if (year === undefined) return undefined;
  const now = segmentOn(today);
  return year === now.year ? now.segment : "spring";
};

/**
 * How much of the other half's play the calendar's half needs before a board opens on it: a tenth
 * of its counted games.
 *
 * A winter's tournaments are a sliver of an autumn. The 26 September 2026 pool held 150,408 games
 * scored in August and September, and 317 scheduled for all of January and February; scored to
 * the last, those would be a fifth of one percent of an autumn not two months old. Opened on the
 * calendar's half the day it held any game at all, the board went to the spring on the first
 * January weekend anywhere in the country — a table of a few dozen Florida and Texas clubs, a game
 * or two each, and nobody else. A tenth is a spring under way in earnest, and far above anything a
 * winter plays.
 */
export const HALF_WORTH_SHOWING = 0.1;

/**
 * The calendar's half, unless it holds too little of the year's play to be worth opening on
 * (`HALF_WORTH_SHOWING`) and the other holds more.
 *
 * Only for a page the URL did not name a half for. A league that plays its whole season in the
 * autumn should not open on an empty spring board and be left to work out why, nor on one that
 * holds a handful of winter games; a season well into both halves opens where the calendar says.
 */
export const segmentWorthShowing = (
  wanted: SeasonSegment | undefined,
  played: Record<SeasonSegment, number>
): SeasonSegment | undefined => {
  if (wanted === undefined) return undefined;
  const other = wanted === "fall" ? "spring" : "fall";
  return played[wanted] < played[other] * HALF_WORTH_SHOWING ? other : wanted;
};
