export type ProbabilityInterval = {
  estimate: number;
  lower: number;
  upper: number;
  margin: number;
};

const clampProbability = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Wilson score interval for a binomial proportion.
 * Accepts probabilities on the 0-1 scale and returns 0-1 bounds.
 */
export const wilsonScoreInterval = (
  estimate: number,
  samples: number,
  zScore = 1.96
): ProbabilityInterval => {
  const p = clampProbability(estimate);
  if (!Number.isFinite(samples) || samples <= 0) {
    return { estimate: p, lower: p, upper: p, margin: 0 };
  }

  const n = Math.max(1, Math.round(samples));
  const z2 = zScore ** 2;
  const denominator = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denominator;
  const spread = (zScore * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n ** 2))) / denominator;
  const lower = clampProbability(center - spread);
  const upper = clampProbability(center + spread);

  return {
    estimate: p,
    lower,
    upper,
    margin: Math.max(p - lower, upper - p),
  };
};

export const formatProbabilityMargin = (margin: number) => {
  if (!Number.isFinite(margin) || margin <= 0) return "±0%";
  return `±${Math.max(1, Math.ceil(margin * 100))}%`;
};

/**
 * The point below which a standard normal draw falls with probability `p`: the inverse of its
 * cumulative distribution, by Acklam's rational approximation (relative error under 1.2e-9 over
 * the whole open interval). Infinite at 0 and 1, NaN outside them.
 */
export const normalQuantile = (p: number): number => {
  if (Number.isNaN(p) || p < 0 || p > 1) return Number.NaN;
  if (p === 0) return -Infinity;
  if (p === 1) return Infinity;
  const tail = 0.02425;
  if (p < tail || p > 1 - tail) {
    const q = Math.sqrt(-2 * Math.log(p < tail ? p : 1 - p));
    const x =
      (((((-7.784894002430293e-3 * q - 3.223964580411365e-1) * q - 2.400758277161838) * q -
        2.549732539343734) *
        q +
        4.374664141464968) *
        q +
        2.938163982698783) /
      ((((7.784695709041462e-3 * q + 3.224671290700398e-1) * q + 2.445134137142996) * q +
        3.754408661907416) *
        q +
        1);
    return p < tail ? x : -x;
  }
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((-3.969683028665376e1 * r + 2.209460984245205e2) * r - 2.759285104469687e2) * r +
      1.38357751867269e2) *
      r -
      3.066479806614716e1) *
      r +
      2.506628277459239) *
      q) /
    (((((-5.447609879822406e1 * r + 1.615858368580409e2) * r - 1.556989798598866e2) * r +
      6.680131188771972e1) *
      r -
      1.328068155288572e1) *
      r +
      1)
  );
};

/**
 * The chance a standard normal draw falls below `x`, through the complementary error function's
 * Chebyshev fit (fractional error under 1.2e-7, Numerical Recipes' `erfcc`).
 */
export const normalCdf = (x: number): number => {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.5 * z);
  const tail =
    (t *
      Math.exp(
        -z * z -
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
      )) /
    2;
  return x >= 0 ? 1 - tail : tail;
};
