# Circular-schedule deduction (superseded)

Board rules 6 took up to one rating point off a club whose opponents' other games mostly stayed
inside the club's own circle of opponents. Board rules 7 removed it, on 17 October 2026, for a
starting level per league of the schedule: README, Ratings, **Where a rating starts**, and
`src/lib/scheduleCommunities.ts`.

Why it went, measured on the owner's backup of 11 October 2026 (the 2027 year, 222,010 rated
games), fitted on the boards of 1, 8 and 15 September and checked on the 59,405 games after 22
September:

- It did nothing measurable. Taking it off alone changed the later games' squared error by
  +0.010 ± 0.009 runs². Of the 2,885 appearances of weakly connected clubs against well-connected
  ones, 2,540 carried no deduction: an opponent known only from someone else's schedule could
  not close a circle, so a club among such opponents was never touched.
- It could not reach the size of the error. Island clubs did 1.54 runs worse than shown against
  well-connected opponents; the deduction was capped at one point and was mostly zero.
- Its replacement lowered the later games' squared error by 0.095 ± 0.022 runs² and, with the
  starting level in, keeping the deduction as well would have lowered it by only a further
  0.014 ± 0.009, which is not significant.

What it did help a little: between clubs of two well-connected leagues, taking it off alone cost
0.062 ± 0.027 runs² on 6,244 later games. With the starting level in, those games end 0.031 ±
0.031 worse than under the deduction, an interval that includes no change.

The first evaluation, on a 2026 cohort of 5,812 schedules, is in this file's history.
