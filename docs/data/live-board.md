# The live board on a member's device

_Part of the design documents; the map is in the repository's [README](../../README.md)._

A member's device reads the published boards through the sign-in it already
holds for the copy (`liveReader` in `cloudSession.ts`): only in a browser that
keeps a cloud copy, asked before Firebase is loaded, so one that never signed in
never loads it to find out, and only as the account that browser's record is
for. The meta is read with a 10 s limit and each piece with 30 s, as the copy's
reads are. Nothing it reads is trusted (`liveClient.ts`):

- **The meta** must be one this build reads, of this build's schema, with pages'
  counts it can read. Anything else says why: nothing published yet, an older
  build's (until the next publish), a newer build's (update the app), or
  unreadable.
- **A board's pieces,** joined, must unzip to the very bytes the meta's
  fingerprint names, and those bytes must be rows a board can draw, every field
  of every row (`coerceBoardView`). Anything else is damaged, never drawn and
  never kept.
- **A piece that is not there** (a publish retired its upload and a sweep took it
  while the device held the older meta) costs one read of the meta, and the board
  is fetched again from the upload it names now; never more than one.
- **A refusal by the rules** clears every view the device kept, since this account
  may no longer see them; any other failed read is taken for being offline.

A board fetched is kept on the device by its fingerprint (`viewCache.ts`), so the
next open reads it without a piece read, and every read of a kept board checks it
again; one the disk damaged is deleted and fetched again. The views carry no
account, since the same fingerprint is the same board whoever reads it, but the
last meta read and the last board shown are kept for one account, and another
account's are cleared rather than read. The views sit in the pool's IndexedDB
store, under keys the pool never reads and the cloud copy never carries, so a
reset of the app takes them; at most 100 MB are kept, the least recently read
going first, and a browser whose pool is in localStorage keeps none.

Whether a board on screen is the copy's (`boardStanding`) is decided against the
copy as this device last read it (`copySeen`), never against the device's own
pool, which may not be taken in yet: current when the board was built from the
very board inputs the copy held (`boardInputsPrintOf`), behind when the copy has
moved on or no one build vouches for the boards, and unknown before it has read
the copy. Until 1.6f a board was owed, too, while this device had unsaved changes
to a board input (a League change while League Standings was kept live aside,
which went to the season's own document); now no device writes the copy, so the
copy is owed nothing (`copyOwed`), and a change made here, counted owed, would
hold every board as waiting on this device for good.

`liveClient.test.ts` reads boards published to an in-memory store: whole and
strictly equal to what was published, free from memory or the device's cache, one
meta read for a piece that is gone, another board's pieces under a board's upload
and a changed byte both damaged, and a refusal clearing the cache while a failure
does not. `viewCache.test.ts` holds the cache's checks and limits,
`cloudSession.test.ts` who gets a reader and what the device last saw of the copy,
and `firestoreRules.test.ts` the app's own reader on the emulator, reading a board
whole as the owner and as a member signed in under a mixed-case address and
refused to a stranger and an unverified address. Each guard was broken in turn and
seen to fail a test, 27 of 27.

**Team Rankings on the cloud's board.** A member opens Team Rankings on it
(`LiveTeamRankings`), in a browser that keeps a cloud copy and is signed in as a
member, or still finding out. From 1.6e to 1.6f a switch, **Open Team Rankings on
the cloud's board**, could turn it off; with the copy read-only to devices (1.6f)
a device's own pool would save nowhere, so the switch is gone, and `lf_live_v1` is
no longer read. Whether it applies is read as the page opens and kept until it
closes, so the cloud's state moving never swaps one page for the other under the
reader. An account the copy refuses partway through a visit
is asked again whether it may read the copy at all (`owns`), and refused that too,
it is not a member any more, as at a sign-in (`not-owner`), so it opens Team
Rankings on its own pool from then on; a member refused something the rules keep
from devices is only told so, and so is an account whose second look fails or has
not come back within the 20 s the copy's own reads are given (`timedStore`): that
look reads the copy outside them, and unanswered it left a refused save saying it
was saving, with every later look waiting on it. Its page draws the published
board as Team Rankings draws its own: the same header, places, state top ten and
filter, League badges, full table and the member's own club card, from the same
code (`boardDisplay.ts`), with the half the page would open on decided from the
published counts. Its arrows are last week's places the board carries, and the
club card's rank line is the one published with it, drawn only when it is for the
club this device marks as its own on that page. What the board says it is replaces
"Refitting…" (`liveLabel`): offline as of when the server last vouched for it,
still checking, built before this device's changes or the copy's latest, built by
another version of the app, or yesterday's.
It opens on what this account last read and kept, so a board is drawn before any
network read, and then on the network's.

**Opening on a member's phone.** A member's device (`memberBootsLive`: a copy
kept for a member, signed in when last here) draws at once (`bootOrder.ts`): its
pool is not read before the first draw but after it (`poolFill.ts`), and its
session starts beside the page, so the sign-in, Firebase's code and a round trip
or two to restore it, is under way by the time the board asks for its reader.
Everything that asks for the session shares one opening of it: the boot and the
board's reader each used to open their own, the second to finish replaced the
first, and the boot's sign-in landed on a session nobody held, leaving the page
"Connecting to your cloud copy" and League never kept live, so never met, so
waited on at the next open too. Signed in, with no League to take at boot, the
session says it is ready at once and reads the copy's manifest behind it. The
board then:

- reads what the account kept, the meta and the board the page opens on, and puts
  them on screen together, so the board is decoded once; the network's reader and
  meta are asked for at the same moment rather than after that, and the board the
  page opens on is fetched as soon as the network's meta is read, beside what was
  kept rather than after it, with the page's own read of that board joining the
  fetch (`readView`). A view's kept bytes are read off the device once at a time,
  however many reads ask, so the kept board is still decoded once. A board
  or meta the network brings first stays; the kept one is drawn only while
  nothing is. With no reader it says so only once the kept board has been looked
  at, since with none drawn the page would hand over. A refusal heard first leaves
  the kept board undrawn;
- draws a board fetched from the network before keeping it, the write left to
  run behind it;
- gives the phone to the board until it is drawn, or says why not, or three
  seconds have passed (`openingHold.ts`): until then Team Rankings' own code is not
  fetched, the page's own club's card is not read, the watch on the meta does not
  load the full Firestore SDK, and, while Team Rankings is the page shown, League
  Standings neither starts its listener and fetch of every season nor asks the
  server about the open season. League Standings shown waits for none of it. The
  pool's read waits too, since unpacking it takes the main thread the board is
  drawn on, unless something needs the pool first: a hand-over, Team Rankings on
  the device's copy (which says it is reading it), a backup, export or import, a
  reset, League's own bridge where Team Rankings is not the cloud's. Each of those
  waits for the read rather than reading an empty pool.

Measured on the built app (`vite preview`, Chromium at 4× CPU throttling, medians
of five, 16 October 2026), seeded with a 34.5 MB placeholder pool, a kept board of
2,500 rows, the Team Rankings page last open, and Firebase's own code never
arriving, as on a slow network: the first draw came at 1,302 ms and the kept
board's rows at 1,858 ms before, and at 460 ms and 1,000 ms after; a device still
to meet League's documents went from 5,216 ms and 5,785 ms (the four-second wait)
to 463 ms and 1,001 ms. With no pool at all the rows came at 1,084 ms before and
982 ms after, so the pool no longer costs the first draw anything. What the
network's side gains, a sign-in already under way and the meta read beside the
kept board, needs Firebase to measure, and was not. The order, the shared
session, the early ready, one decode, the meta read beside the kept board, the
draw before the keep, and each thing held back are tested (`bootOrder.test.ts`,
`poolFill.test.ts`, `cloudSession.test.ts`, `useLiveBoardOpen.test.tsx`,
`LiveTeamRankings.test.tsx`, `CloudPoolGate.test.tsx`, `useScoutBridge.test.tsx`,
`AppLeagueAsked.test.tsx`); each guard was broken in turn and seen to fail a test,
29 of 29, one only after its test was tightened: the shared session's watched the
status, which the early ready now sets by itself, and missed the race until it
asked whether the boot's sign-in was the session's.

The board is the page (1.6e). Until 1.5 it was a stand-in, as the saved board is,
and went to Team Rankings on this device's copy once a second had passed with no
tap, key or scroll; through 1.5 it stayed while it could, and went for anything it
could not draw, with the pool brought in step behind it the whole time. A member's
device is to hold no pool now, so the board brings none in, and what it cannot draw
it says, and stays:

- a meta the network does not give: nothing published yet, one an older build
  published (until the next refresh), a newer build's (reload to update), or one
  that will not read. A board drawn from the meta this device kept stays drawn,
  with the reason above it;
- no pages at all in the cloud, once the pages laid out are the meta's: they come
  with the first pull, or a League Standings season put on a page in Setup;
- a page's board not published yet, which the watch draws once it is, or one
  damaged or gone, read again with the next publish;
- offline, a board this device never kept;
- a page's Games list, a club's card, Scouting's report or the copy's archive that
  could not be read: said where it was asked, with **Try again**, and read again by
  itself once the cloud publishes, so another page or area is read for itself
  rather than said to have failed with it;
- a club Scouting is on that the cloud has no card for in the year on screen,
  which is no read gone wrong: one picked is let go, and the page's own club with
  none says so in place of its games, the picker kept;
- Find a team's list not read: said under its button, and searching again reads it
  again.

There is no wait any more: a network that does not answer leaves the board reading,
and the reader's own limits (10 s for the meta, 30 s a piece) end in offline. A
board built before changes it does not have, the copy's or this device's own,
stays up under its label rather than handing over. It hands over to Team Rankings
on this device's copy only where that is the right page or the only one: an
account the rules refuse (its meta, its watch, or any view it reads, the board of
a half or page moved to after the meta was read among them), or, on the areas that
read the published views (the board, Scouting and Games), a browser with no member
signed in to read them as and no board kept to show, both of which the visitor's
own app is for. A pasted list is pulled in the cloud from the Import tab, with
no hand-over (1.8, "A pasted list, pulled in the cloud"). Only then is
the pool brought in step, behind it, and Team Rankings' own code loads under the
board once it is drawn, so it is there by then; the code of the section it hands
over on comes as it hands over, since the page fetches a section's code only as
the section is first drawn (`sections.ts`). The pages are the meta's whenever
it carries them (`LivePages.groups`), kept or read, rather than this device's own,
which a member's device no longer keeps in step; this device's own lay the page
out only until a meta comes, or under one from a build that published none. On a
member's device those are read once its store is in, which then comes at once
rather than after the board, and until then the page does not say the cloud has
no pages.

A board is built before changes it does not have only when it was built from a
version of the copy no later than the one this device read, or from another copy.
One built from a later version of the same copy is the copy's: an edit sent from
this page is in the copy and on the next board, and not yet in what this device
read, so the board it rebuilt was once read as behind and the page handed over a
minute after its own edit, to a copy without it.

Since 1.8 a member never asks for a hand-over, and the two left draw nothing kept
(a refusal forgets every board first), so what follows no longer comes about; 1.7
takes it out. Handed over while the pool is still coming in, the board stays on screen and
works as before, with the pool's progress above it and a button to stop waiting;
an area it cannot draw, or a club with no card, says it opens on this device's
copy as soon as that is in. Team Rankings opens once the pool is in where the
board then is, so nothing done meanwhile is lost: the club open, the search, the
clubs Scouting is on (the one reported on, the one set beside it, and opponents
asked for), and the state boards. Then the board goes, its route, listener and
effects with it, and Team Rankings alone has the page; a board left mounted under
Team Rankings used to rewrite the address when Back landed on a page it did not
know. Team Rankings opens on the same rows, starred by the worker's own rule,
roster star and all (`liveBoard.ts`), marked as refitting until its own fit lands;
once it has taken over it stays. Only a page opened by a handover reads those
rows, and they are let go when the page closes, so a page opened the old way later
(the switch turned off, or signed out) stands in its own saved board. Nothing can
be changed on the board itself but which club is the page's own: Mark mine, and
taking the mark off, go to the edit function (`page.myTeam`) with the club as its
card has it, so one League Standings made joins the roster under the mark, as the
page adopts it. The page's own club is the cloud's (the meta's pages, not this
device's copy, which an edit sent from here does not move), with a mark made here
drawn over it until a publish carries it (`myTeamShown`). Its card's next game is
read off its published card, on the pages the board is fitted over, as the page's
own card reads it off the pool (`buildUpcomingSchedule`); "loading" while the card
comes, and nothing said of a next game when it will not read, rather than that
there is none. Removing a club and the schedule still wait for the page. Edits
are off once the page has handed over, while this device's copy comes in, since
it opens without an edit sent meanwhile and then writes the copy itself; and with
no reader of the cloud the lock says the device is not connected, not that it is
offline. Otherwise they are off only while the device is offline, before the
cloud has answered, over boards a newer version of the app published, which the
device should reload to read before it changes them, and where the cloud's
answer left no copy to make them on (`editLock`). The cloud has answered when
the server has (`useLiveBoard`'s `heard`): the first read of the meta came back,
from Firestore Lite, which reads only from the server, or the watch said a
snapshot came from the server and not the device's cache, whatever the meta
said. A meta this build cannot draw (an older schema's, none at all, or one
whose pages will not read) leaves edits and imports on, since they go through
the edit function and need no board: they are made on the copy the meta's header
names, or, where nothing published names one, the copy the cloud's own manifest
names, read beside the watch and dropped if the server says more first; with
nothing published, the cloud has answered once that read has ended. Where it
names none either (it could not be read, or there is no copy), edits stay off
and say so, and a reload looks again: with the lock lifted, every edit and
question was turned away one toast at a time. Once the server has answered, a
meta this device kept from an earlier visit names no copy for them; its word
replaces the kept one. Until 3.0 they waited on a meta that could be drawn, and
on 10 October 2026 an older one locked them for the day. One edit still waits on
a meta it can draw: putting a league season on a page in Setup. Without such a meta
the pages to hand are this device's own, which it no longer keeps in step, so the
league seasons and age groups cards give way to a line saying the cloud's age
groups cannot be read yet. A meta kept from an earlier visit does not count once the
cloud's own answer says the boards are missing, another version's or unreadable. An edit and a question
stay the same functions while the lock comes and goes, and read it as they are
made, so a card that asks in an effect does not ask again for a blip of the
connection (a what-if refitted the year each time). The
board is held for the handover as it is put on screen, in a layout effect: held in
a passive one, a test that found the board and closed the page at once failed 2
runs in 15, and none in 15 after. Each guard of these was broken in turn and seen to
fail a test, 26 of 26, one of them only once its test had sent the warm-up first.

The page reads one meta and the pieces of the one board on screen, and none at
all for a board this device kept. Its code is 5.3 KB gzipped, loaded only with
the switch on (23.5 KB gzipped beyond the first download with everything it loads
at once, after 1.5's review: the questions' answers had come in with the server's
answerer, Pool health's lists, the model check and the import, 69.8 KB, so the
answers' reader is a module of its own (`queryAnswers.ts`) and the edit function's
client loads at the first call, which the board alone never makes); the first download grew 2.8 KB gzipped (229.1 to 231.9 KB), as the
cloud session's code moved into a chunk of its own beside the entry, and
Firebase stays out of it. `LiveTeamRankings.test.tsx` draws boards published to
an in-memory store through the real reader, cache and checks: the rows, places,
star, state boards and badges as the page draws them, last week's arrows and the
club's own rank line (and no line made for another club), the half from the published
counts, what it says in place of each thing it cannot draw and each read asked
for again, the board staying the page however long nobody touches it or the
network takes, no pool brought in for it, a half moved to read however long its
board takes, the board kept on screen and in focus through a handover while the
pool comes in, and what is done there carried into Team Rankings, a kept board
drawn and labelled offline, and a refusal forgetting every board. `RankingsOpen.test.tsx` holds who gets the board and that
the choice holds for the open; `TeamRankingsView.handover.test.tsx` the page
opening where the board left off. Each guard was broken in turn and seen to fail
a test, 33 of 33, two of them only after their tests were tightened.

**A club's panel.** A club tapped on the board opens its panel from its card
(`LiveClubPanel`): its bucket read through the same checks as a board, and drawn by
Team Rankings' own panel. The panel and the pool's codec it checks a card by load
only when a club is opened. It opens in a sheet over the board (`ClubSheet`), on this
device's copy too, where it was drawn at the foot of the page and scrolled to, and the
place on the board was lost: Close, Esc, the shade beside it or Back closes it and
puts focus back on what opened it. Back closes it because opening it adds a history
entry, the page's own address marked `clubSheet`, in the click rather than an effect,
which React's strict mode runs twice; closed by its own controls the entry is taken
back with `history.back()`, whose popstate is let pass (`clubSheetHistory.ts`). Tab
stays in the sheet, the page behind does not scroll, and an Esc a name box used to
close its list is left to the box. This device's copy fetches the panel as a club is
first opened too, which took 4.5 KB off opening Team Rankings.

**Watching a few clubs.** A club's panel has **Watch**, and the clubs watched on a page, up to
five (the owner's choice of 26 October 2026), are a card at the top of that page's board: each
one's place, record and rating on the board on screen, a tap from its panel, and **Stop**. A
sixth's Watch is off until one is let go. Kept on this device alone (`watchList.ts`, by page,
each club with its name as it was watched, so one with no row on the board on screen, the other
half of the season, is still named and says so), on the live board and this device's copy alike.
Nothing about it reaches the cloud copy. A club whose card cannot be read (no card, a bucket
damaged or gone, or offline with none kept) says so in the panel's place, with Try
again and Close (1.6e), kept with the meta it was read by, as a list not read is, so
the panel is drawn again, reading the card, once the cloud publishes; a refusal
hands the page over, as every refusal does. The
club open when the board hands over opens on Team Rankings, and one tapped while
the pool comes in says so until Team Rankings opens on it.

Its edits go to the edit function (`useLiveEdits`, 1.5): a state, a name, a
GameChanger link taken off, an age set or taken back, a fold into another club on
the board, and a game the club has only by a name another schedule wrote taken off
it (Not this team, `game.notThisTeam`, by the stored id its card keeps for such a
game and a stand-in id the device mints, which no roster holds), each sent as a
command against the copy the board is of, and each answer said in a toast: the edit
made (an age, or a game taken off, with an Undo that sends its
inverse), or why not, in plain words, a refusal as the server named it and a call
that came to nothing in the call's own words, which say an edit may or may not have
been made wherever the server did not prove it was not. A rename onto a name
another club holds, and a fold, are asked about first, with what the server says
they move (`rename.preview`, `merge.preview`). An edit made is drawn over the card
until a publish of its version or later is out (`overlayCard`): the state, name,
links and level it gave the club (and an age's Undo, whose ages named for the
club's GameChanger teams put back the pin it had, or none), a game taken off it as not
its own no longer drawn, with every other game the card has by a name against the same
club (`takenWithOnCard`), as the server takes them, their record moving with them, until
the Undo puts them back on the club, and a club folded away opens the one it went
into. An edit that changed nothing the views read (a Pool health answer) asks for
no rebuild and is not waited on. Going into one of a panel's fields, its name, state,
age or a club to fold into, brings the server's pool up (`warm`), at most once in
ten minutes of calls. Opening the panel did, until 25 October 2026: every club a
member opened to read woke the 8 GiB edit function to load the whole pool for an
edit that mostly never came. While the device is offline, or
before the network has answered for the board (what is drawn being only what this
device kept), the panel changes nothing and nothing is sent.

**What each game did.** Under each game a club's panel counted, it says what the game
did to the club's rating on the board on screen (Ratings, **Game by game**), worked out
on the device from the card it read and that board, which carries what its rows' games
were fitted against (`BoardFit`, Views a server publishes): no read, no write and no
wait beyond those two. The panel is handed the board only while it is the board of the
page and half on screen (`LiveTeamRankings`, by its key), with the age groups the boards
were built from rather than this device's, and the lines are worked out as of the
board's own day (`BoardFit.day`), never the device's clock, which can be past a game
scored ahead. They come from the card as published, not as this device's pending edits
draw it (`overlayCard`): the board is from before those edits too, so the lines explain
it as it stands, and a game an edit takes off loses its row and its line with it.

Every line is checked against the board before any is drawn, and where a check fails
the panel draws none and says nothing of it, looking as it did before lines were drawn
at all: the fit is of this build's version (`BOARD_FIT_VERSION`); the card's counted
games are as many as the row says the club played; their counted margins average to the
row's `rawMargin` within 1e-9; the fit's rating and the shown one, rebuilt from the lines,
the row's starting level (`levelPrior`) and the fit, are each within 1e-3 of the row's; no side was met more often than the
board says it played; and every game's score part is well defined. A card and board from
different publishes, a game the device counted that the fit did not or one it missed, or
a constant the device has wrong each fail one. On the 29 September 2026 backup, every
board and card read back as a device reads them, all 88,106 clubs with a row on the 20
boards that carry a fit got their lines, 532,020 in all, no check failed, and the
ratings rebuilt from the lines came within 3.6e-5 of the rows'. A club's lines took
0.14 ms in the middle and 0.35 ms at the 95th percentile (Node 22); the first club opened
on a board also indexes the sides the board names, 12.8 ms on the largest. The maths and
the words load with the panel (`LiveClubPanel`), never with the board.

Each clause is a box of its own on the line (`TeamDetailPanel`), which moves to the next
line whole where it does not fit and wraps inside only where it is wider than the line,
with the dot after it in its box behind a non-breaking space, so no line opens on a dot
or holds one alone. At 320 px the panel's content is 246 px wide; with each clause kept
on one line instead, the longest ran 423 px past it (Chromium, against the built
stylesheet), where boxed nothing passes the edge. The text is the panel's meta text,
12 px and slate-600 (`textSize.test.ts`, `tokens.test.ts`).

`gameBreakdown.test.ts` holds the maths to the fit: on a pool drawn by hand, every club
with a row on every board gets exactly the games the fit read, each played like the
fit's; the score part against exact refits without the game, on a star schedule to 1e-9
and on the seeded fixture to 0.0048 in the middle, 0.038 at the 95th percentile and 0.056
at most (held under 0.045 and 0.07, which the one-game shortcut breaks); the record part
to the fit's own discount within 1e-12; twelve kinds of board, card or row that do not
belong together each drawing nothing; and three clubs' lines pinned to the millionth.
`breakdownParity.test.ts` reads boards and cards from the real builders through the
store, JSON and their checks, with the device's clock months past the board's day: all
1,516 clubs with a row on the 28 boards of the fixture that carry a fit get lines, 8,119
in all, each a counted row of the club's panel, and groups other than the board's leave
176 or 197 clubs without lines and every other exactly right. `gameWords.test.ts` holds
every wording, `TeamDetailPanel.gameNotes.test.tsx` the panel without lines exactly as it
was before them (its markup pinned first) and lines on counted rows alone, and the live
page's tests build a small pool, publish its boards and cards as a server does and read
them as a device does: the lines of the half on screen and of the half moved to, "your"
for the page's own club, none from a board without a fit or with the club's row moved by
0.01, the panel otherwise the same to the byte, a pending Not this team taking that
game's line off alone, pending edits that leave no row with a line taking the line above
the list off with them, and on a page with no squad year the whole year's board, its
lines drawn and its rating named the season's. Each guard was broken in turn and seen to
fail a test, 20 in the maths (two only after a test was added for each) and 19 on the
panel, and so was each the review of these lines added. Two cannot be made to fail and
are kept as a statement of what the panel relies on: the board's key check, since the
page never hands over a board but the one of the key on screen (`useLiveBoard`), though
the key it is checked against is held (a page with no year asks for its "year" board,
which a test draws); and the cloud's age groups over the page's, which are the meta's
whenever the meta carries them.

**Setup.** On the board, Setup draws the teams waiting on an age and Pool health from the
server's pool. The teams waiting on an age (`LiveAgelessCard`) are drawn by the device's own
card's drawing (`AgelessReviewView`) from the ten in front of the person and the rules' rows
(`ageless.queue`), the entries alone, which the device makes rows of as its own card does; the
ten are held there by being sent back with each question, as the device's card pins them. Its
search asks once the typing stops (`ageless.search`, 300 ms), and its file is the server's
(`ageless.file`). Naming an age sends `namedAges`; throwing a team out sends it to the refused
clubs and off the list as one edit (`ageless.forget`, with an Undo); a pass over the rules ticked
is planned on the server (`ageless.clearPlan`), asked about with its counts, and sent the same
way. After each, and after an Undo, the list is asked for again. Pool health
(`LivePoolHealthCard`, 1.5) is drawn with the device's own card's drawing (`PoolHealthView`): what
it shows as it opens, asked on the device's day as Setup opens (`health.summary`), and what
it finds once **Check the pool** is pressed (`health.inspect`). Each button is sent as the
edit the device's card makes: rows thrown out (`games.drop`), a club deleted
(`club.drop`), a rout counted (`game.confirm`), a fold (`teams.merge`, at once, with an Undo,
as **Delete club** is), an age (`club.age`, with an Undo), every suggested
age at once (planned on the server's pool, `ages.plan`, and sent as one batch with one
Undo), the answers (a club real, a club at the right age, two clubs kept apart), and the
clubs removed for you: **Put back on the boards** (its marks forgotten and the club said to
be real, `autoRemoved` and `answers` as one batch, with an Undo), a night's clubs put back
at once (`autoRemoved`, with an Undo) and **Delete for good** (`club.drop`, with an Undo).
Both questions read League Standings, as the boards do, so a club a League Standings team
links is said to be kept rather than removed. Once
an edit is made, what the pool shows is asked for again, so the lists are the copy's as it
now stands; an answer kept is shown at once, and the question already on its way is let
go, since it was asked before the answer was given.

The buttons press into a line rather than taking turns with the person. A press used to grey out
every other button in its list until the cloud answered, a few seconds each, and a fold asked
first, with a call of its own for the counts it gave, so a page of pairs to fold or clubs to
delete was worked through one wait and one question at a time: the owner's biggest complaint, 21
October 2026. Now every other button stays live; a button pressed reads **Queued** until its turn
and then what it is doing, the edits go one at a time in the order pressed, and pressing one
already in line does nothing more. A club or game an edit has dealt with leaves its list at once,
before the summary is asked for again, so its button cannot be pressed a second time for a row
already gone. A fold here asks nothing first, since it is a fold the pool offered and has an Undo;
a fold a club's own panel is told to make still asks, with what it moves (`merge.preview`).

The file of every club worth pulling
is the server's, asked for when **Download the list** is pressed (`health.toPull`). The
settle is the nightly refresh's, which tidies the pool after every pull, and the pool's
research files (its names, its stand-in fixtures) are made only where the whole pool is
held. The league seasons are put on a page, or taken off, by the device's own card
(`LeagueSeasonsCard`), each answer sent as the device's edit (`season.assign`, said in the
device's words). The pages it and the age groups card read are the cloud's, as its last publish
carries them, rather than this device's copy, which an edit made here does not move; the edits
not yet published are drawn over them (`overlayGroups`, by the command the server runs), so a
season put on a page shows there at once and the next one put at that age joins it. This
browser's diagnostics are its own, as on the device's Setup. The model check of the page open is
the server's (`model.check`, 1.5), described below, and archiving or deleting a year, and
starting Team Rankings again, are the owner's on the server (1.6, below). A backup of Team
Rankings is the cloud copy's, read off it when **Download a backup** is pressed (1.6e, under
"Backups").
Every card here asks in its own effect once edits are on; the copy they ask of is held before
any effect runs (`useLiveEdits`), since the network's first answer brings it and turns edits on
in one render, and a Setup opened straight from a link had its first questions refused for want
of it. `LiveAgelessCard.test.tsx`
holds the waiting card's answers and questions as `LivePoolHealthCard.test.tsx` holds Pool
health's. `LivePoolHealthCard.test.tsx` holds each button's edit and what the card shows after
it, against a stand-in for the edit function that keeps the answers it is given. Each guard of
the questions, their shapes, the summary, the card's drawing and its two wrappers was broken in
turn and seen to fail a test, 54 of 54, two of them only once tests were written for them; and
the league seasons' and the copy's, 15 of 15, the intro card's only once a test looked for it.
A club Pool health names opens in the squad year its row is of (a club filed at the wrong
age in its year, a club counted twice in the year of the day it played), since a club's
card is read by year and one of another year was looked for on the board's, found
missing, and handed over. A search on the waiting card draws its answer only under the
words it was asked for, and an age named and not kept leaves the box choosing again.
The model check's line under an unanswered check no longer says to run it again, which
a page no longer on the copy, or a day's compute spent, would not change. Each guard of
these, with the Import tab's above, was broken in turn and seen to fail a test, 13 of
13, the cadence's lock only once its test looked at the fieldset around it.

**Find a team.** The board's search box reads its year's list (`useLiveSearch`)
only when somebody taps it, says "Bringing in every team…" until the list is in,
then puts the caret in the box. A pick opens the club's page and its panel from its
card, as Team Rankings does. A pick on another year's page leaves that page's box to
be asked again, rather than read a second list unasked. A list that cannot be read
says so under the button, and searching again reads it again (1.6e); handed over with
a search asked and not in hand, Team Rankings opens with its box focused.

**The Games tab.** On the board the tab reads its page's list (`LiveGames`) and is
drawn by Team Rankings' own tab (`GamesSection`), its form and import sending their
games to the server (1.6, below). The tab and its code load only when it is opened.
A list that cannot be read says so, with Try again, and is read again by itself
with the next publish (1.6e).

Each game's own buttons are there (1.5): a score typed, Don't count and Count it, and
Remove (asked first, with an Undo), each sent to the edit function as the edit the
device's tab makes (`game.score`, `game.exclude`, `game.remove`) and drawn over the
list until a publish carries it (`gamesOverlay.ts`, by the command the server runs,
on the list and the cloud's pages alone, and only for the edits that read nothing
else). The list carries no game ids, a game's id being its place: the ids are
random and about 52 characters each, and on the 29 Sep copy they would have made the
11 pages' lists 11.2 MB gzipped instead of 3.1 MB, and 12U's 1,965 KB instead of 534
KB, for the rare game somebody edits. So before an edit the device asks the server
for the game's id (`games.find`), by its place and what the list shows of it, and
the server answers from its pool as it is now (`findListed`): the game at that place
while it still shows so, or else the one game on the page that does, the list having
moved since it was published, or none, which the person is told, and nothing is
sent. The id is kept with where the list showed the game and how, by page, for
the page load, and found again in each list by what it shows (`findListed`), so a
second edit to the same game asks nothing, and the edits drawn over the list still
find their game in a list published since (of other changes, before the one that
carries the edit) or on the tab opened again: kept with the list it was asked of,
it went with that list, and the edit stopped being drawn until its publish was out.
A score being typed is kept to the list its box was opened on: a game not yet
named is its place in the list, and a list published meanwhile, or another page's,
has another game at that place, which the box moved to and the typed score was
saved to. A new list closes the box instead. Each guard of these, with the age's
Undo over a club's card and the what-if's key below, was broken in turn and seen to
fail a test, 8 of 8. On the 29
Sep copy the question took 37 ms for the last game of 12U's 45,107 at its place,
and 55 ms found by the scan. Each guard of the overlay, the question, the device's lookup and
the typed scores was broken in turn and seen to fail a test, 26 of 26, the score
boxes put away only once a test saved a score the copy already held.

**Adding games by name** (1.6). A game typed into the form and a schedule pasted into the
import are added on the live page too, through the server. The device holds no roster, and
the year's is 116,485 clubs, so the names go as they were typed (`NamedGame`,
`namedGames.ts`), each game with the id the page mints for it, and the server resolves them
against the year's clubs as the page knows them, League Standings' among them
(`deriveAllKnown`), with the very functions the device's tab uses (`gamesOfNamed`,
`resolveOrCreateTeam`), and adds them as one change (`game.import`, made into a `game.add`
by `addOfNamed`, a club the roster lacks adopted with it and a held club whose state the file
fills put back first). The device's own tab now resolves a pasted schedule through the same
`addOfNamed`, so a schedule added either way adds the same clubs and games. What the
device's import checks against its roster, the server checks for the live page
(`games.check`, `checkNamedGames`): a name that is a placeholder or a near miss of a club
there, and a game the page already has, League Standings' included. The form's one game
is asked about before it is added, and a game already logged is confirmed first, as on the
device; the import's rows are asked about as they are reviewed, a moment after each stops
changing, by what the check reads of the row, so a box ticked asks nothing and an edited
name asks about that row alone. Nothing is added while a row is unanswered, and a
question that fails says so with a Check again. The schedule comes with an Undo, which
takes its games back out and the clubs it brought. The names are resolved against the year's
clubs, League Standings' among them, not the roster alone, so a club League Standings made is
adopted under the id the page knows it by: minted afresh, a name would take the first id of its
stem, which may be another League club's, and the board's ids would all shift. Each guard was
broken in turn, 27, and 26 failed a test; the other, the page's games kept to the page, cannot
change an answer, since a game is only ever taken for one on its own page (`findDuplicateGame`).

**What the reviews of adding by name found.** A press of Add while a game was on its way added
it twice, since nothing waited on the server's answer: Add is off now until it comes, for the
form and the import alike, and the form keeps a game typed in the meantime rather than clearing
it with the one sent. The server checks again as it adds (`importOfNamed`): a game the page has
by then (another member added the same schedule, or an earlier press landed though the device
was never told so) adds none of the schedule (`logged`), and the import's rows are asked about
again, so the ones the page has now drop out. A game the form was told the page had, and was
told to add anyway, carries `again`. A club against itself is refused by the key a name is
found by ("NV Stars 9U" is "NV Stars"), on the form and on the server. The checks were most
of a second a name: a near miss was looked for by working out every club's key and a full edit
distance against each of 116,485 (397 ms a name on the 29 September 2026 roster), so a pasted
season of a few dozen rows ran past the edit function's minute, ended its worker and the warm
pool every member's edits use, and could be asked again only to end it again. The roster is
indexed now (`findSimilarTeam`), each key once, by length and in order, and a distance worked
out only within reach of 0.82: 6.7 ms a name on the same roster, the same club named for each
of 80 names compared, and the rows are asked about a hundred to a question. Names are resolved
through an index too (`teamResolver`), where each new club rebuilt the roster's ids and each
state a pass over it: 500 rows of new names in 134 ms, where 50 took 2.4 s, the clubs and games
the same as the walk's on generated rosters and on that one. A schedule of more rows than one
edit takes (500) is turned away as it is read, to be pasted in parts, and one that would tidy
more clubs than an edit may change (`MAX_COMMAND_STEPS`), each a step that writes the roster,
adds nothing (`too-many`): 500 rows naming held clubs without a state, each row with one, came
to 945 steps. Each guard was broken in turn, 39, and 37 failed a test; the other two cannot
change an answer: a band one cell narrower loses only a distance at the cap, which is a step past
0.82 by construction, and keeping the page's games to the page is what `findDuplicateGame`
already does.

**Scouting.** The tab works out its report, its upcoming games and its comparison
as Team Rankings does, off the board's rows and the club cards rather than the
year's pool (`LiveScouting`, `scoutingFromCards.ts`). The report reads only the
rows. Each of the rest reads only the games of the club or two clubs it is about,
and a card holds a club's games of the year in the pool's own order. So the
upcoming games are the scouted club's card's games on the page's rating pool, and a
comparison reads both clubs' cards, each game once. A game of the two is taken
from the first club's card, where it sits between the second club's own games as
the pool has it. Two results of one day used to be put in game id order, which a
card cannot give, since its ids are only its places. They now keep the pool's
order, as a club's panel always has, on Team Rankings too. A what-if refits the
year, which the board cannot, so it is asked of the server (`scouting.whatIf`,
1.5), which refits it as the boards are built: the year it derives with the copy's
own League Standings seasons in it (`deriveAllKnown`), so the answer agrees with the
board on screen, and the page's rating pool fitted three times (`whatIfCurve`). A
card carries no game ids, so the fixture is sent as the scouted club's card holds
it, its id its place on the card, and the server finds it among the club's games of
the year as a card lists them (`cardGamesOf`, `cardFixture`): the game at that place
while it still reads so on a card, or else the one game that does, or none, which
the panel says could not be worked out. The question and its answer are keyed to
the fixture as the card holds it, not to the card: a card is decoded afresh with
each publish, so the same game came back as another object and was refitted for
again, and a card published since may hold another game at the place asked about,
whose answer was then drawn under it. The League Standings part is read only for
a question that refits a year, and once for each version of it (`runQuery`), since
an edit's pool leaves it out; one that would not read refuses that question alone.
On the 29 Sep copy a what-if on 12U, the year's 255,579 games one rating pool, took
7.1 s (6.9 s asked again, the League part read already), its answer 1 KB and the
process at 1.9 GB at most, during which the edit function's other calls wait, as an edit waits on
another; the device's own worker takes as long. A card that could not be read
(offline, damaged, gone) is said in the report's place, with Try again, and read
again once the cloud publishes (1.6e). A club the cloud has no card for in the year
on screen (its bucket read and holding none, or no bucket for it in the meta the
page settled on) is no read gone wrong, and reading it again finds the same: said
so, it replaced the tab and its picker, so a club picked on 2027 left 2026's
Scouting with nothing to do but try again. A club picked, there or on another
year or page, or folded or deleted since, is let go, so the report is on the page's
own club again and nothing is compared; the page's own club with no card says so
in place of its games, its report off the rows and the picker kept for another
(`useClubCard`'s `absent`). A what-if is
offered only where Team Rankings would offer it, as far as the board can tell
(`boardWhatIfDeclines`): a game refused on sight is refused alike, and one
against a club the board does not rank is declined. Every club it ranks has a
counted game, so it never offers a what-if the page would not; but the page rates
opponents across its whole pool, and over the whole year when the address names
no half, so the board declines a few the page would ask. The clubs Scouting is on
are the board's to keep, so a half or page read again keeps them, and Team
Rankings opens on them (`compareTeamId`, `pickedOpponentIds`).

`scoutingParity.test.ts` holds the report, every scouted club's upcoming games and
comparisons with the clubs beside it and the clubs it met to Team Rankings' own, on
every page and half of the seeded fixture, and each what-if offered to one the page
offers, with the address naming the half or none. A second page with no year was added,
since a card holds a club's games of every such page and each is a pool of its own.
`scoutingFromCards.test.ts` takes the case consistent cards never give. Each guard
was broken in turn and seen to fail a test, 14 of 14, three only after a test was
added: the pool's pages, a meeting off the second card, and a bucket without the
club.

`refitParity.test.ts` holds the server's what-if to the page's own (`whatIfCurve` on
the page's pool, with the real game), each fixture named as the published card holds
it, for the top clubs of every page and half of the seeded fixture and for the clubs
of a League Standings season with a game still to play, added since the fixture's
own are all played. `editRun.test.ts` holds the League part read for such a question
alone, once for each version of it, and refused alone when it would not read.

**The model check.** Setup's card asks the server for the check of the page open
(`model.check`, 1.5), which works it out as the page does (`checkTheModel`) on the year
derived with the copy's League Standings seasons, as a what-if is. Every run goes in one
question rather than one a run, as the device's worker takes them: the runs are compared
game by game, so each run's errors are kept until all are in, and on 12U of the 29 Sep
copy those came to 2.3 MB a run, against 16 KB for the answer the card draws. There the
check took 15.1 s, 38,631 games held back, the process at 2.2 GB at most, during which the
edit function's other calls wait, as they do on a what-if. Since the starting level's
re-measure joined its runs ("Where a rating starts") it fits the year four times more,
which took 20 s and about 1 GB more in Node on the owner's 11 October backup; it has not
been timed on the server. JSON has no
`Infinity`, which the uncapped run's cap, each result's last bucket and a better cap that
is no cap all are, so it sends them as null and the device's reader makes each its own
again. A check that comes back with no answer says why in a toast, as every question
does, and the card says so under its button, rather than that the pool changed, which is
the device's own card's reason. `refitParity.test.ts` holds the answer, read back as a
device reads it, to the page's own on the seeded fixture's 12U 2027, League Standings'
games in it; `queries.test.ts` the question and the reader. Each guard was broken in turn
and seen to fail a test, 14 of 14.

**Archive.** The live page's Archive tab is Team Rankings' own (`ArchiveSection`), its
finished seasons read straight from the cloud's copy, which a member may read
(`copyArchive.ts`, `copyReader`), rather than from views the server publishes. An archived
season is frozen once made, and is already a part of the copy, the index one part and
each season's rows another, so the tab reads the manifest and the index, and a season's
rows only when it is opened, as the device's tab reads its own store. Publishing them
would have the server fetch parts its pool leaves out, to write the same bytes again. Each
part is read once a page load, by its id and hash; a season whose part was replaced and
swept after the list was read is read again off the manifest as it now is. A copy that
cannot be read is said so, with Try again, as a list that cannot be read is (1.6e).
`copyArchive.test.ts` holds the reads on a copy in memory; `LiveTeamRankings.test.tsx`
the tab listing, opening, and saying it could not read the copy. Each guard was broken in turn and seen to fail
a test, 12 of 12, the cache's key only once a test read a season again after its part was
replaced.

**Import.** The live page's Import tab shows the copy's nightly refresh as the server works
it out (`import.status`, at the device's time): what a refresh now would be for and how
many teams are in it, as the nightly reckons it (`storedRota`, moved out of the pull so
the question does not carry the pull's code), with the device's own words for it
(`describeDueSummary`, which `describeDue` now reads through), and when each level was last
refreshed, each day's levels together, the latest first. How much comes round at once is
chosen there and kept on the copy (`refresh.cadence`), which the nightly reads; an
Organizations file is read on the device and its organizations kept on the copy
(`orgs.merge`), which the nightly ages teams by, and a file with nothing new says so
(`EditSaid.same`, said where the copy already held the edit). A pasted list is pulled in the
cloud from the same tab, with no hand-over (`LiveCloudPulls`, "A pasted list, pulled in the
cloud"), so no card hands the page over any more; the tests hand it over with a refusal by the
rules (`pullOnDevice`).
`queries.test.ts` holds the question and its answer; `LiveTeamRankings.test.tsx` the tab
drawing it, each edit, and the refresh read again after one. Each guard was broken in turn
and seen to fail a test, 14 of 14, four only after the tests gave the tab a clock of its
own, put the days in order, and named a waiting team under no organization.

The cadence chosen is shown from the choice until a refresh read after its edit says
what the copy keeps: cleared once the edit was made, it flipped back to the old one until
the refresh was read again, and stayed so when that read failed; one not made is put
back. A file whose organizations have teams but no names is told it needs the names,
which a team's age is read from, rather than that it names no teams; and with edits off
and nothing read yet the tab says why, as the waiting card above Pool health now does,
rather than that it is still reading.

The nightly card now carries **Refresh now** ("Refresh now in the cloud"), and the
status it reads carries the button's count (`refreshNow`, optional in the answer's
shape, so a server from before it is still read, and offers no button).
`LiveRefreshNow.test.tsx` holds the card: what it will pull said before the press,
again or not; off with the lock's reason, with nobody signed in, while a refresh or a
list is on its way, and with nothing to pull; a press watched to its end, which reads
the status again; Stop; one already under way shown; a refusal said; and a refresh
still told of while the status cannot be read. `queries.test.ts`,
`editClient.test.ts` and `cloudPulls.test.ts` hold the count, the call and the watching.
Each guard was broken in turn and seen to fail a test, 17 of 17, the watching of one
handed back twice only once the break let it be listed twice. A review then broke
five of the card's guards with every test still passing: the two against a double
press, the signed-out reason (the pull card says the same words), the note that one
was already running, and the end read once. Each has a test of its own now, and with
the review's fixes (the button off until the answer's read, the notes that went stale,
the held-back count said twice, the reasons and lines a screen reader could miss) 14
guards were broken in turn and seen to fail a test, 14 of 14.

**On a device with no copy.** The page is laid out by the age groups, which a
device reads from its own copy. One that has never held a copy has none, so the
meta now carries the copy's age groups too (`LivePages.groups`), as its store holds
them. A device with no age groups of its own lays the page out by those, read
through the copy's own check (`coerceAgeGroups`), and since 1.6e every device does,
whenever the meta carries them. It says the cloud has no pages only once a meta,
kept or read, has laid the page out. Each guard was broken in turn and seen to fail a
test, 8 of 8.

The board on screen is held for Team Rankings to open on (`holdLiveBoard`), by an
effect that runs after the board is drawn, and let go whenever none is on screen. It
used only to be let go where a refusal forgets every board, and a refusal heard
between a board's drawing and the effect was forgotten and then held again by the
late effect. The listener's test caught it about one run in four.

**Kept up to date while it is open.** Once its first read is in and its board
drawn (or three seconds have passed), the page listens to the meta (`watchMeta`),
so a publish while it is open is drawn in place; the listener hears the meta as it
stands when it starts, so nothing published meanwhile is missed. It
listens until Team Rankings opens, and stops with the board. The copy's lite Firestore reads
but cannot listen, so the listener is the full SDK (`watchLiveMeta` in
`firebaseCloud.ts`), loaded then and never before. Its parts the app uses are a
module of their own (`firestoreListen.ts`), and so a chunk of their own: 121 KB
gzipped, which a browser that opens no live board never downloads. The service
worker does not store it ahead either, since a listener is no use offline; CI
checks both. Loading it took 71 ms on a 4× throttled CPU and 45 ms unthrottled
(medians of five), with no task long enough to delay a tap. What the listener
hears is taken as a read is:

- checked, kept for the account, and put on screen;
- the board read again only when the meta names another board for its key, so a
  publish of other pages' boards costs this page nothing;
- a meta heard again unchanged counts for nothing;
- of two metas heard together, the later stands, though checking the earlier
  against the copy takes longer.

When the connection drops, Firestore says so with a snapshot from its cache. The
board stays, labelled "Offline · the cloud's board as of 7:42 PM": the time the
server last vouched for it, or the day if not today. For a board opened offline,
that is when this account read the meta it kept. Once the server is heard again
the label goes. A board the network's meta names that cannot be fetched for want
of a connection leaves the older board drawn, labelled as of that board's own read
rather than the meta's, and is fetched again the next time the server is heard,
rather than at the next publish. A refusal heard ends the watch and forgets every
board, as a refused read does; a watch that ends for any other reason leaves the
board, offline. A listener whose own code cannot be fetched (the page opened
offline, its chunk never downloaded, which the service worker does not store) is
not tried again by the page, and a browser may keep the failed fetch for the visit:
the board can stay labelled offline, hearing no publish, until the app is loaded
again online. Firestore bills a listener a read for each change it hears,
and a read again when it reconnects after half an hour away.

What the board reads beside it (a club's card, a page's Games list, the year's
search list) is read through the meta on screen, and while that is only the one
this account kept, through what it kept. A view not kept then is not yet a view
that cannot be had: it is read again through the network's meta once that is in,
and only a miss after that, or once the network has given no meta at all, is said
(1.6e: before, it handed the page over). Each such read that the rules refuse
forgets every board kept and held and hands over, as a refused read of the meta or
a board does: a board refused after its meta was read, as one for a half moved to
once the account is off the list, is the meta's refusal too, where missed alone it
said nothing and read for ever with edits on. A view that failed and is read since,
as a publish reads it again, has not failed: the page's own club's card, on screen
throughout, says its club has no game ahead once a publish brings it, where before
it stayed unread for the visit.

With the listener in, the first download is 230.7 KB gzipped against 232.1 KB
before, as the build folded the cloud session's code back into the entry, and
Firebase stays out of it. The page's own chunk is 5.8 KB gzipped.
`LiveTeamRankings.test.tsx` listens through an in-memory store whose watch
delivers each version of the meta as Firestore does. It checks:

- a publish drawn in place;
- a publish that leaves the board alone;
- an unchanged meta taken as nothing new;
- the later of two metas winning;
- the offline label as of the read that kept the board, and gone on reconnecting;
- a board that could not be fetched offline, dated by its own read, and fetched
  again once the server is heard;
- a card and a Games list read once the network's meta is in, not said unread
  before it, and a list said unread once the network has given none;
- a refusal heard through a card's read, forgetting every board;
- a refusal heard, and a watch ended otherwise;
- a newer build's meta said over the board already drawn;
- the watch stopped on closing, and never started after a refused read.

`cloudSession.test.ts` holds the session's reader carrying the cloud's watch.
`firestoreRules.test.ts` runs the app's own watch on the emulator, on one app
beside the lite client that reads, as the app holds them: a member hears each
publish from the server, hears a snapshot not vouched for once its client is
cut off and vouched for again once it is back, and a stranger's watch ends
refused, having heard nothing from the server. Each guard was broken in turn and
seen to fail a test or the CI check, 22 of 22. Three of them failed only once
their tests were added or tightened, one after the in-memory watch was found
delivering the meta as it stood at delivery, not as it was when it changed.
