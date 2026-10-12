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
  /**
   * The half-life in days, on a scheme that halves a game's weight by its age alone (`byDays`).
   *
   * Said out loud rather than left inside `weigh` because such a scheme's weights fold down to
   * three numbers (`recencyBasisFor`), from which any one game's weight can be rebuilt by a reader
   * holding only its date (`recencyWeightOf`). A scheme that reads the other games, as counting
   * games since does, has no such summary and leaves this out.
   */
  halfLifeDays?: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A game's raw weight under a day-based scheme, before normalising: half for every `halfLifeDays`
 * it is older than `asOf`, and never more than a game played on `asOf` itself.
 *
 * One function for `byDays` and for rebuilding its weights from a basis (`recencyWeightOf`), so the
 * two cannot drift apart by a rewritten sum.
 */
const decayed = (asOf: number, at: number, halfLifeDays: number): number =>
  0.5 ** (Math.max(0, (asOf - at) / DAY_MS) / halfLifeDays);

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
  halfLifeDays,
  weigh: (games, asOf) =>
    normalizeWeights(games.map((game) => decayed(asOf, game.at, halfLifeDays))),
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

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The day a game was played, as an instant, or `NaN` for a date this pool cannot place.
 *
 * Deliberately not `parseDateValue`. That one normalises a date to "M/D" and re-parses it inside
 * one fixed calendar year, which is right for League Standings — a season there is one year, so
 * the year would only be noise. A squad year is not one calendar year. It runs August to July, so
 * ordering it that way sorts the spring *ahead of* the autumn it followed, and every recency
 * scheme then reads backwards, handing the oldest games full weight.
 *
 * Team Rankings stores a full "YYYY-MM-DD" and already sorts squad years by it lexically, in
 * `inSquadYear`, so anything else is not a date this pool can place. Noon UTC, so the day stays
 * whole whatever zone reads it back.
 */
export const dayInstant = (date: string | undefined): number =>
  date && ISO_DAY.test(date) ? Date.parse(`${date}T12:00:00Z`) : Number.NaN;

/**
 * The scheme the app actually ranks with.
 *
 * `byDays` — half weight for every ninety days of age — because that is what the systems this one
 * is modelled on do. Massey's least-squares ratings de-weight early-season games; Pomeroy's weight
 * a game by when it was played, with more weight the more recent, so that a rating says how strong
 * a side is *now*; and the Elo family reaches the same place by construction, a recent result
 * moving the number further than an old one. None of them steps the weight at a boundary inside
 * the season, and neither does this: the squad year is still the pool, exactly as `inSquadYear`
 * draws it, and an autumn game is still in the fit. It counts for less than a spring one by a slope
 * rather than a cliff — about a third of a fresh game's weight after five months, a quarter after
 * six.
 *
 * Ninety rather than thirty or sixty because of the winter. A day-based half-life reads a side that
 * stopped in October off the ridge by March in proportion to how fast it decays, and these seasons
 * run August to July with a four-month gap in the middle: thirty days would make the autumn
 * irrelevant by spring, which is a season split under another name. Ninety keeps it in.
 *
 * What the evidence is, honestly. `scripts/recencySweep.ts` was run on a nationwide pool seven
 * weeks into a squad year — the only backup small enough to export — and could not put the
 * cross-winter question, because that pool had no winter in it. In season, at four nested cuts, the
 * day-based schemes beat the control on every one and the games-since schemes were
 * indistinguishable from it; the hold-out was small and the shuffled-calendar null was not run to
 * completion, so that is a direction rather than a finding. Practice and the direction agree, and
 * that is the choice. A backup that crosses a winter lets the sweep decide it properly.
 *
 * Changing it is this one line — every candidate is in `RECENCY_SCHEMES`, and `noDecay` restores
 * exactly the behaviour that shipped before weighting existed.
 */
export const ACTIVE_RECENCY_SCHEME: RecencyScheme = byDays(90);

/**
 * The weight of each game, in the order given, under `scheme`.
 *
 * `null` means "hand the fit the games unchanged" — either the scheme has no opinion, or the pool
 * has no game this scheme can place. Callers attach nothing in that case, so a pool that cannot be
 * weighted fits bit-identically to how it always did, rather than through a layer of ones.
 *
 * A game whose date this pool cannot read keeps weight 1 rather than being dropped. The sweep can
 * afford to drop one, because it is measuring; a ranking cannot, because that game still happened
 * and still counts toward the record shown beside the rating.
 *
 * `asOf` is the newest dated game rather than the clock, which keeps a rating a pure function of
 * the pool: two readings a week apart agree. That costs a day-based scheme nothing. Every one of
 * its weights is scaled by the same factor whatever `asOf` is, and normalising cancels the factor,
 * so the weights depend only on the gaps between the games. `byGamesSince` and `byBlock` do not
 * read it at all.
 */
export const weightsForGames = (
  games: readonly { date?: string; home: string; away: string }[],
  scheme: RecencyScheme = ACTIVE_RECENCY_SCHEME
): number[] | null => {
  if (scheme.key === noDecay.key) return null;

  const dated: DatedRatingGame[] = [];
  const sourceIndex: number[] = [];
  let newest = Number.NEGATIVE_INFINITY;
  games.forEach((game, at) => {
    const instant = dayInstant(game.date);
    if (!Number.isFinite(instant)) return;
    dated.push({ at: instant, home: game.home, away: game.away });
    sourceIndex.push(at);
    // A loop rather than Math.max(...dated), which blows the stack on a nationwide pool.
    if (instant > newest) newest = instant;
  });
  if (dated.length === 0) return null;

  const weighed = scheme.weigh(dated, newest);
  const out = new Array<number>(games.length).fill(1);
  sourceIndex.forEach((at, i) => {
    out[at] = weighed[i] ?? 1;
  });
  return out;
};

/**
 * Everything a day-based scheme's weights over one set of games depend on, in three numbers: the
 * half-life, the newest dated game's day, and the mean of the raw weights the normalising divides
 * by. From these and a game's date, `recencyWeightOf` gives back that game's weight to the bit.
 *
 * It exists for a reader that holds a game but not the pool around it: a member's device, which has
 * a club's card and its published board and never the nationwide games the board was fitted over.
 */
export type RecencyBasis = {
  halfLifeDays: number;
  /** The newest dated game's day, as the pool stores it ("YYYY-MM-DD"). */
  newest: string;
  /** The mean raw weight over the dated games: what `normalizeWeights` divides each one by. */
  mean: number;
};

/**
 * The basis `weightsForGames` builds these games' weights from under `scheme`, so any one of them
 * can be rebuilt later from its date alone (`recencyWeightOf`).
 *
 * `null` wherever `weightsForGames` has every weight 1: the scheme has no opinion, no game carries a
 * date this pool can place, or every raw weight came to nothing, which `normalizeWeights` reads as
 * no opinion too. `undefined` for a scheme whose weights are not a function of a game's age alone
 * (`byGamesSince` reads the other games a side played; `byBlock` the gaps in the pool), so there is
 * no basis to give and a caller must not pretend one.
 *
 * The same raw weights in the same order, summed the way `normalizeWeights` sums them, so the mean
 * is the very number every weight was divided by. Measured on the 29 September 2026 backup's 2027
 * year, read on that day: over the year and the fall alike, every one of the 171,571 rated games'
 * weights rebuilt by `recencyWeightOf` was bit-identical to the one `weightsForGames` gave it, and
 * the basis took 110 ms to read off them.
 */
export const recencyBasisFor = (
  games: readonly { date?: string }[],
  scheme: RecencyScheme = ACTIVE_RECENCY_SCHEME
): RecencyBasis | null | undefined => {
  if (scheme.key === noDecay.key) return null;
  const { halfLifeDays } = scheme;
  if (halfLifeDays === undefined) return undefined;

  const instants: number[] = [];
  let newest = Number.NEGATIVE_INFINITY;
  let newestDay = "";
  for (const { date } of games) {
    const instant = dayInstant(date);
    if (date === undefined || !Number.isFinite(instant)) continue;
    instants.push(instant);
    if (instant > newest) {
      newest = instant;
      newestDay = date;
    }
  }
  if (instants.length === 0) return null;

  let total = 0;
  for (const instant of instants) {
    const raw = decayed(newest, instant, halfLifeDays);
    total += raw > 0 ? raw : 0;
  }
  if (!(total > 0)) return null;
  return { halfLifeDays, newest: newestDay, mean: total / instants.length };
};

/**
 * One game's weight, rebuilt from its date and the basis its pool's weights were built from
 * (`recencyBasisFor`): exactly what `weightsForGames` gave it.
 *
 * 1 for a game with no date this pool can place, as `weightsForGames` keeps one, and for every game
 * when there is no basis, which is a pool fitted unweighted. A date after the basis's newest weighs
 * as the newest does rather than more: a fit never reads a game fresher than its newest, so a weight
 * above a fresh game's would be one no fit ever used.
 */
export const recencyWeightOf = (date: string | undefined, basis: RecencyBasis | null): number => {
  const at = dayInstant(date);
  if (!basis || !Number.isFinite(at)) return 1;
  const raw = decayed(dayInstant(basis.newest), at, basis.halfLifeDays);
  return raw > 0 ? raw / basis.mean : 0;
};
