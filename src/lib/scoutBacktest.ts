import {
  AGE_GAP_RUNS_PER_YEAR,
  buildOpponentAdjustedRatings,
  type RatingGame,
} from "./powerRating";
import {
  RATING_CAP,
  EVERY_DAY,
  scoutRatingGames,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
} from "./teamRankings";
import { clamp } from "./util";
import { dayInstant, RECENCY_SCHEMES, type RecencyScheme } from "./ratingRecency";

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
  /** The per-game run-differential cap the fit ran under, for the same reason. */
  cap: number;
  /**
   * The same numbers, split by how long after the cut each game was played.
   *
   * This is the answer the whole exercise is after. One error figure over the hold-out says how
   * good the ratings are; the figures by distance say how fast they *go off* — whether a fit is
   * still worth reading a month later, three months later, or after a winter. A half-life guessed
   * from a chair is a claim about this curve, and the curve can simply be measured.
   */
  buckets: ScoutBacktestBucket[];
  /**
   * The real calendar days the fit ran over, and the ones it was scored on.
   *
   * Reported because the whole method rests on `trainTo` coming before `testFrom`, and for a long
   * time it did not: a squad year crosses New Year, and the app's other date parser drops the year,
   * so the spring sorted ahead of the autumn it followed. Nothing in the numbers showed it. Four
   * dates do.
   */
  span: ScoutBacktestSpan | null;
  /** Games fitted on. Printed beside `sampleSize` so a cut that kept almost nothing is visible. */
  trainSize: number;
  /**
   * Held-out games with a side the fit never saw.
   *
   * Such a game is scored against a rating of zero — which is exactly what the even-game baseline
   * predicts — so it contributes the same amount to the error and to the baseline, and cancels out
   * of the lift. A hold-out full of them drags every scheme toward the same number and reads as
   * "nothing separates them" when the truth is that nothing was asked.
   */
  unratedSides: number;
  /**
   * Mean size of the predicted margins, in runs. The tell for a scheme that won by shrinking.
   *
   * The ridge is a constant, and weighting only fixes the pool's *mean* weight — a team whose games
   * are all old still ends up with little weight of its own, and its rating is pulled toward zero.
   * A rating of zero predicts an even game, which is the baseline. So heavy decay slides the model
   * toward the baseline, and on a page where the ratings are not beating the baseline anyway that
   * slide *lowers* the error with no recency content in it at all. If the winner's predictions are
   * markedly smaller than the control's, it did not learn anything — it just stopped guessing.
   */
  meanAbsolutePrediction: number | null;
  /**
   * How many separate pieces the training games fall into, counting only teams the fit saw.
   *
   * An opponent-adjusted fit can only place teams that are joined by a chain of games. Every row
   * is +1 on one side and -1 on the other, so each row sums to zero across the teams and the ridge
   * is the same constant everywhere — which forces the ratings of each connected piece to sum to
   * exactly zero, on its own, independently of every other piece. Two pieces are therefore two
   * separate scales that both happen to be centred on zero, and the difference between a team in
   * one and a team in the other is not a quantity this model estimated. It will still print one.
   *
   * It matters most on exactly the season this was built to study: if the fall clubs and the
   * spring clubs barely overlap, a real fall-to-spring shift in the standard of play is not
   * measured and shrunk toward zero, it is *defined* as zero — and no way of weighting games
   * inside a piece can change a sum that is pinned. A sweep that does not look would report "old
   * games are worth nothing" and mean "I could not have seen it either way".
   */
  trainComponents: number;
  /** Teams in the biggest of those pieces. Near the total means the fit is on one scale. */
  largestComponent: number;
  /** Held-out games whose two sides were both rated, but from different pieces. */
  splitSamples: number;
  /**
   * The held-out games one by one, when the caller asks for them.
   *
   * Aggregates cannot answer the question a sweep is really asking. Two schemes differing by three
   * hundredths of a run over twenty-five games is not a result, it is a rounding error with a
   * ranking attached, and nothing in a mean says which of the two it is. Scored game by game, the
   * same hold-out can be compared *paired* — every scheme faces the identical games — and a sign
   * test or a bootstrap over those pairs says whether the gap is real. Off by default: the Model
   * Check card wants one number, not a few hundred rows.
   */
  residuals: ScoutResidual[];
};

/** One held-out game as it was actually scored. The raw material for a paired comparison. */
export type ScoutResidual = {
  gameId: string;
  /** Days after the cut, so a curve can be cut at boundaries other than the built-in ones. */
  daysAfter: number;
  predicted: number;
  actual: number;
  /** How far off the rating was. */
  error: number;
  /** How far off "it'll be close" was, on the same game. */
  baseline: number;
  /** Both sides were rated, and from the same connected piece — so the margin is a real estimate. */
  connected: boolean;
};

/** The first and last day fitted on, and the first and last day scored. All "YYYY-MM-DD". */
export type ScoutBacktestSpan = {
  trainFrom: string;
  trainTo: string;
  testFrom: string;
  testTo: string;
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
  /** Keep every held-out game's own numbers. Off by default; a sweep needs them, a card does not. */
  keepResiduals?: boolean;
  /**
   * Cut on this day ("YYYY-MM-DD") instead of at a share of the rows. Takes precedence.
   *
   * A share of the rows puts the cut wherever the games happen to be densest, and where it lands
   * decides which question gets asked: a cut in mid-spring leaves nothing held out further than a
   * few weeks, so the far bucket — what a fall season is worth in the spring — is empty and the one
   * thing worth knowing goes unasked. A cut on the last day before the winter asks exactly that and
   * nothing else. Neither is the right answer on its own; a sweep should run both and only believe
   * a scheme that wins at either.
   */
  cutOn?: string;
  /**
   * The most run-differential one game may contribute to the fit. Defaults to `RATING_CAP`.
   *
   * The reason this is a knob at all is that `RATING_CAP` is the least justified number in the
   * model: the case for having a cap is sound — without one a 20-0 against a weak club outweighs
   * a season of close wins against strong ones — but the case for *eight* was never made. It is
   * inherited from the League Standings machine-pitch default, where it comes from a real rule
   * (coach and machine pitch carry a per-inning run limit), and then applied flat across 8U to
   * 18U even though the same settings put player pitch at twelve.
   *
   * `Infinity` is a legal value and means no cap at all: the fit is handed the margin as played.
   * `clamp` takes it without special-casing, and it is the only honest way to ask whether having
   * a cap is earning anything, as against which cap is best.
   */
  cap?: number;
  /**
   * What the held-out margin is clamped to before the error is taken. Defaults to `RATING_CAP`.
   *
   * Separate from `cap` on purpose, and the separation is the whole reason a cap sweep can be
   * believed. `RATING_CAP` used to do both jobs, so moving it moved the target as well as the
   * model — and a smaller target is a smaller error for nothing. Measured on four thousand
   * realistic margins against a model that does not change at all (it predicts zero every time),
   * letting the target follow the cap gives 2.25 runs at a cap of four rising to 2.95 uncapped,
   * a clean monotone ordering that is entirely an artefact. Pinned, the same model scores 2.605
   * at every cap, as it must.
   *
   * So a sweep varies `cap` and holds `scoreCap` still. *Where* it is pinned is a second choice,
   * and a sweep that reaches past `RATING_CAP` cannot make it freely: pinning the target tighter
   * than the widest candidate penalises that candidate for swinging where the target has been
   * clipped flat. Measured on three sixteen-team pools, two rounds each, held out the same way —
   * error at a target pinned to eight against the same fit scored on the margin as played:
   *
   * | truth                         | cap 8 → pinned / played | no cap → pinned / played |
   * | ----------------------------- | ----------------------- | ------------------------ |
   * | inside eight, no blowouts     | 0.894 / 0.894           | 0.892 / 0.892            |
   * | inside eight, 10% junk blowouts | 1.930 / 2.527         | 2.245 / 2.843            |
   * | genuinely spans past eight    | 2.517 / 5.231           | 2.760 / **1.091**        |
   *
   * The pin changes no ordering on the first two — the same cap wins either way — and inverts the
   * third: pinned, no cap reads worse than twelve; on the margin as played it beats everything by
   * a factor of two. So `compareRunCaps` grades on the margin as played. That is still one target
   * for every candidate, which is the property that matters, and it is the least arbitrary one
   * available: the margin is a fact and eight is a choice. It does read higher in absolute terms,
   * because a 21-run game now contributes every run of its unpredictability to every row.
   */
  scoreCap?: number;
};

const DEFAULT_TRAIN_SHARE = 0.7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Nothing to say, in the shape of a result. */
const emptyResult = (
  ageGapPrior: number,
  recencyKey: string,
  cap: number
): ScoutBacktestResult => ({
  sampleSize: 0,
  meanAbsoluteError: null,
  baselineError: null,
  winnerAccuracy: null,
  crossAgeSamples: 0,
  crossAgeError: null,
  fittedAgeGapRuns: ageGapPrior,
  ageGapPrior,
  cap,
  recencyKey,
  buckets: [],
  span: null,
  trainSize: 0,
  unratedSides: 0,
  meanAbsolutePrediction: null,
  trainComponents: 0,
  largestComponent: 0,
  splitSamples: 0,
  residuals: [],
});

type DatedGame = { game: ScoutGame; ageGap: number; at: number };

/**
 * The rated games in the order they were played.
 *
 * A game with no date cannot be placed on a timeline, and a hold-out that included one would be
 * fitting on the future to predict the past. They are dropped rather than guessed at.
 */
/*
 * `dayInstant` lives in `ratingRecency.ts`, beside the schemes that depend on reading a date the
 * same way. A hold-out cut on a different ordering than the one the weights use would fit on March
 * and score the September before it — trained on the future, scored on the past — so the sweep and
 * the app it advises must place a game on exactly the same day. One implementation is how that
 * stays true.
 *
 * Here, a game whose date cannot be placed is dropped rather than guessed at, the same treatment a
 * game with no date at all gets; `weightsForGames` keeps one instead, because a ranking has to
 * show every game it holds.
 */

/** The day back out of an instant, for reporting the span the run actually covered. */
const dayOfInstant = (at: number): string => new Date(at).toISOString().slice(0, 10);

const inTimeOrder = (rated: Array<{ game: ScoutGame; ageGap: number }>): DatedGame[] =>
  rated
    .flatMap(({ game, ageGap }) => {
      const at = dayInstant(game.date);
      return Number.isFinite(at) ? [{ game, ageGap, at }] : [];
    })
    .sort((a, b) => a.at - b.at || a.game.id.localeCompare(b.game.id));

/**
 * Which teams the training games join up, as a map from team to the piece it belongs to.
 *
 * Plain union-find. A rating is only ever a comparison, so two teams with no chain of games
 * between them have not been compared — and because every piece is pinned to average zero on its
 * own, the model will nonetheless hand back a difference for them, with no more behind it than the
 * arithmetic that pinned them.
 */
const componentsOf = (train: DatedGame[]): Map<string, string> => {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = parent.get(id) ?? id;
    if (root === id) {
      parent.set(id, id);
      return id;
    }
    root = find(root);
    parent.set(id, root);
    return root;
  };
  train.forEach(({ game }) => {
    const a = find(game.teamAId);
    const b = find(game.teamBId);
    if (a !== b) parent.set(a, b);
  });
  const roots = new Map<string, string>();
  parent.forEach((_, id) => roots.set(id, find(id)));
  return roots;
};

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
  const cap = options.cap ?? RATING_CAP;
  const scoreCap = options.scoreCap ?? RATING_CAP;
  const trainShare = clamp(options.trainShare ?? DEFAULT_TRAIN_SHARE, 0.1, 0.95);
  const recency = options.recency;
  const gapDays = Math.max(0, options.gapDays ?? 0);

  const ordered = inTimeOrder(
    scoutRatingGames(ageGroupId, teams, games, ageGroups, undefined, EVERY_DAY)
  );
  const cut = Math.floor(ordered.length * trainShare);
  /*
   * The cut is a day, not a row. A row index picks the day; the day then takes all of its own
   * games. Everything on the last day fitted on would otherwise be split between train and test,
   * and a game scored against a fit that saw its own doubleheader partner is not a prediction.
   *
   * Taken as a filter over the whole pool rather than as a slice, because a slice loses games. The
   * row index lands mid-Saturday about as often as not, and the rest of that Saturday is past the
   * index yet not after the cut *day* — so it was dropped from the training slice and then dropped
   * again from the test half by `at > cutAt`, and fell out of the run entirely. Nothing said so:
   * only the test set is counted, so eight silently vanished games looked exactly like a clean run.
   */
  const askedFor = options.cutOn === undefined ? Number.NaN : dayInstant(options.cutOn);
  const cutAt = Number.isFinite(askedFor)
    ? askedFor
    : cut === 0
      ? 0
      : ordered[Math.min(cut, ordered.length) - 1]!.at;
  const train = ordered.filter((entry) => entry.at <= cutAt);
  const scoreFrom = cutAt + gapDays * DAY_MS;
  const test = ordered.filter((entry) => entry.at > cutAt && entry.at >= scoreFrom);
  // A fit on nothing rates nobody, and a cut leaving nothing to score answers nothing.
  if (train.length === 0 || test.length === 0) {
    return emptyResult(ageGapPrior, recency?.key ?? "none", cap);
  }

  /*
   * Only the teams the fit actually saw. Handing it the hold-out's teams as well gave each of them
   * a row no game touched, which the solver leaves at exactly zero — so a debutant was not
   * "unrated", it was confidently rated dead average, and a game between two of them was predicted
   * even. That is the baseline's own answer, so the row added nothing to the lift while still
   * counting in the mean, quietly pulling every scheme toward the same score. Left out here, and
   * counted below, so a hold-out made largely of newcomers says so out loud.
   */
  const teamIds = [...new Set(train.flatMap(({ game }) => [game.teamAId, game.teamBId]))];
  const rated = new Set(teamIds);
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
    { cap, ageGapPrior }
  );

  let errorSum = 0;
  let baselineSum = 0;
  let crossAgeErrorSum = 0;
  let crossAgeCount = 0;
  let decisive = 0;
  let calledRight = 0;
  let unratedSides = 0;
  let splitSamples = 0;
  let predictionSum = 0;
  const component = componentsOf(train);
  const componentSizes = new Map<string, number>();
  component.forEach((root) => componentSizes.set(root, (componentSizes.get(root) ?? 0) + 1));
  const residuals: ScoutResidual[] = [];

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
    const actual = clamp(game.teamAScore! - game.teamBScore!, -scoreCap, scoreCap);
    const predicted =
      (fit.ratings.get(game.teamAId) ?? 0) -
      (fit.ratings.get(game.teamBId) ?? 0) +
      ageGap * fit.ageGapRuns;

    const seenBoth = rated.has(game.teamAId) && rated.has(game.teamBId);
    const connected = seenBoth && component.get(game.teamAId) === component.get(game.teamBId);
    if (!seenBoth) unratedSides += 1;
    else if (!connected) splitSamples += 1;
    predictionSum += Math.abs(predicted);
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
    if (options.keepResiduals) {
      residuals.push({
        gameId: game.id,
        daysAfter,
        predicted,
        actual,
        error,
        baseline: Math.abs(actual),
        connected,
      });
    }
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
    cap,
    trainSize: train.length,
    unratedSides,
    splitSamples,
    trainComponents: componentSizes.size,
    largestComponent: Math.max(0, ...componentSizes.values()),
    residuals,
    meanAbsolutePrediction: predictionSum / test.length,
    span: {
      trainFrom: dayOfInstant(train[0]!.at),
      trainTo: dayOfInstant(cutAt),
      testFrom: dayOfInstant(test[0]!.at),
      testTo: dayOfInstant(test[test.length - 1]!.at),
    },
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
 * The caps worth trying, and no cap at all.
 *
 * Four to twelve brackets both numbers this app already uses: eight is what the rating clamps at
 * and what League Standings puts machine and coach pitch at, twelve is what the same settings put
 * player pitch at. `Infinity` closes the open end, and it is not decoration — it is the only row
 * that asks whether having a cap is earning anything, as against which cap is best. Measured on a
 * pool whose margins all fit inside eight it ties every cap from eight up, exactly as it must,
 * since a clamp that never bites does nothing.
 */
export const RUN_CAPS_TO_TRY = [4, 6, 8, 10, 12, Infinity];

/**
 * The same backtest under several run-differential caps, best first.
 *
 * `RATING_CAP` is the least justified number in the model. The case for having a cap is sound —
 * without one a 20-0 against a weak club outweighs a season of close wins against strong ones —
 * but the case for *eight* was never made: it is inherited from the League Standings machine-pitch
 * default, where it comes from a real rule, and then applied flat from 8U to 18U even though the
 * same settings put player pitch at twelve. This is the measurement that was missing.
 *
 * The scoring target is pinned while the fit's cap moves, and that is not a detail. Sharing one
 * constant between the two made a smaller cap a smaller error for nothing: a model that predicts
 * zero every time, which cannot improve, scores 2.25 runs at a cap of four and 2.95 uncapped on
 * four thousand realistic margins — a clean ordering that is pure artefact. Pinned, that same
 * model scores 2.605 at every cap.
 *
 * It is pinned at the margin as played rather than at `RATING_CAP`, which matters once the sweep
 * reaches past eight: a target clipped at eight penalises a wider candidate for swinging where
 * the target is flat, and on a pool whose margins genuinely run past eight that inverts the
 * answer — no cap reads worse than twelve pinned at eight (2.760 against 1.939) and beats
 * everything on the margin as played (1.091). See `scoreCap` for the three pools. The absolute
 * numbers read higher this way, because a 21-run game hands every row all of its unpredictability.
 *
 * Read the called-right column beside the error. It compares directions, which nothing clamps, so
 * a cap that calls more games right has earned it whatever the error column says — though it is
 * the quieter signal of the two, since direction is easy wherever the sides are far apart.
 */
export const compareRunCaps = (
  ageGroupId: string,
  teams: ScoutTeam[],
  games: ScoutGame[],
  ageGroups: AgeGroup[],
  caps: number[] = RUN_CAPS_TO_TRY,
  options: Omit<ScoutBacktestOptions, "cap" | "scoreCap"> = {}
): ScoutBacktestResult[] =>
  caps
    .map((cap) =>
      backtestScoutRatings(ageGroupId, teams, games, ageGroups, {
        ...options,
        cap,
        // The one target every candidate is graded against: the margin as played. That it is the
        // same for all of them is what makes the column comparable; that it is the real margin is
        // what keeps an uncapped candidate from being marked down for predicting past a clip.
        scoreCap: Infinity,
      })
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
