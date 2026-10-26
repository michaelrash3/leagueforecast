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

type Game = { teamAId: string; teamBId: string };

/** Each club's opponents, a club once for every game. */
const linksOf = (games: Iterable<Game>): Map<string, string[]> => {
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
  return next;
};

/** A club's reach within some games, as `opponentTree` counts it. */
export type Reach = (id: string, hops: number) => number;

/**
 * A counter of each club's reach over `games`: the distinct clubs within `hops` games of it, itself
 * left out, to `REACH_CAP`. One walk out from a club counts every distance up to the one asked for,
 * and is remembered, so a board asks for each club once however many distances its orders read.
 */
export const opponentTree = (games: Iterable<Game>): Reach => {
  const next = linksOf(games);
  // Each club's reach within one, two, … games, as far out as it has been asked for.
  const memo = new Map<string, number[]>();
  return (id, hops) => {
    if (hops <= 0) return 0;
    const known = memo.get(id);
    if (known && known.length >= hops) return known[hops - 1]!;
    const levels: number[] = [];
    const seen = new Set<string>([id]);
    let frontier = [id];
    while (levels.length < hops) {
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
      // Past the cap every further distance is the cap; a web with nowhere left to go stays put.
      frontier = seen.size > REACH_CAP ? [] : ahead;
      levels.push(Math.min(REACH_CAP, seen.size - 1));
    }
    memo.set(id, levels);
    return levels[hops - 1]!;
  };
};

/**
 * The typical club's reach over the same games: the median, within `hops` games, over every club
 * the games name, remembered per distance. The owner's third reading of the proven ranking, 26
 * October 2026: "I think the opponent web style rule would work better as it would allow the rule
 * to expand with the amount of games played." A line drawn as a share of the typical web does: on
 * the first of September the typical club has played a handful of games and its web is small, and
 * by the season's end it has played many more and its web reaches hundreds.
 */
export const typicalReach = (games: Iterable<Game>, reach: Reach): ((hops: number) => number) => {
  const ids = new Set<string>();
  for (const game of games) {
    ids.add(game.teamAId);
    ids.add(game.teamBId);
  }
  const memo = new Map<number, number>();
  return (hops) => {
    const known = memo.get(hops);
    if (known !== undefined) return known;
    const median = reachPercentiles([...ids].map((id) => reach(id, hops)))?.p50 ?? 0;
    memo.set(hops, median);
    return median;
  };
};

/**
 * The shortest chains of games out from one club, to `hops` games: for any club, the clubs from
 * `from` to it in order, both ends included, one game apart each, or nothing when it is further.
 * The owner asked how the club asked about's web compares with that of a club the fit put in its
 * league which did play outside it; the chain says how many games apart the two are, and through
 * whom.
 */
export const chainsFrom = (
  games: Iterable<Game>,
  from: string,
  hops: number
): ((to: string) => string[] | undefined) => {
  const next = linksOf(games);
  const before = new Map<string, string | undefined>([[from, undefined]]);
  let frontier = [from];
  for (let step = 0; step < hops && frontier.length > 0; step += 1) {
    const ahead: string[] = [];
    for (const at of frontier) {
      for (const other of next.get(at) ?? []) {
        if (before.has(other)) continue;
        before.set(other, at);
        ahead.push(other);
      }
    }
    frontier = ahead;
  }
  return (to) => {
    if (!before.has(to)) return undefined;
    const chain: string[] = [];
    for (let at: string | undefined = to; at !== undefined; at = before.get(at)) chain.push(at);
    return chain.reverse();
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
