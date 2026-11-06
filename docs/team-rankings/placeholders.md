# Placeholders

_Part of the design documents; the map is in the repository's [README](../../README.md)._

"TBD", "Winner of Game 3", a blank cell on a bracket: a schedule says these when
nobody has decided who is playing yet. They are kept as **slots**, not teams.

The game is real, so it is kept and it counts for the club that played it — a
slot stands in the fit as one unknown opponent, and beating one reads much like
beating an ordinary team.

**Except a slot listed as TBD**, the owner's rule of 26 October 2026: "That TBD
game should be paired with another team that played at that date and time. If it
doesn't. It shouldn't count." Where the other club's schedule names the club at
that start, the slot's row was already folded into that game (below) and counts
once, between the two. A scored row still against a TBD slot after the tidy counts
for nothing (`markTbdGames`, marked `ScoutGame.countedElsewhere`). If another
team's schedule has the club at about that hour, that game counts in its place.
If nobody's does, there is no telling who was played. Either way the row stays on
the club's page, and its pill says which game counts instead, or that nothing
pairs it. The Edgewood Longhorns, 9U in Kentucky, were 9-0 on the board against
a league that had them 8-0; the ninth was a 20-5 over "TBD- 08/29/26, 3:00 PM".
Only TBD (and "To be determined") counts as TBD here: "TBA" and "TBC" can be a
club's initials, and "Winner of Game 3" is left as above. A game still to come
against a TBD slot is the club's next game as before.

What a slot never does is gather. Every placeholder is
its own slot, because a single shared "TBD" would sit in the rating graph as an
opponent that dozens of unrelated clubs had all played, and the model would read
that as evidence about how they compare to each other. Slots are not ranked,
never offered as a name to log a game against, and never matched to a real club
that looks similar.

A slot is not a club even when GameChanger has a club of that name. Coaches make
teams called "Tbd", "Practice", "Scrimmage" or "14U" to hold a date, and a
nationwide pull fetches them like any other (the import now refuses a "Practice" or a
"Scrimmage" outright, and the tidy deletes one already pulled; **Softball, and pages that are no
team, are left out**); filed on one, every undecided game in
the country joined it, so a Puerto Rico club's "TBD" and an Ohio club's sat on one
Washington "Tbd". A name that could be nothing but a slot — the whole of it a slot
word, a round, an age, or "TBD" and when — is filed as a slot whoever carries the
name (`namesNobody`), and the tidy takes rows filed on such a club by name off it
again: 25 rows on the backup of 26 September 2026. The club's own schedule is left
alone. A longer name still goes to the one pulled club that carries it, since a
club really can call its squad "Miami Bulldogs Tournament".

**One fixture listed twice on a club's own schedule.** GameChanger does this: the
same game arrives under two game ids, with the opponent spelled two ways —
"Cincinnati Angels Red" and "Cincinnati Angels- Red", 13-21 on both — and a club's
record counted the loss twice. The opponent resolves to one team either way, since
`teamNameKey` reads punctuation between words as spacing; it was the two rows that
stayed two games.

Two ids off one schedule are normally two games, and that stays the rule. A real
pull found four games against one club on a single day, and folding those together
would delete three results. The exception is narrow and rests on a fact rather than
a guess: **nobody plays two games at once**, so where both rows carry a start time
and it is the same one, there is only one fixture there. "The same one" means under
a minute apart: 1,013 rows of the pool of 24 September 2026 started at an odd second
or millisecond, and 12 pairs off one schedule were a fraction of a second apart.

The same fact settles it when the two rows disagree about the score. Two different
results at one start time is a disagreement about one game, not two games — keeping
both counted a loss and a win for a game played once. The game keeps the score the row
it stands on gives, and the other listing's is written into the game's note, the way the
two sides of a fixture that disagree are already noted, so nothing is lost silently.
Where the row the game stands on has no score, the other listing's fills it, marked as
that listing's (`scoreFromTwin`): it goes with the listing if the two turn out to be two
games, and gives way the moment the game's own row posts. Kept as the game's own, a
listing's score stayed behind when a doubleheader first listed at one placeholder start
came apart, and the result counted twice.

Within the hour, one schedule's two rows are one game only when they give the same
result. A coach writes a doubleheader down at its slot times, and the same pool held
109 pairs of rows exactly an hour apart with two different results — 23-6 and 12-2 —
that are plainly two games. A repeated result is different: of 212 scored pairs off
one schedule within the hour, 34 gave the same result (16%), against 81 of 6,044
pairs two hours or more apart (1.3%), which are doubleheaders. That is the same game
listed twice.

Where a start time is missing from either row the two are kept, however alike they
look — with nothing to tell a repeated fixture from a repeated row, losing a real
game is the worse error.

An all-day entry counts as having no start time. GameChanger writes a start for one
anyway, midnight UTC with no timezone in the entries audited on 24 September 2026,
and read as a time it made every all-day game on a date the same instant. Its date
is kept and the placeholder is not.

**One game on two clubs' schedules.** A start on a schedule is when the game was
planned. A tournament runs behind and neither coach moves the placeholder, so the two
clubs' copies of one game drift apart: Legacy Baseball Club had its 14-2 win over
River City Raptors on 29 August 2026 at 1:00 PM, the Raptors had it at 2:00 PM, and the pool
held it twice, because two starts used to mean two games whoever wrote them down. On
the pool of 24 September 2026, 1,213 pairs of rows off two schedules gave the same pair
the same result on the same day at different starts; the same search a week off, where
no game is, found 7.

So a row off the other club's schedule can be the same game on any of these, strongest
first:

| Two clubs' copies of a day's meeting                         | One game?                                   |
| ------------------------------------------------------------ | ------------------------------------------- |
| Starting within the hour, with the same result               | Yes — 1,115 of the 1,213 were within it     |
| The same result, however far apart the clocks                | Yes, the nearer the likelier                |
| At the very same start, a result still to come on one side   | Yes                                         |
| Starting within the hour, a result still to come on one side | Yes, the nearer the likelier                |
| No start on one side                                         | Yes, a copy with a result first             |
| Starting within the hour, scored differently                 | Yes, each club keeping its own score        |
| Neither, left on each schedule that day with nothing to pair | Yes, by count, as many as the shorter list  |
| The rest of the longer list                                  | No — that is a game only one of them listed |
| A day apart, the same result or the same start               | Yes, where nothing else those days could be |
| On two GameChanger teams of one club, left by the links      | No — one club's two teams are not a count   |

**A day is read whole.** Which copy each game takes is decided for the whole day at once
rather than a link at a time (`planDay`): every way of pairing the two schedules' games is
weighed, and the one that best accounts for both schedules together wins. The strongest
single link first used to lose a result wherever it was the wrong link for the day — three
review rounds found one shape after another — and each rule added to rank one link over
another moved the loss to another shape. The weighing:

- **Both schedules' games in both schedules' order.** A coach lists the games in the order
  they were played, whatever the clock says, so first pairs with first. Legacy posts game 1
  of a doubleheader as an 8-11 loss and the Raptors post game 2 as an 11-8 win an hour
  later: the Raptors' copy belongs to game 2, not to game 1 because the score repeats. And a
  clock exactly an hour out all day pairs 9:00 with 10:00 and 10:00 with 11:00, rather than
  the two 10:00 rows. Rows with no start fit wherever they fit best.
- **A result that agrees outranks a copy with nothing in it, however near.** Taken for a
  blank game beside it, a copy's result counts twice until the other game is posted, and for
  good if that game was a slot never played. On the pool of 24 September 2026 a 9U club with
  four games was charged one 9-12 loss twice that way. Taken for the game it repeats, the
  worst is a result missing until it is posted, and once both clubs have scored everything,
  the same result within the hour puts each copy where it belongs.
- **A scorekeepers' dispute is worth little** — two different results within the hour are
  one game when nothing else explains them, but never at the cost of a result that agrees —
  **except at the very same start**, where two scores within four runs of each other are one
  game ahead of a blank copy elsewhere. Of the 131 games two schedules scored differently in
  the pool of 24 September 2026, 94 were a single run apart and 117 within four. A wider
  dispute is still one game where nothing reads better — mostly one entry's slip, a 13-6
  win entered from the wrong seat or 20 typed for 11 — but it is worth no more than the
  least of disputes, so a 4-4 at the same start as a 0-10 does not outbid a clock an hour
  out.
- **A result is never lent to a blank game while a scored game it could be, at least as
  near, is left with no copy of its own** — one with the same result, or within four runs:
  it would count twice. A 4-4 at 10:00 against the other club's 5-4 at 10:00 once went to an
  all-day blank on one schedule and stood as two games; where the nearer game has a copy of
  its own, as in a doubleheader whose clocks sit an hour apart, the result is the blank
  game's to take.
- **One schedule repeating a result within the hour is that schedule listing the game
  twice** — worth less than any pairing of those rows with the other club's copies, so it
  is read that way only where the other club does not list a game for each. A mercy-rule
  doubleheader, 10-0 twice, stays two games wherever the other club lists both slots,
  posted or not, timed or all day. A game listed twice is as near the other club's copy as
  the nearer of its two rows.
- **Two copies that contradict are never one game** by any link, but **what the day leaves
  is settled by count** (`pairedByCount`). Two clubs each list every game they play each
  other, so a game on one schedule that nothing on the other accounts for is one of the
  other's, under a clock or a score that did not read as it: a tournament running behind with
  nobody moving the placeholders, a coach's GameChanger set to another zone, 3:00 typed for
  15:00, two scorekeepers who disagree. On the pool of 24 September 2026, after the links, 786
  days still had such a game on each schedule, each counted twice; 660 had one a side, 432 of
  those at clocks a whole number of hours apart — 199 two hours, 58 twelve. So as many are
  paired as the shorter list holds, whatever they say: in both schedules' order first, as the
  plan itself has it — paired for two scores four runs apart, a club's two wins on a clock four
  and a half hours out became one game — then the pairing whose copies read most alike (the
  same result, a dispute within four runs, a start twelve hours out), then the nearer starts. A
  club's 8-3 win at 19:00 goes to the other's 6-8 loss at 15:30, not its 0-2 at 17:00. Two
  GameChanger teams of one club are not two accounts of a game, so they are never paired by
  count: each lists its own games, and a result paired wrongly would be lost.
- **The same rows read the same way whatever order they were pulled in.** A copy is read
  by its scored rows and the best of them, and every choice between readings falls to the
  rows' ids, never to their place in the pool: a fuzz of 2,000 days found 50 that read
  differently when only the order of their rows changed, until that was so.

Each schedule's rows at one start are one game before any of this (nobody plays two games
at once). Days with a row that no schedule stands behind, such as a game typed in by hand,
or with three schedules, are few (one in the pool) and are still settled a link at a time,
with the same guard against contradicting copies. A game takes one row off each schedule,
and two games that each hold a row off both schedules stay two unless the rows share a
start.

**A day apart.** One club can date a game a day off the other: a date typed a day out, or a
game moved to the next day on one schedule only. Once each day was read whole, 466 pairs of
days in that pool had a game one club listed only on the first day and the other only on the
second; in 432 each club listed just that one game, and 212 of those gave the same result on
both schedules, 142 at the same clock time a day apart. Across two days that follow each other,
a game only one club accounts for is joined to the other club's on the same result — before
either day's count, which gave one club's Sunday copy of a 9-10 loss to the other club's blank
Sunday placeholder and left the Saturday's loss to count again, unless both copies have a blank
game on their own day to pair with: a 10-0 win each day, each club scoring one of the two, is
the doubleheader it looks like. After the count, a copy is joined at the very same instant,
which is one game however it was dated, and on the same clock a day off where the results do not
say two games (one missing, or within four runs), where nothing else either club lists those
two days could be it: 284 copies in that pool. A result that merely comes close, or none at
all, hours apart across midnight, is left as two; so is a start a day off with results further
apart than scorekeepers are, fifteen in all, five of them naming different winners. The copy
folded in keeps its own day, so if it stands up again it stands up on that day.

**A fold is never final.** A game keeps every row folded into it whole — the schedule,
the row's id, its start, its day where that is not the game's, and its score from its own
seat (`alsoRows`) — and every tidy stands those rows back up, each on its own day, beside the
games still standing and groups the days again from scratch. So a fold made on one day's schedules answers to the next day's: a copy that
went to the wrong game of a doubleheader on a tie moves when a score says which it was,
two games listed at one placeholder slot come apart when the schedule moves one, and a
row that fits nothing now stands up as a game under its own id — filed under its own
club's page, by the level it played at, so a cross-age game's copy stood back up is
where a refresh of that page alone finds it by id. (One row filed twice — under one id,
or under a game's id and the id of a row it took over — is kept once: the copy against a
real club over a stand-in, then the one holding folded rows, with the newest score either
copy carries. The tidy used to fold both away, and then to keep the stale copy's.) A re-pull finds its row
by id, updates the record and leaves the grouping to the tidy; a row the schedule no
longer lists — deleted, cancelled, moved to another day — has its record removed on that
schedule's next pull. A game standing on such a row is marked (`withdrawn`), and the next tidy
takes it away and stands up the rows folded into it to be placed again: a game Legacy deleted
and entered again, all day before and timed now, otherwise stood beside its new entry holding
the Raptors' copy, one game counted twice. What the user said of the game goes with each row
that stands in its place: an exclusion, and a score typed in, which is written into every row
folded into the game, blank or not. A game that holds another row of the same schedule still
listed is not taken away — the next pull stands it on that row — and nor is one that holds the
other club's copy only as a schedule on record, with no row to stand up. Nothing is taken on an
answer with no row that can be filed — every row undated, or cancelled, is as likely a field
GameChanger renamed as a club that cancelled its season — nor for a row the answer held in a
shape this app could not read, such as an entry with no opponent: the pull keeps the id of every
entry the schedule answered with (`rowIds`), read or not. The same answers never take the
club's rows out of other clubs' games either. The same regrouping run twice changes nothing, which is what lets
the tidy stop: on the pool of 24 September 2026 a second tidy over the first one's
result, saved and read back, finds nothing to do, and a fuzz of 2,000 random days groups each
the same whatever order its rows came in. A tidy that only moves a row from one
game to another, or takes back a score whose row has gone, counts as a change
(`regrouped`), so the pull that ran it saves it rather than stamping the pool tidied with
the fix left in memory. Records written before rows were kept say only the schedule
(`alsoFrom`), and there a row is taken back only within the hour and agreeing — the
folded row coming back, which 21 of the 23 results listed twice that way in the same pool
were — with the same result however far off the clocks, as any two schedules' copies of one
game are, or at the game's very start whatever it says, which is how an earlier join left two
coaches' different scores at one start.

**One row, one place.** A row folded into one game can also stand as a game of its own, or sit
folded in a second. A refresh of a club's own page cannot see a cross-age copy of its game on the
other club's page (`pullSections`), and filed the row again, against a stand-in where the name
found nobody at that level. The regroup compares the rows of one pair on one day and never saw
both, so the club counted the game twice: on the pool of 18:40, 26 September 2026, 246 rows stood
as a game and sat folded in another, 10 more sat folded in two, and 155 counted twice for their own
club. The tidy now keeps each row in one place (`oneRowOnePlace`). A row folded into two stays in
the one ranked higher, as a repeated id is ranked, then the one whose own result agrees with it,
then the one at its start: 5 Star Coastal Gold's 6-13 sat in CBU Georgia's own 13-6 and in the WA
Bulldogs' blank copy, and there gave the Bulldogs a win GameChanger does not. A row standing as a
game between two real clubs, or holding another schedule's row, stays standing and comes out of the
other game. Otherwise the standing copy is the refresh's and goes, and its start, day and score, the
newest word on the row, go onto the record in the other game for the regroup to read again. Unless
the standing copy says the other game is another game: its own result has the club winning where
the other game's own row has it losing or level, or the other game's only score is the one this row
lent it. Written in regardless, Western Reserve's 5-6 loss to "Western 2" read as Milan winning 6-5
a game Milan's own row lost 3-16, and a 9U club's only result, a tie lent by a row since scored
11-6 against the Diamondbacks, became an 11-6 loss.

On that pool the first tidy takes 2 passes and a second finds nothing. 230 games go; 155
single-link records move, every one toward the club's own rows (124 onto them), and 146 toward
GameChanger's own count (91 onto it). The 9 that move away from GameChanger's land on the club's own
rows: the pool is missing games GameChanger has. No row is in two games after it, and none counts
twice for its club. A club can still count twice where the other game stands on the other club's
own row naming it, since which club that schedule meant is not the tidy's to say; Pool Health lists
those, 512 of them where there were 647.

Such a record answered for the club's row that day with no row to read. When the row came back
filed against another name, the claim step took the game as holding the club's row already, and
the row stood beside it, the same game ten minutes off, counted twice. So a pull now does two
things with a record like that:

- A new row of the schedule, filed by name against nobody the pool knows, that the one copy
  holding the record could be — the same day, within the hour, not scored further apart than
  scorekeepers are — goes back on record in that copy, whole, as it would have stayed had rows
  been kept (`heldOnRecord`). Filed as a game of its own, it once let the tidy pair the copy with
  the club's other game against that club that day, a 3-12 folded into a 6-3.
- Where the answer files no row into the game at all, the schedule comes off the record. Every
  row a pull files goes on record whole, so the row the record stood for is one the schedule no
  longer files there: deleted, or filed now against another name, further off. Which row it was
  is not known, so a row the answer held unread does not keep it, and an answer with no row to
  trust takes nothing off. A different result hours off, the club's one row against the other
  club that day, now reads as the game where the row was kept does: one game, each club's own
  score.

On the pool of 24 September 2026, 20,576 schedules were on record with no row kept. A tidy that
let a club's own row through beside a record of its own schedule within the hour claimed 27 more
rows and left 23 fewer games, and the pulls were left to decide which records had gone. The pool of
26 September said they had not: pulled on an older version, a club's own row stood 353 times
beside a copy holding its schedule on record with the same result within the hour, the game
counted twice. So the claim step no longer reads a record with no row kept as the club's row in
the copy, and takes a row of the club's within the hour of it as it takes one into any other copy;
further off, where the record may be another meeting that day, it leaves both. On that pool it
claims 367 more rows and leaves 367 fewer games, and 357 single-link clubs' records move: 345
toward GameChanger's own record, 242 of them onto it, and 12 away — clubs already short of
GameChanger's count, whose double had hidden a game the pool does not hold.

A start the schedule itself has since moved is taken on the next pull, and so is a day it has
moved the game to, which the rows folded into the game on its old day move to with it: left on
the old day, a game both clubs put back a week stood as two once the other club's copy took the
new one. Another
schedule's start is never written over a row, nor fills a row that has none, since that
is the other coach's clock — an all-day 5-3 win given the Raptors' 2:00 PM start sat at the
very start of Legacy's own 2:00 PM game, and the next tidy read the two as one listed twice.
A game whose own row the schedule deleted, entered again under a new id, stands on the new
row from then on — its result, its start, set or cleared, and the pulls after it — so a
correction to the new row reaches the game, and one entered again all day is not split
from the row it replaced. A club's second listing of a game its first row leaves blank
gives the game its score, corrections included, marked as the listing's. Deleting a club
remembers every row its games stood on, and a game's id where it took over a row entered
again. Deleting a game from Pool Health's dated-ahead list remembers the rows that carried the
score (`scoringRowsOf`): the row the game stands on where the score is its own, and every
folded row with a score of its own. Remembering only the row the game stood on let the other
club's scored copy back on its next pull; remembering every row would keep the other club's
real fixture, a game still to play, out for good. On the pool of 24 September 2026 the tidy
folds 3,866 rows this way, settles 9 slots and stand-ins into the named game beside them, and
claims 2,997 rows filed by name for the other club's copy of the game (**A row filed by name
beside a game the club never listed**, below), leaving 241,471 games. Legacy's page reads six
games again.

**Each club keeps its own score.** The Dragons' schedule says they beat the Hens 11-8;
the Hens' says they lost 8-10; it is one game, listed on both at 10am. The game used to
carry one score, whichever schedule had been pulled last, so the Hens' page could show
the Dragons' version of the Hens' own game, and the score flipped as the daily refresh
went round. Two schedules disagreed about 13,865 games in the pool of 24 September 2026,
563 of them about who won.

Side A of a pulled game is always the club whose schedule it came off — every one of
the pool's 248,371 games — and its score is side A's own. Side B's own schedule's score
now sits beside it (`reportedByB`) instead of over it, and fills it only where side A
has posted nothing yet — marked as borrowed (`scoreFromB`), so it goes if side B's row
moves to another game and gives way the moment side A posts its own. Each club's page
and record read its own schedule
(`scoreSeenBy`); the rating reads the game once, at the average of the two margins
(`ratedMargin`), so the Dragons are rated 2.5 runs better that day and a game both clubs
claim to have won reads as even. A score typed in by hand answers for both clubs and
clears the other schedule's, and the record of side B's row takes the typed score from
that club's seat, or the next tidy would stand the row up and put its old score back.
Every other way a pull fills side A's blank from side B's schedule — settling a "TBD"
into a named game, joining two clubs that each filed the game against a stand-in — marks
the score borrowed the same way.

On that pool the first tidy gives 1,501 folded games both scores, 131 of them different
and 13 disagreeing about the winner, and 160 a score borrowed from side B; the rest fill
in as each club is refreshed. Every
2027 rating moves a little, since every game is fitted together, and none by more than
0.57 of a run.

Most slots name themselves. A bracket posts "TBD" on one team's schedule and
the real fixture on the other's, so pulling both sides answers the question:
after a run, a slot whose fixture another schedule named is folded into that
named row — one fixture, one game, both sides real. The named row wins because
a schedule that names a club is saying who turned up, and a score it had not
posted yet is taken from the slot's row.

That only happens where it is certain. The naming row has to come from another
club's schedule, since a team listing both a placeholder and a named opponent
on one day is playing two games and neither names the other — and nor can a game that
already holds a row off the slot's own schedule, other than the slot row itself (a
refresh of one page files again a row the pool holds folded into a game on another page,
and that copy settles back), unless at the same start: one schedule
lists a game once, and a row settled there was one the regroup stood back up against the
named club, a result filed against a club that never played it. Where both rows
give a start time they have to agree on it, which is what tells the halves of a
doubleheader apart. A day with two clubs that could both be the answer is left
alone.

**A name is checked against the club's own schedule.** GameChanger gives an opponent as the words
a coach typed and nothing else, so a name is where to look, not who played. A game goes on a pulled
club by its name only where that club's own schedule has a game that day or the day either side —
the day either side because two schedules can date one game a day apart, and the collapse joins
those (**A day apart**). Every road a name takes asks it: the import's match (`planOpponent`), the
refile of a stand-in's rows (`refileStandIns`), and the tidy, which takes a row a name filed onto a
club whose own schedule has no game near that day off it, onto a stand-in of the name, or a slot
where the club's name reads as a weekend (`resettleOffLevel`). The game itself is not a name and is
not asked: a club whose own schedule holds the fixture is that club, and so is one the owner said
the row faced (Same team as). A club whose schedule came back empty has no game on any day, so a neighbour's
game against it stands against a stand-in of its name. The user asked for this check on 28
September 2026, when an Illinois club's 8 August loss to "Eagles" sat on the Eagles of Independence,
Kentucky — the one 9U Eagles across Illinois's border — whose own schedule opened on 3 September,
so the page said 1-3 where GameChanger says 1-2. On the backup of 26 September 2026 at 18:40 the
tidy took 23,282 rows off pulled clubs, claimed 717 more into the other club's copy than before, and
changed 4,700 single-link records: 4,395 toward GameChanger's own record, 3,094 of them onto it, and
278 away, 106 of those off it. Of the 278, 191 are clubs whose GameChanger record counts more games
than their own schedule's rows in the pool hold: a game the pull did not bring back, which the name
had stood in for.

**A name no other club carries.** A schedule is written ahead only as far as its coach has got, so
the day check keeps a club's own upcoming games off it until its coach enters them. On 29 September
2026 "513 Force - Bouley" of Cincinnati had one game of its own, and a Kentucky club's and an Ohio
club's schedules each named it for a game in October: search found the club three times, twice as
a stand-in. The user's rule: a name that specific can only be the one club, and a vague "Eagles"
can't be combined. So a name files a row onto a pulled club without a game that day where it can
mean no other (`soleNamesakes`): the one pulled club carrying the name at that level in that squad
year anywhere, in the namer's state or one bordering it; a word of the name in no more of the pulled
clubs' names than one in 18,000 (on that day's pool, two of its 38,296: "bouley" was in one, "eagles"
in 212, and "Samurai", "Arrows", "Walkoff" and "Firebirds" in 8 to 15); and a day no earlier than a
week before the club's own first game of the year. A share rather than a count, because a word is
rare only against enough names to say so: in a fifth of that pool "Walkoff" was in two names, and a
pool of fewer than 18,000 pulled names holds no word rare enough, so a club's own pool keeps the day
check whole. The refile files such a row and the step that takes rows off a club leaves it, asking
the same question. On the backup of 29 September 2026 the tidy filed 3,660 stand-in rows onto 2,018
clubs, 1,047 of them scored, which emptied 1,985 stand-ins; four games two clubs had each filed
against a stand-in for the other were then one game, not two. A second tidy moved nothing.

**A name its namer's neighbour carries.** The day check reads a club's own schedule as the whole
of its season, and a club that keeps only some of its games on GameChanger is not: every game its
opponents scored and it did not stood against a stand-in of its name. On 27 October 2026 a third of
the squad year's games had a stand-in on a side, and the user said the rules were "way too tight".
The second model sweep (**The model, measured**) found 7,540 clubs known only by name with one
pulled club of the name on their page in a state of the clubs naming them. So a name also files a
row onto the one pulled club of it at the row's level and squad year in the namer's state, though
that club has no game that day (`inStateNamesakes`): on a day no earlier than a week before its own
first game of the year, never where one of its own rows that day starts within the hour against
another club, and only where the two clubs are neighbours by their own schedules
(`areOwnNeighbours`): the club's own schedule has played the namer, or each has played a third
pulled club on its own. The refile files such a row and the resettle leaves it, asking the same
question (tidy rules 33).

The neighbour test is what the measurement asked for. Tidied in memory on the cloud copy of 27
October (GitHub run 40448331357), the tidy as it shipped moved nothing, so it was doing what its
rules said; read as the one club of the name in the state, any name, names moved 12,104 rows off
stand-ins and the games leaning on one fell from 33.4% to 30.3%. Of those rows the namer and the
club had met or shared a pulled opponent 50.7% of the time, against 9.7% for another club of the
namer's state on the page put in its place; and a sample showed a rec league's names among them,
"Rangers" naming "Angels" onto the one Angels pulled in Texas. A wrong club passes the neighbour
test about as often as those decoys, so of the rows that pass no more than 10.4% can be wrong
(0.097 of at most 54.6%, over 0.507). Reading a level either side as well added 4,006 rows whose
clubs were neighbours 16.4% of the time, near the decoys' rate, so the rule reads only the row's
level. The model sweep's `--stand-in-rules` mode reads these again (`src/lib/standInRules.ts`).

On 28 October 2026 the owner asked for fewer stand-ins again ("If you can get to 25%, great"), and
the model sweep read what each way of getting there does to the boards' forecasts of the games after
each cut (GitHub runs 40606022999 and 40607594214, 126,563 later decided games). Leaving the
stand-ins' games out forecast clearly worse (log loss z -6.2 for the names holding one game of the
year), so they stay. Filing each name onto the one pulled club of it on its page, any state,
forecast better (z 2.0); spelled near it, or within two levels where none is on its page, no worse
(z 1.4 and 0.2). So a name is also read as the one pulled club that carries it near the namer,
though that club's own schedules have no game that day (`oneNamesake`, tidy rules 34): in the
namer's state or one bordering it, or either of no known state, or further where the two clubs have
met or shared an opponent by both sides' own schedules, as the resettle reads a club far off
(`unvouched`); at the row's level, or failing one there, the one whose name reads the same loosely
(`looseNameKey`), or the one of the name within two levels. Two is a guess and none is read. It
keeps the in-state rule's guards (never a club with a game of its own at that hour, nor before a
week ahead of its season), never reads a level two from one typed into the name that the resettle
would take off (`twoOff`), and where either club's state is unknown or off the map of borders it
reads only a name with a word in no more than one in 2,000 pulled names: a common name a club of no
known state wrote had gone onto the one club of it pulled at that level, in another country. The
refile files the row and the resettle leaves it, asking the same question.

Tidied in memory on the cloud copy of 28 October (GitHub run 40618664016), rules 34 moved 14,108
rows off stand-ins onto pulled clubs in six passes, and the games leaning on a stand-in or a slot
fell from 32.1% of the squad year to 28.4%, and of the played games from 28.1% to 25.1%. The tidy
under rules 33 moved one row, so the copy was at its fixed point before. A sealed sample read right
almost throughout, its pairings the same name or the same name with a dash or a colour written
apart. The neighbour test reads nothing here: the in-state rule had already filed every such row
whose clubs were neighbours, so the rows left are not, right or wrong.

What no reading of a name reaches: of the 58,519 clubs known only by name, 35,437 holding 70,254
games have no pulled club of the name, or near it, anywhere in the year. The owner has pulled every
club on GameChanger, and 40 of their rows laid out by eye on 28 October 2026 (GitHub run 40613806196) showed about a quarter under another form of a pulled club's name (the season's words
added, a colour or a coach's name left off, the words in another order, "Mt" for "Mount"), mostly
with no game that day on the club's own schedule. Filing a name onto the one club whose name's words
it holds, or that holds its, took the share to 22.2% but forecast no better, and a sample of its
pairings was right only about half the time (a name of three words onto a club called by one of
them), so it is not read. The rest wait on a closer reading of the name than that, or on a pull: the
file of every club worth pulling (`unpulledClubs`), most games first, is where to start.

**Not this team.** The matcher will still be wrong sometimes, and the club's panel is where that
shows. Beside each game a club has only because a name on another club's schedule was matched to
it, the panel offers **Not this team** (`filedByNameOn`): a row off GameChanger, off a schedule of
the club on the game's other side, which is the schedule that wrote the name, on a pulled club, with
nothing of the club's own saying the game is its — no row of its schedules folded in, claimed in or
on record, and no Same team as naming it, which is the owner's word. A game the club's own schedule lists, one typed in and a League Standings game are
never offered it, and nor is a row off a schedule nobody holds: an Unlink leaves the club's own rows
of the link it took off on the club, and on the backup of 29 September 2026 one such row was the
one game of 8,200 whose schedule was not the other side's. Unlink, which the panel offered before,
could not help, since the row did not come from a link. Pressing it takes the game off the club
onto what the row would have been had the name matched nothing (`takeOffClub`): the stand-in a pull
of that schedule would reuse for the name, at the level the row gave it, in its squad year and named
from the namer's state, or a new one where there is none, or a slot for a name that can only be one.
And it takes with it, in the same change, every other game the same club's schedules filed onto
this one by the name (`takenWith`), in whichever squad year: the refusal below covers each of them,
and left to the tidy they came off out of Undo's reach. On a page kept in the browser a stand-in
made for the game sets the page's tidy off at once, which took the other rows off for the refusal
while the Undo was still on screen, and Undo then brought back the one game alone, the stand-in
staying with the others (on the backup of 29 September 2026, 648 of the 7,515 club and namer
pairs offered hold two or more such games, at most six). The toast says how many games went, and
the club's record, rating and board move with them; Undo puts every one back as it was, takes away
the stand-ins made for them, and forgets the refusals the press added. It is a command
(`game.notThisTeam`), so a page kept in the browser runs it on its own store and the live page sends
it to the edit function, the club's card naming the games it is offered beside by their stored ids
(`ClubCard.byName`), since a card carries no other. The button's name, as a screen reader says it,
names the games it takes and the club it takes them off, since "Not this team" beside an
opponent's name reads as a remark about the opponent; it is a 24-pixel target, and a press, which
takes the button's own row away, leaves focus on the panel's list of games rather than on the page.

The answer is remembered, as the pairs kept apart are: in the pool's own key
(`league_forecast_gc_not_this_team_v1`), in every backup and in the cloud copy, against each
GameChanger id of the club that wrote the name, the name as the import reads it (`teamNameKey`) and
each of the club's GameChanger ids. Every listing of the namer's, not only the one the row came off:
a club on GameChanger twice, or once for the spring and once for the fall, is one club writing the
name, and keyed by the row's schedule alone the second listing's next row of the name went back onto
the club (47 of the games offered on that backup were named by a club with two listings, and 2 held
the other listing's row in the very game). Not against the game: a re-pull finds a row taken off a club by its id and keeps
the stand-in it has, so what brings the mistake back is the refile putting the stand-in on the club
the next time the club has a game that day, and the namer's next row of that name, a league
opponent being named over and over. The schedule and the name stay in the key, so another schedule
naming the club, or this one naming it another way, is matched as before. The name is the club's,
since a name files a row onto a pulled club only where the two read the same, and the name each
row taken typed as well (`typedAs`), which is another where the owner's Same team as filed the row
(`answeredNamesakes`): kept under the club's name alone, the refusal of such a row stopped counting
once the club was renamed, or folded into a club of another name.
Every road a name takes onto a club asks it (`refusesName`): the import's match by
the name (`planOpponent`: the one club of it, the one something corroborates), the refile, a
namesake taking a row off a club far from its age, and the slot settle where the row it would
settle into is the name again. The step that takes a name's rows off a club (`resettleOffLevel`)
takes any row of the refused name it finds there off it too, at the next tidy: none, after a press,
which took them all, but a row a copy restored from before the refusal brings back. What a refusal never
stands against is the club's own schedule (`listedByOwn`): where that lists the game against the
namer, the fixture match, the holder test, the slot settle, the crossed halves, the reclaim and the
claim step put it on the club as they would with no refusal, since the club saying it played the
game is not a reading of a name. Kept from those too, the two clubs' next real meeting stood twice
on the namer's record, once against the club from the club's schedule and once against a stand-in
from the namer's. The import panel and the tidy on this page, in its worker or not, read the list, and so does every pull run on the cloud
copy (`runCloudPull`: the nightly refresh and a list pulled in the cloud), its import and its tidy
alike, and Pool health's count of what a tidy would settle (`settleableNow`, on the page, in its
worker and in the server's `health.inspect`), which asked without it offered a Settle the tidy
refuses and stayed on screen after every tidy; the command adds to it: the refusals it does not hold
already, which its Undo takes off again and nothing else. Once the toast has gone a refusal is
listed nowhere and nothing in the app takes it back: Same team as, folding the stand-in into the
club, puts the games it holds back on the club by the owner's word (`namedByAvatar`), which no
refusal overrules, but the refusal stays for the name's next rows, over the answer the fold keeps
for them as well (`answeredNamesakes`). A page to list the refusals and
withdraw one is not built yet: what withdrawing should do with the games already on a stand-in is
the owner's to decide.

**A row filed by name beside a game the club never listed.** Where another club's own schedule
lists a game against a club that none of the club's own schedules gives a row, that game is on the
club's schedule somewhere — under whatever its coach typed for the other club. The import files a
row by the name it was given: against a club of that name, or a stand-in where GameChanger lists
none. So a row of the club's own that day filed against a stand-in, or against a pulled club
whose own schedules never list the game, is read against that copy, and where the two are one
game the row is claimed into it (`claimFiledRows`), as the club's own row of it.

Against a stand-in the clock and the scores decide, whatever it is called: within the hour, as two
schedules' copies of one game are (nobody plays two an hour apart), with a result still to come on
one side or two within four runs of each other, or with the same result. On the pool of 24 September
2026, after a whole tidy, 1,542 of its 82,471 games against a stand-in sat beside such a copy that
way. The stand-in's name shared a word with the club the other schedule named in 68% of those within
the hour with a result to come and 67% of those scored close, against 3% to 10% of the pairs the
same search makes a week either side, and most of the rest were a shorthand no word test sees —
"R.E.B." for Rockland Elite Black, "KBC" for Kennedale Baseball Club. Scores further apart than
scorekeepers are stay two games: they shared a word 13% of the time within the hour and 34% at the
very same start — mostly a game of another club of the same name, filed against this one by name
— and so did copies more than an hour off, 18% of those with a result to come. A slot has no name
to test and is held to the same clock and scores.

Two readings go further, both on the very same result against a slot or a stand-in whose name
fits the copy's club. The first reaches a copy holding the club's schedule on record at any clock:
"Chicos Augusta" at 16:30 was Chicos Augusta's own 17:35 copy, 10-1 both, and Coastal Kangaroos
Vincent read 3-2 against GameChanger's 2-2. The second reaches the day either side, into a copy
that holds nothing of the club's, for a row whose own day has no copy for it: Catoosa Mudcats'
9-16 against "Frost Falcons" on the 12th was Frost Falcons' own copy at the same 13:00 on the
13th. A copy two days' rows both want goes to the row on its own day, or to neither, and a row of
its own day that could be it counts as wanting it though it went into nothing, two copies it could
not choose between: read off the choices alone, a row a day off took the copy it might be. On the
tidy of the 26 September backup the two claim 44 and 47 rows, and 89 single-link clubs' records
move: all 89 toward their own schedule (68 onto it), 88 toward GameChanger's (50 onto it), and one
away, a club whose GameChanger record covers another span. A second tidy changes nothing, and in
two shuffled orders the pool ends with the same games and claims, differing from the stored order
in exactly the kept ids main's own shuffled tidies differ in.

A pulled club's name did say something, so against one only scores that agree outweigh it: the same
result within the hour, or two within four runs at the very start or within the hour. Kentucky
Athletics' 9-3 over "Dream Chasers Blue" was Hit Dogs Evansville's own 3-9 fifteen minutes on: the
Hit Dogs played that weekend under the name of a GameChanger team with no games of its own, every
opponent filed them under it, and each of those games stood twice. The same pool held 1,358 rows
filed against a pulled club that never listed them beside another club's copy with the same result
within the hour, and the two clubs' names shared a word in 81% of them; most are one club's two
GameChanger teams — "Gem City Throwbacks - Wright" and "GC Throwbacks - Wright Fall", whose
opponents filed seven games against the first and whose own schedule listed all seven as the
second. A result still to come says nothing against a name GameChanger lists — blank rows at one
start paired a "Rangers" typed with another club's copy — and waits until the scores are in.

Every row and copy of the club's day is read at once: as many pairs as the day allows, then in both
schedules' order, then the stronger links — the same result, the very same start, within the hour.
Where two readings are as good as each other, only what they agree on is settled, so one game off
two GameChanger teams of one club, 5-1 at 9:30 on both, is left as it is, and a claim already made
counts for nothing of its own, so the day reads the same whichever club was pulled first. The copies
of a club the claiming club has a row against of its own, that day or the day either side, that no
row of theirs is paired with yet wait for the collapse to pair it: claimed first, a stand-in row
once took the copy that row was, and left it standing on its own, one game counted twice. They wait
only where the collapse could still read that row as the copy: on its own day, or a day off with the
same result, at the very same instant, or at the same clock with results no further apart than
scorekeepers are, the one test the collapse joins a game across the night by (`dayApartStrength`),
and a pull's mark waits by the same. Waiting on a row a day off that is plainly another game waited
for good: G3 - Bonanno's 3-9 against "CBU" was CBU United Faber Navy's own 9-3 at the same start,
and G3's 1-2 against CBU United the next afternoon held it back, so the 3-9 counted twice. On the
pool of 24 September 2026 that was 41 games, and 73 clubs' records moved, 71 toward GameChanger's
own, 46 onto it and none off it. A score a claim lent the copy is not the copy's to wait on: read as
its own, the claim went back the next pass, and the pass after made it again. A row the club it
names answers for, by a copy of its own that fits, is that club's, whether that copy stands or is
itself claimed into a third club's copy: read off the standing copies alone, two clubs that each had
a second GameChanger team naming the other's first, Power Baseball 2028 Victus and JR7 Baseball on
11 September 2026, had each pass claim the row that stood and give back the one that was claimed,
and every tidy of that pool ran to its limit. A stand-in the other club's own schedule has played is
not that club — a 1-13 against "Natives Black" once went to Salty Stars, who play Natives Black in
October — and a pulled club it has played gives way only to the same result: the NL Vandals' 15-3
against "Downingtown West Wolfpack Blue" was Downingtown Wolfpack Gold's own 3-15 at the very same
start, though the Gold play the Blue, but where the other club had played the named one the two
names shared a word in 13% of the 30 pairs scored apart within the hour, about what chance gives.
What a club has played is read off every row of its own schedules, whichever row a game stands on.
Nor is an age typed into a name more than two levels from the one that club played at. Nor, across
regions, is the clock alone: with no result on one side or the other, a claim joins two clubs only
in one state or two that border (`inOneRegion`), and the slot settle holds to the same, whatever
the stand-in is called. A copy names a club because its coach typed a name the import found in the
pool, and a common name is found in many places: a 9U club in North Liberty, Iowa, that played
"Cubs" was filed against the 11U Cubs of Frisco, Texas, one of 75 teams of that name, and the Texas
club's own 11-6 over the Diamondbacks at the same 15:45 went into the Iowa club's blank copy as its
loss. Of the 3,714 claims on the pool of 26 September 2026, 7 joined clubs of two regions, 6 of
them on scores that agree or nearly do; the seventh, a Connecticut club's blank row naming a New
York team in an Indiana club's blank copy, goes back. It is a refusal once the day is read, not a
weight in reading it, so a region never picks between two copies the clock could not. Rows naming
one team on one day go to one club or none, and a row claimed away is no copy for another row to go
into in the same pass.

Nothing claimed is final. The claim keeps the team the row was filed against and the level its name
gave (`FoldedRow.filedAgainst`), through every save, backup and merge, and every tidy reads each
club's day again with its claims stood back up. A claim the schedules no longer bear out goes back
to that team: the other club's copy withdrawn or moved more than an hour off, a result posted that
says two games, the club's own schedule naming the other club after all, a copy that fits better
pulled since, or the copy moved onto a namesake whose own schedule lists it. The regroup never moves
a claim — which copy a claimed row is, is the claim's to say, and a row read as one more game
against the club that claimed it went to a copy the claim had refused, five runs off at the same
hour, and back, every pass until the tidy stopped. A claimed row keeps its own schedule's day when
the copy holding it moves, and a stand-in with no game left stays in the roster while a claimed row
can go back to it. One with neither, which a game or a club the user deleted leaves behind, the tidy
takes out once its passes are done (`idleStandIns`), unless a page has it as its own team: pruned in
each pass, the changed roster sent the tidy round once more to find nothing. A game the user has
thrown out keeps the claims it holds: released, a row would stand as a game of its own and count.
Deleting a club that is not one stands the claims its games held back up, and keeps it as a name
only where a claimed row elsewhere goes back to it; removing a team from a page keeps it in the
roster for the same reason; and a claimed row filed against a team the tidy takes out as not
baseball, or as a high school, goes with it, as the import would not file it. Kept as a bare fold,
as the first version of this did it, a claim outlived all of that.

The pool does not keep a row's name, so the next pull of such a fold's schedule reads the name again
and marks the fold as the claim it is (`filedMarkFor`). Where the stand-in the row had is gone, the
pull makes one for the name. It marks only what the claim step would have claimed. The row must be
on the same day, on the other side of the other club's own copy, with no other row of the club in
that copy. The claim step's rules for a stand-in must hold, and no row of the club against the other
club may be waiting that day or either side of it that could still be the copy. It leaves alone a
fold whose name files it against the other club:

- the other club's name, or a GameChanger listing's name;
- a shorthand for the other club's name at the very start, wherever the two clubs are, as the
  slot settle files one;
- a name the club's other rows already stand against the other club under, as a hand merge
  leaves them;
- a name that finds a pulled club.

It also leaves the same result, and the very start with results that do not disagree. The slot
settle folds those with no mark, and would fold them again after every release. And it marks no
fold of a name the club's other rows that day are in another club's copy under, marked by the
same pull or claimed already: rows naming one team on one day go to one club or none, so the claim
step stood every one of them back up beside the copy it had been in, each game counted twice. A
fold the fixture match or the slot settle made at the very start, with results a run or so apart,
is marked too, the first time its club is pulled after it: it is the claim the claim step makes
where the two clubs' rows come in the other order. The pull counts the stand-ins it makes among
the teams it made.

This was measured on the pool of 24 September 2026, tidied by the first version, by pulling again
every schedule holding such a fold. The pulls marked 1,103 folds and made 815 stand-ins. After a
tidy, 1,099 of them are the claims that a tidy of the pool from before the first version makes. 3
went back to their stand-in, as that tidy leaves them, and 3 rows elsewhere were claimed as it
claims them. One stays claimed where that tidy leaves the row standing, on a day both pools count
twice. The pool then holds 241,469 games, two fewer than that tidy leaves: Boro Force typed "Crash
Outs" for two games that day, held in two clubs' copies, and that tidy stands both back up beside
them where the note marks neither. A second pull marks nothing and makes nothing. 126 of that
tidy's claims are left as they were:

- 94 rows typed with the other club's own name;
- 13 whose name now finds a pulled club or a stand-in the other club has played;
- 12 with the same result, or at the very start with results that agree;
- 7 that are not the first version's folds.

A merge can leave a claim filed against the very club whose copy holds it: "Sharks" merged into
the Bears by hand, or a club's two GameChanger teams paired. The row's name is that club's now, so
the claim is settled (`isSettledClaim`). The claim step does not read it or take it back, a
re-pull leaves it alone, and it counts as the club's own row in its copy, as a row filed against
the club by name does: the regroup reads the copy as holding it, and so do the steps that move a
copy to a namesake (`reclaimMisfiled`, `resettleOffLevel`). Read as a claim, it went back against
that club beside the club's own copy, and the collapse folded it in again with no mark, which the
next pull would have marked as filed against a new "Sharks". Read by the regroup as a copy with no
row of the club in it, it took the club's other game against that club that day, a 7-3 lost
into a 2-4; read by a namesake step, the copy went to a namesake and the row stood back up, one
loss counted twice. A merge that folds a stand-in's row into the survivor's copy settles it too
(`settledOnMerge`), whether or not a claim was made first. A merge made before claims existed left
no mark, and nothing in the pool tells its fold from the first version's, so the note can make
the merged name again as a stand-in for such a row; the game still counts once while the copy
holds it.

A claim the club's own row makes in the copy it sits on counts for the reclaim too. With its own
row folded away, the club no longer held the game by its schedule, so a namesake whose own row
stood against another stand-in of the name took the copy; the claim then stood back up, held the
game again, and the two clubs took turns with it on every pass. On the backup of 11 October 2026
four copies did, and every tidy ran to its six-pass limit. Where the claim holds the game, only a
namesake whose own row stands against the puller itself takes the copy.

On that pool the tidy claims 2,997 rows: 1,782 filed against a pulled club, 939 against a named
stand-in and 276 slots, in three passes; a second tidy after a storage round trip changes nothing,
no row is held twice, the tidy takes out only the 28 rows it took out before, and 883 stand-ins
stay only as where a claimed row goes back. Among the claims against a pulled club
the two names share a word in 83% of those at the very start with the same result, 92% of those
scored within four runs there, and 78% of those within the hour with the same result. The Athletics'
page reads 9-0, one game against the Hit Dogs. Against the tidy before it, 2,484 of the 43,432 teams
rated in 2027 have another record: a club loses a game it had counted twice, or the games its
opponents filed against it by name that another of its GameChanger teams, or another club, played.

**A stand-in carrying the other club's very name.** Both clubs can file their copy of one game
against a stand-in, one of them under the other club's very name. One club's coach types the other
club's name as GameChanger lists it, and the other club files the same game, at the same minute
with the result mirrored, against a shorthand of the first club's name. A name goes onto a pulled
club only where the import can say which one, and the named club can be a level up, on another
page, so each row stands against a stand-in and both clubs count the game. The crossed halves want
each stand-in's name to fit the other club and the two clubs to be neighbours; the slot settle and
the claim step want one of the rows to name the other club already. On the backup of 11 October
2026 an audit found 714 scored rows this way, on 633 stand-ins: the namesake a level off (294), out
of the namer's region (241), one of several of the name in its state (78), or named from no state
(65).

So the tidy joins them (`joinNamesakeHalves`): club A's own row against a stand-in whose name is
pulled club B's (`teamNameKey`, in the squad year, at any level, from any state), and B's own row
of the game against a stand-in or a slot, starting within the hour with the result mirrored, the
only such match for either row. A false pair needs a second club of B's name, or a second club
naming B, to have played that hour to that score. Two more things are asked of the pair, each
measured against the same search with B's row a week or a fortnight either side, where the game is
not:

- B's opponent is a slot, or a stand-in sharing a word of three letters or more with A's name,
  filler words off (`nameFitWords`). Over the backups of 25, 26 and 29 September and 11 October
  2026 a stand-in sharing no word made a false pair 5.0% of the time (374 pairs), against 0.80%
  for one that shares a word and 0.28% for a slot. A stand-in sharing no word is read as A all the
  same where everything else about the game agrees: B in A's state or next door, the two clubs not
  of one town, their levels at most one apart, the game not won by ten runs or more (often a game
  the run rule called, a score that turns up week after week), and the stand-in's name no other
  pulled club's, which would say B played that club. With A's row one to four weeks either side,
  on those four backups after a tidy, that joins 77 more games against 0.25 a shift off (0.32%);
  with B in A's state or next door alone it found 134 on 25 and 29 September and 11 October against
  5.25 a shift off (3.9%).
- The two clubs' own levels for the game are at most two apart (`PLAYS_UP_TO`): three or more
  apart was false 11.9% of the time (88 pairs).

And where both coaches typed an age, one of the two is the other club's own, since two clubs'
sibling squads can mirror a score at one instant; one age a level off on its own is let through,
since refusing every typed age that was not the other club's turned away 173 of the 500 pairs on
the backup of 11 October 2026 and found the same 7 pairs a shift off with it and without. A
stand-in A's own schedule has played as a team of its own is no name for A, a row the user threw
out stays out, and a name the owner refused (**Not this team**) files nothing onto the club it was
refused for, whichever row wrote it: A's name for B, or B's name for A. Asked of A's name alone, a
pair whose stand-ins each carried the other club's very name was joined the other way round, on B's
row with A's as the claim, though the owner had said A's name was not B. A row with no result waits
for one: on the four backups, rows blank on both sides at the same minute paired as often a week
off as on the day (1,796 pairs, against 1,809 a shift off).

Nor is a pair the only match beside a copy of the game already standing between either club and
another pulled club, within the hour and with a result no further from the club's own row's than
two scorekeepers' are (`CLOSE_DISPUTE_RUNS`), as the claim step reads a row against a stand-in
beside a copy. Such a copy is one more reading of the game, and the pairs above were counted
without it: a second club of B's name pulled after the join, its own row naming A as GameChanger
lists it, went onto A by that name beside the joined game, since A's row no longer stood against
the stand-in the import would have folded it into, and A counted the game twice through every tidy
after, where the tidy before the join counted it once. So did B, where a club pulled after the join
named B. Beside such a copy the join comes apart, and the claim step, or the refile and the
collapse, put each club's row into the copy that names it, as they do where every schedule is in
at the first tidy. No pair joined on the four backups has such a copy beside it, and the tidy of
each is the same to the byte with the question and without; a week or a fortnight off, it turned
away one candidate a backup, each one the word test turned away too, so the 7 pairs a shift stand.

Built, with those guards, the tidy joins 220, 211, 301 and 486 games on the backups of 25, 26 and
29 September and 11 October 2026, 1,218 in all where the rule alone found 1,244, and the same
search a week or a fortnight off finds 7 pairs a shift: under 0.6%. A second tidy joins nothing
more and takes nothing apart. Of the 486 on the backup of 11 October, 310 have a stand-in on B's
side and 176 a slot, and 233 are on one page, 229 a level apart and 24 two. The squad year's fit
rates 221,233 games there where it rated 221,719, and no club's record changes, since each page
reads its own schedule's rows; of the 47,971 pulled clubs on the 2027 pages, 2,407 move by more
than 0.1, 390 by more than 0.5 and 97 by more than 1, the most by 4.3. The tidy of that backup
took 161 to 172 seconds over three runs, against 148 to 154 without the step, which takes 1.3
seconds a pass and runs six passes there.

The game stays on A's row, the one that named B, on A's page. B goes in for the stand-in at the
level B's own row gives it, since read at A's page level, as a side with no typed age is, 122 of
the 253 joined games across two pages on the backup of 11 October 2026 would have rated B a level
or two from its own; and B's row goes into the game as a claim filed against the team it named
(`claimInto`), as the claim step holds the rows it claims. The game counts once, in the squad
year's one fit, for both clubs, and each club's page reads its own schedule's score.

Nothing joined is final, as a claim is not. The game keeps the stand-in its own row named and the
level that name gave (`ScoutGame.joinedFrom`), in the stored pool, every backup and the cloud copy,
whose data schema went to 2 for it, since an older build would drop it and the join could no longer
be taken back. Every tidy reads the two rows again as their schedules filed them, and a join they no
longer bear out puts each row back where it was: a result or a start since posted that does not fit,
a second club of the name with a row that does, a copy of the game naming either club itself, the
owner refusing either name, B's row gone from its schedule. Until then every other step reads B's
row as B's own row of the game, as it reads a claim a merge settled (`isJoinedClaim`): the claim
step leaves it to the join, which it would otherwise give back each pass for the join to make again;
the regroup keeps B's schedule on record, so B's other game against A that day is not read as this
one; and the reclaim does not move the game to another club of B's name. A pull of either schedule
finds its row by id and changes nothing, unless A's schedule now types another age for B, or none,
which the game keeps as the level to put back; and a refresh of B's page that cannot see the game on A's
files the row again, which the tidy folds back in (**One row, one place**). A game the user has
thrown out stays as the user left it, and one whose stand-in has since gone from the roster keeps
the join as a plain claim. Deleting B, or B taken off the boards for the user (**Clubs removed for
you**), puts A's row back against the stand-in it named (`unjoinedRow`, `unjoinsWithout`) and keeps
it off the rows remembered as deleted, rather than take A's own row of the game with a club its
schedule never named, which A's next pull would then never have filed again; B's own row goes with
B, as any claim of B's does.

**A name that only fits, against a slot.** On 28 October 2026 the owner sent a game held twice: a
9U club's own schedule had it as a 4-11 loss to "TBD- 10/25/26, 10:30 AM", set not to count as a
TBD game no schedule paired, and the other club's own schedule had it at the same minute as an
11-4 win over the first club's name with its region before it and an event's tag after it,
counted against a stand-in ("Both teams have the game"). That is the namesake join's shape with
a slot on B's side, but the stand-in's name was not B's very name, so nothing read it. So the join
also reads a stand-in of no pulled club's name as each club its name fits (`nameFitsWithin`: every
word of the shorter name in the longer, a club's own name or a name GameChanger lists it under),
where that club's own row of the hour, the result mirrored, is against a slot (tidy rules 35,
`FittedRule`). Every club the name fits is a reading before anything else is asked, so a second
club with such a row leaves both rows alone; a name another pulled club is listed under, or the
namer's own, is read for no other club; and the two clubs are of one state or of two sharing a
border, both known. A refusal of the club for that game (**Not this team**), kept under the club's
own name, holds against the name the row wrote as well.

On the cloud copy of 28 October 2026 as rules 34 left it (GitHub run 40671389671) the reading
joined 296 games, and the same search with every row against a slot a week or a fortnight either
side, where its game is not, joined 0, 1, 2 and 0: 0.75 a shift, 0.3% of the day's, the rate the
namesake join measured for a slot on B's side. Read wherever the two clubs are, it joined 30 more,
and the shifts 3.0 a shift: about one in thirteen of those further pairs false, so the region is
asked. A sealed sample of the joins read right throughout, the club's name with a season, a
coach, a town or a colour written around it. The whole copy tidied under rules 35 moved 296 more
rows off stand-ins than under 34, the played games against a slot fell from 10,422 to 10,127, and
the share of played games leaning on a stand-in or a slot from 25.1% to 24.9%.

A row filed by name on a pulled club that plays nowhere near the age it was played at is not that
club's (`resettleOffLevel`): more than two levels off, it goes to the one namesake that plays near
it, or to a stand-in. Two levels off is inside what a squad plays up or down, and still somebody
else's where the age was typed into the name and nothing of the club's own says it plays there:
every listing two off, none of its own rows within a level of it, no row of its own that day. On the
pool of 24 September 2026 GameChanger's own record left out 82% of the games filed that way that it
decided, against 14% at the club's own level. Those rows go to a stand-in and to no namesake, and
the refile (`refileStandIns`) does not put one onto the club of that name at the typed age on the
name alone where the name is a club's at another level in reach too and that club's own schedules
list nothing that day: handed to the namesake at the typed age, 47 of the 49 clubs that took one on
the pool of 26 September moved away from GameChanger's own record. On that pool the move takes 522
rows off, and 178 clubs' records change: 164 toward GameChanger's own, 106 of them onto it, and 14
away, 5 of those off it — a squad that did play up, or a namesake the game was matched to after.

Nor is a row filed by name on a pulled club in a region its filer does not play in: two states on
the border map that are neither the same nor next door (`farApart`), where no game both clubs'
schedules have a row in, and no pulled club each has met in a game both sides' schedules have,
backs it. Two Texas clubs' games against "Braves" sat on a Florida Braves as two wins its own
schedules do not have. Such a row goes to a stand-in, which the refile files onto the one club of
the name in the filer's state or next door. A meeting counts only where both schedules have it,
because a row only one side holds may be a misfile of its own, and two misfiles, one each way,
would vouch for each other. A province or Puerto Rico, which the map does not hold, says nothing
about distance, and a slot's name stays on the one pulled club that carries it, as the import
files it. On the pool of 26 September 2026 at 18:40 the tidy takes 121 rows off, and 31 clubs'
records change: 30 toward GameChanger's own, 13 of them onto it, and one away, a loss its club's
schedule has not scored yet, whose row the move let join the club's own copy of the game.

**The club's own row of the game beside it** (tidy rules 36). Neither the region nor the level takes
a row off a club whose own schedule has a row of that very game still standing apart from it
(`ownCopyOf`): its day the row's or the day either side, both scored with their own results and the
result mirrored, starting within the hour of each other or on the same clock a day apart, and against
the club that filed the row, a slot, a stand-in of that club's name, or any stand-in at the row's very
start. The sweep of 30 October 2026 found the game this was missing. The Comets of Ohio beat "Bears
Black" 9-2, and the Bears Black of Texas have the same game at the same minute as a 2-9 loss to a
stand-in of the Comets' name. The reclaim moved the Comets' row onto the Texas club on the game,
since the club's own row is at the very start with the result mirrored; this step took it off again,
since the two clubs had met in no game both their schedules held yet; the refile put it on the Bears
Black of Kentucky, next door to Ohio, who never played it; and the collapse that would have made the
two rows one game came after all three in each pass. Every tidy ran its six passes, and the game
counted twice. Pulled in six orders, the four clubs' two rows of the game were folded on arrival in
five; the sixth, the near club and the namesake pulled and tidied before the far club, cycled. Now the
row stays and the claim step or the collapse folds the Texas club's row into it, so the tidy settles in
two passes with one game between the two clubs in all six. Of 300 small random pools of clubs in
Kentucky, Ohio, Indiana and Texas (`farApartGame.test.ts`), 38 ran to the tidy's limit under rules 35
and 50 of their 971 games both clubs list counted twice; with Texas left out, none did, and under rules
36 none does either way. The very start takes any stand-in because the reclaim does: read only as a
stand-in of the filer's name there, the row went round six passes again. More than two levels apart
only the club's own row naming the filer itself keeps the row: a pair a name and a slot or a stand-in
join that far apart was false 11.9% of the time when the namesake join was measured, and that join
reads no pair more than two apart. Two levels off, a row of the club's own that day already says it
plays there (`twoOff`), so the copy this keeps is one dated a day off: taken off, such a row went to
a stand-in, the refile put it on a namesake at the typed age that played that day, and the game
counted twice.

This keeps a row that is on the far club already, or that the reclaim moves there, and the reclaim
moves one only onto a copy at the very start. Still open, as before rules 36: where a pull filed the
near club's row onto the namesake next door and the far club's own row is off the very start, within
the hour or a day apart, the row stays on the namesake, and the game counts twice where the far
club's row is against a stand-in rather than a slot; and a copy scored on one side only backs
nothing, so the row goes to the namesake. One cycle the sweep's own fuzz found is still open too
(its seed 369), of another shape: a row filed onto a far club whose own schedule has no copy of it
comes off as unvouched, a claim made in the same pass gives the two clubs an opponent in common, the
next pass's refile files the row back on that, the claim is released, and the tidy runs its six
passes. The stand-in share and the model sweep's stand-in mode have not been read again on the real
copy since.

A row the owner said is against a club is kept apart from all of that (`ScoutGame.namedByAvatar`).
Same team as records the club on every row of a team known only by a name — a stand-in, a slot, one
made by hand — that the user folds into a pulled club, since that is the user saying who played:
folded with no mark, two such stand-ins went back to stand-ins at the next tidy, the club's own
schedule having no game those days (`mergeScoutTeams`). So no rule that reads a name — the region,
the age, the misfile check, the claim step — moves such a row off, and a pull, which says nothing of
who the owner said played, leaves it. A row folded into the other club's copy of the game keeps the
club on its record there (`FoldedRow.namedByAvatar`), so a correction that stands it back up stands
up the same row, and a claimed row's record keeps it too, so a row whose claim the schedules release
goes back to its team still carrying it. The stored pool, the JSON backup and the CSV a season
export carries all keep it.

The field is named for GameChanger's picture, which set it as well until 28 October 2026: a row
whose opponent's picture was a pulled club's own was read as that club. None ever was. On that day
none of 12,994 opponents' pictures on 3,000 pulled schedules was any of the 44,840 pulled clubs'
(GitHub run 40693355959), and no stored game carried one; a nationwide pull before that had found
7,948 different pictures on 7,948 teams. So pictures are no longer read, kept or matched anywhere —
not for an opponent, a club's own stand-in, an age, a season pairing or an organization's games —
and the stored pool keeps none (data schema 7). A pull's tally counts the opponents the game itself
found (`opponentsMatchedByGame`); it called them found by picture before.

**The answer, kept for the namer's later games.** Same team as also keeps, on the club, who each
namer means by the name (`ScoutTeam.namedAs`): the GameChanger team whose schedule wrote each row it
folds, and the name that row typed (`typedAs`), or the stand-in's own for a row pulled before rows
kept theirs. Kept on the rows alone, the answer covered only the games already there: in the sweep
of 30 October 2026 the same coach's game a week later, typed the same way, went to a new stand-in,
and the owner had to answer again. A slot's name is anybody's, and a row of the club's own schedule
naming the stand-in is a game against itself once folded, so neither keeps an answer. The list goes
with the club wherever it is folded, by hand or by the tidy (one squad listed twice, the season
pairing), the two clubs' lists made one in one order, and the fold's Undo takes it away with the
rest, since it puts the club back as it was. It rides inside the roster's stored value, where a
club's picture was once kept (`CompactTeams.r`), so a club with none is written as before; the
stored pool, the worker's wire, the Team Rankings file, the whole-browser file and Undo keep it, the
season's CSV does not, and no club's published card carries it. On the seeded fixture at its full
size (20,204 clubs, 58,105 games), its GameChanger ids made twelve random letters and digits as
GameChanger's are, each answer kept is 14 to 17 bytes of the gzipped copy: 100 stand-ins folded keep
279 answers and add 4,410 bytes of the 1,041,845 (0.42%), and 1,000 keep 2,251 and add 33,247
(3.2%). The data schema went to 11 for it, since an older build would drop it with its next save of
the roster.

**The answer, read for the namer's later games** (tidy rules 38). That namer's next row of the name
is the club's too (`answeredNamesakes`): at arrival (`planOpponent`), behind the game itself and
ahead of any reading of the name alone, since it is the owner's word on who the coach means by it;
in the refile, which files a stand-in's row of the name onto the club; and the resettle leaves such
a row on it. It keeps the in-state rule's guards: the club listed at the row's level in its squad
year, so a level typed into the name that the club is not listed at is another squad of the name;
a day no earlier than a week before the club's own first game of the year; and never within the
hour of a game of the club's own against another club. Not the rest of what a name is asked: the
two clubs need not be neighbours, nor of one state or next door, nor need the club have a game that
day, since the owner has seen the games. Only the namer reads it, on every listing of its own, as
its refusals are kept (a club on GameChanger twice is one club writing the name): another club's
row of the same name is read as a name, as before, and two clubs holding the namer's name at one
level are two answers that disagree, so neither is read. The name asked is the one the row typed
(`typedAs`), on every road alike, so a row pulled before rows kept theirs is read once its
schedule's next pull learns it. Read by its stand-in's name in the refile alone, such a row was
filed onto the club there and taken off again by the resettle, and where the club held the answer
under its own name every tidy ran all six passes. An answer given across a level, a stand-in off a
9U page folded into a 10U club, files no later row, since a row with no age typed is read at its
page's level; reading it at the level it was given would need that level kept with it.

Not this team always wins. A press on a row the answer filed takes it off, with every other row
the namer filed onto the club by a name (`takenWith`), as on any row a name filed, and refuses, on
the namer's schedules, each name those rows were filed under: the club's, and the one each row
typed (`refusalsFor`). The answer is refused only under its own name, which no rename of the club,
nor a fold of it into a club of another name, changes: read by the club's name, the refusal
stopped counting once the club was renamed, and the tidy filed the refused rows back. So a press on
another of the coach's rows on the club takes the answer back too, its rows going with the press,
and Undo gives both back; but a refusal of another name the coach wrote, given before the answer,
does not, since it says nothing of what the coach means by this one, and read, it took back every
answer the owner gave after it for that coach. The rows the fold itself put on the club stay, as
the owner's word (`namedByAvatar`), and undoing the fold takes the answer with it. A build on
rules 37 reads no answer and would take such a row off a club that had no game that day; a pool
stamped by newer rules is one an older build leaves alone (`stampFromNewerRules`), which is why the
rules went to 38. No stored club held an answer before this, so the copy moves only as the owner
answers.

A name nobody pulled is one stand-in per name, level and squad year among the clubs of a state that
named it, and a lookup that missed made a second: a class year looked up at the page's age rather
than the class's, a pull run before a rule. The tidy makes one of two such entries
(`mergeDuplicateStandIns`) where the name carries a graduating class or no more than one pulled club
in the pool carries it, a club of one state named both, and neither played another opponent within
the hour of the other. A common name, two Arizona clubs' "Pirates", is as often two teams and is
left. On the pool of 26 September 2026 that merged 127 of the 173 such entries, ten of them "Mojo
Gold 2036", and moved 226 clubs' ratings by more than a tenth of a run and no club's record.
Each entry is held against every earlier one it was not merged into, not the first alone: held
against the first, two "Canes National 2031" entries named from Virginia stayed two behind one
named from Florida, and five such pairs stood on the pool of 26 September at 18:40, all made one
now in the roster's order and in two shuffled ones.

Anything still unnamed is the ordinary rename: open the slot, type the club's
real name, and the game moves there — merging into that club if it is already in
the pool.
