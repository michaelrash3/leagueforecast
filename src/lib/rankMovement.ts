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

/**
 * A week of a club's place, oldest first in a rank line; null where it was not on the board. `of`
 * is how many clubs that week's board of the page listed by rating (`PastBoard.sizes`), which the
 * line needs to say what share of them stood above the club: a board grows all season as clubs
 * play their first games, so the place alone sinks for a club that holds its own. Left out where it
 * was not known: a board published before the count was.
 */
export type RankLinePoint = { asOf: string; rank: number | null; of?: number };

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
  of,
  empty,
}: {
  points: readonly RankLinePoint[];
  lastWeekRank: number | null;
  weeksBack: number;
  asOf: string;
  rank: number | null;
  /** How many clubs that week's board of the page held (`PastBoard.sizes`). */
  of?: number;
  empty: boolean;
}): { points: RankLinePoint[]; done: boolean } => {
  // The newest week walked so far, or last week before any: a week the club was missing from is
  // null, and must not fall through to last week's place, or a club on last week's board walked
  // back through every week it was away.
  const newest = points[0];
  const newer = newest ? newest.rank : lastWeekRank;
  return {
    points: empty ? [...points] : [{ asOf, rank, ...(of ? { of } : {}) }, ...points],
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
): Record<string, number> =>
  pastBoardAsOf(ageGroupId, teams, games, ageGroups, segment, asOf).ranks;

/**
 * The boards of `ranksAsOf`'s day: every club's place, and how many clubs each page's board listed
 * by rating (`sizes`, by page id), the count a place is read against in a rank line
 * (`RankLinePoint.of`). Both come off the one fit, so the count costs nothing the places did not.
 *
 * The clubs listed last (`ScoutRankingRow.listedLast`) are not counted. They stand below every
 * other club by the order, whatever their rating, and the line grows with the season, so more of
 * them sat under each club every week: on the owner's page of 27 October 2026, read on the cloud
 * copy for research, a club whose share of the rest went from the top 93% to the top 84% read as
 * the top 83% of the board going to the top 71%, and a line scaled to its own range drew that as a
 * steep climb. A club itself listed last has a place past the count and no point on the line.
 */
export type PastBoard = { ranks: Record<string, number>; sizes: Record<string, number> };

export const pastBoardAsOf = (
  ageGroupId: string,
  teams: ScoutTeam[],
  games: ScoutGame[],
  ageGroups: AgeGroup[],
  segment: SeasonSegment | undefined,
  asOf: string
): PastBoard => {
  const fit = fitScoutYearFor(ageGroupId, teams, games, ageGroups, segment, asOf);
  if (!fit) return { ranks: {}, sizes: {} };
  const ranks: Record<string, number> = {};
  const sizes: Record<string, number> = {};
  rankingPoolGroupIds(ageGroupId, ageGroups).forEach((pageId) => {
    const rows = rowsOfYearFit(fit, pageId, undefined, ageGroups);
    const listed = rows.filter((row) => !row.listedLast).length;
    if (listed > 0) sizes[pageId] = listed;
    rows.forEach((row) => {
      ranks[row.teamId] = row.rank;
    });
  });
  return { ranks, sizes };
};

/* A club's movement on its page is a module of its own, which League Standings' start reads. */
export { movementOf } from "./movement";
export type { Movement } from "./movement";
