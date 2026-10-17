/**
 * Where each rating starts: below average by as much as the club's league keeps to itself.
 *
 * The fit's ridge counts 1.5 virtual games for every rating (`DEFAULT_SHRINKAGE`). Played at
 * nought, as they were until board rules 7, they put nothing on the right-hand side of the normal
 * equations, and summing those equations over a connected piece of the schedule then cancels every
 * game, leaving the piece's ratings summing to exactly nought. So a group of clubs that only ever
 * played each other averaged what the whole nation averages, whatever the group was worth: a rec
 * league's 8-0 club stood as high in its state as an 8-0 travel club. The games inside the group
 * cannot say how good the group is; something else has to.
 *
 * What does is a measured starting level: every club's virtual games are played at its league's
 * level instead of at nought. Leagues are the schedule's communities, found here: each piece off
 * the largest one (an island, `scheduleComponents`) is one whole, and the largest piece is split by
 * Louvain's modularity at `COMMUNITY_RESOLUTION`. A community's outside games are the rated games
 * with exactly one side in it, and its level is `CLOSED_START_RUNS / (1 + outside /
 * CLOSED_START_HALF_GAMES)`: 1.6 runs below average with none, half that with ten, and nearer
 * average the more it has played outside itself, until its games, not its start, decide it.
 *
 * Measured on the owner's backup of 11 October 2026 (the 2027 squad year, 222,010 rated games),
 * fitted on the boards of 1, 8 and 15 September and checked on games after 22 September:
 * - against well-connected opponents, at equal shown rating, island clubs did 1.66 ± 0.22 runs
 *   worse than shown on the boards as published (1,108 appearances), and clubs whose community had
 *   1 to 10 outside games 1.15 to 1.63 worse (901);
 * - the level fitted on the early games was −1.5996 ± 0.2304 runs (36,028 games, 7,067 clusters),
 *   with ten outside games halving it the best of 2, 3, 5, 10, 20 and 40;
 * - on the 59,405 later games it lowered the squared error by 0.095 ± 0.022 runs² against the
 *   boards as published, and the Brier score of the win chance by 0.00034 ± 0.00007; where a
 *   weakly connected club met an outsider (7,448 games), by 0.72 ± 0.16 runs², and where it met a
 *   well-connected one (2,247), by 1.76 ± 0.40;
 * - on the 11 October boards, with the circular deduction removed as well, it kept 215 of the 250
 *   national top-25 places and changed 13 of the 276 state #1s held by well-connected clubs; 10 of
 *   those 13 change with only the deduction removed, and the level with the deduction kept (and
 *   fitted with it, at −1.65) would have changed 5.
 * A strong group that has truly played nobody else is shown 1.6 runs further below its level than
 * the ridge already shows it, by construction: the rule cannot tell such a group from a weak one,
 * and only games against outsiders can.
 *
 * Every number here is a count or a sum of counts, and the one division of each comparison is
 * taken in one fixed order, so the communities are the same on every engine and whatever order
 * the games come in: nodes are visited in the order given, which is the fit's roster order.
 */

/**
 * Louvain's resolution, against the whole schedule's games. The back-test compared 5, 20 and 50:
 * 5 was worse on the later games (by 0.032 ± 0.010 runs² overall, 0.23 ± 0.08 on the weakly
 * connected side), 50 could not be told from 20 and changed 18 well-connected state #1s, past the
 * 15 the owner allowed.
 */
export const COMMUNITY_RESOLUTION = 20;

/** Where a club whose league has played nobody outside itself starts, in runs. */
export const CLOSED_START_RUNS = -1.6;

/** The outside games at which a league's start is half `CLOSED_START_RUNS`. */
export const CLOSED_START_HALF_GAMES = 10;

/**
 * A move must gain more than this to be made, so a gain that is a rounding error away from
 * another is a tie, and a tie goes to the community a node is already in, then to the lowest
 * numbered one: the back-test's rule, which the constants above were fitted with.
 */
const GAIN_TOLERANCE = 1e-12;

/** How often a level's nodes are walked before it is taken as settled, and how many levels. */
const MAX_PASSES = 1000;
const MAX_LEVELS = 50;

/** The schedule's pieces as `scheduleComponents` reads them: which piece each club is in. */
type Pieces = { pieceOf: (id: string) => string; largest: string | null };

/** A schedule's communities. */
export type ScheduleCommunities = {
  /**
   * Each node's community, numbered by first appearance in the order the nodes were given. A node
   * no game names is in none: it has no schedule to read, so it starts at average.
   */
  of: ReadonlyMap<string, number>;
  /** Each community's rated games with exactly one side in it, by its number. */
  outside: readonly number[];
};

/** A weighted graph as compressed rows, each row's neighbours in ascending order. */
type Graph = {
  n: number;
  start: Int32Array;
  neighbour: Int32Array;
  weight: Float64Array;
  /** Each node's games against itself, which count twice in its degree. */
  self: Float64Array;
};

/**
 * A graph from a list of weighted edges, repeats summed. Each row is written in ascending order of
 * neighbour, which is what makes the order the communities are offered to a node, and so the
 * tie-breaks, independent of the order the edges came in.
 */
const graphOf = (
  n: number,
  from: Int32Array,
  to: Int32Array,
  weights: Float64Array,
  self: Float64Array
): Graph => {
  const count = new Int32Array(n + 1);
  for (let e = 0; e < from.length; e += 1) {
    count[from[e]! + 1]! += 1;
    count[to[e]! + 1]! += 1;
  }
  for (let i = 0; i < n; i += 1) count[i + 1]! += count[i]!;
  const rawNeighbour = new Int32Array(count[n]!);
  const rawWeight = new Float64Array(count[n]!);
  const fill = count.slice(0, n);
  for (let e = 0; e < from.length; e += 1) {
    const a = from[e]!;
    const b = to[e]!;
    rawNeighbour[fill[a]!] = b;
    rawWeight[fill[a]!] = weights[e]!;
    fill[a]! += 1;
    rawNeighbour[fill[b]!] = a;
    rawWeight[fill[b]!] = weights[e]!;
    fill[b]! += 1;
  }
  const start = new Int32Array(n + 1);
  const neighbour = new Int32Array(count[n]!);
  const weight = new Float64Array(count[n]!);
  const sum = new Float64Array(n);
  const seen: number[] = [];
  let at = 0;
  for (let i = 0; i < n; i += 1) {
    seen.length = 0;
    for (let raw = count[i]!; raw < count[i + 1]!; raw += 1) {
      const j = rawNeighbour[raw]!;
      if (sum[j] === 0) seen.push(j);
      sum[j]! += rawWeight[raw]!;
    }
    seen.sort((x, y) => x - y);
    for (const j of seen) {
      neighbour[at] = j;
      weight[at] = sum[j]!;
      sum[j] = 0;
      at += 1;
    }
    start[i + 1] = at;
  }
  return {
    n,
    start,
    neighbour: neighbour.slice(0, at),
    weight: weight.slice(0, at),
    self,
  };
};

/**
 * One level of moving nodes between communities: each node, in order, goes to the neighbouring
 * community with the largest modularity gain, `weight to it − resolution · degree · its total /
 * total`, if that beats staying by more than `GAIN_TOLERANCE`; passes repeat until none moves.
 * Returns each node's community, renumbered by first appearance.
 */
const localMoving = (
  graph: Graph,
  resolution: number,
  total: number
): { community: Int32Array; moved: boolean } => {
  const { n, start, neighbour, weight, self } = graph;
  const degree = new Float64Array(n);
  const community = new Int32Array(n);
  const tot = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    let d = 2 * self[i]!;
    for (let at = start[i]!; at < start[i + 1]!; at += 1) d += weight[at]!;
    degree[i] = d;
    community[i] = i;
    tot[i] = d;
  }
  if (total === 0) return { community, moved: false };
  const weightTo = new Float64Array(n);
  const touched: number[] = [];
  let movedAny = false;
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    let moves = 0;
    for (let i = 0; i < n; i += 1) {
      const own = community[i]!;
      const ki = degree[i]!;
      touched.length = 0;
      for (let at = start[i]!; at < start[i + 1]!; at += 1) {
        const c = community[neighbour[at]!]!;
        if (weightTo[c] === 0) touched.push(c);
        weightTo[c]! += weight[at]!;
      }
      tot[own]! -= ki;
      let best = own;
      let bestGain = weightTo[own]! - (resolution * ki * tot[own]!) / total;
      for (const c of touched) {
        if (c === own) continue;
        const gain = weightTo[c]! - (resolution * ki * tot[c]!) / total;
        if (
          gain > bestGain + GAIN_TOLERANCE ||
          (Math.abs(gain - bestGain) <= GAIN_TOLERANCE && c < best && best !== own)
        ) {
          best = c;
          bestGain = gain;
        }
      }
      tot[best]! += ki;
      if (best !== own) {
        community[i] = best;
        moves += 1;
        movedAny = true;
      }
      for (const c of touched) weightTo[c] = 0;
    }
    if (moves === 0) break;
  }
  const renumber = new Int32Array(n).fill(-1);
  let next = 0;
  for (let i = 0; i < n; i += 1) {
    const c = community[i]!;
    if (renumber[c] === -1) renumber[c] = next++;
    community[i] = renumber[c]!;
  }
  return { community, moved: movedAny };
};

/** The graph of a level's communities: one node each, games inside one kept as its own. */
const aggregate = (graph: Graph, community: Int32Array, k: number): Graph => {
  const self = new Float64Array(k);
  const from: number[] = [];
  const to: number[] = [];
  const weights: number[] = [];
  for (let i = 0; i < graph.n; i += 1) {
    const ci = community[i]!;
    self[ci]! += graph.self[i]!;
    for (let at = graph.start[i]!; at < graph.start[i + 1]!; at += 1) {
      const j = graph.neighbour[at]!;
      if (j < i) continue;
      const cj = community[j]!;
      if (ci === cj) self[ci]! += graph.weight[at]!;
      else {
        from.push(ci);
        to.push(cj);
        weights.push(graph.weight[at]!);
      }
    }
  }
  return graphOf(k, Int32Array.from(from), Int32Array.from(to), Float64Array.from(weights), self);
};

/** Louvain: moving, then folding each community into one node, until a level moves nothing. */
const louvain = (graph: Graph, resolution: number, total: number): Int32Array => {
  let level = graph;
  let membership = Int32Array.from({ length: graph.n }, (_, i) => i);
  for (let depth = 0; depth < MAX_LEVELS; depth += 1) {
    const { community, moved } = localMoving(level, resolution, total);
    if (!moved) break;
    let k = 0;
    for (let i = 0; i < community.length; i += 1) k = Math.max(k, community[i]! + 1);
    membership = membership.map((c) => community[c]!);
    level = aggregate(level, community, k);
  }
  return membership;
};

/**
 * The communities of a schedule: `ids` the fit's nodes in its roster order, `pairs` its rated
 * games, one pair a game, and `pieces` the schedule's connected pieces (`scheduleComponents`) over
 * the same two, so an island here is exactly a row that is not `comparable`.
 *
 * Louvain runs on the largest piece alone, against the total of every game the schedule holds,
 * islands' included, which is what the back-test measured its communities with: it only ever
 * moves a node to a neighbour's community, so no community crosses two pieces and leaving the
 * islands out changes nothing in the largest one but the time it takes. Where it joins no two of
 * the largest piece's clubs, that piece is kept whole as well (below). A game naming a side that
 * is not among `ids` is left out, as the fit leaves it out.
 */
export const scheduleCommunities = (
  ids: readonly string[],
  pairs: ReadonlyArray<readonly [string, string]>,
  pieces: Pieces,
  resolution: number = COMMUNITY_RESOLUTION
): ScheduleCommunities => {
  const index = new Map<string, number>();
  ids.forEach((id, i) => {
    if (!index.has(id)) index.set(id, i);
  });
  const n = ids.length;
  const onLargest = new Int32Array(n).fill(-1);
  const largest: number[] = [];
  ids.forEach((id, i) => {
    if (index.get(id) !== i) return;
    if (pieces.largest !== null && pieces.pieceOf(id) === pieces.largest) {
      onLargest[i] = largest.length;
      largest.push(i);
    }
  });

  const sideA = new Int32Array(pairs.length);
  const sideB = new Int32Array(pairs.length);
  const named = new Uint8Array(n);
  let games = 0;
  let inside = 0;
  for (const [a, b] of pairs) {
    const i = index.get(a);
    const j = index.get(b);
    if (i === undefined || j === undefined) continue;
    sideA[games] = i;
    sideB[games] = j;
    games += 1;
    named[i] = 1;
    named[j] = 1;
    if (onLargest[i]! >= 0) inside += 1;
  }

  // The largest piece's games, between its own nodes: a piece holds every game of its nodes.
  const from = new Int32Array(inside);
  const to = new Int32Array(inside);
  const self = new Float64Array(largest.length);
  let edges = 0;
  for (let g = 0; g < games; g += 1) {
    const a = onLargest[sideA[g]!]!;
    if (a < 0) continue;
    const b = onLargest[sideB[g]!]!;
    if (a === b) self[a]! += 1;
    else {
      from[edges] = a;
      to[edges] = b;
      edges += 1;
    }
  }
  const graph = graphOf(
    largest.length,
    from.slice(0, edges),
    to.slice(0, edges),
    new Float64Array(edges).fill(1),
    self
  );
  // Every game is a unit of degree at each of its two seats, a game against itself both at one.
  const top = louvain(graph, resolution, 2 * games);
  /*
   * A largest piece the resolution leaves a club apiece is kept whole, as an island is. That is a
   * small pool: Louvain joins two clubs of k games each that met once only where the whole
   * schedule holds more than 10·k² games, some 1,200 for clubs of eleven. Left a club apiece, each
   * club's own games would count as its league's games outside itself, so a closed league that
   * happened to be the largest piece started its clubs at −0.76 (eleven games each) beside an
   * equally closed island at −1.6, and its rows said it had played eleven games outside itself
   * when it had played none. On the 11 October 2026 year boards no club of the largest piece is a
   * community on its own, so this never applies there.
   */
  const unsplit = top.every((c, at) => c === at);

  const keys = new Map<string, number>();
  const of = new Map<string, number>();
  const communityAt = new Int32Array(n).fill(-1);
  ids.forEach((id, i) => {
    if (index.get(id) !== i || !named[i]) return;
    const key =
      onLargest[i]! >= 0 && !unsplit ? `c:${top[onLargest[i]!]}` : `p:${pieces.pieceOf(id)}`;
    let c = keys.get(key);
    if (c === undefined) {
      c = keys.size;
      keys.set(key, c);
    }
    of.set(id, c);
    communityAt[i] = c;
  });
  const outside = new Array<number>(keys.size).fill(0);
  for (let g = 0; g < games; g += 1) {
    const ca = communityAt[sideA[g]!]!;
    const cb = communityAt[sideB[g]!]!;
    if (ca === cb) continue;
    outside[ca]! += 1;
    outside[cb]! += 1;
  }
  return { of, outside };
};

/** Where a club starts whose league has played `outsideGames` games outside itself, in runs. */
export const startingLevel = (outsideGames: number): number =>
  CLOSED_START_RUNS / (1 + outsideGames / CLOSED_START_HALF_GAMES);

/**
 * The share of `CLOSED_START_RUNS` that `startingLevel` starts such a club at: 1 with no outside
 * games, a half at `CLOSED_START_HALF_GAMES`. What the weekly re-measure of the level
 * (`compareClosedLevels`) moves every start by, a run of level at a time. `startingLevel` keeps its
 * own division rather than multiplying this, so the boards are what they were to the bit.
 */
export const startingShare = (outsideGames: number): number =>
  1 / (1 + outsideGames / CLOSED_START_HALF_GAMES);

/** A node's league's outside games, or undefined for a node in no community. */
export const outsideGamesOf = (
  communities: ScheduleCommunities,
  id: string
): number | undefined => {
  const c = communities.of.get(id);
  return c === undefined ? undefined : communities.outside[c];
};

/** Every node's starting level (`startingLevel`), in the order the nodes were given. */
export const startingLevels = (communities: ScheduleCommunities): Map<string, number> => {
  const levels = new Map<string, number>();
  communities.of.forEach((c, id) => levels.set(id, startingLevel(communities.outside[c] ?? 0)));
  return levels;
};
