import { compareByTiebreaker, resolvedTiebreakerOrder, type RankOptions } from "./sim";
import type { Team, TiebreakerFactor } from "./types";

/** What put a team level on points below the one above it: a tiebreaker, the model's rating, or neither. */
export type TieBreak = { teamId: string; aboveId: string; by: TiebreakerFactor | "rating" | "id" };

/**
 * Each team the table puts below one level with it on points (and losses), and what separated the
 * two (`compareTiedTeams`): the first of the league's tiebreakers to tell them apart, the model's
 * rating where none did, or their ids where nothing did. `ranked` is `rankTeams`'s order.
 */
export const tieBreaks = (ranked: Team[], options: RankOptions): TieBreak[] => {
  const tiebreakerOrder = resolvedTiebreakerOrder(options);
  const pointsFor = (team: Team) =>
    team.w * (options.winPoints ?? 1) + team.t * (options.tiePoints ?? 0.5);
  const breaks: TieBreak[] = [];
  for (let at = 0; at < ranked.length; at += 1) {
    const above = ranked[at];
    if (!above) continue;
    // The size of the level group the comparison was made in: head-to-head counts for two alone.
    let end = at;
    while (
      end + 1 < ranked.length &&
      Math.abs(pointsFor(ranked[end + 1]!) - pointsFor(above)) <= 0.0001 &&
      ranked[end + 1]!.l === above.l
    )
      end += 1;
    let start = at;
    while (
      start > 0 &&
      Math.abs(pointsFor(ranked[start - 1]!) - pointsFor(above)) <= 0.0001 &&
      ranked[start - 1]!.l === above.l
    )
      start -= 1;
    const below = ranked[at + 1];
    if (!below || end === at) continue;
    const size = end - start + 1;
    const factor = tiebreakerOrder.find(
      (one) => compareByTiebreaker(above, below, one, size) !== 0
    );
    breaks.push({
      teamId: below.id,
      aboveId: above.id,
      by: factor ?? (Math.abs(below.tpi - above.tpi) > 0.0001 ? "rating" : "id"),
    });
  }
  return breaks;
};
