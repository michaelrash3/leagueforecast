# Your data on every device

_Part of the design documents; the map is in the repository's [README](../../README.md)._

A browser can keep a copy of everything in the cloud, so the app opens on the
same data on a phone, a laptop and anywhere else. It is one copy, in the
Firebase project's Firestore, open only to the Google accounts on its owner's
list: anyone else who signs in is turned away and keeps the app with the data in
their own browser, and a browser nobody has signed in to is refused anything at
all. A way of signing in that needs no Google account (anonymous, or an address
and a password), were one ever turned on in the console, opens nothing, and
neither does an address Google has not verified.

**Who is on the list.** Each account is a document in `members`, named by the
address it signs in to Google with, in lower case. The owner's own entry,
`role: "owner"`, is made once by hand in the Firebase console (below); the app
never changes it, so no click can lock the owner out or hand the list to someone
else. The owner sees **Who can use the cloud copy** in the panel, adds an
account there by its address and takes one off with **Remove**; every other
entry is `role: "member"` with the time it was added. A member reads the copy
as the owner does, and reads its own entry and no other; neither writes the copy
(below). The same
list says who may pull from GameChanger (**The GameChanger proxy on Firebase**), and
who may read the views a server publishes from the copy (**Views a server
publishes**), which no browser writes. Google
sign-in alone was the lock until 2 October 2026, when the cloud copy was
becoming the one place the data lives and any Google account could have read
and changed it.

The header's cloud button signs in, and after that shows where the copy stands;
**Settings → Your data on every device** opens the same panel. From then on it
loads by itself. A browser nobody has signed in on never downloads Firebase's
code. A member's device opens Team Rankings on the cloud's board ("The live board
on a member's device") and keeps League Standings live ("League Standings in the
cloud"), with no switch for either since 1.6f.

**Read-only to every browser (1.6f).** No browser writes the copy, the owner's
included: the rules let the list read `copies/**` by name and nothing more. Only
the cloud's servers write it, as service accounts the rules do not apply to: the
nightly refresh, the edit function a member's edits go through, the rebuilds, and
the pulls in the cloud. A device takes what the servers wrote and sends nothing:
a change made here stays here, marked, and League's reaches the cloud's own
League documents at the device's first meeting with them. A pool value changed
both here and in the copy is the copy's. Before 1.6f every device saved into the
copy, and the copy merged what they sent (below); that machinery is what the
servers' edits replaced, and 1.7 removes what is left of it on the device. A
build from before 1.6f, still open somewhere, has its saves refused until it is
reloaded.

**What travels.** Every League Standings season, as one value, and the Team
Rankings pool key by key, as it is stored: the teams, the age groups, each
squad year's games, the archive and each archived season's rows. So a pull that
changes this year's games sends this year's games. Four things stay on the
device that wrote them. The theme, the mode and the season a device has open are
its own, like any preference; carried in the copy, switching seasons on a phone
would collide with scores entered on the laptop. An undo snapshot is scratch
state for one action. A pull's own place (its progress, what it tracks, what it
cleared) belongs to the browser running the pull.

**Nothing asks which copy wins** (until 1.6f, when devices still saved). The
first version did, in a dialog, whenever
two devices had both changed something, and a second review found every answer
to it lost somebody's work: scores entered on the phone at one field and the
laptop at another were one copy or the other, never both. Now changes are
merged, and whatever a merge had to replace is kept.

- **League Standings** merge record by record, against the last copy both sides
  held (each device keeps it beside its own): seasons by id, their teams and
  games by id, each game's score, each bracket slot, each setting on its own.
  Scores entered on two devices for different games are both kept. A deletion
  loses to an edit, so no work is lost to it, across records too: a score
  entered on one device keeps the game another deleted, and a game its teams.
  Where both devices changed one
  record differently, the device that changed League Standings last wins it.
  A GameChanger id laid beside a team's pick of the same club, and nothing else
  of the team changed (an old pick stamped, "How the two modes connect", or the
  club picked again), is no change of which club the team is, and is weighed as
  none (`addedGcId`): another device's rename, new pick or deletion of the team
  is taken, uncounted, and the id goes back on the team while it is still of the
  club the id was laid beside. Weighed as a change, a stamp laid over a score's
  save beat a rename or a new pick made elsewhere, and brought back a team
  deleted there. Two seasons that share only an id (every browser's first season is
  `default`) are kept apart: this device's takes a new one, and everything the
  device keeps of it beside the season, as [Data + persistence](README.md#data--persistence)
  lists it, goes with it to the new id, leaving nothing under the old one, which
  is now the other season's.
- **The Team Rankings pool** settles key by key, the later change winning,
  since a pool is too large and too interlinked to merge row by row.
- **What lost** is kept in the copy, pieces and all, for 30 days and at most
  six settlements (`KEEP_DAYS`, `KEEP_GROUPS`). The panel lists it, and
  **Bring back…** makes it current again from any device, asking twice and
  keeping what it replaces in turn. The server makes it current, for the
  copy's owner alone (1.6), and the device then takes it like any other save.
  A member's panel lists the versions with **Bring back…** drawn off, and a
  line under them saying only the owner can (`useOwnerOnly`).

**Meeting a copy for the first time.** A browser signing in with seasons of its
own keeps them here beside the copy's, merged where they share records; the copy
is sent none of them. Where both changed one record, the copy's wins, and this
device's League as it was is kept in the browser (`saveDisplacedLeague`): the
panel offers it once as a file, **Save this device's League Standings**, or
**Let them go**. The pool is taken whole, and a device's own pool is not kept
anywhere, since the copy is the pool every device shares. A browser holding
nothing anybody made (an untouched first season, a pool with no teams and no
archived season, whose tables could not be made again) simply takes the copy.

**What is never lost.** A value leaves the copy only because a device recorded
removing it, and leaves a device only because the copy dropped a value that
device had synced; never because one side merely does not hold it. A value a
device had synced and no longer holds, with no record of removing it, is taken
back from the copy rather than the loss trusted. A browser whose storage failed
to open syncs nothing at all until it can read it again. A change the browser's
own storage refused (a full disk, say) is not sent, since the copy would then
hold what this device does not; the panel says so, and it goes once a write of
it lands. A value that is listed but cannot be read waits the same way. Every
value is checked against its fingerprint as it arrives, and one that does not
match stops the load before anything is written.

**How it is stored.** Each value is gzipped JSON, in pieces of at most
900,000 bytes, since a Firestore document holds a MiB. A value is fingerprinted
by the SHA-256 of its JSON, so a device can tell its copy is the cloud's without
downloading it. A manifest (`copies/main`) names every value's fingerprint and
the upload that stored its pieces (`copies/main/chunks`), and carries a
version, a layout number, a schema number, the id of the copy it belongs to,
and its epoch: which start of the copy's Team Rankings this is.

- **A start of Team Rankings is a new epoch, under the same copy id.** The
  owner's Start again, a version brought back and a backup restored on the
  server each give the copy a new random `epoch` (`commitChanges`' `newEpoch`);
  every other save keeps the one it was made on, and a start that moves nothing
  saves nothing and keeps it. The copy's id cannot mark a start: League
  Standings lives in the same copy and is not started again with Team Rankings,
  and every device that had met the copy would take a new id for a copy it had
  never seen. Whatever loads the pool to file or publish from it holds every
  later read to the copy and epoch it loaded (`CopyEpoch`, `sameEpoch`), and
  ends `copy-replaced` on any other: a pull's retry, each leg of a job after its
  first, a staged import's final phase, and a publish of the views. Before, the
  checks were of the copy's id alone, and a nightly that read the pool before
  the owner started again, finding the copy moved at its save, read the emptied
  copy and filed into it every team it had asked about. Epochs came with layout
  3 (`MANIFEST_FORMAT`); a manifest of layout 2 is read as one never started
  again (`epoch` empty) and written as 3 by the next save, and a build older
  than layout 3 refuses the copy from then on rather than drop the epoch with
  its next save.

- **A save goes on only if the manifest is still the version this device last
  saw, on the copy it last saw**: committed in a transaction, so two devices
  saving at once cannot both win. The loser decides again from what the winner
  saved. A commit whose reply was lost is recognised by an id of its own rather
  than taken for another device's save.
- **A piece is named by the upload that stored it, and never written again
  under that name.** The first version named pieces by the value's
  fingerprint, and three things went wrong with that. A browser that gzips
  differently counted a value's pieces differently. A save that fell asleep
  after its commit woke hours later and deleted pieces a newer save had
  uploaded again under the same names. And two devices saving one new value at
  once could delete each other's. Pieces no manifest names any more are
  deleted after the save; a save that lost the race deletes those of its own no
  copy names; an upload cut off before its commit is recorded, and cleared by a
  later save once no commit of its own can still land (ten minutes: Firestore
  lets a transaction run for 270 seconds, and one given up on here can still
  land within them).
- **A copy saved by a newer build is refused, before anything downloads**,
  when its data schema is higher than the build's own (`DATA_SCHEMA`), or it
  holds a key the build does not keep. An older build would otherwise read it,
  drop what it does not know, and save the loss to every device with its next
  edit. The panel asks for a reload, which fetches the newer build.
  `cloudSchema.test.ts` lists every field of every stored shape, held to its
  type by the compiler, so a field added anywhere fails the build until the
  schema goes up with it.

**When it saves.** Never, since 1.6f: a device sends the copy nothing. Until
then it saved twenty seconds after the last change, and when the page was left;
1.7 removed that timer, the retries after a refused save and the record of
uploads a save left behind. A change is still recorded in storage (League's, for
the first meeting with the cloud's League documents), and the panel's button
looks at the copy now, taking in what it may.

**When it loads.** League Standings before the app draws, where anything is
taken at boot at all. A browser that keeps a copy for a member, signed in when it
was last here, no longer waits for it: it opens on the cloud's board and League
kept live, and draws at once, signing in beside the page ("Opening on a member's
phone", below). Its League arrives live once its seasons have met the cloud's
documents, so for it the copy's League was nothing to wait for; one still to meet
them takes the copy's League as a boot past its wait always did, and since no
device has written the copy since 1.6f, it differs from the device's own only on
one not opened since. Its boot is told the page is already mounting
(`bootCloud`'s `mounting`), so a sign-in quicker than the page's first effect
cannot lay the copy's seasons under a page that read the older ones as it
rendered, and was free to write them back. Before 16 October 2026 such a browser waited at most four
seconds to reach the cloud (`STARTUP_WAIT_MS`) and six more for the seasons to
arrive (`STARTUP_TAKE_MS`), behind "Checking your cloud copy…"; past either, the
app opened on what it had and the panel offered the newer seasons (**Load them
now**), as it still does. No browser waits at all now: a record is switched on only
with the account it was signed in as, so every browser that keeps a copy opens
as a member's, and one that keeps none has nothing to wait for; the wait and its
line, which nothing reached any more, were taken out (`bootOrder.ts`). The pool, which can be tens of megabytes, is loaded
only when Team Rankings opens, before it draws, with **Show this device's copy now** for anyone who would
rather not wait; whatever arrives after that waits to be asked for, rather than
land under a view that has already read the pool. Once the app is open it looks again every ten minutes while
the page is on screen, at most once a minute, and backs off to half an hour
after failures. A newer copy found then is taken in when the page is out of
sight, as someone comes back to it, or after two minutes left alone, and the
page reloads onto it; never under someone typing.

**Tabs.** Every save and load runs under one lock across the browser's tabs.
A tab that takes a copy in tells the others, which reload. A tab that read its
data before another took a copy in is refused any write of it (each tab
remembers which copy it read, and storage says which is current), so its old
data cannot go back over the new; it reloads instead.

**When the copy is gone.** A browser that finds no copy (deleted in the console)
says so and changes nothing here. Before 1.6f it offered **Start it again from
this browser**; now no browser makes a copy, so the panel offers only Sign out
and says to ask the app's owner. Do not delete `copies` in the console: the
owner's **Start again** (1.6c) empties the copy on the server, keeping what it
replaces as an earlier version, and is the way to start over.

**Free.** The largest pool measured, 115,588 teams and 245,021 games, is
61.4 MB stored and 20.3 MB gzipped: about 23 pieces. Firestore's free tier is
1 GiB stored, 50,000 reads and 20,000 writes a day, and 10 GiB a month out. A
whole-copy download is 23 reads, and a device downloads the pool only while
Team Rankings is open, and then only the keys that changed; a look is one read.
The rules read the account's entry on the list to decide each request, which
Firestore bills as one more read: a whole-copy download is then 46. An ordinary
save is a few writes.

**Setting it up**, once per Firebase project:

1. In the Firebase console:
   - **Authentication → Sign-in method → Google**: enable it, with a support
     email.
   - **Authentication → Settings → Authorized domains**: add the site's domain.
   - **Firestore**: create the `(default)` database (Standard edition,
     production mode).
   - **Project settings → Your apps**: register a web app and copy its
     `firebaseConfig`.
2. Put its values in `FIREBASE_WEB_CONFIG` (`src/lib/cloud/cloudConfig.ts`).
   They are not secret: every visitor's browser downloads the same values, and
   the rules are what keep the data private. They were a Vercel setting
   (`VITE_FIREBASE_CONFIG`) until the site, built from it, sent Google a key
   sign-in turned down as not valid, which nothing outside Vercel's dashboard
   could explain; in the source, every build has the values the repository
   shows. The build widens the page's content policy for Firestore and Google
   sign-in from the same values (`src/lib/contentPolicy.ts`).
3. **Before the rules deploy**, put yourself on the list: in **Firestore →
   Data**, start a collection `members` at the top of the database, beside
   `copies` rather than inside one of its documents, with a document whose ID is
   the address you sign in to Google with, in lower case, and one string field,
   `role` (lower case too), set to `owner`. Without it the rules turn every account away, yours included,
   until the document is there. The nightly refresh, the cloud pulls and the
   rebuilds after saves sign in as service accounts, which the rules do not apply
   to.
4. The rules deploy with the functions on merge (`firebase.yml`), tested there
   against the Firestore emulator first (`npm run test:rules` locally; it needs
   Java 21).
5. Sign in on each device, and add anyone else from the panel. The copy already
   exists: a device made the first one before 1.6f, and since then only the
   servers write it.

To start the copy over, use **Start again** in the Cloud panel as the owner; the
server empties the copy and keeps what it replaces.
Sign-in opens Google in a pop-up, so a browser that blocks pop-ups has to allow
them for the site.
