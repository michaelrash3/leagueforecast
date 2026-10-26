/**
 * How far a club's web of games reaches: the distinct clubs it has played, then those and the clubs
 * they played, and so on out, the owner's question of 26 October 2026: "Maybe we need to look and
 * see how far the teams expand out in the web of games they have played. How far does the opponent
 * tree branch out?"
 *
 * A club whose games never leave one small league reaches the same handful of clubs however far
 * out it is followed, where a club that plays tournaments reaches hundreds within two games. That
 * is what the community's outside games (`scheduleCommunities.ts`) were standing in for, read per
 * club and without a community to be put in: the fit grouped the Longhorns' league of eight with
 * 52 other clubs nearby.
 *
 * Counted to `REACH_CAP`: past that a club is plainly not closed, and stopping there keeps the
 * count of a pool of a hundred thousand clubs to seconds.
 */

/** The most clubs a reach is counted to. */
export const REACH_CAP = 1000;

/**
 * A counter of each club's reach over `games`: the distinct clubs within `hops` games of it, itself
 * left out, to `REACH_CAP`. Remembered per club and distance, so a board asks for each once.
 */
export const opponentTree = (
  games: Iterable<{ teamAId: string; teamBId: string }>
): ((id: string, hops: number) => number) => {
  const next = new Map<string, string[]>();
  const link = (from: string, to: string) => {
    const known = next.get(from);
    if (known) known.push(to);
    else next.set(from, [to]);
  };
  for (const game of games) {
    if (game.teamAId === game.teamBId) continue;
    link(game.teamAId, game.teamBId);
    link(game.teamBId, game.teamAId);
  }
  const memo = new Map<string, number>();
  return (id, hops) => {
    const key = `${hops}\u0000${id}`;
    const known = memo.get(key);
    if (known !== undefined) return known;
    const seen = new Set<string>([id]);
    let frontier = [id];
    for (let step = 0; step < hops && frontier.length > 0; step += 1) {
      const ahead: string[] = [];
      for (const at of frontier) {
        for (const other of next.get(at) ?? []) {
          if (seen.has(other)) continue;
          seen.add(other);
          ahead.push(other);
          if (seen.size > REACH_CAP) break;
        }
        if (seen.size > REACH_CAP) break;
      }
      frontier = ahead;
      if (seen.size > REACH_CAP) break;
    }
    const reach = Math.min(REACH_CAP, seen.size - 1);
    memo.set(key, reach);
    return reach;
  };
};

/** The 10th, 25th and 50th percentiles of some reaches, nearest rank, or nothing for none. */
export const reachPercentiles = (
  values: readonly number[]
): { p10: number; p25: number; p50: number } | undefined => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (share: number) => sorted[Math.max(0, Math.ceil(share * sorted.length) - 1)]!;
  return { p10: at(0.1), p25: at(0.25), p50: at(0.5) };
};
