import {
  fitScoutYearFor,
  rankingPoolGroupIds,
  rowsOfYearFit,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
  type SeasonSegment,
} from "./teamRankings";

/** How far back "since last week" looks. */
export const LAST_WEEK_DAYS = 7;

/** The ISO day `days` before `today`, counted in whole calendar days. */
export const daysBefore = (today: string, days: number = LAST_WEEK_DAYS): string => {
  const at = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(at)) return today;
  return new Date(at - days * 86_400_000).toISOString().slice(0, 10);
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
