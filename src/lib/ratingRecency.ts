/**
 * How much an old result should still count.
 *
 * The rating fit reads every game in a squad year as equally informative. A game from the first
 * weekend of August counts exactly as much as one from last night, and for a youth team that is
 * plainly wrong: the same name in August and in June is a different side, eleven months older,
 * with players who have grown and several who have left.
 *
 * What is *not* obvious is how fast to discount, and the honest answer is that nobody knows it
 * from a chair. Youth baseball does not decay smoothly. A squad plays August to October, stops
 * dead for four or five months, and starts again in March — so "three months ago" means one thing
 * inside a season and something else entirely across the winter. A half-life picked by intuition
 * would quietly encode a guess about that gap.
 *
 * So this module is a set of candidate schemes rather than a decision. Each turns a pool of dated
 * games into per-game weights; `scoutBacktest` scores them against games the fit never saw, and
 * the one that predicts best is the one that ships.
 *
 * Every scheme normalises its weights to average one. The ridge in the fit is denominated in games
 * and is a constant, so a scheme whose weights averaged a half would be handing the fit half the
 * evidence and regressing every rating twice as far toward the mean — and a sweep comparing such
 * schemes would be measuring shrinkage as much as recency. Normalising keeps every candidate on
 * the same footing, with only the *relative* weight of old against new telling them apart.
 */

/** A game, reduced to what a weighting scheme needs to know about it. */
export type DatedRatingGame = {
  /** Milliseconds since the epoch. */
  at: number;
  /** The two sides, so a scheme can count a team's own games rather than the pool's. */
  home: string;
  away: string;
};

export type RecencyScheme = {
  /** Stable name, for a sweep's report and for storing the winner. */
  key: string;
  /** What it does, in a phrase, for the report. */
  label: string;
  /**
   * The weight of each game, in the order given. `asOf` is the day the ratings are being read on:
   * a game's age is measured from there, not from the newest game in the pool, so a pool that
   * stopped two months ago is old rather than fresh.
   */
  weigh: (games: readonly DatedRatingGame[], asOf: number) => number[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Rescales so the weights average one, leaving their ratios untouched.
 *
 * All-zero comes back all-one: a scheme that finds nothing worth counting is a scheme with no
 * opinion, and handing the fit a pool of zeros would rate every team exactly average rather than
 * say so.
 */
export const normalizeWeights = (weights: readonly number[]): number[] => {
  if (weights.length === 0) return [];
  const total = weights.reduce((sum, weight) => sum + (weight > 0 ? weight : 0), 0);
  if (total <= 0) return weights.map(() => 1);
  const mean = total / weights.length;
  return weights.map((weight) => (weight > 0 ? weight / mean : 0));
};

/** Every game counts the same — the model as it stands, and the control every sweep needs. */
export const noDecay: RecencyScheme = {
  key: "none",
  label: "every game counts the same",
  weigh: (games) => games.map(() => 1),
};

/**
 * Half the weight for every `halfLifeDays` of age.
 *
 * The obvious scheme, and the one with the winter problem: a team that played its whole season in
 * the fall is, by March, being read almost entirely off a ridge rather than off its results — even
 * though those fall results are the only evidence anybody has about it.
 */
export const byDays = (halfLifeDays: number): RecencyScheme => ({
  key: `days-${halfLifeDays}`,
  label: `half weight every ${halfLifeDays} days`,
  weigh: (games, asOf) =>
    normalizeWeights(
      games.map((game) => {
        const ageDays = Math.max(0, (asOf - game.at) / DAY_MS);
        return 0.5 ** (ageDays / halfLifeDays);
      })
    ),
});

/**
 * Half the weight for every `halfLife` games the team has played since.
 *
 * Counted per team rather than per pool, and it is the answer to the winter gap: a squad that
 * played twelve games in the fall and none since is being read off twelve recent games, because
 * from that squad's point of view nothing has happened since. Time has passed; evidence has not.
 *
 * A game has two sides and they will usually disagree about how old it is — the same fixture may
 * be a team's last game and its opponent's first. The larger of the two weights wins, so a game
 * stays as fresh as the fresher side considers it: discarding one side's recent form because the
 * other has played on is throwing away the half we most wanted.
 */
export const byGamesSince = (halfLife: number): RecencyScheme => ({
  key: `games-${halfLife}`,
  label: `half weight every ${halfLife} games since`,
  weigh: (games) => {
    const order = games
      .map((game, at) => ({ game, at }))
      .sort((a, b) => a.game.at - b.game.at || a.at - b.at);
    /** How many games each side has played after this one, counted from the newest backwards. */
    const since = new Map<string, number>();
    const weights = new Array<number>(games.length).fill(1);
    for (let i = order.length - 1; i >= 0; i -= 1) {
      const entry = order[i]!;
      const home = since.get(entry.game.home) ?? 0;
      const away = since.get(entry.game.away) ?? 0;
      weights[entry.at] = Math.max(0.5 ** (home / halfLife), 0.5 ** (away / halfLife));
      since.set(entry.game.home, home + 1);
      since.set(entry.game.away, away + 1);
    }
    return normalizeWeights(weights);
  },
});

/**
 * Full weight for anything since the last long break, and `older` for everything before it.
 *
 * The blunt reading of the fall-to-spring problem: within a block of play a game is a game, and
 * crossing the winter costs a single step down rather than a slide. A break is any stretch of
 * `gapDays` with no games anywhere in the pool, which is what a youth off-season looks like from
 * the inside.
 */
export const byBlock = (older: number, gapDays = 45): RecencyScheme => ({
  key: `block-${older}`,
  label: `last block full, earlier blocks ${older}`,
  weigh: (games) => {
    if (games.length === 0) return [];
    const days = [...new Set(games.map((game) => Math.floor(game.at / DAY_MS)))].sort(
      (a, b) => a - b
    );
    // The first day of the most recent block: walk back from the newest until a gap opens up.
    let blockStart = days[days.length - 1]!;
    for (let i = days.length - 1; i > 0; i -= 1) {
      if (days[i]! - days[i - 1]! > gapDays) break;
      blockStart = days[i - 1]!;
    }
    return normalizeWeights(
      games.map((game) => (Math.floor(game.at / DAY_MS) >= blockStart ? 1 : older))
    );
  },
});

/**
 * The candidates worth trying, with the control first.
 *
 * Wide on purpose and pruned by evidence, not by taste. The day half-lives bracket a season from
 * "only the last month matters" to "barely any decay at all"; the games-since ones bracket a
 * couple of weekends to most of a season; the block ones bracket "the off-season is a soft hint"
 * to "it barely counts".
 */
export const RECENCY_SCHEMES: RecencyScheme[] = [
  noDecay,
  byDays(30),
  byDays(60),
  byDays(90),
  byDays(120),
  byDays(180),
  byGamesSince(5),
  byGamesSince(10),
  byGamesSince(20),
  byGamesSince(40),
  byBlock(0.6),
  byBlock(0.35),
  byBlock(0.15),
];
