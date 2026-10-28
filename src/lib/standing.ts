/**
 * Where a place stands among the clubs on its board, as the share at or above it: #1 of 200 is the
 * top 1%, #2,737 of 7,126 the top 39%. Rounded up and never below 1%, so it never reads better
 * than the place is. A board fills all season as clubs play their first games, so a place alone
 * sinks for a club that holds its own; the share does not (the My Team card's standing line, and
 * League Standings' ranks).
 */
export const topShare = (rank: number, of: number): number =>
  Math.min(100, Math.max(1, Math.ceil((100 * rank) / of)));

/**
 * Where a place stands, in the words a parent reads it in: the share at or above it, "top 10%",
 * or where the share at or below it is the smaller, that one, "bottom 16%", which "top 84%" read as
 * good news to the owner of a club near the foot of its board. Rounded up as `topShare` is, so it
 * says no more than the place: #7,400 of 8,000 has 601 clubs at or below it, the bottom 8%.
 */
export const standingWords = (rank: number, of: number): string => {
  const top = topShare(rank, of);
  const bottom = topShare(Math.max(1, of - rank + 1), of);
  return bottom < top ? `bottom ${bottom}%` : `top ${top}%`;
};
