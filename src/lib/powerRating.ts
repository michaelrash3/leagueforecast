import { clamp } from "./util";

/**
 * Opponent-adjusted power ratings: a ridge-regularized least-squares (Massey) fit on capped run
 * margins. This is the "NET in spirit" model — it keeps margin of victory (unlike RPI) but caps
 * it, adjusts it for opponent strength, and regresses thin records toward the league mean so
 * ~10–20-game seasons stay stable.
 *
 * Per game the model reads
 *
 *     margin = r_home − r_away + hf·HFA + gap·(g0 + δ) + ε
 *
 * `margin` is the home side's run margin capped at ±cap. `r` are the team ratings: the expected
 * margin against a league-average team, in runs, and the thing everything else is measured in.
 * `hf` is 1 for a real home game and 0 for a neutral one, so only games with a genuine home side
 * inform the home-field term `HFA`. `gap` is the home side's age level minus the away side's, in
 * years, and is what lets a game across age levels count. Youth baseball's rule of thumb is that
 * the older side wins by about `g0` runs per year of age (`AGE_GAP_RUNS_PER_YEAR`): an 8U losing to
 * a 9U by that much has played it even, and only the margin beyond it says anything about the two
 * teams. `δ` is the data's own correction to that prior. It is fitted from whatever cross-age
 * games the pool holds, but a ridge term of its own holds it to the prior, so one lopsided game
 * between levels cannot rewrite what a year of age is worth while a season of them can. Without a
 * single cross-age game δ is exactly 0 and the fit is the same-level model, digit for digit.
 *
 * The fit is done by regressing `y = margin − gap·g0` on the columns (+1 home, −1 away, hf, gap)
 * with a ridge penalty on every parameter — `shrinkage` on each rating, `homeFieldShrinkage` on
 * HFA, `ageGapShrinkage` on δ — and reporting `ageGapRuns = g0 + δ`. The ridge is what makes the
 * normal equations positive definite even for a team with no games or a pool with no home games,
 * so there is always one answer and it is the sensible one (zero, the league mean).
 *
 * Strength of schedule is the mean, over a team's games, of the opponent's strength *as seen from
 * that team's seat*: `r_opp + ageGapRuns · (level_opp − level_self)`. A 9U that plays a 10U rated
 * 0 has faced something worth about two runs more than a 9U rated 0, and its schedule says so;
 * the 10U playing down gets the mirror-image debit. Same-level games reduce to the opponent's
 * rating, as before.
 *
 * Two solvers produce the same answer. The dense one is Gaussian elimination on the full matrix,
 * exact to rounding and the right tool for a league or a single age group. A season-wide pool fed
 * from GameChanger can hold hundreds or thousands of teams, where an n³ elimination stops being
 * quick; for those the normal equations are kept as sparse rows and solved by conjugate gradient,
 * to a tolerance far below anything a ranking table can show.
 */

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
  /**
   * Home side's age level minus the away side's, in years (9U vs 8U at home = +1). Absent/0 =
   * same level. The older side is expected to win by `ageGapRuns` per year of it, so only the
   * margin beyond that counts as evidence about the two teams.
   */
  ageGap?: number;
  /**
   * How much this game counts, relative to a game of weight 1. Absent means 1, and a pool where
   * every game is absent fits exactly as it did before weights existed.
   *
   * The fit minimises the weighted sum of squared residuals, so a game of weight 0.5 pulls on the
   * ratings half as hard as a game of weight 1 — the same as counting it half a time, and a game
   * of weight 2 counts exactly as that game listed twice. It is how an old result is made to
   * matter less than a recent one without being thrown away.
   *
   * Because the ridge is denominated in games and stays a constant, halving every weight halves
   * the evidence and doubles how far everything regresses toward the mean. That is arithmetically
   * right and never what anybody means, so a scheme that sets these normalises them to average
   * one — see `ratingRecency.ts`.
   *
   * It changes the *fit* and nothing else. Games played, own average margin and strength of
   * schedule are descriptions of a season rather than beliefs about a team: a side played twelve
   * games whatever the fit leans on, and saying otherwise in a table would be a lie about the
   * record.
   */
  weight?: number;
};

export type OpponentAdjustedRatings = {
  /** Opponent-adjusted rating in run units: expected margin vs a league-average team. */
  ratings: Map<string, number>;
  /** Own average capped run margin per game (before opponent adjustment). */
  rawMargin: Map<string, number>;
  /**
   * Average opponent strength faced, seen from this team's seat — a run-denominated strength of
   * schedule. Playing up counts the opponent as `ageGapRuns` per year stronger, playing down as
   * that much weaker.
   */
  strengthOfSchedule: Map<string, number>;
  /** Games played, per team. */
  games: Map<string, number>;
  /** Estimated additive home-field advantage in runs (shrunk toward 0). */
  homeAdvantage: number;
  /** The per-game margin cap that was applied. */
  cap: number;
  /** Fitted runs per year of age gap: prior + what the data added. */
  ageGapRuns: number;
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
  /** Prior runs of advantage per year of age; default AGE_GAP_RUNS_PER_YEAR. */
  ageGapPrior?: number;
  /** Ridge strength pulling the fitted age gap toward the prior; default DEFAULT_AGE_GAP_SHRINKAGE. */
  ageGapShrinkage?: number;
  /**
   * "dense" (Gaussian elimination, current), "sparse" (conjugate gradient), "auto" (sparse above
   * SPARSE_SOLVER_THRESHOLD teams). Default "auto".
   */
  solver?: "dense" | "sparse" | "auto";
};

/**
 * Expected runs of advantage per year of age between the two sides, before any data. Two runs a
 * year is the rule of thumb a coach uses when a team plays up a level, and it is what the
 * cross-age fit is pulled back toward.
 */
export const AGE_GAP_RUNS_PER_YEAR = 2;
/**
 * Ridge strength on the age-gap correction. Deliberately heavier than the per-team shrinkage: a
 * year of age is one number for the whole pool, and a single 8U-versus-9U blowout should barely
 * move it, while a season of cross-age games can.
 */
export const DEFAULT_AGE_GAP_SHRINKAGE = 6;
/**
 * Team count above which "auto" switches from Gaussian elimination to conjugate gradient. Below
 * it the dense solve is instant and bit-for-bit what the rankings have always shown; above it the
 * n³ elimination is the slow part of building a page.
 */
export const SPARSE_SOLVER_THRESHOLD = 150;

const DEFAULT_CAP = 8;
const DEFAULT_SHRINKAGE = 1.5;
const DEFAULT_HOME_FIELD_SHRINKAGE = 3;

/**
 * Conjugate gradient stops once the residual is this small relative to the right-hand side. With
 * a ridge term of at least ~1 on every diagonal, the rating error is bounded by the residual, so
 * this keeps the sparse answer within ~1e-8 runs of the dense one — invisible at the two decimals a
 * table shows and far inside the 1e-6 the tests demand.
 */
const CG_RELATIVE_TOLERANCE = 1e-10;
/**
 * In exact arithmetic conjugate gradient finishes in as many steps as there are unknowns, and
 * with the diagonal preconditioner it needs a small fraction of that here; the cap only exists so
 * a system nobody anticipated ends rather than spins.
 */
const CG_MAX_ITERATIONS_PER_UNKNOWN = 20;

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

/** One row of a sparse symmetric matrix: column index → value, only the non-zeros. */
type SparseRow = Map<number, number>;

const dot = (u: Float64Array, v: Float64Array): number => {
  let sum = 0;
  for (let i = 0; i < u.length; i += 1) sum += u[i]! * v[i]!;
  return sum;
};

// Solve the symmetric positive-definite system A x = b by preconditioned conjugate gradient, with
// A held as sparse rows. The preconditioner is A's own diagonal: the home-field and age-gap rows
// touch every game and so are hundreds of times heavier than a team's row, and without rescaling
// that spread is what conjugate gradient would spend most of its iterations on. Positive
// definiteness is the caller's job — it holds once a ridge term sits on every diagonal.
const solveSparseSystem = (rows: SparseRow[], vector: number[]): number[] => {
  const size = vector.length;
  const x = new Float64Array(size);
  const residual = Float64Array.from(vector);
  const rhsNorm = Math.sqrt(dot(residual, residual));
  if (rhsNorm === 0) return Array.from(x);

  const inverseDiagonal = new Float64Array(size);
  rows.forEach((row, i) => {
    const diagonal = row.get(i) ?? 0;
    inverseDiagonal[i] = diagonal > 0 ? 1 / diagonal : 1;
  });

  const preconditioned = new Float64Array(size);
  const direction = new Float64Array(size);
  const product = new Float64Array(size);
  for (let i = 0; i < size; i += 1) {
    preconditioned[i] = residual[i]! * inverseDiagonal[i]!;
    direction[i] = preconditioned[i]!;
  }
  let residualDot = dot(residual, preconditioned);

  const tolerance = CG_RELATIVE_TOLERANCE * rhsNorm;
  const maxIterations = CG_MAX_ITERATIONS_PER_UNKNOWN * size + 100;
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    if (Math.sqrt(dot(residual, residual)) <= tolerance) break;

    for (let i = 0; i < size; i += 1) {
      let sum = 0;
      rows[i]!.forEach((value, j) => {
        sum += value * direction[j]!;
      });
      product[i] = sum;
    }
    const curvature = dot(direction, product);
    // Zero or negative curvature means the matrix is not positive definite after all (a ridge
    // term of 0 somewhere); the best answer available is the one reached so far.
    if (!(curvature > 0)) break;

    const step = residualDot / curvature;
    for (let i = 0; i < size; i += 1) {
      x[i]! += step * direction[i]!;
      residual[i]! -= step * product[i]!;
      preconditioned[i] = residual[i]! * inverseDiagonal[i]!;
    }
    const nextResidualDot = dot(residual, preconditioned);
    const conjugation = nextResidualDot / residualDot;
    for (let i = 0; i < size; i += 1) {
      direction[i] = preconditioned[i]! + conjugation * direction[i]!;
    }
    residualDot = nextResidualDot;
  }

  return Array.from(x);
};

/**
 * The normal equations A x = b being accumulated, behind the two storage schemes. Every call is
 * `A[i][j] += value` or `b[i] += value`, so the dense scheme performs exactly the additions the
 * original single-solver code did, in the same order — which is what keeps its results identical.
 */
type NormalEquations = {
  add: (i: number, j: number, value: number) => void;
  addRhs: (i: number, value: number) => void;
  solve: () => number[];
};

const denseNormalEquations = (size: number): NormalEquations => {
  const a: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  const rhs = new Array<number>(size).fill(0);
  return {
    add: (i, j, value) => {
      a[i]![j]! += value;
    },
    addRhs: (i, value) => {
      rhs[i]! += value;
    },
    solve: () => solveLinearSystem(a, rhs),
  };
};

const sparseNormalEquations = (size: number): NormalEquations => {
  const rows: SparseRow[] = Array.from({ length: size }, () => new Map<number, number>());
  const rhs = new Array<number>(size).fill(0);
  return {
    add: (i, j, value) => {
      // A neutral game's home-field entries and a same-level game's age-gap entries are zeros;
      // storing them would only make the home-field and age-gap rows dense for nothing.
      if (value === 0) return;
      const row = rows[i]!;
      row.set(j, (row.get(j) ?? 0) + value);
    },
    addRhs: (i, value) => {
      rhs[i]! += value;
    },
    solve: () => solveSparseSystem(rows, rhs),
  };
};

/**
 * Opponent-adjusted power ratings via ridge-regularized least squares (a Massey rating) on capped
 * per-game run margins, with an estimated home-field term and an age-gap term for games played
 * across levels — the model described at the top of this file. Teams the `games` mention but
 * `teamIds` does not are ignored, as are games with a side missing from `teamIds`.
 */
export const buildOpponentAdjustedRatings = (
  teamIds: string[],
  games: RatingGame[],
  options: OpponentAdjustedOptions = {}
): OpponentAdjustedRatings => {
  const cap = options.cap ?? DEFAULT_CAP;
  const shrinkage = options.shrinkage ?? DEFAULT_SHRINKAGE;
  const homeFieldShrinkage = options.homeFieldShrinkage ?? DEFAULT_HOME_FIELD_SHRINKAGE;
  const ageGapPrior = options.ageGapPrior ?? AGE_GAP_RUNS_PER_YEAR;
  const ageGapShrinkage = options.ageGapShrinkage ?? DEFAULT_AGE_GAP_SHRINKAGE;
  const solver = options.solver ?? "auto";

  const ratings = new Map<string, number>();
  const rawMarginSum = new Map<string, number>();
  const gameCount = new Map<string, number>();
  // Per team, each opponent faced together with the age gap from this team's seat
  // (opponent's level minus own level), so strength of schedule can be read off after the fit.
  const faced = new Map<string, Array<{ opponent: string; seatGap: number }>>();
  teamIds.forEach((id) => {
    ratings.set(id, 0);
    rawMarginSum.set(id, 0);
    gameCount.set(id, 0);
    faced.set(id, []);
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
      ageGapRuns: ageGapPrior,
    };
  }

  // Parameters: n team ratings, the home-field term (index n), the age-gap correction δ (n + 1).
  const size = n + 2;
  const hfa = n;
  const delta = n + 1;
  const useSparse = solver === "sparse" || (solver === "auto" && n > SPARSE_SOLVER_THRESHOLD);
  const system = useSparse ? sparseNormalEquations(size) : denseNormalEquations(size);

  games.forEach((game) => {
    const h = index.get(game.home);
    const w = index.get(game.away);
    if (h === undefined || w === undefined) return;
    // A negative or unreadable weight is not a smaller opinion, it is a wrong one; 0 drops the
    // game from the fit while leaving it in the record, which is a thing a caller may want.
    const weight =
      game.weight === undefined || !Number.isFinite(game.weight) || game.weight < 0
        ? 1
        : game.weight;
    const margin = clamp(game.homeMargin, -cap, cap);
    const gap = game.ageGap !== undefined && Number.isFinite(game.ageGap) ? game.ageGap : 0;
    // The prior's share of the gap is taken off the margin before the fit; only what is left
    // over is evidence about the teams (and about δ, the correction to that prior).
    const y = gap ? margin - gap * ageGapPrior : margin;

    // Row vector c: +1 at home, −1 at away, `hf` at HFA — 1 for a real home game, 0 when the game
    // was neutral — and the age gap at δ when there is one. Contributes c·cᵀ to A and c·y to b.
    const hf = game.neutral ? 0 : 1;
    const row: Array<[number, number]> = [
      [h, 1],
      [w, -1],
      [hfa, hf],
    ];
    if (gap) row.push([delta, gap]);
    row.forEach(([i, ci]) => {
      row.forEach(([j, cj]) => system.add(i, j, weight * ci * cj));
      system.addRhs(i, weight * ci * y);
    });

    rawMarginSum.set(game.home, (rawMarginSum.get(game.home) ?? 0) + margin);
    rawMarginSum.set(game.away, (rawMarginSum.get(game.away) ?? 0) - margin);
    gameCount.set(game.home, (gameCount.get(game.home) ?? 0) + 1);
    gameCount.set(game.away, (gameCount.get(game.away) ?? 0) + 1);
    faced.get(game.home)?.push({ opponent: game.away, seatGap: -gap });
    faced.get(game.away)?.push({ opponent: game.home, seatGap: gap });
  });

  /*
   * Ridge regularization: shrink team ratings toward 0 (league mean), the HFA toward 0, and the
   * age-gap correction toward 0 — that is, the fitted runs per year toward the prior.
   *
   * A plain constant, not scaled by anything the weights do. `shrinkage` is denominated in games —
   * "acts like this many virtual games against a league-average opponent" — and a game of weight 2
   * is two games, so the ridge that means "two virtual games" is the same number either way. That
   * is what keeps a weight a count rather than a knob.
   *
   * It does mean a caller who halves every weight has halved its evidence and will be regressed
   * twice as far for it, which is correct and is also never what a caller wants: a weighting
   * scheme is about which games count *more than others*, not about counting less overall. So the
   * schemes in `ratingRecency.ts` normalise to a mean weight of one, and the scale never moves.
   */
  for (let i = 0; i < n; i += 1) system.add(i, i, shrinkage);
  system.add(hfa, hfa, homeFieldShrinkage);
  system.add(delta, delta, ageGapShrinkage);

  const solution = system.solve();
  teamIds.forEach((id, i) => ratings.set(id, solution[i] ?? 0));
  const homeAdvantage = solution[hfa] ?? 0;
  const ageGapRuns = ageGapPrior + (solution[delta] ?? 0);

  const rawMargin = new Map<string, number>();
  const strengthOfSchedule = new Map<string, number>();
  teamIds.forEach((id) => {
    const played = gameCount.get(id) ?? 0;
    rawMargin.set(id, played ? (rawMarginSum.get(id) ?? 0) / played : 0);
    const opponents = faced.get(id) ?? [];
    strengthOfSchedule.set(
      id,
      opponents.length
        ? opponents.reduce((sum, { opponent, seatGap }) => {
            const rating = ratings.get(opponent) ?? 0;
            // An older opponent is worth `ageGapRuns` more per year from this seat, a younger
            // one that much less; a same-level opponent is worth exactly its rating.
            return sum + (seatGap ? rating + ageGapRuns * seatGap : rating);
          }, 0) / opponents.length
        : 0
    );
  });

  return {
    ratings,
    rawMargin,
    strengthOfSchedule,
    games: gameCount,
    homeAdvantage,
    cap,
    ageGapRuns,
  };
};
