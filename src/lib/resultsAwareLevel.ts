import type { OpponentAdjustedRatings, RatingGame } from "./powerRating";
import { startingLevel, type ScheduleCommunities } from "./scheduleCommunities";
import type { ScoutYearFirstFit } from "./teamRankings";
import { clamp } from "./util";

/**
 * A league's start that also reads how its outside games went: research, off by default, and
 * nothing a board uses. A year's fit takes it as its second start (`fitScoutYear`'s `restart`,
 * `resultsAwareRestart`), and `scripts/communityLevelSweep.ts` measures it against the counted
 * level. It lives here, apart from `scheduleCommunities.ts` and the fit, because those are in the
 * page's first download and this is not: in the fit it cost 0.3 KB gzipped of a first download
 * that main holds 0.1 KB under its 255.0 KB limit (`scripts/bundleBudget.mjs`, 26 October 2026).
 *
 * `startingLevel` reads how many games a league has played outside itself and never how they went.
 * A league of eight whose one outside game was a 15-run loss starts at −1.45, as it would had it
 * won, and the loss is one game against the twelve virtual games its clubs play at that level, so
 * it is outvoted: the Longhorns of Edgewood, Kentucky (9U 2027) stood +6.2 and second in their
 * state on 26 October 2026 on a 9-0 record inside such a league. This moves each league's level by
 * what its outside games say, given a first fit at the counted level: the mean of their residuals
 * from the league's side, the margin as capped less the first fit's prediction, shrunk toward
 * nothing as `Σ w·e / (Σ w + kappa)`, so `kappa` outside games' worth of belief stays with the
 * counted level. The weights are the fit's own (`RatingGame.weight`), a game the fit counts half
 * counting half here; with none, `Σ w` is the league's outside games.
 *
 * It cannot tell a league that lost its outside games because it is weak from one that met the
 * nation's best: the first fit's prediction already holds the opponent's rating, so a loss to a
 * strong side moves it less than the same loss to a middling one, and that is all. Nothing about
 * how well it predicts has been measured yet; the sweep is what will say.
 */
export type ResultsAwareLevel = {
  /** Outside games' worth of belief kept with the counted level; at infinity nothing moves. */
  kappa: number;
  /** Leagues with more outside games than this keep the counted level; every league when left out. */
  maxOutside?: number;
};

/** One rated game's residual from its first side, the margin as capped less the prediction. */
export type GameResidual = { home: string; away: string; residual: number; weight: number };

/**
 * Each rated game's residual from its first side against a fit: the margin capped as the fit caps
 * it, less what the fit predicted, read as `buildOpponentAdjustedRatings` reads its residual scale,
 * with the weight the fit gave the game (a weight it would not read counted as one, as it counts it).
 */
export const residualsOf = (
  rows: readonly RatingGame[],
  fit: OpponentAdjustedRatings
): GameResidual[] =>
  rows.map((row) => {
    const predicted =
      (fit.ratings.get(row.home) ?? 0) -
      (fit.ratings.get(row.away) ?? 0) +
      (row.neutral ? 0 : fit.homeAdvantage) +
      (row.ageGap ?? 0) * fit.ageGapRuns;
    const own = row.weight;
    return {
      home: row.home,
      away: row.away,
      residual: clamp(row.homeMargin, -fit.cap, fit.cap) - predicted,
      weight: own === undefined || !Number.isFinite(own) || own < 0 ? 1 : own,
    };
  });

/**
 * Every node's level under `rule`, given the first fit's residuals over the rated games:
 * `startingLevel` plus its league's shift. A game inside one league, or naming a node in none, says
 * nothing of any league's level and is passed over, so a league with no outside games keeps its
 * counted level, as an island does. Summed in the order the games come, then each league divided
 * once.
 */
export const resultsAwareLevels = (
  communities: ScheduleCommunities,
  residuals: Iterable<GameResidual>,
  rule: ResultsAwareLevel
): Map<string, number> => {
  const count = communities.outside.length;
  const sum = new Float64Array(count);
  const weight = new Float64Array(count);
  for (const { home, away, residual, weight: own } of residuals) {
    const a = communities.of.get(home);
    const b = communities.of.get(away);
    if (a === undefined || b === undefined || a === b) continue;
    if (!(own > 0) || !Number.isFinite(residual)) continue;
    sum[a]! += own * residual;
    weight[a]! += own;
    sum[b]! -= own * residual;
    weight[b]! += own;
  }
  const levels = new Map<string, number>();
  communities.of.forEach((c, id) => {
    const outside = communities.outside[c] ?? 0;
    const moved = rule.maxOutside === undefined || outside <= rule.maxOutside;
    const shrunk = weight[c]! + rule.kappa;
    const shift = moved && shrunk > 0 && Number.isFinite(shrunk) ? sum[c]! / shrunk : 0;
    levels.set(id, startingLevel(outside) + shift);
  });
  return levels;
};

/** `rule` as a year fit's second start (`ScoutYearFitOptions.restart`). */
export const resultsAwareRestart =
  (rule: ResultsAwareLevel) =>
  ({ communities, rows, adjusted }: ScoutYearFirstFit): Map<string, number> =>
    resultsAwareLevels(communities, residualsOf(rows, adjusted), rule);
