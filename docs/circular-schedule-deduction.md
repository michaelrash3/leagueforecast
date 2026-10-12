# Circular-schedule deduction

The ranked rating loses up to **one point** when opponents' other games mostly
recycle the team's usual opponent circle. Teams stay in the same rankings.
The fitted best guess remains available, and the full table and club explanation
show the schedule deduction separately from the existing record-confidence adjustment.

For a team A, inspect each opponent B's games against sides other than A. Compute
the share of their recency weight against A's other opponents. Average that share
over A's own recency-weighted games, then multiply by the one-point cap. Additional
internal games do not open the circle. Outside games gradually reduce the deduction,
including outside games played by B without A participating.

Require A to have six counted games against at least three distinct opponents.
An opponent contributes evidence only with three other games against at least two
sides. Opponents marked `nameOnly` or `placeholder` cannot establish a closed schedule;
missing coverage contributes no deduction. This is an observed two-step overlap
measure. It can miss larger isolated networks with little immediate overlap,
and it does not infer official league membership.

Both the direct rankings and the cached year fit use the same calculation. The
completed-game selection and recency weights come from the existing fit. Board
rules rise from 5 to 6 so an older publisher cannot overwrite the new rankings.
The optional row field reads alongside older boards. Game-by-game explanations
hold the schedule deduction fixed while describing score and record effects.

## Actual-season check

The local audit fetched all 4,812 initially eligible Kentucky entries and 1,000
hash-selected entries elsewhere from the supplied CSV: 5,812 schedules and 74,390
normalized game rows. After import and tidy, the 2026 fit contains 35,104 eligible
games and 2,044 ranked clubs. This is a limited cohort with incomplete opponent
coverage, not the production national pool.

The comparison uses identical chronological training sets and the app's displayed
matchup probabilities, on same-age table teams in the same training component:

| Training cut  | Decisive test games | Brier before | Brier after |
| ------------- | ------------------: | -----------: | ----------: |
| June 13, 2026 |               1,255 |     0.199525 |    0.199680 |
| May 31, 2026  |               1,443 |     0.208845 |    0.208429 |
| June 28, 2026 |                 813 |     0.191838 |    0.191582 |

Lower Brier is better. Changes are small and mixed; this cohort does not establish
a forecast-accuracy improvement. It checks that the modest ranking policy does
not produce a large change in these predictions. The cuts overlap and their games
are not independent samples. Identities come from the retrospectively reconciled
season pool; no held-out scores enter the deduction.

The full-cohort deduction calculation took approximately 55 ms in Node 24 on the
cloud machine. Regression cases cover round-robin circles, broader schedules,
gradual relief, recency, incomplete coverage, import ordering, and both rating paths.
