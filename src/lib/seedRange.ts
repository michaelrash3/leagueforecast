/**
 * The finishes a team lands in at least eight simulated seasons in ten (2.10): from the seed where
 * the best tenth of its seasons ends to the seed where the worst tenth begins, read off the season
 * simulation's seed distribution (`BracketOddsResult.seedDistribution`, a share for each seed in
 * order). A season outcome given as a range rather than one projected place, since a place is the
 * likeliest of many and a team can be in one place's lead by a hair. Null for a team the
 * simulation placed nowhere, which no seed ever gets past the best tenth of.
 */
export const likelySeeds = (
  distribution: readonly number[]
): { best: number; worst: number } | null => {
  const total = distribution.reduce((sum, share) => sum + share, 0);
  let cumulative = 0;
  let best: number | null = null;
  let worst: number | null = null;
  distribution.forEach((share, index) => {
    cumulative += share;
    // A hair over a tenth, so a share of exactly a tenth at the top is the tail left out.
    if (best === null && cumulative > total * 0.1 + 1e-9) best = index + 1;
    if (worst === null && cumulative >= total * 0.9 - 1e-9) worst = index + 1;
  });
  return best !== null && worst !== null ? { best, worst } : null;
};
