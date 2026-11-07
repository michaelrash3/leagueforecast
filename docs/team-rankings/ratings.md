# States, and the ratings a forecast reads

_Part of the design documents; the map is in the repository's [README](../../README.md)._

## States

A team can carry a two-letter state, and the rankings can be narrowed to one — or
to the teams whose state is not set yet. Set it on the team panel, or let an
import fill it in: `Home State` / `Away State` on a game list, `State` on a
schedule. An imported state never overwrites one already there.

Filtering is presentational. Ratings come from every game regardless, so a
filtered table renumbers but keeps each row's place in the full table alongside.

## The rating in a forecast

Every game pick blends two views. The league's own per-game stats — runs scored
and allowed, walks, hits, errors, strikeouts, recent form — and the
opponent-adjusted rating, which is the only number that knows _who_ a team
played, and which counts tournament results where Team Rankings is switched on.

How far it leans on the rating depends on how many games that rating rests on:
0.40 with none, 0.52 at one game, 0.70 at four, 0.80 at eight. The floor is not
zero because a rating of 0 means "league average", which is a better guess than
a record built from a single game. The count is of _rated_ games, league plus
tournament, so a team with two league games and five tournament results is
trusted like the known quantity it is.

That the rating deserves most of the weight was measured, not assumed: 400
simulated leagues per case with known true team strengths, swept over the weight,
walk-forward so no pick ever saw its own result. Every measure improved the
further the pick leaned on the rating, in all six schedule-by-pitch-mode cases.
The reason is spread rather than direction — the stats model's expected margin
swings about twice as wide as real margins do, while the rating's is about right.

Measured on the shipped code, 200 leagues a case, against the same code with the
rating withheld:

| Schedule                   | Pitch   | Brier           | Winner accuracy | Margin error, runs |
| -------------------------- | ------- | --------------- | --------------- | ------------------ |
| Balanced                   | player  | 0.2377 → 0.2267 | 63.2% → 63.7%   | 3.82 → 3.66        |
| Balanced                   | machine | 0.2275 → 0.2255 | 63.6% → 63.7%   | 4.22 → 3.71        |
| Unbalanced                 | player  | 0.2376 → 0.2268 | 62.5% → 63.0%   | 3.89 → 3.70        |
| Unbalanced                 | machine | 0.2282 → 0.2258 | 62.5% → 63.0%   | 4.32 → 3.74        |
| Unbalanced + Team Rankings | player  | 0.2376 → 0.2243 | 62.5% → 64.1%   | 3.89 → 3.64        |
| Unbalanced + Team Rankings | machine | 0.2282 → 0.2234 | 62.5% → 63.9%   | 4.32 → 3.67        |

The last two rows are the point of the bridge: the same unbalanced schedule, with
the tournament results counted, picks about a point of accuracy more.

Two honest limits. The simulation draws margins the way the rating model assumes
they work, so it cannot tell you whether real baseball has structure the stats
model catches and the rating misses. And the walk-forward backtest reports a
floor rather than the shipped model's accuracy, because an outside result carries
no date and cannot be placed on the league's timeline without leaking the future.

A team the fit never rated carries no rating at all, and its forecast is exactly
the number it was before any of this existed.

**Measured on real games, the rating pulls harder and is fitted to real margins.**
The weight above says how much of a pick the rating gets; `RATING_EDGE_PER_RUN`
says how hard a run of rating pulls it, and the league's cap on run differential
used to bound the rating itself. Both were set on simulations: 0.25 a run, held
below the 0.43 that fitted best because overdispersed simulated scoring punished
anything higher, and the league's own cap of 8. The user ruled on 28 September
2026 that the cap is a standings rule the forecast need not follow, so both were
measured on the pool of 26 September instead. Every state's pulled clubs on a 2027
page (20 or more) made a pseudo-league; its games among themselves up to 13, 19 or
20 September were the season so far, the pool's other games touching those clubs
were the Team Rankings results a linked league is handed, and the 54,265 league
games after each cut were scored through the app's own engine and `predictGame`.

| Cap, weight         | Log loss with results | Without | Called ~75%, won |
| ------------------- | --------------------- | ------- | ---------------- |
| 8, 0.25 (as it was) | 0.6431                | 0.6484  | 90%              |
| 20, 0.25            | 0.6327                | 0.6394  | 85%              |
| 20, 0.43 (as it is) | 0.6230                | 0.6303  | 76%              |
| none, 0.43          | 0.6229                | 0.6303  | 76%              |

So the forecast's fit counts each game's margin up to 20 runs (`FORECAST_RUN_CAP`)
whatever the league's setting — twenty rather than none so a mistyped 91-1 is not a
ninety-run win — and the rating pulls at 0.43 a run. The standings, their
run-differential tiebreaker and the per-game stats model keep the league's cap. The
prediction engine's odds curve, the Dashboard's matchup odds when this was measured,
was refitted on the same games: a spread of 4.7 runs where it was 2.8 (log loss
0.6254 to 0.6188 with results), and 3.95 for machine and coach pitch, which is what
the 8U pages fitted. The Dashboard shows the per-game model's chance now (see "Why
the forecast says what it does"); the curve's own chance is read only by a card's
"Why" panel, to say when the margin and the chance shown part ways, and its spread
is how widely a simulated game's margin is drawn.

## Ratings

A rating estimates how many runs a team beats an average opponent by, adjusted
for opponent strength, capped at ±12 so one blowout cannot run away with a season.
Only completed games count; scheduled ones exist so a future opponent can be
logged early. A matchup's win probabilities (`predictMatchup`) are clamped to
8–92% — youth baseball has no locks — and read on a curve as wide as the two
clubs' evidence (`matchupOddsWidth`): narrower about two clubs that have proved what
they are, wider about two that have not.

Until teams share opponents, directly or through a chain, a rating is close to a
plain run differential.

**Where the twelve came from, and how to check it.** The case for _having_ a cap
is plain — without one a 20-0 against a weak club outweighs a season of close
wins against strong ones — but the case for _eight_, which the rating used until
the end of September 2026, was never made here. It was inherited from League Standings,
where the cap is a rule of the league (coach and machine pitch carry a
per-inning run limit), and applied flat from 8U to 18U even though the same
settings put player pitch at twelve. Setup's **Check the model** card sweeps it:
`compareRunCaps` refits the pool at four, six, eight, ten, twelve and sixteen
runs — and at no cap at all — and reports what each one predicted. The last row
is the one that asks whether _having_ a cap earns anything, rather than which
cap is best. On a pool whose margins all fit inside eight it ties every cap from
eight up, exactly as it must: a clamp that never reaches is not a clamp.

The sweep moves the fit's cap and holds the scoring target still, and that
separation is the whole reason the answer can be believed. One constant used to
do both jobs, so a smaller cap was a smaller error for nothing — the target
shrank under the model. Measured on four thousand realistic margins against a
model that cannot improve (it predicts zero every game), letting the target
follow the cap gives 2.25 runs at a cap of four rising to 2.95 uncapped, a clean
ordering that is pure artefact; pinned, that same model scores 2.605 at every
cap, as it must.

_Where_ it is pinned is a second choice, and a sweep with an open end cannot
make it freely: a target clipped at eight marks a wider candidate down for
swinging where the target has been flattened. Three sixteen-team pools, two
rounds each, the same hold-out, comparing a target pinned at eight against the
margin as played:

| truth                           | cap 8 → pinned / played | no cap → pinned / played |
| ------------------------------- | ----------------------- | ------------------------ |
| inside eight, no blowouts       | 0.894 / 0.894           | 0.892 / 0.892            |
| inside eight, 10% junk blowouts | 1.930 / 2.527           | 2.245 / 2.843            |
| genuinely spans past eight      | 2.517 / 5.231           | 2.760 / **1.091**        |

The pin changes no ordering on the first two — the same cap wins either way —
and inverts the third, where pinned at eight reads "no cap is worse than twelve"
and the margin as played has it beating everything by a factor of two. So the
sweep grades on the margin as played: still one target for every candidate,
which is the property that matters, and the least arbitrary one going, since the
margin is a fact and the cap is a choice. It reads higher in absolute terms than
the **Off by, on average** figure above it, which does clip at the cap, so the
rows are to be compared with each other rather than with that one. The
called-right column is the check on all of it — direction is clamped by
nothing — though it is the quieter signal, since direction is easy wherever two
sides are far apart.

The sweep and the win-chance curve together moved the cap to twelve. On the 9U
2027 pool of 27 September the sweep read twelve clearly better than eight
(below). Then, on the backup of 26 September tidied as the app tidies it, the
year was fitted as the board would have been on 13, 19 and 20 September and
scored on the decided games between ranked clubs after each (22,685, 17,064 and
8,155 of them): twelve with the curve refitted to it (`matchupOddsSpread`)
predicted them better than eight on its own curve at all three — log loss 0.6042
to 0.6012, 0.5980 to 0.5949 and 0.5864 to 0.5842 — and called the same share of
winners. Twelve on eight's curve read worse than either, so the two moved
together. About one game in three is decided by more than eight and one in eight
by more than twelve, so twelve still stops a rout counting in full; the move
kept 20 of the 9U top 25, and 201 of the 250 places in the ten pages' top 25s,
where no cap at all kept 13 and 147. The League Standings cap, which is a rule
rather than a guess, is untouched.

Run at twelve on the 9U page of 26 September, the card names nothing clearly
better: sixteen and no cap read 0.006 and 0.003 runs a game lower, inside the
noise, and eight 0.049 higher. Sixteen is in the sweep so that the cap in use has
a neighbour above it as well as below. The card is there so the number stays a
measurement rather than an inheritance.

The card names another cap only when it predicted the held-back games clearly
better than the one in use: paired game by game, since every row faces the same
games, lower on average by more than the bar its rivals share, over thirty games
or more (`pairedImprovement`). The lowest average alone is not enough — two
settings' errors on one game move together, so a gap in the averages is only an
answer once the pairing says how far it can be trusted. The standard error is
counted by club, since every game of a club leans on the one rating the fit gave
it, and never less than the games read as independent. The bar is two standard
errors for one rival and rises with the rivals tried, the chance that two leaves
split between them: 2.53 for the four age gaps and 2.67 for the six caps, as
four or six tries at one bar of two would give chance that many goes at naming
one. On the 9U 2027 pool of 27 September a cap of 12 read 0.050 runs a game
better than the eight then in use over 31,581 held-back games, 9.2 standard errors, and ten read
0.034, 10.9; no cap at all read 0.032 worse, well inside its own spread. That was
with the wins by more than thirty runs, one of them 9,999, still counted; with them
set aside, as they now are, no cap reads about as well as twelve (above).

### Recent form

Newer games pull harder: **half weight every 90 days**. A side that lost through
September and has been winning since is rated closer to the side it is now than
to the one it was.

This is how the systems League Forecast is modelled on do it. Massey's
least-squares ratings de-weight early-season games; Pomeroy's weight each game by
when it was played, with more weight the more recent, so a rating describes a
team _now_; and the Elo family gets there by construction, a recent result
moving the number further than an old one. None of them steps the weight at a
boundary inside the season, and neither does this. **The season is still the
season**: every age group sharing a squad year is still fitted as one pool, an
autumn game is still in the fit, and it simply counts for less than a spring one
by the time spring comes — about a third of a fresh game's weight after five
months, a quarter after six. A slope rather than a cliff.

Ninety days rather than thirty or sixty is because of the winter. Squad years
run August to July with a four-month gap in the middle, and a fast half-life
would make the autumn irrelevant by spring, which is a season split under
another name.

It changes the **fit and nothing else**. Games played, record and strength of
schedule are descriptions of a season rather than beliefs about a team, and a
side played twelve games whatever the fit leans on. Weights are normalised to
average one, so the ridge is handed the same total evidence and nothing is
regressed further toward the mean than it was before. The weights depend only on
the gaps between games, never on the clock, so a rating is a pure function of
the pool and two readings a week apart agree.

**What the evidence is.** `scripts/recencySweep.ts` fits a backup as the app
ranks it, after the app's own tidy, told the clubs the owner vouched for as the
device's tidy is (`scripts/sweepTidy.ts`), so no page of theirs is deleted for
a name that reads as no team: the clubs the backup says are real, and, from the
whole-browser backup (Settings, "Backup JSON"), every club a League Standings
team links, read off the seasons it carries beside the pool. A Team Rankings
file, JSON or CSV, carries no seasons, only their ids on its pages, so from one
a club only a League team links is not spared, and the sweep warns of that
whenever its tidy deleted a page for its name from a pool whose pages play in
League seasons. It was run against a
nationwide pool seven weeks into a squad year, the only backup small enough to
export. It could not put the cross-winter question, because that pool had no
winter in it. In season, at four nested cuts, the day-based schemes beat
counting every game the same on every one, and the games-since schemes were
indistinguishable from it — on a small hold-out, without the shuffled-calendar
null run to completion, so a direction rather than a finding. Practice and the
direction agree. The comparison is `compareRecencySchemes`, which the sweep runs;
Setup's **Check the model** card runs the plain backtest, the age-gap priors and
the run caps (`checkTheModel`), in the rankings worker a run at a time so the page
never waits on it. Changing the scheme is one line in `src/lib/ratingRecency.ts`: every candidate is in
`RECENCY_SCHEMES`, and `noDecay` restores exactly the behaviour that shipped
before weighting existed.

### Playing up and down

Fall tournaments routinely pair a team against the level above or below. Every
age group sharing a **season year** is therefore fitted as one pool, with each
game carrying the gap between the two sides: the older side is expected to win by
what a year of age is worth at those levels (`AGE_STEP_RUNS` in
`src/lib/powerRating.ts`): 5 runs from 8U to 9U, 4 from 9U to 10U, 3 a year from
10U to 15U, 2 from 15U to 16U and 1 a year from 16U up. A 9U losing by about four
to a 10U comes out even rather than punished. Strength of schedule is read from each team's own seat, so it
weighs heavier for the team playing up and lighter for the one playing down.

**A year of age is held, not fitted.** Until 27 September 2026 the fit started
from two runs and let the data correct it, and it read 0.85, 0.92, 0.97 and 1.02
as the 2027 season filled. That figure was the fit's, not the game's. Nearly every
club plays at one level (only 1,153 of 76,787 in the pool of 26 September appear
at a second), so moving every level's ratings by a steady amount and the gap by
the opposite fits the results just as well. The games cannot set the gap, and the
ridge pulling every rating toward average set it instead, low. Simulated on that
season's own schedule, the fit reads 0.81 to 1.05 when the truth is 1.75. Read
directly instead — each club rated on its same-level games alone, then each
one-year cross-age game between clubs with eight or more of those — a year is
worth 2.00 ± 0.24 runs.

Held at two, the ratings predict the games after a cut better at 7, 13 and 20
September. The app's own backtest scores the games between two clubs the fit had
rated 0.0075, 0.0078 and 0.0042 runs better. On every game it scores slightly
worse (at most 0.005): a game with a side the fit never saw is predicted by the
gap alone, a real 9U-10U game is closer than a year of age says because the young
clubs that play up are mostly strong ones, and the page never shows such a
prediction. On the 9U 2027 board of 26 September three of the top 25 change: The
Pack - Greene, Ct Cannons and HTX Wildcatters, who spent the fall playing 10Us,
come in, and three that padded against their own level or younger go out. Every
level's board moves some; 18U most (the largest top-100 move is 136 places), where
the one-year step read directly is smaller (0.34 ± 0.41 runs from 17U to 18U, on
278 games) and was not shown to be harmed or helped. Setup's model check holds the
pool at 1, 1.5, 2, 2.5 and 3 and names another value only when it predicted the
games between two rated clubs clearly better than two, by the same paired rule as
the caps. Since the table below, those values scale the whole table, 2 being the
table as it is, and the card words them as a share of it (1.5 is "75% of those
values"). On the pool of 27 September 1.5 read 0.0011 runs a game better over
21,986 such games, 1.1 standard errors, and the card had named it best on that
alone; 2.5 and 3 read clearly worse. All of that was measured with the rating
capped at eight. Run again with the cap at twelve, on the 9U page of 26
September, two still read best of the five (4.9810 runs a game on 21,967 games
between rated clubs, 1.5 a ten-thousandth behind) and the card named nothing.

**What a year is worth depends on the age** (11 October 2026). Two runs was one
reading pooled over every level. Read the same direct way on the pool of 11
October, level by level: 8U–9U 5.85 ± 1.01 runs (47 games), 9U–10U 4.16 ± 0.30
(385), 10U–11U 2.57 ± 0.39 (236), 11U–12U 2.91 ± 0.24 (610), 12U–13U 2.99 ± 0.58
(99), 13U–14U 3.28 ± 0.44 (169), 14U–15U 4.18 ± 0.77 (39), 15U–16U 2.12 ± 0.44
(178), and nothing above that (16U–17U −1.48 ± 1.16 on 29 games, 17U–18U −0.97 ±
0.66 on 87). So a 9U that played a 10U was charged for a gap half as big as the
one it faced. The table rounds those readings, holding the thin top levels at one.
For predicting games it is no better than two everywhere: cut in September and
scored on what came after, the error over every held-back game was 5.1849 runs
against 5.1832, and on the 490 held back between 9U and 10U clubs 4.82 against
4.80, since a club that plays up is rated partly on those very games. It is in
because the board should rank a young club against its own age: on two runs a
year, the 9U Otters went from first in Kentucky to third on two losses to 10U
sides, behind clubs of 8-0 and 7-0 against weak schedules; with the table they are
second, 0.04 behind the first. Losses still count; what changes is how much a year
of age is expected to explain. The boards' rules went to 4 with it
(`BOARD_RULES`), so the republish after the deploy rebuilds every board, and
the boards' fit to version 2 (`BOARD_FIT_VERSION`), so a device still on an
older build leaves the new fits alone rather than working each game out with
the old gap.

**Pooling the fit is not pooling the tables.** Each level lists only its own
teams — a 9U that beats an 11U in a tournament stays on the 9U page, and the 11U
page never shows it. What the pool changes is that the game counts for both of
them rather than being discarded or counted as if they were the same age.

A team is listed on the page for the level it actually plays at: its GameChanger
level where that is known, otherwise the level recorded on most of its games. So
a 10U that spent the year playing down is rated alongside the 9Us it played and
listed on the 10U page — which is also why its panel counts the whole pool, or it
would read 0-0 beneath a row saying otherwise.

With no cross-age games in a pool, the arithmetic is exactly what it was before.

Only 9U and up get a table. 8U results are kept as evidence about the 9U teams
that played down against them, but at that age the results say more about which
league is machine pitch than about the teams.

Above 150 teams the fit switches from Gaussian elimination to conjugate gradient,
which is what makes a nationwide pool solvable at all; the two agree to within
1e-6 on a 300-team graph. It runs in a Web Worker, so the page does not lock up
while it refits — the table keeps the last true answer and says it is refitting.

The **?** beside "Full rankings" explains all of this in the app, with the
constants read from the code so the explanation cannot drift from the maths.

A game can also be logged but kept out of the maths — **Don't count** on a
logged game. Fall tournaments routinely pair a team against the age group above
or below, and those results say nothing about how it stacks up inside its own.
A team whose games here are all scheduled, or all set not to count, is not
ranked at all rather than shown at 0-0 · +0.0.

Nor does a game count that a club's schedule lists against the club's own name
(`playsItself`): a scrimmage of its own squad, or a namesake the import could not
tell from it. It says nothing about the club against anyone else, and counted,
one 6-4 read as two wins and two games from the club's two seats. On the pool of
26 September 2026, 55 such games were scored in the squad year on 37 clubs; of the
35 with one GameChanger link and its record, the double count matched
GameChanger's for none, counting once matched 9 and leaving out 14, and leaving
out was the nearer for 21 clubs against 13. The team panel still lists the game,
and says why it is not in the record.

### Where a rating starts

The fit counts 1.5 virtual games for every club against an average opponent: the
ridge that keeps a thin record from running away. Until board rules 7 those games
were played at 0.0, and that has a consequence no table shows. Summed over a piece
of the schedule that plays nobody outside it, the games cancel, so the piece's
ratings average exactly 0.0, the pool's average, whatever the piece is worth. A rec
league whose clubs only play each other then has an 8-0 club rated as high in its
state as an 8-0 travel club. The games inside a league say who is best in it, not
how good it is.

So each club's virtual games are played at its league's starting level
(`scheduleCommunities.ts`). A league is a community of the schedule, read off the
fit's rated games and nothing else: each piece off the largest is one league, kept
whole, and the largest piece is split by modularity (Louvain at resolution 20,
weighed against the whole year's games). Every node is visited in the roster's
order and every tie goes to the community a node is in, then to the lowest
numbered, using sums of counts only, so the communities come out the same on every
engine and whatever order the games are in. A league's outside games are its rated
games with exactly one side in it, and it starts at −1.6 / (1 + outside / 10) runs:
1.6 below average with none, 0.8 with ten, 0.15 with a hundred. A piece off the
largest then averages exactly −1.6, and a club's own games move it from where it
started as they always did. On the boards of 11 October 2026 the 2027 year held
4,900 communities. Of its 48,096 ranked clubs, 9,209 were on islands, and on the
largest piece 4,813 were in leagues with 1 to 10 outside games, 4,687 with 11 to 30
and 29,387 with more.

Measured on that backup (the 2027 year, 222,010 rated games), fitted on the boards
of 1, 8 and 15 September and checked on the games after 22 September:

- Against well-connected opponents, at equal shown rating, island clubs had done
  1.66 ± 0.22 runs worse than shown on the boards then published (1,108
  appearances), and clubs whose league had 1 to 10 outside games 1.15 to 1.63 worse
  (901). Over all six weekly windows from 1 September the same comparison reads 1.54
  for islands (1,624) and 0.8 to 1.4 for the rest (1,261).
- The starting level fitted on the early games was −1.60 ± 0.23 runs, and ten
  outside games halving it fitted best of 2, 3, 5, 10, 20 and 40. Resolution 5
  predicted the later games worse, and 50 no better than 20.
- On the 59,405 later games it lowered the squared error by 0.095 ± 0.022 runs²
  against the boards then published, and the Brier score of the win chance by
  0.00034 ± 0.00007. On the 7,448 where a weakly connected club (an island, or 10
  or fewer outside games) met an outsider, it lowered it by 0.72 ± 0.16 runs².
- On the 11 October year boards 60 of the 548 state #1s changed. Island #1s went
  from 156 to 126 and weakly connected ones from 217 to 181. The national top 25s
  kept 215 of their 250 places, and clubs from leagues with 31 or more outside
  games kept 184 of their 186; 13 of their 276 state #1s changed. 10 of those 13
  also change with only the old deduction taken off (below), and the starting level
  with the deduction kept, fitted with it at −1.65, would have changed 5.

What it cannot do:

- A strong group that has truly played nobody else is shown 1.6 runs below where
  its games alone would put it, as a weak one is. Only games against outsiders can
  tell the two apart, and Pool health's look lists the leaders of groups with fewer
  than 3 of them, with the opponents to find and pull (**Leaders with few outside
  games**, under **What a pull left behind**).
- The effect grew through the autumn: refitted on the later games the level reads
  −1.90 ± 0.20, so −1.6 is the cautious value, and after it the isolated clubs
  still did 0.5 to 0.9 runs worse than shown against well-connected ones. It is
  re-measured every week for that reason (below).
- It was measured on years of 38,589 games and more. On a pool far smaller, such as
  a few dozen clubs, the resolution finds no league at all: it joins two clubs of k
  games each only once the schedule holds about 10·k² games, some 1,200 for clubs of
  eleven. The largest piece is then kept whole, as an island is, so every piece
  starts at −1.6, every rating is the old fit's 1.6 lower, and the order and every
  margin between two clubs are as they were. Left a club apiece, each club's own
  games would have counted as its league's games outside itself, and of two closed
  leagues of twelve and eleven clubs the larger would have started 0.84 runs above
  the other. Where the
  resolution joins some of the largest piece's clubs and leaves others alone, those
  others still start by their own game count, a second discount for a thin record.
- Few leagues have played so much outside themselves that they start right at 0.0,
  so the average club on the largest piece now sits a little below it: the mean
  rating of its ranked clubs went from +0.13 to −0.07.

It replaced board rules 6's circular-schedule deduction, which measured as doing
little on the later games as a whole: taken off alone it changed their squared
error by +0.010 ± 0.009 runs², and with the starting level in, keeping it would
have lowered it by another 0.014 ± 0.009, which is not significant. It was not
nothing, though. Between clubs of two well-connected leagues, taking it off alone
cost 0.062 ± 0.027 runs² on 6,244 later games, and on the 11 October year boards it
changed 26 of the 548 state #1s, 16 of them well-connected clubs', and left
well-connected clubs 177 of their 186 national top-25 places. The starting level
wins most of that back: 184 of the 186 places, and 13 of those #1s changed. The communities take 1.2 to 1.3 s
on that year (95,568 nodes, Node 24) and the deduction took 0.7 to 1.0 s, so a fit
of the full year takes about half a second longer: 4.8 to 5.9 s against 4.4 to
5.6 s, over five runs each. Each row says where its club started (`levelPrior`)
and its league's outside games (`outsideGames`), which a device needs to rebuild
the fit's rating from the club's games and the panel says in words (below). The
what-if (Scouting report) stays exact: its three fits read the same schedule, so
their starts agree.

#### How the level is re-measured, and when it moves

The −1.6 is held in code (`CLOSED_START_RUNS`), as the age table is, not refitted
with each board. It is read again every week and judged by the rule the age gap and
the run cap are judged by, and it changes only by a commit that raises the boards'
rules (`BOARD_RULES`, with the boards pinned first).

The re-measure is `compareClosedLevels` (`scoutBacktest.ts`). It reads the four weeks
before the day it is asked on, Monday to Sunday when that is a Monday. Each week is a
cut: the year fitted as the board would have fitted it the morning the week began
(`fitScoutYear`, every rated game before it, the starts included), and the week's
games between two clubs that fit rated, scored on the ratings it showed. The fit is
linear in its starts, so one more solve per cut is enough: every start at its share
of a run of level (`startingShare`), every game a draw with no age gap. That solve is
the response of each rating to a run of level, and the fit at any level is the held
fit plus the response times the distance, its evidence discount read again at its own
residual scale.

- **The level** is read off the four weeks together, by least squares of each game's
  residual with no start on the response across it, clustered by week and by the
  league of the side that has played less outside itself.
- **The judgement** takes a week at a time, each scored with the level the other three
  read. It uses `pairedImprovement` on the shown ratings' absolute error, one rival, so
  a bar of 2.00 standard errors, and at least 30 games.
- **Never in sample.** On the games it was read from, the four age bands' levels
  measured beside it (below) were named clearly better on the measurement's weeks
  (z 2.46 against their bar of 2.28) when scored apart they are not (z 1.03).
- **Never on point ratings**, which the plain backtest scores. The discount already
  lowers thin clubs, and a club whose league keeps to itself is often a thin one, so
  on point ratings a deeper level reads better than it does on the board: by the
  rule's own absolute error, with each week left out, z 1.72 against −0.77 on shown
  ratings, short of the bar. It falsely cleared the bar there in sample (z 3.59) and
  on the last two weeks judged with the first two weeks' level (2.27), and by squared
  error even with each week left out (2.63).

On the owner's backup of 11 October 2026, asked the Monday after:

- the four weeks from 14 September held 79,981 games (10,590 week-and-league
  clusters), and read −1.74 ± 0.16;
- the weeks of 19,710, 25,909, 27,834 and 6,528 games were scored with −1.89, −1.64,
  −1.70 and −1.74;
- each week's games were 0.00010 ± 0.00013 runs a game worse than with −1.6 (z
  −0.77), not clearly better, so the held level stands;
- the start as held still earned 0.103 ± 0.018 runs² of squared error on those weeks,
  against no start at all.

It took 20 s and about 1 GB above the loaded pool (2.8 GB at most) in Node 24 on four
2.1 GHz cores, four fits of 59,427 to 93,430 nodes and a solve after each.

**Where it runs.**

- _Once a week, in the nightly refresh on GitHub_, as of the week's Monday: the first
  live run of the week (Monday to Sunday, by the members' day the run starts on) that
  finds the record kept older than that Monday makes it, so it is made once a week
  however late GitHub starts the run (`closedLevelMondayDue`). From 1 November the
  cron's 04:17 UTC is 23:17 the evening before, Eastern, and the seven scheduled runs
  of 11 to 17 October 2026 started 4 h 15 min to 7 h 38 min late, so the start's
  weekday alone would have skipped a week whenever a Sunday run started under 43
  minutes late and the Monday one later, and made one twice the other way round. A
  dry run re-measures on a Monday only. It reads the pool the night has just built
  the boards from, the squad year whose boards hold the most games in the four weeks,
  League Standings' games counted with the stored ones: the Team
  Rankings pool the run holds, and the League Standings seasons as the publish read
  them, handed on rather than listed again (`remeasureAfterPublish`,
  `closedLevelWeekly.ts`), so it reads nothing more of the cloud and a score saved
  after the publish reaches neither. A night whose views were not published does not
  re-measure, and a later night of the week tries again. Its own scheduled workflow
  would have read the copy again.
- _The live run keeps the answer_ as one small document beside the views,
  `live/closedLevel` (`closedLevelRecord.ts`), which the Model check card reads as it
  opens and shows as one line, before anything is pressed: "Last weekly re-measure, 12
  Oct, on the 2027 squad year. Starting level for leagues with few outside games: held
  at −1.6; the four weeks to 11 Oct read −1.74 ± 0.16 on 79,981 games; not yet clearly
  better." It names the squad year, since the card shows it on every page and a page of
  another year reads its own pool when pressed. The line names no club or league, and
  calls nothing closed.
- _A level clearly better opens an issue_, "A new starting level is ready for leagues
  with few outside games" ("When a run fails"), with the level read, the gain and its
  standard error, and that the change is a commit. A later Monday that judges the level
  and finds none clearly better closes it; one with too few games to judge leaves it
  open.
- _The Model check runs the same re-measure_ when pressed, last of its runs, on the
  device's worker and on the server (`model.check`), and its card gives the same line
  for the page's year under "Where a rating starts".

**One level per age band was measured and not shipped.** Bands of 9-10U, 11-12U,
13-14U and 15-18U were fitted on the weeks of 1 to 21 September. On the 59,405 later
games they were 0.0045 ± 0.0025 runs² worse than the single −1.6, where they needed
to be two standard errors better. The bands did not keep their values through the
season: 9-10U read −1.30 ± 0.38 early and −2.68 ± 0.37 later, and 15-18U −1.59 ± 0.49
and −0.59 ± 0.39. Re-measured on the last four weeks and scored a week at a time, they
beat −1.6 by nothing (z +0.32).

The band to watch is 15-18U. On the later games −1.6 over-corrects there: its island
clubs did 0.72 ± 0.57 runs better than shown against well-connected opponents (168
appearances), and its weakly connected clubs 0.55 ± 0.40 (341). Over the last four
weeks the start cost 15-18U 0.055 ± 0.050 runs² (10,111 games). None of it reaches two
standard errors yet.

### Game by game

On the cloud's board a club's panel says, under each game it counted, what that game
did to its rating there (`gameBreakdown`, `gameWords`). Above the list the board's
rating is split in two: what the club's games give it, the fit's own rating
(`pointRating`), and what its record adds or takes off, the evidence discount
(Scouting report, **What if?**). The discount compares the club's spread, how unsure its
rating is, with the mean spread over every club the fit rated in the span, on every page
of the pool, never one board's rows (`discountMiddle`): a record that makes the rating
surer than the average club's adds, and one that makes it less sure takes off. "Fall 2026
rating +2.8: +2.5 from your games, +0.3 because your record makes your rating surer than
the average club's." The line first said "fuller than most", which counts the board's
clubs, and the mean is not the median: the spread falls ever more slowly as games are
added, so on the 29 September 2026 backup more than half the clubs gained on 10 of the 20
boards with lines, 57.8% on one. Nor is it a count of games: of the 45,554 clubs that
gained, 8,146 had fewer effective games than their board's average.

The two ratings are printed as the board's row prints its Rating (`formatBoardRating`),
"-0.0" and all, and the record's part is what those two printed figures differ by, so the
three add up on screen and one that rounds to nothing says the rating is all from the
club's games. This line is the only place the fit's own rating is shown. The board's row
had it too, as a Best guess column beside the Rating, and the owner took it off: a second
rating on every row, a few tenths from the first, read as noise, and a club's panel on
the cloud's board says what the gap is. Rounded as whole tenths instead, the line differed
from its row on 2,158 of the 88,106 clubs with lines on that backup, every one a "0.0"
over a row's "+0.0" or "-0.0". The page's own club reads "your", any other "its".

Where the fit started the club (**Where a rating starts**) is not said. The start is in
the rating "from its games" already, since the fit played its virtual games there and its
league's opponents started there too, and the owner chose that no club's panel say its
league keeps to itself, on any device and to a member as much as anyone, so the line stays
the two-part split above and a test holds that it never names a league, its outside games
or a start.

Under each counted W, L or T row are two figures, keyed once above the list. **Played
like** is the rating that makes the score exactly what the fit expected: the opponent's
rating, plus the margin counted, less the runs the age gap was worth. A club's fitted
rating is the weighted mean of these over its games, with the ridge's 1.5 games played
at its starting level (**Where a rating starts**), which its row carries; on the 2027
year of 29 September 2026, with those games then at nought, that held for all 83,693 of
its teams to 5.6e-9, the solver's own tolerance, which is what lets a device rebuild the
board's own row from them. **Moved** is the rating the board shows with the game, less the rating it
would show without it, every other game weighed as it was, every club's starting level
(**Where a rating starts**) and the fit's residual scale and middle held. A refit without
one of a league's few outside games would also start the league lower, from −1.45 to −1.60
for a league with one and from −1.23 to −1.33 for one with three, which Moved leaves out. It has two parts: the score's, what the margin did to the fit's rating,
and the record's, what one more game on the record did to the discount, which is never
below nought. When the score's part reads as a fall of a tenth or more and the whole
does not, both are said, rounded so they add up: "moved your rating +0.1 (score -0.1,
one more game +0.2)". A move that rounds to nothing says "less than 0.1".

A clause follows only where it applies, and names what takes the row's score to the
margin counted. The row shows the club's own schedule's score, and the fit reads the two
schedules' average where they disagree (`ratedMargin`), held to the cap. "Counted as a
12-run win, the most one game counts" is for an average past the cap where the club's
own score, held to the cap, is already the margin counted; "counted as a 1.5-run win, the
two schedules' scores averaged" for an average inside the cap or exactly on it, which
the cap did nothing to; and both together for an average past the cap that the club's
own score, held to it, does not reach: one inside the cap, or one past it on the other
side. So a club whose own schedule has it losing 0-13 and whose opponent's has it winning
37-0 is counted as a 12-run win, the average exactly, and is told of the average alone.
On the 29 September 2026 backup the first rule read off the row's score instead, and of
the 88,032 lines with a margin clause it named the wrong reason on 212: the cap for 106
averages that landed exactly on it from a score past it, and both for 106 that landed
on it from a score inside it or on it. Then "2 runs added for playing a year up", "2
runs taken off for playing a year down" or 4 runs for two years, for a game against
another level (above).

A game against a side seen once, a stand-in or a club known only from this one schedule,
reads nearer the club's own rating than its score would, and moves it little. With
nothing else to go on, the fit lets that side's rating take most of the result: for a
game of average weight, with the ridge at 1.5, played like comes out two-fifths the
club's rating, three-fifths the margin counted and three-fifths that side's start
(**Where a rating starts**). A side met once almost always falls in the club's own league,
since joining it gains a game and costs next to nothing, so that start is the club's:
for an island club such a line reads 0.96 runs below what the club's rating and the
margin alone would give. The game says more about the stand-in than about the club,
which is also why the discount counts it as 0.6 of a game.

Played like is exact, but for the 4 places a side with no row on the board carries its
rating to (within 5e-5), and so is the record's part. The score's part is worked out as
if the club's opponents met nobody else in common (the star estimate), since the exact
answer is the year's pool fitted again without the game, which no phone does as a panel
opens. Against those exact refits, the weights and starts held, on 414 games of 60 clubs drawn from
the 29 September 2026 backup's 2027 year, it was off by 0.006 in the middle, 0.061 at the
95th percentile and 0.268 at most, gave the same tenth on 355 of the 414 and never the
wrong sign. A short record is the least exact: at the 95th percentile, 0.061 for clubs
with 3 to 8 games, 0.048 for 9 to 20 and 0.016 for 21 or more. Taking the game alone
against the club's other games, the obvious shortcut, was off by 0.207 at the 95th
percentile and gave the same tenth on 238. Both parts are said, the score's reading -0.1
or lower and the whole not, on 30,996 of the 532,020 lines the backup's 20 boards with a
fit gave its 88,106 clubs: on 24,230 the whole rounds to nothing ("moved its rating less
than 0.1 (score -0.1, one more game +0.1)"), and on 6,766 it reads +0.1 or more. A move
that rounds to nothing is said on 36,674 lines in all.

No line, and no word of one, is drawn where the lines cannot be shown to add up to the
board's own row (The live board on a member's device, **What each game did**): a board
without a fit, a club with no row on the board on screen, a half or page moved to whose
board is still on its way, and a card and board from different publishes, until both are
read again. A row still to come, one outside the half on screen, one set not to count
and one against the club's own name never carry one. The line above the list and its key
are drawn only while a row on the list carries a line, so a pending Not this team that
takes every such row off takes them too, though the lines, worked out from the card as
published, are still in hand. Team Rankings on this device's own copy draws none, having
no published board to explain.

### The model, measured

`scripts/modelSweep.ts` (`npm run model:sweep`) asks how well the boards forecast, the way the
counted level and the recency weights were measured: the squad year is fitted as its boards would
have been on 1, 8 and 15 September, and every later game between two clubs one board lists, from
23 September to the board's day, is scored on the ratings the board showed, as `predictMatchup`
states the matchup. Every forecast the app shows is between two rows of one board, so a game
across ages (the clubs at home on different pages) and a game against a club known only by name
or a bracket slot (which no board lists) are counted apart rather than scored
(`src/lib/modelSweep.ts`). It reads the shipped model's log loss and Brier score on the decided
games, the squared error of its margin on all of them (the margin a board states, held to 14
runs), and its calibration: the favourite's chance in bands of five points beside how often the
favourite won. Beside the shipped model it fits each setting moved on its own, either way, and
reads each against it game by game, with a standard error that reads a club's games together
(`pairedImprovement`):

- the ridge's pull toward a club's starting level at half, three quarters, half again and twice
  `DEFAULT_SHRINKAGE`;
- a game's margin capped at 8, 10, 14 and 16 runs in the fit, against `RATING_CAP`'s 12;
- the floor under a matchup's chance at 2%, 5% and 12%, against `MATCHUP_PROBABILITY_FLOOR`'s 8%.
  The floor is swept rather than the margin a chance is read to (`MATCHUP_MARGIN_CAP`, 14 runs):
  the floor binds first, at about 9.6 runs at 10U and 11.6 at 18U, so no cap past it moves a
  chance. A floor leaves the fit alone, so its margin error is the shipped one's to the digit.
- the single curve of a matchup's age that every matchup read until 6 November 2026 (`single`),
  and a twentieth either way. The first run found the boards on it 1.5 to 2.6 points too sure of
  the favourite from 60% to 85%, which a curve about a tenth wider closed. Like the floor, it leaves
  the fit alone.
- the matchup read from the fit's own ratings rather than the shown ones (`ratings: "point"`, a
  row's `pointRating`). A shown rating
  is the fit's own less one standard error about the year's centre (`EVIDENCE_STANDARD_ERRORS`),
  which was measured for which club a table puts first; read into a matchup, it takes the thinner
  club's whole discount off its side of the margin, about a run between a club of four games and
  one of forty.
- the curve as shipped (`matchupOddsWidth`) with its two settings moved: its width read as
  `sqrt((share × spread)² + weight × (errorA² + errorB²))`, each error the club's `ratingSpread`
  over its weighed games, the share 0.5, 0.6 and 0.7 of the age's spread and the weight 1, 1.6 and
  2.4 (`share`, `weight`).

Beside the five-point calibration bands, every setting is read in three slices of the same decided
games, each band holding the same games for every setting (`VariantSlices`): the favourite by days
from the cut to the game, since a board is rebuilt every night and what a member reads is mostly a
game days away, where the sweep scores games from eight days to two months on; the favourite by the
weighed games behind the thinner club; and the thinner club by how far apart the two ratings'
errors are, where a thinner club that wins more often than it is given is one the matchup
under-rates.

The same run counts the squad year's stand-ins (`src/lib/standInReport.ts`): the games with a
club known only by name or a bracket slot on a side, played and all, and of the clubs known only
by name, how many share a name with a club pulled the same year, which is a matching gap a
region might settle, and how many have nothing of that name. The ones with a namesake
are split by where it is: on a page the stand-in played on (most likely the club itself, which the
import would not join it to), or only on another page; with the played games filed against a
bracket slot nobody resolved.

It reads a backup, the seeded pool (`--fixture`), or the cloud copy once (`--cloud`), read only, as
the nightly reads it, on GitHub's runner (`.github/workflows/research-model.yml`, on a push to its
branch marked `[run-sweep]`). A public log gets numbers only; the stand-ins' names are sealed to
`scripts/researchSeal.pub.pem` and opened with its private half, which is never committed. What it
finds becomes a constant only by a later commit that pins the boards first.

What it found on the cloud copy of 27 October 2026 (GitHub run 40443133874; 127,961 later games
a board states, 124,311 decided): the shipped model's log loss is 0.6146 and its Brier score
0.2134. No setting of the fit beats it: the ridge either way and a fit cap of 8 are clearly worse,
a cap of 10 or 14 is level, and 16 worse. A floor of 2% or 5% is better by a hair (z 1.9 and
2.5), and 12% worse. The odds curve a twentieth to three twentieths wider is clearly better (log
loss +0.0006 to +0.0008, z 6.3, 4.6 and 3.1), a fifth wider is level, and three tenths or a twentieth
narrower worse: the boards are 1.7 to 3.3 points too sure of the favourite from 60% to 90%. Of the
year's 391,391 games, 33.4% have a stand-in on a side (28.7% of the played). Of the 58,489 clubs known
only by name: 7,540 have one pulled club of the name on their page in a state of the clubs naming
them, 3,208 one in another state, 4,327 several, 1,151 one or several spelled near it, 6,826 a
namesake only on another page, and 35,437, holding 70,254 games, nothing of the name at all.

What it found on the cloud copy of 6 November 2026, in four reads (GitHub runs 42302454163,
42303697357, 42304469188 and 42308023088), the first two and the last on the boards of 1, 8 and 15
September (143,306 decided games), the third on those of 1, 8 and 15 October scored from 23 October
(99,945):

- The single curve was calibrated overall on September's boards (52.5% said, 52.5% won at 50-55,
  up to 87.2% and 87.5% at 85-90) but not in its parts: 1.5 points too sure of the favourite where
  the thinner club stood on under two weighed games, and 1.7 and 6.1 points not sure enough at
  four to eight and eight or more. On October's boards, two months of games on, it was not sure
  enough almost throughout (72.4% said, 75.9% won at 70-75; 87.2% and 91.9% at 85-90), 2.9 points
  on the games under three weeks ahead; a curve a twentieth narrower was clearly better there (log
  loss 0.0011 lower, z 10.9) and clearly worse on September's (z -4.1).
- Reading the matchup from the fit's own ratings rather than the shown ones was clearly worse on
  both (log loss 0.0009 and 0.0012 higher, z -4.2 and -4.7). Where the two errors are a run or more
  apart the thinner club won 38.0%, the shown ratings gave it 38.6% and the fit's own 44.1%: the
  discount is right for a chance too.
- Widening each matchup by its two errors, on a curve narrower about a proven pair, fitted both.
  Of twelve settings, 0.6 of the spread and 1.6 of the two errors' variance did best over the two:
  level on September's boards (0.0002, z 1.0; 0.0009 on the games under three weeks ahead, z 3.2),
  0.0025 better on October's (z 8.0; 0.0029 on the games under three weeks ahead, z 8.3), every
  band of the thinner club's evidence on October's within a point. It is the curve the boards read
  now (`matchupOddsWidth`), and the single curve is the setting `single` beside it.
- Read again as shipped (the fourth read), the curve scored as the second read had it, log loss
  0.6151 against the single curve's 0.6153, and the favourite within 0.1 of a point of how often it
  won on the games under five weeks ahead. The fits' residual scales were 4.05, 4.12 and 4.19 runs,
  above the 3.5 a row's error is never read under (`RATING_ERROR_SCALE_FLOOR`), so the floor binds
  only on a pool far smaller than this one.
