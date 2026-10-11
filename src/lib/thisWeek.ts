import type { ScoutRankingRow } from "./teamRankings";

/**
 * The "This week" card's movers (README, "This week"): who came into the board's top places since
 * the week before, who fell out of them, and the biggest climbs, from what every published board
 * already carries, its rows and each club's place a week before (`lastWeekOf`). Nothing is fetched
 * for it, so it draws with the board. A club that has left the board altogether is not named, since
 * the board no longer holds its name.
 */
export const TOP_PLACES = 25;

/** The most climbs listed, and the places a climb must end inside to be one worth naming. */
export const CLIMBS_SHOWN = 3;
export const CLIMB_WITHIN = 100;

export type WeekMove = { teamId: string; name: string; from: number | null; to: number };
export type WeekMovers = { into: WeekMove[]; outOf: WeekMove[]; climbs: WeekMove[] };

const placeOf = (row: ScoutRankingRow): number => row.overallRank ?? row.rank;

/** The week's movers, or null when the board has no week before to measure against. */
export const weekMovers = (
  rows: readonly ScoutRankingRow[],
  lastWeek: Readonly<Record<string, number>> | null
): WeekMovers | null => {
  if (!lastWeek || Object.keys(lastWeek).length === 0) return null;
  const moves = rows.map((row): WeekMove => ({
    teamId: row.teamId,
    name: row.teamName,
    from: lastWeek[row.teamId] ?? null,
    to: placeOf(row),
  }));
  const wasTop = (move: WeekMove) => move.from !== null && move.from <= TOP_PLACES;
  const into = moves
    .filter((move) => move.to <= TOP_PLACES && !wasTop(move))
    .sort((a, b) => a.to - b.to);
  const outOf = moves
    .filter((move) => move.to > TOP_PLACES && wasTop(move))
    .sort((a, b) => (a.from ?? 0) - (b.from ?? 0));
  const climbs = moves
    .filter((move) => move.from !== null && move.from > move.to && move.to <= CLIMB_WITHIN)
    .sort((a, b) => (b.from ?? 0) - b.to - ((a.from ?? 0) - a.to) || a.to - b.to)
    .slice(0, CLIMBS_SHOWN);
  return { into, outOf, climbs };
};
