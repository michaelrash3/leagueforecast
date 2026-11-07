# Pulling from GameChanger

_Part of the design documents; the map is in the repository's [README](../../README.md)._

Team Rankings stops being hand-entered. Paste GameChanger team ids, team page
links, or a whole spreadsheet export — the same reader handles all three, BOM,
quoted names and tab-separated columns included. Each team's schedule is read and
filed under its own age group and squad year, and the pages are created as they
are needed, because a nationwide list cannot expect a page to exist for every
level first. Under a header, an id is read from the id column, the link column,
or a link anywhere in the row, and nowhere else: a row with only its name filled
in once sent that name to GameChanger as an id.

## Two lists: teams, and the organizations they belong to

A team export can carry more than the team. The columns this reader now takes —
`Organization ID`, `Organization Name`, `Organization Type`, `League Associations`,
`Tournament Associations` — answer a question GameChanger's public API will not: there
is no team-to-organization route, so nothing the app _fetches_ can say which club or
league a team is in. A crawl that found the team through its organization knows, and
these columns are where it says so. Every one is optional, and independently so: a row
naming a tournament and no club is an independent team playing one event.

Associations read as `Name|Id`, several separated by semicolons. **A league may age a
team and a tournament may not**, and the difference is not a nicety: you play your own
age in your league and you enter tournaments _up_. An 11U team whose league is
"NKB 11u" and whose tournaments include "NB Summer Slam 12U" is telling you both
things, and reading the second as an age would file it a year old and make every game
in its own league read as playing down.

So a league's age is a rung of its own: **below the club's own word and above its
opponents'**. A league naming an age is a statement about every team in it, which beats
reading the company a team keeps and loses to the club filling in its own page — and a
person naming an age by hand still outranks all of it. Two leagues naming different
ages is not an answer, because one of them is about a different squad of the same club,
so it refuses rather than picking. The whole rung only ever fires on a team GameChanger
left with no age at all.

Organizations are a **second file**, not rows mixed into the first, and the reason is
that nothing inside one file could tell them apart: an organization id and a team id
are the same shape. Two files make every row unambiguous by where it is, leave the team
reader untouched, and mean no list already saved can be misread. Its columns are the
ones the export writes — `Entity Type`, `Entity Name`, `Organization ID`, the three URL
columns (any of which yields the id), `City`, `State`, `Season Name`, `Season Year`,
`Sport`, `Team Count` — and the season pair is read leniently across both cells,
because a real export puts `2027` in the _name_ column with the year column empty. The
miner's own export since 19.x names two of them differently, `Organization Name` and
`Type`, and the reader takes either spelling.

**The Organizations file is read from the pull panel**, beside the team list, and kept:
a file read later adds to it, replacing only the organizations it names again, so an
export taken part way through a crawl and then the whole of it add up. What makes it
worth reading is its `Team IDs` column — the teams under each organization, which is the
link the team export almost never carries: its league column was empty on every row of
three real exports, 309,504 rows between them. A team a pull brings back with no age from
GameChanger or its own name, whether from the pasted list or from the rota asking again
about a team waiting on an age, takes the age its organizations' names agree on
(`orgMembership.ts`), read by the same `ageFromOrgName` that measured 95.1% against teams
with an age of their own; two organizations naming different ages give nothing. Never
against GameChanger's own band: a team filed "Under 13" is not filed at 16U because an
organization's name says so. A waiting team a file can now age is asked about again at
once, as one somebody named an age for by hand would be. A partial export of 22 September
2026 kept 1,798 organizations over 11,515 teams and would age 141 waiting ones, 139 of
them inside the band GameChanger gives them and the other two refused by it.

**Or handed over by the crawl, with no download and no upload.** The owner's miner is a
userscript in their own browser, and since 19.15 a run that finishes all three of its
stages (teams, organizations, then each organization's teams) leaves its NEW exports in
the userscript's own storage, where a second copy of the same userscript, running on
this site, posts them to the page (`crawlHandoff.ts`). The page listens only to its own
window at its own origin, on the hand-off's channel; holds the files until an Import is
drawn (`crawlHandoffStore.ts`); and opens Team Rankings → Import, where whichever Import
is on screen applies them through the very path its file inputs use (`useHeldHandoff`):
the team list into the list box or the cloud's pull card, the organizations kept on this
device or sent as the one `orgs.merge` the file input would send. Nothing is pulled: the
pull is still a press. An id is applied once for the life of the page, so a hand-off sent
twice never merges twice, and the miner is told a file went in only once it has, which is
when it marks those rows sent; a file that fails to go in stays the miner's, to come
again the next time the page opens. So the hand-off costs what loading the same two files
by hand costs, and no more: on a cloud device that is one merge a finished run, and the
miner sends an Organizations file only when its NEW export has something in it.

`Entity Type` says what a thing is, not how its teams should be rated. A travel
organization is a club; a tournament is an event whose brackets often name an age; and
a **league is neither automatically** — "NKB 11u" is a travel league and
"Mt. Carmel Little League" is rec ball, and only the name says which. A league or a club
names the age its teams play, but a tournament names the age its brackets ran at, which
the teams in them entered _up_ to — "NB Summer Slam 14U" holds 11U and 12U teams. So a
tournament is left out of the kept list entirely, and one a file now types that way is
dropped from it (`mergeOrgMembership`); the type decides this at import and is not stored,
so the kept organization is the same `{ orgId, name, teamIds }` as before and no device
reloads for it. The older crawl could not tell a league from a tournament and typed
everything "travel", which is why the age a name gives is still only the last word, under
the league rung and under the company a team keeps; the miner's file states the type, and
one row's muddled squads — a league and a tournament both naming a team, each a different
age — no longer leaves that team ageless, because the tournament is gone before the ages
are read. Older files and the browser's cloud copy keep whatever tournaments they already
held until a typed file names them again on this device; nothing new is ever added.

GameChanger's public API allows only its own site as an origin, so the browser
cannot call it. `server/gc-team.ts` is a Firebase handler that reads a team's
profile and games on the app's behalf and maps every failure to a reason the
panel can explain. It sends the same `Accept` versions and `gc-app-name` header
the site does. `GC_EXTRA_HEADERS` takes a JSON object of extra headers for the
day AWS WAF starts challenging server traffic.

**Only the accounts on the cloud copy's list can pull.** The Firebase proxy
answers a request only when it carries the Firebase sign-in of
an account on the list (**Your data on every device**), and tells anyone else
`members-only` with what to do (**The GameChanger proxy on Firebase** says how it
checks). A browser nobody has signed in to, or one signed in with an account the
copy turned away, is told at the top of the pull panel, and every button there
that would start a pull is off, so nothing starts only to stop on its first
request. A run that began signed in and is turned away part way, by an account
taken off the list say, stops there, says why, and leaves the teams it had not
pulled unsettled, so **Carry on** asks for them again once signed back in.
Everyone else keeps the rest of the app with the data in their own browser, and
share links.

**The function passes GameChanger's answers through, and the browser reads them.**
Vercel bills a function by the CPU it keeps busy, and on 28 September 2026 the
app's Hobby plan ran out of it: four hours of Fluid Active CPU over 443,000 calls,
about 33 ms a call. Nearly all of that was the function reading what it fetched —
parsing and normalizing a thirty-game schedule measured 3.1 ms of CPU a team, 31 ms
for a request of ten, against 0.04 ms a team to pass the two bodies on as text. So
the app asks for `?ids=…&raw=1`: the same fetches, the same profile cache and the
same failures classified by status, but each team comes back as GameChanger's own
profile and schedule text, which the browser reads with the same normalizers
(`gcTeamFromBodies`) to the same team. Raw bodies are about 30% bigger than the
normalized answer and the same size compressed. The parsed answer stays for a
caller that does not ask, such as a tab still running an older copy of the app.

**Identity is asymmetric, on purpose.**

|                                   |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A team pulled by id               | _is_ that id. GameChanger mints a new one every season, so a club's Fall and Spring squads arrive as two teams and stay two until somebody pairs them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| An opponent                       | has no id — GameChanger never gives one, and its picture is different on every listing, so it identifies nobody. The game itself is matched first: a club whose own schedule holds this fixture is the club, by the same result or the same start time, though not two results more than four runs apart. Failing that, the name — at that level, in that season year, and in the puller's own state, since nine opponents in ten are; a sole namesake in another state waits as a stand-in. And a name puts a game on a pulled club only where that club's own schedule has a game that day or the day either side: a name is where to look, not who played. |
| A stand-in                        | is a name a schedule wrote down and nobody has pulled. One per name, level and state: a "Red Sox" named by clubs in ten states is ten stand-ins, not one club they all played.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| A club already here as a stand-in | is adopted rather than duplicated when its own turn comes: the stand-in its own schedule confirms, else the one at its level whose namers are in its state. In a full pull nearly every team appears as somebody's opponent first.                                                                                                                                                                                                                                                                                                                                                                                                                            |

The same game is on both teams' schedules and a re-pull brings back a schedule
almost entirely unchanged; both are matched rather than filed again (**One game on
two clubs' schedules** says how), and only a score that has since been played is
written. A 0-0 is read as no score entered,
which is what GameChanger means by it.

**A renamed opponent is read again.** A pull finds a row it has already filed by the row's id and
keeps the opponent it settled on, so a coach who corrected the opponent's name afterwards was never
read: on 28 October 2026 the owner found a 9U club's win still filed onto the one pulled club of a
one-word name near it, whose own schedule had no game that day, after the coach had renamed the
opponent in full, a club of a longer name. So every row keeps the name its schedule typed (`ScoutGame.typedAs`,
as names are compared, `teamNameKey`), and a pull that finds it typed otherwise files the row by
the new name, as a row first pulled under it would be, where the name is all the row rests on
(`restsOnItsName`): not a game holding another club's own row of it, which is that club's word that
the two met, nor one the owner said is against its club (Same team as), nor one the namesake join
made. A name written
otherwise ("RAMS 9u" for "Rams") is no rename. A row learns its name once and keeps it until it is
filed again by another, so a rename on a game that rests on more is read once nothing else does;
a row held in another club's copy keeps the name on its record there (`FoldedRow.typedAs`), as a
claim keeps the team it was filed against, so a claim given back stands up under the name it was
filed by and is read for the rename at its next pull. A row filed before names were kept learns its
name on its next pull and is read from the rename after that. The names are kept in the stored
pool once each (`CompactPool.n`) and in the backup's games ("Typed As", and after "*" on a folded
row); the data schema went to 6 for them.

**A squad year runs August 1 to July 31.** "2027" is the squad that plays Fall
2026 and Spring 2027, and its season began on 2026-08-01. GameChanger lists a
club's older games under its new id often enough that a nationwide pull carried
three thousand of them; a game dated outside its squad year is left out on
arrival and deleted from a pool that already holds one.

**A winter is filed by its games.** GameChanger's label for a winter names either
year it straddles — "Winter 2026" and "Winter 2027" are both names for the one
that starts in November 2026 — so a winter team's squad year is the one most of
its games are dated in, and with none, the squad year being played if the label
can mean it, else the year after (`squadYearOfGcTeam`). Read off the label alone,
"Winter 2027" was squad year 2028: a pull of this season skipped such a squad as
another season's, and filed anyway, every game it played was dropped as dated
before its season began. Its age is read in that year too, because a class year
in the age field is a different age each year ("2034" is 11U in 2027 and 12U in
2028); the season picker keeps a winter row under either year it could be; and
the season pairings read a link in the year of the page it was filed on. The 719
winter teams in the 26 September 2026 pool are all labelled Winter 2026 with their
games in squad year 2027, and stay where they were filed.

**A pull files the season being played, unless told otherwise.** A crawl that
searches every season of a calendar year hands over last spring's and summer's
squads beside this fall's, each under a new GameChanger id with nothing else to
say its year is finished. So the panel carries a season picker under the list,
with the season being played ticked (2027 on 24 September 2026, which is Fall 2026
through Summer 2027), the one before it, and any other the list's `Season` column
names, each with the number of rows that name it. A row from a season left unticked
is dropped before a request is spent on it. A row that does not say is fetched and settled by
GameChanger's own season: the importer refuses a team from any other year before
its age is read (`other-season`), so it never joins the waiting list, and the
run's summary counts those in a line of their own instead of listing them under
**Worth a look**. The choice is kept with the run, so a resumed run files what it
was started for, and the same list asked for different seasons starts over. The
rota keeps to the season being played as well; see the next section.

**A team turned away is remembered.** A crawl that searched every season exports no
Season column, and pasting it again on 26 September 2026 sent 220,103 ids, about
22,000 calls, most of them teams an earlier pull had already refused as another
season's. Each finished run now keeps what it turned away (`refusedClubs.ts`): for
good when it is about what the team is (wiffle ball or softball, high school, adult, over the
oldest age; not a page whose name says it is no team, since a coach can rename one), and against its squad year when it was another season's, so it is left
out of a paste only while that year is unticked. A pill says how many were left out,
and **Ask again** forgets them. It is a cache of GameChanger's answers, like the
too-young list beside it, and stays out of backups.

**The tidy runs by itself.** At the end of every pull, and whenever the app opens
on a pool whose shape differs from the one it last tidied (once the page's first
board is up, since handing the tidy the pool is a copy of all of it on the page's
own thread, and made while the board was being asked for it held the rows back
by 1.5 s on a nationwide pool), the whole pool is gone over until a pass finds
nothing more: games outside their squad year are
deleted; a stand-in is settled by the other club's schedule (a mirrored result
settles it even when the two coaches typed different start times, and two
results that contradict are folded into one only at the very same start time,
against a stand-in whose name is a shorthand for the club, since nobody plays two
games at once — or, whatever the name, into a copy the club's own schedules left out, within the
hour and within four runs); a game each club filed against
a stand-in for the other is joined into one game between them (the same day; both results in and
mirrored, or one result and the other half unplayed at the same start time, or two results that
differ at the same start time where nothing that agrees fits — two unplayed halves
wait until they are scored; two mirrored results joined whatever start times the coaches typed,
since 104 of the 1,211 games this joined on a real pool were more than an hour apart and the same
search a week off matched no more for ignoring the clock; each stand-in's name a shorthand
for the other club's — "Stix" for "Cincy Stix Navy" — with no age a coach typed pointing at
another squad and no two different squad numbers; the two clubs in one state or two that share a
border, unless the two results mirror within the hour, as a tournament's travel has them — 93
games on the pool of 26 September 2026, where the same search a week off finds none; and no other
pair that fits as well); so is a game one club filed against a stand-in of the other club's very
name and the other against a stand-in or a slot, mirrored within the hour and the only match each
way (**A stand-in carrying the other club's very name**); a
game sitting by name on
one club moves to the namesake whose own schedule holds it, even where that schedule wrote the
puller down in shorthand or scored the game differently at the same start time, and where it has the
game at its very start with the result mirrored against a slot, any stand-in, or a club of the
puller's name whose own schedules never list it — then also to a club whose name fits the one the
row names, in one region, and never onto the puller itself (the Padres and Marlins of one Texas rec
league were filed crossed, each club's own row on the other's namesake; on the pool of 26 September
2026 the first tidy moved 479 rows and left 404 fewer games, and 403 single-link records changed,
400 toward the club's own rows and 262 onto them, found through an index of each club's own rows by
start and score, since a lookup by name cost 6 s a pass); a stand-in's rows
are filed onto the one club of that name in the puller's state (two in the state:
the one in the puller's own town; none in the state: the one in a bordering state, if exactly one
is — on the stand-in fixtures export of 22 September 2026 that was the club the game itself named
1,174 times in 1,240), and only where that club's own schedule has a game that day or the day
either side, or the name is one no other club carries (**A name no other club carries**). A
puller GameChanger gave no state is first given the one its club's other teams are in
(`fillMissingStates`): the pulled clubs sharing two or more coaches with it, the clubs of its name
in its town, or three or more of its name all in one state, and none where the coaches or the town
answer two states or two answers disagree; a name spread over several states says nothing either
way. On the backup of 11 October 2026, 3,033 of 68,919 pulled clubs had no
state, so none of the 4,316 rows on stand-ins they named could be filed; tried on the clubs that
had one, the rule was right 25,498 times in 25,715, and it gave 372 of the 3,033 a state. A state
the owner clears on a club's panel stays clear: the club is marked so (`ScoutTeam.stateCleared`, in
the data schema from 3), or the next tidy would fill it back in. A row a
name filed onto a pulled club whose own schedule has none is taken off it onto
a stand-in of the name, as **A name is checked against the club's own schedule** sets out; two ids are one
squad only when their _own_ schedules filed the same fixture against one third pulled club, read by its
id, at one level, in one state, under one listing name, and never where the owner has said the two are
two clubs, nor where two squads folding into a third in one pass could not be one club themselves (tidy
rules 37: a TBD reads as one name wherever it is written, so two squads of one name that each beat a TBD
5-3 on one day, hours apart, were folded into one club, the owner's answer unread; a stand-in's name is
as many teams as wrote it, and so is a pulled club's, so two that each beat a different pulled club of
one name were folded the same way; and the two squads' own tie with each other read the same from
either side, and made one club that played itself; a fold made before stays, since the tidy folds and
never splits, so such a pair is one club until the owner unlinks the id); and two clubs' copies of
one game are one game as
**One game on two clubs' schedules** sets out, kept once with the other side's score
noted where they disagree — as is every game above that two coaches scored apart at one
start time (on the stand-in fixtures export of 22 September 2026, 265 games joined, 479
settled and 35 taken back from a namesake). Where the other side is only a name — a
stand-in, a slot, a namesake — the start still has to be the same one, read as the same
minute: a club's own schedule can put two games an hour apart, so within the hour says
nothing about which club a name meant — except against a copy none of the club's own schedules
gives a row, which answers for nothing else the club listed. "Tidy now" on the
import panel runs the same thing for whoever wants to watch.

A pairing with the **same name, same town and same state**, a season apart at
one level, is applied on its own at the end of a pull: that is a club, not a
coincidence. Anything short of all three is **proposed, never applied** — the panel lists the clubs that look like the same club a season on (same name at the same level plus a pulled club in common, or two coaches in common; a shared name and state alone is no offer, since every rec league in a state has a Yankees), with a tick-all for the
list and a tap on any name to lay the two side by side: GameChanger's name for
each, town, state, record, games held here, and every opponent, with the ones in
common marked. A team's own panel lists the GameChanger ids it is known by,
unlinks one that was paired wrongly, and folds this team into another for one
that arrived twice. Beside each id it gives GameChanger's own season record for
it and when it was last pulled, so a record that looks off can be checked without
leaving the page. It says no more than that: on the pool of 24 September 2026
GameChanger's record disagreed with the team's own GameChanger schedule for about a
quarter of clubs, so a difference is a reason to look, not a verdict.

A run of a few thousand teams takes a while and saves as it goes: the pool is
written every two thousand teams, and less often as it grows, up to every five
thousand, because each save writes the whole pool however few teams came with it.
The cursor only advances after the write, so stopping, reloading or closing the
tab costs at most those two thousand teams, or five thousand on a nationwide pool.

## How much comes round at once

Two cadences, chosen in the import panel and remembered. **Every age group, daily**
is the default: the board is only as current as its newest game, and waiting for a
level's turn means answering with a week-old week. It costs a full run's worth of
requests and of saving each day, which is the reason the other choice exists.

**One or two levels a day** spreads the work over a week instead, so no day's run
is long enough to be worth interrupting and nothing is more than seven days old:

| Day       |          | Day      |                      |
| --------- | -------- | -------- | -------------------- |
| Sunday    | 8U, 9U   | Thursday | 12U, 13U             |
| Monday    | 16U, 17U | Friday   | catch up on failures |
| Tuesday   | 10U, 11U | Saturday | 14U, 15U             |
| Wednesday | 18U      |          |                      |

`WEEKLY_ROTATION` in `src/lib/gameChangerSchedule.ts` is the whole of that table;
nothing else reads a day or a level. On the daily cadence every day is also a
catch-up day, which matters more than it sounds: a team with no age is on no page,
so a refresh by level walks past it for ever, and on the rota Friday is the only
day that asks about them at all. The nightly asks about the ones due beside its
own teams on a catch-up day. Until 24 October 2026 it left them out, so only the
Import tab's **Ask again** ever reached them, and a rule that could now age a team
on the list (`withRulesMoved`) waited on somebody pressing it.

Either way a day is counted once — opening the app twice in an evening does not
pull twice — and a level is marked done only when its run actually finishes, so
stopping half way leaves it due. When today is already done there is a button to
run it again anyway, for when something has changed that a day log cannot know
about. On the live page that is **Refresh now** on the Import tab, which runs the
same refresh in the cloud ("Refresh now in the cloud").

Either way, and that button too, only the season being played comes round. A
finished season's pages cannot change, so walking them every day spent a whole
year's worth of requests on nothing. What that costs is a result posted after
August 1 for a game in late July, which the rota no longer goes back for. The
teams waiting on an age are asked about only as the season being played's too (see
**A year put away stays away**).

**Nor a team pulled a few hours ago, unless it is playing.** A team pulled within
the last 16 hours (`MIN_PULL_GAP_HOURS`) waits for a later run unless its own
schedule holds a game dated yesterday, today or tomorrow (`idsPlayingAround`), and
the panel says how many waited. Three whole-pool refreshes ran within 42 hours on 25
and 26 September 2026. Of the 53,140 ids that two of them, fifteen hours apart, both
pulled, 10,783 (20.3%) came back with anything new, nearly all of it dated the day
it was pulled; the ids with a game within a day of the earlier pull were 32.3% of
the pull and held 75.2% of the changed ones. The rest of what changed is picked up
by the next day's run instead of costing a second pull of every team. The button
that runs a finished day again keeps to the gap as well, since a second press on
the same evening is how those three refreshes happened, and a team playing today is
never held.

The teams with no age are paced by that same principle, and used not to be. Each
is asked at most once a week — unless somebody has answered for it since its last
ask, which jumps the queue; see **Naming an age** — and left alone only once it has
had both its eight asks and eight real weeks since it was first found. The count on its own used to
be the whole rule, and nothing in `ageUnknown.ts` read a calendar — so eight
"passes" was however long eight presses of a button took. Driving the real
`dueRefresh` and `updateAgeUnknown` over a calendar, a short list was abandoned on
day 8, a list of 4,013 on day 15, and eight presses in one afternoon finished it on
day 2, while the card said "left alone after 8 weeks". `AGELESS_PER_CATCH_UP` is now
a ceiling on how much one run may hold in memory rather than a pacer, so the whole
list is offered at once and a list longer than the ceiling has its overflow asked
the next day rather than the next week.

A club somebody throws out is answered for, and both halves of that now hold: the row leaves the
waiting list at once rather than sitting there until a later pull happens to clean it up, and the
rota stops offering it. Neither used to be true. The decision was written to the dropped-clubs list
and nothing else changed, so the club was handed to the puller on every catch-up day, fetched twice,
and refused by `importOne` only after both requests had been spent — two requests a week, per club,
for an answer already given. At a dozen clubs that is invisible; at thirty thousand it is not.

A team GameChanger says is below the youngest level ranked here is remembered rather
than rediscovered. The paste already drops rows that name a too-young age themselves,
but a row naming no age is kept — most do not name one — so it is fetched, GameChanger
says 7U, and the schedule is refused. Nothing used to remember that, so the next
export spent the same two requests on the same answer, for thousands of teams. The id
now goes in a list of its own, the paste skips it, and `importOne` refuses it before
reading a game. It is a cache of a fact rather than a record of a decision, which is
why it is kept apart from the clubs the user threw out: burying a dozen deliberate
deletions under four thousand toddlers would make that list unreadable. A GameChanger
id is minted per team per season, so this can never hold a club down as it ages up —
next year is a different id.

A club somebody **threw out** is skipped the same way, before a request: the paste
drops it with an "N you threw out, skipped" pill, and every run settles one it still
carries — a run saved before the club went, or a rota or roster run's list — without
asking GameChanger. The importer refused it anyway, but only after fetching its profile
and games, and each refusal was then a row under "Worth a look". Re-pasting the
seasoned list was 53,385 requests of which 20,146 were clubs already thrown out; the
retry the re-paste exists for now spends its requests on the rows that never made it
in.

Only that team's own schedule can answer the question about it. `ageFromOpponentNames`
reads the opponent names off the schedule just fetched, and neither the pool nor the
index is on that path — so pulling other clubs never settles an age, however many of
them name one. What changes the answer is the club editing its GameChanger page, or
the team playing more games against opponents who do name an age.

Nothing fires by itself — there is no server here, and a browser cannot run while
it is closed — so the panel answers "what is due?" when the app is next opened.

**Teams waiting on an age.** Setup carries a card for the ones nothing could settle,
ten at a time. Ten because four thousand rows is not a queue, it is a wall; and the
ten do not reshuffle while they are worked — they stay the ten, shrinking as they are
answered, and the next ten arrive once the last is done. Nothing extra is stored to
track that: a team is answered when somebody named its age or threw it out, and both
of those are already stored, so the queue is derived from them and cannot drift out of
step. Closing the tab loses which ten were in front of you and no work.

Each row carries the GameChanger id and the complete name — the two things needed to
go and look a team up — a link to its page, the reason the age could not be read, and
whatever was kept when it was refused. The reason is the useful part:
`ageFromOpponentNames` gives up for four different reasons and returns one `undefined`
for all of them, so the counts are kept and say which. "None of its four opponents
writes an age" is a rec league and will never come good; "two of its three say 9U" is
settled in a second; no games at all is a blank schedule.

**Only the teams a person can answer.** The owner, 18 October 2026, with 11,489 on the live list:
"No single person can search through 11,000 teams." So the ten are drawn only from teams with
something on the row to answer from, and every other row is set aside, for one of five reasons
read off the row (`setAsideByRule`, `agelessQueue.ts`): the name says it is no team (a word the
import refuses a page on, "old team" or "not a real", only "Team" with a number, a letter or an
age, no letters, two characters or fewer); the schedule reads as made up (named void or do not
use, every game scored on a day that has not happened, or `looksInvented` at half a point or
more); it reads as a high school side (GameChanger's school label, a side that plays varsity and
JV teams, a school's name or initials the refusal at the door does not take); it has no games yet,
or nothing was kept to say it has any; or it has games and not one opponent writes an age of 8U to
18U, which no reading of its opponents can ever age (`writesARankedAge`: an opponent writing 6U or
19U is counted as writing an age, and the tally read back from storage keeps only the ages this app
ranks, so such a row read "Its opponents do not agree: ." over nothing at all, and its line now
says that none of the ages written is one this app ranks). A roster short of nine is set aside as
before. Set aside is worked out afresh from the row each time and never stored, so nothing is
deleted: the rota goes on asking about every such team inside its budget (`ageUnknownDue` and
`ageUnknownAsking` never read the queue), each ask writes a new row with what the schedule says
now, and a team whose new row no longer reads so is back among the ten by itself.

The search still reads the whole list and says of each why it is aside, and under the note the
reading that set it aside and no other (`asideBecause`): a school's name with a practice word in
it is aside as a school, by its name, and says so, not that it reads as a practice account. A side
the import would refuse as a school's, by its name or GameChanger's field, is "left out of the
rankings and off this queue"; one only read as a school's, by who it plays or initials in its
name, is "kept off this queue", and an age named for it files and ranks it as any team's does.

An age can be named for any row but one the import refuses before it reads an age
(`refusedByName`, `refusedAsSchool`): a thrown-out club, a squad refused as a school's, and a page
whose name says it is no team ("Team 7", a practice) or another game, whose age the next ask would
throw away with the row. A page refused by its name keeps the throw-out, which lands at once, and
its note says its next check takes it off the list unless the club has renamed it by then; a squad
refused as a school's keeps no buttons, as before. A name with no letters, or of two characters,
the import files, and an age named for one lands. An age named before for a page the import now
refuses says so ("the next refresh leaves it out rather than filing it"), with its Undo.

The groups under **Settled by rule**, and the pass that clears them, read every row still being
asked about, the set-aside rows among them, as they read before; the downloaded file holds the
queue's rows. Under "Showing 10 of N" the card says in one line how many each rule set aside, that
each comes back on its own once a later check finds that changed, and that Find a team still
finds every one; the live page's card says the same, from the counts the server's `ageless.queue`
now carries. The card's opening line says what is left: teams with opponents who write an age,
too few of them to file the team by or not agreeing on one. On the backup below, 1,361 of the
queue have one such opponent, 181 two and 218 three or more.

Measured on the backup of 11 October 2026, read on 18 October: of the 13,169 listed, 3,067 were
off the queue for a short roster and 10,102 on it. With the rule, 1,760 are on it, the teams at
least one of whose opponents writes an age of 8U to 18U; set aside are 6,713 that play nobody who
writes one (2,873 of them with six opponents or more, and 113 whose opponents write only an age
out of that range), 1,618 with no games, 3,067 with fewer than nine players, 10 whose name says no
team and one high school side, and none for a made-up schedule, the import refusing those at the
door now. Searching each of the 13,169 by its id gives the same reasons in the same numbers. The
first sitting over the list (`agelessSitting`) took 138 ms where it took 187, and the next, with
every row's reading cached, 14 ms where it took 36 (medians of seven, Node 24, the two builds read
in one session).

**Two opponents agreeing are enough.** Three agreeing is the old bar and still the one a
split is judged by, but two opponents naming one age with nobody naming another now
settle a team too (`ageFromTwoOpponents`), held to GameChanger's own band. It was
measured before it shipped: over the pool-names export of 23 September 2026, on teams
whose age the pool already files, it matched the filed age for 10,330 of 10,623 — 97.2%
exact, 99.7% within a year, against 99.0% for three — and on the waiting list of the same
day it answers 554. Rows whose stored name or opponents the rules of that day already
answer jump the re-ask rota once (`withRulesMoved`, dated `AGELESS_RULES_CHANGED_AT`), so
the next pull files them rather than the week after; on that list, 815 of 16,611. One
opponent alone is 93.6% and is not enough: one team in sixteen would land a year or more
off.

**Below the bar, the oldest age it has played.** The owner, 23 October 2026: "tentatively file
teams that do not express it under the oldest age of the team they play until they meet the
threshhold for confirming their age based on opponents". So a team none of the rules above can
age is filed at the oldest age any of its opponents is (`oldestOpponentAge`): by the opponent's
name, by the level the pool files it at, or by the club its games found. Every pull of it reads
the rules afresh, so the pull that finds its opponents agreeing files it at their age instead,
and one that finds an older opponent moves it up; its own games go with it to the new page, as
they do when an age is set by hand, so nothing is left listed on the old one. The link records it
(`ageFrom` "tentative") and the panel's line says "from the teams it has played". Nothing on a
board or a row marks it as unconfirmed, at the owner's word.

The oldest rather than the commonest because the two part only where a squad plays up, which a
team does far more often than it plays down. Measured on the backup of 11 October 2026, on the
52,546 clubs whose age GameChanger or their own name gave and that had a game: the first opponent
alone is the club's own age for 86.9%, the older of the first two for 89.2% (a year too old for
8.0%, a year too young for 1.7%), and where those two disagreed the older was right for 56.3% and
the younger for 35.8%. Short of the bar the rules above hold to, which is far surer, it is the
better guess, and a wrong one mostly files a younger side a year up, where it rates low rather than
pushing a real team down.

Only a team this card would put in front of a person is filed so (`queueWouldAsk`): a full roster,
games, an opponent writing an age of 8U to 18U inside GameChanger's own band, and nothing that
reads as a school's side, a made-up schedule or a page that is no team. A club filed this way is
no evidence of another team's age, by the level the pool files it at or by the games it played
(`isTentativeClub`), so a guess is never read as a fact that files the next team. On the waiting
list of that backup, 1,704 of the 1,760 teams on the queue would be filed so: 1,329 with one
opponent writing an age, 172 with two and 203 with three or more, 364 of them with opponents that
disagree. Each is asked again at the next pull rather than in its turn (`answerableToday`, the
rules dated `AGELESS_RULES_CHANGED_AT`), so the queue empties of them inside the rota's budget.

A team whose name says a high school squad is not on this card at all, even one that
went onto the list before that rule existed: the name settles it, so it costs none of
the ten, and the next time the rota asks, the answer comes back `high-school` and the
entry retires itself.

Nor is a team whose GameChanger roster lists fewer than nine players (`shortRoster`), by
the user's rule of 28 September 2026: it takes nine to field a side. On the waiting list of
26 September that was 3,232 of 13,962 teams, 1,742 of them with nobody listed at all, where
the clubs pulled with an age list fewer than nine on 1,717 of 53,252 GameChanger teams. It is
held off rather than thrown out: the row stays stored, the rota keeps asking about it while
it has asks left, and each ask replaces what was known — so a squad still being assembled
comes back on its own once a check finds nine. A team nobody gave a count for stays on the
card, and the search still finds a short one and says why it is off the queue.

A lone `V` is one of those names now. Until 18 October 2026 it was the opposite case and stayed: a
capital V standing alone was read as maybe the varsity side and maybe a squad number, a colour or a
coach's initial, so it went ahead of the rows nothing else separated it from, with a line saying
what to look for, for somebody to settle by opening the page. The owner ruled it settled by the
name: "A lone V means Varsity. period." So it reads as `Varsity` does (**High school squads are left
out**, above), the import refuses the page at its next ask, the row is set aside as a high school
squad with no age offered, and the line and the lead it gave the row in the queue's order are gone.
A V a digit, a dotted initial, an apostrophe or an accented letter joins to a word ("V8",
"N.V.B.A.", "Válcor") is not standing alone, and its row waits like any other.
None of the 13,169 rows waiting in the backup of 11 October 2026 has such a name; the queue holds
the same 1,760 it did, the rule that reads who a team plays now counting a lone-V opponent as a
school side and moving none of them. The card still carries a **High school** button beside **Not a
real team**, for a side a person reads as a school's that no rule does, since a varsity side is a
real team that simply plays a season this app does not rank. Both buttons do the same thing to
storage: thrown out at once, and never brought back.

**Finding one team.** The card carries a search box, and it reads the **whole list** rather than
the queue. It matches the name, the GameChanger id, the town and state, and the opponents the card
already shows — a club is remembered by where it is from as readily as by its exact squad name.
Every word has to appear and they need not be adjacent or in order, because the real names on this
list read "Mears 1 - 2026" and a plain substring test turned "mears 2026" into no matches at all.
Best match first — the whole name, then the start of it, then anywhere — because ordering matches
by how invented a page looks puts the wanted team past the cut. That is the point of it: the queue is the small end, ten at a time out of tens of
thousands, so "I know this club is in here" is very often a team the queue is deliberately not
showing. A match that is off the queue is shown with the reason — you threw it out, you already
named its age, it reads as a high school squad, it was left alone after its asks ran out, or one
of the rules that set a row aside — and for the two of those that are your own answers, an **Undo
that** button takes it back.
Before this there was no way to undo either one anywhere in the app.

**An age from the organization a team sits under.** The very bottom of the ladder. An
organization named "TPABL 12U" or "GLL 8u Fall 2026" is saying what age plays under it, and
for a team with no age of its own that beats nothing, which is what such a team has.
GameChanger's public API has no route from a team to its organization, so this only arrives
from a crawl that found the team through one.

Refused for events and for spans, and both refusals are measured. Over 17,003 teams
carrying an organization, 2,240 had both an org naming an age and an age of their own to
check against. The org's age agreed **90.1%** of the time; excluding event-sounding names
took it to 94.1%, excluding spans to 93.9%, and excluding both to **95.1%**. The errors are
overwhelmingly one-directional — of 221 disagreements, 197 had the organization _older_ —
which is the play-up signature: "(09/25/2026) 17/18u Super Fall Invitational" holds 16U
teams, "Suburban Travel 13/14u" holds 13U ones.

The span filter allows an optional `U` after the first number as well as the second,
because clubs write it both ways and without that "13U-16U" reads as a plain 16U and files
thirteen-year-olds three years old.

95% is not good enough to outrank anything a team says about itself, so it sits under the
league rung and under the company a team keeps, and only ever answers a team that has no
other answer at all. On a real backlog it reaches **273** rows — small, and honestly so.

**An age from the games themselves.** A no-age team has usually met pulled clubs already, and
the games say which. Each pulled club that played a no-age team holds its own half of the
game, filed against a stand-in carrying whatever its coach typed for that team.
`ageFromFixtures` finds those halves the way the crossed-halves join does: a row a pulled club
filed that day off its own schedule, against a stand-in whose name is a shorthand for this
team, with the result mirrored or at the same start time — and the name this team typed a
shorthand for that club, the two in one region. A game two clubs could each have been names
nobody. Each club counts once, at its own listing's level, and a club listed at two levels says
nothing. The answer is held to the name rule's bar: three clubs, a strict majority, three on
the level it gives. On the stand-in fixtures export of 22 September 2026 the two clubs of one
game were filed at one level 73.5% of the time and a level apart 22%, so one club's level is a
guess and three agreeing is not. From the waiting list's own file, which keeps only three of
each team's opponents, it ages at least 32 teams, and every one of the 31 whose GameChanger age
field gives a band lands inside it. It sits below the opponents' names, and is recorded on the
pull as `ageFromFixtures` as well as among the ages from opponents.

**And last of all, an age the name writes loosely.** The ordinary reader wants an age
with word boundaries round it and a U on both ends of a span, which is what keeps
"12UNDER", a date or a squad number out. So it misses "Spiders12U", "10U_Hartman",
"Donegal Green 12u2", "U13s Blue", and spans written without their U, "Giants 11-12" and
"Braves 9/10". `ageLevelFromLooseName` reads those, a span at its older end the way one
with a U is read: two ages a year or two apart, in order, and not a date or a score. A span
can be two school grades as easily as two ages, and the user settled that in these names it
is ages; a name that says "grade", or puts an ordinal against a number, is left alone. It
is the very bottom rung, below the games, so no team anything else ages moves, and it never
files against GameChanger's own band. On the pool-names export of 23 September 2026 it
fires on 537 of the 102,845 names the ordinary reader finds nothing in — the glued forms
92.9% exactly the age filed and 98.8% within a year, the spans 72.4% and 93.3%, most of the
rest filed at the younger end. On the week's waiting list it reads 545; the band refuses
12, and of the rest 514 are filed and 19 turned away as under 8U. Recorded
on the pull as `ageFromLooseName`.

**A name outranks an age column, on a pasted list.** The age ladder reads two kinds of
age field and does not trust them equally. GameChanger's own `age_group`, first-hand from
its API, outranks a plain age in the team's name. The age column of a pasted list does
not: there the name wins.

The reason is that a column is only as good as whoever built the file, and a name is the
club's own statement. Measured against the 60,040 teams this pool already ranks: over an
83,941-row export the column and the name disagreed 21,320 times, and for the 8,822 of
those whose team could be found in the pool by name, the **name** matched the filed age
7,603 times — 86.2% — against the column's 187, or 2.1%. That export's column turned out
to be the age bucket its crawler had searched rather than the team's own: it was identical
to the file's own `Found Via Ages` in 59,794 of 59,799 rows. "BattleHawks 10U" carried
11U, "MBC 8U" carried 9U, "BNE NTH 1 12U" carried 18U.

A correctly built list points the same way, less starkly. The "Check the id" pull of
40,760 teams found the two disagreeing by one 343 times, with the name carrying the right
level in 267 of them — so it is the age field that wanders, even when nothing is wrong
with it.

**And a name too young to read stops the ladder** rather than letting the column answer
for it. `MIN_GC_AGE_LEVEL` is 6, so "4U Sparrows" and "5U T-Ball Couto Baseball" read as
nothing at all — and without this the ladder fell through to a column that offered 9U.
298 names in that export state an age below the floor and the column offers 9U or 8U for
248 of them. Refusing leaves the team ageless, which is the safe direction: an unaged team
costs its own ranking, where a team aged five years wrong corrupts every club it played.

Across the whole export the two rules move 20,869 rows to a different age and refuse 254
outright, leaving 62,818 exactly where they were.

**The age field GameChanger was already sending.** The age group is not only "12U" and
"Varsity". It carries a small closed vocabulary of its own, and for a long time this app
understood none of it: `parseGcAgeLevel`, `ageLevelOf` and `isSchoolAgeLabel` all returned
nothing for every value in it, so teams whose own page plainly said what they were sat on
the waiting list being asked about every week.

Measured over the 36,194 teams waiting on 22 September 2026, where the field is set on
36,182 of them — 99.97% — and holds exactly eleven values: `Under 13` (27,485), `Between
13 - 18` (3,967), `Over 18` (2,049), `college` (719), `18O` (535), `middle_13O` (419),
`middle_12U` (379), `high_varsity` (313), `high_freshman` (164), `elementary` (104) and
`high_junior_varsity` (48). They are read three ways.

**Adult and college** — `Over 18`, `18O`, `college` — are refused outright, the way a
wiffle ball team is. This app ranks youth baseball, so there is no age on one of these to
find: the `Over 18` rows include "Long island Angels 44" playing "LISM Patriots 44+", and
the `college` rows "MCC Wolves" playing "Coffeyville CC". Asking weekly is two requests a
week spent on a question with no answer. `18O` means eighteen and over and is the one that
brushes against a real 18U squad; of the 3,303 rows carrying any of the three, thirty have
a name that reads 18U-ish and almost all of those are plainly college ("UNT Club Baseball
2026-2027") or a league's own admin account ("FALL Board 2027"). The handful left is the
price of the other three thousand, and a refusal is undoable where a wrong age is not.

**The school bands** — `high_*`, `middle_*`, `elementary` — retire on the same terms as a
varsity side, because that is what they are: "Sentinel JH Bulldogs", "7th CyFair ISD -
Salyards MSM" playing "Cy fair Combo 7th Grade". Note `middle_12U` names an age and is
still not read as one. A seventh-grade school side is a school side; reading the 12 would
file it against travel clubs it never plays.

**The two bands bound an age without giving one.** `Under 13` and `Between 13 - 18` cover
87% of the backlog and can file nobody — there is no single age in either — but they can
refuse one, and that is where their value turns out to be. Against every candidate rule in
`agelessTriage.ts` over the same rows, 1,186 of the 1,203 ages those rules derive already
sit inside the band, 98.6%. All seventeen that do not are the same mistake: a PONY division
word read off a mascot or a university. "SMSU Mustangs Home" is Southwest Minnesota State,
filed `college`, and was about to be ranked at 10U; "Owls Colt" and "Canes Colts" are filed
`Under 13` and were about to be ranked at 16U. The veto lives in `agelessVerdicts` rather
than inside each rule, so a rule written later cannot forget it.

`Under 13` is read as a ceiling of 13 rather than 12, deliberately loosely: Little League's
Intermediate division is ages 11 to 13 and this app files it at 13U, so a twelve-year-old
in that division is `Under 13` and 13U at once and neither is wrong. Read strictly, the
band vetoes 178 Intermediate teams it has no business vetoing.

**The pool's own names, for measuring a rule against what it must not break.** Pool health
carries a **Download the pool names** button: ids, names, the age each team is already
filed under, and the same evidence the backlog rows carry — games, scored, ahead of today,
shutout blowouts, opponents, how many of them named an age, which ages, and a sample of
the ones that named none. No games themselves, so a hundred thousand teams is a few
megabytes. Nothing in the app reads it.

The opponents' ages are read off `GcTeamLink.name` — the name GameChanger gave, age label
and all — rather than the pool's own stored name, which `cleanTeamName` strips the age from.
That distinction is not a detail: "how many of its opponents write an age" is the question
`closed-cluster` turns on, and against cleaned names the answer is no for essentially every
team in the pool by construction. The first export carrying evidence had 50,810 of 50,822
ranked teams reading zero, which made `closed-cluster` look like it fired on 36.5% of the
working pool when in truth the file could not tell.

The evidence half is there because without it the tripwire can only measure the rules that
read a name. The five that read a schedule — `closed-cluster`, `school-by-evidence`,
`near-miss-tally`, `no-games`, `scored-ahead` — could not fire against a file of bare names
at all, and reported a zero that means "not measured" and looks exactly like "safe".
`closed-cluster` alone proposes a verdict for 10,709 backlog rows, so that distinction was
worth the columns. The counts use the same definitions `agelessEvidence` uses, per distinct
opponent rather than per game, because the tripwire compares what a rule does here against
what it does on the backlog and two readings of "opponents" would make that meaningless.

**The stand-in fixtures, for measuring a join by the game rather than the name.** Pool health
also carries **Download the stand-in fixtures**. A stand-in is a club known only because a
pulled schedule named it; the pool-names export found 46,118 of them holding 83,142 results,
4,995 with exactly one ranked club of the same name, age and year, and at least 1,357 of those
mirrored — each of two pulled clubs holding a stand-in for the other, one real game filed as two
halves that never meet. GameChanger's games carry no opponent id, so a name is all a schedule
gives; but a club plays one game at one instant, which makes the start time a proof a name can
never be, misspellings included.

The file holds every row with a stand-in or a TBD on one side and, beside it, each row that
could be its other half. The puller's own second row at the same instant (`same-club`): it
cannot have played two games at once. Another club's unsettled row at the same instant — against
a stand-in, a slot, or a pulled club of exactly the puller's name — whose names both support the
pairing, or one name and a mirrored result (`fixture`). And the same on the same day at another
time (`same-day`), held to both names and no contradicting result, because the two schedules of
one game do not always agree on its start: requiring the times to match once left about a
thousand settled games standing. "Support" is generous on purpose, so a stricter rule can be
tried on the file afterwards: the same key, the same letters run together, a word in common, or
a word one slip apart — which lets a changed digit through too, and "2032" beside "2033" is two
graduating classes, not a typo.

Both searches are run again a week either side, same weekday and hour (`decoy`, `day-decoy`),
where the schedule looks the same and the game is not there, so the rate at which each matches
by chance is in the file beside what it finds — a week rather than an hour, because an hour off
is exactly the mistake two coaches typing one start time make. Rows with nothing beside them are
written as `none`, because they are the denominator. Each side's date, result and last pull are
there too, because the first question about a pair that never joined is why the rung that joins
exact names did not — it needs the dates to agree and the results to mirror.

What the searches leave out was measured, on a pool of 241,000 games built from the pool's own
120,210 team names paired at random, with 5,000 true mirrored pairs planted in it — all 5,000
were found. A row between two clubs already connected to each other is left out: admitting those
raised the stand-in rows with a decoy at the instant from 460 to 2,057 and those with a same-day
"match" from 1,343 to 5,649, all chance, and took thirty seconds rather than twelve. One shared
word with nothing else behind it found
a "match" at the instant for 18,679 of the 84,000 unplanted stand-in rows, more than one in five,
and admitting one name with a mirrored result on the day took the same-day search from 1,343
rows to 6,104 — every one of them chance — so neither is in the file. What chance is left shows
up as about 230 decoys a week-side at the instant and 960 on the day, against 94,000 stand-in
rows. It took twelve seconds, and the button says how far along it is. Nothing in the app reads
it.

Two rules still cannot be measured this way whatever the file holds: `adult-label` and
`school-label` read GameChanger's own age field, which the pool keeps no copy of. The sweep
names them as not measured rather than printing their zero. It goes to `npm run ageless:sweep -- <backlog> --pool=<names>`, which cannot
otherwise ask the only question that matters about a candidate rule — what it would do to
the teams that already work. Because the file carries the filed age, a hit splits into
"agrees with the pool" and "disagrees", and it is the second column that should be zero.

**Clearing what a rule has settled.** The waiting card lists, under **Settled by rule**,
each rule that has claimed rows, with its count, a tickbox and a few of the names, and one
button clears everything ticked in a single pass. It asks first, where the single throw-out
deliberately does not: the argument there is that a dialog in front of the common case
costs a click to guard against the rare one, and here the action _is_ the rare one,
thousands of rows at once that nobody can check by eye afterwards. The dialog says how many
each rule is clearing.

The rules are named by id in `CLEARABLE_RULES`, never picked by tier, and each is a call
already made rather than a guess. Two repeat GameChanger's own age field — adult or college,
and a school squad. The rest are the user's, made over the 38,603 rows waiting on
22 September 2026:

- **Named void or do not use** — cleared whatever its schedule. 68 rows.
- **Tee ball and younger** — tee ball, PONY's Shetland and Foal, and a name stating an age
  under 8U; below the youngest level ranked, as every such team already is at the door. It
  stands down for a name that writes a rankable age of its own. 1,919 rows.
- **Rec ball in a closed league**, cleared for good: nothing will ever age such a team from
  its opponents or join it to a club this app ranks. A team counts only once it has played,
  when nobody it played writes an age, its own name states none (not even loosely, as
  `ageLevelFromLooseName` reads one), and it does not call itself
  an all-star, travel, select, elite or tournament side. Then any one of three things marks
  it: GameChanger files it under Little League, Cal Ripken/Babe Ruth or PONY (13,538); it or a
  team it played is named for a rec division or league — Majors, Minors, AAA, Farm, Coach
  Pitch, "LL", or a league's initials written in capitals like NCLL (4,370); or two of the
  teams it played carry a Major League club's name, the way a house league hands them out
  (1,813). Of those 19,721, 37 carry a word a travel club might, and all but three are Little
  League "National" divisions or plainly house league.

Between them 21,708 of the 38,603, 56%. League initials are read in capitals only, from a stem
of four letters with at most one vowel, and never as an ordinary word: read case-blind,
"Fall", "Ball" and "O'Neill" all end in LL, and a first draft cleared "Aces" for having played
"Riverside Rats Fall 26". The rules that only propose — a closed league that names itself
nothing, a horse mascot, a grade word — are never on the list.

**An empty schedule is judged by its season.** A team with no age and no games at all is
asked about again weekly while its season is being played, because the schedule is a thing
somebody has yet to write. From a season that is over or not begun, the import drops it from
the list without remembering it (`out-of-season`), so a later pull finds it again once its
season comes round with games, and the run's summary counts it rather than listing it under
**Worth a look**. The windows are wide and overlap — spring February to June,
summer May to August, fall August to November, winter November to February under either
year's label — because erring towards "being played" only costs a weekly request. The
season rides on the waiting row and in the downloaded file's **Season** column.

The pass is stored whole before the rows go, at a lazy key beside the pull log, so **undo
outlives the toast**. That matters more here than anywhere else: a team refused at the
door was never filed, so the row on the waiting list is the only record it was ever asked
about, and undoing by re-fetching would cost two requests a team to learn what was already
known. One pass is kept, not a history — what somebody wants is to take back the thing
they just did — and a new pass replaces it, which is also what bounds the size.

**Taking the list away with you.** Thirty-six thousand rows is not a queue anybody works
ten at a time, and the card cannot become a spreadsheet. So a **Download the list** button
writes one: every team still waiting, each with the evidence behind it — the age field
GameChanger did give, its sanctioning body, town, state and season, the games and how many were
scored on days that have not happened, the opponents and whether any of them named an age,
the roster count — and an empty **Answer** column to fill in. It sorts and filters on a
bigger screen than the one it was collected on, and it is the file `npm run ageless:sweep`
reads when the rules are being measured.

It is also the only way this list leaves the browser at a workable size. It rides in the
whole-browser backup too, but that file carries every season and every game beside it and
runs to hundreds of megabytes on a nationwide pool — too big to move, and mostly things
nobody looking at this question needs. These rows are a few megabytes.

The first three columns are named to hit the aliases the team importer already matches, so
a worked file pastes back into the import box as a team list. The fourth is deliberately
**not**: the observed age field is called `Age Field`, never `Age Group`, because the
importer reads `age group`, `age`, `age level` and `division` as the age. Naming it that
way would let GameChanger's own rejected label beat the answer the reader was asked for
precisely because it was rejected — silently, and the moment a division-name rule joins the
ladder. A test pins the name.

Throwing one out does not ask first. This is a queue worked ten at a time and mostly full of junk
that takes a second to recognise, so a dialog in front of every one puts a second click on the
common case to guard against the rare one. The guard sits after the action instead, as an **Undo**
on the toast, where it costs nothing unless it is needed — and it can, because nothing is
destroyed: the club was never filed, so throwing it out writes an id to a list and the undo takes
it straight back off. A team that gets past the toast is still findable by name here.

Saying what age a team is now puts it back in the queue even if it had been left alone, because a
person answering is a third thing that can change the answer and the only one the give-up rule
does not know about. Without that, an age typed against an abandoned team sat in storage and never
reached a schedule.

From 27 September to 18 October 2026 the teams least likely to be real came first, then the
ones that read as high school sides, then everyone else — the user's order, since working this
list was mostly clearing it. Those two groups are the rows now set aside (above), so what is left
on the queue keeps the order it had among itself: least likely real first, then the stalest. A row
carrying a lead went ahead of the stalest until the same day, and the only lead was a lone V, which
the owner's ruling sets aside (above). **Unlikely to be real** is a name nobody gives a team that
plays (the words the import refuses
a page on, `notATeamWord`, and "old team" and "not a real"; "Team 1"; no letters in any script;
two characters or fewer), a triage rule that says so (named void or do-not-use, every game
scored on a day that has not happened), or `looksInvented` at half a point or more — the
score counts games carrying scores on days that have not happened, shutout blowouts, a
record claiming far more games than the schedule lists, a roster under nine. Half a point
because a fifth is one blowout in one scored game, a real team's bad day. **Probably high
school** is GameChanger's school label, a side that plays varsity and JV teams, or a school
name the refusal at the door does not take ("Tigers High-school", "LCHS Fall Ball 2026", a
freshman side), never for a side GameChanger bands under thirteen. Within each group the
least likely real goes first, an empty schedule a little ahead of one with games; then one
carrying a lead; then the stalest. Over the 13,958 waiting on 26 September that is 144
unlikely (113 of them test and practice accounts), 100 high school, and the rest; the first
thirty rows are all "Test", "Practice" and "Delete Me". Read with the import's words from 17
October, the 13,169 waiting in the backup of 11 October hold 49 unlikely by name where the old list
read 23, none lost; 57 of them are refused by name on their next ask and leave. It ran the other way for a while,
likeliest real first, on the argument that the real decisions are what a sitting should
reach.

It is **only an ordering** either way round. A row sorted up says why in one plain line,
and that is all: nothing is thrown out on it, no row is coloured by it, and sorting first
is not the app calling a team fake; an empty schedule is a club somebody made this morning
as often as it is a fiction.

**One shape is thrown out outright: a schedule that is nothing but results from the future.**
Every game on it has a score and every one is dated after today — "Test team" with 68 of 68,
"ShotByKoRob Scout Team" with 13 of 13. No reading of that is innocent, and the rule is the
user's, stated flatly: if a team's entire schedule is completed games in the future, the team is
fake. The import refuses such a schedule as `invented` before it asks the team's age, so it never
joins the waiting list to be asked about every week, and the run hands its id up to the clubs the
user has thrown out. That last part is what makes it stick: the dates give it away only until
they pass, and a schedule of October results refused in September would read as a season played
by November. Only the whole schedule counts — one game already played, or one future game still
waiting for its result, and it is left to `unrealClubs` and a person, as before. A game dated
today is never ahead, and a league row's "M/D" is never compared. The waiting list's
`scored-ahead` rule reads the same definition off the evidence a row kept, so a team already
waiting is named the same way before its next re-ask throws it out; the floor of five games it
used to carry is gone.

**What is left is listed worst offender first, and each row opens its schedule.** Pool
health's "Scored on a day that has not happened" charges each such game to the club whose own
schedule filed it (`filedBy`: the pulled id in `source`, and any other schedule whose own row
scored it), not to both sides. A schedule that listed the fixture with nothing in it filed no
result: every copy of a game folded in is now on record, the victim's placeholder for it
included, and counting those put a real club on the list at three of five beside the club
that invented the scores. An invented game is written by one club against another that never played it, so
counting both put the victim on the list with every invention against it — a real club an
inventor listed as its opponent every week came out above the inventor. A game nothing traces
to a schedule, one typed by hand, still counts against both. The rows drawn above the club list
follow the same order, the worst club's first, and every club and every row links to the
filing club's GameChanger page, so investigating one is a click rather than a search. Past the
first twelve clubs, "Show all" lists the rest.

A club on that list that you know is real can be taken off it: **It's real** remembers its
GameChanger ids beside the clubs thrown out (`loadRealClubs`), backed up with them, so the next
pull does not put it back. Its games dated ahead still count for nothing; only the question is
answered. An answer given by mistake can be taken back: a line under the list says how many
clubs it is keeping off on your word, **Show them** names them, and **Put it back** puts one on
the list again, where it was.

**A win by forty runs or more is suspected of being made up.** Nobody wins a youth game by
9,999 runs, and the pool of 26 September held a game that said so, with 143 others won by more
than 30, 19 of them by more than 100. The rating cap, then 8, held each to an 8-run win;
uncapped, one of them put a club with no other result at the top of the 9U board. Now such a
game counts toward no rating or record (`isImplausibleScore`, read as the rating reads a margin,
both clubs' reports together), and Pool health lists it, widest first, to be deleted —
remembered, as a row dated ahead is — or vouched for with **It's real**, which keeps the margin
vouched for (`ScoutGame.scoreConfirmed`) and counts the game while it still reads that margin: a
vouched-for 41-0 corrected or re-pulled as 9,999-0 is suspect again. One game in eighty is won by
more than 20. The line was thirty when this came in: on that pool 253 clubs' records changed, and
the 9U board barely moved, the median club by one place, nine by a hundred or more, the top ten
not at all. On 21 October 2026 the user moved it to "a 40 or more run lead", the line sign A of
**Clubs removed for you** below had moved to on 11 October. By then the user had vouched for 76 of
the 83 games won by 31 to 39 on the backup of 11 October, so the move counts seven more games;
League Standings' warning of an unusual final reads the same line.

**Asked from thirty runs.** On 26 October 2026 the user asked to be asked about every win by 30
runs or more (`ASK_MARGIN`, `isAskedScore`), so Pool health's list starts there now, with the
line a score counts at left where it was: a game won by 30 to 39 still counts while it waits, and
one won by 40 or more counts for nothing until **It's real**. **Delete** and **It's real** work on
each as before. The clubs that post them head **Clubs that may not be real** from the same line.

The clubs that post them head Pool health's **Clubs that may not be real**, the user's call of 28
September 2026: a club whose schedule filed a win by thirty runs or more (forty until 26 October 2026) that nobody has vouched for is listed whether or not anything of its is dated ahead, charged to the side that
won it where that side's schedule filed it (`filedBy`), so a club whose own schedule records a
rout against it is not said to have won one, and those clubs come first, most such wins first,
with a red pill saying how many; the clubs with results dated ahead follow in their old order.
The list is its own section now, so it shows when nothing is dated ahead at all. **Delete club**
acts at once, without a dialog, as the user asked the same day.

**Clubs removed for you.** The user asked on 11 October 2026 for the obviously fake teams to be
spotted and taken off without them, and for teams named void, test or demo to be among them. So
each night, after its pull and its tidy, and on a night with nothing to pull as well, the nightly
sweeps the cloud copy for them (`obviousFakes.ts`, run from `cloudRunner.ts`), as each leg of
**Refresh now** in the cloud does. A leg of a list pulled in the cloud does not, a pasted list's or
a catch-up's (**Ask again about teams nobody could age**, **Check short rosters again**), nor does
a list with nothing new to pull: the sweep walks every game of the pool, and a whole squad year,
about three times the pool of 11 October, is to come in through pasted lists, so each of their
legs is kept as light as it can be and that night's refresh sweeps what they filed. A pull
in a browser that keeps its own pool sweeps that pool when it ends, in the tidy worker after the
tidy (1.5 s on the pool of 26 September at 18:40 and 2.5 s on 11 October's measured in Node,
which the page's thread would spend frozen). A pulled club is taken off when it shows one of five
signs and nothing keeps it:

- **Routs nobody else lists** (A): two or more wins by 40 runs or more that nobody has vouched
  for, filed by its own schedule, and none of its wins by 40 or more listed by the losing club's
  own schedule, at any age: the user's "repeated wins by 40 or more instead of 30" of 11 October.
  At thirty the sign waited for 11U unless one of the wins was by fifty, since a young travel team
  routs stand-ins and three clubs of 8U to 10U the user had called real were each one such win
  from it on 11 October. At forty the wait changes no mark on the five backups of 25 September to
  11 October, and with the word "real" set aside the sweep takes none of the 131 clubs the user
  had called real, 72 of them 10U and under, so it is gone.
- **One impossible rout** (B): a win by 75 or more that the loser's own schedule does not list. On
  11 October 2026 no game both clubs' schedules list, and none of the 77 scores the user has
  vouched for, reaches fifty (the widest of each is 42.5); on 29 September one game both list read
  54.5, and on 26 September, before the user's own sweep of the 28th, three reached fifty, the
  widest 119. A game the loser lists is never a sign, whatever its margin.
- **Results from the future** (C): three or more scored games, half or more of them its own
  schedule's results dated eight or more days ahead, no opponent's schedule lists any of its
  results dated ahead, and no real opponent's schedule lists any game of it at all. The eight days
  keep out a game keyed a day or two off. The three games are the user's word of 11 October: it
  "can't be a situation where they only have 2 games listed and one of them is in the future". On
  the five backups that leaves C two clubs on each of 25 and 26 September, each with two of its
  three scores dated weeks ahead, both deleted by hand since, and takes from it the next season's
  squads with fewer than three scores that were all it marked on 29 September (two) and 11 October
  (one). Where a club C takes is next season's squad, the list says so, with the day of its first
  score ahead. The last clause is what lets C's lift below hold: without it a club whose mark one
  real game had lifted showed the sign again that night, short of the guard's three or half, and
  was marked afresh, on a day after that game, so that game could never lift it again. On the five
  backups of 25 September to 11 October it changes no mark.
- **A name nobody plays under** (N): its name, or the name of a GameChanger team filed under it,
  has void, test or demo as a word of its own, in any case ("Contest", "Avoid", "Demons" and
  "Testudo" do not), read by the import's own rules for those three words (`madeUpHit`): so
  voided, testing, do not use and DNU, and a word run into another, but not the Austin organisation
  called TEST, Skiles Test or a test-prep sponsor. On the backup of 11 October 2026 the sign's own
  pattern of before read 249 pulled clubs by name, all ten of that organisation's teams among them;
  the rules read 300, those ten fewer and 61 more. It is marked by GameChanger team, so a club with
  one such team among others stands. Since the tidy now deletes a pulled club every one of whose
  names says it is no team, N mostly marks what the tidy leaves: one such team among others.
- **A lopsided game** (H): its own schedule reports a game it won or lost by 40 runs or more
  (`LOPSIDED_MARGIN`) that nobody has vouched for. The user's rule of 21 October
  2026 set it at 100, "if they win by 100 or more, automatically delete the team that is reporting
  a lopsided game like that"; on 26 October they moved it to 50, with the wins from 30 put to them
  in Pool health instead (above), and on 27 October to 40: "40+ run win or loss should equate to
  auto deletion", "of the entire team, because they are clearly fake". On the cloud copy of 26
  October (the 2027 squad year, 386,146 games), 50 took off 14 more clubs than the marks already
  standing, where 40 would have taken 35, 75 one and 100 none. At 40, H marks every club A or B
  would, whatever real opponents list, so A and B now only say why a club went. Only a side
  whose own schedule scored the game is charged, the loser as much as the winner, so a club named
  by another's made-up score stays, and a game no pulled club's schedule scored charges nobody.
  The owner put it that way themselves on 26 October, "won or lost by 50 or more", and chose to
  keep the other side named in such a game on its boards when its own schedule does not list it.
  Each side is read at its own schedule's score, not the rating's average of the two: where the
  schedules disagree, 190-0 against 20-0, the average of 105 would charge the club that said 20,
  and 150-0 against 0-0 would average 75 and let off the club that said 150. It is a mark like
  the others, and then, unlike them, a deletion: where the sweep runs (the nightly, Refresh now,
  and a pull on this device's own copy) every club it marks for H is deleted as **Delete club**
  deletes one (`lopsidedDrops`), the club, every game it is in and its mark, its GameChanger ids
  refused by later pulls. Never a club said to be real or one a League Standings team links (the
  tidy's own spared set), and none at all on a night League could not be read; such a club stays
  marked, under **Removed for you**, for **Put back on the boards** or **Delete for good**. A club
  marked under another sign before takes H as well when its own schedule reports such a game, so
  the deletion reaches a club marked for its wins while the line stood higher.
  Swept from no marks at the first line, 100, the pool of 26
  September 2026 as today's tidy leaves it, before the user's own sweep of the 28th, had 24 games won by 100 or more
  (the widest 9,999), and H marks the 20 clubs whose own schedules scored one of them so, 6 of
  them showing no other sign (read at the average it was 19 and 5: one club's own schedule gave
  100 or more where the other side's gave less); on 11 October the widest game is 54, so it took
  none.

What keeps a club: any of its GameChanger ids, or its club id, said to be real (**It's real**);
being any page's own team; the user's word on it, a pair kept apart, an age named or a score
vouched for in a game of it; for A, B and C but not N or H, real opponents' own schedules listing
three of its scored games, or half of them, a real opponent being a pulled club that shows no sign
(C read without its clause about real opponents, which would make the question ask itself) whatever
marks it carries, since a mark outlives its sign and two clubs marked for their stray scores,
playing each other in the spring, would otherwise keep each other off for good; and a League
Standings team that picks it or is carried onto it by its name. The last only a pass that reads
League Standings can see, so it is checked where the boards are derived, and a club so linked stays
on every board whatever its marks say; Pool health asks the same of every squad year with a season
on a page (`leagueKeptClubs`), so on the live page its two questions read League Standings too.

A mark is kept by GameChanger id, as the clubs thrown out and said to be real are, with the day it
was made and why, in a pool key of its own (`league_forecast_gc_auto_removed_v1`) that the cloud
copy, every backup and every device carry. Nothing is deleted. The club, its games and its links
stay filed and are pulled as before; only the derivation of what the boards know (`deriveAllKnown`)
leaves out a club every one of whose ids is marked, with every game naming it, the way Delete club
would take it out (`withoutClubs`), so the boards, the club cards, Find a team and the ratings all
go without it. A claimed row in one of its games that is another club's own stands back up against
the team it was filed against; one that is the removed club's own goes with it (Delete club now
does the same), which on 11 October left 4 games naming a removed club and now leaves none. A game
the namesake join made with the removed club in for a stand-in is the other club's own row, which
goes back against that stand-in, as Delete club puts it back (**A stand-in carrying the other
club's very name**), rather than go with a club its own schedule never named.
A year's archive is frozen from the same pool (`archivedFrom`), so its tables are the boards on
screen. The Games tab still lists a removed club's stored games, which a mark leaves filed, with
the club named "(removed for you)" rather than a bare "?". A mark stays until something lifts it,
so a club whose results dated ahead have merely been reached stays off: any guard lifts it; A and
B lift on the sign's own escape, A once a losing club's own schedule lists one of the wins counted
or any win of the club's by 40 or more, B once the win counted is listed or every win of the
club's by 75 or more is one its loser lists, read off the club's games as they now stand rather
than the counted game's id alone, since a game the loser comes to list can be filed under another
id (9 of the 97 one-sided games between pulled clubs that both schedules came to list between 29
September and 11 October did); C lifts once a real opponent's schedule lists even one game of the
club's dated after the mark, which is how a squad whose scores ran ahead of its games answers once
it plays, and such a club no longer shows C, so it stays lifted; N lifts once neither the club's
name nor its GameChanger team's has the word; H once no game of the club's own schedule reports a
score by 40 or more, the game deleted, rescored or vouched for. Saying a club is real forgets its
marks there and then, with the answer and in its Undo, rather than at the next sweep, so a club
marked after the card was opened is back on the boards as it is said; a restored backup that says a
club is real does the same.

Pool health lists them under **Removed for you**, newest first, each with when and why in a line
("named 'test'", "its GameChanger team is named '…'" where only that name has the word, "next
season's squad, 3 scores dated from 2027-04-01") and a link to each schedule, and on none of its
other lists: neither what it shows as it opens nor what **Check the pool** finds (the twin pairs,
the rows counted twice, the wrong ages), where on 11 October 1 of the 100 twin pairs paired a removed
club with a standing one, a fold that would have put its games back unsaid, and 7 of the 985 rows
counted twice named one. A club a League Standings team links is listed too, said to be kept on
its boards, and stays on the other lists. **Put back on the boards** forgets the club's marks and
says it is real, so no later sweep takes it again; **Delete for good** deletes it as Delete club
does, which forgets its marks too; **Put back the N taken off on** a day forgets every mark of that
night's sweep and says nothing of the clubs, which is how a sweep that went wrong is taken back as a
whole once what made it go wrong is mended (the next sweep takes off again any club still showing
its sign); **Delete the N taken off on** a day **for good**, once the ones worth keeping are back,
deletes the rest of that night's as **Delete for good** does each, and **Delete all N for good**,
offered where several nights are listed, every night's; each offers Undo. The two bulk deletes say
how many first, as many clubs at once cannot be checked by eye afterwards, and leave a club a League
Standings team links, whose link a deletion would break. A club put back or deleted from the card
leaves its list at once, before the lists are read again, so a bulk delete pressed in between never
takes a club just put back. On the live page one edit takes at most 500 clubs
(`MAX_COMMAND_STEPS`), so a longer list goes as several, and the dialog says first that it cannot be
undone; where a later one fails, only the clubs of those that went leave the list. One edit asks for its Undo, but the server keeps an edit's Undo only up to 500 steps too, and
a club deleted takes 2 with no games and one more for each squad year its games are in, more than a
count of clubs can bound: where the server sends none back, the toast says there were too many to
take back at once (`EditSaid.noUndo`), rather than leaving its Undo out without a word. Find a team says of a pasted id taken off that it was removed, when,
and where to put it back. The thrown-out list is never written, so a re-paste or a re-pull refiles
the club and its mark keeps it off; a fold keeps a club on the boards unless every id it carries is
marked.

Measured with this code on the backups, each swept from no marks. On 11 October 2026 the sweep
takes off 249 of 69,487 pulled clubs, all by N, eight of them only through a GameChanger team's
name; A, B and C find none, the obvious ones having been deleted by hand on 28 September. 48 of
them are on a board, the best 47th, and leaving them off reorders the top 25 of two boards with
nobody new in either. On 29 September it takes off 86, all by N; 39 are on a board, the best 98th,
and the top 25 of four boards reorder with nobody new. On the pool of 26 September at 18:40,
before that sweep by hand, A, B and C take off 21 clubs (9 by A, 16 by B, 2 by C, some by two),
every one of which the user had deleted by 11 October, and N 84 more; 54 of the 105 are on a
board, the best 106th, and the top 25 of four boards reorder with nobody new. Of the 66 clubs the
user deleted by hand between one backup and the next from 25 September to 11 October, A, B and C
had taken 21 off the backup before, every one of them among the 46 deleted between 26 September
at 18:40 and 29 September. On no backup of the five is a club the user had said was real by 11
October taken off, even with that word set aside (131 such clubs were pulled on 11 October). H,
measured on 26 September and 11 October, takes none of them either.

**Naming an age** is the fourth way a team gets one, and it stands in until the club
answers for itself. The named level is used ahead of GameChanger's own field, which is
what lets somebody correct a team filed at the wrong age rather than only one filed at
none — but the moment GameChanger's answer _changes_ from what it was when the name
was given, GameChanger wins and the named level is dropped. `insteadOf` records what
GameChanger was saying at the time, so that is a comparison rather than a guess. A
level outside the ranked range is refused rather than clamped: a stored 6U would be an
answer that files nowhere, taking the team off the waiting list and putting it on no
page, so it would vanish from both.

**Setting a club's age on its panel** is the same answer given to a club the app has already
filed, and it holds harder. The team panel has an **Age** line for any club with a GameChanger
link in the year: the level the app filed it at, and a choice of another. The case that asked for
it, on 28 September 2026, was "Cincinnati Hornets \*Fall Ball\*": filed at 8U 2027 while every club
on its schedule is 9U and several of their names say so, and 8U is below the youngest level with
a table, so it was ranked nowhere and its 9U league could not pick it in Settings. Setting it moves
what is already filed at once (`setClubAge`): its links, the rows its own schedules filed (onto
the new level's page, made if there is none) and its side of every game that recorded an age for
it; a row another club filed stays on that club's page. And it pins the level in the named ages
against each of its GameChanger ids (`NamedAge.pinned`, with the level it replaced in `was`). A
pinned level stands whatever GameChanger later says: it corrects where the app filed a club, and
the level on a link is not always GameChanger's word — a league list, the club's opponents or its
name can have decided it — so "has GameChanger changed its mind?" is not a question it can be
held to. The panel's link line says "filed at 8U" for the same reason, where it said "8U" as if
GameChanger had. The toast's **Undo** restores exactly what was there, and **Let the app decide**
takes the pin off and puts each of the club's ids back at the level it had been filed at, until a
pull decides again: a club whose fall and spring ids the app had filed a level apart goes back a
level apart. An id whose earlier level was never known stays where it is for the next pull to
decide. The Age choice starts from the level shown on the page, and starts again when the panel,
left open, is on another year's page.

Naming is only an instruction to the next pull: it is applied when that team's schedule
is next fetched, because the page it is filed under, the link written against it and the
age carried on each of its games all have to agree, and only a fetch produces those. So
a named team goes to the **front** of the next refresh's queue and is exempt from the
week between asks. It has to be: a team is on the review card precisely because a pull
has just failed to age it, so its last ask is a day or two old, and the week gate used to
refuse it — leaving "it will be filed on the next refresh" false for up to a week with
nothing on screen saying so, and the team on no page and therefore invisible to the
League Standings scout picker, which only offers clubs that are on one. The exemption is
spent by the ask it buys, since the fetch moves the last-asked stamp past the answer's
own: an answer GameChanger overrules gets that one ask and then goes back to once a week
rather than being fetched for ever.

**Two things the profile says are kept for the rules to read.** GameChanger reports a
team's **sanctioning body** — `usssa`, `little league` — and the **coaches** on its
public profile, and the app read neither. The body is the only field that says whose
word a division name is, which is the whole difficulty with them: "Majors" is a Little
League division of nine- to twelve-year-olds and a USSSA skill class at any age, and
"AAA" is a local Little League convention, a USSSA grade, and a provincial tier in
Canada. The coaches matter for a different reason, measured elsewhere in this file: two
teams sharing two of them are the same club 97% of the time by state and 89% by town,
and before this that signal only ever arrived on a pasted list — never on the thousands
of teams pulled by id alone. Both ride on a waiting team's row too, since its schedule
is read once and thrown away and a fact not written down there costs two requests to
learn again.

**Finding a club by its coach.** Every club picker — Find a team, the Scouting boxes, a
club's Same team as, and Settings' choice of which club each league team is — searches
the coaches off a club's GameChanger teams as well as its name, and lists up to three of
them under each result, the one the search found first and in bold. Forty clubs can
share a name, and the person looking for one usually knows its coach. On the pool of 26
September, 52,881 of the 53,010 pulled clubs carry at least one coach, three at the
median.

**Finding a club by where it is.** The same pickers take the words in any order and read a
state's name as its code, so "hurricanes ohio" finds the Hurricanes whose line ends in OH:
before, the whole query had to appear as written, and a state had to be typed the way the list
abbreviates it. A state matches its code only as a whole capitalised word, so "indiana" finds IN
but not the "in" of "Pride in Pinstripes". It also matches its name written out anywhere, a
coach's name included: "ohio" finds "Ohio Elite", and "georgia smith" still finds the Texas club
Georgia Smith coaches. GameChanger lists some clubs with no state at all — 1,832 of the 53,010
pulled clubs on that pool — and those are placed by the clubs they played instead: "Wilmington,
played by OH, KY clubs", up to three states, most games first (`statesThatPlayed`). The state a
pulled club's opponents most often come from is its own for 92% of the 48,045 clubs that have
one, and 1,265 of the clubs with none have played a club that does. Clubs known only as a name
on someone else's schedule are found too, on the page their games were filed on, and open there
with every game they are in, though no table ranks them. With them the search offers about
93,000 clubs, so it sorts the list and reads its text once, in the background after the list is
built, rather than on every keystroke: 130 to 190 ms a keystroke became 35 to 55, measured in
Node on 93,000 made-up clubs.

**Finding a club by its GameChanger id.** The same pickers take a GameChanger team id, or a link
to a team's page, and answer with the club that id is linked to (`gcIdsInSearch`): an id is what
somebody holding a team's page has, and until 28 September 2026 a pasted one found nothing. A
twelve-letter word counts as an id only where a club carries it exactly, so a name that long still
searches as a name, and a pasted link no club carries says so rather than only that nothing
matched: the app has no record of the id. That is all it can say, and not that the id was
never pulled: a pull that turns a team away for its season, as a high school or adult side,
or for a request that failed keeps no record of it past the run. So it says to pull the id
on its own with this season and last ticked, the two the pull's picker always offers, which
files it or says why not; a team from an older season is refused, and the run says so. Only
Find a team says it, since only it looks an id up in the whole pool and the lists the app
keeps: a picker over fewer clubs, Same team as or the league's club picker, says only that
no team in its list carries the id.

A pulled id can also end somewhere other than a club, and Find a team says where
(`whereIsGcId`): waiting on an age nobody could read, thrown out, younger than 8U by
GameChanger's word, or filed during a pull still running, which the held index has not
seen. A bare id is answered this way too when it is shaped like one, a digit or a capital
past its first letter, which "Thunderbolts" is not. And a pulled club with no games in the
pool yet, its schedule empty or none of it filed, now has the page its latest link is
filed under (`teamPages`), where it had none and so could not be found at all, not even
by its own id. Both came of the user, on 28 September 2026, pasting an id they knew had
been pulled and being told no team matched.

A team deleted, though, stayed gone with no way back but from Teams waiting on an age: every
import refuses a club thrown out, which is what deleting one is for, and on 21 October 2026 the
user imported one on purpose (Hurricanes, `bKpjvY5AVqOV`) and could not find it anywhere. Find a
team now says such a team was deleted and offers **Bring it back** beside it: the id comes off the
deleted list (`answers`, `droppedClubs`, with an Undo on the live page as on this one), the search
says so at once, and the next import files it.

**Find a team stays up while a pull runs.** Its index is not rebuilt during a run, since every
save hands back new teams and a rebuild reads every stored year; it used to be switched off
instead, which took the box off the top of Rankings for as long as a pull went on. It is held
now: the box finds the pool as it stood when the run began, and is built once more when the run
lets go (`useClubSearch`'s `hold`).

**A backup carries the answers, not just the pool.** The named ages, the thrown-out
clubs, the too-young ids, the deleted rows, the kept-apart pairs and the waiting list
all ride in an `answers` block — in the Team Rankings pool file as well as the
whole-browser one, which was not true until recently: the block was built when a backup
was taken and restored when one was read, and the writer in between left it out. So the
pool file restored answers it had never saved, and since a reset clears every one of
them, the file offered as the way back could not bring them back. None of it can be recomputed — a pool can be pulled
again, a judgement about whether a club is real cannot — and without this, restoring
into a fresh browser threw an evening's work away and then set about rediscovering the
problems it had answered. The block is optional and absent means leave what is there
alone, because "this file predates it" and "this file has nothing to say" are the same
bytes.

**Start from scratch means the whole app.** The reset in Team Rankings' Setup leaves the
browser as if it had never opened the app: every League Standings season, the Team
Rankings pool, every answer above, the Organizations file and the settings. It used to
keep the answers and leave League Standings alone, on the reasoning that a reset was for
the data and not the judgements about it; to the person pressing it, a reset that keeps
anything is not one — they cleared the app and found it still refusing clubs and filing
teams at the ages it had before. `localStorage` goes by prefix (`league_`, `lf_`,
`nkb_`) rather than by a list of keys, so one added later goes too, and the pool's
IndexedDB store is emptied of every key and then read back. If the store keeps any of it,
`localStorage` is left alone — its note saying where the pool lives is what lets a
second try find the rest — and the app says the reset did not finish. Then the page
reloads, since every view holds copies of what it read.
