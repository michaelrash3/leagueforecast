import type { GameLog, Matchup, Settings, TeamBase } from "./types";
import { parseDateValue } from "./date";
import { calculateTeams, predictGame } from "./sim";
import { isFinal } from "./util";

export type CalibrationBucket = { min: number; max: number; predicted: number; actual: number; samples: number };
export type BacktestResult = {
  brierScore: number;
  upsetCaptureRate: number;
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

export const backtestPredictions = (
  teamBases: TeamBase[],
  matchups: Matchup[],
  logs: Record<string, GameLog>,
  settings: Settings,
  bucketSize = 0.1
): BacktestResult => {
  const ordered = [...matchups].sort(
    (a, b) => parseDateValue(a.date) - parseDateValue(b.date) || a.id.localeCompare(b.id)
  );
  const progressiveLogs: Record<string, GameLog> = {};
  const rows: Array<{
    p: number;
    y: 0 | 1;
    upset: boolean;
    captured: boolean;
    correct: boolean;
    marginError: number;
    highConfidence: boolean;
  }> = [];

  ordered.forEach((game) => {
    const finalLog = logs[game.id];
    if (!finalLog || !isFinal(finalLog)) return;

    const state = calculateTeams(teamBases, ordered, progressiveLogs);
    const prediction = predictGame(game, state, settings);
    const awayRuns = Number(finalLog.awayRuns);
    const homeRuns = Number(finalLog.homeRuns);
    if (!Number.isFinite(awayRuns) || !Number.isFinite(homeRuns) || awayRuns === homeRuns) {
      progressiveLogs[game.id] = finalLog;
      return;
    }
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
    progressiveLogs[game.id] = finalLog;
  });

  if (!rows.length)
    return {
      brierScore: 0,
      upsetCaptureRate: 0,
      sampleSize: 0,
      calibration: [],
      winnerAccuracy: null,
      averageMarginError: null,
      highConfidenceAccuracy: null,
      highConfidenceSamples: 0,
    };
  const brierScore = rows.reduce((sum, r) => sum + (r.p - r.y) ** 2, 0) / rows.length;
  const upsetRows = rows.filter((r) => r.upset);
  const upsetCaptureRate = upsetRows.length ? upsetRows.filter((r) => r.captured).length / upsetRows.length : 0;
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

  const calibration: CalibrationBucket[] = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([idx, bucket]) => ({
    min: idx * bucketSize,
    max: (idx + 1) * bucketSize,
    predicted: bucket.predictedSum / bucket.samples,
    actual: bucket.actualSum / bucket.samples,
    samples: bucket.samples,
  }));

  return {
    brierScore,
    upsetCaptureRate,
    sampleSize: rows.length,
    calibration,
    winnerAccuracy,
    averageMarginError,
    highConfidenceAccuracy,
    highConfidenceSamples: highConfidenceRows.length,
  };
};
