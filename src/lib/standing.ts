/**
 * Where a place stands among the clubs on its board, as the share at or above it: #1 of 200 is the
 * top 1%, #2,737 of 7,126 the top 39%. Rounded up and never below 1%, so it never reads better
 * than the place is. A board fills all season as clubs play their first games, so a place alone
 * sinks for a club that holds its own; the share does not (the My Team card's standing line, and
 * League Standings' ranks).
 */
export const topShare = (rank: number, of: number): number =>
  Math.min(100, Math.max(1, Math.ceil((100 * rank) / of)));
