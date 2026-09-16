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
};

export type ScoutBacktestOptions = {
  /** Where to cut the timeline. 0.7 means fit on the first seventy per cent of the games. */
  trainShare?: number;
  /** Runs per year of age the fit starts from; defaults to the model's own prior. */
  ageGapPrior?: number;
};

const DEFAULT_TRAIN_SHARE = 0.7;

/** Nothing to say, in the shape of a result. */
const emptyResult = (ageGapPrior: number): ScoutBacktestResult => ({
  sampleSize: 0,
  meanAbsoluteError: null,
  baselineError: null,
  winnerAccuracy: null,
  crossAgeSamples: 0,
  crossAgeError: null,
  fittedAgeGapRuns: ageGapPrior,
  ageGapPrior,
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

  const ordered = inTimeOrder(scoutRatingGames(ageGroupId, teams, games, ageGroups));
  const cut = Math.floor(ordered.length * trainShare);
  const train = ordered.slice(0, cut);
  const test = ordered.slice(cut);
  // A fit on nothing rates nobody, and a cut leaving nothing to score answers nothing.
  if (train.length === 0 || test.length === 0) return emptyResult(ageGapPrior);

  const teamIds = [...new Set(ordered.flatMap(({ game }) => [game.teamAId, game.teamBId]))];
  const fit = buildOpponentAdjustedRatings(teamIds, train.map(asRatingGame), {
    cap: RATING_CAP,
    ageGapPrior,
  });

  let errorSum = 0;
  let baselineSum = 0;
  let crossAgeErrorSum = 0;
  let crossAgeCount = 0;
  let decisive = 0;
  let calledRight = 0;

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
    if (actual !== 0 && predicted !== 0) {
      decisive += 1;
      if (Math.sign(predicted) === Math.sign(actual)) calledRight += 1;
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

/** Whether the ratings beat calling every game even — the least a rating has to do to be worth one. */
export const beatsTheBaseline = (result: ScoutBacktestResult): boolean | null =>
  result.meanAbsoluteError === null || result.baselineError === null
    ? null
    : result.meanAbsoluteError < result.baselineError;
