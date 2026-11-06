# On the device

_Part of the design documents; the map is in the repository's [README](../../README.md)._

## Clubs this device remembers

A club's id is the pool's own (`S-RIVE`, `S-RIVE2`), and a fold or Team Rankings
started again can leave it naming another club; GameChanger's is never another
team's. So wherever this device remembers a club, it keeps up to three GameChanger
ids the club carried beside the club's id, the club's team on the page first, as a
League pick keeps the season's own (`keptGcIds`, `KEPT_GC_IDS`, `gcIdsForSeason`),
and reads the club by one rule, the League pick's (`readClub`, which `readPick`
calls with the pick's one id): the club id while it names a club carrying any of
them; else the one club carrying them now, which a club folded into another is,
since a fold carries the folded club's GameChanger teams on (`mergeScoutTeams`),
and a club pulled again after a start is; else, where the id names a club carrying
none of them and no one club carries them, the club is gone, shown as a gone club
is, by the name it was kept with and with no place, under an id no club has
(`GONE_CLUB`), so the club now under its id is never read as it. Something kept
with no GameChanger id, before this was kept, reads as it always did.

A few, not one, because an Unlink takes a link off a club still on the board, and
the one a store would keep alone is the page's newest, the likeliest to be a wrong
link undone: kept by it alone, the club read as gone after the Unlink (its watch
card "Not on this board", a saved field's club not ranked, League's place lost, My
Team's look started over; the review of 1 November 2026). Kept by three, the club
is itself while it carries any of them, and a wrong link that moves on to the club
it belongs to is not followed there. What is left: a club whose every kept team is
unlinked carries none of them, as a club its id was minted to after Start again
does, and reads as gone.

- **Watched clubs** (`lf_watch_v1`, `watchList.ts`): a club folded into another is
  watched as that club, two folded into one are one, and one whose id is another's
  now is named and not on the board while that club's own Watch is off; Stop takes
  off a club as it is shown. The five a page are the clubs the card shows: two
  folded into one count once, and the later of them goes as the next club is
  watched. 22 bytes an entry with one id and 15 for each id more, 52 at most.
- **My Team's look** (`lf_my_team_look_v1_<club>`, `myTeamLook.ts`): another club's
  look kept under the club's id is none of its own, and one kept under an id it no
  longer has is its own. 22 to 52 bytes a look, twelve looks at most. My Team
  itself is the page's mark in the pool, which a fold moves to the club that stays.
- **Saved tournament fields** (`lf_tournament_fields_v1`, `tournamentFields.ts`): a
  club folded into another is that club, and one whose id is another's now is not
  ranked here and keeps its ids when saved again. Read again each time the roster
  is, a fold in another tab while this one stays on Scouting among them, and so is
  the field open on screen, by the ids each of its clubs carried, its name, pools
  and bracket left as they were. A club of the open field whose last GameChanger
  link another tab took off drops out of it as not ranked here, as it would on a
  fresh open of the saved field (a club is kept by its ids, `KEPT_GC_IDS`). 8 bytes a field, and 17 a club with one id, 15 for
  each id more, 3 for a club with none.
- **A League team's club's place** (`lf_league_club_ranks_v1`, `leagueClubRanks.ts`):
  read on League Standings where this device holds the pool (`useScoutBridge`'s
  `clubs`), followed where its club moved, so Scout opens the club the place was of,
  and none where its id is another club's now, as a club that left the board has
  none. 22 to 52 bytes a team.
- **League picks** (`TeamBase.scoutGcTeamId`) are read the same way in the forecast,
  Fill and the bridge, and an old one takes its id at its season's next save in a
  browser no member has signed in to, and in the cloud's seasons only when a person
  picks the team again ("How the two modes connect"): 31 bytes a pick.

This device's copy reads them all off its pool. The cloud's board carries no
GameChanger ids on its rows, and reading cards or the Find a team list to find them
would be reads made for this alone, so a member's device reads them off what it
already holds, its own club's card: a watched club folded into the page's own club
is watched as it, the look is read by the card's ids, and everything else reads as
kept until a device holding the pool reads it. Nothing new is read or written in the
cloud: the device stores never leave the device, and a pick's id rides a save made
anyway.

No address or saved link names a club. `?team=` names a League Standings team, a
share link leaves the pick out, and League's Scout button hands Team Rankings its
club in memory, never in the URL (`scoutRequest.ts`), from the place read above.

## Where the Team Rankings pool lives

League Standings stays in `localStorage`. The Team Rankings pool outgrew it once
a GameChanger pull was possible, so it lives in **IndexedDB** — hundreds of
megabytes, often as much as the disk allows, and free in exactly the way
`localStorage` is free: it is the user's own machine.

It is also written compactly. Rows are tuples and anything repeated is an index
into a dictionary, so a game that read

```json
{"id":"gc_gcTEAM12_0-1-0","teamAId":"S-CLUB2","teamAScore":5,…,"source":{…}}
```

is stored as `[2,3,5,3,0,212,0,9,9,0,0,"0-1-0"]`. Measured across pools the size
of a real pull, that is **5.3 to 5.7 times smaller**: four thousand teams take
2.69 MB rather than 14.36.

|                            | Pool it holds                                     |
| -------------------------- | ------------------------------------------------- |
| `localStorage`, as objects | about 2,500 teams                                 |
| `localStorage`, compact    | about 14,000                                      |
| IndexedDB, compact         | far past anything a browser will be asked to rank |

IndexedDB is asynchronous and this app reads its pool during render, so the pool
is read into memory once before anything mounts and the synchronous reads stay
synchronous; writes go out behind them, coalesced per key. A write is therefore
reported as _accepted_ rather than as landed, and one that later fails surfaces
as a toast, which is the only thing left that can still say so. The other tabs
are told of each key as it is accepted and again once it has landed, and read it
again each time (`poolSync.ts`): told only as it was accepted, a tab read the later
keys of a save before they had reached the store, kept their old values, and with
its next save wrote those back over the other tab's work.

A member's device is the exception. It opens on the cloud's board and on League
Standings kept live, neither of which reads the pool, and a phone that held a pool
before the board was published read all of it, tens of megabytes, at every open
while the page stayed blank. There the read comes after the page
(`poolFill.ts`, "Opening on a member's phone" below): once the board is drawn, or
at once when something needs the pool first. Until it is in, a read answers what
`localStorage` holds, which for a pool moved into IndexedDB is nothing, and a
write is refused, since the read would lay the store over it or leave it in a
`localStorage` nothing reads once the store is open; whatever needs the pool waits
for it instead.

Moving across is all or nothing: a value that will not write abandons the whole
migration with `localStorage` untouched, and the old copies are dropped only once
every value is known to be in the new store. A browser without IndexedDB — a
private window, an old one, blocked site data — never leaves the `localStorage`
path, which is unchanged.

**The games are stored one key per squad year.** Every game the pool had ever
seen used to live under one key, and reading the pool meant decoding all of it:
two hundred thousand objects for the season on screen and as many again for the
one before it, which nobody was looking at. A squad year is already its own
rating pool — nothing in one year's fit reads another year's games — so it is the
unit of storage too. The Team Rankings view decodes the year on screen and keeps
that one; switching years decodes the other and lets the first go. What needs the
whole pool — a tidy, a pull, a backup, an archive, merging or renaming a club,
the search box that finds a club on another year's page — reads every year from
storage at the moment it runs and holds it only that long. Saving one year cannot
touch another: a game filed under another year's page is laid over that year's
copy by id rather than lost with the page it left. Changing an age group's year
moves its games; deleting the group files them with the yearless, where nothing
shows them and nothing loses them. Teams are not split, because one copy of a
club is the only way a rename in one year is a rename in both. A pool written the
old way is moved across on startup, and the old key emptied only once every
year's write has been confirmed. The League Standings side reads only the years
its linked age groups sit in.

**Saving the whole pool is not something a caller is taken at its word on.** The
save that rewrites every squad year used to empty any year the array it was
handed had no games for, which reads as obviously right — a caller holding the
whole pool has nothing for a year only when that year is empty. It is ruinous for
a caller that is not holding the whole pool, and "the whole pool" is a claim
about the caller that the array itself cannot make. The Import section was given
an empty array by a wiring mistake, so the GameChanger panel folded a pull into
nothing and saved that over everything; a hundred thousand games went and the
pull reported success. Now a stored year the save has no games for is left
exactly as it was unless the save names that year, and the save comes back with
the years it spared — which a caller that really does hold the whole pool never
has any of. Emptying every year at once is its own function, `replaceScoutGames`,
and restoring a backup is the only caller of it. The check costs nothing: a year
with no games is dropped rather than written empty, so the stored keys already
are the years that hold games. It is not a whole guarantee, and is not meant to
read as one — a save holding a year's games can still overwrite that year with
fewer of them, and nothing here can tell that from a deletion somebody asked for.
What it closes is the whole-year case, which is the one that loses a season.

**A squad year leaves whole, archived or deleted.** Setup's **Archive or delete a season**
card takes one baseball year at a time — every age on it, because they are rated together
and taking one page would quietly change the tables of the rest. **Archive** freezes each
page's final tables, a half at a time, and then lets the games go. **Delete** keeps nothing
(`deleteSquadYear`): the year's pages, every stored game filed under them, the clubs no
other year holds, and any tables already archived from it. Either way a club goes only when
the year was all there was of it (`clubOutlivesYear`): next year's clubs, pulled and linked
but not yet played, are next year's and stay. Keeping only the clubs a remaining game named
took them too, 124 on a real backup, and with their ids went the daily refresh of their
schedules. A club another year holds stays, since one copy of a club is how a rename reaches
both years, but a delete takes the GameChanger ids filed under the deleted pages: those ids are that year's squads, and a
link left to a page that is gone would be the one trace of the year still in the pool. A
page that carried a squad on from one of the year's pages stops doing so. League Standings
keeps its seasons either way; only the links from the deleted pages go, so their fixtures
stop feeding a ranking. The confirmation says how many pages, games and clubs go, and how
many clubs stay without that year's ids.

**A year put away stays away.** An archived year's clubs keep the ids they were pulled as,
and the list of teams waiting on an age is not the pool's, so it outlives a delete. The two
re-asks that named no season, the roster check of under-strength pages and **Ask again**
about teams with no age, reached those squads and filed them back onto a page of the year
that was put away. Both now keep to the season being played, as the rota does: the roster
check lists only that season's pages, and both pulls refuse any other season's team
(`other-season`), which also takes it off the waiting list. The nightly holds the waiting
teams it asks about to the same season (`GcImportOptions.seasonYearsFor`), while the rota's
own teams are filed as the pool already holds them.

**A club's id is never handed out twice.** A club's id is `S-`, the first four letters and
digits of its name, and the first counter free (`S-RIVE`, `S-RIVE2`), and free used to mean
free against the roster alone: a club folded into another (a pairing kept, Same team as, a
tidy) or deleted gave its id back, and the next club whose name started the same was minted
under it. Whatever had kept the id then named the new club with nothing to say so: a League
Standings team picked as the folded club carried its league's games onto the new club's
record and the new club's tournament results into its forecast, and a club watched on a
device showed another club's row. So the roster keeps, for each family of ids that has let one
go, the highest counter it let go of (`CompactTeams.h`, `retiredIds.ts`), and every mint skips
every counter of the family up to it: a pull's, the tidy's slots and stand-ins (and none later
in a tidy under an id an earlier step of it let go of), a game added by its clubs' names on
either page, a stand-in made for a game taken off a club, and the clubs League Standings'
teams are carried onto, which a game added by name adopts into the roster. It is worked out
where the roster is saved, from the ids the store held before (`saveScoutTeams`), so no fold or
deletion has to say so, and written only with the roster. A restore keeps the store's and the
file's together; the Team Rankings file carries it inside the roster, and the whole-browser
file and Undo beside it. A high-water rather than the ids, because it stores fewer bytes: on
the seeded fixture at its full size (20,204 clubs, 58,105 games), first words spread over
4,000 invented words (2,790 families), with every stand-in and slot and a tenth of the pulled
clubs let go of it is 8,610 bytes of the 889,717-byte gzipped copy (0.97%) where the ids would
be 27,627 (3.11%), and with a tenth of the stand-ins and slots and 1% of the pulled clubs, 2,306
(0.24%) where the ids would be 3,900. A pool that has let none go is written as it was. The
data schema went to 10 for it, since an older build would drop it with the next save of the
roster. The high-water covers the ids let go of from the build that keeps it on, and Start again
empties the roster and the high-water with it (see "Team Rankings started again"). So every mint
that reads League Standings also holds, as the high-water does, the id of every club a League
team picks that the roster no longer holds (`retiredWithPicks`): an id let go of before the
high-water was kept, or across a start. Those are the pull and the tidy after it, on the server
and on a device, a game added by name on either page, a stand-in made on a device's own page,
and the clubs League Standings' teams are carried onto, and each reads the seasons already, so
it costs no read and no write, and it is never stored: worked out afresh by each run. The one
mint that reads no League Standings is the live page's stand-in for a game taken off a club,
which carries random letters no other mint makes. A pick of such an id reads as a club gone
until its club is picked again, never as another club.

An archived table keeps the numbers it was frozen with, since its games are gone and nothing
can fit it again. Tables frozen before the cap moved from eight to twelve, at the end of
September 2026, were rated with the cap at eight and are not comparable with later ones;
nothing on the card marks which is which beyond the day each was frozen.

## Backups

**Backup JSON is a whole-browser backup.** It carries every storage key this app
owns, not just the season you happen to be looking at:

| Storage                                                         | In the file                                         |
| --------------------------------------------------------------- | --------------------------------------------------- |
| `league_seasons_v1`, `league_active_season_v1`                  | `seasons[].id`/`name`/`createdAt`, `activeSeasonId` |
| `league_season_<id>_{teams,matchups,logs,bracketLogs,settings}` | one `seasons[]` entry per season                    |
| `league_forecast_scout_{teams,games,age_groups}_v1`             | `teamRankings`                                      |
| `nkb_theme_v1`, `lf_app_mode_v1`                                | `preferences`                                       |
| `league_season_<id>_undo_v1`                                    | **omitted on purpose** — see below                  |

The one omission is each season's undo snapshot. It is scratch state for a
single action, it duplicates the season it belongs to (so carrying it would
roughly double the file), and restoring a stale one would offer an "undo" back
to a state from some other session.

The active season is read from live app state rather than storage, because
score writes are debounced — a backup taken right after typing a score would
otherwise miss it.

**Export CSV stays season-scoped**: this season's schedule, then `# Section:`
blocks for the Team Rankings age groups, ranked teams, and logged games. A
`# Section: <name>` line opens each block — one cell in a spreadsheet, and a
line no header or data row can be mistaken for. Names are written beside the
IDs to keep the file readable, but the IDs are what a restore reads.

### Restoring

Importing a JSON backup does one of two things, decided by the file:

| File                                             | Effect                                                                                        |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Has `seasons[]` (current format)                 | Replaces **everything** in this browser: all seasons, the Team Rankings pool, theme and mode. |
| Has top-level `teams`/`matchups`/`logs` (pre-v2) | Replaces the active season only, as it always did, and stays undoable.                        |

A whole-browser restore reaches further than the undo snapshot can hold — a
season the backup does not carry is gone — so it is not offered as undoable.
Instead the confirmation dialog lists every season in the file and says plainly
what is being replaced, and the toast afterwards offers **Download replaced
data**: a backup of the state that was just overwritten, built before the write.

For the Team Rankings pool specifically, restoring **replaces** it rather than
merging into it, since one backup carries every age group. Both import dialogs
say so, including the case a count would not reveal: a file saved while the pool
was empty clears it. A file with no rankings data at all — including any backup
written before this shipped — leaves the live pool exactly as it is.

**In the cloud, the server restores the pool** (1.6). A browser that keeps the
cloud copy for the account signed in does not write the pool itself: it stages
the file for the server and asks it to restore that, the copy's owner alone (see
"Team Rankings restored from a backup" below). A member is told so before
anything is sent; an account turned away from the copy keeps a pool of its own
and restores it here, as a browser never signed in does, and so does one taken
off the list since (`not-owner`), whose sign-in and record here are as they were
but which the copy now refuses every read and restore. A copy that is gone, or
one a newer build saved, is still the cloud's for an account on the list: a
restore then says there is no copy to restore into, or is the server's. The
seasons, theme and mode are still written here, and on screen before the cloud
is waited on, so nothing typed meanwhile lands in the wrong season. The Team
Rankings file restored on its own reloads the page on the restored pool where
Team Rankings is open, and says it was restored either way; with a season
backup, a CSV or a whole-browser file, the pool is taken as any newer copy is
(at once where Team Rankings has not yet read one here, else offered by the
Cloud button), so the season being written is not reloaded away, and the
import's own toast says whether the pool was restored. A file holding no Team
Rankings leaves the cloud's as it is: emptying that is Start again's. Undo after
such an import covers the season alone: the copy keeps the pool it replaced,
under Earlier versions in the Cloud panel. So, in the cloud, **Download replaced
data** after a whole-browser restore holds the seasons, theme and mode replaced
and no Team Rankings: what the restore replaced is the cloud's pool, which the
cloud keeps, not this device's, which a member's device holds none of or none
kept in step, and a file with no pool, restored in its turn, leaves the cloud's
alone rather than laying this device's over it for every device. The toast says
the pool it replaced is under Earlier versions.

A CSV with no section markers is treated as all schedule, so every CSV exported
before sections existed, and every hand-made one, still imports unchanged.

**In the cloud, a backup's Team Rankings is the copy's** (1.6e). A member's device on the cloud's
board is to hold no pool, or none it keeps in step, so the three things that write Team Rankings
into a file read it off the cloud's copy when they are asked: Setup's **Download a backup** on the
live page, Backup JSON, and Export CSV. Backup JSON and Export CSV read it only where Team
Rankings is the cloud's for this browser (App's `rankingsLive`): a member who turned the board off
works on this device's own pool, kept in step, which reaches the copy only with a save that waits
on pulls and tidies, so there they write this device's pool, as before 1.6e; and an account taken
off the list, whose board is not the cloud's either, writes its own. Backup JSON takes League
Standings as it stands when it is pressed, and lays the copy's pool into that once it is read:
taken after the read, half a minute later on a phone, a season switched to meanwhile would have
carried the pressed one's schedule under its own id. Each button reads the copy once at a time,
and a press while it reads is told it is still reading, since a second read would hold a second
whole copy in a phone's memory and download a second file; both say they are reading. A copy a
newer build saved is refused off its manifest before a piece is fetched, as a take refuses it
("…saved by a newer version of the app, so reload the page…"), since this build's loaders would
drop the fields inside known keys it does not know and the file would be written without them. The
page fetches the pieces of every pool part the copy's manifest names, League Standings' part
aside, a part at a time, as a take fetches them (`copyBackup.ts`); a copy that moves on while it
is read, a piece swept since the manifest was read, is read again once, off its manifest as it
then stands. The pieces go to a worker of their own (`backup.worker.ts`), which unpacks and checks
them as a take does (`unpackChunks`), lays them into a pool store in memory
(`applyCloudPoolValues`) and reads them back with the very loaders the device's own backup reads
with, so the file is the one a device holding that pool would write, to the byte:
`backupProtocol.test.ts` holds the Team Rankings file, the CSV's sections and the whole-browser
file's pool, each to the device's own, over a seeded pool with an archived table and a dropped
club in it. It is a worker because it has to be, not for speed alone: the pool store is a module
of one per realm, and on the page it is the device's own, which this would empty and fill with the
copy, so a browser that cannot start the worker makes no backup rather than make it there. That
store is the worker's own, so it tells no tab of the keys it lays in: a store handed to
`initTeamRankingsStore` (the worker's, the server's runs') starts no sync with other tabs, which
would each re-read that key from their own store and reload their pool. An answer the worker
cannot post, such as a file too large for a phone to clone, is posted as a failure instead, and a
worker that has not answered in five minutes is ended and said to have failed
(`BACKUP_WORKER_LIMIT_MS`): its slowest work, the CSV, took 3.5 s in Node on the seeded pool at
the real pool's 252,171 games, and the real pool stores 2.4 times as much, so a phone at the
README's measured five times a desktop needs about 40 s. Each button says what it is doing, and
why when it cannot ("The cloud's copy could not be read just now, so no backup was made."):
Setup's and Backup JSON make no file without the copy's Team Rankings, while Export CSV saves the
schedule without the sections and says so, the schedule being what that button is mostly for. A
sign-in that will not load, a worker that fails and a part that will not unpack are each said that
way, never thrown. A bare date in a CSV read in while Team Rankings is live is read in the squad
year the server's bridge gives the season (`league.bridge`, 1.6e), as the device's own reads it
off its age groups.
