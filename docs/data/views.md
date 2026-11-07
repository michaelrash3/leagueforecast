# Boards and views a server builds

_Part of the design documents; the map is in the repository's [README](../../README.md)._

## Boards a server can build

The cloud copy is on its way to being the one place the data lives, with members
reading views a server builds rather than every device loading the whole pool
and fitting it itself. The first piece is a way to build the boards anywhere and
get the browser's answer.

**What a page knows** is one pure function of the stored pool,
`deriveAllKnown` (`src/lib/live/allKnown.ts`). It was the body of a memo in
`TeamRankingsView`, which read each League Standings season out of localStorage
as it went. The seasons now arrive through a reader: the page hands it the
storage loaders, and a server would hand it the cloud copy's `league` part.
Nothing else moved, and the page now calls it. What it returns is a year's,
because a league team is carried onto a club off the stored games of the year
being read, so a server derives it once for each year with a page. It walks
every age group each time, in stored order, because a league team's minted id
counts the names minted before it: "Lexington Legends" is `S-LEXI` or `S-LEXI2`
depending on what was walked first.

**The boards** are `src/lib/live/views/board.ts`: every page's table, for the
whole year and for each half, by the same functions the rankings worker uses.
Each page is asked as the page asks the worker, with its own year's pool, and a
fit is shared by the pages whose fit would read the same things, which in a
stored pool is one fit per year and half with every page cut from it. A server
could get three things wrong that the browser never decides for itself:

- **The day.** A game scored on a day still to come rates nobody, and the worker
  reads that day off its own clock, in the browser's zone. Here it is an
  argument, and a server must pass the day its members are in, not its own.
- **The pool's shape.** The worker fits the pool after the trip through the
  compact codec the page ships it in, which marks slot-like names as
  placeholders and drops empty fields. Raw arrays could rank a slot the worker
  hides, so the builder takes the same trip (`asWorkerSees`).
- **The locale.** Rows that tie on rating and margin are put in name order by
  `localeCompare` with the runtime's own locale. A server must run under the
  browser's, en-US.

**Held to the worker to the last digit.** `boardParity.test.ts` asks the
worker's own message handler for every page and half, exactly as the page asks
(the year's pool in the codec, the page's star, the worker's clock), both fresh
for each page and walked through the tabs, where the worker cuts the next tab
from the fit it kept, and builds
the same boards with `buildAllBoards` with the clock moved on, so they can only
match by taking the day they are handed. Every row must be strictly equal, on
the fixture and on restores that repeat a page id, where the page reads the
first copy and the fit a page's level and year off the last. It also checks
that a board survives a JSON round trip, which is how a member would read it,
and that two clubs tied on rating and margin come out in name order.
`TeamRankingsView.allKnown.test.tsx` checks that the pool the real page ships
its worker is what `deriveAllKnown` gives, in the same order. Run on the old
memo before the page was switched over, it showed the two agreed.

The last digit is one JavaScript engine's. The recency weights' `0.5 ** x`
rounds differently in Node 22 and Node 24 (V8 12.4 and 13.6): on the fixture,
8,154 of the boards' numbers differ between the two, none by more than 3.6e-15,
and on an earlier draw of it two clubs tied to that bit swapped schedule ranks.
JavaScriptCore, Safari's engine, run by Bun, gave Node 24's boards exactly.
Browsers run three engines, so a board a server builds is a browser's to the
digit only where the engine rounds alike. Elsewhere the numbers agree to about
the fifteenth place, and clubs tied but for that digit can swap ranks: over
seeds 1 to 40 of the fixture, Node 22 and Node 24 ordered schedule ranks
differently on 11, and the boards' own ranks and row order on none.

So the boards are pinned twice. One fingerprint holds on any engine: every
number cut to the millionth, the ranks left out, each board's rows in id order.
It catches any change that moves a number by more than that or moves a club on
or off a board, and reads the same on Node 22, Node 24 and Bun. The other is
every digit, rank and row order exactly, kept for each V8 version it has been
seen on and taken under English collation, the order a server runs in, and
skipped otherwise; Thai collation, which passes over spaces, orders two of its
ties the other way. It catches what the first cannot, such as the fit summing
its games in another order, which moves only the last bits, and moves them on
both sides of the parity tests at once. Any change meant to move the numbers
updates the pins, raises the board rules' version (`BOARD_RULES`) with a
fingerprint of its own beside the old, and says so. The version was raised once
without moving anything, to 3, as a barrier to the publishers from before the
boards' shape ("Views a server publishes", **What each game did**); its
fingerprint is 2's, which is how the test says no board moved. It went to 5 when a
club removed automatically as plainly made up, and every game naming it, were left
off every board ("Clubs removed for you"): the fixture holds one such club, 5's
fingerprint is the boards without it, and the same fixture with its marks taken
off still gives 4's.

Board rules 6 applied a circular-schedule deduction capped at one rating point,
and the pins of 5 and 4 were checked by adding it back. Board rules 7 replaced it
with each club's starting level (Ratings, **Where a rating starts**). With every
club started at average (the test turns the schedule's communities off), the
boards are 5's to the millionth again, and 4's with the marked club put back;
nothing rebuilds 6's boards any more, since its deduction is gone from the code.
A row now says where its club started and carries no deduction, and a board of
rules 6 still reads on a device of this build, its deduction left unread. The
boards' fit went to version 3 (`BOARD_FIT_VERSION`), so a device on an older build
leaves the new fits alone rather than rebuilding each rating without its start.
The old deduction's notes are kept, marked superseded, in
[the deduction notes](docs/circular-schedule-deduction.md).

The pool these run on is `scripts/poolFixture.ts`: a seeded pool of the 26
September 2026 pool's shape, with invented names. It has ten pages in two squad
years and one with none, League Standings seasons that mint, link and fold,
slots marked and unmarked, routs, disputed scores, scores on days still to
come, and ties. The same seed gives the same pool on every machine,
and the parity tests pass under every time zone and locale tried (UTC, Tokyo,
Los Angeles, Kiritimati; en-US, sv-SE, de-DE, Thai, C). Measured in Node 24, every
board for every page and half took 0.2 s for 3,034 teams and 8,520 games, 2.1 s
for 30,304 teams and 86,973 games, and 6.1 to 6.7 s for 90,904 teams and
258,267 games, the size of the real pool, with the process peaking at 870 to
890 MB resident over four runs, the fixture's own arrays included.

Nothing builds these boards on a server yet; how they are published is next.

## Views a server publishes

A server publishes what it builds to `live/`, in the same Firestore as the copy,
for members' devices to read rather than build. The nightly refresh publishes
every board each night, once it has saved the copy (`src/lib/live/publishCopy.ts`
on `viewStore.ts`; see "The nightly refresh on GitHub"), and once their setup is
done ("Rebuilds after saves: the one-time setup"), a rebuild publishes them again
a few minutes after any save that moved what a board reads. While the rebuilds do
not run (off, paused, failing, or deferred by their budget), a run on GitHub every
half hour publishes them once the copy has been still ten minutes ("Boards caught
up on GitHub"). How a member's device reads them is "The live board on a member's
device", below. Beside them, the Monday nightly keeps its re-measure of where a
rating starts as one small document, `live/closedLevel`, numbers and days only,
which the rules let members read as they read the meta and which no publish of the
views touches ("Where a rating starts").

- **`live/meta`** is one small document naming every view by its key
  (`board:{year}:{page}:{half}`, with `none` for a page with no year): the
  SHA-256 of the view's JSON, the upload that holds it, its pieces and size, and
  the copy it was built from, by id and version. It also says which copy and
  version the views reflect, the members' day they were built for, and the
  newest version of each copy any publish has carried. A device will listen to
  this one document and fetch only the views on its screen, and only when their
  fingerprint has changed.
- **`live/meta/chunks/{upload-n}`** holds each view's JSON, gzipped and cut into
  pieces a document can carry, as the copy keeps its values.

A board is the rows the rankings worker would draw for that page and half, less
the star (`isMine`), which is the owner's: each member's device puts its own on,
by the worker's rule (`withMine` in `views/boardShape.ts`). Each row also says
what the page says of its club, read off the roster of the page's year as the
page reads it: its town and state, which the page shows beside the name and
ranks the state top ten and the state filter by, and whether its games on that
page came from a League Standings season, which the page badges. Beside the
boards, in the same commit, the meta carries `inline.pages`: when the roster was
last pulled (the header's "Schedules last pulled" line, which says no schedules
were pulled only when a meta it read names no pull, and nothing of the last pull
where no meta could be read: until 3.0 it said none were pulled under an older
version's boards), for each page how many counted games each half holds, which decides
the half the page opens on and what an empty half says, and the age groups, for a
device with no copy to lay the page out by (below). The page and
the server count these with the same code (`countedByHalf`, `leagueTeamIdsOn`),
and `boardParity.test.ts` holds every published board, read back through JSON
and starred as a device stars it, to the worker's own rows, with each club's
town, state and badge as the page writes them; the half counts are pinned to the
page's own count on the fixture from before the code was shared. That is
enough for a device to draw a board before it holds the pool. The browser's half
of it (the shape a published board must have, and the star) is a module of its
own that imports types alone, so a page that only reads boards loads neither the
pool's derivation nor its codec.

Each board also says how it stood a week before, as the page's arrows read it: each
row's place on last week's board (`was`, absent for a club that was not on it), and
the day of that board and whether anyone was on it (`past`), so a device can tell a
club new to the board from a half that had not begun. A page that has its own club
gets that club's rank line too (`history`): its place week by week, and how many
clubs each week's board listed by rating (`of`, which the standing line reads the place
against),
walked back from last week's board by the same step the page walks it with
(`rankLineStep` in `rankMovement.ts`), with last week's place on the end. Each past week is another fit
of the year as it stood that day, kept for the build by page, half, fitted year and
day, so the boards of a year that share a fit share its weeks. It is not free: on
the 29 Sep backup, building all 33 boards went from 12.4 s to 37.2 s, the largest
(8,334 clubs) from 631 to 660 KB gzipped, and all of them together 4.4%.

**This week.** Under the page's own club, a card names the board's week from those
same two things alone, its rows and last week's places (`weekMovers`, `thisWeek.ts`):
who came into the top 25 and from where ("new" for a club not on last week's board),
who fell out of it, and the three biggest climbs that end inside the top 100. Each
name opens the club's panel. Nothing is fetched or published for it, so it draws with
the board, and a club that has left the board altogether is not named, since the
board no longer holds its name.

**The Weekly.** Since 27 October 2026 the same card is The Weekly, the owner's pick of the
feature ideas that day, and says more of the week than the moves (`theWeekly.ts`):

- the upset of the week, and up to two more: a result in the seven days before today whose
  winner the board's ratings gave less than a quarter of a chance, as the page's odds read a
  matchup (`previewMatchup`), least likely first. A tie, a game that does not count, a club
  with no row and two clubs nothing compares are none, and a game both schedules list is one;
- the game of the week ahead: of the games still to play in the next seven days between two
  clubs of the board's top 50, the one whose odds are nearest even, the higher pair on a tie.
  Since 1 November 2026 it says its start beside its day, in the reader's own time ("Sat, Oct 31
  · 9:30 AM", `dayAndTime`, as the rest of Team Rankings says one), and a game with no start its
  day alone. The week carries the start on the game (`WeeklyGame.start`), in whole
  minutes since 1970 as a club card's `t` and a Games list's `times` do, and a start plays no part
  in which game is picked. A build from before it reads the game's other fields by name and passes
  over the start, so it raised neither the boards' shape nor their rules: it goes on each published
  board with the boards' next rebuild or the night's, which builds every board again for a new
  day, rather than with a republish after the deploy that would read the whole cloud copy;
- the winning streaks still running, five wins or more, the three longest: each club's games
  of the board's half that count, in playing order as its form line reads them (`byGameTime`, a
  game with no start after the day's timed ones; its own sort put that game first, and a day's
  second game listed with no time cut the run after it short), read back from its latest until
  one it did not win;
- the page's own club's week: its record in the week's games that count, on any page of its
  rating pool, and its best win by the beaten club's place.

The odds are the board's ratings now, after the week's games, so an upset reads a shade less
unlikely than it was before it was played. A device works the week out from its pool; a
published board carries it (`BoardView.weekly`), worked out in the build from the half's games
the build already holds, a pass over them beside the year's fit, so a member's Rankings tab
reads nothing beyond its board; the club's own week comes off the club card the My Team card
already reads. A board without one, or one this build cannot read, draws the moves alone. The
Games tab's Upsets lists every game of the page, or of the club picked, that the ratings shown
called the other way, whatever its day.
`boardParity.test.ts` holds each row's `was` to the arrow the worker's own last-week
board draws, and each line to the one the page walks, a club that joined the board
last week included. Each guard was broken in turn and seen to fail a test, 22 of 22,
three of them only after a test was added for a club new last week.

**Club cards.** The panel a club opens on reads no fit (`TeamDetailPanel`): only the
club, its own games of the year, its opponents' names, its age and its League
Standings link. So beside the boards, from the same build, each club with a game in
a squad year gets a card holding exactly those (`views/clubs.ts`), and a device that
opens a club reads its card rather than the year's pool. A card's games are trimmed
to what the panel reads (`panelGame`: who played, where it is filed, the scores and
side B's own report, whether it is set not to count or its runaway score was
confirmed, its day, its event and each side's level; not its start, since a game
counts as played ahead by its day alone), and sent from the club's side: its
opponents named once, each game pointing at one, and without its stored id, which
the panel only keys rows by. The one exception is a game the club has only because a
name on another club's schedule was matched to it (`filedByNameOn`), whose stored id
the card keeps (`n`, read back as `ClubCard.byName`, by the game's place): that is
where the panel offers Not this team, and the command it sends names the game by it.
On the 29 September backup 8,199 games stood so on 5,983 of its 52,967 pulled clubs,
at most 14 on one club and a median of one, which adds 0.48 MB of JSON to the cards
of every year together (measured). Cards go out in buckets, a year's clubs split by a hash
of their id into 64 views (`club:{year}:{bucket}`, `clubBucketOf`): one view per
club would be a hundred thousand documents to write on a night every club is
pulled, and one per year the whole pool to read for one club.

On the 29 Sep backup's 112,228 clubs of 2027, the stored games made 284 MB of JSON
(55 MB gzipped); trimmed and sent from the club's side, 85 MB of JSON and 17.1 MB
gzipped in all, the biggest bucket 1,838 clubs and 281 KB gzipped, built in 3.15 s. A device reads one bucket to open a club, and nothing more for the
others in it until the next publish. The cards read what the boards read and the
ages a person named, so that key is a board input now (`isBoardInputKey`), and the
boards' record vouches for both.

`clubParity.test.ts` holds every card, read back through JSON and its own check, to
the page's own panel for every club on every page of its year and each span: the
record, each game's line, the games elsewhere, the League Standings link and the age,
the record also over the whole year's games for a year's first clubs, as the page
asks for it. `clubShape.test.ts` pins the bucket hash and reads a card back, a game
against the club's own name and an opponent the roster cannot name included, and
refuses each way a card can be damaged. Each guard was broken in turn and seen to
fail a test, 29 of 29, five of them only after a test was added or tightened.

**What each game did.** A club's panel says, under each game it counted, what that
game did to its rating, worked out on the member's device from the club's card and the
board it already holds, with no read and no wait beyond those. A board's rows are not
enough for it: a club's games are also against sides with no row on the board (clubs
known only from somebody else's schedule, stand-ins, clubs at home on another page of the
pool), and its shown rating is discounted about a centre that is a mean over the whole
year. So each board with rows carries what its rows' games were fitted against (`fit`,
`BoardFit` in `views/boardShape.ts`, built by `boardFitOf` in `views/board.ts`): the
board's day; the fit's residual scale, the centre of its discount and how many standard
errors it takes off; the runs a year of age gap was worth, the most one game counts and
the ridge; the three numbers every game's weight is rebuilt from (`recencyBasisFor`);
and every side a row's rated game names that has no row there, with its fitted rating
to 4 places and its count of rated games, in three lists of one length. They are read
off the games the fit read (`ScoutYearFit.rated`), never the pool. A board with no rows
carries none, and nor would one fitted under a weighting that a game's date alone does
not decide, since no device could rebuild its weights.

On the 29 September backup 20 of the 33 boards carry a fit (the year and the autumn of
the ten ranked 2027 pages; the spring is empty and 8U too young to rank), naming 92,734
sides away in all. The largest board, 8,334 clubs with 7,206 sides away, goes from 661
to 715 KB gzipped (its fit alone is 144 KB of JSON and 53 KB gzipped), still one piece
under the 900,000 bytes a piece holds; all the boards together go from 6,965 to 7,677 KB,
10.2% more, and a small board relatively more (17U's 1,072 clubs, with 2,344 sides
away, from 85 to 104 KB). At 3 places the largest would have grown by 49.8 KB rather
than 54.0, but a game's played-like rating worked out from a 3-place rating was off by
up to 5e-4, where from a 4-place one it is within 5e-5. A fit costs no write and no
read: a board is rewritten whenever its pool's fit moves, since its rows carry
unrounded ratings, and every day, since last week's day moves with it, and a span an
edit does not touch keeps its fit as it keeps its rows. Working out every board's fit
took 1.0 to 1.2 s of a full build (Node 22, against 48 to 50 s for the whole build on
the same machine): one pass over the year's 171,571 rated games for each page, at most
58 ms, with the weights' basis read once a fit (110 ms) rather than once a page.
Indexing each fit's opponents once saved a fifth of that and held 16 MB more while a
pool was built, so it was left out. The boards' fits held 2.1 MB while the boards were
held. A year's fit now keeps the games it rated, which costs 7.9 MB in the 2027 year
fit (48.8 MB against 40.9 MB, 48 bytes a game), on a server one pool at a time and in a
device's rankings worker for as long as it keeps the fit. The nightly's log says what
the fits come to in JSON each night (`viewsReport.ts`), and `npm run live:bench` times
them over a full build, with their size gzipped and the heap.

Two other ways were weighed and set aside. The device could ask the server for one
club's lines as its panel opens: exact, but by that design's own estimate each open
would wait 1 to 1.5 s for them, 4 to 5 s after a save, holding the one edit worker so
that edits queue behind it, and would use about 23% of the month's vCPU allowance at 100
opens a day. Or a family of views bucketed as the club cards are could carry each
club's lines: a one-game edit then rewrote a median of 4 to 7 and at most 15 of a year's
64 buckets (24 trials), where it rewrites 2 today, a device would need a baseline to
read them against, and the lines would come from the same estimate. On the board the cost is
bytes alone, about a tenth more board traffic for every member, whether or not they
open a panel; should that ever bind, the fit can move to a view of its own beside each
board, for a write per changed board and a read per opened panel.

A device draws a club's lines only where they add up to the board it came with: the
fit's version is its own, the club's counted games are as many as its row says and
average its row's margin, and its fitted and shown ratings, rebuilt from the lines, the
row's starting level and the fit, come within 1e-3 of the row's. Anything else draws no line, so a fit that
moves, goes or comes from a newer build leaves a panel as it was rather than drawing lines
that do not add up to the board (The live board on a member's device, **What each game
did**; Ratings, **Game by game**).

Neither number moved. A fit moves no number, row or order on a board, so it raised no
`BOARD_RULES` of its own, and `boardParity.test.ts`'s fingerprints, which are of the rows
alone, are the ones from before it. `LIVE_SCHEMA` stays at 3: a device of an older build rebuilds a
board field by field (`coerceBoardView`) and drops a fit unread, and a board without
one draws as before. The app and the boards' publishers deploy apart, so a raise would
have put every device of the new build on the older schema's notice until a publisher
of the new build caught up, and told every older device to reload. The fit carries its
own version instead (`BOARD_FIT_VERSION`): a fit this build cannot read is dropped and
the board read without it, so no later change to the fit can hide a board. What puts a
fit on every board as soon as a build is out is the boards' shape (`BOARD_SHAPE`, 1
since the fit): each publish of the boards records the shape it wrote with what it
built them from (`BuiltFrom.shape`, which devices do not read), the republish after a
deploy (below) publishes again over boards recorded under an older shape or none, and a
server's rebuild finds such boards stale however current their inputs (`boardsState`),
while it leaves boards of a newer shape alone.

Recording the shape was not enough on its own (found by Codex on #371). A publisher
from before it knows nothing of a shape, so one still running once the boards carried a
fit (a rebuild or a nightly on the older build, a GitHub re-run of an older run, which
checks out that run's own commit, or a rollback) found the boards stale or current by
their rules alone, which were its own, and its publish was let through: it wrote boards
with no fit over them, and a meta that had dropped the shape it could not read, and
members went without what each game did until a publisher of the new build ran again.
A raise of the rules is the one thing such a publisher stands aside for, its rebuild
before it builds and its publish before it writes, and neither its rebuilds nor its
nightly count that as a failure. So `BOARD_RULES` went to 3 with nothing moved, its
fingerprint 2's. A device of a build from before it labels the boards as built by
another version of the app until it loads a newer one, which is so. A later change of
shape needs no such raise: under the same rules, a publish of an older shape than the
boards published is refused as one under older rules is, and a rebuild stands aside
for such boards before it builds. And the republish after a deploy runs where the
boards were built under older rules than the build's (`older-rules`), since rules
raised as a barrier bar nothing until boards under them are out.

`boardFit.test.ts` holds every board's fit on every page and span of the seeded fixture
to the fit its rows were cut from, fitted again: the sides away exactly those its rows'
rated games name off the board, walked club by club (name-only clubs, stand-ins and
clubs of other pages all among them), each rating within 5e-5 and each count the fit's;
the header the fit's own numbers, from which every row's shown rating comes back to the
last digit; and the basis, from which every rated game's weight comes back exactly. It
reads a fit back through JSON and the board's check, and drops each of 23 kinds of
damaged fit with the board still read. Each guard, those of the board's shape and the
republish included, was broken in turn and seen to fail a test, 39 of 39, one only after
a test was added: a rating that rounds to nothing written as -0, which reads back as 0.

**Find a team lists.** Find a team crosses seasons and age levels, so it searches
every club the pool has a page for, not the board on screen. Beside the boards, each
squad year with a page gets its list (`views/search.ts`, `search:{year}`): every
club its pages' box offers, with the line under its name, its coaches and its
GameChanger ids, the page a pick of it opens, and the GameChanger ids the copy keeps
off every page (waiting on an age, thrown out, too young, removed as plainly made up
with the day it was), so a pasted one is
answered as the page answers it (`whereIsGcId`). It is worked out by the page's own
code, now shared (`clubSearch.ts`): the year's roster with its League Standings
teams, over that year's League Standings games and every stored game of every
year. One list per year rather than one in all, since a year's League Standings
teams are on its own pages' lists and no other's. On the 29 Sep backup, 2027's list
holds 104,265 clubs: 10 MB of JSON and 3.6 MB gzipped, built in 1.6 s, and read
back through JSON and its check in 137 ms (Node, unthrottled, median of five). The
backup holds no held ids, and coaches' names are about a third of it (an earlier
encoding came to 2.4 MB gzipped without them). It is read only when somebody goes
to search, and kept by fingerprint like a board. The lists read the copy's lists of
held ids, so their keys are board inputs now. A save is judged by each key's hash,
not by what in it a view reads, so a save that changes only a waiting club's
bookkeeping (when it was last tried, and how often) asks for a rebuild that
publishes the same views: a run's cost and a rewritten meta, for nothing. A pull
that files anything saves teams or games too, which rebuild anyway; how often a
save touches the waiting list alone has not been measured.

`searchParity.test.ts` holds every year's list, read back through JSON and its own
check, to the page's own search on the seeded fixture, with coaches on a club and an
id on each held list: every option, the page each opens, and what the box says of
each held id. `searchShape.test.ts` reads a list back and refuses each way one can
be damaged. Each guard was broken in turn and seen to fail a test, 35 of 35, three
only after a test was added or changed; one of those, the publish taking out a year's
lists once it builds none, now holds the club cards to the same.

**Games lists.** The Games tab lists a page's stored games, newest first, each by
its clubs' names, its score or that it is still to be played, its event, its day and
whether it counts. So each page gets a list of exactly those (`views/games.ts`,
`games:{year}:{page}`), in the tab's own order (`loggedGamesOn`, now shared), named
by the year's roster as the page names them, its clubs once each and a game's id
its place in the list. Which games the tab lists first, today's, a device works out
on its reader's own day, as the page does. On the 29 Sep backup the 11 pages' lists
came to 3.1 MB gzipped, built in 0.5 s; the biggest, 12U's 45,107 games among 19,941
clubs, is 534 KB gzipped and is read back through JSON and its check in 44 ms (Node,
unthrottled, median of five).

`gamesParity.test.ts` holds every page's list, read back through JSON and its own
check, to the page's own tab on the seeded fixture, with a game set not to count,
one still to be played and one with no day: every row in order, and the day listed
first and the counts of the rest on the members' day and on the page's busiest.
`gamesShape.test.ts` reads a list back and refuses each way one can be damaged.
`gamesWindow.test.ts` pins the tab's order itself, which both sides share. Each guard
was broken in turn and seen to fail a test, 31 of 31, three only after a test was
added: the order, and a club entry too long.

**League Standings' answers** (from 1 November 2026, the sweep's item 23). A member's
device holds no pool, so League Standings asked the 8 GiB edit function what Team
Rankings has for the open season (`league.bridge`) whenever it opened, came back or saw
a final entered, and Fill's plan (`league.fill`) at every press, each a question that
can be a cold load of the whole pool. The publish already reads every season and holds
the pool, so beside the boards each season whose document there is gets a view of its
own (`views/league.ts`, `league:{season's document id}`): the bridge and the plan its
two questions get, worked out by the very functions the edit function answers them with
(`leagueBridgeFor`, `leagueFillFor`), from the questions a device holding the season as
its document holds it asks (`bridgeQuestionOf`, `fillQuestionOf`), on the members' day
the boards are built for. The clubs each team could be are not in it: they stay a
question, asked as the link panel opens, as do the wide picker's clubs, a league start,
edits, previews and what-ifs. League read from the copy's part has no documents, and no
views.

Each answer carries a fingerprint of what it was worked out from, and a device takes it
only where it is the very answer its own question would get (`views/leagueShape.ts`):

- **The bridge**: the SHA-256 of the question's season, teams and schedule with the runs
  left out (`shape`), and the finals at the fixtures the bridge can turn on, whatever the
  score (`finals`, `finalsTheBridgeReads`): those a club's own row filed against nobody
  could be a copy of (the slot pass of `leagueScoutBridge`); a fixture's final reaches
  nothing else the bridge works out. So a final entered since anywhere else is taken
  exactly, without asking, and one entered where the bridge would pair it with a pool row
  is asked about, so no final is counted twice. On the seeded fixture none of the three
  seasons' 49 fixtures is one of these; `bridgeFinalsRead.test.ts` tries every other final
  every way that could pair a row, on the fixture and on a slot case, and finds the bridge
  the same to the last field.
- **Fill's plan**: the SHA-256 of its season, teams, games and the runs of those games, in
  the schedule's order (`print`), since a device's scores and a document's come in their
  own orders; a score typed since, or corrected, asks.
- **The rules**: the bridge carries the rules a kept bridge's stamp names
  (`BRIDGE_RULES_NOW`), and the plan its own (`FILL_RULES`, 1, raised with any change to
  `planLeagueScoreFill`, which reads no board rule), and a device takes either only under
  its own build's. A deploy that raises either and not the boards' rules republishes
  nothing (`republishWanted` reads the boards' alone), so without the stamp devices would
  have gone on taking answers the old code worked out until the next publish; with it they
  ask the server, as before, until then.
- **The day**: an answer holds from the meta's members' day, which no view in it was built
  after, until the first day a scored game it reads is dated (`until`): the only thing
  either reads of a day is whether a scored game is dated ahead of it. The bridge is held to
  New York's day, which the edit function works it out on; Fill to the device's, which its
  question carries.
- **The pool's side** is the view's entry in the meta, the copy and version of the publish
  that last vouched for it, which every publish stamps afresh at no cost; in the view it
  would make every season's a new upload on every save. A view from before a save this
  device's own edit made of something the answers read (a club folded, a season put on a
  page: `ownEdits.ts`, noted by `callEdit`) is not taken, and an answer heard this visit
  from a later save of the same copy is not replaced by an older publish's: the question
  goes. A GameChanger pull this device started saves through its job, not `callEdit`, so
  is not noted: League Standings can show the bridge from before it, with the publish's
  time, until the publish after the pull catches up, as it does after another device's
  save.

The device reads the meta, one document, and the season's view only when a publish
changed it (`publishedLeague.ts`, kept on the device by its fingerprint as a board is, in
the one cache the live board uses, `browserViewCache`), behind `leagueAsk.ts`'s import, so
League Standings' first download carries none of it. It reads them only where a question
would otherwise go (`useScoutBridge`): Fill's press; the bridge with nothing on hand for
the question (a visit's first with nothing kept, or the teams, schedule or a final changed
since), with a stamp that no longer stands (New York's day turned, or a day gone), or with
the copy's manifest moved since the server's own answer, which is read first, as before,
and where it has not moved nothing more is. Over a bridge itself read off the publish, the
meta is read first, since a newer publish is what replaces it, and the manifest only where
the publish does not answer. A view that does not answer the season as it stands, none
published, or a device offline asks as before, timer retries, their cap of three a day and
the manifest included. So the meta's read is the one thing added, and only beside a
question that would have gone in any case: an answer taken saves that question, its
charge's read and write in the ledger and, on a cold instance, a load of the pool; one not
taken costs a document's read beside it. Those are the questions asked from the deploy
until the first publish after it, those of a season read from the copy's part, which has
no views, those with a final entered at a place the bridge turns on, and those after this
device's own save, until the publish after it. The link panel and the Fill panel say "Team
Rankings as it was published at 7:42 AM" over an answer read so, since it can be a publish
behind a save made since, six or seven minutes on GitHub; one the server answered says no
time.

On the seeded fixture (300 clubs a page) the three seasons' views are 10,112, 17,812 and
7,146 bytes of JSON, 1,560, 2,384 and 1,359 gzipped, one piece each, and 584 bytes of the
meta (2,000 clubs a page: 14,585, 14,576 and 8,721; 2,255, 2,203 and 1,538). Publishing the
same again writes nothing; a republish after one season's score changed writes that season's
view, one piece, beside the boards the score moved and the meta written anyway, and the
other two not at all (`leagueViews.test.ts`); a season renamed writes none. Working the
three seasons' answers out takes a publish 51 ms at 300 clubs a page and 352 ms at 2,000
(8,520 and 58,105 games; Node, median of five), on GitHub, where the publishes run. The family has
a version of its own (`LEAGUE_VIEW_VERSION`, 1), so no `LIVE_SCHEMA`, `BOARD_RULES` or
`BOARD_SHAPE` rose: an older device leaves the views unread, an older publisher leaves them
as they are, and the deploy's republish has nothing to do for them; they first go out with
the next publish. `leagueAnswersPin.test.ts` pinned each season's two answers on the fixture
before any of this, and `leagueViews.test.ts` holds every view to them, to the digit, and to
what the questions answer for the season changed every way above. Each guard was broken in
turn and seen to fail a test.

Readers fetch while a server writes, so publishing keeps four rules
(`publishViews`, `sweepViews`):

- **A piece is never rewritten.** A changed view goes up under a new upload, so a
  reader holding the old meta still finds every piece it names.
- **Nothing is deleted at once.** An upload the meta stops naming is retired, and
  its pieces go only after fifteen minutes; a piece no meta ever named, from a
  publish that crashed between its uploads and its commit, goes after an hour.
  The meta is committed without a retired upload before its pieces are deleted.
- **The meta is replaced only over the version read,** by Firestore's update-time
  precondition; a refusal reads it again and merges again, reusing what was
  already uploaded, without building anything again.
- **No rebuild undoes a newer one.** A publish is late when a newer version of
  its own copy has been published since, by any family of views: the meta keeps
  each copy's newest version while the header or a view still names the copy. A
  late publish replaces only views of its own copy built from no later version,
  takes nothing out, adds nothing the meta lacks, and leaves the meta's copy and
  version alone, so it can bring back nothing a newer publish removed. Its day
  moves the meta's on when a view it placed was built for a later one: the day
  only goes forward.
  A view built again unchanged takes the newer version, so a late build of an
  older one still leaves it. A copy made afresh starts its versions again, and
  each view keeps the copy it was built from: a publish that is not late writes
  every view it built, whatever copy or version the meta had it from, so the
  fresh copy takes over family by family. Two copies have no order between
  them, so a server must not publish from a copy it has seen replaced; a late
  build of the replaced copy is held all the same while the meta still knows
  that copy.

A publish counts every view it built once, family by family (`FamilyCounts`):
**sent**, its JSON uploaded by this publish; **reused**, written from an upload
the meta already names, of the same JSON, under a new version, another copy or
another key, with nothing sent; **unchanged**, the same JSON from the same copy
and version, which only a republish at the same version finds; or **refused as
older**, a late publish's. A night that saves moves the version, so every view
its save did not change is reused rather than unchanged: the nightly of 30
October 2026 built 109 views and said 86 uploaded and 0 unchanged, the 23 it
reused in no count. The log of each server that publishes (`viewsReport.ts`)
now says the reused beside the uploads, and the four counts by family (boards,
buckets of club cards, Find a team lists, Games lists, and from 1 November 2026
League Standings answers), so a night shows which
kinds of view it changed. Uploads and views differ where two views share one
JSON: the seeded fixture's 33 boards went up on 29 uploads.

The shape of the views has a number (`LIVE_SCHEMA`): 2 since the rows gained their
clubs' towns, states and badges, the boards last week's places and their page's
own club's rank line, and the meta its pages' counts; 3 since each League
Standings team and its club in `inline.pages` are a record rather than a
[team, club] pair. Firestore keeps no list directly inside another, and it
refused every save of a meta carrying those pairs with a bare HTTP 400, first
seen on the night after they shipped (10 October 2026; the two rebuilds that
failed the day before save the same meta the same way), so the boards stayed
hidden behind the older schema's notice. The servers' REST
store now refuses such a value itself before sending it, naming the field
(`UnstorableValueError`, a number that is not finite too), the stand-in store
the tests publish through keeps a meta as Firestore would hand it back, so every
test that publishes checks the same, and a refusal Firestore does send carries
its own words into the log. A meta written by a newer
build of the app is left alone, by publishes and sweeps alike, since a sweep
could take a piece the newer build names for a stray. A publish by a newer build
keeps nothing of an older build's meta that it did not build itself, inline
values included, since those have the older shape; the other families come back
as they are next published. Something an older build's device can leave unread raises nothing: each board's
fit is that (above, "What each game did"), and the boards' shape (`BOARD_SHAPE`) has it
published at once instead.

A build deployed over views of an older schema, or onto a cloud with none
published, publishes them again at once (`scripts/republish.ts`, `npm run
republish`). Until then no device of the new build can draw a board, and the
next publish used to be the nightly, which GitHub starts hours late. So does a
build deployed over boards of its own schema recorded under an older shape than
it writes, or under none (`BOARD_SHAPE`): those draw, but without what the build
adds to a board until the next save's rebuild or the night. The
Firebase workflow runs it after a push to main that really deployed (the project
connected and the key set), under the nightly's day, collation and heap. It
reads the meta first and goes on only when there is none, or it is of this
layout and an older schema, or of this schema with boards of an older shape
(`republishWanted`): a meta of this schema and shape, or a newer shape, is the
rebuilds' and the night's to keep current, and a newer build's, or one of
another layout, is not this build's to replace. Its own publish records this
build's shape, so the next deploy of the same build finds nothing to do. It then lays the copy's pool
into memory exactly as a pull does (`loadPoolFrom`), stops at a copy a newer
build saved or tidied (`copyTooNew`), and publishes from it
(`publishCopyViews`), with the copy opened read only and only `live/` writable:
it pulls nothing and saves nothing of the copy, and its log is counts, sizes and
timings, as the nightly's is. Its rules are `republishViews`'s, kept out of the
script so they are tested. It answers for the views at its end, not for its own
publish: a publish turned away is followed by a read of the meta, and the run is
done if it no longer wants publishing (another publisher put out this build's
views, or a newer build's). A copy or a season saved, or the copy started again,
while it built, and a meta that changed under every commit, are tried again on
the copy as it then stands, three tries in all: the rebuild such a save asks for
is not certain to publish (the rebuilds may be off, paused, capped or failing;
on 9 October 2026 three of their five runs failed), and a run that left members
on the notice and said it was done would be the outage it is for. Its boards
stand only while the copy is still at the version they were built from
(`publishCopyViews`'s `atVersion`): its publish over an older schema's meta is
never late, so the marks would not keep it from putting a version saved since
back. Anything else that stops it while the views still want publishing turns
the run red, a later day's or newer rules' views over an older schema included,
since members are still on the notice (or, over an older shape, without what the
build added); a sweep that stops after its views are
out does not, since only pieces nothing names are left, for the night's full
sweep. The copy is opened read only and `live/` alone writable
(`restServerStores`, where which store writes for which opening is tested). It
does not wait on the nightly: GitHub cancels a run waiting in a concurrency
group when the next one joins it, which could lose a night, and two publishers
at once is what the rules here are for.

Two more rules keep a slower or older server from undoing what a newer one
published. A publish for an earlier members' day than the meta's writes nothing,
whatever its version: it was built for a day that has passed. And each family of
views records what it was last built from (`built`): the copy and its version, a
fingerprint of the stored values the family reads, one of the League Standings
seasons when they came from their own documents (`league`, below), the day, the
version of the rules that make the views, and for the boards the shape they were
written in (`shape`). A publish under older rules than that record
writes nothing, so code left running after a failed deploy cannot write over
newer boards (the version only ever goes up, a change undone included); and a
server that finds the record matching the copy at this very version, its inputs,
the seasons, the day and its own rules, in its own shape or a newer one, knows the
boards are current without building them (`boardsState`). A later version with the same inputs is built again all the
same, at no upload's cost, so the copy's mark moves and a slower build of a
version in between cannot publish over it. Where a publish writes a family's
views but cannot vouch for them all (a late one, or one that does not say what
it built from), the record keeps only a floor: no copy or inputs, the newest
rules and latest day any of those views were built under, and the older shape
where both builds said one. It is never current,
and a publish under older rules or for an earlier day still writes nothing;
dropping it, as the first draft did, let an older build that was not late
write over boards a late build had made under newer rules (found by Codex on
the pull request, with the same hole in the day). The boards read the roster, the age groups and each year's
games, and League Standings (`isBoardInput`); a save that changes none of these
cannot move them, and is not counted as changing them. A publish that writes the
meta anyway can take a sweep's commit with it (`collectDue`): retired uploads
past their grace leave the meta in the same commit, and their pieces go after; a
piece that will not delete then is left for a full sweep to find as a stray, and
counted, rather than failing a publish that is already out.

A publish that would write what the meta already says writes nothing at all, not
even the meta; inline values are compared in key order all the way down, since a
store may hand a map's fields back in an order of its own. A publish replaces the
inline values it hands over, by name, and a late one none. On the seeded fixture,
the first publish of its 33 boards is 29 uploads (the five empty boards share
one), 238 KB gzipped (224 KB before the rows said their clubs' towns, states and
badges), and 30 writes with a 6.5 KB meta, of which the pages' counts are 0.5 KB;
publishing the same boards again writes nothing; and a run more for the losing
side of one 10U spring game changes 12 boards and costs 13 writes, retiring 12
uploads for the next sweep. A board takes about 180 bytes of the meta, which a
publish refuses to let pass 500 KB.

The rules let the accounts on the list `get` these documents and nothing else:
not list them, which would cost a read for every piece, and not write them, the
owner included. Only the server writes, as a service account the rules do not
apply to. `firestoreRules.test.ts` holds this on the emulator, together with the
server's own REST store (`firestoreRestLive`): its precondition refusing a meta
written since it was read, and its listing of pieces by name and age with none
of their data. `viewStore.test.ts` holds the rules above against an in-memory
store that counts every read, write and delete; each rule was broken in turn and
seen to fail a test.

A server that rebuilds the boards soon after an edit, rather than once a night,
keeps the pool between rebuilds (`poolCache.ts`): the parts of the copy the
boards read, League Standings among them, and the tidy stamp, in the same
in-memory store the nightly loads. Each rebuild brings it to the copy as it now
stands by fetching only the parts whose hash differs from the one it holds, and
taking out the keys the copy no longer has, all fetched before the store is
touched. It starts afresh on a new copy, after any write to the store it did not
make itself, and whenever the copy keeps an older pool's games under one key or
kept them at the last start: the store splits that key into years as it opens,
and those years are the store's, not the copy's. A store that will not take a
value, or throws rather than say so, is emptied, and a drop waits for any
bring-up under way. Before it reads a piece it
refuses a copy a newer build saved, and one holding a key this build does not
keep, since that key could be one the boards should read; once loaded, it
refuses a pool tidied by newer rules. A piece that is not there is read again
from the copy when a save replaced it mid-fetch, and is damage when the copy
still names it.

On the 29 September backup, in memory, a fresh start reads 27 pieces (21 MB
gzipped) in 1.2 to 1.4 s. One club's edit reads the roster's 7 pieces (5.7 MB) in
0.6 s. One score reads its year's 18 (15 MB) in 1.3 to 1.5 s, no faster, because
that year is three quarters of the pool. A League Standings score reads that part
alone, and a copy with nothing new costs one read. Building every board, with
last week's places, the rank lines, the club cards and the lists published beside
them, takes 26 to 31 s either way (`npm run live:bench`, 4 October; 7 s before
those were added), and the process peaked at 2.6 GB. `poolCache.test.ts` holds a
warm bring-up to what a fresh start on the same version holds, loader by loader
and board by board, after an edit to each kind of input; each guard was broken
in turn and seen to fail a test.

Which saves ask for a rebuild is decided on the save alone (`rebuildPlan.ts`).
A save that moved nothing a board reads (a refresh log, a tidy stamp, a cadence,
a list, an archive's rows, or only the earlier versions kept) asks for none; nor
does a deleted copy, one this build cannot read, or one a newer build saved (a
schema above this build's, or a part under a key it does not keep), which this
build cannot load: a run of it would spend a reservation on every save to no end.
A copy's first save, and the first of a new copy, always asks. Every save in a window shares one queued task,
whose id is a hash of the kind and the window, so a burst of edits is one
rebuild, and so is a burst of saves each under a new copy id (a run builds
whatever copy stands when it runs): two minutes for a device's saves, run five seconds after the window
closes; a quarter of an hour for a server's that publishes what it saved (the
nightly), run ten minutes after, by which time that server's own
publish should be in and the rebuild finds the boards current for three reads;
and a quarter of a minute for the edit function's (`live-edit`), run three seconds
after, since a member is waiting to see each one, but never sooner than a minute
after the last run ended (`LIVE_SPACING_S`, from the ledger's `lastEndedAt`, so a
dry run spaces as a live one does): one asked for sooner is queued again for then,
under one id for every task spaced from that run, and that task runs when it comes
even should the instance's clock read it a moment early, since queued again under
its own id it would be taken for done. A steady run of edits is then a
build every minute and a half or so, each taking in every edit before it. Built
back to back instead, as each window's task alone would have them, a steady half
hour of edits that moved the boards used the day's whole budget in thirteen to
sixteen minutes, and no board moved again that day (simulated in the 1.4 review on
the ledger's own rules and the bench's build times); every board of the real pool
takes about half a minute to build (26 to 31 s on the 29 September 2026 pool,
`npm run live:bench`). Pool health's answers change nothing the boards read, so
they ask for no rebuild at all.

A write of a League Standings season's document asks too (`askLeagueRebuild`),
since the boards are built with those seasons once any has a document ("League
Standings in the cloud") and a device writes them straight to Firestore, with no
server in between to ask. It asks when the season's teams, games or scores moved,
which is all a board reads of it, and when a season is made or deleted, whatever
it holds; a new name, a setting or a bracket game's score asks for nothing, nor
does a season this build cannot read or one a newer build wrote. Its writes share
a two-minute window, run five seconds after it closes, as a device's saves of the
copy do: the season itself is live on every device as a score is typed, and only
Team Rankings waits on the rebuild, so a day's scores entered one after another
are one rebuild every two minutes at most. A pull run in the cloud publishes nothing of its
own, so its saves are rebuilt as a device's are. Who saved is
whatever the saving client says it is, so the name only picks the delay; nothing
is skipped for it. A save is queued only while the switch is on, and a switch
that cannot be read counts as on, since the rebuild reads it again before it
spends anything.

What the rebuilds may spend is kept in `ops/rebuild` (`rebuildLedger.ts`), a
document no rule opens, so no browser reads or writes it, the owner's included:
the switch (`on`, `mode` dry or live, `warm`), the caps, and the totals against
them. The owner makes it in the console with the switch alone; a cap left out is
its default (10,000 GiB-seconds a New York day, 120,000 a month and 30,000
vCPU-seconds, and 3 failures in a row), and each is held to a hard limit
whatever the document says (40,000, 250,000, 125,000 and 10).

The edit function's own compute (its edits, questions and warm-ups) is counted apart, in the
month's `editMonthGiBs` and `editMonthVcpuS` against caps of their own (120,000 and 60,000 by
default, held to 250,000 and 125,000), and none of it counts against the rebuilds'. Until 16
October 2026 it went into the rebuilds' totals: a Setup question the server gave up on was asked
again and again by the device for a day, each try a cold load of the whole pool on an 8 GiB
instance, and October's vCPU-seconds passed their cap with no rebuild run, so every save waited
for the first of November. An edit is never refused for its caps; past them only the questions
that refit a year are (`capsSpent`). Every question's charge already reads the ledger and writes
it back, and three things ride on that one read and write, with none of their own. Its reply says
the edits' month as the charge left the ledger, the New York month and whether either of its
totals is at its cap (`editMonth`, `editMonthOf`), and an unanswered question's error says the
same in its details: League Standings makes no timer retry of its bridge question while that
month is spent, until New York's month turns ("What Team Rankings has, asked of the server", in
"League Standings in the cloud" below), and nothing a person asks is refused for it. A charge the ledger was slow to take (five seconds), or
could not take, says nothing, which a device reads as not known, as it reads a reply from a
server before this. And a question the server spent compute on and left unanswered, a worker out
of memory say, is counted for its New York day (`dayUnanswered`, emptied on a new day as the
day's totals are, the last day before that had any kept as `lastUnanswered`), for the nightly's
alarm ("When a run fails"). One turned away before its turn spent nothing, so its charge writes
nothing, and counting it would be a write of its own: it is not counted, unless it was a new
instance's first call, which is charged the instance's start-up all the same and so is counted.
And every question is counted by its kind for the month (`editMonthAsked`, from 1 November 2026),
under the same rule, emptied with the month's totals, and the nightly says the month's counts by
kind, the most asked first ("Questions asked, 2026-11: league.bridge 1,204, ..."), kinds and counts
only: until then nothing said which questions the edits' 96,053 GiB-seconds of October went on, and
so which answers were worth publishing beside the boards rather than asking for (League Standings'
answers, below). A writer from before the field leaves it out of the ledger it writes back, so a
month's counts start again from the deploy that brings it. October's totals were left as they stood, which keeps the
rebuilds deferred for the rest of that month: raising a cap in `ops/rebuild` lets the next save
start one, since the launcher lifts a deferral whose budget has room again (`requestRebuildJob`).
The nightly says the edits' month and, while the job is deferred, why (its budget, a run still going, or failures in a row) and until when; only a budget's deferral is lifted by a raised cap. A field set to
anything but what it holds makes the document unreadable, which reads as off,
rather than a ledger with its guard lifted. The durable worker reserves the time its current day and month budgets can cover,
including memory, CPU and the Cloud Run job's one-minute billing minimum. Its reservation
has an explicit expiry, so another worker cannot mistake a rebuild lasting longer than
five minutes for a dead one. Actual compute replaces the reservation when the run ends.
Spending, switches, dry/live mode and caps are retained. The first deployment of the job
clears the old function's settled failure pause once, using the `job-v1` engine marker;
new genuine failures still count toward the same failure guard.

**Continuous rebuild jobs.** `onCopyWrite` and `onLeagueWrite` retain their existing
save windows. The `rebuild` task function is a small launcher (256 MiB, one CPU,
120-second request limit). It checks whether rankings are already current before starting
a billable job, preserves the spacing of quick edits and records each pending request.
`ranking-rebuild` runs the calculations in Cloud Run, with 8 GiB, two CPUs, one task,
two execution retries and a two-hour task limit. Its runtime is bounded by the compute
budget it reserved, rather than the old worker's 270-second request cutoff.

One compare-and-swap control document, `ops/rebuildJob`, coalesces incoming saves and
holds the execution lease. Its heartbeat remains independent of the worker's calculation.
A worker checks for saves received during its build before finishing; a concurrent request
cannot be lost between that check and releasing the lease. The in-memory pool stays warm
within an execution and reads only changed cloud pieces for follow-up builds. The first
rankings publish immediately; a short execution uses the remainder of its paid startup
minute to collect more saves.

Every rating pool and season is a saved build step. `buildBoardsWithCache` runs the same
builder as a complete rebuild, including movement arrows and rank history, and reuses a
step only when its inputs, day, rules, shape and JavaScript runtime match. A changed score
invalidates its year's steps while unchanged years can be reused. Private, hash-checked
chunks under `rebuildCache/{fingerprint}/artifacts` keep completed work across an execution
restart and expire after seven days. Missing or damaged cached work is recomputed from
the source. Browser accounts cannot read or write these checkpoints or the control document.

All boards, club cards, search and games views still publish in one metadata commit,
with the existing copy, league, schema and newer-publication checks. An incomplete build
leaves the visible rankings intact. Concurrent saves that move a rebuild's inputs are
handled by a following pass, without counting them as broken workers. Dry mode builds
and caches privately and publishes no member views.

A budget-limited job queues its continuation for the next available New York day or
month before releasing its control record. It does not need another user save to restart.
New requests join that continuation while it waits. Actual worker failures remain errors;
Cloud Run retries them using completed build steps. Budget deferral and execution-lease
interruptions do not increase the failure streak.

The Firebase workflow deploys this job before its launcher, using the existing image
repository, project and `live-runner` account. Job-specific execution permission is granted
to that account. After deployment, `npm run rebuild:request` uses the deployment's existing
key to request stale rankings, joins any active or deferred work, and starts no job when
rankings are current. No new browser setting or secret is required.

The control document records worker heartbeats and current status. Worker logs report
build-step counts, reused steps, budget deferrals, copy/version and publication time.
Read them in Cloud Logging with
`resource.type="cloud_run_job" AND resource.labels.job_name="ranking-rebuild"`.
The existing `npm run live:lag -- rebuilds.json` reads these publication records alongside
the triggers' save records. Tests cover a rebuild lasting past the old cutoff, coalescing,
execution leases, budget accounting and daylight-saving boundaries, checkpoint recovery,
and parity with the original rankings.
