# Circular-schedule deduction (superseded)

Board rules 6 took up to one rating point off a club whose opponents' other games mostly stayed
inside the club's own circle of opponents. Board rules 7 removed it, on 17 October 2026, for a
starting level per league of the schedule: README, Ratings, **Where a rating starts**, and
`src/lib/scheduleCommunities.ts`.

Why it went, measured on the owner's backup of 11 October 2026 (the 2027 year, 222,010 rated
games), fitted on the boards of 1, 8 and 15 September and checked on the 59,405 games after 22
September:

- On the later games as a whole it did nothing measurable: taking it off alone changed their
  squared error by +0.010 ± 0.009 runs². Over all six weekly windows from 1 September, of the
  2,885 appearances of weakly connected clubs against well-connected ones, 2,540 carried no
  deduction: an opponent known only from someone else's schedule could not close a circle, so a
  club among such opponents was never touched.
- It could not reach the size of the error. Island clubs did 1.66 runs worse than shown against
  well-connected opponents on those later games (1,108 appearances); the deduction was capped at
  one point and was mostly zero.
- Its replacement lowered the later games' squared error by 0.095 ± 0.022 runs² and, with the
  starting level in, keeping the deduction as well would have lowered it by only a further
  0.014 ± 0.009, which is not significant.

What it did help a little: between clubs of two well-connected leagues, taking it off alone cost
0.062 ± 0.027 runs² on 6,244 later games. With the starting level in, those games end 0.031 ±
0.031 worse than under the deduction, an interval that includes no change.

It also held places on the boards. On the 11 October year boards, taking it off alone changed
26 of the 548 state #1s, 16 of them among the 276 held by clubs of leagues with 31 or more
outside games, and left those clubs 177 of their 186 national top-25 places. Under board rules 7
they keep 184 of the 186, and 13 of those 276 #1s change; 10 of the 13 are among the 16 that
taking the deduction off changes, and the starting level decides the other 3. The starting level
with the deduction kept (and fitted with it, at −1.65) would have changed 5.

The first evaluation, on a 2026 cohort of 5,812 schedules, is in this file's history.
