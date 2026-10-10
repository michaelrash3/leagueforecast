/**
 * How far one game lands from its forecast (2.10): the margins and scores eight games in ten end
 * within, around the projected margin and the expected score, in whole runs as the cards show them.
 * It says how much a single game varies, not how sure the model is (that is the confidence) and not
 * a second chance of winning, and it is the same width for every game at a pitch.
 *
 * Measured, rather than read off the curve the win chance comes from. On 1,006 pseudo-leagues from
 * the 29 Sep 2026 pool (each state's pulled clubs on a 2027 page with twenty or more; their games
 * with one another up to 13, 19 or 20 September the season so far, their other results what the
 * bridge would hand over, and every later game between them scored), with the ends rounded as shown:
 *
 * - 81.0% of 89,998 player-pitch games ended within 9 runs of the projected margin, and 81.9% of
 *   7,492 machine-pitch games within 10: 79% and 78% where either side had played two games or
 *   fewer, 85% and 88% where both had played six or more. The win chance's curve would have put
 *   eight in ten within 10.3 and 8.7 runs, which held 85% of player-pitch games but only 73% of
 *   machine-pitch ones, so the range does not borrow it.
 * - In 79.5% of player-pitch games and 79.7% of machine-pitch ones, both sides scored within 6.5
 *   and 8 runs of their expected score: 85% of player-pitch games where sides average four to six
 *   runs, 74% where they average eight or more.
 */
export const MARGIN_RANGE_RUNS = 9;
export const MARGIN_RANGE_RUNS_MACHINE_PITCH = 10;
export const SCORE_RANGE_RUNS = 6.5;
export const SCORE_RANGE_RUNS_MACHINE_PITCH = 8;

/** A span of whole runs, both ends in. */
export type RunSpan = { low: number; high: number };

export type ForecastRange = {
  /** Team A's margin, from its side: negative is team B ahead. */
  margin: RunSpan;
  /** Each side's runs, once the season has a final to put a scoring level on. */
  score?: { teamA: RunSpan; teamB: RunSpan };
};

/**
 * Rounded half away from zero, so the same game read from the other side is the same range turned
 * round, whatever its decimals.
 */
const wholeRuns = (runs: number) => Math.sign(runs) * Math.round(Math.abs(runs)) + 0;

/**
 * The range around a game's forecast, from the margin and expected score as shown (a tenth of a run
 * each), so the ends can be worked out from the card.
 */
export const forecastRange = ({
  margin,
  expectedScore,
  machinePitch,
}: {
  /** Team A's projected margin, from its side. */
  margin: number;
  expectedScore?: { teamA: number; teamB: number };
  machinePitch: boolean;
}): ForecastRange => {
  const width = machinePitch ? MARGIN_RANGE_RUNS_MACHINE_PITCH : MARGIN_RANGE_RUNS;
  const scoreWidth = machinePitch ? SCORE_RANGE_RUNS_MACHINE_PITCH : SCORE_RANGE_RUNS;
  const runs = (expected: number): RunSpan => ({
    low: Math.max(0, wholeRuns(expected - scoreWidth)),
    high: wholeRuns(expected + scoreWidth),
  });
  return {
    margin: { low: wholeRuns(margin - width), high: wholeRuns(margin + width) },
    ...(expectedScore
      ? { score: { teamA: runs(expectedScore.teamA), teamB: runs(expectedScore.teamB) } }
      : {}),
  };
};
