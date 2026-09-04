import { clamp } from "./util";

export type RatingGame = {
  home: string;
  away: string;
  /** Actual run margin from the home team's perspective (homeScore − awayScore), uncapped. */
  homeMargin: number;
  /**
   * True when nobody was at home — a tournament game, or any result where the pair order is just
   * the order it was typed in. Such a game still tells you who is better, but it says nothing
   * about home-field advantage, so it is left out of that estimate. Without this, entering
   * neutral games with the same side first every time invents a home-field edge out of nothing.
   */
  neutral?: boolean;
};

export type OpponentAdjustedRatings = {
  /** Opponent-adjusted rating in run units: expected margin vs a league-average team. */
  ratings: Map<string, number>;
  /** Own average capped run margin per game (before opponent adjustment). */
  rawMargin: Map<string, number>;
  /** Average opponent rating faced — a run-denominated strength of schedule. */
  strengthOfSchedule: Map<string, number>;
  /** Games played, per team. */
  games: Map<string, number>;
  /** Estimated additive home-field advantage in runs (shrunk toward 0). */
  homeAdvantage: number;
  /** The per-game margin cap that was applied. */
  cap: number;
};

export type OpponentAdjustedOptions = {
  /** Per-game run-margin cap (blowouts beyond this don't dominate). */
  cap?: number;
  /**
   * Ridge/shrinkage strength on team ratings — acts like this many virtual games against a
   * league-average opponent, regressing thin records toward the mean. Higher = more shrinkage.
   */
  shrinkage?: number;
  /** Ridge strength on the home-field term — high by default because many youth games are neutral-site. */
  homeFieldShrinkage?: number;
};

const DEFAULT_CAP = 8;
const DEFAULT_SHRINKAGE = 1.5;
const DEFAULT_HOME_FIELD_SHRINKAGE = 3;

// Solve the symmetric linear system A x = b via Gaussian elimination with partial pivoting.
// A is (n × n) row-major; returns x of length n (zeros if the system is degenerate).
const solveLinearSystem = (matrix: number[][], vector: number[]): number[] => {
  const n = vector.length;
  const a = matrix.map((row) => row.slice());
  const b = vector.slice();

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row]![col]!) > Math.abs(a[pivot]![col]!)) pivot = row;
    }
    if (Math.abs(a[pivot]![col]!) < 1e-9) continue; // singular column; ridge should prevent this
    if (pivot !== col) {
      [a[col], a[pivot]] = [a[pivot]!, a[col]!];
      [b[col], b[pivot]] = [b[pivot]!, b[col]!];
    }
    const pivotValue = a[col]![col]!;
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row]![col]! / pivotValue;
      if (factor === 0) continue;
      for (let k = col; k < n; k += 1) {
        a[row]![k]! -= factor * a[col]![k]!;
      }
      b[row]! -= factor * b[col]!;
    }
  }

  return b.map((value, index) => {
    const diag = a[index]![index]!;
    return Math.abs(diag) < 1e-9 ? 0 : value / diag;
  });
};

/**
 * Opponent-adjusted power ratings via ridge-regularized least squares (a Massey rating) on capped
 * per-game run margins, with an estimated home-field term. This is the "NET in spirit" model: it
 * keeps margin of victory (unlike RPI) but caps it, adjusts it for opponent strength, and — via the
 * ridge term — regresses small samples toward the league mean so ~10–20-game seasons stay stable.
 */
export const buildOpponentAdjustedRatings = (
  teamIds: string[],
  games: RatingGame[],
  options: OpponentAdjustedOptions = {}
): OpponentAdjustedRatings => {
  const cap = options.cap ?? DEFAULT_CAP;
  const shrinkage = options.shrinkage ?? DEFAULT_SHRINKAGE;
  const homeFieldShrinkage = options.homeFieldShrinkage ?? DEFAULT_HOME_FIELD_SHRINKAGE;

  const ratings = new Map<string, number>();
  const rawMarginSum = new Map<string, number>();
  const gameCount = new Map<string, number>();
  const opponents = new Map<string, string[]>();
  teamIds.forEach((id) => {
    ratings.set(id, 0);
    rawMarginSum.set(id, 0);
    gameCount.set(id, 0);
    opponents.set(id, []);
  });

  const index = new Map(teamIds.map((id, i) => [id, i]));
  const n = teamIds.length;
  if (n === 0) {
    return {
      ratings,
      rawMargin: new Map(),
      strengthOfSchedule: new Map(),
      games: gameCount,
      homeAdvantage: 0,
      cap,
    };
  }

  // Parameters: n team ratings + 1 home-field term (index n).
  const size = n + 1;
  const hfa = n;
  const a: number[][] = Array.from({ length: size }, () => new Array(size).fill(0));
  const rhs = new Array(size).fill(0);

  games.forEach((game) => {
    const h = index.get(game.home);
    const w = index.get(game.away);
    if (h === undefined || w === undefined) return;
    const margin = clamp(game.homeMargin, -cap, cap);

    // Row vector c: +1 at home, −1 at away, and `hf` at HFA — 1 for a real home game, 0 when the
    // game was neutral. Contributes c·cᵀ to A and c·margin to rhs.
    const hf = game.neutral ? 0 : 1;
    a[h]![h]! += 1;
    a[h]![w]! -= 1;
    a[h]![hfa]! += hf;
    a[w]![h]! -= 1;
    a[w]![w]! += 1;
    a[w]![hfa]! -= hf;
    a[hfa]![h]! += hf;
    a[hfa]![w]! -= hf;
    a[hfa]![hfa]! += hf * hf;
    rhs[h] += margin;
    rhs[w] -= margin;
    rhs[hfa] += hf * margin;

    rawMarginSum.set(game.home, (rawMarginSum.get(game.home) ?? 0) + margin);
    rawMarginSum.set(game.away, (rawMarginSum.get(game.away) ?? 0) - margin);
    gameCount.set(game.home, (gameCount.get(game.home) ?? 0) + 1);
    gameCount.set(game.away, (gameCount.get(game.away) ?? 0) + 1);
    opponents.get(game.home)?.push(game.away);
    opponents.get(game.away)?.push(game.home);
  });

  // Ridge regularization: shrink team ratings toward 0 (league mean) and the HFA toward 0.
  for (let i = 0; i < n; i += 1) a[i]![i]! += shrinkage;
  a[hfa]![hfa]! += homeFieldShrinkage;

  const solution = solveLinearSystem(a, rhs);
  teamIds.forEach((id, i) => ratings.set(id, solution[i] ?? 0));
  const homeAdvantage = solution[hfa] ?? 0;

  const rawMargin = new Map<string, number>();
  const strengthOfSchedule = new Map<string, number>();
  teamIds.forEach((id) => {
    const played = gameCount.get(id) ?? 0;
    rawMargin.set(id, played ? (rawMarginSum.get(id) ?? 0) / played : 0);
    const faced = opponents.get(id) ?? [];
    strengthOfSchedule.set(
      id,
      faced.length ? faced.reduce((sum, opp) => sum + (ratings.get(opp) ?? 0), 0) / faced.length : 0
    );
  });

  return { ratings, rawMargin, strengthOfSchedule, games: gameCount, homeAdvantage, cap };
};
