# Data Calculation Audit (Strength of Schedule, TPI, Projections, Spreads)

## Scope reviewed
- `calculateTeams`, `predictGame`, `applyResult`, `projectStandings`, and `simulateGoldOdds` in `src/lib/sim.ts`
- spread/explanation helpers in `src/lib/predictionText.ts`
- BIP helper in `src/lib/gameMetrics.ts`

## Overall assessment
The model is coherent and deterministic, but several calculations mix useful heuristics with statistical shortcuts that can produce biased outputs (especially in small samples and high-SOS imbalance schedules). The biggest issues are: (1) SOS circularity, (2) projected table updates using stale/partial team-strength signals, (3) spread formatting detached from implied win probability calibration, and (4) uncertainty treatment that is threshold-based rather than distribution-based.

## Detailed critique

### 1) Strength of Schedule (SOS)
Current SOS is computed as average opponent **baseTpi** over games played and then added to TPI as `+ 0.2 * sos`.

Concerns:
- **Circular dependence**: opponent baseTpi itself includes run differential and win% from games that include the team being evaluated; this can inflate/deflate SOS for closed pools.
- **No recency or opponent-game weighting controls**: all games count equally; early outliers persist.
- **No schedule normalization for home/away context**: away/home K-context is used elsewhere but not in SOS itself.

Recommendation:
- Use an iterative/leave-one-opponent-out rating loop (e.g., 3-5 fixed-point iterations) or a simpler adjusted opponent win% that removes games vs the team in question.
- Optionally track both **current SOS** (played) and **remaining SOS** with same rating basis to avoid metric drift between views.

### 2) TPI (team power index)
`baseTpi = diffPerGame + 2*pct + contactBonus`, then `tpi = baseTpi + 0.2*sos`.

Concerns:
- **Component scaling mismatch**: run differential per game is clipped `[-8,8]`, pct contribution is `[0,2]`, and contact bonus clipped `[-1.25,1.25]`; this means run differential dominates most of the dynamic range.
- **Implicit double counting of prevention/strikeout effects**: run differential already captures performance; adding contact bonus may re-introduce pitcher-contact influence without explicit calibration.
- **Potential volatility in short schedules** despite some smoothing on leagueK6 baseline.

Recommendation:
- Standardize each component (z-score by league, shrink toward mean by games played), then combine with explicit weights that can be tuned and validated.
- Add minimum-games shrinkage for runDiff and pct contributions.

### 3) Projections and simulation engine
Deterministic projection uses `predictGame` once per game and applies only winner path. Simulation samples winner Bernoulli from awayWinPct but reuses static baseline team ratings.

Concerns:
- **State non-updating in win probabilities**: during simulation, each game probability is recalculated from original `teams`, not evolving `simTeams`, reducing path dependency realism.
- **applyResult refreshes baseTpi without contactBonus recomputation**, causing projected ranking tie-break signal inconsistency vs observed-season computation.
- **No score variance model**: spreads/scores are point estimates then corrected for winner consistency.

Recommendation:
- In simulation, compute probabilities from current simulated state (`simTeams`) or blend static+dynamic state for stability.
- Recompute full TPI feature set (including contact/momentum with shrinkage) for projected updates, or separate projection rating from descriptive-season TPI.
- Use a simple distributional score model (e.g., Poisson/Skellam or normal margin model) and derive both winner probability and expected margin from same latent process.

### 4) Spreads / run line output
`projectedRunLine` maps rounded score margin to a half-run line: `max(0.5, rawMargin - 0.5)`.

Concerns:
- **Not probability-calibrated**: run line is derived from rounded score margin, not from a market-like distribution or confidence interval.
- **Discrete artifacts**: rounding scores can produce unstable spread shifts on tiny model changes.
- **Communication risk**: output can look betting-precise while narrative warns not to read as literal score.

Recommendation:
- Derive spread from expected margin on unrounded latent scores; optionally include a confidence band or “model edge” metric.
- Keep rounded score display as UX, but separate from spread math.

### 5) Confidence labels
Current confidence is thresholded by (games played, margin, winnerPct).

Concerns:
- **Hard cliffs**: small changes around thresholds flip labels abruptly.
- **No calibration check**: “High/Medium/Low” not tied to historical Brier/log-loss bins.

Recommendation:
- Replace with calibrated bins from backtest reliability curves or continuous uncertainty score mapped to labels.

## Priority fixes (highest impact first)
1. Make simulation probabilities state-aware (`simTeams`) and verify runtime cost.
2. Refactor TPI into standardized weighted components with shrinkage by games played.
3. Redefine spread from latent expected margin (pre-rounding), not displayed rounded scores.
4. Rework confidence labels using empirical calibration bins.
5. Add metric validation tests: monotonicity, invariance checks, and regression snapshots.

## Validation plan
- Backtest on prior season snapshots: Brier score, calibration curves, rank correlation for final standings.
- Ablation: remove each TPI component and measure predictive delta.
- Stress tests: extreme early-season sparse data; unbalanced schedule; outlier run-diff teams.
