# The nightly, and the boards published after pulls and edits

_Part of the design documents; the map is in the repository's [README](../../README.md)._

## The nightly refresh on GitHub

The Refresh button, pressed on the cloud copy by one of GitHub's servers
(`.github/workflows/nightly.yml`, `scripts/nightly.ts`), so every device opens on
teams pulled overnight. It opens the copy with the Firebase key GitHub already
keeps for deploys (`FIREBASE_SERVICE_ACCOUNT`), through Firestore's REST API
(`firestoreRestStore`), which writes the same documents the app's SDK does and
replaces the manifest only if it is still the document it read: the commit
carries the read's update time as a precondition. A request Firestore turns away,
or the network fails, is asked again after 1, 2, 4, 8, 16 and 32 s
(`RETRY_WAITS_MS`): too many requests (HTTP 429) for any request, since nothing
was done; an internal error, a bad gateway, unavailable or a gateway's timeout
(500, 502, 503, 504), a failure of the network, and an answer cut off before its
end, for every request but the commit. Each of those can come after the commit
was made, and asked again it would read its own first try as another save, so a
commit is asked again only where the network failed it before it left (no
address for Firestore's host, or no connection to it), and one whose answer was
cut off after it said it was done is taken as done. A read, a piece's write and
a delete do the same however often they are made: a piece goes up under an
upload id nothing else writes under, and a second delete finds nothing. The
nightly of 5 October 2026 stopped on one 429 writing a piece of its first part,
and lost the night; that of 14 October stopped about nine minutes into
publishing the views on a failure of the network, and its log said only "fetch
failed". A request that still fails says what it was doing (writing a piece,
reading a document, committing a write) and the network's code (`ECONNRESET`,
`ENOTFOUND`), never which document (`FirestoreUnreachableError`), and every line
the nightly and the republish print of an error carries the code
(`failureWords`). GameChanger is asked through
the proxy's own handler in the same process (`scripts/handlerFetch.ts`), so the
run pays for nothing but GitHub's minutes. The day is the user's
(`TZ=America/New_York`), which is what the rota and the day log are kept in, and
nothing is installed: the app's own files run as they are.

On 29 September 2026 the rota was 15,793 teams. The dry run answered every one
of them in 27 s, filed and tidied them in 62 s, and was done in 101 s from
loading the copy, holding 3.5 GB at the end. A live trial of 50 teams then saved
into the copy, and the next dry run read the whole copy back.

A live run takes its turn at the refresh gate first ("Refresh now in the cloud",
`nightlyTakesTurn`): a refresh a member started from the Import tab and still under
way is waited for, looked at every 30 s for at most 45 minutes of the step's 85, and
then the nightly names itself in `ops/refresh` while it pulls, so a press meanwhile
is told the nightly is pulling. It gives the turn back once GameChanger is done with,
before the boards are published, and a turn it never gave back lapses after the
job's 90 minutes. Where the refresh it waited for logged today's levels, the
nightly's own rota then finds nothing due. A refresh still running after the longest
wait is let be and the nightly pulls beside it, which costs GameChanger the same
teams twice and the copy nothing; a gate that cannot be read or written is pulled
without, for the same reason. A dry run writes nothing, the gate included, and takes
no turn.

After its tidy it sweeps the copy for clubs plainly made up ("Clubs removed for
you"), on the pool as tidied, and the marks go in the same commit as the pull; a
night with nothing due sweeps alone, through the same tries and commit, and one
that finds nothing new writes nothing. A leg of Refresh now sweeps as the nightly
does; a leg of a pasted list never does, and a pasted list with nothing new to
pull writes nothing at all, so the night's refresh sweeps what the lists filed.

The log says what the tidy changed, a line for each step that changed anything,
in the tidy's own words (`describeTidy`), under how many passes it took, or that
it changed nothing; then the clubs the 40-run rule deleted and the games that went
with them, and beside that line the marks of clubs plainly made up the sweep put
on and still stand, and those it lifted, by GameChanger team
(`nightlyReport.ts`). A club the rule deletes loses its mark with it, so it is
counted once, on the deletion's line. The run hands back the tidy's counts, never
the pool it tidied, so nothing that names a club can reach the log. A night with
nothing to pull runs no tidy and says none.

Then, when the store holds a copy, as the views need it to, how much of the squad
year being played leans on a stand-in (`storedStandInLines`): of every game stored
for the year, the share with a club known only by name or a bracket slot on a
side, and the same of its played games, then the clubs known only by name by
where a pulled club of the name is and by why none was joined. The numbers and
their words are the model sweep's stand-in report (`standInReport`,
`standInShareLines`, `standInWhyLines`), which the model sweep now says through
the same functions, its output the same to the character on the seeded fixture.
It reads the stored pool, as the stand-in rule's readings of 28 October 2026 did
(28.4% of the year, 25.1% of its played games, "Placeholders"), not the boards'
pool the model sweep's own report reads, which adds League Standings' games and
leaves out the clubs taken off. The report's lists of the clubs holding the most
games are never asked for, and a count that fails says so on its own line and
leaves the night's colour alone.

Once the views are out, it says how the clubs are known (`clubCensus.ts`): how many
clubs the pool holds, how many carry one GameChanger id, how many several (squads and
seasons folded together), and how many none, the clubs known only by name and the
bracket slots apart; then the League Standings picks of a club, how many keep a
GameChanger id beside them (`TeamBase.scoutGcTeamId`) and how many do not, and of
those, how many name a club carrying exactly one. No device gives these seasons' old
picks one (a browser no member has signed in to stamps only its own, "How the two
modes connect"), so that is what a stamp worked out by the server over the cloud's
pool would give, and the rest wait for a person to pick the team again. A club's id
is the pool's own, and Start again mints every one afresh, where GameChanger's is
never another team's, so these say how much of what is remembered of clubs can be
followed by it. It reads nothing of its own: the pool is the store's, which the
views were built from, and the seasons are the documents the run's own reads
already brought back (`tapLeagueDocs`), so it costs no read; of those it keeps only
each team's pick and the id beside it, taken as each read comes back, rather than
holding the documents through filing, saving and publishing. Counts only, as every
line of the log is. What devices keep of clubs
(a watch list, saved fields, a look at My Team, a League team's club's place) never
leaves them and is not counted.

The memory the run holds is said after each step as the next begins
(`stageMemory`, `memoryUse.ts`): after loading the copy, asking GameChanger,
filing, tidying and sweeping, saving, publishing the views and, on the night it
runs, the week's re-measure, each with the most the process has held so far
(Node's `maxRSS`), then once more at the end as before. It was said only at the
end, which held 7,588.7 MB at most on 30 October 2026 against a heap of 12,288,
and a night that ran out would have said nothing of which step took it there.

What it replaces it keeps, as an earlier version of the copy: the cloud panel's
**Earlier versions** lists it, and **Bring back** undoes a bad night on every
device. Six are kept, for 30 days at most.

Then it publishes every board for members to read ("Views a server publishes"):
built from the pool it holds and the League Standings seasons (from their own
documents once there are any, "League Standings in the cloud"), under the copy
and version it saved, then a sweep of what readers can no longer be fetching
(`publishCopyViews`). It publishes only when the pool it holds is a copy, the
one it saved or, with nothing to save or nothing due, the one it read; never
after a run that ended without one, whose filing no copy has. The seasons are
read the way a backup file is, as a browser's storage reads them, and a League
Standings part that is missing, damaged or not seasons stops the publish. A
device that saves League Standings during the run deletes the pieces the run's
copy names; the run then says the copy moved on and publishes nothing, without
turning the night red, and the next run publishes. Views a newer build, newer
rules or a later day published first leave it green too (`publishFailedRun`), as
they do a rebuild: only servers publish views, so that is a deploy landing while
the run is on the build it checked out before, whose own functions, or the
republish after it, publish first. A season a newer build saved is not among
them, since a device of any build saves seasons. The copy's id and epoch are read
again just before each commit of the meta, after the uploads and on every retry
(`publishViews`'s `stillCurrent`): a copy deleted and started again during the
run is not theirs, and two copies have no order to keep the fresh one's boards
from being replaced; nor are they of a copy whose Team Rankings was started again
during the run, whose boards they would set back to the pool it emptied until the
start's own rebuild published over them. Either way its uploads are taken back,
nothing is published, and the night turns red, as the pull's own end does when it
finds the copy replaced.
The check and the commit are two documents, so a reset in the round trip between
them is the one window left. The publish refuses under any collation but
English, the order the members' browsers put tied rows in; the workflow pins
`LANG=en_US.UTF-8` rather than leave it to the runner's image (Node sorts in
English with `LANG` unset, `C` or `C.UTF-8`, and by the root collation with an
empty one). A dry run builds the same views, from the copy the pull would have
saved, writes and deletes nothing, and counts a piece the sweep would delete
once. A publish that fails says why on its own line and turns the night red,
after the pull's own lines; a sweep that fails once the views are out says so
under the counts of what was published, and turns it red too.

Once a week it then re-measures where a rating starts on the pool it has just
published from, the squad year whose boards hold the most games in the four weeks
before the week's Monday, League Standings' games counted with the stored ones, with
League Standings as the publish read it ("Where a rating
starts", `closedLevelWeekly.ts`), and only once the views are out: a publish refused
or stopped leaves no board built from any pool it could read. A live run re-measures
on the first night of the week (Monday to Sunday, the members' day the run started
on) that finds `live/closedLevel` older than the week's Monday, as of that Monday, so
neither a late start nor a failed night skips or doubles a week; a record it cannot
read leaves it to Mondays alone, and a dry run re-measures on a Monday only. It prints
the level read, its spread, the games, the clusters and the paired reading against
the level held, numbers only. A live run keeps the answer for the Model check card
(`live/closedLevel`) and hands the alarm step a word for whether a change is ready. A
dry run prints and keeps nothing. A re-measure that stops says so on its own line and
leaves the night's colour alone, since it is not the refresh's work. On the owner's
11 October backup it took 20 s and about 1 GB above the loaded pool, measured off the
runner.

On 3 October 2026 a dry run of 50 teams on the real copy built its 60 boards (20
pages, three halves each) in 5 s, after a 95 s pull. Their first publish would
have been 30 uploads, 3.2 MB gzipped, and a 13.1 KB meta, and the run, pull and
boards together, peaked at 4.1 GB of the runner's 16.

It is set for 04:17 UTC every night, which is 12:17 in the morning Eastern in summer
and 11:17 at night in winter, but a scheduled run starts when GitHub gets to it, and
GitHub starts this one four to six and a half hours late: between 08:32 and 10:52 UTC
on 16 to 30 October 2026, about 4:30 to 6:50 in the morning Eastern, every run of
them green and none dropped, so last night's games reach the boards around seven in
the morning. Set for 07:17 it began between 14:09 and 14:33 UTC on 6 to 9 October, so
moving it three hours earlier moved the start and not the lateness. The schedule is
left as it is: a run that started on time, before midnight Eastern in winter, would
miss the late West Coast games the late start catches, and each save's boards go
out within minutes anyway ("Boards after saves on GitHub"). A run by hand is **Actions → Nightly refresh → Run
workflow**, with `dry-run` (everything but the save, and what the save would
have been) or `live`, and a limit of teams for a trial. The log carries counts,
sizes and timings only, since this repository's Actions logs are public. A night
that fails is marked red in Actions, GitHub emails whoever last changed the
schedule, and the run opens an issue ("When a run fails", below). GitHub turns
off a public repository's schedules after 60 days with no activity in it;
**Enable workflow** on the workflow's page turns this one back on.

The log ends, dry run or live and however the refresh ended, with how the
rebuilds after saves have gone, read from their ledger ("Rebuilds after saves",
`rebuildReport.ts`) and never written: whether they are on and dry or live; the
runs of the ledger's day (the day of its last reserve, refused or not), how many
of them failed and the GiB-seconds they spent against the day's cap; the same of
the last day before it that had a run, since the nightly runs a few hours into a
New York day and a save just after midnight, or a day of refusals at a cap,
moves the ledger on; the month's runs, failures, GiB-seconds and vCPU-seconds
against its caps; the edits' own month; the questions the server spent compute on
and left unanswered, on the ledger's day and the last day before it that had any,
where there were some ("Questions to the cloud are going unanswered" raises its
alarm past 20 a day); then the failures in a row, a pause, and a run reserved and
not yet settled. A ledger that cannot be read says so on its own line and leaves
the night's colour alone, as do failed rebuilds: they are not the refresh's
work. This is what tells whether a week of dry runs went well before `mode` is
set to `live`.

Where the pulls run on GitHub (the workflow tells it whether the dispatch token is
set, `PULLS_ON_GITHUB`), no rebuild runs on Google, so a deferral of the rebuild
job is said as the boards' publish on GitHub having taken their place, which
publishes each save, and no save waiting for the date. Until 31 October 2026 the
line said of the deferral to 1 November "saves wait for then, or for a cap raised
in ops/rebuild", though no rebuild had run on Google since 13 October, and the
month's totals that deferred it were mostly the edits' and the questions' compute,
charged to the rebuilds until 16 October: at least 34,964 of the 49,543
vCPU-seconds, since the ledger's runs stood at 34 from 13 to 15 October while its
vCPU-seconds went from 14,566 to 49,530. What if and Model check, refused while the
month reads as spent, come back with the month. The caps are as they were.

## Boards published when a pull ends

Every pull ends by saving the copy: a pasted list's import, each part of a list
sent in parts, and "Refresh now". That save asks for a rebuild ("Views a server
publishes"), which puts the new teams and games on the boards within minutes, but
only while the rebuilds run. On 16 October 2026 they did not: October's budget was
spent, so every rebuild was deferred to 1 November, and the 125,954 teams of 2027
imported that afternoon showed "Nothing ranked yet" for hours. The catch-up on
GitHub (below) was meant to cover such times, but GitHub's schedule did not start
it once in the three and a half hours after it was merged, seven times due, and
it started the nightly four and a half hours late that morning.

So the end of a pull now asks for itself (`afterPull.ts`). Once an import's
worker has gone, or the last leg of a pull has run, whether it finished, was
stopped or failed for good, the cloud reads the copy's manifest, the published
meta and the seasons. Where the boards are behind the copy, it starts the
`boards-publish` job (`functions/src/boardsPublish.ts`, from the import's image,
at the rebuild's size, zone and collation). The job asks again and publishes as
the catch-up does. The decision is the catch-up's (`catchUpDecision`), with two
differences:

- **It does not wait ten minutes for the copy to be still.** The save it would
  wait out is the pull's own last.
- **It leaves the boards to a rebuild where one is coming** (`rebuildWillPublish`).
  That means the build deployed the rebuilds (`LIVE_REBUILD`), they are on and
  publishing, and either a run is open on the ledger, its budget reserved, or the
  ledger would let one start. Holding the
  rebuild job's control does not count by itself: a job claims it before it
  reserves, and one whose budget is spent defers at once and publishes nothing.
  Where a cap is spent, failures paused them for the day, or they are off or dry,
  no rebuild is coming, and the pull's end publishes.

It waits for the same writers the catch-up waits for:

- another import filing into the copy, or a "Refresh now" under way, whose own
  end publishes;
- the nightly pulling at the refresh gate.

It cannot ask GitHub whether the nightly is running.

The job runs once with no retries. A publish that fails is left to the catch-up
and the nightly, and it fails nothing of the pull, which is over. Two pulls ending
at once start it once (the lease, in "Boards published after an edit"), and one
that ends while a publish runs asks that publish to go again once it is done,
since it may have read the copy before the pull's save. The deploy
sets the job up whenever the pulls or the rebuilds are on, since both start it,
and runs it as the account that starts it.

The cost is part of the import's own. The catch-up of 16 October built the year's
66 boards in 31 s and published them in 86 s in all, on GitHub's four vCPUs. An
import of a list runs for hours at four vCPUs and 16 GiB.

Its lines (`boards-after-pull`, `import-boards`, and the job's `boards-publish`)
are counts and reasons only. **Actions → Pulls in the cloud** shows them beside
the importer's.

## Boards published after an edit

An edit is a save too: the edit function's own, for a club's panel, Pool health,
merges and ages, and a device's, for a League Standings score. Each asks for a
rebuild, and none reached the boards while the rebuilds were held, until the
catch-up or the nightly. Now a save the boards read queues a check of them where
no rebuild is coming to publish it (`boardsCheck.ts`). It is queued from the
copy's trigger and the seasons' (`onCopyWrite`, `onLeagueWrite`) on the
rebuilds' own queue, which tells a check from a rebuild's task by its shape.

- **One a minute.** All the saves in a minute share one check, under one name.
- **The settle.** A check runs three minutes after its minute ends
  (`BOARDS_SETTLE_MS`). It publishes only if the copy and every season have been
  still that long, a season's last write being Firestore's own time for its
  document. Every check before the last save's finds a save still settling and
  leaves the boards to it, so half an hour of clean-up in Pool health is one
  publish after it, not one an edit. Each publish builds every board of the year,
  about two minutes of an 8 GiB instance.
- **The lease.** One publish runs at a time (`publishLease.ts`, `ops/boardsPublish`).
  A launcher, whether a pull's end or a check, claims the lease before it starts
  the job, so two that ask at once start one. The job takes the lease over when
  it starts and lets it go when it ends. A launch that fails is tried once more,
  since other launchers may have asked on its claim, then lets the claim go.
  Any claim nobody lets go lapses: a launch's after five minutes, a job's after
  the job's half hour. A check that finds a publish under way asks again half a
  minute after the lease lapses, or after the settle at the latest, since that
  publish may have read the copy before its save. The launch's claim carries what
  its launcher asked, and the job asks the same when it asks again: an edit made
  between a check and the job's start is left to its own check, not published
  seconds old beside someone still editing, and the job asks again just before it
  loads the copy, for one saved after its own decision. A launcher that finds a publish
  under way asks it to go again, with what it asked, and the job finds that when
  it hands the lease back at its end: up to three rounds (`PUBLISH_ROUNDS`). Asks
  still left when the job ends, after its last round, a round that failed, or a
  hand back that lost every write to launchers asking at once, turn the lease
  into a launch's claim and start another job (`handOn`): the job never lets the
  lease go over an ask, and a job whose takeover lost to a launcher writing onto
  the claim reads it again and takes it over with that ask.
- **A season deleted.** A deleted season's document leaves no time of its own, so
  the seasons' trigger notes the deletion (`ops/leagueDeleted`), and the settle
  counts it as a save.
- **A rebuild that could not be queued.** A save whose rebuild the queue refused,
  or that the rebuilds, switched off, never asked for, queues a check of its own
  that counts on no rebuild, however much budget the ledger has left by then, and
  its job counts on none either.

The decision is otherwise the pull's end's (`afterPullDecision`): behind, nothing
at work on the boards, and no rebuild coming. A pull's own saves queue checks
too, which find the pull still writing and leave the boards to its end.

## Boards caught up on GitHub

A save's rebuild ("Views a server publishes") puts an import or an edit on the
boards within minutes, but only while the rebuilds run. Switched off, paused,
failing, or deferred to a later month by their budget (as they were from 14
October 2026, October's spent, until 1 November), a save reached the boards only
with the nightly, which GitHub starts hours late. A pull's end and an edit's
check now publish in those times ("Boards published when a pull ends", "Boards
published after an edit"); a publish that failed still waits for this. So one of
GitHub's servers looks (`.github/workflows/catch-up.yml`, `scripts/catchUp.ts`,
`npm run catch-up`), and publishes the boards where they are behind the copy and
nothing else is about to. It is set for every half hour, and GitHub runs it four
to eight times a day, two to eight hours apart (16 to 30 October 2026); on each of
those days the first run after 04:17 UTC came before the nightly, three hours
before it on average. Its rules are `catchUp.ts`'s, kept out of the script so
they are tested.

It reads three things: the copy's manifest, with when Firestore last wrote it;
the published meta; and the League Standings seasons' documents. The boards are
behind (`boardsBehind`) where nothing is published, where an older build
published them, where nothing vouches for what they were built from, where they
are another copy's, where a season changed since, or where a key the boards read
changed since (`boardInputsPrint`). A later version of the copy that moved nothing
a board reads leaves them current, as it asks no rebuild, and so does a new day:
yesterday's boards of what the copy still holds are the night's to build for
today, and a run that took the day for a reason would publish every board each
midnight. Boards a publish of this build would be refused over (a meta it cannot
read, a newer build's or newer rules', a later day's) are left as they are, and
so is a copy or a season a newer build saved. A run that finds the boards current
says so in a line and is done in the time those reads take.

Where they are behind, it reads what may be at work, and leaves the boards to the
next run where anything is (`heldBy`):

- **The nightly**, running on GitHub (the workflow asks GitHub for its runs not
  yet completed; a GitHub that does not answer is not waited on), or holding the
  refresh gate while it pulls. It publishes the boards itself.
- **A pull or an import that may write the copy**, found by one query for the
  pulls queued or running (`pullsUnderWay`) and counted while heard from within
  the two hours a refresh may go quiet and be alive (`pullWritesCopy`). "Refresh
  now", and a list sent before the staged importer, save the copy at the end of
  every leg, so any stage of one counts; the staged importer writes the copy only
  once its downloads are done, so its hours of downloading do not.
- **A rebuild after a save** holding its control document (`ops/rebuildJob`),
  launching or running, which publishes the boards itself; not one its budget
  deferred, which nobody holds.
- **A save less than ten minutes old** (`CATCH_UP_SETTLE_MS`), by Firestore's
  clock. An edit's rebuild is asked for within two minutes of it and holds its
  control document from its launch to its publish, so by then it has come or is
  seen running; and a burst of edits is one publish after it, not one beside a
  person still editing.

Running beside any of them would harm nothing, since every publish is made over
the meta as read and never puts back an older version; it would build the whole
pool for boards about to be replaced, or published anyway.

Otherwise it publishes as the republish after a deploy does (`republishViews`,
"Views a server publishes"): the copy laid into memory as a pull lays it, the
boards built and published under the copy and version read, held to that
version, and tried again on the copy as it then stands when a save or a season
moved it, three tries in all, asking before each whether the boards are still
behind, since a rebuild or the nightly may have published them meanwhile. It
sweeps as a rebuild does, only the retired pieces its own commit takes out, and
leaves strays to the night's full sweep. It opens the copy on the nightly's key
with only `live/` writable (`restServerStores`): it pulls nothing from
GameChanger, tidies nothing and saves nothing of the copy. It runs under the
nightly's day, collation, heap and Node (`workflowCatchUp.test.ts` holds the
workflow to them), and its log is counts, sizes and timings.

Its runs go one at a time, in a group of their own: a run waiting there is
replaced by the next, which reads everything afresh. It does not join the
nightly's group, where a run joining every half hour would cancel a night
waiting behind one. A publish that fails as the nightly's would
(`publishFailedRun`) turns the run red, which GitHub emails about; a copy or a
season saved during the run does not, and the next run publishes. It raises no
issue of its own ("When a run fails"): the next run tries again, within hours as
GitHub runs it, and a night that fails raises its own. A run by hand is **Actions → Boards
catch-up → Run workflow**.

## When a run fails

The nightly of 10 October 2026 failed at 03:52 UTC, and the owner learned of it
from a board nobody looks at. A run that fails now opens an issue on this
repository, which GitHub tells the owner of by email and, with notifications on,
on the phone (`scripts/alarm.ts`, `runAlarms.ts`). Each alarm keeps one issue:
a run that fails again comments on the one open rather than opening another, and
the first run that is fine closes it with a comment.

- **The nightly refresh failed**: its refresh step failed or was stopped (by
  hand, or by its 85-minute limit, which is short of the job's 90 so the alarm
  still runs), scheduled or by hand, dry run or live. Only a live run that
  succeeds closes it: a dry run saves nothing, so its success says nothing of a
  night that failed saving, as the night of 10 October did.
- **Publishing the views after a deploy failed**: the republish after a deploy
  (above, "Views a server publishes") failed or was stopped. The next republish
  that does not fail closes it, one that finds nothing to publish included, since
  the views are then of this build's schema.
- **The rebuilds after saves are failing**: the nightly, dry or live, read their
  ledger and found failures in a row or a pause (`rebuildsTrouble`). The first
  nightly to read none closes it, and so does one that finds them switched off,
  or no ledger at all: while they are off nothing of theirs runs, and no run
  clears the failures or the pause the ledger kept from before, so an issue left
  open over those would be commented on every night until the console was
  edited. A ledger the nightly could not read, or did not reach, leaves it as it
  is.
- **A new starting level is ready for leagues with few outside games**: a live
  Monday nightly's re-measure of where a rating starts ("Where a rating starts")
  found a level clearly better than the one held. It says the level read, the level
  held, the paired gain and its standard error, the games, and that the level changes
  only by a commit that raises `BOARD_RULES`. The first live Monday that judges the
  level and finds none clearly better closes it. A dry run, a night that did not
  re-measure, or a Monday too thin to judge leaves it as it is: one that read no level,
  or scored fewer than 30 games with the other weeks' level, as between seasons or in
  the first weeks of a squad year, before any fit has rated its clubs. It measured
  nothing that could say a change ready is no longer ready.

Three more, the owner's of 26 October 2026:

- **The GameChanger pull check failed** (`verify-gc.yml`): the check after a merge
  or on the week's Monday failed, or passed but found no score on games already
  played, the sign of GameChanger's score fields having moved (`resultWord`,
  `result=drift`). The next such check that passes clean closes it. A run started
  by hand may ask other teams or another proxy, and a run a newer push cancelled
  says nothing of GameChanger, so neither raises or settles it.
- **The project's billing is off**: the nightly, dry or live, read the project's
  billing from Cloud Billing (`projects.getBillingInfo`, free to ask, and nothing
  of the copy) with the deploy key, and found it off, which is what the cost cap
  does once the month's budget is spent (`billingCap.ts`). The first nightly to
  find it on closes it. A reading refused or not made leaves it as it is, and the
  log says why: the deploy key needs `resourcemanager.projects.get` on the project
  (Viewer, or any Firebase admin role) to read it.
- **The pull dispatch token is running out**: the nightly asked GitHub's
  `rate_limit`, which spends none of the token's allowance, with the
  `PULL_DISPATCH_TOKEN` secret, and GitHub's `github-authentication-token-expiration`
  header put its end within two weeks, or GitHub refused the token outright. It
  names the day; make another with the same access and replace the secret. The
  first nightly to find it good for longer, or with no end, closes it. With no
  such secret set the pulls start on Google's machines, and nothing is read.

And two on what a night saves, the owner's rule of the same day ("hold a save that would
remove more than 5% of a year's games or 2% of its clubs, and open an alarm issue saying what it
would have done"):

- **The nightly held a save that would have taken too much** (`blastRadius.ts`): before it
  saves, a live nightly weighs, year by year, the games and clubs of the copy as it read it that
  the pool as filed no longer holds anywhere; one moved to another year is not taken away, nor is
  a club known only by name whose every game the pool still holds, filed onto the club it named
  (tidy rules 33 retires thousands of those at once, near the 2% line). Past
  5% of a year's games or 2% of its clubs, and at least 50 games or 20 clubs, so a year of a few
  dozen games is never held for a pair of folded rows, it saves nothing, ends red, and the issue
  gives each year's numbers. The copy stays as it was, its views unpublished, for a person to
  look at what GameChanger answered. The next night that saves, or has nothing to save, closes
  it. A pull a person starts saves what it files: the cap is the unattended night's.
  The games that go with a club the owner's 40-run rule deletes (below, `lopsidedDrops`) do not
  count toward the games' line, since that is the rule at work and not an answer gone wrong; the
  clubs themselves still count toward the clubs' line, so a sweep gone wrong is still held. Lists,
  the miner's hand-offs among them, never sweep, so the nightly meets every year they bring in
  first: on 31 October 2026 it held its save, night after night, for the 1,646 of 2026's 16,036
  games the rule's 40 deletions in that year took with them (a research read that day found the
  tidy alone took nothing, and the rule 53 clubs across every year, all pulled). The night's log
  says how many clubs the rule deleted and how many games went with them, counts only.
- **The nightly's answers stopped reading as schedules** (`ingestCanary.ts`): of the games
  GameChanger listed that night, fewer than half could be filed, out of 500 or more. A cancelled
  game, or one with no date, is a few in a hundred; a change in how GameChanger writes a game
  reads as nearly all of them. The pull check above catches the score fields moving on one known
  schedule; this one, across every answer of the night, reads only what the run already has. The
  next night that reads as usual closes it.

Both are a live run's alone, handed over as words with numbers only (`held=none`, or `held` and
`2027:60/1000:3/100` a year; `ingest=fine` or `drift` and read/listed), which the alarm reads back
as numbers and writes again in its own words.

The two before them are read by their own step before the alarm (`scripts/upkeep.ts`),
whatever became of the refresh, which hands each as a word (`billing=on` or `off`,
`dispatch=fine`, `refused` or `expires` and a day); it never fails the run, and it
prints neither the key nor the token.

And one on the cloud's questions, the owner's of 31 October 2026:

- **Questions to the cloud are going unanswered** (`unansweredWord`): the nightly, dry or live,
  read the ledger it already reads for the rebuilds and found more than 20 questions in a New York
  day that the server spent compute on and could not answer (`dayUnanswered`, counted in the
  write that charges each, "Rebuilds after saves" below), on the nightly's day or the day before:
  the day before is kept as `lastUnanswered`, since a question charged after midnight moves the
  ledger on before the nightly reads it. A device asks such a question again on its own at most
  three times a season a day (`useScoutBridge`), so that many is a server that cannot answer, a
  worker out of memory say, and not one member's bad minute. It says the day and the count, handed
  over as `unanswered=over` with them, or `fine`. The first nightly to find neither day past 20
  closes it; a ledger not read, or not one this build reads, leaves it as it is, and a day before
  the day before was judged by the nightly after it.

And one on the nightly's memory, since a night that runs out says so only by failing:

- **The nightly is near the memory it may use** (`memoryWord`, `memoryUse.ts`): a live nightly's
  peak (`maxRSS`, the whole process) reached three quarters of the most it may use, the heap Node
  was given (`heap_size_limit`) or the runner's memory where that is less. The nightly holds the
  whole pool at once, so its peak grows with the pool: 7,588.7 MB on 30 October 2026 and 8,077.1
  MB on 6 November, against a heap set at 12,288 MiB, which Node 24 reads as 13,086.2 MB. Three
  quarters of that is 9,814.7 MB, about three and a half weeks off at that week's growth, with a
  quarter still to grow into when the issue opens. It says the peak, the most it may use and the
  share, handed over as `memory=near` or `fine` with the two in whole megabytes, and what to do:
  the heap `nightly.yml` sets, a runner with more memory, or less of the pool held at once. The
  first live nightly under three quarters closes it; a dry run, which saves nothing, and a night
  that stopped short of its end, which peaked short of a whole night, leave it as it is.

An issue is public, as the repository is, so it says when (UTC, to the minute),
what failed in a word or two, and the run's link, and nothing from the log. The
words are fixed in `runAlarms.ts`, which works out what to raise or settle from
the run step's outcome and the words the nightly hands over: the rebuilds'
(`rebuilds=paused`, `failing`, `none` or `off`), and on a Monday the starting
level's (`closedLevel=held`, `unjudged`, or `better` and five numbers, which it reads
back as numbers and writes again in its own words). It is tested; the workflows
only run `npm run alarm -- nightly`, `-- republish` or `-- verify-gc` as their
last step, whatever came before. It runs `gh` with the run's own token, which the
workflow lets write issues and nothing more (`permissions: issues: write`). An alarm
finds its issue again by its title among the open issues a workflow opened; one
anybody else opened under the same title is theirs, and is neither commented on
nor closed. An alarm that could not be raised (issues turned off on the
repository, say) marks its own step failed, and the others are still tried, but
it leaves the run as its work left it (`continue-on-error`, held by
`workflowAlarms.test.ts`): a night that saved stays green, and GitHub does not
email that it failed for want of an issue, while a night whose refresh failed is
red from that step already.

The catch-up between nights ("Boards caught up on GitHub") raises no issue: a
publish of its that fails turns its run red, and the next run, within the half
hour, tries again.

A run whose checkout failed raises nothing: the alarm is a script it checks out.
Its work's step is then skipped, which the alarm would call "did not start", but
only where it can run at all, after a failed setup of Node on a runner whose own
Node runs the script. GitHub's red run, and its email, is the only word of it.
