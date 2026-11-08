# League Standings

_Part of the design documents; the map is in the repository's [README](../README.md)._

## Postseason format

Not every league has a playoff cut line, so the season's ending is a setting:

| Format            | What it means                                                                                                                                                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Cut line`        | The top `Gold cutoff` teams make the Gold Bracket. The default, and the only format with Gold odds, playoff status, a bubble, clinching and magic numbers.                                                                                                                                 |
| `Bracket, no cut` | Every team is seeded into the bracket by final standings. The bracket stays, but nothing is inside or outside a line, so every cut-line concept goes: Gold odds, playoff status, the bubble, clinching, magic and elimination numbers, and the cut-line commentary in the season timeline. |
| `No postseason`   | Regular season only. No bracket, no Gold odds, no clinching.                                                                                                                                                                                                                               |

With `No postseason`, everything that only exists to describe a bracket is
removed as well: the header cut-off card, the Standings postseason tile, Gold
Odds Over Recent Games, Projected Cut Line Games, and the Gold Odds column in
the Forecast projected standings.

Both cut-less formats are swept the same way — the difference between them is
only whether a bracket is played. A grep of every view in `Bracket, no cut`
mode turns up no mention of Gold, a cut line, the bubble, clinching or
elimination.

Turning the cut line off is not just cosmetic: clinching, elimination, cut-line
crossings and the bubble are all _defined_ relative to a cut, so without one
they are dropped from the standings table, the recap, and the AI write-ups
rather than reported against a cutoff that stands for nothing. The AI is told
explicitly that no cut line exists and to cover the race for the top instead.

**Magic and elimination numbers read a tie on points as the tiebreakers' to
settle.** The exact solver works on points, and a tie on them is decided in the
table by fewer losses and then the league's tiebreakers, which can hang on games
not yet played. It used to hand every tie to the lower team id — the first four
letters of the name — so "513 FORCE - BOULEY" was told it had clinched wherever it
was level, and the Trash Pandas who held the head-to-head were told they were out.
Simulated over round robins at the pool's own 3.3% tie rate, 11-20% of finished
seasons carried a line the final table contradicted. A clinch now counts every
level team ahead and an elimination counts none of them; where only the other
side holds, the line says so — "1 more win guarantees at least a share of the
last Gold Bracket spot; the tiebreakers decide", or "after 1 more loss, only a won
tiebreak keeps the team in" — rather than claim either. Once nothing is left to
play, the table's own rank answers.

**Games a team still owes count as games left.** A league can set games per team
and enter only part of its schedule, the second half posted later, say. The
Standings' status column has always counted the games each team owes under that
setting beyond those scheduled (`getRemainingCounts`), but the magic and
elimination numbers, the needed results, the Forecast's Gold Bracket paths and the
Gold and title odds read the schedule alone: once the games entered were played, a
team 3-0 with nine still owed read "Already clinched" and 100% beside a status of
In, one 1-2 "Already eliminated" and under 1% beside Alive, and the Forecast listed
no paths at all. Each owed game is now one more game in the exact search, against
a stand-in that is never ranked (`owedGames`, `withOwedGames`), so it can go
either way, as the status column reads it, and a clinch or an elimination the
search claims is one no result of the owed games can undo. They count toward the
fifteen games the exact numbers wait for, so a league owing many shows them paused
in the team panel, in its usual words, and leaves them off the Our team card,
until few enough are left. A need in them has no opponent or day to name, so the
team that owes them is named: "Win the 2 games not yet on the schedule", "Bears to
lose their game not yet on the schedule". Where the one game left in the season is
owed, it is read at every score it can end with, as the last game on the schedule
is, and there another team's win can be the result needed, though in the search it
only ever lifts that team: "Eagles to win their game not yet on the schedule", for
a team that an Eagles win leaves level with one rival it beat, where a loss would
leave three level for run differential to settle. Nor has a team whose games left
are all owed a game to work its Clinch Scenarios from, so its panel says how many
it has ("Aces have 9 games left that the schedule does not show yet") where it said
the team had none left.

The Gold odds play the owed games too, after the scheduled ones and drawn as they
are, each against a side of the league's average strength (`leagueAverageSide`):
every number the forecast reads off a team, averaged over the league by the games
behind each, and the league's average rating where its teams carry one, so a
strong team wins more of its owed games than a weak one does. Nothing is booked
onto that side and no table ranks it, and the title odds take the bracket's kept
scores as played only once the owed games are played too, or a kept score ends them
(below), since until then nobody's seed is settled. In the league above, the Aces went from 100% to 99%, the
Bears from 99%+ to 77%, the Comets from under 1% to 20% and the Ducks to 5%. A
league with no games per team set, or whose schedule has them all, is searched and
simulated exactly as before, to the digit.

The Forecast's projected standings play them too, since 1 November 2026
(`projectStandings`): after the scheduled games, each owed game goes to the favourite against
the same average side, the owing team's side booked at the model's score, so the Projected
Record and the Run Diff beside it come to games per team. The Range walks them as well
(`useSeedRanges`): each owed game is one more result that can go either way, every scenario
projected against the one average side the season as it stands gives, with the season's owed
games less the one it settles. Both read the schedule alone before, so in the league above the
Aces, 3-0 with nine owed, were projected to finish 3-0 beside Gold odds that played all nine;
they are projected 12-0 now, the Bears 2-10, the Comets 1-11 and the Ducks 0-12, and a team
whose games left were all owed read its projection at both ends of its Range. The projection and
the walk count the owed games toward the games they wait for (250 and 60), as the exact search
does. A league owing none is projected and walked exactly as before, to the digit.

Waiting for the owed games had a cost where games per team counts one that will
never be played, a rainout taken off the schedule and not made up, say: the title
odds drew the bracket afresh even once it was played and the Dashboard named its
champion. Since 1 November 2026 a kept bracket score ends the owed games
(`bracketBegun`, `regularSeasonSettings`): the bracket is played once the regular
season is over, so once any game of it, Gold or Silver, has a final score in, games
per team owes nothing more beyond the schedule. Every number that counted the owed
games reads the season as scheduled then: the status column, the magic and
elimination numbers, the needed results and the paths, the Gold odds and their trend,
the projection and its Range, the season timeline, the recap, the playoff machine, and
the title odds, which read the bracket's kept scores as played. In the league above
with its final kept, the Bears beating the Aces 5 to 2, the Aces and the Bears read
Clinched at 100% where they read 99% and 77%, the Comets and the Ducks Out at 0% where
they read 20% and 5%, the projection is the round robin as it stands, the Aces 3-0
where they were projected 12-0, and the Bears hold the title at 100%. A score still
being typed, not marked final, keeps nothing, and the trend's points before the last
are read without the owed games too, as they would be had the setting matched the
schedule. Data Quality's finding on the setting says what holds the numbers back until
then, and goes once the bracket begins; the setting itself, as Settings shows it and a
backup or a shared link keeps it, is the league's and does not change.

## Playoff machine

"If we beat the Bears and the Comets lose, where are we?" The Forecast tab has a
panel for it. Each game left can be settled by hand — the away side, the home side,
or **Sim** to leave it to the model — and the table below it is the season with
those games played: records, places and the cut line from the same code as the real
standings, with the league's own tiebreakers, and Gold % simulated over the games
still unpicked (`scenarioSeason`). A pick plays out at the model's expected score,
turned round where the pick goes against the model, because run differential breaks
ties and a winner alone does not give one; a score can be typed instead, up to 99 runs a
side, which is as many as a saved scenario or a link keeps (`MOST_RUNS`). Ratings are
not refitted on made-up results, so the rest of the page does not move. Each team's row
says how the picks move it against the season as it stands: its place (▲2), its Gold %
(+65), and **Clinches** or **Out** where the picks settle what the season does not yet.

### Saved scenarios

Picks not saved as a scenario go when the page does, or at a change of season: a look at
another tab and back finds the machine as it was left, the picks and the scenario open, which
the page holds while the Forecast tab is closed (`MachineLeft`). They are one season's, told
apart by `activeSeasonKey` whether the Forecast tab is open or not, so that a season deleted
and its id given out again, or one restored over, leaves none to the season now under that id.
A scenario (2.7, `src/lib/savedScenarios.ts`) is a name, the picks with any typed scores, and
each picked game's teams and date as they stood, kept on this device per season, the most recently
changed first, thirty at most (a save that pushes the oldest out names it). One parent's
"what if we win out" is theirs, not the season's, so a scenario is never written into
the season, a backup or the cloud; it goes when its season does, not to a season made under
the deleted one's id, and moves with its season when a cloud merge gives that a new id
([Data + persistence](data/README.md#data--persistence)). A scenario is opened from the **Scenario**
list, its picks changed and **Save changes**, **Rename**d, **Duplicate**d with the picks as
they are now, or **Delete**d with its picks left on screen unsaved. **Clear picks** starts
again. Choosing another entry in the list while the picks on screen are not saved, made
with no scenario open or changed in the one open, first asks whether to **Let them go**
or **Keep them**, rather than losing them at a glance at another scenario. Each change
is made to the scenarios as stored rather than to the list on the page, so one kept in
another tab meanwhile stays. A change to the open scenario starts from it as stored too:
**Rename** keeps the picks another tab saved to it meanwhile, **Save changes** the name
it was given there, **Duplicate** and **Delete** name it as it is called there, and one
another tab let go of is not brought back by any of them, nor copied under its old name; the
page says so, and its picks stay on screen, unsaved. Back on the Forecast tab, the list is
read as stored, but the open scenario is the one the picks on screen were made against, so
picks another tab saved to it meanwhile are not taken for changes made here. Picks
another tab saved to it that **Rename** or **Bring it up to date** takes in are shown in
place of the older ones here, and said so, unless picks changed here are waiting to be
saved, which stay: shown older, they would pass for changes, and **Save changes** would
write them over picks never seen here. A stored scenario of a later version is left as
it was, unread, through every change.

**Quick picks** fill the games in one go: **Favorites win** has the model's pick win every
game left, **Fill the rest with favorites** only the games not yet picked, and **Wins out**
or **Loses out** settles every game left of the team chosen beside them (the team this
browser follows, to begin with), leaving its other picks as they were.

A scenario knows when the season has moved on under it (`scenarioTrouble`): a picked game
played (the real result stands), taken off the schedule, or given other teams marks it
"(out of date)" in the list, and opening it lists what happened. Those picks are left out
of what is shown, and **Bring it up to date** saves it without them, saying how many went.
A game only moved to another day keeps its pick. The same holds for picks being made when
a game changes under them, from another device say: a pick counts only on the game it was
made on, until picked again.

**Share** copies a link, `?view=league#scenario=…`, carrying the scenario's name, its
picks and each picked game's teams and date, and nothing of the season, up to 6,000
characters (more picks than fit are refused, with a word to save them instead). Opening
one waits for the season to be the one the device shows, since matched sooner it would
be against this device's games from before, missing any added elsewhere: while the cloud
is still finding out who is signed in (the app draws without waiting longer than four
seconds for it) and while a member's device first meets the cloud's seasons (both
`leagueArriving`), and while League kept live waits for the cloud's version. Until then
the link stays in the address bar, kept there when a team's panel opens or closes,
because a first meeting's seasons arrive with a reload and the address bar is all that
carries the link across. Those seasons come only when the page is left, left alone a
while or asked, so that wait alone is said, with **Load them now**. It then shows the
picks, the soonest first, and which of them are not on games this season still has to
play between the same teams, and asks **Keep it** or **Not now**
(`src/lib/scenarioLink.ts`, fetched only when a link is opened). Kept, it joins the
saved scenarios for the season open here with only the picks that apply, and opens in the
playoff machine as if chosen from its list. Pasted into the address bar of the app open on
League Standings, a link opens in the page already running (one tapped on a phone may too,
where the installed app opens links in the window it has open, which has not been checked),
and there picks on screen not saved are asked about first. While that is asked, the
scenario open stays as this tab has it, unless keeping the link pushed it out of the
thirty, when it leaves the list and its picks stay on screen, unsaved; and a new name, a
delete or a switch asked about for the scenario open before is put away rather than left to
act on the link's. Either way the link leaves the address bar, and the season is never
changed. A link none of whose picks apply is said so, with a word to open the season it was
made for.

## Why the forecast says what it does

Each of the Dashboard's upcoming predictions has a **Why Aces at 64%?** button (2.8). The
chance is the one every League screen gives the game: the per-game model's (`predictGame`),
which the Schedule's pick, the Our team card, the team drawer and the Gold odds read, and so
is the pick (**Projected Winner**, and **Pick:** on a phone's line). In a toss-up, both sides at
50%, the Projected Winner is still the side the Schedule's pick names, the away side from 50% up
by that model's rule (a phone's line says **Toss-up**), or **Pending data** while the engine has
nothing to forecast from. The list used to show the prediction engine's own chance, a logistic
over its margin held to 8–92%, beside it: one game could be 43% on the Our team card and the
other side's pick at 54% in the list, and in a close game the two could back different sides.
The engine's chance is now shown nowhere.

Nor, since 1 November 2026, is anything else of the engine's on the card: the margin beside the
pick, the **Expected Score**, both **Range** lines (below) and the **Model Read** are the per-game
model's too (`forecastGame`), so a card is one forecast. They were the engine's: its margin, its
expected score (the league's scoring rate either side of that margin, to a tenth), ranges around
those, and its line "Aces holds the stronger opponent-adjusted rating", beside a chance from the
other model. In the Dashboard's own test league that card read Aces by 3.5, expected 6.4 to 2.9,
beside a 65% from a model that had them 8 to 3. The margin is now the projected score's, in whole
runs as the score is, given beside the pick only where the score leans the same way: a 52% can
sit beside a level score, which names no winner by anything. The Model Read says what that score
is made of, as the per-game model makes it (`modelRead.ts`): the margin this league's own games
give on their own (runs scored and allowed, and form), the ratings' margin, and how far the
projection goes from the first to the second, more the more rated games the thinner-rated side
has ("This league's games alone (runs scored and allowed, and form) make it Aces by 7.8; the
ratings, Aces by 3.1. The projection counts the ratings 60%."). With either side on fewer than
two league games the model reads the ratings alone against an even game, and says so, naming the
side. Before the league has a final the score is the model's placeholder, 7 runs a side, so the
card says **Needs scores**, as it did; a margin read off Team Rankings results alone is still
given, with its range.

What the panel explains is the engine's margin, the gap between the two ratings that the per-game
model counts beside the league's games, with the head-to-head nudge and the cap: the **rating
margin**, as the panel calls it now that the card's margin is the per-game model's. The engine
gives it as data with every forecast (`LeaguePrediction.explanation`), as the sum of its parts in
runs, which add up to it exactly:

- **Results**: each side's average margin in the games its rating was fitted from (league
  and Team Rankings, each counted up to `FORECAST_RUN_CAP`), shrunk toward average by the
  games behind it as the fit does, `n / (n + 1.5)` of it;
- **Opponents faced**: the rest of the gap between the two ratings, which is the fit's
  allowance for the opponents each side played. With every game neutral and counted once,
  as the engine's are, a rating is exactly `n / (n + 1.5)` of its average margin plus its
  opponents' average rating, so this is exactly the opponents' share. The panel gives each
  side's opponents' average and the share of it its rating counts
  (`MatchupEvidence.scheduleShare`), since the averages alone can point the other way: one
  game against weak opponents counts 0.4 of them, five against slightly better ones 0.77, so
  the weaker schedule can cost less and the part lean to the side that played it;
- **Head-to-head**: the nudge for their own meetings, never more than 1.5 runs;
- **Home field**: not counted, since who bats last is a coin toss at this level (it would
  show only if a fitted home edge appeared from games with a real home side);
- **Cap**: what the 14-run cap on a projected margin took off. It is a limit on the
  forecast, not evidence for either side, so it leans neither way and is never a side's
  strongest reason; the margin's parts take it off the leader.

Beside them is what the margin does not count again or at all: recent form (already in the
results), runs scored and allowed in league games, the Team Rankings results behind each
rating, how many games each rating rests on, each side's newest result and how long before
the game it was (or after, or on the same day: a game whose date has passed with no score is
still forecast, and the sides may have played since), and the per-game model the chance comes
from, which reads runs scored and allowed beside the rating (`forecastExplanation.ts`): the
reason given for its pick where no part of the margin leans that way.

The panel leads with the strongest reason for each side (a part of the margin where there is
one), then the rating margin as its parts ("Rating margin: Aces by 2.3 runs, from results +3.1,
opponents faced −1.2, head-to-head +0.4"), with every factor on request. **What could change it** names a
side with fewer than three games behind its rating, a newest result more than three weeks
before the game, Team Rankings results from a club linked by a name more than one club
carries, a rating and raw scoring that point different ways, and the margin and the chance
parting ways: the margin backing the other side, or the chance the engine reads off it 15
points from the one shown, said as closer or more one-sided without that second number. A
chance held at the per-game model's 96% (or 4%) says so. Five numbers the page shows are said
apart, since they are easily taken for one another: the **win chance** of this game, its **range**
(below), the model's **confidence** (how much it has to go on, not a second chance of
winning), **Gold %** (the chance of finishing above the cut line over the season), and the
**accuracy so far** (the season's finished games replayed one at a time, each called from the
games before it: a record of past games, not a promise about this one). The panel's code is
fetched the first time one is opened.

### How far one game can stray

Under each card's projected winner is the **range** of margins eight games in ten like it end
within, and under the expected score each side's runs (2.10): "Range: Bears by 6 to Aces by 15"
and "Range: Aces 3–15, Bears 0–9" for Aces 8 to 3 at 65%. They are the Gold odds' own draws of
the game, worked out rather than sampled (`drawnMarginSpan`): the tenth and the ninetieth of the
margins `drawMargin` draws, which is a tie at the league's own share of them, the away side
winning at its chance, and the margin from a normal curve around the projected one, 8.0 runs wide
at kid pitch and 6.7 at machine and coach pitch, held to the winner's side of level and rounded to
whole runs. Each side's runs are the projected total split by the margins at those two ends, the
loser never below none, as every simulated game is booked (`drawnRuns`), so a side's range is the
two scores its side of the margin range leaves it. The range follows the chance as well as the
score: Aces 8 to 3 at 65% is less than the curve alone gives a five-run favourite (73%), so the
Bears win more often than the curve's 27%, and the range reaches further their way. It says how
much a single game varies, not how sure the model is, so it is about as wide however many games
are behind the ratings. A game read from either side is the same range turned round: where one
side's wins are exactly a tenth of the draws, the low end is the home side's one-run win and the
high end the away side's.

Until 1 November 2026 the range was measured rather than drawn, around the prediction engine's
margin and expected score: 9 runs either side of the margin at player pitch and 10 at machine
pitch, and 6.5 and 8 either side of each expected score. On 1,006 pseudo-leagues from the 29 Sep
2026 pool (each state's pulled clubs on a 2027 page with twenty or more, their games with one
another up to a mid-September cut the season so far, their other results what the bridge would
hand over, and every later game between them scored), 81.0% of 89,998 player-pitch games ended
inside that margin range and 81.9% of 7,492 machine-pitch games, and both sides scored inside
their score ranges in 79.5% and 79.7%. The curve the Gold odds draw on would have put the
engine's margin band at 10.3 and 8.7 runs either side, holding 85% of player-pitch games but only
73% of machine-pitch ones. That curve is the card's now, the owner's ruling of 1 November 2026 that
the card follow the model the Gold odds play by, and nothing has been measured of it around the
per-game model's margin. Each side's runs are narrower than the measured ones were, about half
the margin's band either side of the score, since the Gold odds keep a game's projected total and
split it: in that measure both sides scored within 6.5 runs of the engine's expected score in four
games in five, and a band half as wide can be expected to hold fewer.

On the Forecast tab, the seed odds grid has a **Likely** column: the seeds a team finishes in
once the best and worst tenth of simulated seasons are left out, so at least eight simulated
seasons in ten (`seedRange.ts`). It is not the Projected Standings' **Range**, which is the
best and worst seed one remaining result can move the projection to. That walk is a season's
projection for each way each remaining game can go, the games owed beyond the schedule among
them ([Postseason format](#postseason-format)), so it waits until 60 or fewer games remain,
owed ones counted (`useSeedRanges`); until then the column, the phone rows and the Bubble Watch show a
dash and the caption says the range is paused, rather than every team's projection at both
ends, which would read as a seed nothing left to play can move. A team's panel says the same of
its Range, of the seed a win or a loss leaves in each of its next two games, and of its clinch
scenarios, which are those seeds in words; and the Forecast's write-up is told no range. Until
8 November 2026 the panel showed the projection as all three ("#5–#5", "Win: #5 / Loss: #5",
"win projects #5; loss projects #5") while the table said the range was paused, and the writer
was told it as each team's realistic seed range.

## Our team

The Dashboard leads with one team, picked there, for the questions asked at the
field: where are we, what are our chances, who is next. The card gives its place
and record, its Gold % and how far the last result moved it (the last step of the
trend line), its next game with the chance of winning it and the seed a win or a
loss leaves, the magic number once few enough games remain to work it out exactly,
and **Enter a score**, which opens the Schedule on that team's games. The pick is
this browser's, one per season (`readOurTeam`), and deliberately not a setting:
settings travel in a shared link, and a parent's team is not the coach's they send
the standings to. It is not in a backup either, for the same reason. It goes with its season,
so a season made under a deleted one's id follows no team until one is picked there.

The move is said only where it is two points or more (`GOLD_MOVE_SHOWN`), and the trend's last two
points are drawn paired (`buildTrendStates`): from the last one's seed, each game from a stream of
its own keyed to the season and the game (`gameStream`), every season played, so the two runs draw
alike every game they share and their difference is what the result did. Each point drawn from its
own seed, the step was two runs' worth of chance: on 40 synthetic eight-team leagues, measured
against 24,000 seasons a point, it was 1.6 points out where a team not in the game truly moved 0.9,
and 26 of the 235 moves shown went the wrong way. Paired, it is 0.66 out, and of the moves of two
points or more none went the wrong way. One seed on one stream was not enough (1.43): the point
before the result has that game still to play, and every draw after it moved. Every game of a paired
run makes the tie draw, in a league that has had no tie too (`SeasonDraws.tieAlwaysDrawn`): the
point before a league's first tie has no share of ties to draw at, made a draw fewer each game than
the point after, and the step on that result was two runs' chance again: from seed to seed on four
synthetic leagues it spread 2.27 points, where on a win it spread 0.85; drawn every game, 1.05
(0.87 on a win). Only those two points moved; the six before them are as they were to the digit.

When the team is linked to a Team Rankings club, the card also gives the club's place
on its board — "37th of 1,812 nationally (▲3) · top 3% · 4th of 160 in OH · 9U 2027 ·
Fall 2026, as of 9/27". League Standings cannot rank a club itself, since a board is a fit
of the whole year's pool, so each time a board is up on the Team Rankings side the
places of the clubs its page's league seasons are linked to are written to a small
per-browser cache (`leagueClubRanks.ts`), a season's places replaced whole and gone with
the season, and the card reads them with the day they were read, in the reader's own time zone. A board that
settles with none of the season's clubs on it takes their places away rather than
leaving the last ones showing. Only a board of a half the season plays its games in
writes them: a fall league's places are read off the fall board, and looking at the
spring one, which holds none of the league's games, leaves the card as it was rather
than blanking it.

The Standings tab reads the same cache for every team, not just the followed one: under each
linked team's name, "#12 of 3,947 nationally", and beside it a **Scout** button (3.6). Scout
opens Team Rankings' Scouting with that club's report up, on the page its place was read off:
each place keeps the age level, squad year and half of its board (`clubRankPage`), and the
button writes them into the route (`scoutRoute`), so the report is on the board the number came
from. A place kept before pages were opens whatever page Team Rankings would have opened. The
club itself is not put in the URL: Team Rankings carries every parameter it does not own from
page to page, so a club named there would reopen its report on every later visit and reload.
It is held in memory instead (`scoutRequest.ts`) and let go once a page, the cloud's board or
this device's own, has it on screen.

Each place also says its share of its board ("#12 of 3,947 nationally · top 1%",
`topShare`), since a board fills all season and a place alone sinks for a club holding its
own. Above the table, the league's strength, from the same places (`leagueStrength`): how many
of its teams Team Rankings places, the median team's share of its national board, and, where at
least half of them share a state, how high in that state's clubs they stand on average: "2 of 9
teams on Team Rankings · the median team in the top 16% nationally · on average in the top 17%
of KY's clubs". Not a place among the state's leagues, the owner's ask of 27 October 2026, since
nothing in the pool says which other leagues there are: a league is what its season names, and
the groups the fit finds by who played whom are not leagues (the Longhorns' league of 8 was a
group of 60 to the fit). Nothing more is read or published for it.

## Games in playing order

Every Team Rankings list of games is in the order the games are played: by day, then by start
time where GameChanger gave one (`ScoutGame.startTs`), a game with no start after the day's
timed ones (the game-time helpers in `date.ts`). Newest-first lists put a day's later game first.
Since 1 November 2026 the start is shown too, in the reader's own time, wherever a game is listed
with its day: the My Team card's next game ("Next: Sat, Oct 31 · 9:30 AM") and the two games its
weekend line names ("Sat 9:30 AM"), Scouting's Next up, a club's panel and the Games tab
(`dayAndTime`, as League Standings' Schedule says it), and The Weekly's game of the week ([The Weekly](data/views.md),
"The Weekly"). A game with no start says its day alone.
Until then the start ordered the lists and was not shown, so a tournament Saturday's five games
were in order with nothing to say which was at 9:30 and which at 7:00, and the panel and the Games
tab printed the day as stored ("2026-10-31"). The lists a phone reads carry it to the minute: a club card's game as `t`,
a page's Games list as `times` beside its games (so a reader from before them still takes each
game's seven fields), both in whole minutes since 1970. A card's game is found for an edit by
everything else it shows (`cardFixture`), so a card from before the start, or one carrying it in
its own form, still names the stored game. A League Standings game comes in with the start its
season keeps (`deriveLeagueScoutGames`), and a league's scored game kept in place of a pulled copy
of it takes the copy's start where it has none (`dedupeLeagueFixtures`): the copies giving its
score, read from either seat with who won kept, all at one minute, and no other league game of
that day between the two having that score, since two games of one score are not told apart by
it, whether one game's copy is in the pool or both. A club's own copy filed against a slot ("TBD-
09/25/26, 7:15 PM", `leagueCopiesFiledAgainstNobody`) gives the league's game it folds into its
start the same way. Both came in untimed, so a league doubleheader was listed second game first
and the later game named as next. No rating reads a start. The Weekly's streaks do, reading a
club's games in playing order, but the seeded fixture's whole boards with every league game timed,
the Weekly's included, are its boards with none, to the digit (`leagueStartsBoards.test.ts`). Its
game of the week carries its game's start to be said, and none of the fixture's is a league game;
given starts of their own, each board's week is the one it published before, start aside.

League Standings keeps each game's start too (`Matchup.startTs`, data schema 9): from a start's
draft (Team Rankings clubs or a GameChanger organization), on a game Fill adds, and on every game
Fill matches that has none, or has one on another day both than its date and than the pool game's
start, read in the device's time (`startsFromFill`; a start changes no score, so it is given
whether or not the score is ticked). In the league's own zone the two readings are one. Further
east either alone takes a start of the game's own day for another's: against the date, a
morning's in the Americas, the next day in Sydney; against the pool's start, one of two starts
hours apart, which fall on two days in Tokyo. So a start either reading puts on the game's day is
kept (`leagueGameTimes.test.ts` reads Fill's starts in nine zones, Los Angeles to Auckland, and a
start left from the evening before where the league plays). A start is its day's: a game given
another day in the Schedule lets go of its start, and one Fill moves to the day it was played
takes the pool game's start, or none (`movesToApply`). Kept, the moved game showed the old day's
time and was listed by it among the new day's games, and Fill never gave it another. The
Schedule, the Dashboard's upcoming games, the Playoff machine, each team's next game and the
Forecast's notes that name one ("Eliminated if the Bears beat them next", and the rival's game a
team needs help from, `clinchingPaths.ts`) go by day and then start (`inPlayingOrder`, which
breaks a day's tie by start since 31 October 2026; the notes read the schedule's stored order
until then, a round robin's pairings, its dates typed in after), and the Schedule and the
Dashboard show the start in the device's own time ("5/3 · 10:30 AM"). The forecast's own order of
the games left is not changed, so no odds move. A game typed in has no start and is listed after
the day's timed games.

## A season's team list, then its schedule

A new season starts with its teams, saved before any game exists: typed one a line on the
empty season's page and saved, then added to on a later visit from the Schedule tab, where each
can be renamed or taken off. "Lock team list" sets it (`Settings.teamsLocked`, data schema 8),
and only then does the Schedule offer its tools: a round robin over the saved teams with their
ids kept (`roundRobinFor`), the league's schedule pasted, or games added one at a time. The list
opens again only while no game exists; once one does, it is set for good (`teamListLocked`), so
the standings never meet a team that appears or goes mid-season. A season with teams from before
lists were kept, or started from its clubs, reads as set. Each step is an ordinary season edit.

## A league's schedule, pasted

A season with no games yet can take its league's schedule as the league's website, a
spreadsheet or a CSV prints it: the Schedule tab offers **Paste the league's schedule** under "No
games yet.", and the empty season's team-list box has **Read as a schedule**, which reads what is
in the box. It is offered only while the season has no games at all, not when a filter hides every
game, since nothing read is matched against games already there. The reading
(`leagueScheduleText.ts`) is done on the device and keeps which side hosted, which Team Rankings'
paste reader (`scheduleText.ts`) throws away; it borrows that reader's cell splitter, header reader
and month words, whose own output is pinned. It reads a table whose header names Home and Away (or
Visitor) columns, its date from the Date column (or another column written wholly as a day, since a
"Day, Date" header names the weekday's column first), a date and time in one cell included; lines
like `4/10 Falcons @ Wolves`, where the team after "@" or "at" is at home, and `Wolves vs Falcons`,
where the first team is; rows laid out in cells, as a spreadsheet or a calendar export writes them
(`4/10/2027,9:00 AM,Falcons @ Wolves,Field 1`), the game read from its own cell and a place or a
game number left out; and a table with no header, read away then home and marked as a guess. A line
that is only a date, or a date with a start time ("Sat 4/12 9:00 AM"), dates the games under it;
start times and fields are passed over: "9 AM" as well as "9:00 AM", a range ("9:00-11:00 AM",
"9-11 AM"; a range of bare hours only with its AM or PM, since "9-11" alone is as likely a score or a
day, and a day at the front of a line is passed over for a range only in that shape, so "4/12 Am
Comets" is still on 4/12), a US time zone after the time ("6:30 PM EDT", "7 PM (CT)"), "Noon", and
"TBA" for a start not set yet, which a site printing the zone had made "EDT Falcons" of every away
team. A zone is read in capitals only, as sites print one: read in any case, a town's short form
after a time came off the team's name, "6:30 PM Mt Comets" a team "Comets". A score at the end
of a line is read in the order the teams were written, unless both names end alike ("Falcons 9-10 @
Wolves 9-10"), which is an age span; so is one written beside each side ("Falcons 7 @ Wolves 5"),
where both sides end in a number, the names left are two names and the numbers differ: "Team 1 @
Team 2" is two squads of one name, and "Cubs 10 @ Reds 10" a number written on each, while "Falcons
0 @ Wolves 0" is a 0-0, as nothing else can be. A line with no comma past its day is split at its
bars, as sites print "Sat Apr 12 | 9:00 AM | Falcons @ Wolves | Riverside Park", and read as cells,
the place left out; a CSV's cells are its commas, so a bar there stays in a name, and a line with no
cell wholly a day, a time or a field is read whole, "Aces | Blue @ Wolves" included. A line with two
markers, a TBD side, a game cancelled, rained out, postponed or suspended, or a day no calendar has
("Apr 31", never rolled on to May 1) is listed as left out rather than guessed at. A date with no
year is placed in the year the paste wrote (on the date, in a heading, or in a title such as "Spring
2027 Schedule"), else in the squad year the season is filed under in Team Rankings, else the one its
name says ("Fall 2026" is squad year 2027, and "2026 Fall - 2027 Spring" is 2027, `seasonNames.ts`),
else the one being played today, with August to December in the year before.

Every game is looked over before anything is added, with a Swap on each row; on a phone each game is
a small block, its sides one under the other, so the Swap is on screen. Names are told apart as the
paste writes them, a coach's name in brackets and an age label included (`pasteNameKey`): one league
can have "Heat (Ealey)" and "Heat (Smith)", or "Wolves 9U" and "Wolves 10U", which `teamNameKey`
would read as one team. A name written the way one of the season's teams is, or the way the app
shows it (`displayName`, which leaves off "NKB" and the like), is that team. One that is a team's
name with an age label or an aside more or less ("Wolves 9U" for "Wolves") is that team too when it
fits that team alone, shown as "as Wolves"; two different asides or ages never match. One close to a
team is offered as it and used only once ticked; any other becomes a team of its own. In a season with no teams every name becomes one, and
in one with teams the games naming a new one start unticked. A score read becomes a final game, as
Fill scores adds its games. App adds them as one change to the season, which is one save and one
step to undo, clears a team filter kept on the Schedule as the other ways to start a season do, and
refuses while the season may not be written or once it has changed since the review was drawn. The
panel is fetched only when opened, so none of it is in the first download, and neither is the empty
season's start screen, drawn inside the views' boundary, whose Try again fetches it afresh.

## Seasons at a glance

The Seasons card in Settings has **Seasons at a glance**: every season this device holds, how each
ended or how far it has got, and the team followed in it. One league's seasons are set side by side,
grouped by their names with the year taken out (`seasonNameStem`, `seasonNames.ts`: "Fall 2026" and
"Fall 2027" are both "Fall", "NKB 9U 2026-27" is "NKB 9U", "Spring '26" is "Spring", while "Spring
2026 - 27 teams" keeps its count; a name with no year is a league of its own), each group newest
first by the squad year its name gives, a short year included ("Spring '26" is 2026), or else the
squad year it was made in, and then by when it was made here. A finished season gives the regular
season's winner, the champion, the Silver champion and the followed team's finish in the Dashboard's
own words (`seasonFinalOf`), and whether that team made the Gold bracket; one still being played
says how many of its games are final, who leads, and where the followed team stands.

Each season is worked out from its stored copy (`seasonGlance.ts`), with no engine, worker or odds:
the standings' own table (`calculateTeams`, `rankTeams`) and, once no regular-season game is left,
the brackets App builds, seeded by that table with the cutoff App uses (`effectiveGoldCutoff`, in
`sim.ts` for both). With nothing left to play the Dashboard's seeding by projected place is that
table, so a champion named here is the Dashboard's. A champion is named only from a bracket the
field decided, every game in it played or a bye: a game with no score is the model's pick, and the
glance's model lacks the ratings Team Rankings gives the Dashboard's, so a final played between two
teams the model put there could be read for other teams. Such a season names no champion rather than
a different one, and says why in words that are so: that its bracket's final has no score yet, or,
where the final has one, that a game in the bracket has no winner yet.

Nothing is read until it is opened: the card fetches the glance's code the first time, saying it is
loading meanwhile, and only then reads the seasons from this browser's storage. Each season's glance
is remembered for the visit against its creation time, its last save (`updatedAt`) and the team
followed, so opening it again works out only the seasons saved since. It is read again when the list
of seasons or the open season changes, not as a season is edited, and there is no refresh; the open
season is read as last saved, so a score marked final in the half second before its scores are saved
is not yet in it. A season League kept live holds a copy of on this device
(`lf_league_base_<docId>_v1`, of this season and not a deleted one whose id it reuses) that is not
the open season is marked "May be behind: this device's copy as of 12 days ago" (`agoLabel` on its
`updatedAt`): only the open season is followed live, so another device may have moved the others on.
Nothing is fetched to catch one up; the glance makes no request, read or write of the cloud.

## Archiving a season

A season the league is done with can be archived (`seasonArchive.ts`, the owner's choices of 2
November 2026). It is listed apart: under an **Archived** heading at the foot of the season picker
in the header, and under **Archived** in Settings → Seasons, where each season has Archive or
Unarchive beside Switch (Open, for an archived one), Duplicate and Delete. Seasons at a glance lists
it as before. Opened, an archived season is read-only: a line over every tab says so, with an
Unarchive button, every control that edits the season is off, and the season's store refuses any
edit from elsewhere (the team drawer, a shared link, a toast's Undo) with the same reason, as it
does in a tab another has the turn from. Any season can be archived; once one is over (every game
final and, where there is a postseason, its champion decided), the Dashboard's "Season over" card
offers **Archive this season** itself, and Unarchive once it is. Its games and scores are as they
were and still count wherever they did, Team Rankings included. A copy made with Duplicate is in
use, whatever the season it was copied from.

The mark is the season's own setting, so it is the same on every device (League layout 3, data
schema 12; an older build still open reads the season read-only until it reloads):

- **The season on screen** has the mark set among its settings and saved with them, and while
  League is live it goes to the cloud as any setting does, in the open season's next write. The
  read-only lock is the mark's own, so it alone is taken off for the one edit that brings the season
  back; any other reason the season may not be edited this moment refuses that too, saying why.
- **A season that is not open** has the mark written into its settings in this browser, and, while
  League is live, sent at once in one transaction (`sendArchiveMark`): that one setting, the
  layout raised where the document's is older, when it was saved and the next write's number. A
  season not open is otherwise sent only when next opened, which an archived season seldom is.
  Nothing is written where the cloud already says so, where the cloud has no such season, or where
  its season under that id was made at another moment. The write is kept as this device's own
  beside the season's base (`Landed`), as the live store keeps its writes.
- **The visit's meeting** (`meetSeasons`), which reads every season's document already, carries
  the cloud's mark down to each season held here that is not open, so a season archived on the
  phone is listed under Archived on the computer the next time the app opens there. Only the mark:
  the rest of that season is taken in when it is next opened, as ever. A mark changed here since
  this device last knew the document (`archivedAsKnown`: the base, then this device's own writes
  of the mark that had landed by the cloud's version) is kept and sent, so a season archived
  offline reaches the cloud at the next visit; with nothing known of the document, the cloud's
  mark is taken, as a first opening takes the cloud's record where both sides hold one.

No read is added: the open season's mark rides in its write, and the meeting reads nothing it did
not read before. Archiving a season that is not open is one transaction, a read and a write, each
time it is pressed, and the meeting writes only a mark this device changed and could not send.

## Data Quality

What in a season's games, teams and settings is wrong or worth a second look, each as a
finding (`src/lib/leagueFindings.ts`, 2.3) with a stable code, a severity, the games, teams or
setting it is about, why it matters, what to do, whether it makes the forecast less to be
trusted, and a fingerprint. The Dashboard keeps only the count of each severity and a line when
the forecast is affected; the **Data Quality** tab lists them in three groups:

- **Needs attention**: a season of one team (one with none is still being set up, and
  raises nothing), a game naming a team not on the roster, a team against itself, a final
  with a score missing (counted as if that side scored nothing), a past game scored and never
  marked final (not counted at all), a Gold cut line every team is on one side of, one Team
  Rankings club linked to two league teams while its results count.
- **Worth reviewing**: the same game on the schedule twice, a past game still without a score, a
  date that cannot be read, a final over 40 runs a side or won by 40 or more, fewer games
  scheduled than the games-per-team setting (which holds clinching back), teams without a final
  once the league has played about three games each, two teams of one name, a link to a club
  Team Rankings no longer has, a link whose club no longer carries the GameChanger team it was
  picked as, which no one club carries.
- **Information**: an undated game, a schedule giving teams two or more games apart, teams
  without a final early on, a link guessed from a name more than one club carries, two finals of
  one pair on one day with different scores.

The same game twice is never a finding that needs attention, since that could not be put aside
and a league date carries no time: two games of one pair on one day are a copy or a doubleheader,
and only the commissioner knows which. Until it is put aside it affects the forecast, which plays
each copy not yet final as a game still to come and counts each final, so the finding names both
possibilities. Two finals with different scores are two games played and read as a doubleheader,
information only; two with one score are what one game entered twice looks like, and a finding
put aside as a doubleheader comes back only then.

League dates carry no year, so what is past is read with the season on one timeline: in its own
order (`seasonStartMonth`, as the rest of the app reads it), placed in whichever year puts the
whole season nearest today (`seasonDaysFromToday`). A spring season seen in October is all past,
its March games with its May ones; next spring's schedule entered in December is all to come, its
June with its March; and a December game seen in January was last month's. Read a date at a time,
each in its own nearest year, a season more than about six months from today was split, its far
end on the wrong side of today. Each finding links to
what it is about: a game opens the Schedule with its card focused, a team its panel, a setting
the field in Settings. Three can be put right from the tab, each after a preview of exactly what
it will do, as one undo step, and reported by what it actually changed, worked out again from
the season as it stands: **Delete the extra copies** (only copies with nothing at all entered on
them, a box score without runs counting as something, never the last copy of a game, even if
another device deleted the one kept while the question was open, and asked first), **Mark them
final** (past games with both scores in), and **Use the schedule's count** for games per team. A finding that does not need attention can be **put aside** on this device,
per season (`readPutAside`); it comes back when what it is about changes or it grows more
serious, and a finding that needs attention cannot be put aside. What is put aside goes with its
season: a season made under a deleted one's id, from the same team names, has the same
fingerprints, and would otherwise find its findings already put aside.

## Since you last looked

League Standings kept live takes in other devices' edits as they are made: another coach's
scores, a game moved, a team renamed. A device that was closed, or on Team Rankings, used to come
back to a season that was simply different. Now each device keeps the season as it last looked at
it (`src/lib/seasonDigest.ts`, 2.6, a line per game and team and where each team stood in the
race, a few kilobytes per season, kept for the last 12 seasons opened), and the Dashboard opens
with **Since you last looked** while anything differs: counted ("3 new finals, 1 corrected score
and 1 clinch"), then listed, the followed team's first, each a link to its game or team, until
**Got it**. The Dashboard's tab carries the count meanwhile, in a phone's bar too.

- **What counts:** a new final, a corrected one, one no longer final, a game added, moved, given
  another opponent or removed, a final's box score changed, a team added, removed or renamed, a
  team clinching a Gold Bracket place or eliminated from one, and the followed team's Gold chance
  moving by the notification setting's points (10 while notifications are off, or set to never
  tell of it; `digestOddsMove`). Runs typed into a game not yet final are no one's news.
- **What this device does itself is never news.** The season store says where each change came
  from (`SeasonChange`): this page's own edit is taken as seen as it is made, another device's is
  news, and a season opened brings its own last look. A forecast that follows an edit made here
  is taken as seen too, unless news from elsewhere is still unread, which it may follow from; an
  edit that moves nothing the forecast reads (runs typed into a game still being played, a bracket
  score) leaves the next forecast to be news like any other.
- **Where looking starts.** The first time a device opens a season, what it holds once League kept
  live has heard the cloud for it is where its looking starts, not 48 games of news: the cloud's
  version laid over its own, or its own when the cloud held nothing it lacked (League goes live
  either way, and that is the moment). The race starts from the forecast of that season, worked
  out afresh when the cloud's word brought scores, not from the one on screen before them. A full
  backup restored here is this device's doing as well: each season it restores that the device
  had looked at is taken as seen as restored (`applyFullBackup`), not only the one that opens. A
  restore that could not write every season takes none of them as seen. Once it has written the
  list of seasons, those it left out or replaced have still lost their looks, as everything kept of
  a season goes with it ([Data + persistence](data/README.md#data--persistence)); only a restore that could not
  write that list leaves every look as it was.
- **One device, however many tabs.** The installed app beside a browser tab is two pages each
  kept live, and each hears the other's edits from the cloud as it would another device's. The
  last look is the device's, so each tab writes only what it took as seen, laid over the look as
  stored, and takes from the stored look what reads as it does in the season it shows: an edit
  made in one tab is seen in the other when it arrives there, the forecast after it once the tab
  that made it has taken it as seen, and a Got it in one is a Got it in all of them. A clinch the
  news brings, when Got it came before the forecast settled, is still news in each. This holds
  where the pages share the browser's storage, which is how they hear of each other. On an iPhone
  or iPad an app added to the Home Screen, and on a Mac a web app added to the Dock from Safari,
  keeps storage of its own apart from the browser, so it is a device of its own, with its own
  last look, notification choices and record of what it has announced.
- **A last look is one season's.** It goes when its season leaves the browser, and a season made
  under a deleted one's id starts with none of it, as with everything else a device keeps of a
  season ([Data + persistence](data/README.md#data--persistence)): otherwise the deleted season's games and
  teams were listed as removed since the last look. Another tab still showing the season does
  not put its look back when it hears it go, nor when anything is done in it afterwards: a tab
  whose look another tab let go of, by a deletion, a restore, a cloud merge or Start again,
  keeps none of that season until it opens one again.

**The big card.** Opening the Dashboard after an hour or more away starts with a card of what
moved for the team followed since the last visit, counting what was entered on this device too,
which the list above never tells (`src/lib/sinceLastLook.ts`, `SinceLastLook.tsx`): its place and
Gold odds then and now, the numbers running from one to the other (shown at once where motion is
turned down); each result since, with the chance the team was given while the game was still to
play (the one the Dashboard showed, the per-game model's, as every League screen gives it); the
upset of the stretch, the new final whose winner had been given the least chance, under
one in two; and who passed the team and whom it passed. With no team followed it gives the new
results' count, the upset and the biggest climb. The card stands in the list's place while it is
up, and **Got it** puts both away as they stood when the card came up: the card is what the season
had come to as it was worked out, and stays so while it is up. What another device changed after
that is listed once the card is put away (`seenAsListed`), and the next visit's card tells what
moved since it came up. Got it used to keep the season as it stood at the press, so a final that
arrived while the card was up was taken as seen, and neither the card nor the list ever told it.

- **A look, one per season, on this device only** (`lf_last_look_v1_<season>`): each team's place
  and Gold odds, the games final, and the chance each game still to play was given, which nothing
  else keeps once the game is final. The first visit only keeps one; later, a look an hour old or
  more is compared with, and the look the card was worked out from is kept at **Got it**, or at
  once when nothing a person would want told moved (no new final, no place changed, the Gold odds
  within a point). Left without Got it, the card is there the next time.
- **One season's, by the moment it was made.** The look is kept apart from what goes with its
  season ([Data + persistence](data/README.md#data--persistence)), and keeps when its season was made
  (`createdAt`, read in the card's own file, so the first download carries none of it): a look of
  a season made at another moment than the one now under its id (a deleted season's, or this
  device's before a restore or a cloud merge put another under the id) is no look, and the season
  starts afresh.
  Compared with it, every final of the season now under the id was told as new. A look kept before
  looks said so reads as the season's.
- **Taken once the forecast describes the season:** while the Gold odds are still being worked
  out after the latest scores, a look would keep the odds from before them.
- **Fetched as the Dashboard opens**, a file of its own (3.5 KB with the pieces it shares with
  Team Rankings' My Team card), so the Dashboard's own load and the first download carry only its
  place. Nothing is read from or written to the cloud.

**Notifications**, in Settings, are off until turned on, and the browser is asked for permission
only then. Each kind is a choice of its own: the followed team's finals and corrected scores, its
schedule changes, clinches, eliminations, the followed team's Gold chance moving by 5 to 25
points, and League Standings stopping on something a person has to see to (a season deleted on
another device, one the cloud cannot read). **Send a test notification** shows it works.
They come only while League Forecast is open, in a tab or installed, and only for news that
arrived after the page was put away: gathered for 20 seconds into one notification, so a run of
scores is one, and each change announced once on the device however many tabs are open or times
it reloads (`readNotified`, one tab at a time through the Web Locks API). A move in the odds is
the same news while it stays within the same whole steps of the chosen points, which way it went
from the last look, so it is not announced again each time a final elsewhere moves the forecast a
point; a game given a second new opponent is news again. A choice changed in one tab holds in the
others at once, where they share storage as above. What a season has had announced goes with
the season, so one made under a deleted season's id, from the same team names, still has its
clinches and eliminations announced. Pressing one comes back to the app
(`public/notification-click.js`, in the service worker). Nothing is sent to a server, and
**nothing arrives while the app is closed**: that needs a push service holding each device's
subscription and sending to it, which the app does not have.

## Settings

| Setting               | Effect                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Season label          | Header/export label.                                                                                                                                                      |
| Postseason            | `Cut line` (top N make the Gold Bracket), `Bracket, no cut` (every team qualifies), or `No postseason`.                                                                   |
| Gold cutoff           | Number of teams in the Gold Bracket. Only applies when the postseason is set to `Cut line`.                                                                               |
| Score detail          | `Runs only` (the default) or `Full box score`. Runs alone drive the standings, the records and every projection; the fuller box score only adds the per-game stat pages.  |
| Score errors          | Full box score and Kid Pitch only. Off drops the E box from score entry and E/G from the stat pages.                                                                      |
| Win / Tie points      | League standings, simulations, and Gold status.                                                                                                                           |
| Tiebreaker order      | Score tiebreakers after league points and fewer losses: two-team head-to-head, run differential, runs allowed, runs scored.                                               |
| Team Rankings results | Whether tournament games logged in Team Rankings sharpen this league's game forecasts (`useScoutResults`). Forecasts only — records and standings are always league-only. |
| Recap grouping        | Builds stories per game, date, or week.                                                                                                                                   |
| Model aggression      | Prediction weighting profile.                                                                                                                                             |
