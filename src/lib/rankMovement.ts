import {
  fitScoutYearFor,
  rankingPoolGroupIds,
  rowsOfYearFit,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
  type SeasonSegment,
} from "./teamRankings";
import { shiftIsoDay } from "./date";

/** How far back "since last week" looks. */
export const LAST_WEEK_DAYS = 7;

/** The ISO day `days` before `today`, counted in whole calendar days. */
export const daysBefore = (today: string, days: number = LAST_WEEK_DAYS): string =>
  shiftIsoDay(today, -days);

/**
 * How many weeks back the "My team" rank line looks, last week's board included: most of a half.
 * Beside `ranksAsOf` because both the hook that walks the line and the worker that keeps its
 * boards read it.
 */
export const RANK_HISTORY_WEEKS = 8;

/** A week of a club's place, oldest first in a rank line; null where it was not on the board. */
export type RankLinePoint = { asOf: string; rank: number | null };

/**
 * One step of the "My team" rank line, a week further back: the line so far, oldest first and
 * ending before last week, with the board of `weeksBack` weeks ago (`asOf`), where the club stood
 * on it (`rank`, null when it was not on it) and whether anyone was. The week is added unless its
 * board was empty, and the walk stops there: at an empty board, where the half had not begun; at
 * two weeks running without the club, last week's place (`lastWeekRank`) counting as the first
 * week of the walk; and at `RANK_HISTORY_WEEKS`. The page walks it a week at a time as each fit
 * comes back (`useRankingsWorker`), and a server publishing the line in one go
 * (`views/board.ts`), so the two cannot walk it differently.
 */
export const rankLineStep = ({
  points,
  lastWeekRank,
  weeksBack,
  asOf,
  rank,
  empty,
}: {
  points: readonly RankLinePoint[];
  lastWeekRank: number | null;
  weeksBack: number;
  asOf: string;
  rank: number | null;
  empty: boolean;
}): { points: RankLinePoint[]; done: boolean } => {
  // The newest week walked so far, or last week before any: a week the club was missing from is
  // null, and must not fall through to last week's place, or a club on last week's board walked
  // back through every week it was away.
  const newest = points[0];
  const newer = newest ? newest.rank : lastWeekRank;
  return {
    points: empty ? [...points] : [{ asOf, rank }, ...points],
    done: empty || weeksBack >= RANK_HISTORY_WEEKS || (rank === null && newer === null),
  };
};

/**
 * Every club's place on its page as the board stood on `asOf`: the year fitted on the games played
 * by then, weighed as they were that day, and every page of the year cut from that one fit.
 *
 * A board is a fit of everything played so far and keeps no history, so "did we climb?" can only
 * be answered by fitting again as of a day gone by. Every page at once because they are one fit,
 * and the numbers are all that is kept: holding a second year's fit beside the board's would be
 * another 44 MB on the 18:40 pool, where these are a number a club. A result posted since for a
 * game played before `asOf` is in it, so last week recomputed can differ from what was on screen
 * then; that is the price of not keeping a copy of every board.
 */
export const ranksAsOf = (
  ageGroupId: string,
  teams: ScoutTeam[],
  games: ScoutGame[],
  ageGroups: AgeGroup[],
  segment: SeasonSegment | undefined,
  asOf: string
): Record<string, number> => {
  const fit = fitScoutYearFor(ageGroupId, teams, games, ageGroups, segment, asOf);
  if (!fit) return {};
  const ranks: Record<string, number> = {};
  rankingPoolGroupIds(ageGroupId, ageGroups).forEach((pageId) => {
    rowsOfYearFit(fit, pageId, undefined, ageGroups).forEach((row) => {
      ranks[row.teamId] = row.rank;
    });
  });
  return ranks;
};

/** Places climbed since last week (negative for a fall), or "new" for a club that was not ranked. */
export type Movement = number | "new";

/**
 * How far a club has moved on its page. Nothing at all when there was no board a week ago — the
 * first week of a half, when every club would otherwise read "new".
 */
export const movementOf = (
  teamId: string,
  rank: number,
  previous: Readonly<Record<string, number>> | null
): Movement | undefined => {
  if (!previous) return undefined;
  const before = previous[teamId];
  if (before === undefined) return Object.keys(previous).length > 0 ? "new" : undefined;
  return before - rank;
};
