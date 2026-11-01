/**
 * How far a club has moved on its page since last week, apart from the boards of past weeks it is
 * read against (`rankMovement.ts`, which re-exports it and fits those boards): the club card's place
 * that League Standings reads (`myTeamGlance`, through `leagueClubRanks`) is in its first download,
 * and only Team Rankings fits a past week's board.
 */

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
