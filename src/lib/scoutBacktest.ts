import {
  AGE_GAP_RUNS_PER_YEAR,
  buildOpponentAdjustedRatings,
  type RatingGame,
} from "./powerRating";
import {
  RATING_CAP,
  EVERY_DAY,
  discountAbout,
  discountMiddle,
  fitScoutYear,
  ratedMargin,
  scoutFitRanks,
  scoutFitYear,
  scoutRatingGames,
  yearFitGames,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
} from "./teamRankings";
import { clamp } from "./util";
import { todayIsoDay } from "./date";
import { dayInstant, RECENCY_SCHEMES, type RecencyScheme } from "./ratingRecency";
import { CLOSED_START_RUNS, startingShare } from "./scheduleCommunities";

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
 * model holds each level's year at what it measured nationally (`AGE_STEP_RUNS`), because a fit
 * reads it low. Holding the same pool at the table scaled up and down and seeing which predicts
 * best is how that table is checked against the pool in hand rather than assumed.
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
   * The margin error on the held-out games whose two sides the fit saw, and how many there were.
   *
   * What a held age gap is judged on (`compareAgeGaps`). A game with a side the fit never saw is
   * predicted by the gap alone, and a real game between a 9U and a 10U is closer than a year of age
   * says, because the young clubs that play up are mostly strong ones: scored on those, a lower gap
   * always looked better, and the app never shows such a prediction anyway ("not rated here yet").
   */
  ratedError: number | null;
  ratedSamples: number;
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
  /**
   * Every held-out game's error, in hold-out order, when the caller asks (`keepErrors`), and which
   * of them were between two sides the fit saw. Every run over one cut holds out the same games in
   * the same order, so two runs' arrays line up game by game: what `pairedImprovement` compares.
   */
  errors?: Float32Array;
  ratedFlags?: Uint8Array;
  /**
   * The two sides of every held-out game, by an index of the run's own, in the same order: which
   * games share a club, which is what makes their errors move together (`pairedImprovement`).
   */
  sides?: Uint32Array;
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
   * Keep every held-out game's error as a compact array (`ScoutBacktestResult.errors`): what the
   * model check compares two settings on. Far lighter than `keepResiduals`, so it can cross from
   * the rankings worker for every run of the check.
   */
  keepErrors?: boolean;
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
   * The reason this is a knob at all is that `RATING_CAP` was for a long time the least justified
   * number in the model: the case for having a cap is sound — without one a 20-0 against a weak
   * club outweighs a season of close wins against strong ones — but the case for *eight*, which it
   * was, was never made. It was inherited from the League Standings machine-pitch default, where it
   * comes from a real rule (coach and machine pitch carry a per-inning run limit), and applied flat
   * across 8U to 18U even though the same settings put player pitch at twelve. This sweep is what
   * moved it to twelve (`pairedImprovement` has the numbers), and it keeps asking.
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
   * available: the margin is a fact and the cap is a choice. It does read higher in absolute terms,
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
  ratedError: null,
  ratedSamples: 0,
  meanAbsolutePrediction: null,
  trainComponents: 0,
  largestComponent: 0,
  splitSamples: 0,
  residuals: [],
});

type DatedGame = { game: ScoutGame; ageGap: number; at: number };

/** A page's rated games in the order they were played, as every backtest here starts from. */
export type BacktestGames = readonly DatedGame[];

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

/** The rated games a backtest of this page reads, in the order they were played. */
export const backtestGames = (
  ageGroupId: string,
  teams: ScoutTeam[],
  games: ScoutGame[],
  ageGroups: AgeGroup[]
): BacktestGames =>
  inTimeOrder(scoutRatingGames(ageGroupId, teams, games, ageGroups, undefined, EVERY_DAY));

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
  homeMargin: ratedMargin(game)!,
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
  options: ScoutBacktestOptions = {},
  /**
   * `backtestGames` for this page, when the caller already holds it. The selection and the sort
   * are the same for every run of a sweep, about 0.6 s of each on a nationwide year, so a sweep
   * that works them out once and hands them to each run spends that once.
   */
  ordered: BacktestGames = backtestGames(ageGroupId, teams, games, ageGroups)
): ScoutBacktestResult => {
  const ageGapPrior = options.ageGapPrior ?? AGE_GAP_RUNS_PER_YEAR;
  const cap = options.cap ?? RATING_CAP;
  const scoreCap = options.scoreCap ?? RATING_CAP;
  const trainShare = clamp(options.trainShare ?? DEFAULT_TRAIN_SHARE, 0.1, 0.95);
  const recency = options.recency;
  const gapDays = Math.max(0, options.gapDays ?? 0);

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
  let ratedErrorSum = 0;
  let ratedSamples = 0;
  let splitSamples = 0;
  let predictionSum = 0;
  const component = componentsOf(train);
  const componentSizes = new Map<string, number>();
  component.forEach((root) => componentSizes.set(root, (componentSizes.get(root) ?? 0) + 1));
  const residuals: ScoutResidual[] = [];
  const errors = options.keepErrors ? new Float32Array(test.length) : undefined;
  const ratedFlags = options.keepErrors ? new Uint8Array(test.length) : undefined;
  const sides = options.keepErrors ? new Uint32Array(test.length * 2) : undefined;
  const sideIndex = new Map<string, number>();
  const sideOf = (teamId: string) => {
    const known = sideIndex.get(teamId);
    if (known !== undefined) return known;
    sideIndex.set(teamId, sideIndex.size);
    return sideIndex.size - 1;
  };

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

  test.forEach((entry, at) => {
    const { game, ageGap } = entry;
    const actual = clamp(ratedMargin(game)!, -scoreCap, scoreCap);
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
    if (seenBoth) {
      ratedErrorSum += error;
      ratedSamples += 1;
    }
    if (errors && ratedFlags && sides) {
      errors[at] = error;
      ratedFlags[at] = seenBoth ? 1 : 0;
      sides[at * 2] = sideOf(game.teamAId);
      sides[at * 2 + 1] = sideOf(game.teamBId);
    }
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
    ratedError: ratedSamples === 0 ? null : ratedErrorSum / ratedSamples,
    ratedSamples,
    ...(errors && ratedFlags && sides ? { errors, ratedFlags, sides } : {}),
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

/**
 * The values a year of age is held at to ask what it is worth in a pool, in runs of
 * `AGE_GAP_RUNS_PER_YEAR`: 2 is the age table as it stands (`AGE_STEP_RUNS`), and the others scale
 * the whole of it, from half to half as much again.
 */
export const AGE_GAPS_TO_TRY = [1, 1.5, 2, 2.5, 3];

/** Best first by the error on held-out games between two rated sides (`ratedError`). */
const bestRatedFirst = (a: ScoutBacktestResult, b: ScoutBacktestResult) =>
  (a.ratedError ?? Infinity) - (b.ratedError ?? Infinity);

/**
 * The same backtest with a year of age held at each of several values, so the age table is
 * checked rather than assumed. Best first — the one whose held-out margin error, on games between
 * two sides the fit saw, is lowest.
 *
 * Held rather than fitted from each as a starting point, as the ratings themselves hold it
 * (`DEFAULT_AGE_GAP_SHRINKAGE`): a fit reads a year low whatever it starts from. With no cross-age
 * games in the pool every value gives the identical answer, which is correct and worth reading as
 * it stands: this pool has nothing to say about what a year of age is worth.
 */
export const compareAgeGaps = (
  ageGroupId: string,
  teams: ScoutTeam[],
  games: ScoutGame[],
  ageGroups: AgeGroup[],
  gaps: number[] = AGE_GAPS_TO_TRY,
  options: Omit<ScoutBacktestOptions, "ageGapPrior"> = {}
): ScoutBacktestResult[] =>
  gaps
    .map((ageGapPrior) =>
      backtestScoutRatings(ageGroupId, teams, games, ageGroups, { ...options, ageGapPrior })
    )
    .sort(bestRatedFirst);

/**
 * The caps worth trying, and no cap at all.
 *
 * Four to sixteen brackets the cap the rating uses, twelve, from both sides, and takes in both
 * numbers League Standings uses: eight for machine and coach pitch, which is also what the rating
 * clamped at until the sweep moved it, and twelve for player pitch. Sixteen is there so the cap in
 * use has a finite neighbour above it as well as below. `Infinity` closes the open end, and it is
 * not decoration — it is the only row that asks whether having a cap is earning anything, as
 * against which cap is best. Measured on a pool whose margins all fit inside eight it ties every
 * cap from eight up, exactly as it must, since a clamp that never bites does nothing.
 */
export const RUN_CAPS_TO_TRY = [4, 6, 8, 10, 12, 16, Infinity];

/**
 * The same backtest under several run-differential caps, best first.
 *
 * `RATING_CAP` was for a long time the least justified number in the model. The case for having a
 * cap is sound — without one a 20-0 against a weak club outweighs a season of close wins against
 * strong ones — but the case for *eight*, which it was, was never made: it was inherited from the
 * League Standings machine-pitch default, where it comes from a real rule, and applied flat from
 * 8U to 18U even though the same settings put player pitch at twelve. This is the measurement that
 * was missing, and the one that moved it to twelve.
 *
 * The scoring target is pinned while the fit's cap moves, and that is not a detail. Sharing one
 * constant between the two made a smaller cap a smaller error for nothing: a model that predicts
 * zero every time, which cannot improve, scores 2.25 runs at a cap of four and 2.95 uncapped on
 * four thousand realistic margins — a clean ordering that is pure artefact. Pinned, that same
 * model scores 2.605 at every cap.
 *
 * It is pinned at the margin as played rather than at `RATING_CAP`, which matters once the sweep
 * reaches past the cap in use: a target clipped at the cap penalises a wider candidate for swinging
 * where the target is flat, and on a pool whose margins genuinely run past it that inverts the
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
 * How many weeks the starting level is re-measured over (`compareClosedLevels`), each a cut of its
 * own: four, the weeks the measurement of 17 October 2026 judged one on (measure5).
 */
export const CLOSED_LEVEL_WEEKS = 4;

/** One week of the re-measure: its days, its games, and the level it was scored with. */
export type ClosedLevelWeek = {
  /** Its first and last day, as ISO days: Monday to Sunday when the check runs on a Monday. */
  from: string;
  to: string;
  /** Its games between two clubs the fit of every game before it had rated. */
  games: number;
  /** The level read off the other weeks, which this week's games were scored with. */
  level: number | null;
};

/** What the re-measure of the starting level found (`compareClosedLevels`). */
export type ClosedLevelCheck = {
  /** The level the app holds, `CLOSED_START_RUNS`. */
  held: number;
  /**
   * The level the weeks' games read, all of them together, and its standard error: what a commit
   * would hold if the line says it is clearly better. Null where they could not say (no games, or
   * none between leagues the start reaches differently).
   */
  level: number | null;
  standardError: number | null;
  /** The weeks' games, and the groups the standard error reads them in (week and league). */
  games: number;
  clusters: number;
  weeks: ClosedLevelWeek[];
  /**
   * How much lower the shown ratings' error was, in runs a game, with each week scored by the
   * level the other weeks read than with the held one, paired game by game as the age gap is
   * (`pairedImprovement`, games that share a club read together). Null where no week was scored.
   */
  paired: PairedReading | null;
  /** Whether that clears the bar a setting is named better by (`isClearlyBetter`), one rival. */
  better: boolean;
};

/** A week's games as they are scored: what each side's shown rating is made of, and the result. */
export type ClosedLevelCut = {
  from: string;
  to: string;
  /** Each game's two sides: the held fit's point rating, its response, and its evidence. */
  pointA: Float64Array;
  pointB: Float64Array;
  responseA: Float64Array;
  responseB: Float64Array;
  evidenceA: Float64Array;
  evidenceB: Float64Array;
  /** The margin, capped as the fit caps it, and what the age gap between the two is worth. */
  margin: Float64Array;
  gapRuns: Float64Array;
  /** The game's error with the held level, as the board showed it. */
  heldError: Float32Array;
  /** The response's difference across the game, and its residual with no start at all. */
  x: Float64Array;
  y: Float64Array;
  /** The week and the league of the more isolated side, which the standard error groups by. */
  cluster: Float64Array;
  /** The two clubs, numbered across every week, so one club's games in four weeks read together. */
  sides: Uint32Array;
  /**
   * The residual scale's pieces over the games fitted on (`OpponentAdjustedRatings.residualScale`),
   * in the held fit's residual e and the response's difference r: their weight, Σ w e², Σ w e r and
   * Σ w r², so the scale at any level is read without walking the games again.
   */
  weight: number;
  ee: number;
  er: number;
  rr: number;
  /** The discount's centre at a residual scale of one run (`discountMiddle`): it scales with it. */
  unitMiddle: number;
};

/** The residual scale of a cut's fit with every start moved `by` runs of level from the held. */
const residualScaleAt = (cut: ClosedLevelCut, by: number): number =>
  cut.weight > 0
    ? Math.sqrt(Math.max(0, (cut.ee - 2 * by * cut.er + by * by * cut.rr) / cut.weight))
    : 0;

/** The shown rating's discount for a cut's fit with every start moved `by` runs of level. */
const discountAt = (cut: ClosedLevelCut, by: number) => {
  const scale = residualScaleAt(cut, by);
  return discountAbout(scale * cut.unitMiddle, scale);
};

/**
 * The level the games of `cuts` read, with its standard error: the no-start residual on the
 * response's difference, by least squares with no intercept, the error clustered by week and league
 * (CR1). What the measurement of 17 October 2026 fitted μ by (measure3a, measure5).
 */
const levelRead = (
  cuts: readonly ClosedLevelCut[]
): { level: number | null; standardError: number | null; games: number; clusters: number } => {
  let xx = 0;
  let xy = 0;
  let games = 0;
  for (const cut of cuts) {
    for (let at = 0; at < cut.x.length; at += 1) {
      xx += cut.x[at]! * cut.x[at]!;
      xy += cut.x[at]! * cut.y[at]!;
      games += 1;
    }
  }
  if (!(xx > 0)) return { level: null, standardError: null, games, clusters: 0 };
  const level = xy / xx;
  const scores = new Map<number, number>();
  for (const cut of cuts) {
    for (let at = 0; at < cut.x.length; at += 1) {
      const key = cut.cluster[at]!;
      const score = cut.x[at]! * (cut.y[at]! - level * cut.x[at]!);
      scores.set(key, (scores.get(key) ?? 0) + score);
    }
  }
  let meat = 0;
  scores.forEach((score) => (meat += score * score));
  const clusters = scores.size;
  const standardError =
    clusters > 1 ? Math.sqrt((meat * (clusters / (clusters - 1))) / (xx * xx)) : null;
  return { level, standardError, games, clusters };
};

const DAY = 24 * 60 * 60 * 1000;

/**
 * Re-measures where a rating starts (`scheduleCommunities.ts`): the level a club whose league
 * plays nobody outside itself starts at, held at `CLOSED_START_RUNS`, read again off the last four
 * weeks of the page's squad year, and judged against the held level by the rule the age gap and
 * the run cap are judged by. Null for a page too young to have a table.
 *
 * The weeks are the four before `today`, Monday to Sunday when it is a Monday. Each is a cut: the
 * year fitted as the board would have fitted it the morning the week began (`fitScoutYear`, every
 * rated game before it, the starts included), and the week's games, between two clubs that fit
 * rated, scored on the ratings it showed. The fit is linear in its starts, which enter only as the
 * ridge's virtual games, so one more solve per cut, every start at its share of a run
 * (`startingShare`) and every game a draw with no age gap, is the response of every point rating to
 * a run of level, and the fit at any level is the held fit plus that response times the distance.
 * Each is scored as the board shows it, its evidence discount read again at its own residual scale.
 *
 * The level is read off the four weeks together, as measure5 read it: −1.74 ± 0.16 runs on the
 * 79,981 games of 14 September to 11 October 2026 (10,590 week-and-league clusters), against the
 * −1.6 held. It is judged one week at a time, each scored with the level the other three read, and
 * never on the games it was read from: judged on those, the four bands' levels measured beside it
 * would have been named clearly better on the harness's weeks (z 2.46 against a bar of 2.28) when
 * scored apart they are not (z 1.03). And on shown ratings, not point ratings, which the plain
 * backtest scores: the discount already lowers thin clubs, a closed club is often a thin one, and
 * on point ratings a deeper level reads better than it does on the board. By this rule's absolute
 * error with each week left out it read z 1.72 there against −0.77 on shown ratings, short of the
 * bar, and it falsely cleared the bar in sample (z 3.59), on the last two weeks judged with the
 * first two weeks' level (2.27), and by squared error even with each week left out (2.63). On
 * those four weeks it read 0.00010 ± 0.00013 runs a game worse than −1.6, so the held level stands.
 *
 * A level clearly better here is a change ready to be made, not one made: the held level changes by
 * a commit that raises the boards' rules (`BOARD_RULES`), as the age table does.
 */
export const compareClosedLevels = (
  ageGroupId: string,
  teams: ScoutTeam[],
  games: ScoutGame[],
  ageGroups: AgeGroup[],
  today: string = todayIsoDay()
): ClosedLevelCheck | null => {
  const cuts = closedLevelCuts(ageGroupId, teams, games, ageGroups, today);
  return cuts && judgeClosedLevels(cuts);
};

/**
 * The weeks `compareClosedLevels` scores, each fitted and solved once: the costly half of it, about
 * 20 s and 1 GB above the pool on the owner's backup of 11 October 2026 (four fits of 59,427 to
 * 93,430 clubs, Node 24 on four 2.1 GHz cores). Null for a page too young to have a table, or a
 * `today` that is not an ISO day.
 */
export const closedLevelCuts = (
  ageGroupId: string,
  teams: ScoutTeam[],
  games: ScoutGame[],
  ageGroups: AgeGroup[],
  today: string
): ClosedLevelCut[] | null => {
  if (!scoutFitRanks(ageGroupId, ageGroups)) return null;
  const end = dayInstant(today);
  if (!Number.isFinite(end)) return null;
  const year = scoutFitYear(ageGroupId, ageGroups);
  const held = CLOSED_START_RUNS;
  // Rated as the board rates them on `today`; a game whose day cannot be read is in no week and in
  // no fit, as the plain backtest drops one rather than guess which side of a cut it is on.
  const rated = scoutRatingGames(ageGroupId, teams, games, ageGroups, undefined, today);
  const playedAt = Float64Array.from(rated, ({ game }) => dayInstant(game.date));
  const clubIndex = new Map<string, number>();
  const clubOf = (id: string): number => {
    const known = clubIndex.get(id);
    if (known !== undefined) return known;
    clubIndex.set(id, clubIndex.size);
    return clubIndex.size - 1;
  };

  const cuts: ClosedLevelCut[] = [];
  for (let week = 0; week < CLOSED_LEVEL_WEEKS; week += 1) {
    const cutAt = end - (CLOSED_LEVEL_WEEKS - week) * 7 * DAY;
    const nextAt = cutAt + 7 * DAY;
    const train = rated.filter((_, at) => playedAt[at]! < cutAt);
    const scored = rated.filter((_, at) => playedAt[at]! >= cutAt && playedAt[at]! < nextAt);

    const fit = fitScoutYear(year, teams, games, train, ageGroups);
    const ids = fit.nodes.map((team) => team.id);
    const index = new Map(ids.map((id, at) => [id, at]));
    const rows = yearFitGames(train);
    // Every start at its share of one run of level, and every game a draw with no age gap: what is
    // left of the normal equations' right-hand side is the starts alone.
    const unit = new Map<string, number>();
    fit.communities.of.forEach((community, id) =>
      unit.set(id, startingShare(fit.communities.outside[community] ?? 0))
    );
    const responded = buildOpponentAdjustedRatings(
      ids,
      rows.map(({ ageGap: _gap, ...row }) => ({ ...row, homeMargin: 0 })),
      { cap: RATING_CAP, priorCentre: unit }
    ).ratings;
    const point = Float64Array.from(ids, (id) => fit.adjusted.ratings.get(id) ?? 0);
    const response = Float64Array.from(ids, (id) => responded.get(id) ?? 0);
    const evidence = Float64Array.from(ids, (id) => fit.effective.get(id) ?? 0);
    const { ageGapRuns, homeAdvantage } = fit.adjusted;

    // The residual scale's pieces, over the rows the fit read, as the fit reads its own.
    let weight = 0;
    let ee = 0;
    let er = 0;
    let rr = 0;
    for (const row of rows) {
      const own = row.weight ?? 1;
      if (!(own > 0)) continue;
      const home = index.get(row.home)!;
      const away = index.get(row.away)!;
      const predicted =
        point[home]! -
        point[away]! +
        (row.neutral ? 0 : homeAdvantage) +
        (row.ageGap ?? 0) * ageGapRuns;
      const e = clamp(row.homeMargin, -RATING_CAP, RATING_CAP) - predicted;
      const r = response[home]! - response[away]!;
      weight += own;
      ee += own * e * e;
      er += own * e * r;
      rr += own * r * r;
    }
    // Over the year's clubs, as the fit centres its own discount (`fitScoutYear`).
    const unitMiddle = discountMiddle(
      { games: fit.effective, residualScale: 1 },
      fit.nodes.filter((team) => !team.placeholder && !team.nameOnly).map((team) => team.id)
    );

    const kept = scored.filter(({ game }) => index.has(game.teamAId) && index.has(game.teamBId));
    const size = kept.length;
    const cut: ClosedLevelCut = {
      from: new Date(cutAt).toISOString().slice(0, 10),
      to: new Date(nextAt - DAY).toISOString().slice(0, 10),
      pointA: new Float64Array(size),
      pointB: new Float64Array(size),
      responseA: new Float64Array(size),
      responseB: new Float64Array(size),
      evidenceA: new Float64Array(size),
      evidenceB: new Float64Array(size),
      margin: new Float64Array(size),
      gapRuns: new Float64Array(size),
      heldError: new Float32Array(size),
      x: new Float64Array(size),
      y: new Float64Array(size),
      cluster: new Float64Array(size),
      sides: new Uint32Array(size * 2),
      weight,
      ee,
      er,
      rr,
      unitMiddle,
    };
    // With no start at all: the held fit less the held level's worth of response.
    const unstarted = discountAt(cut, -held);
    const communityOf = (at: number) => fit.communities.of.get(ids[at]!) ?? 0;
    const outsideOf = (at: number) => fit.communities.outside[communityOf(at)] ?? 0;
    kept.forEach(({ game, ageGap }, at) => {
      const a = index.get(game.teamAId)!;
      const b = index.get(game.teamBId)!;
      const margin = clamp(ratedMargin(game)!, -RATING_CAP, RATING_CAP);
      const gapRuns = ageGap * ageGapRuns;
      cut.pointA[at] = point[a]!;
      cut.pointB[at] = point[b]!;
      cut.responseA[at] = response[a]!;
      cut.responseB[at] = response[b]!;
      cut.evidenceA[at] = evidence[a]!;
      cut.evidenceB[at] = evidence[b]!;
      cut.margin[at] = margin;
      cut.gapRuns[at] = gapRuns;
      cut.heldError[at] = Math.abs(
        fit.confident(point[a]!, evidence[a]!) -
          fit.confident(point[b]!, evidence[b]!) +
          gapRuns -
          margin
      );
      const shownA = unstarted(point[a]! - held * response[a]!, evidence[a]!);
      const shownB = unstarted(point[b]! - held * response[b]!, evidence[b]!);
      cut.x[at] = response[a]! - response[b]!;
      cut.y[at] = margin - (shownA - shownB + gapRuns);
      // The league of the side that has played less outside itself, the first side on a tie.
      cut.cluster[at] = week * 2 ** 26 + communityOf(outsideOf(a) <= outsideOf(b) ? a : b);
      cut.sides[at * 2] = clubOf(game.teamAId);
      cut.sides[at * 2 + 1] = clubOf(game.teamBId);
    });
    cuts.push(cut);
  }
  return cuts;
};

/**
 * A week's errors, game by game, as the board would have shown its ratings with every start at
 * `level` rather than the held one: the held fit plus the response times the distance, its
 * evidence discount read at that fit's own residual scale.
 */
export const closedLevelErrors = (cut: ClosedLevelCut, level: number): Float32Array => {
  const by = level - CLOSED_START_RUNS;
  const shown = discountAt(cut, by);
  const errors = new Float32Array(cut.x.length);
  for (let at = 0; at < cut.x.length; at += 1) {
    const a = shown(cut.pointA[at]! + by * cut.responseA[at]!, cut.evidenceA[at]!);
    const b = shown(cut.pointB[at]! + by * cut.responseB[at]!, cut.evidenceB[at]!);
    errors[at] = Math.abs(a - b + cut.gapRuns[at]! - cut.margin[at]!);
  }
  return errors;
};

/**
 * The level the weeks read, and whether scoring each week with the level the others read predicts
 * its games clearly better than the held level does. Each week's own games never judge a level read
 * from them.
 */
export const judgeClosedLevels = (cuts: readonly ClosedLevelCut[]): ClosedLevelCheck => {
  const all = levelRead(cuts);
  const levels = cuts.map((cut) => levelRead(cuts.filter((other) => other !== cut)).level);
  const judged = cuts.flatMap((cut, at) => {
    const level = levels[at];
    return level === null || level === undefined || cut.x.length === 0 ? [] : [{ cut, level }];
  });
  const samples = judged.reduce((sum, { cut }) => sum + cut.x.length, 0);
  const candidate = new Float32Array(samples);
  const reference = new Float32Array(samples);
  const sides = new Uint32Array(samples * 2);
  let filled = 0;
  for (const { cut, level } of judged) {
    candidate.set(closedLevelErrors(cut, level), filled);
    reference.set(cut.heldError, filled);
    sides.set(cut.sides, filled * 2);
    filled += cut.x.length;
  }
  const paired =
    samples > 0
      ? pairedImprovement({ errors: candidate }, { errors: reference, sides }, false)
      : null;
  return {
    held: CLOSED_START_RUNS,
    level: all.level,
    standardError: all.standardError,
    games: all.games,
    clusters: all.clusters,
    weeks: cuts.map((cut, at) => ({
      from: cut.from,
      to: cut.to,
      games: cut.x.length,
      level: levels[at] ?? null,
    })),
    paired,
    better: isClearlyBetter(paired, 1),
  };
};

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

/**
 * One run of the Model check: a backtest of the page under `options`, or the starting level's
 * re-measure over the page's squad year (`compareClosedLevels`).
 */
export type ModelCheckRun =
  { kind: "backtest"; options: ScoutBacktestOptions } | { kind: "closed-levels" };

/** What one run hands back, of its kind. */
export type ModelCheckRunResult =
  | { kind: "backtest"; result: ScoutBacktestResult }
  | { kind: "closed-levels"; result: ClosedLevelCheck | null };

/**
 * Every run the Model check card makes, in order: each held age gap (`compareAgeGaps`), then each
 * run cap graded on the margin as played (`compareRunCaps`), then the starting level re-measured
 * (`compareClosedLevels`). The plain backtest is the run at the default gap, which is one of those
 * held, so it is not fitted a second time.
 *
 * Listed rather than run in one go so the rankings worker can take them one request at a time: a
 * board refit asked for in the middle then waits for one run, about two seconds on a nationwide
 * year, rather than for all of them. The re-measure is the one long run, four fits of the year and
 * a solve after each, 20 s on the owner's backup of 11 October 2026 in Node, and comes last, so a
 * refit asked for while the backtests run waits only for those.
 */
export const MODEL_CHECK_RUNS: readonly ModelCheckRun[] = [
  ...AGE_GAPS_TO_TRY.map((ageGapPrior): ModelCheckRun => ({
    kind: "backtest",
    options: { ageGapPrior, keepErrors: true },
  })),
  ...RUN_CAPS_TO_TRY.map((cap): ModelCheckRun => ({
    kind: "backtest",
    options: { cap, scoreCap: Infinity, keepErrors: true },
  })),
  { kind: "closed-levels" },
];

/**
 * One run of the check on a page's pool, as of `today`. `ordered` is `backtestGames` for the page,
 * when the caller holds it: the backtests share it, and the re-measure reads the year its own way.
 */
export const runModelCheck = (
  run: ModelCheckRun,
  ageGroupId: string,
  teams: ScoutTeam[],
  games: ScoutGame[],
  ageGroups: AgeGroup[],
  today: string,
  ordered?: BacktestGames
): ModelCheckRunResult =>
  run.kind === "backtest"
    ? {
        kind: "backtest",
        result: backtestScoutRatings(ageGroupId, teams, games, ageGroups, run.options, ordered),
      }
    : {
        kind: "closed-levels",
        result: compareClosedLevels(ageGroupId, teams, games, ageGroups, today),
      };

/** A setting that predicted the held-back games better than the one in use, and by how much. */
export type ModelCheckImprovement = {
  /** The held age gap or the cap. */
  value: number;
  /** Runs a game by which its error is lower, paired game by game. */
  by: number;
  standardError: number;
  samples: number;
};

/** What the Model check card shows. */
export type ModelCheckAnswer = {
  result: ScoutBacktestResult;
  gaps: ScoutBacktestResult[];
  caps: ScoutBacktestResult[];
  /** The held age gap that predicted the games between rated clubs clearly better, if one did. */
  betterGap: ModelCheckImprovement | null;
  /** The cap that predicted the held-back games clearly better than the one in use, if one did. */
  betterCap: ModelCheckImprovement | null;
  /**
   * The starting level re-measured on the last four weeks (`compareClosedLevels`), or null for a
   * page with no table. Left out by a server that predates it, which a device reads as null.
   */
  closedLevels: ClosedLevelCheck | null;
};

/** Paired games below which no difference between two settings is called one. */
export const MIN_PAIRED_GAMES = 30;

/** How much lower one setting's error is than another's, a game at a time (`pairedImprovement`). */
export type PairedReading = { by: number; standardError: number; samples: number };
/** Standard errors a difference must clear to be called better rather than chance, one rival. */
const CLEARLY_BETTER = 2;

/** The standard normal's upper tail, P(Z > z), to about seven places (Numerical Recipes' erfc). */
const upperTail = (z: number): number => {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.5 * x);
  const erfc =
    t *
    Math.exp(
      -x * x -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 +
                            t *
                              (-1.13520398 +
                                t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))
    );
  return z >= 0 ? erfc / 2 : 1 - erfc / 2;
};

/**
 * The bar each of `rivals` settings tried against the one in use must clear: the chance the one
 * rival's bar leaves, split between them (Bonferroni). Tried against one bar each, four or six
 * rivals gave chance four or six goes at naming one of them better — 2 standard errors for one,
 * about 2.53 for the four age gaps and 2.67 for the six caps.
 */
export const clearlyBetterBar = (rivals: number): number => {
  const tail = upperTail(CLEARLY_BETTER) / Math.max(1, rivals);
  let low = 0;
  let high = 10;
  for (let step = 0; step < 60; step += 1) {
    const middle = (low + high) / 2;
    if (upperTail(middle) > tail) low = middle;
    else high = middle;
  }
  return high;
};

/**
 * How much lower `candidate`'s error is than `reference`'s over the same held-out games, game by
 * game, and the standard error of that: null where the two were not kept or do not line up.
 *
 * Paired because every setting faces the identical games, and two settings' errors on one game
 * move together far more than any two games do, so the differences spread far less than either
 * error does and the standard error says how far a gap in the averages can be trusted. On the 9U
 * 2027 pool of 27 September 2026 a year of age held at 1.5 read 0.0011 runs a game better than the
 * 2 in use over 21,986 games between rated clubs, and the card named it best; paired, that is 1.1
 * standard errors (0.00099), inside the noise. The same pool's cap of 12 read 0.050 runs a game
 * better than the 8 then in use, 9.2 standard errors (0.0054), which is an answer. Counted by club,
 * those errors are 4% and 6% wider than read as independent games, which held out games spread over
 * thousands of clubs keep small; a handful of clubs' games would not.
 */
export const pairedImprovement = (
  candidate: Pick<ScoutBacktestResult, "errors">,
  reference: Pick<ScoutBacktestResult, "errors" | "ratedFlags" | "sides">,
  ratedOnly: boolean
): PairedReading | null => {
  const ours = candidate.errors;
  const theirs = reference.errors;
  const rated = reference.ratedFlags;
  if (!ours || !theirs || ours.length !== theirs.length) return null;
  let samples = 0;
  let sum = 0;
  let squares = 0;
  for (let at = 0; at < ours.length; at += 1) {
    if (ratedOnly && !rated?.[at]) continue;
    const lower = theirs[at]! - ours[at]!;
    samples += 1;
    sum += lower;
    squares += lower * lower;
  }
  if (samples < 2) return null;
  const by = sum / samples;
  const variance = Math.max(0, (squares - samples * by * by) / (samples - 1));
  const independent = variance / samples;
  const sides = reference.sides;
  if (!sides || sides.length !== ours.length * 2) {
    return { by, standardError: Math.sqrt(independent), samples };
  }
  /*
   * Games are not independent draws: every game of a club leans on the one rating the fit gave it,
   * so a setting that misreads a club misreads all its games alike. So each game's difference from
   * the mean is summed within each of its two clubs and squared, which is the variance of the mean
   * when games that share a club move together (dyadic clustering, Fafchamps and Gubert 2007). A
   * game is in both its clubs' sums, which counts it, and any rematch of the same two, twice, so
   * each pair of clubs' own sum, squared, is taken back once. The error given is never less than
   * the independent reading.
   */
  const byClub = new Map<number, number>();
  const byPair = new Map<number, number>();
  const span = 2 ** 26;
  for (let at = 0; at < ours.length; at += 1) {
    if (ratedOnly && !rated?.[at]) continue;
    const spread = theirs[at]! - ours[at]! - by;
    const a = sides[at * 2]!;
    const b = sides[at * 2 + 1]!;
    byClub.set(a, (byClub.get(a) ?? 0) + spread);
    // A club on both sides: the game is in that one club's sum, with nothing to take back.
    if (b === a) continue;
    byClub.set(b, (byClub.get(b) ?? 0) + spread);
    const pair = Math.min(a, b) * span + Math.max(a, b);
    byPair.set(pair, (byPair.get(pair) ?? 0) + spread);
  }
  let shared = 0;
  byClub.forEach((total) => (shared += total * total));
  byPair.forEach((total) => (shared -= total * total));
  const clustered = shared / (samples * samples);
  return { by, standardError: Math.sqrt(Math.max(independent, clustered)), samples };
};

/**
 * Whether a paired reading names a setting better than the one in use, one of `rivals` tried
 * against it: enough games, lower on average, and by more than the bar for that many rivals.
 */
export const isClearlyBetter = (paired: PairedReading | null, rivals: number): boolean =>
  paired !== null &&
  paired.samples >= MIN_PAIRED_GAMES &&
  paired.by > 0 &&
  paired.by > clearlyBetterBar(rivals) * paired.standardError;

/**
 * The best of `sorted` (best first) that beats `reference` clearly, or null. Down the list rather
 * than only its head, since the lowest average can carry the widest spread and a runner-up with a
 * tighter one can be the only clear answer.
 */
const clearlyBetter = (
  sorted: readonly ScoutBacktestResult[],
  reference: ScoutBacktestResult,
  value: (result: ScoutBacktestResult) => number,
  ratedOnly: boolean
): ModelCheckImprovement | null => {
  const rivals = sorted.filter((rival) => rival !== reference).length;
  for (const rival of sorted) {
    if (rival === reference) continue;
    const paired = pairedImprovement(rival, reference, ratedOnly);
    if (paired && isClearlyBetter(paired, rivals)) return { value: value(rival), ...paired };
  }
  return null;
};

/** A result without the per-game arrays the comparison needed, which the card has no use for. */
const withoutErrors = (result: ScoutBacktestResult): ScoutBacktestResult => {
  const { errors: _errors, ratedFlags: _rated, sides: _sides, ...rest } = result;
  return rest;
};

const bestFirst = (a: ScoutBacktestResult, b: ScoutBacktestResult) =>
  (a.meanAbsoluteError ?? Infinity) - (b.meanAbsoluteError ?? Infinity);

/** The card's answer from the results of `MODEL_CHECK_RUNS`, in the same order. */
export const modelCheckAnswer = (results: readonly ModelCheckRunResult[]): ModelCheckAnswer => {
  const backtests = results.flatMap((one) => (one.kind === "backtest" ? [one.result] : []));
  const gaps = backtests.slice(0, AGE_GAPS_TO_TRY.length);
  const caps = backtests.slice(AGE_GAPS_TO_TRY.length);
  const closed = results.find((one) => one.kind === "closed-levels");
  const plain = gaps[AGE_GAPS_TO_TRY.indexOf(AGE_GAP_RUNS_PER_YEAR)];
  if (!plain) throw new Error("The gaps tried must include the default one.");
  const gapsBest = [...gaps].sort(bestRatedFirst);
  const capsBest = [...caps].sort(bestFirst);
  const inUse = caps.find((result) => result.cap === RATING_CAP);
  return {
    result: withoutErrors(plain),
    gaps: gapsBest.map(withoutErrors),
    caps: capsBest.map(withoutErrors),
    betterGap: clearlyBetter(gapsBest, plain, (result) => result.ageGapPrior, true),
    betterCap: inUse ? clearlyBetter(capsBest, inUse, (result) => result.cap, false) : null,
    closedLevels: closed?.kind === "closed-levels" ? closed.result : null,
  };
};

/** The whole check in one call, for a pool small enough to be worked out on the page. */
export const checkTheModel = (
  ageGroupId: string,
  teams: ScoutTeam[],
  games: ScoutGame[],
  ageGroups: AgeGroup[],
  today: string = todayIsoDay()
): ModelCheckAnswer => {
  const ordered = backtestGames(ageGroupId, teams, games, ageGroups);
  return modelCheckAnswer(
    MODEL_CHECK_RUNS.map((run) =>
      runModelCheck(run, ageGroupId, teams, games, ageGroups, today, ordered)
    )
  );
};
