# A page per age level

_Part of the design documents; the map is in the repository's [README](../../README.md)._

The season year is a picker and the levels below it are tabs: pick 2028, then
move along 9U, 10U, 11U. Changing the year holds the level where the new year has
one, so walking a squad forward is one control rather than two.

Each page is a URL — `?view=rankings&age=10&year=2028` — so a page can be sent to
somebody rather than described to them. The URL is what decides the open page,
which is what makes Back and Forward move between them. A link naming only a year
opens that year's youngest page; only a level opens it in whichever year has it;
a link to a page that no longer exists leaves the view where it is and the URL is
corrected rather than obeyed. `?view=` carries the mode too, so a link opens in
Team Rankings instead of wherever that browser happened to be last.

**A page's id is its age and year**, `ag_9u_2027` (`pageIdFor`), wherever a page
is made: a GameChanger pull filing a club at an age with no page yet, a club's
age set or given back, a league season put on a page. Two pulls or two devices
that make the same page make it under the same id. Pages made before keep the
ids they were made under, which said when they were made: the millisecond and a
random number below a thousand, which two pages made in one millisecond shared
about once in a thousand (CI on #461 filed a 9U club on a 12U page that way). Such
an id is now only the fallback where a page of another age already holds the
age-and-year id, and it carries a count that keeps two apart. The owner's
choice of 26 October 2026, until clubs are keyed by their GameChanger ids, which
name teams, one per season, and no pages.

**A default age.** With no page in the link, Team Rankings opens on the age chosen
under the age tabs ("Open on 9U by default"), on this device. It is kept as the
group grows up rather than as one page: the user's rule was "If I have 9u as my
default in 2027, I will want 10u as my default in 2028", so the pick is read as a
class, its year less its level, and each season opens that class's page in the
squad year being played — 10U in 2028, 11U in 2029 (`defaultPageFor`). While a new
season's pages have yet to be made it opens the latest year that has the class's
page, and with none, the first stored page as before. A link naming a page still
wins, and choosing another tab during a visit is unchanged; the default only
decides where an open lands.

A page leads with a **national top 25** and a **state top 10**, the state being
the default state below where one is kept, then yours where it is known, and
otherwise whichever has the most teams there. The place shown in each is the
place in _that_ list: a state top ten is ten teams rated against the whole country
and then listed together, so the second-best team in the state is #2. The full
table is behind a toggle, for finding one particular team in a pool of thousands.

**A club whose games stay in one small league is listed after the rest**, the
owner's rule of 26 October 2026, of the Longhorns: #4 in Kentucky at 9U on an 8-0
record against their own league of eight, whose one game against anybody else
was a loss. A club's web of games is every club it played, every club those
played, and so on, five games out (`teamRankings/opponentWeb.ts`). A board lists a
club whose web reaches fewer than a tenth of the typical club's after every club
whose web reaches that many, each part in rating order. The typical web is the
median over the clubs the board's games name, read off an evenly spaced sample of
4,096 of them, so the line grows with the season: on the cloud copy it was one to
three clubs on the first, eighth and fifteenth of September and 58 by 26 October,
when the typical web reached 580 and the Longhorns' 39. Ratings, odds and every
matchup are untouched; only the order and the numbers beside it move. Measured on
that copy: the Longhorns go to #88 in Kentucky; 64 of 556 state #1s change, 3 of
the 375 whose league plays widely; 245 of 250 national top-25 places stand. No
listing rule predicts who wins better than the rating alone (on 173,614 later
games the club listed higher lost 34.02% of the time, against 33.30% by rating),
which is why it orders the lists and never the odds. Board rules 10.

**A default state.** Beside the state top 10's picker, "Make OH my default"
keeps the state on screen as the one the card opens on, on this device, as the
default age is kept; on that state the card says "Opens on OH" with a Clear. It
opens there on every page with a ranked club from that state, and on a page with
none it opens as it did before, the default kept for the next page that has one
(`defaultStateOf`). Both boards read it, the cloud's and this device's. Picking
another state during a visit is unchanged and keeps nothing. Either button lets
go of a state picked in the select, so the default places the card from then on:
making one leaves the card where it is, and Clear opens it as it would with no
default, on this page and the next.

**Which half a page opens on.** The fall and the spring are two tables, and with no
half in the link a page opens on the one the calendar is in, unless that half holds
less than a tenth of the other's counted games (`HALF_WORTH_SHOWING`). A winter's
tournaments are a sliver of an autumn: the 26 September 2026 pool held 150,408 games
scored in August and September and 317 scheduled for all of January and February.
Opened on the calendar's half the day it held any game, the board went to the spring
on the first January weekend anywhere in the country, a table of a few Florida and
Texas clubs. The halves are counted by the rule the fit counts by (`countsTowardRating`),
so a score typed ahead for March, or a game kept only for the record, is not a spring
either; the pool of 26 September already held two scores dated March 2027.

Above both, the team marked as yours (★) gets a card of its own: its place in the
whole table and among its own state's clubs, its record and rating, and its next
game with the chance to win it (`myTeamGlance`). "Where are we ranked?" is asked at
every field, and without the card the only answer was Show all and a hundred rows
at a time. The card reads only what the page already has, so it costs nothing.

**Movement since last week.** The national board and the card mark how far each
club has moved since the board of a week ago: ▲3, ▼5, or "new" for a club that was
not ranked then. A board's row keeps the bare mark, its words said only to a screen
reader; the card says them ("▼5 since last week", "new this week"), since its mark sat
under the Since line's "▲6", which is since the last visit, and with a hover title for
its only label, which a phone never shows, a red "▼5" read as the same question
answered the other way. A board keeps no history, so last week's is fitted again from the
games played by then (`ranksAsOf`), once the board on screen is up, in the rankings
worker for a large pool. That fit gives every page of the year at once and only its
places are kept, a number a club, rather than a second year's fit of about 44 MB. The
worker answers each tab of the year from what it kept, except a page too young to rank,
which has no places of its own and leaves none for its siblings: before that was kept
apart, a reader who opened 8U first saw no arrows on 9U. A result posted since for a game played before that day is counted in it, so last week
recomputed can differ from what was on screen then. In the first week of a half there
is no board a week ago and nothing is marked.

**The standing line.** Under the card's place, a line of the club's standing week by
week: last week's board, then each week before it, then today's, as the share of each
board at or above it ("top 39%"), the top of the board at the top. It drew the place
until 27 October 2026, and a board fills all season as clubs play their first games, so
a club in the middle sank from #439 on 1 September to #2,737 of 7,126 by late October
while holding its own, and read as a team getting worse. The share is the place over
the clubs that week's board listed by rating, rounded up so it never reads better than
the place, and said as the smaller slice: "top 10%", or below the middle "bottom 16%"
rather than "top 84%". The line is drawn on the whole board, its top edge the top of the
board and its bottom edge the foot.

Both since 28 October 2026, when the owner's club, losing, drew a line climbing all
season. Two things drew it. The clubs a board lists after the rest because their web of
games falls short of the line (`listedLast` on their rows, `opponentWeb.ts`) stood below
every other club by the order, not by rating, and the line grows with the season, so
more of them sat under each club every week: on that day's page the club's share of the
whole board went from the top 83% to the top 71%, of the clubs listed by rating from the
top 93% to the top 84% (a research read of the cloud copy). And the line was scaled to its own
range, at least a tenth of the board, so nine points near the foot ran from its
bottom edge to its top. Now a club near the foot sits near the bottom edge, nine points
are two and a half pixels of 28, and a week the club itself was listed last has no share of
the clubs listed by rating and is left out of the line. Each week's count comes off the
same fit as its places (`pastBoardAsOf`); a week without one, a board published before
it was counted, is left out of the line. A board published before the flag reads as one
listed wholly by rating, its count the whole board, until the nightly publishes it again.
Each week is another fit of the year as it stood that day, so the worker is asked
for them one at a time, naming the club so only its place comes back, and keeps every
board of a line and one more (`RANK_HISTORY_WEEKS`, eight at most, so nine boards, about
28 MB on a year of 76,792 clubs), so walking it does not push last week's out and going
back to a page fits none of them again. A page switch waits on at most one week's fit,
and the walk stops at a week whose board was empty, where the half had not begun, or
at two weeks running without the club on it. Nothing is drawn until two weeks have a place.

**The season beside the ratings.** Since 27 October 2026 the card says three more things
(`clubForm.ts`), each left out where it is not known:

- how tough the club's schedule has been: its place among its state's clubs on the board by
  the fit's own strength of schedule, "11th toughest of 98 in KY";
- its record against the clubs rated here and compared with it, beside the wins its ratings
  expected of those games (each game's chance summed, as the page reads a matchup), "9–11
  against rated clubs, about one win better than the ratings expect (8.1)", within half a win
  "about what the ratings expect", and its record in games decided by one run. The ratings are
  fitted on margins, not results, so a club that wins its close games reads better than its
  ratings;
- its next weekend with a game on it, Friday to Sunday (a midweek game is no weekend's), where it
  has two games or more on it: how many, the wins they add up to, said of the games the ratings
  can call ("from the 2 the ratings can call" where an opponent is unrated, nothing where none
  is), and the game it is least and most likely to win.

The club's panel says its form: its last five games against the clubs rated here, newest
first, each beside the margin the ratings expected (a blowout read at the 14 runs a
projection can state), how many it beat that margin in and by how many runs a game on
average. Both read the club's games of the board's year and half, as its record does: a device
off its pool, a member's device off the club's card it already reads, which names its games of
every year.

**Since you last looked.** Since 30 October 2026 the card opens, an hour or more after the
last visit, on a line of what moved for the club since then: its place nationally and in its
state then and now, each running from one to the other (shown at once where motion is turned
down), its record and its rating, until **Got it**, a button a thumb's size on a phone where it
was a 49 by 26 px chip (`myTeamLook.ts`, `MyTeamSince.tsx`). A look
is kept per club in this browser only (`lf_my_team_look_v1_<club>`): the places, record, rating
and the half of the season the board is for, for the twelve clubs looked at last, the rest let go
as a look is kept (none was ever removed before). The first visit only keeps one; a later one
compares with a look an hour old or more, and keeps a new one at Got it, or at once when nothing
moved (the same places and record, the rating within a twentieth of a run). A look from the
other half of the season is a new start, since the fall and spring boards count different games,
and none is taken while the board is being refitted to the latest games. On the cloud's board,
which draws the board this account kept before the network's, none is taken until the network has
vouched for the board on screen (`checked`): decided on the kept one, the line said nothing of an
overnight climb, kept the old places as seen that day and told the climb a visit late. Offline the
network never vouches, so the line waits for a visit that reaches it. A look keeps a
few GameChanger ids the club carries beside its id, the page's own team first (`keptGcIds`),
and is read by them (`readMyTeamLook`, on `readClub`): one kept for another club the club's id
named once is none of its own, a first visit's, as is one kept with ids where the club now
carries none, and one kept under an id the club no longer has, a
club folded into it or itself before Team Rankings started again, is its own, the newest of
them. This device's copy reads the club's ids off its pool, and the cloud's board off the
club's card, which the line now waits for as it waits for the board. A look kept before, with
no id, is read as it always was. Most visits have
nothing new, so the line's own file is fetched only when there is: with it in the tab, opening
Team Rankings measured 167.1 KB gzipped against 165.4 KB before, and 166.2 KB without. Nothing is
read from or written to the cloud. League Standings' Dashboard has the same idea as a card of its
own ([Since you last looked](../league-standings.md#since-you-last-looked)).
