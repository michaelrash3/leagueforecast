# Rebuilds after saves, League Standings in the cloud, and edits as commands

_Part of the design documents; the map is in the repository's [README](../../README.md)._

## Rebuilds after saves: the one-time setup

The two functions run as an account of their own, `live-runner`. It may read and
write Firestore, receive the copy's events, queue a task, and send one to
`rebuild`, and nothing else. `rebuild` needs Cloud Tasks, which the deploy account
may not turn on itself. Until both are done and the `LIVE_REBUILD` variable says
so, the functions are built without these two (`functions/build.mjs`), as the pulls
are, and the Firebase workflow deploys the rest and says why. The hard stop's setup
("A hard stop on the bill") already made what a project's event-triggered functions
need, and gave the deploy account `roles/eventarc.admin`.

1. See where the database is. **Firestore → Databases** names its location, and so
   does this in Cloud Shell:

   ```sh
   gcloud firestore databases describe --database='(default)' --format='value(locationId)'
   ```

   The functions run in `us-central1`, and the deploy puts the trigger itself where
   the database is. A database in the United States (`nam5`, `us-central1`, and the
   like) needs nothing more; one elsewhere still works, with each write's event
   crossing to `us-central1`.

2. Open [Cloud Shell](https://console.cloud.google.com/?cloudshell=true) in the
   project and paste this, with your project's id in the first line:

   ```sh
   PROJECT=your-project-id
   gcloud config set project "$PROJECT"
   # Cloud Tasks carries each rebuild to the function that runs it. The pulls' setup
   # turns it on too; turning it on again changes nothing.
   gcloud services enable cloudtasks.googleapis.com
   # The rebuilds' own account: Firestore, the copy's events, queueing a rebuild and
   # sending it to rebuild.
   gcloud iam service-accounts create live-runner --display-name "Rebuilds after saves"
   RUNNER="live-runner@$PROJECT.iam.gserviceaccount.com"
   for ROLE in roles/datastore.user roles/cloudtasks.enqueuer roles/run.invoker \
     roles/eventarc.eventReceiver; do
     gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$RUNNER" \
       --role "$ROLE" --condition=None > /dev/null
   done
   # The trigger queues a rebuild as itself, so it may act as itself.
   gcloud iam service-accounts add-iam-policy-binding "$RUNNER" \
     --member "serviceAccount:$RUNNER" --role roles/iam.serviceAccountUser > /dev/null
   # The deploy account makes the queue.
   gcloud projects add-iam-policy-binding "$PROJECT" \
     --member "serviceAccount:github-deploy@$PROJECT.iam.gserviceaccount.com" \
     --role roles/cloudtasks.queueAdmin --condition=None > /dev/null
   ```

3. In **Firestore → Data**, start a collection `ops` at the top of the database,
   beside `copies`, with a document whose ID is `rebuild` and three fields: `on`
   (boolean) `true`, `mode` (string) `dry`, and `warm` (boolean) `true`. A field of
   any other type makes the document unreadable, which reads as off. A dry run
   builds every board and writes none; leave `mode` at `dry` until the first runs'
   lines look right (below), then set it to `live`. Setting `on` to `false` stops
   every rebuild at once, with no deploy.
4. In GitHub, **Settings → Secrets and variables → Actions → Variables → New
   repository variable**: name `LIVE_REBUILD`, value `on`.
5. **Actions → Firebase functions → Run workflow** on `main`. When it is green,
   the Firebase console's **Functions** page lists `onCopyWrite`, `onLeagueWrite`
   and `rebuild`.

Then save anything that moves a board, wait three minutes, and find the rebuild's
line in **Logs Explorer** (`jsonPayload.end` is in every one). A dry run that
built everything ends `published` with `wrote` false, and says how many boards it
built and pieces it would have uploaded; `locale` means the runtime's collation is
not English; every other end is named above. Each night's refresh log also says
the runs, failures and compute the ledger counted ("The nightly refresh on
GitHub"), so a dry week can be judged there. Once `mode` is `live`,
`npm run live:lag` reads how long saves took to reach the boards.

Setting `LIVE_REBUILD` to anything but `on` builds without the three functions. With
the pulls on, the next deploy then takes them down; without, it leaves them as
they were. `on: false` in `ops/rebuild` stops them either way, and
`firebase functions:delete onCopyWrite onLeagueWrite rebuild --region us-central1`
takes them down.

## League Standings in the cloud

For the accounts on the list, each League Standings season is one Firestore
document, `league/{season}`, which every device listens to and writes into
directly, with no server in between (`src/lib/live/leagueDocs.ts`). A season is
small, 10 to 70 KB, so the whole of it fits one document with room to spare.
One document per game was weighed and turned down: a listener is billed a read
for every document it holds again after half an hour away, so a season of 240
games would have cost 240 reads each time a device opened it.

The document holds the season record by record rather than as one value:

| Field                            | What it holds                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------ |
| `schema`                         | The layout's version, 3. A device reads and writes no document of a later one. |
| `rev`                            | The write the document is at: 1 when made, one more with every write.          |
| `name`, `createdAt`, `updatedAt` | As the season's entry in the switcher has them.                                |
| `teams`, `teamOrder`             | Each team under its id, and the teams' ids in the season's order.              |
| `matchups`, `order`              | Each game under its id, and the games' ids in schedule order.                  |
| `logs`                           | Each game's score, under the game's id.                                        |
| `bracketLogs`                    | Each bracket game's score, under its slot.                                     |
| `settings`                       | The season's settings, a field each.                                           |

So a write sends only what changed (`docChanges`): one score is the single field
`logs.<game>`, one setting `settings.<field>`, a game added is the game and the
new `order`. Two devices scoring two games at once write two different fields,
and neither undoes the other. A map keeps no order, and the order matters: the
forecast plays the games out in schedule order with seeded draws, so two devices
holding the games in two orders would show two different forecasts of one
season. The orders travel whole beside the maps, and a record an order leaves
out (two devices each adding a game and each writing an order without the
other's) is read after the listed ones, by key, the same on every device.

Records are kept under their ids as they are where Firestore takes them that way:
the ids this app makes (`ABCD`, `game_<time>_<n>`, `season-2`), up to 64 letters,
digits, `_` and `-`. Any other id, such as one a schedule file brought in, which
can be any text, is kept as `~` and its UTF-8 in base64url (`encodeKey`). A
season's document is named the same way. A record found under a key that is not
its own id's, or under a key `encodeKey` would never write, is left unread, and
every record is checked by the same validators storage reads with, so nothing
reaches a device unchecked.

**The layout's version.** A device writes a changed record whole, as its build
reads one, so a build that predates a field drops it from every record it
writes: a phone still on a build from before games kept their start erased the
start of any game it moved or edited, for every device. So the version goes up
with every field a season's document holds (`leagueDocSchema.test.ts` lists each
one, and fails until it does), and a device reads and writes no document of a
later layout than its build's: the season is read-only there, saying a newer
version saved it, until the page reloads. Layout 2 is a game's start
(`Matchup.startTs`), a set team list (`Settings.teamsLocked`) and the GameChanger
id kept beside a team's pick (`TeamBase.scoutGcTeamId`), one raise for the three. Layout 3 is
a season's archive mark (`Settings.archived`, "Archiving a season" below). Both sides of
every comparison are stamped with the build's own layout, so until 31 October
2026 no write carried one and every season stayed at 1, open to the builds that
drop a start. A season of an earlier layout is raised by the first write a device
of a later build sends it, in that write (`writesFor`), never by a write of its
own, which would cost one for each season opened. The servers read with the same
version (`docToSeason`), so the functions go out with the app or before it: a
server older than a raised season stops on it (`newer-league`) until it is
deployed.

The rules (`firestore.rules`, tried on the emulator by `npm run test:rules`) let
the accounts on the list read, list, make and change seasons, and nobody else
anything. A season is made with every field it has and never carries another;
each field must be of its kind; its `schema` never goes back to an older layout,
which a device that predates a newer one would otherwise write over; its `rev`
is 1 when made and exactly one more with each write, so a write made without
reading the season first is refused, and every device can tell which versions
hold which writes; and only the owner deletes a season, since a season deleted
here is gone from every device at once. A delete runs as a transaction, which
reads the season first, so it fails at once offline rather than waiting there
to land later, and the season is gone from the list here only once it is gone
from the cloud.

**On the server.** The boards are built with the seasons' documents once there are
any (`cloudLeague.ts`): the nightly's publish, each rebuild, and the edit
function's questions that refit a year (a what-if, the model check) all list
`league/` and read each season as a device does (`docToSeason`), so a season
reads the same to the boards as it did from the copy's part, to the record
(`cloudLeague.test.ts` holds every season of the seeded fixture to it). Until
some device has gone live there are no documents, and the copy's part is League
as before. Once there are, the part is never read beside them: a device with
League live leaves the part alone, so it keeps a season deleted since, which
read beside the documents would come back. A document of a later layout than
the build reads (`newer-league`) or one that is not a season's stops the read,
as a part that cannot be read does.

What the boards read of a season is its teams, games and scores, so the record
of what they were built from carries a fingerprint of exactly that, every
season's by its id, in id order (`league`, beside the copy's `inputs`). A score
saved on a phone leaves the copy as it was and still makes the boards stale, so
a rebuild publishes them again at the copy's own version; a season renamed, or a
setting changed, which no board reads, does not. The documents are read once for
a run and again just before each commit of the meta: a season changed between
the two would otherwise let a slow build put older scores over boards a rebuild
since had published with the new ones, so the publish takes its uploads back and
says the seasons moved (`league-moved`), which turns no night red, and the
change's own rebuild publishes it. A listing reads each season, a few reads for
a handful of seasons of 10 to 70 KB each, beside the three reads a rebuild
already makes before deciding to run.

**On a device.** It is on for every member's device. From 1.6e to 1.6f a switch,
**Keep League Standings live**, could keep a device's League in the cloud copy
instead; with the copy read-only to devices (1.6f) that would save nowhere, so the
switch is gone, and `lf_live_league_v1` is no longer read.

- **The first meeting** (1.6e). On by default, every device goes live at its own
  next visit rather than all together. Until a device has met the cloud's League
  documents (`lf_league_met_v1`, once on the device, whichever account signs in
  after, since every account on the list shares one cloud), the copy still brings
  League in there, so the device is in step with the copy before its seasons meet
  the cloud's (`meetSeasons`); the open season waits, read-only, until they have.
  But the copy is sent no League at all, met or not, as it is sent nothing
  (1.6f): a change made before the first meeting waits, owed, and
  reaches the cloud's documents at it. The copy's League a device has met is the
  base its first meeting starts from, and a change of its own in that base, which
  the documents had never held, would read as one they had deleted since, and be
  dropped (the 1.6e review's two high findings).
  - **In step.** League goes live for a first meeting only once a settlement here,
    as the account signed in, took in everything newer of the copy's League and
    set none of it aside (`leagueInStep`, with `leagueLiveWanted`). A status of
    saved is not that: the boot says saved when it stops waiting on a copy too slow
    to read, and a League that arrives while one is being edited here is set aside
    for the next save. Until then the copy carries League here, editable, its
    changes held back for the meeting.
  - **The base.** A season held both here and in the cloud, with no base of its own
    yet, takes the copy's season as this device last took it in
    (`leagueAgreedWithCopy`) as its base, at write 0, before any of the document's
    (kept as `fromCopy` by `leagueBase.ts`, since no document is at write 0); never
    a version this device sent the copy itself before 1.6f (`mine`), which could
    hold a change of its own the documents lack. So the open season's first
    meeting is three-way: a game another device deleted live since stays deleted,
    and a score entered here since is kept and sent, where with no base everything
    either side holds would be kept.
  - **Seasons deleted live.** A season the cloud does not hold is sent up rather
    than taken for deleted, since one the first device to go live never held would
    otherwise be lost. Except one the copy agreed on, held here unchanged, while the
    cloud holds a season of the copy's that another device sent: that device sent
    every season it held as the copy gave them, and no device kept live writes League
    to the copy, so the copy is no newer than those, and this season was deleted
    live since. It is met as deleted elsewhere, with the copy's as its base, and not
    sent back; the copy's League stays as the last device to carry it left it, and
    every device met afresh would otherwise send back every season deleted since.
  - **The list** a first meeting reads is the server's answer, never Firestore's
    cache (`getDocsFromServer`): offline, the cache of a page that has listened to
    no season holds none, which would read as a cloud with none. A first meeting
    whose list does not come leaves the season live without the bases, and is met
    again at the next visit, its seasons brought down meanwhile shown even if the
    meeting was cut short.
- **The open season is kept live** (`leagueSync.ts`). A change is written 0.7 s
  after the last edit, or as soon as the page lets go of the field, or when the
  page is hidden, in one transaction: what changed here since this device last
  took the document in, laid over the document as it then stands, by the same
  record-by-record merge the cloud copy uses (`leagueLive.ts`), and only the
  fields that differ written. What is compared is the season as every device
  reads it back from its document (`readBack`), never as typed: a value the
  readers rewrite ("07" for "7", a name with a space after it) would otherwise
  read as an edit here for ever. Another device's change is laid over the season
  on screen the moment it arrives, unsent edits included, except while a text
  box is being typed in and the change would alter what is on screen: then it
  waits until the page lets go, so nothing changes under the cursor. A select is
  not typed in, and holds nothing back. A version heard while this device's own
  write is out waits until the write has said what number it landed as, so the
  write is never taken for another device's change and a change made on screen
  meanwhile is not undone. A listener that fails is started again after 2 s, the
  page read-only and saying it is offline meanwhile.
- **The base** a merge works from is the document as this device last took it
  in, with the write it was at, and this device's own writes that have landed
  since, each with the write number it landed as (`leagueBase.ts`). An arrival
  is placed by its number: a version at or past one of this device's writes
  holds it, one before it does not, so a value changed and changed back before
  the first write came back is still sent, and nothing of this device's is taken
  for another device's change. The base is kept between visits, always after
  the season itself is in storage and only once storage has taken it, so a base
  never holds what storage does not: a game deleted on another device while this
  one was closed stays deleted, rather than coming back from this device's copy.
  A base that will not fit takes the one before it out with it, since that one is
  older than the season storage has just taken, and a score corrected elsewhere
  since read against it as one changed back here; with none, the next visit keeps
  everything either side holds. A base is used only for the
  season it was kept for, one made at the same moment; a season made since under
  a deleted season's id is a season of its own. With no base, the first meeting
  keeps everything either side holds, the cloud's record winning where both hold
  one; a season here that held nothing takes the cloud's in whole and from then on
  carries its creation time (`adoptSeasonCreatedAt`), so the next visit knows it
  for the same season.
- **A restore while live** (`applyFullBackup`) writes this browser's storage and
  nothing in the cloud. Storage counts each time its seasons are replaced whole
  (`leagueReplacements`), and the season the live store was watching is then
  stale: what it held of that season, sent or not, is what the restore replaced,
  so it is neither written back to storage nor sent. Before, switching to the
  restore's own open season wrote the old one back over its restored copy, and a
  season the restore put under the open id that the cloud knew as another was
  sent over the cloud's. The open season is met afresh, from storage and its
  kept base: what the restore changed is sent as this device's change since the
  version last heard, a season made at another moment is kept apart, and every
  other season goes the same way once it is next open here. A season the cloud
  holds that the file leaves out stays there and comes back, since a restore
  deletes nothing in the cloud; the restore's question says so.
- **Undo** puts back only what no other device has changed since the step
  (`guardedUndo`): undoing a deleted game here does not take back a score
  entered there since.
- **Every control that edits the season is off, with a line saying why,**
  whenever the season may not be written: offline (as the listener reports it),
  while the cloud's version is first read, for a season a newer version of the
  app wrote, one deleted on another device, one the rules refuse this account,
  one with a team or game id too long to be a key in Firestore, and one that was
  started apart on another device under the same id (every browser's first
  season is `default`, and a deleted season's id can be made again elsewhere):
  once this device knows when its season was made, any version made at another
  moment is another season, and is never merged into this one. The controls that only read it stay
  usable: a team's stats, the filters, the exports, the season switcher, and
  making a new season to carry on in (`EditLock`). The lock is on the season
  itself as well (`seasonStore.ts`): an edit that comes from outside the page's
  controls, a shared link or a toast's Undo, is refused, with
  the same reason, and before it does anything else: an Undo puts back none of
  its step rather than the pool alone, and keeps it; a shared link is asked about
  only once the season may be written, and kept until then.
- **The season list** is met with the cloud's once a visit (`leagueSeasons.ts`):
  a season made on another device comes down whole; one only this device holds
  goes up, which is how the seasons a device kept in the cloud copy become
  documents the first time it goes live; and one this device met before that the
  cloud no longer has was deleted elsewhere, and is not sent back. A season
  brought down comes with its base, so the same holds for it. Deleting a season
  deletes its document first, which only the owner may, and which needs the
  cloud to answer: a member, or a device offline, is told so, and nothing is
  deleted. On a member's device, met here or signed in here before, whose League
  is not live this moment (offline, signed out, or still to meet the cloud's
  seasons), nothing is deleted either, and the member is told why
  (`seasonDeleteRoute`): deleted here alone, the season's document would bring it
  back at the next meeting. A browser no member has signed in to deletes its own
  seasons here. The document is deleted only if it is this device's season, made at the
  same moment; another season under the id, kept apart from this one, is left in
  the cloud, and this device's is deleted here alone. A
  season deleted before some other device has first gone live comes back from
  that device, which has no base to tell a deletion from a season the cloud has
  not seen; a game deleted within a season does not, its season having the
  copy's as its base (the first meeting, above).
- **The cloud copy leaves League alone** (`cloudSession.ts`): it is sent no
  League, a League change is no change owed to it, and an earlier League version
  it keeps is neither offered nor brought back; once the first meeting is done it
  takes no League in either, and a newer League in it is not mentioned. A League
  change is still marked, so that the copy's League, taken in before the first
  meeting, merges with it rather than replacing it.

**What Team Rankings has, asked of the server.** Where Team Rankings opens on
the cloud's board (`liveBoardWanted`: in a browser
that keeps a cloud copy, signed in as a member or still finding out), League
Standings no longer reads Team Rankings off the device's own pool, which a
member's device is to stop holding. It asks the edit function instead, as the
member, three questions (`leagueAnswers.ts`, answered in `queries.ts` by the very
functions the device would run, over the cloud's pool):

- `league.bridge`: the season's bridge, which the forecast reads its outside
  results from and the link panel its rows, and the best of the clubs each league
  team could be: the first 50 by opponents in common and then games, as many as
  the panel's picker draws at once, and the club the team is picked as wherever it
  falls (`leagueCandidates`). Every club with a game on the season's pages went
  to every team before: on the seeded fixture's page of 8,689 clubs, the size of
  the real one a ten-team league was linked to, an eight-team season's answer was
  7,076,653 characters, and is 70,746 now; a club further down shares none of the
  team's opponents, and the wide picker finds it by name. It carries the season's
  teams and its fixtures as this device holds them, since a season edited here
  may not have reached the cloud yet. It is asked 0.8 s after the teams and final
  scores stop changing, so a run of edits asks once; again on coming back to
  League Standings from Team Rankings, where the member may just have ticked the
  season on a page or merged a club; when the member's sign-in comes through,
  since a question asked at boot before it did goes unanswered; when the device
  comes back online; and when the page is shown anew on League Standings, since
  the nightly may have pulled since, at most once every five minutes. While Team
  Rankings is on screen it is asked only where the bridge on hand does not answer
  the season as it stands: none kept yet, one an earlier build kept without its
  question, or teams and final scores changed since, which League's listener
  brings from another device. The forecast, the digest and its notifications read
  the bridge there too, notifications while the page is hidden, and a bridge for
  the scores before a final can count that game twice (it reads the pool's copy
  of a league game against the league's own final). Anything else that would ask,
  a retry for a bridge that does answer the season included, waits for coming
  back, which asks again, or reads the copy first (below): the boards ask the server nothing, so a visit
  spent on them woke the 8 GiB server for the bridge alone once the board was
  drawn, a cold load of the whole pool. On League Standings, the same question
  already answered, this visit or by the bridge kept from an earlier one, is put
  to the server again only where the copy has moved since: the reply names the copy and version the answer was
  worked out from, the server reading the pool at exactly that save, and one read
  of the copy's manifest (`copyAtNow`, a document where a question is the 8 GiB
  server) tells whether it still stands. Coming back from Team Rankings, the page
  shown anew, the sign-in, coming online and a retry all ask that way, so a
  session that changes nothing puts its question to the server once, where each
  of those asked it again, and a visit after it on the same day with no save
  between puts it to the server not at all; a copy that cannot be read is no
  proof it stood still, and is asked. The clubs each team could be come with an
  answer alone, never from what is kept, so while the link panel is open a
  question nothing this visit has answered goes to the server whatever is kept.
  An answer is held to its copy for a day at most, since a deploy can change how
  the server works one out and no save marks that, and only on the New York day it
  was heard, the server's: a scored game dated ahead counts from its day, so the
  bridge can change at midnight with no save; and only under the rules it was
  worked out by (`BRIDGE_RULES`, beside the boards' own `BOARD_RULES`), raised
  with any change to how the bridge or its clubs are worked out, which a test
  pinning the answer beside them asks for. The bridge reads none of League
  Standings' seasons, which move no version (`asksLeague`). A question
  out is never thrown away for another about the same teams: a change noted
  meanwhile is asked about once its answer is in, and being shown anew asks
  nothing while one is out. An answer for teams or scores since changed is
  dropped. A question unanswered is asked again on a timer after 5 s, 30 s and 2
  minutes, then after 10 minutes and every half hour, but the timer sends at most
  three a season a New York day on the device (`RETRIES_A_DAY`, the day's count
  kept under `lf_bridge_retries_v1` with its day, so a reload sends none of the
  day's again, and held by the page where storage will not keep it); past them the
  waits go on sending nothing, so the next day's three are made with nothing else
  asking. A retry that falls due while the page is hidden is not sent then: being
  shown sends it, in place of what being shown would ask, so the two never ask
  twice, and a change that asks anew meanwhile drops it. And while the server's
  replies say the edits' month is spent (`editMonth`, "Rebuilds after saves"),
  answered or not, the timer sends none until New York's month turns or a reply
  says it is not spent; a reply that says nothing of it, from a server before
  this or a charge the ledger was slow to take, is not known and changes nothing.
  The sign-in, coming online, the page shown anew and every change still ask as
  they did, whatever the timer has sent. Until 31 October 2026 the half hour
  repeated with no end, hidden or not: one page left open with a server that
  could not answer sent 48 cold 8 GiB loads a day, about 23,000 GiB-seconds at a
  minute each (the sweep's reckoning of 30 October 2026); and every 2 minutes
  until 16 Oct 2026. The last bridge for a season, the bridge alone
  and never the clubs, about 2,400 characters, with the very question it answered
  as JSON (compared as written, since a reload holds no array of the visit before
  to compare by identity) and the copy, version, moment asked and rules it came
  from, and for one read off the publish when that went out, is kept on the device
  (`lf_league_bridge_v2`, the last four seasons, the open one alone when storage is
  full; what an earlier build kept under `lf_league_bridge_v1`, every club with it,
  is let go of) and read back through the same checks as one from the network, so
  the forecast has its outside results the moment the season opens, and offline.
  It goes with its season, as everything a device keeps of one does
  ([Data + persistence](README.md#data--persistence)), and what was heard this visit is held
  by season, not by id, so a season made under a deleted one's id, or restored over
  the open one, reads none of the outside results of the season before it.
  Until there is a bridge to show, the link panel says it is asking, or that it
  could not ask and will again, rather than that no age group claims the season.
- `league.clubs`: every club the link panel's wide picker lists, asked for the open
  season while the box is ticked, so a season switched to with it ticked lists its
  own; the panel says the list is coming, or that it could not be asked for, with
  Try again.
- `league.fill`: the scores Team Rankings could fill in, asked when **Fill scores
  from Team Rankings** is pressed, with the season's teams, games and scores. The
  button says the scores are being asked for and takes no second press until the
  answer comes. An answer for a season switched away from meanwhile opens nothing;
  no answer says that the cloud could not be asked, and opens nothing either. A
  game scored here while it was asked is not filled over (the fill above).

**Read off the publish** (from 1 November 2026). The bridge and Fill's plan are
published beside the boards for every season with a document ("League Standings'
answers", in "Views a server publishes" above), and where either would be asked the device
first reads the meta and the season's view, and takes the answer there where it is the very
one the question would get: the same teams and schedule, the same finals wherever the bridge
can turn on one, every score the same for Fill, on a day the answer holds for, and no save
of this device's own edit since. Every reason the bridge is asked (the season opening or
changing, coming back from Team Rankings, the sign-in, coming online, the page shown anew,
a timer retry) reads it so, and asks only where it does not answer, except that over the
server's own answer to the same question, with a stamp that stands, the copy's manifest is
read first, as before, and the publish only once the copy has moved: so a publish that does
not answer costs a read only beside a question. A final entered here, or on another device,
at a fixture no pool row could be a copy of is taken without a question. While the link
panel is open the bridge is asked as before, since the clubs each team could be come with a
question alone, and an answer heard this visit from a later save than the publish's stands
over it. A bridge or plan read so is kept and shown as one heard
is, and the two panels say when the publish went out. The questions stay for everything
the views do not answer, and an older build asks as it always did until it is reloaded, so
nothing on the server is taken away.

A question carries at most 200 teams and 3,000 games, well past any league's, so
none holds the one edit worker long, and the server refuses one with anything it
does not read. An answer is read back whole or not at all, and a bridge with a
result that is not neutral is refused, since a neutral result is all the forecast
is ever given.

**Our team's places, off the cloud's board.** The Dashboard's "Our team" card
shows where each team's club stands on Team Rankings (`leagueClubRanks.ts`), as
the board on the page last stood. The device's own page writes those places
whenever its board is up; the cloud's page now writes them too. The publisher
says, beside each page's counts, which League Standings seasons the page claims,
the club each of their teams is there, and the halves the season's games are in
(`LivePages.league`), worked out as the page works them out (`deriveAllKnown`,
which `boardParity.test.ts` holds it to on the seeded fixture). The cloud's page
writes a season's places only off its own board once drawn, and only off a half
the season plays its games in, as the device's page does; a season none of whose
teams is a club there yet has the places the card was showing taken away, and a
season the meta does not name keeps what it had.

The season on screen is held in a small store outside React
(`seasonStore.ts`), which the live store reads and changes in one step, so an
arrival is merged into exactly what is there and nothing lands between the read
and the write; the page renders from its own copy of it, set from the store's
notice with the priority of the change, so a score box's keystroke still renders
as a transition. Locked, the store refuses the page's edits and still takes
another device's.

## Team Rankings edits as commands

An edit to the Team Rankings pool is written down as a command (`src/lib/live/commands.ts`)
before it is made: what a person asked for, so that the same change can be made by this browser
on its own store or, once the edit function is in, by the server on the cloud copy, with the same
code and the same result. A command reads the pool through `PoolRead` and answers with the parts it
would write and the command that takes it back. It never reads a clock or makes up an id: what a
change needs that the pool does not hold travels in the command. Each command comes with its
inverse, and a property test draws hundreds of edits on pools of every shape and checks that the
inverse puts every part the command touched back as it was, to the stored byte.

| Command                                                                                                                                                               | What it changes                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `answers`                                                                                                                                                             | Ids added to and taken from the user's answers: clubs said to be real, ages said to be right, pairs kept apart, names said not to be a club. A club said to be real has its marks as one taken off as plainly made up forgotten with the answer, and put back by its Undo.                                                         |
| `team.state`, `team.unlinkGc`                                                                                                                                         | A club's state; one GameChanger id taken off a club.                                                                                                                                                                                                                                                                               |
| `game.score`, `game.exclude`, `game.confirm`                                                                                                                          | A score typed; a game kept out of the maths or put back; a lopsided score vouched for at the margin it reads now.                                                                                                                                                                                                                  |
| `game.add`, `game.remove`                                                                                                                                             | Games added at the end of their year, with the new clubs they name (and only those); games taken out of their year.                                                                                                                                                                                                                |
| `game.notThisTeam`                                                                                                                                                    | A game a club has only by a name another club's schedule wrote taken off it, with that club's other such games, onto the stand-in the name would have had, made under the command's id where none is reused.                                                                                                                       |
| `page.myTeam`                                                                                                                                                         | A page's own team marked or unmarked.                                                                                                                                                                                                                                                                                              |
| `club.leavePage`                                                                                                                                                      | A club taken off one page: its games there, the page's mark if it was the page's own team, and the club itself only when no game in any year names it and no row is filed against it.                                                                                                                                              |
| `games.drop`, `club.drop`                                                                                                                                             | Games thrown out of whichever years hold them, the rows that scored them remembered so that a pull does not file them again; a club thrown out with every game it is in, its own row another club's copy claimed among them, its GameChanger ids refused from then on and its marks as one taken off as plainly made up forgotten. |
| `season.assign`                                                                                                                                                       | A League Standings season put on the page of its age, the page made under the id the command names if there is none, or taken off Team Rankings.                                                                                                                                                                                   |
| `club.age`, `club.ageClear`                                                                                                                                           | A pulled club filed at the age somebody says it plays at and held there whatever a later pull says; and that taken back, each of its ids to the level the app had it at.                                                                                                                                                           |
| `teams.merge`, `team.rename`                                                                                                                                          | One club folded into another, every page whose own team it was following it; a club renamed, refused onto a name another club goes by, since that is a merge and only the person asking can say which club stays.                                                                                                                  |
| `team.put`, `team.insert`, `team.remove`, `game.put`, `game.insert`, `group.put`, `group.insert`, `group.remove`, `namedAges`, `games.set`, `teams.set`, `groups.set` | A record put back as it was, in its place, or a part put back whole: what inverses, and work laid down from a copy, are made of.                                                                                                                                                                                                   |
| `ageless.forget`, `ageless.insert`                                                                                                                                    | Teams taken off the list of those nobody could age (1.5), and put back at their places, a team a pull has asked about since left as the pull left it.                                                                                                                                                                              |
| `refresh.cadence`                                                                                                                                                     | How much the nightly refresh pulls at once (1.5): every age group, or one or two levels a day.                                                                                                                                                                                                                                     |
| `orgs.merge`, `orgs.put`                                                                                                                                              | An Organizations file's organizations kept beside those kept (1.5), one named again replacing its own; and the organizations put back as they were.                                                                                                                                                                                |
| `autoRemoved`                                                                                                                                                         | Marks of clubs taken off as plainly made up ("Clubs removed for you") put and forgotten by GameChanger id: what the nightly sweep and a pull's end write, what Put back on the boards and a night's put back forget, and what their Undo puts back.                                                                                |
| `batch`                                                                                                                                                               | Several commands as one, each reading what the last wrote.                                                                                                                                                                                                                                                                         |

On this browser a command runs through `runPoolCommand`, which writes only the parts it changed
(vouching for a score writes that game's year, not every year as it once did) and the roster as it
is stored, never with the teams League Standings makes on the fly, whose ids hold only for the
walk that made them. A club League Standings made joins the roster only when it is given something
to keep, and then alone; its name is set there, so its panel locks the name on every page, not only
on the page its league games are on. Games added keep what they put right on the clubs they name
that the roster holds, a name cleaned of an age label it was stored with and a state from the
import's file where the club had none, and nothing else the walk worked out.

The page shows a change once it is written, and a command is written whole or not at all
(`writePoolTogether`): when the store refuses a part (full, or held by a newer tab), the parts
written before it are put back and the change is said to be refused, so a club thrown out is never
left gone from the roster with its games still naming it, nor a page made with none of its games
moved onto it. On IndexedDB the store refuses a write only when the pool cannot be reached or a
newer tab holds it, which refuses the first part as well as the rest; a write it accepted that then
fails to land is told afterwards (`onPoolWriteError`), since by then the command has returned.

Undo runs the change's own inverse, so it puts back exactly what was taken, where it stood, and
leaves alone whatever was changed in between: a game removed and a score entered on another before
the Undo both stand afterwards, where the old Undo wrote back the year as it was at Remove and lost
the score. An Undo of an import takes its games out and the clubs it brought with them. Removing a
game or a club can set off a tidy that prunes a stand-in nothing stands on any more, so the Undo
then puts back, from the roster as it was at Remove, any club its games name that is gone.

The clean-up commands (thrown-out clubs and games, a league season's page, a club's age, merges
and renames) are the functions the page always used (`withoutClub`, `seasonAtAge`, `setClubAge`,
`mergeScoutTeams`), with what to write and how to undo it read off a diff of each part, record by
record by id (`settle` in `commands.ts`): the inverse puts back exactly the records that changed,
so an edit made in between stands through an undo, and only a part whose kept records moved
relative to each other is put back whole. Identity is what says a record changed, so a command
reads each part once: the store decodes a year afresh on every read, and two copies of one year
would make every game in it look changed, which an undo would then write back over whatever was
entered since. Storage files a game under its page's year, so the pages are written around the
games: a page a command makes before the games filed on it, and a page an undo takes away only
after its games have left it. A command never mints an id: a page it may need comes named in it.

An inverse puts clubs back first, then pages, then games, then takes away the pages and then the
clubs the change had made, so that what it restores always has the club and the page it names, and
an undo of an undo comes back in the same shape; a batch's undo is its steps' inverses run flat, in
reverse. The commands never leave the pool naming nothing: a game filed on a page of another year
than the command's, or an id two games hold, is refused; a club an undo takes off the roster stays
while a page marks it as its own or a game names it, something made since it came having made it
the pool's. Throwing a club out takes every page's mark off it, and takes out a club the roster no
longer holds whose games are still there. A command that comes
in from outside (`coerceCommand`, for the server) is taken only when it reads back as exactly what
was sent, so a field the reader does not know is refused rather than dropped.

Making these edits commands fixed four things on the way. Renaming a club wrote League Standings'
teams into the roster; folding a page's own team into another club left the page's star on a club
that no longer existed (renaming onto a taken name already moved it); the Undo of a club's age
wrote back the whole year as it stood, losing any score entered since; and deleting a club or a
lopsided game rewrote every year's games, not only the years they were in. And one in storage: a
year whose save was refused no longer reads as empty until the next change to it, since the save
pinned the year decoded with no games before writing, and a refusal left the pin standing.

Work done on a copy of the pool (the tidy, in its worker, and a year archived or deleted) is laid
onto the pool as it is when the work is done, record by record (`changeBetween`): what the work
changed, as the commands that make that change, rather than its copy saved whole. The worker hands
back decoded copies, every record a new object, so a record that is not the same object is compared
by its values before it is called changed. On this page an edit already starts the tidy again on
the pool as it now is; laying its result down record by record is what the server needs (1.4),
where an edit from another device can land while a tidy works. A tidy whose result no longer fits
the pool (a record it changed is gone) writes nothing, says nothing, and leaves its stamp unset so
it comes round again. The waiting-on-age answers (an age named, a team thrown out, a pass cleared)
and the clubs a pull finds invented go through the same commands; the waiting list itself is the
pull's and stays as it was.

On the server a command runs on the cloud copy itself (`runEdit` in `editRun.ts`), in a process that
keeps every part of the pool a command reads warm (`createEditPool`: all but an archived season's
rows and League Standings, which no command reads): brought to the copy as it stands, the command
applied through the same `runPoolCommand` a browser uses, and the parts it wrote committed onto the
version read as one save, named `live-edit`. Only that pool may be handed to an edit: a rebuild's
keeps the boards' parts alone, and a command run on it would save the rest over the copy as empty. A save that lands in between moves
the copy on; the written keys are then let go of one by one (`forget`), so the next read fetches
those and whatever the other save changed rather than the whole pool, and the command runs again on
the copy as it now is, up to three times. Its ids and times travel in it, so the second run makes
the same change or is refused where the newer pool no longer allows it. A device may name the copy
it edited, and an edit is refused on any other, as it is on a copy started again under the run, or
one whose Team Rankings was started again, brought back or restored between one run through and the
next (its epoch, which the next run through compares with the first's). A
commit that lands tells the pool its writes now stand in the copy (`committed`), so the next edit
fetches none of them back. A command refused writes nothing, and the pool stays warm; a store that
would not take a write, or a run that throws, leaves the pool to start afresh on its next read, which
is slower and never wrong. A copy an older build saved with its games under one key is split into
years as the pool opens, and the split goes with the edit's commit, the one key taken out, as a
browser's next save carries the split it made; left behind, every opening would split the one key
over the years again, over a year the edit had saved. A commit whose answer never came is found by
its save id like one answered no (`commitChanges`): landed, the edit is made; not in the copy, it may
still be on its way, so its pieces stay for a late landing to be whole and the edit answers
`unsure`, the device told it may or may not be in the copy, and the pool fetches what it wrote again.
Only a save that never went (a piece the store would not take) fails as not made. The tests show an
edit on a warm pool fetches no piece but those another save moved.

The edit function (`edit` in `functions/src/index.ts`) is that run behind a call: a member's
device sends `{ command, copy }`, signed in, and the function checks the caller against the list
as the GameChanger proxy does (`memberCheck.ts`), keeping the answer a minute rather than the
proxy's ten, since it writes the copy past the rules. It reads the command back exactly
(`coerceCommand`, which refuses a field it does not know at any level, and a command of more than
500 steps) and refuses anything else before a worker starts. The edits run one at a time in a
worker that keeps the pool from call to call (`editWorkerProtocol.ts`), one instance taking up to
eight calls at once and queueing them. The instance has 8 GiB, with a 5 GiB worker heap cap;
a worker past 4 GiB of heap or 6 GiB in all is started afresh between requests
(`EDIT_RECYCLE_AT`). The edit is made whatever
the rebuilds' switch says, since it is a member's change to the copy, and the call answers as soon
as the save has landed, with the version saved, the inverse for an Undo, and what changed.

No call is left for the platform's timeout to answer with its edit still to come. Each has 520 s
from when it came (`EDIT_CALL_S`, inside the 540 s timeout): one whose caller has gone, or whose
time is up, before its turn is never sent, and a run is cut short at the time its call has left or
520 seconds, whichever is less (`EDIT_LIMIT_S`). A cold nationwide pool is no longer killed
at sixty seconds and downloaded again on each retry. A call never
sent, or one whose worker said it threw short of any save, is answered as an edit not made
(`aborted`); a worker lost with an edit in its hands (died, cut short, out of memory), or a save
whose answer never came, as one that may or may not be in the copy (`unsure`), which the copy then
settles. A call's compute is its own turn in the worker, which is what fills the instance's billed
time, with the instance's start-up the first time, and it is charged to the ledger's totals for
the edits (`handleEdit`, `chargeEdit`): the charges one at a time, so none is written over another; one the ledger is slow
to take left to finish behind the answer after five seconds; and one lost to other writers said in
the log line. It does not build the boards: every board of the real pool
takes about half a minute, which the member would wait on and which would hold every edit queued
behind it. The save asks for them itself: the trigger rebuilds after the edit function's saves
soon after each, on the rebuilds' own instance, under their ledger and switch, and never sooner
than a minute after the last run ended, so a run of edits shares its builds. `{ warm: true }` brings the pool up ahead of an edit,
charged the same way. A device calls it through `callEdit` and `callWarm` (`editClient.ts`): the
callable protocol over `fetch` with the member's sign-in, no Firebase functions SDK in the bundle,
and nothing of the answer taken on trust, an inverse least of all, since it is what the device
sends back for an Undo. An edit is said not made only where the server said so (a refusal, a caller
turned away, or `aborted`). Any other failure (a 500, the platform's own answer to a call it timed
out, a request lost, an answer cut off) says the edit may or may not have been made, which the copy
then settles, since any of them can follow a save that landed. The page's content policy lets the app reach the project's functions
host (`functionsUrl.ts`). It is built and deployed with the rebuilds (LIVE_REBUILD), runs as their
account, and asks nothing more of the project. The live page's club panel is the first thing in
the app to call it (1.5); the other sections follow.

The function also answers questions about the copy (`{ query, copy }`, `queries.ts`), which the
sections ask as they go live (1.5): what a section has to say before an edit, worked out on the copy
rather than on a pool the device no longer needs to hold. The first two are what folding one club
into another touches (`merge.preview`) and whether a new name is another club's, which a rename
folds into instead (`rename.preview`), each answered from the warm pool by the code the page
answers it with, the pool brought to the copy as for an edit and nothing written. A question is
read back exactly, as a command is (`coerceQuery`); a request naming more than one of an edit, a
question and a warm-up is refused; and its turn is charged as an edit's (`handleQuery`). It changes
nothing, so a question the worker failed with, or never had, is only a question to ask again
(`callQuery` reads any unclear answer as failed). A worker that answers a request with anything but
what the request was due is ended as one that died would be. On the 29 September 2026 pool, in
memory, a merge preview took 67 ms and a rename preview 139 ms.

Pool health asks four more as Setup goes live: what it shows as it opens (`health.summary`, worked
out by `poolHealthSummary`, which the device's own card uses too), what it shows once asked to look
harder (`health.inspect`, as the tidy worker answers it, which the tests check it against), the file
of every club worth pulling (`health.toPull`), and the suggested ages approved together, as the
commands that file them (`ages.plan`, `planClubAges`). The look sends only the five clubs worth
pulling the card draws, and how many there are: on the 29 September pool the 51,298 of them were
7.5 of the 7.9 MB the answer came to, sent on every look for a card that draws five. Cut, it is
377 KB, and the file comes to 2.8 MB when asked for. A larger answer is read through its shape
(`shapes.ts`): the type said once as data, every field it names checked as the device reads it, and
a field it does not name let through for a newer server to say. On that pool, in memory, the
summary took 0.33 s (130 KB), the look 6.2 s and the file 0.5 s, and each answer read back whole.
The look also carries the leaders with few outside games (**What a pull left behind**), worked out
with League Standings' seasons as the boards are: on the 11 October 2026 copy, 9.5 s and 606 KB of
JSON beside a look of 8 to 12 s. It is optional in the reader's shape, so a server from before it
is read as sending no list, and a device from before it lets it through unread. The look is fitted
for `boardDay`, the day the boards on screen were published for, where the device sends it, which
it does only when that day is not its own: a server reads a question whole or not at all, so one
from before the field would refuse every look that carried it. On the 11 October copy, fitted a
day later, the list of 1,160 drops 4 leaders, adds 1 and moves 2 state places; it moves 220
national places too, every one past 25, which the card never draws.

The card of teams waiting on an age asks four more: the card at a sitting (`ageless.queue`,
`agelessSitting`), a search of the whole list (`ageless.search`), the file of every team waiting
(`ageless.file`) and what a pass over the rules ticked would clear (`ageless.clearPlan`). The
sitting carries how many rows each rule set aside (`setAside`); a device reads an answer from a
server before the counts as none set aside, leaves out a reason a newer server counts that it has
no words for, and a device from before them never reads the field. A search's hit carries one of
the five reasons every build since the search reads in `aside`, and any later one in `setAsideBy`
(`FIRST_ASIDES`, `hitAside`): a build before 18 October reads `aside` strictly and refuses the
whole answer for a reason it has no words for, and the live page waits for its update to be
taken, so a phone can run such a build for days, and on the backup of 11 October 8,341 of the
13,169 rows carry a later reason. There such a row shows with no note, as on the queue; this
build reads both fields, an older server's answers among them, and reads a reason it has no words
for, in either, as none rather than refusing the search. Each
team is sent as the entry storage keeps and read back as storage reads one (`oneAgeless`), every
line of its row worked out on the device from it. The 29 September copy's list held 13,338 teams
(5.9 MB), 10,509 of them waiting: the sitting took 0.19 s (5 KB), a search 59 ms (12 KB), the file
0.11 s (2.9 MB, asked for only to download) and a plan 0.12 s.

A reply goes as JSON writes it (`asJson`), an edit's and a question's alike. The callable sends
its result through firebase-functions' own encoding, which throws on a number with no end and
sends a field left undefined as null: a model check, whose uncapped run and last bucket have no
end, was answered with an error every time, and Pool health's summary of a copy with a page that
has no year was refused whole by the device, for the null its missing year became. Written as JSON
and read back, a number with no end goes as null, which the readers take for one, and an undefined
field is left out. The tests send replies through a copy of that encoding (`callableEncode.ts`), and
the functions' smoke test runs the package's own, so a release that changes it is seen. An edit too
big to take back as one, its inverse past the 500 steps a command may hold (Pool health's approval
of a few hundred clubs, a club's age taking two steps or more to take back), is answered as made
with nothing to take it back (`none`), and the device offers no Undo for it.

A question is held to what a device sends, so none holds the one worker past its time or ends it:
a time is an instant as a clock writes one, between 2000 and 2199 (the year -271821 passed the old
check and threw in a refresh's day arithmetic, ending the worker and the pool it kept warm); a name
or a search is at most 200 characters; and a list is no longer than a page hands one (the ten
waiting teams pinned, the rules on the card, two clubs adopted, the 500 clubs one edit can file).
Approving more suggested ages than that sends them as several edits, each planned on the pool the
last one left, so two clubs bound for one new page still make it once; only an approval sent as one
edit offers an Undo. A League Standings part that cannot be had refuses the question that needs it
for the reason it could not: a store that would not answer is `store-refused` rather than an error
that ended the worker, and a piece missing while the copy still names the part at that hash is
`damaged`, where it was once read as a copy that kept moving, which it would have been said to be
for ever.

A question that refits a year (a what-if, a model check) spends what a rebuild's fit does and
changes nothing a member is owed, so it is refused once the day's or the month's compute is spent
(`capsSpent`, read from the ledger before the question reaches the pool), and the device says it
waits until tomorrow, or next month. The rest are reads, mostly asked on the way to an edit, and an
edit is never refused for the caps. A ledger that cannot be read within five seconds holds nothing
back, the bill's hard stop being the backstop, and the log line says so. On the 29 September copy a
model check took the worker's heap to 1.66 GB, the most of any call measured and two thirds of its
2.5 GB cap, and the process to 2.2 GB of the instance's 4 GiB; a pool half as big again would need
the cap raised, and a worker that runs out ends that question unanswered and is started afresh, as
one that fails is. Each of these guards was broken in turn and seen to fail a test, 45 of 45, three
of them (the League part's missing piece) only once tests were written for them.

Measured with `npm run live:bench` on the 29 September 2026 pool (255,579 games, 116,485 clubs),
in memory, so Firestore's round trips and uploads come on top. The pool came up cold in 1.4 s. An
edit took from 2 ms (a Pool health answer) through 1.1 s (a club's state), 2.8 s (games thrown out),
3.0 s (a game kept out of the maths) and 3.1 s (a score) to 4.1 s (a club's age), 4.3 s (a club
thrown out) and 4.5 s (a merge), apply and commit together, and its Undo about as long. After an edit
that changed what the boards read, the rebuild's own pool fetched the parts it changed in 0.6 to
2.2 s (a year of games is 18 pieces), and building and publishing every board took 30 to 34 s. The
bench is run on a backup (`npm run live:bench -- <backup.json>`) or the seeded pool (`-- --fixture
<clubs a page>`); it keeps the copy it makes in a file (`--save <copy.json>`) and runs again from
that (`-- --copy <copy.json>`), and only such a run reports the most the process held, since one
that read a backup holds what reading it took. From the copy, the process held at most 1.1 GB
bringing the pool up and making and undoing the edits, which set the previous four-GiB profile.
The first build of every board took it to 2.6 GB, and builds after it to 3.8 GB (2.3 GB with the heap
held to 2.5 GB, the builds taking as long), so the rebuild keeps its 8 GiB, with room for the pool
to double over a season.

Two kinds of write are not commands. The browser's own pull engine saves as it goes and is removed
for members in the cleanup (1.7), pulls having moved to the server; and resetting the app or
restoring a backup replace League Standings and the settings as well as the pool. Those become
owner's operations on the server copy at the cutover (1.6), as archiving and deleting a year
already have.

**A year archived or deleted by the owner** (1.6). Setup's Archive card on the live page lists
the years as the server counts them (`year.list`, the device card's own `summariseYears` over the
server's store), and asks the server first what an archive or a delete would keep and take
(`year.archivePreview`, `year.deletePreview`), in the device card's own words
(`yearSummary.ts`, which the device's page now asks in too: a test holds both confirmations and
the message after to the letter). Then it sends `year.archive` or `year.delete`, two commands of
their own that only the server runs (`yearOps.ts`), since an archive is made from the year as its
boards show it, League Standings' games in it (`deriveAllKnown` with the seasons the boards are
built with), and writes the archived tables, which no pool command touches; the pool's own
`applyCommand` refuses them. They are never in a batch, and never taken back. The server runs the
device's very functions (`archiveSquadYear`, `deleteSquadYear`) on its warm pool: the tables into
the archive, then the pool written part by part where it changed (`poolWritesBetween`, by the
records' identity), then the tidy stamp where the pool was tidy, all committed as one save, so a
year is never half archived in the copy. The device lays an archive down record by record
(`changeBetween`), but a year's archive throws out thousands of clubs, and each, as a step of its
own, would scan every game and keep a roster of its own until the batch ended. Only the copy's
owner may send either: the member check reads the caller's entry on the list (`memberCheck.ts`),
and an entry whose `role` says `owner` in so many words is the owner's, anything else a member's;
a member's year archive or delete is refused before the worker has it, with "Only the cloud copy's
owner can archive or delete a year". `yearOps.test.ts` holds the server's archive and delete to
the device's functions on the seeded pool, League Standings' games included, and `editRun.test.ts`
the one save each makes; the functions' smoke run holds a member's delete refused. Since 8
November 2026 a member's card draws both buttons off, with a line under them saying only the
owner can (`OWNER_ONLY`), once the member's own entry on the list has been read (`cloudRole`,
`useOwnerOnly`): before, a member was walked through the server's preview and the confirmation
to be refused at the end. The owner's card is as it was, and so is one whose entry is not read
yet or could not be, the server's refusal standing either way.

**Team Rankings started again, and an earlier version brought back, by the owner** (1.6). Two more
of the owner's commands, made on the copy's own manifest rather than on a pool (`copyOps.ts`), and
committed as the edit run commits any other, again on a newer version when a save lands between.
`copy.reset` takes every Team Rankings part out of the copy and keeps them all as one earlier
version, League Standings left as it is: a start of Team Rankings is no reason to lose a season's
scores. It keeps the lot whole (`commitChanges`' `keepWhole`), a value some earlier settlement
already keeps included, since otherwise that value would be left out of the version and bringing it
back would not bring back all the start took; and it marks the version as Team Rankings whole
(`KeptPart.whole`), so bringing it back takes out anything Team Rankings has gained since, kept
whole in turn, rather than leaving it beside what comes back. Its inverse is bringing that version
back, so the live page's Undo is exact while nothing else has moved, and the Cloud panel's Bring back does it
while it is one of the six versions kept (`KEEP_GROUPS`, 30 days at most): the nightly keeps what
it replaces too, so a week of refreshes that change anything pushes it out, as the confirmation
says. `copy.restore` is the
device's Bring back made by the server: the version made current, what it replaces kept in turn.
A version holding League Standings is not brought back once its seasons have documents of their
own (`league-kept-live`), since neither the boards nor any device read the copy's part then. Setup
on the live page has the start (`LiveStartAgainCard`), which asks the server what the cloud holds
when pressed by opening its confirmation immediately; it does not wait for `year.list`.
Reset and restore work directly on manifest metadata and download no team or game chunks.
Nothing on the device is deleted, as the
device's own Start from scratch does. The Cloud panel's Bring back asks the server
(`serverRestore.ts`), then takes the copy as it takes any other save, so a device never writes the
copy to bring a version back. Both are the owner's alone, refused to a member with "Only the cloud
copy's owner can …", as the functions' smoke run holds for all four of the owner's commands, and
drawn off for a member, Setup's Start again and the Cloud panel's Bring back alike, as a year's
archive and delete are (above).
`editRun.test.ts` holds the start, its Undo, a version a device kept brought back, the boards
emptied and published again, and a save landing between.

**What a start does to League Standings' links.** A start takes the roster, every club's id and
the high-water of the ids let go of with it (`CompactTeams.h`), so the pulls after it mint ids
afresh in whatever order their teams come. League Standings is not touched, and every pull, tidy
and game added by name after the start reads it, as each did before, and holds as taken the id
of every club a League team picks that the roster no longer holds (`retiredWithPicks`), so no
club is minted under a pick's old id. Each pick is read through its club's GameChanger id
(`readPick`): until the club is pulled again, the pick names a club gone; once it is, the pick is
that club's under its new id, with nothing written to League Standings. A pick made before the id
was kept carries none, and reads as a club gone, **Gone** in Settings and `link-gone` in Data
Quality, until its club is picked again (`clubIdsOnce.test.ts` holds both on the server's own
start, pulls, tidy and a game added by name). Bringing an earlier version back brings back its
roster with the high-water it had then, and the same holds of it.

**A start is not undone by work already under way.** The start keeps the copy's id, so until
16 October 2026 a nightly, a Refresh now leg or a staged import that had read the pool before it
took the emptied copy for the one it read: its save, finding the copy moved, read it again and
filed into it every team it had asked about, and a publish of the views built before it put the
old pool back on the boards. Each start, a version brought back and a backup restored now gives
the copy a new epoch (see "How it is stored"), and every one of those refuses a copy of another
epoch (`copy-replaced`): a pull's retry (`fileAndSave`), each leg after a job's first, held to
the copy and epoch the first read (`PullJob.on`), a staged import's final phase and its resumes,
held to the epoch its teams were chosen from, and every publish (`publishCopyViews`). Once the
start is saved, the edit function asks every pull queued or running to stop (`stopPullsUnderWay`,
writing `stopAsked` as a device's Stop does), so none goes on asking GameChanger for a pool that is
gone. Only pulls from before the start: one whose document Firestore made at or after the moment
the start landed is a pull for the Team Rankings just started, sent in the seconds the look takes,
and is left to run. Both times are Firestore's own, so they are in the order it wrote them: a job's
create time, against the copy's manifest's update time while the manifest is still at this start
(the time the server stamped on the save stands in where it has moved on). A list sent before the
start is stopped whichever pool its worker went on to choose. It finds the pulls by their status
in one query, and reads the refresh gate for a nightly pulling, which it cannot stop from there;
the owner's toast says how many it stopped and whether the nightly was pulling ("2 pulls under way
in the cloud were asked to stop, and file nothing more."), so a start never races a pull silently.
A pull's job ends saying Team Rankings was started again and to send its list, or press Refresh
now, again; a resumed import that was stopped by it ends at once, before downloading another team.
`cloudRunner.test.ts`, `pullJobRunner.test.ts`, `stagedImport.test.ts`, `publishCopy.test.ts` and
`editRun.test.ts` hold each guard against the edit function's own start.

**What a start says.** Pressed again on an emptied copy, Start again is refused as `missing`, and
says the card's own words ("The cloud's Team Rankings has no pages, games or archived tables to
start again from."), not that a club or a game is gone (`editRefused`); an earlier version no
longer kept says so. A start, a version brought back or a backup restored whose answer never came
(`unsure`, or a call that came to nothing) says to look at Setup's squad years or the earlier
versions in the Cloud panel, which read the copy, rather than at the board, which goes on showing
the old pool (`unansweredSaid`). The boards, Find a team and the club cards are views the server
publishes, and a start does not build them: until views of the start's version are published,
the live page says so on every area ("Team Rankings was started again. The boards, Find a team and
the club cards still show what it held, and empty once they are published again, within half an
hour."; `startedAgainNotice`, kept among the page's pending edits and gone once `settledBy`).

**Responsive Setup controls.** Background questions, including Pool health and the teams
waiting on an age, use `poolQuery`, a separate callable service with its own warm worker.
Archive/delete previews use `edit`, beside the corresponding writes. The years' list
went there too until 25 October 2026, so opening Setup woke both 8 GiB services; it is a
read like the rest, and `poolQuery` reads the copy afresh, so it now goes there. Both
services use the same member checks and existing ledger; `poolQuery` refuses every write.
The read client falls back to `edit` on a 404 while the new function is still deploying.
Reset and restore keep their place in the write queue after the owner's authorization is
checked. An earlier write finishes before them; only active or queued reads can be cancelled
or skipped. The copy command then updates metadata without downloading the pool, so an
earlier edit cannot retry after the reset and repopulate the data just cleared.

Reads and warm-ups are cancelled when their screen closes. An active cancelled read ends
its worker, and a queued one never starts; a running edit finishes its save. A successful
reset, restore, archive or delete cancels obsolete questions and refreshes Setup's lists
immediately. Reset confirmation and working status appear before any pool download,
archive/delete show working status, and an unanswered year list offers a retry. Tests
cover reset/Undo with all bulk downloads failing, a stuck background read beside a
successful reset, cancellation, a read lasting past sixty seconds, and the endpoint routing.

**Team Rankings restored from a backup by the owner** (1.6). A backup of Team Rankings is
tens of megabytes (70 MB of JSON on the 29 September backup), far past what a call may carry, so
the owner's browser stages it where only the owner may write (`uploads.ts`): its record at
`uploads/{id}`, written first, then the file's JSON gzipped into pieces of at most 900 KB at
`uploads/{id}/chunks/{id}-{n}`, as the copy stores a part; the 29 September backup stages as 25
pieces, 22.5 MB gzipped, packed in 6 s on a desktop, which the rules' limit of 200 pieces leaves
far behind. What is staged is the Team Rankings
JSON the browser would have written for the file (`teamRankingsJsonParts`), whichever backup it
was handed, so the server reads one format, with the very function a device reads it with; it is
staged as that text, in the parts it was written in, rather than turned into JSON a second time,
which would escape every quote in it at a peak a phone may not have. Then `backup.restore` names
the upload, and the server reads it back piece by piece, checks it against the record's
fingerprint, reads it (`readTeamRankingsFile`, `parseTeamRankingsJson`'s reading of the parsed
file) and writes it onto its pool as a device restoring the file writes its own
(`writeTeamRankingsBackup`, the archived tables with it where the file carries them;
`backupRestore.ts`). The edit run commits what that wrote as one save and deletes the upload. It
keeps Team Rankings as it stood, every part of it, marked as the area whole (`KeptPart.whole`), so
bringing that version back from the Cloud panel undoes the restore exactly: what the restore
replaced comes back, and a year, an archive or anything else it added goes, kept whole in its turn.
A file the copy already holds keeps nothing and saves nothing, so sending one again never pushes
out a version that differs. An upload not whole is `missing`, and one that is not what was
fingerprinted, not JSON, or not a Team Rankings backup, `refused`; neither saves anything, and the
upload is left, as is one whose restore never came: the nightly deletes any a day old by
Firestore's own clock (`sweepStaleUploads`), and says how many in its log. It is never taken back
by an Undo; the Cloud panel brings back what it replaced, for as long as that version is kept (six
versions at most, for 30 days at most, and each nightly refresh that changes anything keeps one).
The rules let the owner create a record and then its pieces, read them and delete them, each of
the shapes the server reads and never changed once written, and nobody else anything
(`firestoreRules.test.ts`); the server reads them as a service account the rules do not apply to,
and lists an upload's pieces by name alone to delete them. `editRun.test.ts` holds the restore to a
device's own restore of the same file, and the functions' smoke run holds a member's restore
refused.
