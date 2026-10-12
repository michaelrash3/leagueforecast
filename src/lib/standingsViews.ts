import type { HeadToHeadRecord, Team } from "./types";

/**
 * Three small rules the standings views read off the table, each of which was a closure inside the
 * component and none of which anything guarded.
 *
 * They are here for the reason the round robin is: none of them needs a browser, and two of them
 * carry numbers — how wide the bubble is, which way ties fall — that this project's own rule says
 * to pin before anybody moves them.
 */

/** How one team's season against another reads in the matrix. */
export type HeadToHeadCell = "win" | "loss" | "tie" | "none" | "self";

/**
 * One cell of the head-to-head matrix.
 *
 * "none" covers two different things on purpose, because the matrix draws them the same: two clubs
 * that have not met, and a record that exists but is empty. The second happens — a record is
 * created when a game is booked and can be left at 0-0-0 by a game that was later removed — and it
 * must not read as a tie, which is a game that was played and finished level.
 */
export const headToHeadCell = (
  record: HeadToHeadRecord | undefined,
  rowId: string,
  colId: string
): HeadToHeadCell => {
  if (rowId === colId) return "self";
  if (!record) return "none";
  const { wins, losses, ties } = record;
  if (wins === 0 && losses === 0 && ties === 0) return "none";
  if (wins > losses) return "win";
  if (losses > wins) return "loss";
  return "tie";
};

/**
 * Every team's rank by strength of schedule, hardest first.
 *
 * Dense positions from one, ties broken by the order given rather than shared, because this is a
 * lookup for "you have played the Nth hardest schedule" and two teams cannot both be third in a
 * sentence like that.
 */
export const sosRanks = (teams: readonly Pick<Team, "id" | "sos">[]): Record<string, number> => {
  const ranks: Record<string, number> = {};
  [...teams]
    .sort((a, b) => b.sos - a.sos)
    .forEach((team, index) => {
      ranks[team.id] = index + 1;
    });
  return ranks;
};

/**
 * How far either side of the cut line a seed still counts as on the bubble.
 *
 * Wider below than above, and deliberately: a team two seeds inside is nearly safe and mostly
 * wants to know it, while a team three seeds outside is the one still playing for it. Measured in
 * seeds rather than games, so it means the same thing in a six-team league and a sixteen.
 */
export const BUBBLE_ABOVE = 2;
export const BUBBLE_BELOW = 3;

/**
 * The teams near the cut line, by projected seed — the ones a result can still move across it.
 *
 * Projected rather than current, because the question is where the season is going. A team with no
 * projected seed at all sorts to the bottom and is not on anybody's bubble.
 */
export const teamsOnBubble = <T extends { projectedRank?: number }>(
  teams: readonly T[],
  cutoff: number
): T[] =>
  teams.filter((team) => {
    const seed = team.projectedRank ?? 99;
    return seed >= cutoff - BUBBLE_ABOVE && seed <= cutoff + BUBBLE_BELOW;
  });
