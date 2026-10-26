/**
 * How far a club's web of games reaches, and the line a board lists clubs by: the owner's rule of
 * 26 October 2026, of the Longhorns, #4 in Kentucky at 9U on an 8-0 record against their own
 * league. "No way should they be in the top 10 at all. They are beating up on teams in a league
 * that is called Minors … because they are too afraid to play tougher competition." Then: "How far
 * does the opponent tree branch out?", and: "I think the opponent web style rule would work better
 * as it would allow the rule to expand with the amount of games played."
 *
 * A club's web within `WEB_GAMES` games is every distinct club it played, and every club those
 * played, and so on, five games out. A club whose games stay inside one small league reaches the
 * same handful however far out it is followed; a club that plays the wider pool reaches hundreds.
 * A board lists a club whose web reaches fewer than `WEB_SHARE` of the typical club's after every
 * club whose web does not, each part in rating order. The typical web is the median over the clubs
 * the board's games name (`WEB_SAMPLE`), so the line is drawn from the same games as the fit: small
 * at the start of a season, when every club has played a handful of games, and growing as they play
 * more. Ratings and predictions are untouched: only the order the clubs are listed and numbered in,
 * and nothing on the page says so, as the owner asked.
 *
 * Measured on the cloud copy of 26 October 2026 (the 2027 squad year; 158,070 clubs on 11 pages),
 * against the boards as they were and against e10, a line of ten games between a club's league and
 * the rest of the pool:
 * - The Longhorns reach 7, 8, 15, 27 and 39 clubs within one to five games, where the typical
 *   club's web reaches 580 within five, so the line stood at 58: they go from #4 in Kentucky to #88,
 *   and Kentucky's top 10 is otherwise as it was, its #11 coming in at #10. Their league's one way
 *   out is seven games long, to a club whose three games outside were lost by 11, 11 and 12.
 * - 64 of 556 state #1s change, 3 of the 375 whose league is well connected (31 outside games or
 *   more; the owner's limit was 15), and 245 of 250 national top-25 places stand. e10 changed 72,
 *   none well connected, and kept 242; a quarter of the typical web changed 71, 4 and kept 244.
 * - Lines of a fixed size read closer in moved too many well-connected #1s: fewer than 25 clubs
 *   within two games moved 29, fewer than 100 within three 30. Close in, a strong club with a few
 *   games against well-travelled teams reaches as few clubs as a closed league.
 * - No order is a better forecast of who wins than the rating's alone: on 173,614 later decided
 *   games the club listed higher lost 34.02% of the time under this order against 33.30% under the
 *   rating's (e10 34.39%). So it orders the lists and never the odds.
 * - On the first, eighth and fifteenth of September the typical web within five games was 10, 16
 *   and 28 clubs, which put the line at one to three: early in a season it holds back only the clubs
 *   that have played nobody beyond a league of two or three.
 *
 * Counted to `WEB_CAP`, past which a club is plainly not closed. Its own module, apart from the
 * rating's, as the numbers in it are a board's order and nothing a rating reads.
 */

/** How many games out a club's web is followed. */
export const WEB_GAMES = 5;

/** The share of the typical club's web a club's must reach to be listed among the rest. */
export const WEB_SHARE = 0.1;

/** The most clubs a web is counted to. */
export const WEB_CAP = 1000;

/**
 * How many clubs the typical web is read from. A walk out to `WEB_CAP` from every club took 2.7 s on
 * a made-up web of the cloud copy's size (160,000 clubs, 400,000 games), where the year's fit takes
 * about 4 s on GitHub's runner, and a board is built after every save of the copy, with a fit for
 * each of its weeks. So the median is read off an evenly spaced sample of the clubs, in the order
 * the games name them, and a club's own web is walked only as far as the line. On three made-up
 * webs of 100,000 to 160,000 clubs, the sample's median was the whole one's and every club stood on
 * the same side of the line, and the walks took 0.2 to 1.1 s.
 */
export const WEB_SAMPLE = 4096;

/** The webs of a board's games. */
export type OpponentWeb = {
  /** A club's web within `WEB_GAMES` games, itself left out, to `WEB_CAP`; 0 for a club no game names. */
  reach: (teamId: string) => number;
  /** The typical club's: the median, nearest rank, over every club the games name or a sample. */
  typical: number;
  /** The reach below which a club is listed after the rest: `WEB_SHARE` of the typical. */
  line: number;
  /** Whether a club's web reaches the line, which lists it among the rest. */
  reachesLine: (teamId: string) => boolean;
};

/**
 * The webs of a board's games, each given as its two sides. Walked over the games as whole
 * numbers, each club marked as seen with the walk's own number so no walk clears anything, and a
 * pair of clubs that played more than once linked once.
 */
export const opponentWeb = (pairs: Iterable<readonly [string, string]>): OpponentWeb => {
  const index = new Map<string, number>();
  const at = (id: string): number => {
    const known = index.get(id);
    if (known !== undefined) return known;
    index.set(id, index.size);
    return index.size - 1;
  };
  // Both ends of every game between two clubs, a club against itself leading nowhere.
  const ends: number[] = [];
  for (const [a, b] of pairs) {
    const from = at(a);
    const to = at(b);
    if (from !== to) ends.push(from, to);
  }
  const count = index.size;
  // Each club's opponents packed one club after another, each opponent once.
  const start = new Int32Array(count + 1);
  for (let end = 0; end < ends.length; end += 1) start[ends[end]! + 1]! += 1;
  for (let club = 0; club < count; club += 1) start[club + 1]! += start[club]!;
  const linked = new Int32Array(ends.length);
  const filled = start.slice(0, count);
  for (let end = 0; end < ends.length; end += 2) {
    const a = ends[end]!;
    const b = ends[end + 1]!;
    linked[filled[a]!++] = b;
    linked[filled[b]!++] = a;
  }
  const first = new Int32Array(count + 1);
  const next = new Int32Array(ends.length);
  let packed = 0;
  for (let club = 0; club < count; club += 1) {
    first[club] = packed;
    const own = linked.subarray(start[club]!, start[club + 1]!).sort();
    for (let link = 0; link < own.length; link += 1) {
      if (link > 0 && own[link] === own[link - 1]) continue;
      next[packed] = own[link]!;
      packed += 1;
    }
  }
  first[count] = packed;

  const seen = new Int32Array(count);
  const queue = new Int32Array(count);
  let walks = 0;
  // The clubs within `WEB_GAMES` games of one, itself left out, counted no further than `limit`.
  const walk = (club: number, limit: number): number => {
    walks += 1;
    seen[club] = walks;
    queue[0] = club;
    let head = 0;
    let tail = 1;
    let reached = 0;
    for (let step = 0; step < WEB_GAMES && head < tail; step += 1) {
      const end = tail;
      for (; head < end; head += 1) {
        const from = queue[head]!;
        for (let link = first[from]!; link < first[from + 1]!; link += 1) {
          const other = next[link]!;
          if (seen[other] === walks) continue;
          if (reached >= limit) return limit;
          seen[other] = walks;
          queue[tail] = other;
          tail += 1;
          reached += 1;
        }
      }
    }
    return reached;
  };

  const stride = Math.max(1, Math.ceil(count / WEB_SAMPLE));
  const sample: number[] = [];
  for (let club = 0; club < count; club += stride) sample.push(walk(club, WEB_CAP));
  sample.sort((a, b) => a - b);
  const typical = sample.length === 0 ? 0 : sample[Math.ceil(sample.length / 2) - 1]!;
  const line = WEB_SHARE * typical;
  const reaches = new Map<number, boolean>();
  return {
    reach: (teamId) => {
      const club = index.get(teamId);
      return club === undefined ? 0 : walk(club, WEB_CAP);
    },
    typical,
    line,
    reachesLine: (teamId) => {
      const club = index.get(teamId);
      if (club === undefined) return line <= 0;
      const known = reaches.get(club);
      if (known !== undefined) return known;
      const reached = walk(club, Math.ceil(line)) >= line;
      reaches.set(club, reached);
      return reached;
    },
  };
};
