import {
  AGE_GAP_RUNS_PER_YEAR,
  buildOpponentAdjustedRatings,
  type RatingGame,
} from "./powerRating";
import { parseDateValue } from "./date";
import {
  RATING_CAP,
  scoutRatingGames,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
} from "./teamRankings";
import { clamp } from "./util";
import { RECENCY_SCHEMES, type RecencyScheme } from "./ratingRecency";

/**
 * Does the rating model actually predict anything?
 *
 * The rankings are an opponent-adjusted least-squares fit, and a fit will always describe the
 * games it was fitted on — that is what fitting means, and it says nothing about whether the
 * ratings are worth reading. The only honest test is on games the fit has not seen: order the pool
 * by date, fit on the earlier part, predict the later part, and compare the predictions to what
 * happened.
 *
 * Two numbers matter. How far off the predicted run margin is, against the same number for a model
 * that knows nothing and calls every game even — if the ratings cannot beat "it'll be close", they
 * are not earning their place. And how often the side the ratings favour actually wins, which is
 * the question anybody reading a ranking is really asking.
 *
 * It also answers a question the rankings themselves cannot: what a year of age is worth. The
 * model starts from a coach's rule of thumb, two runs a year, and lets the data correct it. Fitting
 * the same pool from several different starting points and seeing which predicts best is how that
 * rule of thumb stops being an assumption.
 */

export type ScoutBacktestResult = {
  /** Games predicted — the held-out part of the pool, not the whole of it. */
  sampleSize: number;
  /**
   * Mean absolute error of the predicted run margin, in runs, against the actual margin capped the
   * same way the model caps it. Null when nothing could be held out.
   */
  meanAbsoluteError: number | null;
  /** The same error for a model that calls every game even. What the ratings have to beat. */
  baselineError: number | null;
  /** Share of decisive held-out games the favoured side won. Null when there were none. */
  winnerAccuracy: number | null;
  /** How many of the held-out games crossed an age level. */
  crossAgeSamples: number;
  /** The margin error on those games alone, which is where the age-gap term is doing the work. */
  crossAgeError: number | null;
  /** What the fit made a year of age worth, starting from the prior it was given. */
  fittedAgeGapRuns: number;
  /** The prior it started from, so a comparison of several can be read back. */
  ageGapPrior: number;
  /** Which weighting scheme produced it, so a sweep's winner has a name. */
  recencyKey: string;
  /**
   * The same numbers, split by how long after the cut each game was played.
   *
   * This is the answer the whole exercise is after. One error figure over the hold-out says how
   * good the ratings are; the figures by distance say how fast they *go off* — whether a fit is
   * still worth reading a month later, three months later, or after a winter. A half-life guessed
   * from a chair is a claim about this curve, and the curve can simply be measured.
   */
  buckets: ScoutBacktestBucket[];
};

/** Held-out games grouped by how long after the training cut they were played. */
export type ScoutBacktestBucket = {
  /** Lower bound in days, inclusive. */
  fromDays: number;
  /** Upper bound in days, exclusive; `Infinity` on the last one. */
  toDays: number;
  label: string;
  sampleSize: number;
  meanAbsoluteError: number | null;
  baselineError: number | null;
  winnerAccuracy: number | null;
};

/**
 * How far after the cut to group held-out games.
 *
 * The last boundary is past any plausible in-season gap on purpose: in youth baseball a hold-out
 * more than four months after the fit is usually on the other side of a winter, and that bucket is
 * the one that says what a fall season is worth in the spring.
 */
export const BUCKET_EDGES_DAYS = [0, 14, 42, 84, 120, Infinity];

const bucketLabel = (from: number, to: number): string => {
  if (to === Infinity) return `${from}+ days later`;
  return `${from}-${to} days later`;
};

export type ScoutBacktestOptions = {
  /** Where to cut the timeline. 0.7 means fit on the first seventy per cent of the games. */
  trainShare?: number;
  /** Runs per year of age the fit starts from; defaults to the model's own prior. */
  ageGapPrior?: number;
  /**
   * How much an old game counts. Absent means every game counts the same, which is the model as it
   * has always been and the control any comparison of schemes needs.
   */
  recency?: RecencyScheme;
  /**
   * Days to leave empty between the last game fitted on and the first game scored.
   *
   * The reason it exists is that a chronological hold-out flatters a recency-weighted model for
   * free. The games being predicted are always the newest in the pool, so leaning on recent games
   * moves the fit toward the target by construction rather than by knowing anything — and the
   * improvement that shows up is partly that. A gap makes the test games genuinely *later* rather
   * than merely last, which is the question a ranking is actually asked: not "what happened in the
   * games I just fitted on" but "what will happen next".
   */
  gapDays?: number;
};

const DEFAULT_TRAIN_SHARE = 0.7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Nothing to say, in the shape of a result. */
const emptyResult = (ageGapPrior: number, recencyKey: string): ScoutBacktestResult => ({
  sampleSize: 0,
  meanAbsoluteError: null,
  baselineError: null,
  winnerAccuracy: null,
  crossAgeSamples: 0,
  crossAgeError: null,
  fittedAgeGapRuns: ageGapPrior,
  ageGapPrior,
  recencyKey,
  buckets: [],
});

type DatedGame = { game: ScoutGame; ageGap: number; at: number };

/**
 * The rated games in the order they were played.
 *
 * A game with no date cannot be placed on a timeline, and a hold-out that included one would be
 * fitting on the future to predict the past. They are dropped rather than guessed at.
 */
const inTimeOrder = (rated: Array<{ game: ScoutGame; ageGap: number }>): DatedGame[] =>
  rated
    .flatMap(({ game, ageGap }) => {
      if (!game.date) return [];
      const at = parseDateValue(game.date);
      return Number.isFinite(at) ? [{ game, ageGap, at }] : [];
    })
    .sort((a, b) => a.at - b.at || a.game.id.localeCompare(b.game.id));

const asRatingGame = ({ game, ageGap }: DatedGame): RatingGame => ({
  home: game.teamAId,
  away: game.teamBId,
  homeMargin: game.teamAScore! - game.teamBScore!,
  // Team A is simply the side entered first, not the home team.
  neutral: true,
  ...(ageGap ? { ageGap } : {}),
});

/**
 * Fits on the earlier games and scores the later ones.
 *
 * `ageGroupId` names the page; the pool is that page's season year, exactly as the rankings pool
 * it, so what is measured is what is shown.
 */
export const backtestScoutRatings = (
  ageGroupId: string,
  teams: ScoutTeam[],
  games: ScoutGame[],
  ageGroups: AgeGroup[],
  options: ScoutBacktestOptions = {}
): ScoutBacktestResult => {
  const ageGapPrior = options.ageGapPrior ?? AGE_GAP_RUNS_PER_YEAR;
  const trainShare = clamp(options.trainShare ?? DEFAULT_TRAIN_SHARE, 0.1, 0.95);
  const recency = options.recency;
  const gapDays = Math.max(0, options.gapDays ?? 0);

  const ordered = inTimeOrder(scoutRatingGames(ageGroupId, teams, games, ageGroups));
  const cut = Math.floor(ordered.length * trainShare);
  const train = ordered.slice(0, cut);
  /*
   * The cut is a day, not a row. Everything on the last day fitted on would otherwise be split
   * between train and test, and a game scored against a fit that saw its own doubleheader partner
   * is not a prediction.
   */
  const cutAt = train.length === 0 ? 0 : train[train.length - 1]!.at;
  const scoreFrom = cutAt + gapDays * DAY_MS;
  const test = ordered.slice(cut).filter((entry) => entry.at > cutAt && entry.at >= scoreFrom);
  // A fit on nothing rates nobody, and a cut leaving nothing to score answers nothing.
  if (train.length === 0 || test.length === 0) {
    return emptyResult(ageGapPrior, recency?.key ?? "none");
  }

  const teamIds = [...new Set(ordered.flatMap(({ game }) => [game.teamAId, game.teamBId]))];
  /*
   * Weighed as of the cut, which is the day somebody reading these ratings would be standing on.
   * Weighing as of the newest game in the whole pool would let the fit know how long the hold-out
   * ran for, which is a small piece of the future.
   */
  const weights = recency
    ? recency.weigh(
        train.map(({ game, at }) => ({ at, home: game.teamAId, away: game.teamBId })),
        cutAt
      )
    : undefined;
  const fit = buildOpponentAdjustedRatings(
    teamIds,
    train.map((entry, at) => {
      const rating = asRatingGame(entry);
      return weights ? { ...rating, weight: weights[at] ?? 1 } : rating;
    }),
    { cap: RATING_CAP, ageGapPrior }
  );

  let errorSum = 0;
  let baselineSum = 0;
  let crossAgeErrorSum = 0;
  let crossAgeCount = 0;
  let decisive = 0;
  let calledRight = 0;

  /** One accumulator per bucket, filled as the hold-out is scored. */
  const buckets = BUCKET_EDGES_DAYS.slice(0, -1).map((fromDays, at) => ({
    fromDays,
    toDays: BUCKET_EDGES_DAYS[at + 1]!,
    errorSum: 0,
    baselineSum: 0,
    count: 0,
    decisive: 0,
    calledRight: 0,
  }));

  test.forEach((entry) => {
    const { game, ageGap } = entry;
    const actual = clamp(game.teamAScore! - game.teamBScore!, -RATING_CAP, RATING_CAP);
    const predicted =
      (fit.ratings.get(game.teamAId) ?? 0) -
      (fit.ratings.get(game.teamBId) ?? 0) +
      ageGap * fit.ageGapRuns;

    const error = Math.abs(predicted - actual);
    errorSum += error;
    // What a model that knows nothing about either side would say: it will be close.
    baselineSum += Math.abs(actual);
    if (ageGap !== 0) {
      crossAgeCount += 1;
      crossAgeErrorSum += error;
    }
    // A tie has no side to favour, and a prediction of exactly even picks nobody.
    const called = actual !== 0 && predicted !== 0;
    const right = called && Math.sign(predicted) === Math.sign(actual);
    if (called) {
      decisive += 1;
      if (right) calledRight += 1;
    }

    const daysAfter = (entry.at - cutAt) / DAY_MS;
    const bucket = buckets.find(
      (candidate) => daysAfter >= candidate.fromDays && daysAfter < candidate.toDays
    );
    if (bucket) {
      bucket.count += 1;
      bucket.errorSum += error;
      bucket.baselineSum += Math.abs(actual);
      if (called) {
        bucket.decisive += 1;
        if (right) bucket.calledRight += 1;
      }
    }
  });

  return {
    sampleSize: test.length,
    meanAbsoluteError: errorSum / test.length,
    baselineError: baselineSum / test.length,
    winnerAccuracy: decisive === 0 ? null : calledRight / decisive,
    crossAgeSamples: crossAgeCount,
    crossAgeError: crossAgeCount === 0 ? null : crossAgeErrorSum / crossAgeCount,
    fittedAgeGapRuns: fit.ageGapRuns,
    ageGapPrior,
    recencyKey: recency?.key ?? "none",
    buckets: buckets
      .filter((bucket) => bucket.count > 0)
      .map((bucket) => ({
        fromDays: bucket.fromDays,
        toDays: bucket.toDays,
        label: bucketLabel(bucket.fromDays, bucket.toDays),
        sampleSize: bucket.count,
        meanAbsoluteError: bucket.errorSum / bucket.count,
        baselineError: bucket.baselineSum / bucket.count,
        winnerAccuracy: bucket.decisive === 0 ? null : bucket.calledRight / bucket.decisive,
      })),
  };
};

/** The priors worth trying when asking what a year of age is actually worth in a pool. */
export const AGE_GAP_PRIORS_TO_TRY = [0, 1, 2, 3, 4];

/**
 * The same backtest from several starting points, so the rule of thumb can be checked rather than
 * assumed. Best first — the one whose held-out margin error is lowest.
 *
 * With no cross-age games in the pool every prior gives the identical answer, which is correct and
 * worth reading as it stands: this pool has nothing to say about what a year of age is worth.
 */
export const compareAgeGapPriors = (
  ageGroupId: string,
  teams: ScoutTeam[],
  games: ScoutGame[],
  ageGroups: AgeGroup[],
  priors: number[] = AGE_GAP_PRIORS_TO_TRY,
  options: Omit<ScoutBacktestOptions, "ageGapPrior"> = {}
): ScoutBacktestResult[] =>
  priors
    .map((ageGapPrior) =>
      backtestScoutRatings(ageGroupId, teams, games, ageGroups, { ...options, ageGapPrior })
    )
    .sort((a, b) => (a.meanAbsoluteError ?? Infinity) - (b.meanAbsoluteError ?? Infinity));

/**
 * The same backtest under every weighting scheme, best first.
 *
 * The question it answers is not "does recency help" in the abstract but "does it help *here*" —
 * on this pool, against games the fit never saw, with a gap so a recency-weighted model cannot win
 * by sitting closer to the target. The control is in the list, so "no decay wins" is a result
 * rather than an absence of one, and it is the result to expect on a pool too short to have an
 * old end.
 *
 * Read the buckets as well as the headline. A scheme can lose overall and still be the right one:
 * if it is behind over a fortnight and well ahead across a winter, what it knows is exactly the
 * thing a ranking read in March needs.
 */
export const compareRecencySchemes = (
  ageGroupId: string,
  teams: ScoutTeam[],
  games: ScoutGame[],
  ageGroups: AgeGroup[],
  schemes: RecencyScheme[] = RECENCY_SCHEMES,
  options: Omit<ScoutBacktestOptions, "recency"> = {}
): ScoutBacktestResult[] =>
  schemes
    .map((recency) =>
      backtestScoutRatings(ageGroupId, teams, games, ageGroups, { ...options, recency })
    )
    .sort((a, b) => (a.meanAbsoluteError ?? Infinity) - (b.meanAbsoluteError ?? Infinity));

/**
 * How fast the ratings go off, as one line per bucket.
 *
 * Every scheme's buckets share a cut, so the columns line up and the curve can be read down the
 * page: a model still worth reading three months on has a flat column, and one that is only good
 * for a fortnight falls off a cliff in the third row.
 */
export const describeDecayCurve = (result: ScoutBacktestResult): string[] =>
  result.buckets.map((bucket) => {
    const error = bucket.meanAbsoluteError;
    const baseline = bucket.baselineError;
    const lift =
      error === null || baseline === null || baseline === 0
        ? "—"
        : `${(((baseline - error) / baseline) * 100).toFixed(1)}% better than even`;
    const accuracy =
      bucket.winnerAccuracy === null ? "—" : `${(bucket.winnerAccuracy * 100).toFixed(1)}% called`;
    return `${bucket.label}: ${bucket.sampleSize} games, ${error?.toFixed(2) ?? "—"} runs off, ${lift}, ${accuracy}`;
  });

/** Whether the ratings beat calling every game even — the least a rating has to do to be worth one. */
export const beatsTheBaseline = (result: ScoutBacktestResult): boolean | null =>
  result.meanAbsoluteError === null || result.baselineError === null
    ? null
    : result.meanAbsoluteError < result.baselineError;
