# How the two modes connect

_Part of the design documents; the map is in the repository's [README](../../README.md)._

**League → Team Rankings, always.** A season assigned to an age group brings its
whole schedule: upcoming games show their opponent right away, and once a game is
scored in League Standings it counts as a final here too.

**Team Rankings → League, by choice.** Tournament results sharpen that league's
_opponent-adjusted power ratings_, the matchup analysis built on them, and —
through those ratings — the Forecast board's game picks, the simulated season,
playoff odds and the bracket. See the `useScoutResults` setting. They help most where a
schedule is thin: two teams who never met become comparable through an opponent
they both played elsewhere. The Power Ratings' recent form and trend count them
too, since a tournament last weekend is how a team is playing now; form walks league
and tournament games together in the order they were played, by the day and not by
the text of the date. Records, standings, elo and the standings' strength of
schedule stay league-only. Games carried in from the league are excluded on the
way back, so nothing is counted twice.

**Which club is which, answered once.** The two halves keep separate ids for the
same club and rarely agree on how long a name is — a league roster saying "Trash
Pandas" against a GameChanger team called "Trash Pandas Baseball Club". Matching
on the name alone was a guess that failed silently: that club's tournament
results were filed under an opponent of their own, where they sharpened nothing,
and nothing anywhere said so.

**Which Team Rankings club is each team?**, in Settings, asks once and keeps the
answer. It offers the clubs that could be this team, ordered by how many of that
team's own league opponents they have also played, since a schedule is far harder
to coincide with than a name: "Trash Pandas Baseball Club — Hebron, KY · 2
opponents in common: Bears, Cougars". Each row says where it stands — a **Guess**
matched on the name and is not confirmed, **Which one?** means two clubs share
the name and neither has played anyone you play, **Not here** is an answer rather
than a gap, and **Clash** means two teams picked one club so neither counts.

The same evidence settles the guess: where two clubs share a name, the one that
has played the clubs you play is taken, and where that is not decisive the panel
says so rather than crediting both clubs' games to whichever came first. The
header counts what is linked and how many outside results are counting, so a
league that is contributing nothing cannot look like one that is.

A pick is stored on the league team, so it rides that season's backup, duplicate
and undo. Share links deliberately leave it out: a pool id is minted in the
browser that made it and means nothing in anyone else's.

A pick keeps, beside the club's id, a GameChanger id the club carried when it was
picked (`TeamBase.scoutGcTeamId`, League layout 2, data schema 10): set by the
link panel on a device holding the pool, on a member's phone from the clubs the
server's answer already lists with their GameChanger ids, and by a season started
from Team Rankings clubs or from an organization's schedule. Every club the panel
offers has one, since it offers only clubs GameChanger knows. The one kept is the
club's team of the season itself: one filed on a page that claims the season, the
last pulled first, else one in the season's squad year, else the last pulled
(`gcIdsForSeason`, the order every list hands a club's ids in). A club carries a
team for every season it was pulled in, and the first of them is the one pulled
longest ago: kept with a pick, last year deleted, that team taken off the club, or
Team Rankings started again with only this season's teams pulled back would each
leave a pick of a club still the league's reading as moved. A club's id is the
pool's own, and Start again mints every one afresh; GameChanger's is never another
team's.
So where the club under a pick's id no longer carries that GameChanger id, the pick
has moved: it is followed to the one club that carries it now, whatever that club's
id is (`readPick`), in the forecast, Fill scores and the league's games carried into
Team Rankings alike; and where no one club does, the club under the id is not used
at all, in none of the three, its name included, so a club of the team's very name
in its place takes neither the league's games nor a Fill score; the team falls back
to a guess from its name as a pick of a club gone does, and Settings marks the row
**Moved** and Data Quality says so (`link-moved`). A pick made before the id was
kept reads as it always has, and no club is minted under its id: not after a fold
or a deletion (see "Where the Team Rankings pool lives"), nor under an id let go of
before that was kept, nor after Team Rankings started again, since every mint that
reads League Standings holds as taken every club a League team picks that the
roster no longer holds (`retiredWithPicks`). Such a pick reads as a club gone,
**Gone** in Settings, until its club is picked again, which keeps the GameChanger
id from then on. Two teams of a season whose picks are of two clubs later folded
into one both name the one club, the folded pick followed into it, and so clash
(**Clash**, `link-shared`): the fold says the two are one club, and which team is
it is for a person to say.

A pick made before the id was kept takes it at its season's next save of its own,
in a browser no member has signed in to, whose seasons and pool are its own, where
the club picked carries exactly one GameChanger id (`stampPicks`): a club with
several could be any of them, and waits to be picked again. It is laid over the
page's own edits (`SeasonStore.amendEdits`), a score typed, a team renamed, a game
moved, so the save the edit makes anyway carries it, and none is ever made for it
alone: not as the season opens, not as a change made elsewhere arrives. League
layout 2 already holds the field, so no device of an older build drops it again.
A member's device gives none, signed in or not: its seasons are the cloud's
documents, which an edit made signed out or offline still reaches at the device's
next meeting with them, and its pool, if it kept one, is not the cloud's, so an id
read off it could send the server's bridge (`readPick`, over the cloud's pool) to a
club other than the one the cloud's id names. So the old picks of the seasons in
the cloud keep none until a person picks the team again, which keeps the id the
picker offers. The nightly counts how many are still without one, and how many name
a club carrying exactly one ("The nightly refresh on GitHub"): what a stamp worked
out by the server, over the cloud's own pool, would give them.
The rule a pick is read by (`readPick`) is the one every club this device remembers
is read by (`readClub`, "Clubs this device remembers").

A pick is by id, so a club the league reaches only through picks can be renamed on
Team Rankings and keeps the league's games. A club any season reaches by its name
(a guess, the roster's club of that name, or two picks that clash) has its name
locked, because renaming it would move the league's copy of a game off the club
while the pull's copy stayed, and the game would count twice. Renaming a picked
club to another club's name merges the two and removes the club the pick pointed
to, and the panel says that pick must be made again in Settings.

**Team Rankings → League scores, on request.** Once a club pulls its own
GameChanger team, every result of its league season is already in the pool, and
typing those scores a second time into the league schedule is work the app can
do. **Fill scores from Team Rankings**, on Games, offers them.

It matches a league game to a pool result on the two teams and the day —
the league stores a date as month and day, so that is the common ground — within
the age groups that claim this season. It fills runs, and only runs, which is
everything the standings, the records and the projections are built from.

Nothing is written before the review is read, and three rules keep a wrong score
out of a table nobody can check:

| Case                                 | What happens                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| The league game is blank             | Filled, and marked final. Ticked by default.                                                                  |
| The two spell a club differently     | Offered as **Check name**, with both spellings shown. Never applied unasked.                                  |
| The club's own row names only a slot | Offered as **Check opponent** — its only league game that day, against "TBD". Never applied unasked.          |
| The two clubs' schedules differ      | Both scores shown and either can be filled. Ticked only when they agree on the winner (**Check score**).      |
| A different score is already entered | Shown side by side and left alone unless that row is chosen by name.                                          |
| A pairing plays twice on one day     | Paired in schedule order when both sides have the same number of games; otherwise reported, never guessed.    |
| Two teams one name to the pool       | Turned the way the Settings links, then the clubs' GameChanger names, say; otherwise reported, never guessed. |

**Games the schedule is missing (3.7).** Where both teams of a game are linked to their clubs,
Fill scores also lists the pool's played games between two of the league's clubs on a day the
schedule has those two meet nowhere (`LeagueFillPlan.missing`), to be added with their score,
final. The second game of a doubleheader the league scheduled once is not offered: it is as
likely a scrimmage, and is left to be added by hand. A game that looks like a tournament's
(`tournamentReason`: entered under an event, or either club played a club outside the league that
day) starts unticked, and since GameChanger's schedules do not say who was at home, each can be
swapped. A day a club played two of the league's own clubs is the league's: a league can play two
of its teams on one day, and until October 2026 every other club played that day counted, the
league's included, so both of such a day's games started unticked. Not where the schedule has
either club playing another of its games that day: a meeting beside it is as likely a scrimmage as
a doubleheader's second game, and starts unticked too. The league's-own-day rule is a start's
(below), which has no schedule to say which of a day's games the league played; read by it alone,
the Aces' second game of a day the schedule has them at the Bears started ticked, to go in final.

**Starting a season from its clubs (3.7).** A new season can start from Team Rankings instead of
from typed names, a CSV or the demo: **Start from Team Rankings clubs** on the empty season's
page. Pick a Team Rankings page (the one of the baseball year being played comes first), the
league's clubs on it (the clubs the hand picker offers, GameChanger's at that level or one
below), and the days to look in (the half being played, to begin with). The pool's games among
those clubs come back by day (`draftStart`): played ones with their score and, where the two
clubs' schedules disagree, the other club's version said beside it; ones still to play blank; a
likely tournament meeting unticked. The words above the games say how the boxes start: how many
start unticked as a tournament's, to be ticked where they are the league's, or that all start
ticked (`clubsDraftLead`), which stays true as boxes are ticked; they had said to untick what was
not the league's over a draft whose every game started unticked. Untick what is not the league's
and swap what is the other way round, and the season is made (`seasonFromStart`): a team per club,
named as Team Rankings names it and linked to it (`scoutTeamId`), and a game per one kept, the
played ones final. With games found and none of them ticked, the button asks first ("Start with 0
of 7 games?"), since one tap made a season of teams alone. Only the name and the link are taken
from a club, never its coaches. The season is then put on the page it was started from, as Setup's
League seasons card puts one (`season.assign`), so the forecast and Fill scores read the right page
from the first game. Every step is the same code on this device's pool and on the server's
(`answerStart`, the `league.start` question), so a member's phone, which holds no pool, sees exactly
what a visitor's browser works out. One Undo takes back the teams and games; the season stays on its
page, where an empty one changes nothing.

**Or from its GameChanger organization.** Paste the league's organization ID or its
`gc.com/organizations/…` link into the same panel, asked for on 25 October 2026, and one
question (`league.start` with `org`) does the picking: the organization's teams are the ones the
kept Organizations file lists under it (`MemberOrg.teamIds`, read in Team Rankings → Import), a
club is one a GameChanger team of theirs is linked to (`gcTeams`), and the page is the one most of
those links are filed on, the newest year first on a tie. The answer is that page's clubs with the
organization's picked, a club of theirs filed a level off included, and the draft of their games
over the days shown, so the review opens at once and a club can still be added or taken out by
hand. The panel says how many of the organization's teams are not pulled yet, and an organization
the file does not have is said to be missing rather than guessed at. It asks no more than picking
by hand does: the panel's pages and first page's clubs as it opens, then this one question in
place of a page's clubs and then their games, all read off the pool the server already holds.

**Or from the organization's own GameChanger schedule.** The owner asked on 26 October 2026 for a
league's season to come from its organization's page on GameChanger
(`web.gc.com/organizations/…/schedule`) rather than from the Organizations file and the clubs
Team Rankings has pulled, which a league's organization is often not in. **From an organization**,
on the empty season's page beside **Pick clubs**, asks GameChanger through the app's GameChanger
proxy (`gcOrgSchedule.ts`, `StartFromGcOrg`):

- **Its teams, one request.** GameChanger has no public route from an organization to its games
  that this app has seen answer, but it has one to its teams, `/public/organizations/{id}/teams`,
  which the GC miner reads first. The proxy hands that body back unread (`?org=`), and the browser
  reads it as the miner does (`readGcOrgTeams`): a team page's id (`public_id` before an internal
  one), its name, its season and its age group, whatever wrapping the list comes in. A shape it
  cannot read is said so with its top-level keys, so the owner can say what came back.
- **The league's division.** A league's organization lists every season and age it has run, so
  its teams are grouped by both (`groupOrgTeams`), the newest season first and the youngest age
  in it, and the first group is picked with all its teams ticked. Any can be unticked.
- **Their schedules, one request for every ten teams.** Pulled through the proxy as Team Rankings
  pulls a team's (`fetchGcTeams`). The button says how many requests a pull makes. A team already
  pulled is not asked for again when the picking changes, though a division is drafted from its own
  teams' schedules alone, since another season's teams often share its names; and a team
  GameChanger will not give is named with why and left out. A group of more teams than a league has (`START_CLUBS_MAX`, 64), as
  where the list gives no season or age and every team the organization has had is one group,
  starts with none ticked, and a pull of more is refused.
- **The games between them.** Both teams' schedules list a league game, against the other by name
  only (a public schedule carries no opponent id). So an opponent is one of the pulled teams by a
  name no other pulled team has (`teamNameKey`); each pair's games on a day are paired across the two schedules
  by their start, the nearest within the hour (an all-day copy, with none, takes the other side's
  first left over), so a doubleheader stays two even where one schedule lists only one of its
  games, and a copy matched to none is a game of its own; GameChanger says who was home, so a game is stood up
  away first; the away side's score speaks and the home side's goes beside it where they disagree;
  a canceled game is left out. A game against a team outside the ones ticked marks a league game
  that day likely a tournament's, unticked, as a Team Rankings start marks one (`orgGames`, then
  `draftStart`).
- **The season.** The same review and the same making as a Team Rankings start: a team per one
  kept, linked to its Team Rankings club where this device's own pool pulled one under its
  GameChanger id (a device whose Team Rankings is the cloud's holds no pool, so its teams are
  linked by hand afterwards), and the season is put on the page its age and season name
  (`orgStartPage`: fall 2026 is squad year 2027), as a Team Rankings start puts its own, or left
  for Setup's card where either cannot be read.

Nothing is kept in the cloud or on the device until the season is made. The cost is the
proxy's: one request for the teams and one for every ten teams' schedules, each pressed for, and
on a member's device the one `season.assign` any start makes.

The league and GameChanger rarely agree on how long a club's name is — "Trash
Pandas" against "Trash Pandas Baseball Club" — and a league game left unmatched
looks exactly like one that has not been played, which is what makes silence
here dangerous. So a game the names missed gets a second look against the
results on its own day, under the looser rule the importer already uses, and
anything that lines up is offered rather than applied. Correcting the name in
Team Rankings makes it match on its own from then on. Two clubs close enough to
be confused with each other on the same day are reported instead: "South
Lexington Red" and "…Blue" are four characters apart and are two real teams.

A league team linked to a club in Settings is that club whatever either half
calls it, so it fills as plainly as a name that matches, and its games are read on
every page of the squad year rather than only the pages claiming the season: the
Cincinnati Hornets' fall team is listed at 8U, and its copy of the league's 25
September game sat on the 8U page. Unlinked, another page's club of the same name
is as likely the same organisation's older squad, so it is left alone.

Two league teams that are one name to the pool, "Heat (Coach A)" and "Heat (Coach B)" or "Wolves
9U" and "Wolves 10U" (the pool keeps a club's name without its aside or its age,
`cleanTeamName`), each fit either club, so a result between them fits both ways round. It goes in
the way round that fits better, a side linked in Settings counting for more than names alike; where
both fit as well, the way the clubs' names on GameChanger, kept whole (`GcTeamLink.name`), fit the
teams' names, written alike or alike but for the age (`nameNearness`); and where nothing tells the
two ways apart, it is reported as **Can't tell** and never written. Such a result is still the
game's whichever way round: a score the league already has one way round is its own (**Already
in**), and the game's start reaches the schedule as any matched game's does. Until October 2026 a
result was taken the way the pool listed it whenever that fitted, and the pool lists the pulled club
first, which says nothing of who was home: a meeting the pulled club hosted went in backwards and
ticked, links or no links.

A club's own schedule that was never told the opponent files the game against a
slot, "TBD- 09/25/26, 7:15 PM", and when the other club's schedule is not in the
pool nothing names the game at all. So a league game neither pass can see gets a
last look: the same club, off its own schedule, against a slot on the day of its
only league game, and its only such row. It is offered as **Check opponent**,
never ticked. Stand-ins are not taken, only slots: hiding each real game on the
9U page in turn, taking stand-ins as well offered a different game in its place
9.1% of the time, slots alone 1.5%.

The two clubs' own schedules disagree about one two-sided game in ten on the 9U
page, mostly by a run. Both versions are shown and either can be filled; where
they agree on the winner the fill stays ticked, and where one has a different
winner or a tie it waits as **Check score**.

Games the league itself put into the pool are excluded on the way back, so a
season can never confirm its own scores. Anything already typed into a game —
hits, strikeouts, the innings it was stored with — survives the fill untouched.
So does a score typed in after the review was made: a game whose runs or final
mark have changed since, while the review was open or while the server was
asked for it, is left as it is, and the message says how many were.

**One fixture, one game.** A club that tracks a league here and also pulls the
GameChanger team playing in it has the same fixture twice over: once derived
from the league schedule, once pulled. The pool counts it once, preferring the
league's own record where the league has scored it, so a rating never counts a
game twice. The day is what decides this — the same two clubs meeting on another
date played outside league play, and that game stands on its own. Results
carried back into the league's own forecasts skip its fixtures for the same
reason, whether a club's names match on both sides or it is linked to its league
team under another.

Both copies have to name the same two clubs for that to work, so a league team is
carried in as the club **Which Team Rankings club is each team?** links it to — the
pick, or the guess — and only a team with neither goes by its name. By name alone
it went to whichever club of that name the roster listed first: a Cincinnati 9U
league's "Cincinnati Angels- Red" landed on an 11U "Cincinnati Angels Red" pulled
earlier, the Trash Pandas' own pull had the same game against the 9U club, and the
board showed them 0-7 against GameChanger's 0-6.

A team answered **Not here** is carried in as a club of its own, named as the
league names it, which no name ever leads to: not a league team's name, not the
link panel's guess for a team nobody has answered for, and not a name a pulled
schedule writes, however a game has come to be filed against it. Carried by its
name, as it was until
October 2026, its games landed on a club of that name the person had just said it
is not. The club's id is read off the name ("S-off-" and the name's words, and
for a name with anything but plain letters, digits and spaces, the whole name
written out in base64url after an underscore, so "A.B" and "A B" are two clubs), so it
is the same on every pass and every device, and one already saved to the roster,
as marking it "our team" saves it, is the one carried onto again, under the
league's name: renamed while no league game on the page locked its name, it would
have had the copies of its games read against a name the league never gave it.
Teams answered Not here under one name, on any page of the year, are one club, as
a name is everywhere else. Every other copy of such a game names some other club of the
team's name: a stand-in the import made for it, a pulled club the import filed it
against, or a club typed in by hand. Such a row is filed with the league's own
game when one of its clubs played the team in the league that day, in the same
rating pool, and its other club's name fits the team's; for a league game between
two such teams, when its two clubs fit one name each. With only one league game it
could be, the rules for any copy of a league game then decide which survives,
so the game counts once whatever the copies say the score was, and once on the
schedule before it is played. The league's forecast reads such a row the same way
and leaves it out of the results it takes from Team Rankings, since the league's
own schedule already has the game. A copy kept in the league game's place, while the
league has no score for it, is read as the team's own club's game, not the game
of the club its name led to. A row between two of the league's own clubs goes
with their own league game first. An answer is the season's, as the link panel
shows it: a team answered Not here in the fall and not in the spring is two clubs
on the board until it is answered in both, and a star or state set on the club
its name reached before the answer stays on that club. A game typed in against
the name no longer warns that it is logged already, though it is still counted
once.

A club's own schedule sometimes files the league game against nobody the league
names — a slot such as "TBD- 09/25/26, 7:15 PM", or a one-off spelling of the
opponent — and when the opponent's own schedule is not in the pool, nothing else
pairs it. Such a row, pulled from the club's own schedule and never one typed in
by hand, is the league game when the club, the day and the score from its side
all agree, and only one league game of the club's that day fits; the league's
copy stays, since it names the opponent. 513 Force - Bouley's 0-13
to the Cincinnati Hornets on 25 September was two losses until this, and two
more of that league's games were counted twice the same way, from the Angels'
and Headlines Nagel's schedules against a "513 Force" known by no other name.
Each club's own copy is read on its own, so when both schedules filed the game
against nobody, both copies go. The league's forecast leaves the same rows out
of the results it reads from Team Rankings once the league has the game's final
score, so they are not counted twice there either.

Both passes look across the squad year, not only the page that claims the
league, because the rating is fitted over the year and a club filed at another
age files its own copy on that age's page. The Cincinnati Hornets' fall team is
"Cincinnati Hornets \*Fall Ball\*", which the app filed at 8U — its name carries no
age — and its rows of the league's 9U games sat on the 8U page, never matched. The
name guess cannot find that club — its name is not the league's and it has no game
on the 9U page — so the league's Hornets have to be linked to it in Settings, with
the wide search, or its age set to 9U on its panel, which moves its games onto the
9U page (see **Naming an age**).
Linked, the pool of 27 September with the three October games played counts
every league game once (Yeager Dreyer 2-0, Headlines Nagel 3-0, Trash Pandas
0-7); unlinked or linked to the 9U listing, four were counted twice either way.
The forecast still reads page by page, since it reads only the pages that claim
the league.
