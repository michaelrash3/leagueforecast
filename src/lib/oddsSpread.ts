/*
 * The odds curve's spread on its own, so that the simulators (`sim.ts`, in the forecast's worker)
 * can read the same number the prediction engine's chance is drawn on without taking the prediction
 * engine into the worker with it.
 */

/**
 * The spread of the prediction engine's odds curve (`predictionFor`): the projected margin that
 * moves a matchup from even to about 73%. It drew the Dashboard's matchup odds when it was fitted;
 * the Dashboard shows the per-game model's chance now (`predictGame`), and the curve's own is read
 * only by a card's "Why" panel, to say when the margin and the chance shown part ways. The
 * simulators draw a game's margin on the same spread, read as a normal curve (`seasonDraws`).
 *
 * It was 2.8 runs, fitted to ratings capped at the league's 8. Ratings capped at
 * `FORECAST_RUN_CAP` stretch further, and on the same pseudo-leagues the spread that fitted best
 * was 4.70 with Team Rankings results and 4.75 without, the log loss falling from 0.6254 to 0.6188
 * and from 0.6330 to 0.6265 against 2.8 on ratings capped at 8. The 9U to 18U pages each fitted
 * between 3.80 and 5.45 with no trend in age, so one number serves them. The 8U pages, which are
 * machine and coach pitch, fitted 3.95 (5,123 games in 78 pseudo-leagues of ten clubs or more): a
 * margin says more about who wins where the pitching is the same for everybody.
 */
export const MATCHUP_ODDS_SPREAD = 4.7;
export const MATCHUP_ODDS_SPREAD_MACHINE_PITCH = 3.95;
