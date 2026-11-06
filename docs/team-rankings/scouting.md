# Scouting report

_Part of the design documents; the map is in the repository's [README](../../README.md)._

Pick a team and it answers two questions. **Next up** is the games still on that
team's schedule — a pulled GameChanger schedule carries its future fixtures with
no score, so they are already in the pool and nothing has to be typed — each with
the date, the opponent's rank, the projected margin and a win probability. An
opponent nobody has pulled has no rating, and the row says "not rated here yet"
rather than inventing one. Below it, the same projection against every ranked
team on the page, which is the question to ask before entering a tournament.

**Compare with** sets a second club beside the report's and answers first, right
under the two boxes and above the write-up of the team's rank: who should win, who
should lose, by how many runs, and each side's chance ("Hill Hawks should beat River
Otters by 2.3 runs. Win chance: Hill Hawks 64%, River Otters 36%"). The numbers are
`previewMatchup`'s, the same the report gives that club added by name, put into words
by `forecastWords`; a margin too small to move either chance off 50% is called dead
even rather than handed a winner. It carries no caveat, even for two clubs nothing in
the pool joins: every forecast is an estimate, and the answer is what was asked for.
A club picked on another page that is not ranked on this one says so. The answer
needs only the two ratings, so it shows the moment a club is picked.

Under it, the reason for it (`compareClubs`): the games the two played against each
other, every club both have played with each one's score against it ("we beat the
Bears by 5, they beat them by 1"), and each side's best wins and worst losses by the
rank of who it was against, and its last five. It reads the games the board counts,
in the half it is showing, each score as that club's own schedule gave it. Two
results of one day stay in the order the pool lists them, as a club's panel lists
them. The forecast is one number; this is the evidence it is made of. Names and
scores only.

Above the games, a profile of each side from the same games: runs scored and allowed
a game and the average margin; the record against opponents rated more than 1.5 runs
above the club, within 1.5 runs, and more than 1.5 below (`SIMILAR_BAND`, where a
matchup reads about 60-40 at 12U; an opponent with no rating on the board is in none,
and a club with none of its own has no split); and its form, the last five as letters,
newest first. Under the common opponents' heading, the edge in words: each common
opponent's margin for one club less the other's, averaged over the opponents ("Hill
Hawks did 3.0 runs a game better than River Otters against the 2 clubs both have
played"). Nothing more is read for it than Compare already reads.

**Scout**, beside each rated game still to play on Next up, and beside the next game
on the board's own-club card, sets that opponent in Compare with: the one card a pick
there by hand would read, and nothing more. From the board it opens Scouting on our
own club's report first.

**Tournament field** plays a weekend out before it is played. Build the field by
name, or from the report team's own next opponents in one press, choose pools and
a bracket of two, four or eight, and the event is simulated 2,000 times on the
board's ratings (`simulateTournament`). The field is drawn into pools by snaking
down the ratings, as organisers do; each pool plays a round robin; the clubs with
the most pool wins go to a single-elimination bracket seeded on those wins; each
game is won with the scouting report's chance. Ties on wins are drawn, because a
tournament's run-differential rules are its own. The panel gives the field's
strength (average rating and rank, and its best club) and each club's chance to
win its pool, reach the final and win, marking as a guess a club whose rating was
worked out against a different set of teams from most of the field. Beside the
odds are each club's record and rating on the board, and, where the report's club
is ranked here, its projected margin and chance against each one (Us by, Our
chance), from the same preview a matchup row's What if reads, so the table reads as
the weekend from our bench and not only as odds. Fields are saved in this browser
by name, per age group, each club with a few GameChanger ids it carries on the page
(`SavedField.gc`), and read by them on this device's copy (`readClub`): a club folded
into another is that club, and one whose id is another club's now is not ranked
here, never played as that club, and keeps its id when the field is saved again,
so a club pulled back later is found by it. A field saved before, with no ids, is
read as it always was. The cloud's board names its clubs by id alone, with no
GameChanger ids on its rows, so it saves its fields with none (keeping those of a
field it opens) and reads them as kept.

The projection is the rating difference, capped at 14 runs, put through a
logistic curve; no home-field term, because at this level which side is "home" is
a coin flip. The curve's spread rises with age, 4.125 runs at 8U and 0.11 more a
year, because a margin says less about who wins as players get older. It was 2.8
at every level, and on the pool of 26 September, fitted up to three different
days and scored on the games after each, that was overconfident: favourites it
called at about 75% won 69 to 71% of the time, and at about 85% won 82 to 83%. A
spread rising from 2.95 by 0.09 a year fixed that for ratings capped at 8 runs;
when the cap went to 12 (below) the ratings stretched and the spread was fitted
again, the same way, through the app's own fit. Favourites it calls at about 75%
won 73 to 75% of the time, and at about 85% won 85 to 86.5%. The cap and the
curve move together: cap 12 on the old curve read worse than cap 8 on it. On 27
October 2026 the model sweep (**The model, measured**) scored the boards on the
cloud copy's later games and found that curve, 3.75 runs at 8U and 0.10 more a
year, 1.7 to 3.3 points too sure from 60% to 90%; a tenth wider forecast the
same games better (log loss 0.0008 lower, z 4.6), so it became 4.125 at 8U and
0.11 more a year. On 6 November 2026 the sweep read the boards of September and of
October beside each other and found one curve for every matchup could not be right
about both: too sure about two clubs that had played little, and not sure enough
about two that had proved what they are, which by October was most of them
(favourites given 72.4% won 75.9%). So a matchup's curve is now as wide as its two
clubs' evidence (`matchupOddsWidth`): 0.6 of that spread about two clubs known
exactly, widened by 1.6 of the two ratings' variance, each club's error carried on
its row (`ratingError`). On October's boards it forecast the later games better
(log loss 0.0025 lower, z 8.0; 0.0029 on the games under three weeks ahead) and was
level on September's (0.0002, z 1.0). A row of a board built before rows carried
an error reads the single curve, until the boards are next built.

**What if?** Under each fixture is the question the projection cannot answer: not
who is favoured on Saturday, but where Saturday leaves you. A rating here is not a
property of a club — it is the solution of one least-squares fit over every counted
game in the pool — so the answer is the whole table fitted again with the result in
it. The panel shows a rung per whole run, from a defeat by twelve to a win by twelve,
each with the place it would leave you and how far that moved you.

It is a margin table rather than two buttons because the margin is the larger half of
the answer: winning by one against winning by twelve moves a club further than winning
against losing at the projected margin. Twelve is the top rung because `RATING_CAP` is
twelve, so a 13-1 and a 20-0 are the same evidence.

Three fits are enough for all twenty-four rungs, exactly. The fit is least squares and the
cap is applied before it, so within ±12 runs every fitted rating is affine in the margin
assumed, and the two ends give it at every margin between. The shown rating is that less
an evidence discount: the pool's residual scale times a number fixed for each club, its
games weighed by its opponents', which no margin changes. The scale is not linear, but its
square is the mean of squared residuals, each affine in the margin, so it is a parabola,
and a third fit at a tie pins it. A straight line between the two ends missed a real
re-fit's rank 2 times in 160 synthetic cases with stand-ins (at the cap of 8 then in use);
drawn this way there are none, and the worst rating error is 1.6e-10 runs.

The discount weighs each game by what it can say about the club: `1 - 1/(1.5 + the
opponent's games)`. A win over a stand-in seen once mostly pins the stand-in, which has
nothing else to go on, and leaves the club 0.6 of a game, what the ridge leaves it; a win
over a club with twenty games leaves 0.95. So eight wins over one-game stand-ins are
discounted more than eight over clubs with seasons of their own, and the Games column still
counts every game. On the 2027 year of 26 September, with the cap then at eight and the
win-chance curve fitted to it, fitted as the app fits it and scored on the next week's
same-level games at eight cut days, the Brier score improved at every cut, −0.00010 ±
0.00002 over 73,614 games; thinning every count by the pool's average ratio, or shuffling
which opponent a game was against, gained nothing, so it is the opponents that help. The
shown win chance moves a median 0.14 points. On the 14U 2027 board of the same pool,
"Florida", 19-2 with all 21 games against stand-ins or slots, goes from #22 to #24, and
Texas Edge Black, 5-0 against clubs, from #24 to #23.

Nothing in the panel is coloured by outcome. Winning is not always good news and
losing is not always bad: a narrow loss to a much stronger club can lift a thinly
played side, because the table rates who you played and one more game is one more
thing the rating stands on. Measured on a 40-club pool with the cap then at eight, a side
with three games that loses by two to the best club in it goes from #31 to #27.

The hypothetical is fitted as if the game were played today. That is deliberate and
the alternative is worse: older games count for less, so a result dated weeks ahead
arrives as the newest thing in the pool and outweighs the season that has actually
happened. A fixture in the other half of the year, one with no date on a half board,
and one against a club nobody has rated are all refused rather than answered — the
first two would move a table they do not belong to, and the third would add a row to
the table instead of moving one within it.
