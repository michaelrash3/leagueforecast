/*
 * How long a test may run that builds every board of the 300-clubs-a-page fixture, most with last
 * week's places and the rank lines, each a fit of a year for each week. The budget is there to end
 * a test that hangs; how fast the boards build is the bench's to say (`scripts/liveBench.ts`).
 *
 * It was 20 s, set when such a test took 1 to 4 s apiece under coverage on its own. The boards have
 * since come to do more, and on 6 November 2026 the slowest, under the coverage run on four cores
 * on Node 24, took 7.6 s (publishCopy's boards), 6.9 s (boardParity's halves) and 2.1 s (viewStore's
 * one-game edit, which ran under Vitest's default of 5 s). The gate runs them beside six hundred
 * other files, and in a session's coverage run of 2 November all three passed their budgets and
 * failed, passing when run alone. A minute holds the slowest about eight times over, as 20 s held
 * the old ones, and still ends a test that hangs.
 */
export const BUILDS_EVERY_BOARD = { timeout: 60_000 };
