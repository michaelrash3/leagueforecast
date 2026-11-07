# Pulls in the cloud and on GitHub

_Part of the design documents; the map is in the repository's [README](../../README.md)._

## Pulls in the cloud

A pull can run on the cloud copy rather than in a browser tab
(`src/lib/cloud/cloudRunner.ts`): no tab has to stay open for an hour, and a
device finds the pulled teams in the copy the next time it looks. It is the
pull the browser runs, not a second one. It reads the copy's Team Rankings into
the app's own pool store held in memory, as a device taking in a copy does;
asks GameChanger for the teams through the same client, at the same pace (8
requests at once, growing to 24 while nothing pushes back); and files every
answer through the same importer, with the same things the pasted list knows
about a team (`withListed`) and the same answers the copy holds: the names the
owner has said are not a club (Not this team) are handed to the importer and to
the tidy, as the pull panel and the page's tidy hand them, so the nightly refresh
and a pull in the cloud never file such a name onto that club again. Then it runs the same whole-pool tidy, stamped so
no device tidies it again, saves the pool the same way (`persistPool`), and
keeps the same lists a pull ends with (`settleRunLists`): the teams waiting on
an age, the teams turned away, the too-young, and the invented clubs thrown
out. A list is filed only in the squad years it was sent for, and a club the
copy has thrown out is never asked about. The Refresh rota is worked out as the
button works it out, from the copy's own cadence, day log and waiting list
(`storedRota`), and the day is logged only when every team due was asked about.

It sends back only the values whose content changed, compared with what it read,
field order aside: the same age group made by the importer and read back
through storage lists its fields in two orders, and compared by the stored
fingerprint alone, a pull that changed nothing sent the age groups again and
every device took a copy that was not new. League Standings and archived
seasons are never written, nor loaded into the pool. League is read once, as the
boards read it (its seasons' documents, or until there are any the copy's own
part), only for the import and the tidy to spare every club a League Standings
team links; a run that cannot read it deletes no page by its name rather than one
a season's pick leans on, and takes no game off a row its import turns away for a
word in the name (`realClubsShort`), since the row may name such a club. A copy
saved by a newer build, or tidied by newer rules, is left alone.

GameChanger is asked once. Where another device saved while the answers were
coming in, the copy is read again and the same answers filed onto it, so the
device's change is built on rather than written over: a club it threw out in
the meantime is not filed. A copy that keeps moving through three tries is left
as it was, with nothing of the run's left in it. A copy deleted and started again
meanwhile is a different copy, somebody's fresh start, and nothing is filed into
it; nor into a copy whose Team Rankings was started again, brought back or
restored meanwhile, which keeps its id and has a new epoch (see "How it is
stored"): the run ends as replaced, which fails a cloud pull's job and turns the
nightly red. A job of several legs keeps the copy and epoch its first leg read
(`PullJob.on`: the copy Refresh now's teams were worked out from, or the one a
list's first share was filed into), and a later leg that finds another asks
GameChanger nothing.

## A pasted list, pulled in the cloud

A member hands a list to a Firebase function from the live page's Import tab and
may close the tab (1.8): a member's device holds no pool to pull into, so this is
how a pasted list is pulled at all.

**On the page** (`LiveCloudPulls.tsx`, `src/lib/cloud/cloudPulls.ts`). The paste
box reads a list or a spreadsheet export as the device's own pull panel does,
leaving out wiffle ball and softball, high school squads and adult or college teams,
which cost no request. A page whose name says it is no team is sent marked with the word it hit,
and the cloud asks about one only where it may be a club the owner vouched for: one the real list,
the user's own club or a page's own team vouches for, counted as any row, or one carried by a club
of the pool that only League Standings could vouch for, where a page plays in a League season,
sent uncounted for the import to settle (`listIds`). Before it is sent, it says how many of the ids do not have the shape
every GameChanger team id seen so far has, twelve letters and digits
(`isWellFormedGcTeamId`): slugs and names a list carries where an id should be,
which GameChanger answers with HTTP 400; and how many lines named no team id at
all. Two more buttons appear when the server's import status names teams
for them: the teams nobody could age, asked again on a catch-up day, and the
GameChanger pages playing this season whose roster is short and due a look. Those
two are catch-ups: their teams are pulled again whether or not the pool has them,
filed in the season being played alone. Each pull sent is remembered on this
device until its end has been said once, read again every 15 s while one is on
its way, and can be asked to stop.

**A list in parts.** One job holds at most 50,000 teams (`MAX_LIST_TEAMS`). On
12 and 13 October 2026 lists of about 450,000 teams were pasted whole, and they
overwhelmed the pulls: one, sent as eighteen parts, still said "part 9 of 18,
stop asked" days later, and the importer's final phase is one long step that
cannot pick up where it left off. A longer paste is still pasted whole: before
it is sent the card says it will run as so many parts of up to 50,000 teams,
one after another, and the page then cuts it, in list order, into parts of
50,000 and the rest (`listParts`; 100,001 teams are 50,000, 50,000 and 1). Each
part is a job of its own carrying its place in the list (`PullJob.chain`: the
first part's id, which names the whole list, the part, the parts, the whole
list's teams, and the next part's job). The parts are written last to first, so
every `next` names a job already there, and only the first is started. When a
part is done, the cloud starts the next through the same start a device's ask
goes through (`startNextPart`, then `startPullJob`), and only while that part is
still queued and not asked to stop; the staged importer's supervisor asks once
its execution has finished, before it clears the part's staging data, and the
older runner's last leg would too. That is the finishing code rather than a
Firestore trigger on `pullJobs/{id}`: the supervisor already reads the job when
its worker ends and runs as the pulls' account, which queues tasks (the rebuild
job queues its own from Cloud Run the same way), where a trigger would wake for
every heartbeat of a running import to act on one write, and would need the
pulls' account to receive Firestore's events. A part that fails or is stopped
starts nothing after it. Whoever asks, `startPull` starts a later part only once
the part before it is done, since a tab still running a page from before the
split (a new version waits to be let in) takes each part for a list of its own
and asks for it every minute; and the cloud touches the part it starts, so no
device's ask ends it as one nothing started in the hour, which such a tab,
timing the hour from the sending, would otherwise do in the minute before the
importer first writes to it.

The card shows a list in parts as one line: the whole list's teams, the part
under way and how far it has got, the parts done and the parts waiting their
turn; when its last part is done, one end line for the whole list, with what
every part filed added up; and where a part failed or was stopped, which part,
and that Resume carries the list on from it. Stop on the line asks every part
not yet ended to stop, the parts after it first, and asks about each part that
never started, which cancels it; Dismiss does the same for the parts after the
one gone silent. Resume on a part puts the parts after it that were stopped
with it back in the queue, so the list carries on once that part is done. OK
tells of every part at once. Each part keeps its own skipped-team report, and
the line offers every part's that skipped a team ("Download skipped teams of
part 1"), so an earlier part's skips are not lost once a later part is under
way or the list is done. A device asks the cloud to start a later part
only once the part before it is done (at once, then each minute while nothing
has touched it), so a supervisor lost between finishing one part and starting
the next stalls nothing while a tab is open, and two parts of one list never
run at once; its wait is counted from when its turn came, so a part that
waited hours behind the parts before it is never ended as one the cloud left
waiting. Refresh now does not wait on the parts of a list halted at a part that
failed. Sending the same list again finds its parts by the whole list's
fingerprint and acts on the first part not done, as on a list sent whole:
started if queued, resumed if it failed or was stopped, left alone while under
way; a list an older page sent whole, longer than one job takes, is sent afresh
as parts, and so is a list whose part ended because Team Rankings was started
again, since resuming that part would only end it so again. A start of Team
Rankings asks every queued part to stop along with the rest
(`stopPullsUnderWay`), so no later part of a list starts after it. `startPull` still refuses to start or resume a single job longer than
50,000 teams, which only a tab running a page from before the split can send,
so every part is held to the cap.

**What the cloud pulls of a list** (`cloudRunner.ts`, `listIds`). Never a club
refused for good or as another season's, nor one too young to rank. An id
GameChanger answered with HTTP 400 is `invalid-id`, final, and kept with the clubs
refused for good by the run that filed the list (`rememberRefused`), so the next
paste of it costs no request; a run that filed nothing remembers none, so a route
that refused every id alike is never taken for a list of non-ids. Of a paste,
only the teams the pool lacks, or a handful pasted by hand with none new, which
is how a schedule that changed today is read before the rota comes round; the
rest of an export is the nightly's to refresh. A catch-up pulls every team on it.

**The job.** The device writes the list in a collection of its own, outside the
copy, which only servers write (`src/lib/cloud/pullJobs.ts`):

- `pullJobs/{jobId}/pieces/{n}` holds the list's pieces, gzipped and
  fingerprinted as the copy's values are, so a list is never pulled half from one
  upload and half from another.
- `pullJobs/{jobId}` holds the job, written last. It carries the squad years to
  file into, whether it is a catch-up, the device's time zone (the day the
  importer and the day log keep, since Google's servers keep their own), and
  everything the device shows while it waits: the stage, the teams asked so far,
  and the tally.

The rules let a member make a job as a new one is made (queued, no leg run, no
stop asked) and its pieces, read them, and change one thing of a job once made:
ask it to stop. Members may list the latest 20 jobs; browsers delete none.

The device then calls `startPull` with the job's id. That function is for the
accounts on the copy's list, as the copy is, checked as the proxy checks them
(`memberCheck.ts`), and queues the job's first leg.

**CSV imports.** New list imports run as the `team-import` Cloud Run Job. `runPull`
launches it and returns immediately; the import is not tied to a 30-minute HTTP request.
It reads only team identities, the pages, exclusion lists and the clubs said to be real to select downloads, then keeps
hash-checked compressed checkpoints in `pullJobs/{jobId}/artifacts`. Download batches
contain 10,000 teams. Every 2,000 completed answers is saved as a checkpoint while the
rest of the batch continues downloading; downloads do not pause to wait for each save.
Saved-download counts advance after those writes complete. Existing 2,000-team
checkpoints keep their identities when an older import resumes with larger batches.
Checkpoint answers retain the selection order even when downloads finish out of order.
Clean download concurrency carries forward between batches; GameChanger pushback
lowers it rather than restarting at full speed.
A download that fails for a passing reason (GameChanger throttling, a timeout, a
dropped connection) is tried twice more within its batch (`IMPORT_RETRIES`), and a
throttle holds every worker back, for as long as GameChanger names or, when it names
nothing, for the client's own next backoff: from 12 and 13 October 2026 each team was
asked once and every throttled one skipped on its first answer. Not found, not a team
id and an upstream error are final. When every batch is in, the downloads that still
failed for a passing reason are asked once more, before the final phase, and their
checkpoints and report saved again; a checkpoint says it was done, so a restart does
not ask them a third time. Failed downloads are counted as skipped, and the import
continues with the remaining teams; they do not consume Cloud Run execution retries or
hold up the final tidy. Progress distinguishes downloaded, skipped and remaining teams,
and the skips apart: those for now, which a later paste asks again, those GameChanger
answered with an error (of which only "not a team id" is remembered, so neither count is
called skipped for good), and, on a list an earlier run started, the failures of that run.
Warning logs record counts and failure reasons only, never a team's id, GameChanger
address or body: the pull-status workflow, whose log is public, reads them back. The teams
themselves, with what was said of each, are in the skipped-team report below.
Resuming an older incomplete batch keeps its successful downloads, skips its recorded
failures and asks only for teams that had no answer yet, then asks its passing failures
once more with the rest.
Checkpoint pointers include small, validated count summaries, so a restart counts
completed downloads without reading their schedules. Older checkpoints gain summaries
after their first verified read.

Once all downloads are accounted for, it loads the latest pool once and streams
saved schedules through one importer. Opponent matches and ages are settled before
one final tidy phase and one commit. Clubs skipped before their opponents arrived
are reconsidered in their original order. Age passes keep a bounded prefix of unresolved
schedules in memory (up to 2,000 teams and 32 MiB); any remaining unresolved teams read
only their relevant saved checkpoints. A concurrent save can require a rebase,
which uses those downloads again; a replaced copy is never overwritten. The teams are
chosen once, and the plan keeps the copy and the epoch they were chosen from
(`selectImportTeams`): the final phase files nothing into a copy whose Team Rankings
was started again, brought back or restored since, and an import resumed or retried
with its plan in hand checks the copy before downloading another team, ending at once
with the reason (`IMPORT_NOT_FILED`) rather than after every batch. The commit
asks the existing rebuild trigger to publish rankings once.

An execution lease prevents duplicate workers. A supervisor keeps a heartbeat alive
while its worker matches and tidies; progress timestamps and tidy-step details are
separate. Cloud Run retries interrupted executions from checkpoints, without fetching
teams that already have a success or failure recorded. Stop keeps checkpoints and leaves
a partial pool unpublished. Resume continues the same job. Stop during the final commit
waits for that commit, and an import that then finishes stays finished (`importStopsNow`):
until 17 October 2026 the stop was carried out after the save, the finished import written
over as stopped and its downloads deleted as a finished one's are, so Resume downloaded the
whole list again. A try that fails after Stop was pressed, a hung save among them, ends as
stopped rather than failed (`importTryStatus`). When Cloud Run ends an execution (a cancel, the task's time
limit), its SIGTERM is taken as a failure of that try: the job is written back to
waiting with the reason, failed on the last try, and the lease let go before it exits.
A worker that hangs while its supervisor beats on looked alive for as long as Cloud Run let
it run, the task's 24 hours and twice more on the retries, billed at 16 GiB throughout. Now
a worker that says nothing for half an hour (`IMPORT_STALL_MS`, `importBeat`) has its try
ended the same way, as stuck, and the next try or Resume carries on from the checkpoints.
It speaks at every stage, every checkpoint of downloads, every batch it files and every
step of the tidy, and GameChanger's holds are capped at a minute; a whole Refresh now leg of
15,240 teams on 16 October 2026 took 416 s, so a hung import now costs at most an hour and a
half over its three tries rather than three days.

**A pull gone silent.** A worker can still die without a word, its container killed
with it, and its job then said "running" for good: one of 12 October sat at "part 9
of 18, stop asked" for days, Stop already pressed and nothing else to press, and held
Refresh now off behind it. Now any ask `startPull` gets about a job first ends it if
it is dead (`reapPullJob`): a staged import nothing has been heard from in five
minutes and whose lease nobody holds, or a job of the older runner nothing has
written in two hours (`LEGS_SILENT_MS`, the refresh gate's own quiet), as failed, or
cancelled where a stop was asked, and only while it is still as read. A line on the
page that has heard nothing for five minutes offers Dismiss, which asks the cloud
about the job and stops showing it on this device; a staged import also offers
Resume, which launches it again from its checkpoints; and Stop on a silent pull asks
the cloud at once. Refresh now no longer waits on a list's pull gone silent. Resume
says why when the cloud refuses it.

That still waited on a device to ask, and the device that sent the 12 October list
no longer showed it, so it said "running" on 16 October too. Now the cloud ends every
dead pull on its own rounds (`reapSilentPulls`, `functions/src/deadPulls.ts`): every
ask `startPull` gets, whatever it is about (a press of Refresh now among them), the
end of every pull, and every check of the boards a save queues. Each is the same
one-query read of the pulls that say they are running, waited on for a few seconds
at most where its caller has a deadline, and ending nothing once that time is up
(`reapSilentPullsWithin`): a write already sent is waited for, and none is sent
after, so no pull ends behind a caller gone on to ask about the boards, which would
have found it still running and left them. A job of the older runner between legs
waits in the queue behind every other pull's legs, three at a time and with no bound
on how long, so it is taken for dead only once no running job of that runner has
been heard from in two hours either (`legsLastHeard`), and not on a round that
could not read one of them.
The job `startPull` is asked about is ended on its own first, as before, and the
sweep leaves it alone, since a Resume may be launching it again meanwhile. At the
end of a pull and in a save's check, the sweep runs before the boards are asked
about, so a dead import still taken for one filing into the copy does not hold
them back. Its lines say only how many it ended.
Failed or stopped legacy list imports can resume with the staged importer, preserving
previously filed work. Budgeted refresh jobs retain their existing leg sizes and caps.

The Firebase deployment workflow builds and deploys the job before deploying its
launcher, using the existing project, deploy key and runner account. The job has
16 GiB, four CPUs, one task, two retries and a 24-hour task limit. The runner gets
execution-with-overrides permission on this job alone. Successful imports delete
their staging data; abandoned checkpoints expire after seven days through Firestore
TTL. There are no import functions on Vercel.

The browser retries transient upload, start and status failures with bounded backoff
until confirmed. Repeated uploads reconnect to the same import on that device.
The Import page also lists the latest 20 cloud jobs, so another signed-in device
can see their progress, and links to Cloud Run execution details.
Progress also shows overall download counts and percentage, measured teams per minute,
time in the current phase, numbered age passes and intentional GameChanger waits.
Members can download a CSV of skipped downloads and teams not filed, including their
reasons. The report is available during an import and after completion; its hash-checked
chunks are stored separately under `reports` and `reportChunks`, survive schedule cleanup
and expose no raw schedules. Browser clients can read these report documents, but cannot
write them or read the private download checkpoints.

**Legacy and refresh legs.** Older list jobs and budgeted refreshes still use
`pullJobRunner.ts` and `runCloudPull`; their frozen leg counters are not silently
reinterpreted. Stop an old list job before choosing Resume with faster importer.

**Three legs at once.** Up to three legs run at once, each on an instance of its
own with 8 GiB and two processors, so a pull sent while another runs starts as
soon as it is queued rather than waiting out the other's leg: on 11 October 2026
two catch-ups sent beside a 9,270-team pull waited behind it, and a leg took 199
to 379 s. A job's own legs are never at once, since each queues the next as it
ends; legs of two jobs that save together cost the later one a second filing onto
the copy as the other left it, never a lost save. Each leg runs in a worker thread capped at 5,120 MB of heap, which
leaves the rest of the 8 GiB for the bytes a heap does not count; on GitHub, where
the legs run now, 12,288 MB of its 16 GB ("Pulls on GitHub", `legHeapMb`). A heap failure is
reported by the worker; total instance memory still has its own limit. The worker
has a 29-minute-30-second request budget inside the task's 30 minutes, including
startup, and the parent waits for it
to terminate before returning or retrying. Its error is recorded on the job on
every try, so the progress line can say it is waiting to retry. Hashing the copy
happens before building the loaded pool, reducing temporary memory during loading.
Before starting the worker, the function sets the job's
time zone: a worker cannot change its own zone, but one started after its parent
changes it keeps the new one.

**Sent twice, run once.** A leg's task is named for its job and leg, so queueing
it twice queues it once. A leg the job already counts as done does not run
again, and if a leg's reply was lost before it queued the next, the next copy of
it queues that one.

**Stopping and failing.** Every ten seconds a leg writes how far it has got and
looks for the device asking it to stop. When it is asked, it files what it has
fetched, saves, and queues nothing more, and the device's line says it is saving
those teams. A stop that comes while the leg reads the copy ends it at the next of
the copy's values, and one that comes before any team answered ends it at once,
with nothing to file or save: on 11 October a pull stopped within a minute or so
of starting ran 379 s and filed nothing, the stop read only once GameChanger was
to be asked and the whole pool tidied after it for no answer at all. If GameChanger stops answering, the job
ends after that leg, with what came saved. A leg that fails is tried twice more,
two minutes apart and then longer. On the third failure the job is marked failed
with the reason, whether the leg could say so itself or its worker died first.
Some jobs fail at once, with nothing tried again:

- a list whose pieces do not unpack;
- a copy saved by a newer build or tidied by newer rules;
- no copy at all.

**A pull that never starts.** On 10 October two catch-ups sat at "waiting to
start" for hours: their start had failed in a way the device took for an answer
that may have started them, and nothing was left that would ever run or end them.
Now no failed start is silent:

- The pulls run as the rebuilds' account where the rebuilds are set up (the
  one-time setup, below), the account every rebuild's task already runs as.
- `startPull` ends a job it cannot queue with the cloud's own words for why (a
  missing grant reads as Google says it, "lacks IAM permission …") and refuses
  with them, and the device says so at once. An error the function did not mean
  to throw, or a job it cannot find, is said too, since neither queued anything.
- An unanswered start is asked again at once. A list still queued that no leg has
  written to is asked about again every minute while the Import tab is open, with
  how long the device has waited by its own clock. The ask queues it afresh if its
  first start never did, and says why if it cannot.
- A job whose first task was made but that no leg has touched in an hour is ended
  with a reason, since Cloud Tasks will not take its task's name again: the queue
  paused, or every delivery refused. A leg takes minutes, so an hour is far past a
  job waiting its turn.
- A start ends a job only while it is still as the start read it (written at the
  update time it was read at, with the same status, stamp and stop), and a leg
  marks a job running only while it is still as the leg read it; a leg that finds
  a Stop pressed in between cancels the job before asking GameChanger anything. So a leg starting just as a start gives up on its job
  keeps running and is not told to be sent again, and a leg that read a job a start
  then ended stands aside rather than running it after all.
- Stop on a pull that never started asks at once, which cancels it, since only a
  running leg reads the stop. The line says how long a waiting pull has waited,
  and what its last try said if a leg failed before it could start.

**Seeing where each one is.** What a device shows as "waiting to start" or
"stopping" is the job's document, which only the leg running it and a start
write. When a line does not move, the "Pulls in the cloud" workflow, run by hand
from the Actions tab, says what the cloud itself has (`npm run pull:status`, with
the deploy key, read only):

- each pull job of the last three days, and any not over: its status, stage, stop,
  when it was made and last written, and its error;
- each Cloud Tasks queue (whether it runs, how many at once, its tries) and every
  task waiting in it, with how often it was sent and how its last try was answered;
- what `startPull`, `runPull` and their queue logged in the last hours, requests
  by their answer and time taken only.

It runs where the log is public, so it cuts each job's id to six characters and
takes out any address but a service account's. Nothing about a team is printed
either: a structured line loses its `teamId`, `url` and `bodyPreview` fields at any
depth, and any text loses a GameChanger address and anything shaped like a team's
id (twelve URL-safe characters with a digit, or a capital past the first). The
import job used to log a sample team per failure reason, with the address asked
and the start of the body that came back, and lines it logged then can still be
in the hours read. A part the key may not read says
so, and the rest still prints. The deploy account reads the queues as the pulls'
setup made it, but lists the tasks in them only with Cloud Tasks Viewer, which
one paste in Cloud Shell grants; without it the queues are said, their tasks are
not:

```sh
PROJECT=your-project-id
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member "serviceAccount:github-deploy@$PROJECT.iam.gserviceaccount.com" \
  --role roles/cloudtasks.viewer --condition=None > /dev/null
```

**Cost.** The project's budget is a dollar a month with a hard stop (below).
Google's published free tier for functions gives 360,000 GiB-seconds and 180,000
processor-seconds each month. A three-minute leg on 8 GiB and two processors
spends about 1,440 of the first and 360 of the second. So a 250,000-team list, ten
legs, should stay well within it. That is worked out from the published tier, not
measured on this project; the first real pull's usage will say.

## Refresh now in the cloud

The nightly refresh, run by a member's press rather than by GitHub's clock: the
live Import tab's **Refresh now** starts, in the cloud, the refresh the nightly
would run at that moment, and the page can be closed meanwhile. It is a pull job
like a pasted list's, run by the same legs, and needs nothing of the project the
pulls in the cloud do not already have.

**On the page** (`LiveRefreshNow.tsx`, in the nightly card). Before the press the card
says what it will pull, from the import status the card already reads: "Refresh now
pulls today's refresh in the cloud now rather than tonight: about 120 teams", or, once
today's levels are done, "Today's refresh has run. Refresh now pulls today's levels
again in the cloud: about 12 teams", with how many wait for having been pulled in the
last 16 hours; for tonight's refresh the card says that once, above the button, in the
line it always had. The button is off, and says why, while edits are locked (the lock's
own words), with nobody signed in, while a refresh or a list this device sent is on its
way, and with nothing to pull; the reason is the button's own description
(`aria-describedby`), so a screen reader on the button hears it. A server from before
the button sends no count, and the card offers none. A press keeps the button off,
"Starting…", from the moment it is made until the list of watched pulls has been read
after the cloud's answer: back on in between, a second press reached the cloud and was
told this device's own refresh was "already running". A press's job is watched as a pasted list's is: the tab lifts the
watching out of the pull card (`useWatchedPulls`) so both cards read one list, and the
refresh is told in the same lines (`PullLines`), "Refreshing 118 teams in the cloud:
asking GameChanger, 40 of 118", with Stop, and its end once, with OK, after which the
status is read again. A press the cloud answers with a refresh already under way, this
device's or another's, watches that one and says so, for as long as one is under way;
one it refuses says why, until the status is next read; one it does not answer is not
remembered, since there is no job to watch, and pressing again finds the one it
started, if it did. What a press did is said in live regions drawn before it was made,
the lines' and the note's, since a screen reader may not read out a region that
arrives already holding its words.

**What it pulls** (`refreshNow` in `storedRota.ts`). While today's levels are still
to do, what the nightly would pull now (`storedRota`). Once they are done, those
levels again, as the device's own button runs a finished day again (`force`).
Either way held to the gap that protects GameChanger: a team pulled within the last
16 hours (`MIN_PULL_GAP_HOURS`) with no game yesterday, today or tomorrow waits, so
a second press the same evening asks again only about the teams playing. Clubs
thrown out are left off, as the pull would skip them. The card's count is this same
call, made by the server for the import status, so the number on the page is the
number pulled, as of that moment.

**The job** (`pullJobs.ts`, `pullJobRunner.ts`). The device sends no list: it calls
`startPull` with `{ refresh: { device } }`, read exactly (a device's name, and
nothing else), and the server makes the job itself (`newRefreshJob`, carrying
`rota`). The job keeps New York's day (`REFRESH_ZONE`), whoever pressed, as the
card's count, the nightly, the day's budget and the refresh log all do; a list's job
keeps its device's. Kept in the pressing device's zone, a refresh pulled another
day's levels than the card offered wherever the two days differed: on the rotation,
a member in Chicago pressing in the hour after New York's midnight got the previous
day's levels, and a browser reporting UTC that pressed on a New York evening logged
every level as refreshed tomorrow, so that night's nightly found nothing due
(`pullJobRunner.test.ts` presses at nine on a Sunday evening in New York, Monday in
UTC). Its first leg loads the copy and works the teams out (`workOutRefresh`), then
keeps them as the job's list, its pieces first and the job last, as a device leaves
a paste. Every leg after, and the first tried again,
walks that list and never works it out again: worked out leg by leg, a refresh of
today's levels run again would find the teams the legs before it had just pulled
held back, and those playing due again, leg after leg. A team the copy says was
pulled after the refresh was worked out is not asked about again, since that pull
came after the press: so a leg tried again after its save landed, when the job could
not then be told (its update, or its worker, failing between the two), asks
GameChanger nothing about the teams that save holds, where it once asked about every
one of them a second time minutes later. The last leg logs the levels
refreshed in the copy's refresh log, as the nightly does (`markRefreshed`), only
where it asked about every team, on the day the refresh was worked out for, and
never moving a level back to an earlier day than the log already has, so a refresh
that ends after midnight neither tells the next day's nightly its levels were done
nor undoes that nightly's mark. With nothing to pull the job is done at once and
logs nothing, as the nightly logs nothing when nothing is due. Filing, the tidy and
the save are the pull's own (`runCloudPull`), and the save's own rebuild publishes the
boards, as a pasted list's does. Each save keeps what it replaces as an earlier
version, as the nightly's does, so the cloud panel's **Bring back** undoes a bad
refresh as it undoes a bad night; a pasted list's pull keeps nothing, as before. A
refresh whose copy is deleted and started again while it pulls, or whose Team
Rankings the owner starts again, brings back or restores at any point after its
teams were worked out (the job keeps the copy and epoch they were worked out from,
`PullJob.on`, and every leg is held to it), fails saying to press again, not to send
a list it never had. A job a device writes that calls itself a refresh is
never started (`startPullJob`): only the server's own start goes through the gate.

**The gate** (`refreshGate.ts`, `ops/refresh`, a path no rule opens). It names the
refresh last started, the nightly while it pulls, and the legs "Refresh now" has
started in the New York day. A press while a refresh is under way (queued or
running, and heard from within two hours) is handed that one, which the device then
watches as its own, rather than starting another; a press while the nightly pulls is
told so; and a press once the day's three legs are spent is told the nightly
refreshes again tonight. The job is made before the gate is taken and queued only
once it is, and the gate is written only as it was read, so two presses at once
start one refresh and the other's job is ended where it stands, never run. A first
leg Cloud Tasks will not queue ends its job too, and gives the day its leg back while
the gate still names it: left queued with no task to run it, the job would have
passed for one under way for two hours, and a nightly in that time would have waited
its longest for nothing. The press is told the refresh was not started.

Three legs a day is a cap of this project's own, not one Google sets: a leg runs on
8 GiB and two processors, about 1,440 GiB-seconds for three minutes, so three a
day for a month is 129,600, a little over a third of the free tier's 360,000; that is
reckoned from the published tier and the nightly's run time, not measured on the
function. The whole refresh was 15,793 teams on 29 September 2026, one leg of
25,000, so three legs is three presses; a refresh of more teams counts its legs past
the first once its first leg knows how many there are (`chargeRefreshLegs`), and
where the day has fewer left than it takes, it fails then, before GameChanger is
asked anything, saying so. A press is let through on one leg left, so without that
a refresh of two legs pressed third would have taken the day to four. A pasted list
is not counted: its legs are the size of the list, sent once.

**Beside the nightly and other pulls.** A refresh's leg may run beside a pasted
list's (`runPull` runs three at once). The nightly waits for a refresh under way before it pulls, and names
itself in the gate while it does ("The nightly refresh on GitHub"). Neither could
harm the copy beside the other: every save is made only onto the manifest as it was
read, and a run that finds the copy moved files its answers again onto the save it
missed (`pullJobRunner.test.ts` runs a refresh whose copy another save moves while
it fetches). What the gate spares is GameChanger, asked about the same teams twice at
once, which the gap between pulls cannot stop while neither run has saved.

## Pulls on GitHub

A pull sent from a device, a pasted list or **Refresh now**, runs on one of
GitHub's servers where the functions are given a token to start one
(`src/lib/cloud/githubDispatch.ts`, `.github/workflows/cloud-pull.yml`). Google
bills the machine a pull runs on by the second, eight gibibytes for a leg
(`runPull`) and sixteen for a staged import (the `team-import` job), and in
October 2026 those machines, with the rebuilds and the edits, spent the project's
whole free allowance and about a dollar beyond it. A GitHub runner for a public
repository costs nothing and has the sixteen gigabytes the nightly already pulls
the whole pool in.

Nothing else moves. The device writes its job and asks `startPull` as before;
where `startPull` would queue a Cloud Tasks task for a leg, start the importer's
Cloud Run job, or start the boards' publish after a pull, it asks GitHub to run
the workflow for it instead (`pullAccess.ts`). The run builds the functions as
the deploy does and runs the same files with the deploy's Firebase key: a leg
through `legJob.ts`, which runs it as `runPull` does (`legRun.ts`), and a staged
list's leg runs its importer, `importJob.js`, in the same run. A leg or an import
is tried three times, two minutes apart, as Cloud Tasks and Cloud Run tried them,
and the boards' publish once. A leg asks for the next with the run's own token.
Cloud Tasks queued a leg once under its name, and GitHub has no such name, so
each leg's asking is marked beside its job (`dispatchLegOnce`): "asking" while
GitHub is asked, "asked" once it has taken the run, after which every ask is
answered "already". A device asks again every minute for a pull waiting to start,
and a run takes about that long to start, so without the mark one pull started
two runs. An asking GitHub refused, or one left "asking" for two minutes by an
asker that died, is asked again. A leg also runs under the job's execution
lease, the one a staged import already holds, so a second run of it finds its leg
done; and a run that loses the lease, taken or not renewed in time, stops at once
writing nothing (`watchLease`), for the workflow's next try. The pull's id is masked before
the run prints anything, since its log is public; the run prints what the
functions' logs did, the cloud's own words, counts and timings. Those lines are
in **Actions → Pull in the cloud** rather than Google's logs, so the "Pulls in
the cloud" status workflow, which reads Google's, sees the jobs but not them.

A run on GitHub has the nightly's 16 GB, and gets the nightly's heap: 12,288 MB
for the boards' publish, which had 6,144 sized for the 8 GiB of the Cloud Run
job it replaces, and for a leg's worker, which the workflow says by
`PULL_LEG_HEAP_MB` (`legHeapMb`); a leg on Cloud Run, which sets none, keeps
5,120 of its 8 GiB. Each says at its end what it held then and at most, as the
nightly does (`boards-memory`, `leg-memory`, in megabytes): neither said anything
of its memory before. The closest measured case, the catch-up's publish of 16
October 2026, ended at 3,787.5 MB.

It starts within a minute or so of the press, where a task started in seconds.
Without the token every launch goes to Google as before, but the deploy refuses
to run unless the `GOOGLE_JOBS` variable is set to `on`. An emptied secret would
otherwise put the pulls and the rebuilds back on Google's machines without a
word, and a refused deploy leaves the functions with the token they already
have. With the token, the deploy builds and pushes no image and deploys none of
the Cloud Run jobs (`team-import`, `ranking-rebuild`, `boards-publish`), since
nothing launches them: the image grew Artifact Registry by about 20 MB a deploy,
to about 1.7 GB in October 2026, against its free 0.5 GB. The images already
pushed keep their two newest, and the rest are deleted a day on (a cleanup policy
the deploy sets on `team-imports`). The setup, once:

1. Make a fine-grained token at
   <https://github.com/settings/personal-access-tokens/new>: under
   **Repository access** choose **Only select repositories** and this
   repository; under **Permissions**, **Repository permissions**, set
   **Actions** to **Read and write**. Nothing else.
2. Add it as a repository secret named `PULL_DISPATCH_TOKEN` at
   <https://github.com/michaelrash3/leagueforecast/settings/secrets/actions/new>.
3. Run the Firebase workflow again, or push to `main`: the deploy writes the
   token into the functions' environment (`PULLS_ON_GITHUB_TOKEN`).

A token that has expired turns every pull away with GitHub's own words on the
device ("GitHub would not start the pull (HTTP 401 …)"); a new one in the same
secret, and a deploy, puts them back.

## Boards after saves on GitHub

Where the pulls are on GitHub, so are the boards after a save. A save the boards
read, an edit or a League Standings score, no longer asks for a rebuild on Google
(`rebuildsRun`): the rebuilds' ledger counted October 2026's largest metered use,
113,966 GiB-s and 49,543 vCPU-s, the 8 GiB job's (`ranking-rebuild`) and, until
16 October, the edits' and the questions' charged with it. Each save queues its check
of the boards instead, counting on no rebuild ("Boards published after an edit"),
and the check starts the boards' publish, which runs on GitHub. So does a save
that moves nothing a board reads, a Pool health answer or a season renamed: the
check is then the only publish, and one that lands inside the settle of a
merge's check left it settling with nothing to ask again, so the last save of a
run always owns a check (`asksBoards`). A rebuild's task
already queued, or deferred to a later month by its budget, publishes the same
way when it comes, and the deploy's own request after a deploy asks the boards'
publish on GitHub (`scripts/requestRebuild.ts`), and a refusal there is a warning
rather than a failed deploy. No decision counts on a rebuild
coming, so a pull's end publishes its own boards whatever the ledger has left.

A save reaches the boards in about six or seven minutes, the three minutes' settle
and the publish's start and two minutes' build, where a rebuild took two or
three. Each publish builds the year's boards whole, about a minute of building on
a runner, rather than reusing the build before. The ledger (`ops/rebuild`) still
meters the edits and the questions that refit a year, which stay on Google. Without
the token the rebuilds run as before.

## Pulls in the cloud: the one-time setup

Where the rebuilds after saves are set up (`LIVE_REBUILD`, below), the two functions
run as the rebuilds' account, `live-runner`, whose setup grants all a pull needs and
which runs tasks every day: two pulls sent on 10 October 2026 never started under
the pulls' own account, which had been made out of order on 9 October, after the
first deploy that needed it failed for want of it. So with the rebuilds on, step 1's
account is not used, and a pull needs nothing set up beyond them. Without the
rebuilds, the two functions run as an account of their own, `pull-runner`. It may
read and write Firestore, queue a task, and send one to `runPull`, and nothing else. The
project needs Cloud Tasks turned on, which the deploy account is not allowed to do
itself. Until both are done and the `CLOUD_PULLS` variable says so, the functions
are built without these two (`functions/build.mjs`), and the Firebase workflow
deploys the rest and says why. Leaving them out of the build is what keeps that
deploy working: the Firebase CLI asks for every API any function in the build
needs, whatever it was told to deploy, and it cannot turn Cloud Tasks on itself.

1. Open [Cloud Shell](https://console.cloud.google.com/?cloudshell=true) in the
   project and paste this, with your project's id in the first line:

   ```sh
   PROJECT=your-project-id
   gcloud config set project "$PROJECT"
   # Cloud Tasks, which carries each leg of a pull to the function that runs it.
   gcloud services enable cloudtasks.googleapis.com
   # The pulls' own account: Firestore, queueing a leg, and sending it to runPull.
   gcloud iam service-accounts create pull-runner --display-name "Pulls in the cloud"
   RUNNER="pull-runner@$PROJECT.iam.gserviceaccount.com"
   for ROLE in roles/datastore.user roles/cloudtasks.enqueuer roles/run.invoker; do
     gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$RUNNER" \
       --role "$ROLE" --condition=None > /dev/null
   done
   # A leg queues the next as itself, so it may act as itself.
   gcloud iam service-accounts add-iam-policy-binding "$RUNNER" \
     --member "serviceAccount:$RUNNER" --role roles/iam.serviceAccountUser > /dev/null
   # The deploy account makes the queue.
   gcloud projects add-iam-policy-binding "$PROJECT" \
     --member "serviceAccount:github-deploy@$PROJECT.iam.gserviceaccount.com" \
     --role roles/cloudtasks.queueAdmin --condition=None > /dev/null
   ```

2. In GitHub, **Settings → Secrets and variables → Actions → Variables → New
   repository variable**: name `CLOUD_PULLS`, value `on`.
3. **Actions → Firebase functions → Run workflow** on `main`. When it is green,
   the Firebase console's **Functions** page lists `startPull` and `runPull`.
