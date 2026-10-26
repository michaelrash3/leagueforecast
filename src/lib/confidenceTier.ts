/*
 * How sure a matchup's forecast is, in words, apart from the engine that works it out
 * (`predictionEngine.ts`): the Dashboard reads these, and taking them from the engine took the
 * engine's own imports into the Dashboard's chunk and split the first download's shared code in
 * two (`bundleBudget.mjs`).
 */

export type ConfidenceTier = "Low" | "Moderate" | "Strong" | "High";

/** The one risk that is a game's own: a side with few games behind its rating. */
export const SMALL_SAMPLE_RISK = "Small sample size can make ratings unstable.";
/** Said of every close game, which its win chance already says. */
export const CLOSE_GAME_RISK = "Similar team ratings create a close-game risk.";

export const confidenceTier = (score: number): ConfidenceTier =>
  score >= 82 ? "High" : score >= 66 ? "Strong" : score >= 46 ? "Moderate" : "Low";
