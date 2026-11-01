import type { GameLog, Matchup, Prediction, Settings, TeamBase } from "./types";
import { seasonStartMonth } from "./date";
import { attachAdjustedRatings, calculateTeams, predictGame } from "./sim";
import {
  buildPredictionEngine,
  playedOn,
  type ExternalResult,
  type PredictionEngineResult,
} from "./predictionEngine";
import { isFinal } from "./util";

export type CalibrationBucket = {
  min: number;
  max: number;
  predicted: number;
  actual: number;
  samples: number;
};
export type BacktestResult = {
  brierScore: number;
  /**
   * Of the games the model got wrong, the share it had called confidently. **Lower is better.**
   *
   * It was named `upsetCaptureRate` and drawn as "Upsets", with the league summary writing "N% of
   * upsets called" — every one of which says the model saw them coming. It measures the reverse,
   * and always did: `upset` is a game the model's favourite lost, and `captured` is a call away
   * from the coin flip, so the number is the rate at which the model was confidently wrong.
   *
   * A model cannot call an upset by this definition. To have called it, the model would have had
   * to favour the underdog — and then the underdog winning is not an upset at all.
   */
  confidentMissRate: number;
  sampleSize: number;
  calibration: CalibrationBucket[];
  /** Share of decisive games whose favored side actually won (null with no samples). */
  winnerAccuracy: number | null;
  /** Mean absolute error between the projected and actual run margin (null with no samples). */
  averageMarginError: number | null;
  /** Winner accuracy restricted to confident calls (|p−0.5| ≥ threshold); null if none. */
  highConfidenceAccuracy: number | null;
  /** How many decisive games cleared the high-confidence threshold. */
  highConfidenceSamples: number;
};

/** A pick is "high confidence" once the win probability is at least this far from a coin flip. */
const HIGH_CONFIDENCE_MARGIN = 0.15;

/**
 * The Team Rankings results the forecast reads beside the league's games (`buildPredictionEngine`),
 * and the squad year that places their days among the league's (`playedOn`).
 */
export type BacktestOutside = { outside?: readonly ExternalResult[]; squadYear?: number };

/**
 * One final game as the walk reaches it, called from what was known before it alone: the season's
 * earlier finals and the outside results played before its day.
 */
export type BacktestStep = {
  game: Matchup;
  /** Its final score, which nothing in `engine` or `prediction` has seen. */
  log: GameLog;
  /** The prediction engine fitted on the same, whose `predictions` hold this game's. */
  engine: PredictionEngineResult;
  /** The per-game model's call of it (`predictGame`), the chance every League screen shows. */
  prediction: Prediction;
};

/**
 * The season's final games walked in its own order, each handed to `visit` with the forecast made
 * from only what came before it, and then counted as known for the games after it: a tie, and a
 * score that is no number, are handed over and counted too, as every final is. The walk the
 * backtest scores (`backtestPredictions`), on its own so the research sweep can score each game by
 * both models from the very same fits (`scripts/modelSweep.ts`, `--league-models`).
 */
export const walkForward = (
  teamBases: TeamBase[],
  matchups: Matchup[],
  logs: Record<string, GameLog>,
  settings: Settings,
  { outside = [], squadYear }: BacktestOutside,
  visit: (step: BacktestStep) => void
): void => {
  // The season's own order, which turns over New Year when its schedule does, over the outside
  // results' days too, as the trend reads them.
  const start = seasonStartMonth([
    ...matchups.map((game) => game.date),
    ...outside.map((result) => result.date ?? ""),
  ]);
  // On the one timeline the outside results are filtered on (`playedOn`): with a squad year, each
  // "M/D" in its own year, so results long after the season, which can move where the year seems
  // to start, cannot put January's game before October's. With none, as it always was.
  const dayOf = (game: Matchup) => {
    const day = playedOn(game.date, squadYear, start);
    return Number.isFinite(day) ? day : Number.POSITIVE_INFINITY;
  };
  const ordered = [...matchups].sort((a, b) => dayOf(a) - dayOf(b) || a.id.localeCompare(b.id));
  const progressiveLogs: Record<string, GameLog> = {};

  /*
   * The latest day the season has reached: a game logged with no date is called as of the last day
   * before it that has one, not as of the end of time, which would hand it every outside result.
   */
  let through = Number.NEGATIVE_INFINITY;
  ordered.forEach((game) => {
    const finalLog = logs[game.id];
    if (!finalLog || !isFinal(finalLog)) return;
    const own = playedOn(game.date, squadYear, start);
    const day = Number.isFinite(own) ? own : through;
    if (Number.isFinite(own)) through = Math.max(through, own);

    // Fitted on the games played so far, like everything else here: a rating that had seen the
    // game being predicted would flatter every number this returns. With the Team Rankings results
    // the forecast reads, the ones played before the game's day (`trend.ts` reads them the same
    // way); one undated, or on the day or after, could carry the result being predicted.
    const played = outside.filter((result) => playedOn(result.date, squadYear, start) < day);
    const base = calculateTeams(teamBases, ordered, progressiveLogs, settings);
    const engine = buildPredictionEngine(
      base,
      ordered,
      progressiveLogs,
      settings,
      played,
      squadYear
    );
    const state = attachAdjustedRatings(base, engine.ratings);
    const prediction = predictGame(game, state, settings);
    visit({ game, log: finalLog, engine, prediction });
    progressiveLogs[game.id] = finalLog;
  });
};

export const backtestPredictions = (
  teamBases: TeamBase[],
  matchups: Matchup[],
  logs: Record<string, GameLog>,
  settings: Settings,
  bucketSize = 0.1,
  outside: BacktestOutside = {}
): BacktestResult => {
  const rows: Array<{
    p: number;
    y: 0 | 1;
    upset: boolean;
    captured: boolean;
    correct: boolean;
    marginError: number;
    highConfidence: boolean;
  }> = [];

  walkForward(teamBases, matchups, logs, settings, outside, ({ log: finalLog, prediction }) => {
    const awayRuns = Number(finalLog.awayRuns);
    const homeRuns = Number(finalLog.homeRuns);
    // A tie has no winner to score, and is known to the games after it all the same.
    if (!Number.isFinite(awayRuns) || !Number.isFinite(homeRuns) || awayRuns === homeRuns) return;
    const awayWon = awayRuns > homeRuns ? 1 : 0;
    const favoredAway = prediction.awayWinPct >= 0.5;
    const actualFavoriteWon = (favoredAway && awayWon === 1) || (!favoredAway && awayWon === 0);
    const marginError = Math.abs(
      prediction.awayScore - prediction.homeScore - (awayRuns - homeRuns)
    );
    rows.push({
      p: prediction.awayWinPct,
      y: awayWon as 0 | 1,
      upset: !actualFavoriteWon,
      captured: prediction.awayWinPct <= 0.45 || prediction.awayWinPct >= 0.55,
      correct: actualFavoriteWon,
      marginError,
      highConfidence: Math.abs(prediction.awayWinPct - 0.5) >= HIGH_CONFIDENCE_MARGIN,
    });
  });

  if (!rows.length)
    return {
      brierScore: 0,
      confidentMissRate: 0,
      sampleSize: 0,
      calibration: [],
      winnerAccuracy: null,
      averageMarginError: null,
      highConfidenceAccuracy: null,
      highConfidenceSamples: 0,
    };
  const brierScore = rows.reduce((sum, r) => sum + (r.p - r.y) ** 2, 0) / rows.length;
  const upsetRows = rows.filter((r) => r.upset);
  const confidentMissRate = upsetRows.length
    ? upsetRows.filter((r) => r.captured).length / upsetRows.length
    : 0;
  const winnerAccuracy = rows.filter((r) => r.correct).length / rows.length;
  const averageMarginError = rows.reduce((sum, r) => sum + r.marginError, 0) / rows.length;
  const highConfidenceRows = rows.filter((r) => r.highConfidence);
  const highConfidenceAccuracy = highConfidenceRows.length
    ? highConfidenceRows.filter((r) => r.correct).length / highConfidenceRows.length
    : null;

  const buckets = new Map<number, { predictedSum: number; actualSum: number; samples: number }>();
  rows.forEach((r) => {
    const idx = Math.min(Math.floor(r.p / bucketSize), Math.floor(1 / bucketSize) - 1);
    const bucket = buckets.get(idx) ?? { predictedSum: 0, actualSum: 0, samples: 0 };
    bucket.predictedSum += r.p;
    bucket.actualSum += r.y;
    bucket.samples += 1;
    buckets.set(idx, bucket);
  });

  const calibration: CalibrationBucket[] = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([idx, bucket]) => ({
      min: idx * bucketSize,
      max: (idx + 1) * bucketSize,
      predicted: bucket.predictedSum / bucket.samples,
      actual: bucket.actualSum / bucket.samples,
      samples: bucket.samples,
    }));

  return {
    brierScore,
    confidentMissRate,
    sampleSize: rows.length,
    calibration,
    winnerAccuracy,
    averageMarginError,
    highConfidenceAccuracy,
    highConfidenceSamples: highConfidenceRows.length,
  };
};
