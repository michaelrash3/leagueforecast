# Age groups

_Part of the design documents; the map is in the repository's [README](../../README.md)._

A GameChanger pull creates the pages it needs: every team says which age level
and season it belongs to, and each schedule is filed under the page for that
squad year, made on the spot if it is not there. Setting one up by hand is for a
league tracked without GameChanger — and nothing can be logged by hand until an
age group exists, because every game has to know which ranking it belongs to.

What a pull cannot work out is which page **your own** league season belongs on:
nothing in a GameChanger schedule mentions your league. So Setup asks that
directly — "what age does this League Standings season play?" — one row per
season, and answering makes the page if the pull has not already. A season moves
off whatever page held it before, since one league season is played at one age
and leaving it on two would count its games twice.

The row starts at the page the season is on, else at the year its name gives —
read the way GameChanger's seasons are, so "Fall 2027 10U" opens squad year 2028
and "Spring 2027 9U" is 2027 — else at the season being played. It used to start
at the name's year as written, which put "Fall 2026 9U" on last season's 2026 page
even now, else at the oldest year the picker lists, which stayed put while the
calendar moved on. Either way the button's own default put an autumn league
season on last season's page, and its "9/18" games were read a year early, onto
the finished fall board.

## Which age a team is

Five things can say, and they are asked in this order. `ageLevelOf` in
`gameChangerApi.ts` is the whole of it, and the profile normalizer and the list-row
reader both call it, so a row and the team it names can never read as two different
ages.

| Where it is written                                                  | Example                     | Read as                                |
| -------------------------------------------------------------------- | --------------------------- | -------------------------------------- |
| **A bracket in the name**                                            | "Premier Ohio Lopez 9U/10U" | the older end — 10U                    |
| The age field — GameChanger's `age_group`, or a pasted list's column | "9U", "12UA", "11U/12U"     | that label, a bracket at its older end |
| A graduating class in the age field                                  | "2029" in squad year 2027   | 16U                                    |
| A single age label in the name                                       | "Trash Pandas 9u"           | 9U                                     |
| A graduating class in the name                                       | "Midwest Nationals 2030"    | 15U, two years out or further          |

The bracket sits above the age field, which is the one place the name outranks a
stated age. The field holds one value picked from a dropdown when the team was
created, and a club running a 9U/10U squad routinely picks the younger of the two —
so the two are not so much in conflict as one being half of the other. Filed at the
younger end, every game the squad plays in its own bracket reads as playing up, and
the rating hands it an advantage it never earned. The name is also the measured
better witness here: of the 343 teams where a pasted list and GameChanger disagreed
about the age by one, 267 had the list's level in the team's own name (the table
under **Check the id**).

A person outranks all five. A level named by hand stands in until GameChanger's own
answer _changes_, and one set on a club's panel stands until it is taken back — see **Naming an
age**.

**The panel says which of them answered.** Each GameChanger link records the rule that filed it
(`GcTeamLink.ageFrom`: GameChanger's age field, the name, a league or organization on your list,
the opponents' names, the clubs its games identify, the teams it has played, or you) and
GameChanger's own age field verbatim (`ageLabel`), and the link line reads "filed at 8U, from its
league or organization on your list; GameChanger gives no age". The user asked on 28 September 2026
why a club whose name carries no age was filed at 8U, and nothing stored could say: the rules
that read opponents' names only run when nothing above them answered, so it was the age field or
the list, and which one was lost. A link pulled before this says nothing until its next pull.

## High school squads are left out

A varsity or JV side plays other varsity and JV sides. Its whole schedule is the
school season, so its results join almost nothing else in the pool — and a
least-squares rating across a cluster that barely touches the rest is not so much
wrong as meaningless: the numbers inside it are relative to each other and to
nothing else. Filing one at 18U would put that cluster in the 18U table next to
travel clubs and invite exactly the comparison the data cannot carry. So the whole
category is refused.

Refused on the name, the way wiffle ball, blitzball and softball are, which means the same
three things: the rows never cost a request out of a pasted list, the import turns
the schedule away with the reason `high-school`, and a tidy pass deletes any that
reached the pool before the rule existed. Nothing has to remember an id — the name
refuses it again every export, including ids never seen before.

| In the name or the age field                      | Read as                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------- |
| `Varsity`, `JV` or `J.V.`, `Junior Varsity`       | high school, always                                                 |
| A lone capital `V` in the name — "Alder Comets V" | high school, as `Varsity` is: the owner's ruling, below             |
| `JV/V`                                            | high school — both words say it                                     |
| `HS`, `High School`, with no age label            | high school                                                         |
| `HS` with an age label — "Lincoln HS 16U"         | **kept**: a summer squad playing an age bracket against travel ball |
| Any of the above under 14U — "Varsity Elite 12U"  | **kept**: a travel club that likes the word                         |

Three edges are deliberate. A squad word wins over an age label, because a side
calling itself varsity is playing the school season whatever else it writes; the
letters have to be their own word, so "CHS Cardinals" is a club, not a school; and
one thing outranks both, which is an age nobody in high school could be playing at.
A freshman is fourteen at the youngest, so "Varsity Elite 12U" and "JV Sluggers 10U"
are travel clubs that like the words. That floor matters more than it looks: a
wrongly refused club leaves nothing behind to notice it by — no row, no count against
its name, nothing — so the rule errs towards keeping whenever the age contradicts it.

**A lone V is varsity.** The owner, 18 October 2026: "A lone V means Varsity. period." A capital V
standing alone reads exactly as the word does, its floor with it: "Alder Comets V", "Alder Comets
V.", "V Gorsefield Gulls", "Tamberly (V)" and "Wrenhaven V-Rays" are school squads, "Brackenfield
Owls 12U V" a travel club. Alone is the ruling's word, and a V something joins to a word is not
alone: a letter in any script against it ("VA", "MVP", "IV", "Válcor"), a digit ("V8", "5V5",
"12V"), or a dot or an apostrophe with a letter or a digit beyond it ("N.V.B.A.", "Q.V", "V’rons").
A lowercase v between two names is versus. "J.V." is read as the `JV` it spells. Until then a lone
V refused nothing: it put its row on the waiting list ahead of the rows nothing else separated it
from, with a line saying what to look for (**Teams waiting on an age**, below).

The first reading of the ruling counted anything outside A to Z as no letter, and so refused V8,
N.V.B.A. and Válcor as varsity, and deleted the clubs. Over the 362,078 distinct names in the
desktop crawl's export of 24 September 2026, the backup of 11 October and its waiting list, it read
121 names as school that no other school word did; reading a V as alone reads 88, and the 33 it
gives back have every V joined to a word, by a dot (16), a digit (13), an accented letter (3) or an
apostrophe (1). A second writing of the rule, scanning characters rather than matching one pattern,
gives the app's verdict on every one of those names. On the export it reads 58 rows no other school
word did, where the first reading read 76: 50 of them with nine players or more and 6 with none,
none with anything in the age column, so a pasted export marks 10,508 rows high school where it
marked 10,450. In the backup it reads 35 teams by the name the pool stores, 11 pulled clubs and 24
stand-ins, where the first reading read 59, none of them anyone's own team, a page's own team or on
the owner's list of real clubs, and none of the 13,169 rows waiting on an age.

**The tidy reads the name the import read.** A pool stores a club under its name with the age taken
off (`cleanTeamName`), so "Brackenfield Owls 12U V" is held as "Brackenfield Owls V", which reads as
varsity where the name GameChanger gives it does not. Read off the stored name, the tidy deleted a
club the import files and the next pull filed it again. So a pulled club goes when every name
GameChanger gives it reads as a school's, as the not-a-team pass reads one, and a stand-in, which
has only the stored name, stays when a row named it at an age under fourteen read off an age label,
the level a row's name gives a side being kept on the row (`schoolNamedTravelStandIns`); the clubs
worth pulling read a stand-in the same way. Off a label, because a class year excuses no squad word:
the import reads an opponent's level from a label or, failing one, from its class year, but it
refuses "Quillmoor V 2033" on a 2027 page although the class of 2033 is 12U. The year stays on the
stored name, so a row at the very age the name's class year gives on its page is read as the year's
and excuses nothing. No row in the backup names such a stand-in at the age its class year gives.

In the backup 4 of the 11 pulled clubs go, every one filed at 14U or above (14U twice, 17U, and
18U for one whose name states no age), 3 of them on a board built from that backup, the best 650th.
The other 7 stay: the names GameChanger gives 6 of them state an age under 14U, and one carries no
lone V at all. Of the 24 stand-ins 22 go, and 2 stay, every row naming them at an age under
fourteen, 3 games. The tidy deletes 26 clubs as high school squads where it deleted none, and
prunes 2 stand-ins left holding nothing; 51 games go, 37 of them scored, 49 of them (35 scored) off
the records of 28 pulled clubs that stay. No game left standing changes, and it keeps nothing it
deleted before. Against the first reading, which deleted 39 clubs as high school squads and 129
games, 8 pulled clubs, 10 stand-ins and 3 slots come back with 78 games, and nothing the first
reading kept goes. The tidy rules go from 24 to 25, so every pool is tidied once more under the
ruling. The board parity pins do not move, so `BOARD_RULES` stays at 7.

Their games go with them, and one of those losses is real: a travel side that
played the local varsity loses that result. It goes because the other half of it is
a club the pool refuses, and a game with one side missing is a dangling row rather
than a result. Carrying the handful that cross the line would mean carrying the
cluster they lead into, which is the thing this rule exists to avoid.

## Softball, and pages that are no team, are left out

The not-baseball refusal reads softball, fastpitch, slowpitch and kickball beside wiffle ball and
blitzball, on the same three terms. A name that says baseball as well is a programme fielding
both and is kept, though "Wiffle Baseball" is still wiffle ball. On the desktop crawl's export of
24 September 2026 the softball words read 132 rows (62 of them full rosters, real softball sides);
in the backup of 11 October they read 27 teams, 13 of them pulled and 13 stand-ins, holding 99
games, 12 scored. Ten are softball against softball: 3 between two sides the rule reads, and 7 a
softball club's against stand-ins only softball schedules name. The other 2 are on a baseball
club's own schedule too, the slow-pitch squad's game against a club named only by colour and age
and a fastpitch side's against a club whose name says baseball, and they go with the rest: a game
against a softball side is not a baseball result, so each of those two clubs loses one scored
game. The panel's pill, the reason and the tidy's line say "wiffle ball, blitzball or softball".

A page whose name says it is no team at all is refused too (`notATeamWord`, `teamNameRules.ts`):
a practice, a scrimmage, a test, a demo, a sample, a fake, a tryout or evaluation, a stats or
scorekeeping account, a live stream or camera, an intrasquad, and a real team's old page marked
delete, placeholder, duplicate or copy of, void, do not use or DNU. Fifteen word groups in all,
softball the fifteenth, each a whole word read against the name as written and against the name
with its joins split apart (a word run into a number or a capital is read on its own there, and a
word somebody capitalised mid-way only as written), each with the exemptions the measurement
asked for: a family-practice
sponsor, the Austin organisation called TEST ("TEST Black", "TEST Red", "Test Blaze"), Skiles Test
and a test-prep sponsor, a demolition sponsor and the Demo Dawgs, a "Fake and Bake" squad, "All
Stats" for All Stars, a squad "with streaming". Together the fifteen read 2,138 rows of that
export (0.80%), 692 of them with no players at all, and a second implementation of the patterns
gives the same verdict as this one on every one of the 147,114 distinct names in the pool.

A sixteenth group joined them on 18 October 2026, at the owner's word ("Team number teams should
be blocked"): a name that is **only "Team", with nothing more than a number, a letter or an age**,
"Team 7", "Team #4", "Team B", "My Team", the word alone, "Team 7 12U", "12U Team 7" and "Team
12U", with my, new, the or our in front and a "#" anywhere between. It is what a page is called
when nobody named it and how a schedule writes an opponent it could not name; the waiting list had
sorted the shape without an age to its top since 27 September. The age counts for nothing because
the import takes it off a stored name (`cleanTeamName`): a page GameChanger calls "Team 7 12U" is
stored and shown on every board as "Team 7", and "Team 12U" as "Team". A place or a club's name
after the word, a second word after the number, four digits, a bracket of two ages, or a number
run into a name ("Team7" and a name splits to "Team 7" and the name) is a team somebody named, and
is left alone; so is a letter run straight onto the word, "Teams" being a plural and "TEAMB" a
word in capitals, where "TeamB" splits to "Team B" and is read.

On the export it reads 75 rows, 47 of them with an age, 28 empty and 21 full rosters, none of them
read by another group: the sixteen read 2,213 rows (0.83%), 720 empty, and a pasted export now
marks 2,081 rows as no team where it marked 2,006. A second implementation of the pattern gives the
same verdict on all 155,641 distinct names in the backup of 11 October and its waiting list (54
read) and all 237,305 in the export (54 read). In that backup it reads 31 pulled clubs, each of
one GameChanger team and on nobody's list of real clubs: one with no age in its name, unranked
and holding no games, and 30 of the "Team 7 12U" kind, in 13 states, holding 66 games, 29 scored,
34 of them between two such clubs, 10 of the 30 on a board built from that backup, the best of
them 914th. It reads 49 stand-ins too, holding 72 games, 43 scored, none listed by a second
schedule. Those 72 sit on the schedules of 29 pulled clubs, on 67 of their days, with two such
opponents on one day only once, none under an event, and a median margin of five runs: real games
against an opponent the schedule could not name, not a squad playing itself. So a game against
one is kept on a slot of its own, as an old page's is, and the result stays on the record of the
club that played it. The tidy deletes the 31 pulled clubs and turns the 49 stand-ins' 72 games
onto 72 slots of their own, not a result lost; of the 30 aged clubs' 66 games, 17 stay on the
record of a club whose own schedule lists them and 49 go with the pages, 21 of them scored. On that
backup the not-a-team pass deletes 786 pages where it deleted 756 without the age. It deletes a
club GameChanger calls "Team 7" only where the pool calls it so too, since the import has nothing
but an age to clean off such a name, and a club the pool holds under another name was renamed by
hand or merged into one by somebody. The tidy rules go from 23 to 24, so every pool is tidied once
more under the word. The nightly sweep's name sign reads void, test and demo alone (`madeUpHit`)
and does not move; the clubs worth pulling leave such stand-ins out, as they leave out the other
words'; the waiting list says "the name is only “Team”, with nothing more than a number, a letter
or an age" for one. The board parity pins do not move, so `BOARD_RULES` stays at 7.

- **Out of a pasted list** before a request is spent: the row is marked with the word it hit, and
  the pill reads "N practice, test, old or unnamed team pages, skipped". Not remembered with the refusals
  that hold for good, since a coach can rename a page: the name is read again on every export.
  The row of a club the owner vouched for, as the import reads that below, is kept and goes on as
  any row, on no pill (`vouchedByImport`): left out, the club could never be refreshed from a
  paste that names it, though the import would file it, and only a bare id got through. The
  device's panel reads it against the real list and League Standings as the run hands them to the
  importer, and runs the League pass only for a marked row whose id is on the real list or carried
  by a club in the pool, since nothing else can be one. The cloud's paste box cannot tell: the live
  page holds neither the pool nor League, and the real list alone would miss the user's own club.
  So it sends the marked rows, and the cloud settles them as it chooses what to ask (`listIds`). A
  row the import's gate passes without League (its id on the real list, or the club carrying it
  the user's own, a page's own team or on the real list) goes on as any row. League it does not
  read there: a staged import chooses from the team index alone, without the games League links a
  club by its name from. So a marked row carried by a club only League could vouch for is sent
  beside the rest, for the import to settle with League read as it files, and counts toward no
  handful; counted, a club's practice page kept beside its clean one tipped 25 held rows pasted by
  hand over the line, and the refresh asked about nothing where the device pulled the 25. It costs
  a request the import may refuse, and only where a page plays in a League season at all. Every
  other marked row is left out before any request, since the import is sure to refuse it. The real
  list and the pages are read with the team index for that (`IMPORT_INDEX_KEYS`).
- **At the import** the schedule is turned away with the reason `not-a-team`, before its age is
  read, so "Practice 12U" with a perfectly good age is refused; the sentence names the word
  ("Its name says “Scrimmage”."), the list of teams not imported says "Not a team, by its name",
  and the members' report "not a team". A team waiting on an age leaves the list on its next ask.
  A club the owner vouched for is the exception, as it is in the tidy below: one on the list of
  clubs said to be real (by club id or any GameChanger id of it), the user's own club, a page's
  own team, or one a League Standings team links. Its schedule is pulled again whatever its name
  says, and another club's row of its name is filed as any name is rather than dropped; refused,
  a club the tidy keeps would stop updating, and the rows confirming its games would come off them.
  The row is let through only where the club's own names, stored or on a link, carry the word the
  row hit. A name is matched by its key, which drops a bracket, so "Tigers 12U (Scrimmage)" keys
  as a plain vouched "Tigers 12U"; but the word is the row's, not the club's, and the row is
  dropped as it would be against anybody. Let through, it went onto the club as a game more than
  its schedule lists, on a day it played someone else, or onto a stand-in stored without the
  bracket that the tidy then read as a plain name and kept.
- **A game against one** on another club's schedule is dropped, as a game against a wiffle team
  is, where the word is a practice, scrimmage, test, demo, sample, fake, tryout, stats, stream or
  intrasquad: that result is not a game. Where it marks an old page (void, do not use, delete,
  duplicate, placeholder) the game is filed against a slot of its own, as "TBD" is, because those
  are real teams' abandoned pages and the result is real: 14 of the 45 games filed against the
  void and do-not-use pages in the backup are listed by the other club's own schedule too. A name
  that is only "Team" with a number, a letter or an age is filed the same way, for the reason
  above.
- **Already in the pool**, a tidy pass deletes a pulled club every one of whose GameChanger names
  says it is no team, read off its links (the club's own name only for a link that carries none),
  after the high school pass and before anything is levelled or settled; and a stand-in whose one
  name says so. The stand-ins are read because a game filed against one before the rule stays until
  its schedule is pulled again, and a club pulled seldom may not be for a long time. Left, a
  practice result filed then went on rating the club that played it, in the fit though out of every
  table, while the same schedule pulled into a fresh pool had no such game. A pull reads the row's
  own name, which a stand-in does not keep: a row the opponent gate now turns away counts as no
  longer listed, so the game filed on it before is withdrawn and goes at the next tidy, as a fresh
  pull would never have filed it. That is what takes a word only in a bracket, "Rowanberry Rooks
  (Scrimmage)", whose stand-in was stored as plain "Rowanberry Rooks" and which the tidy reads as a
  plain name; 30 of the 1,486 drop-word names in the export of 24 September say the word only in
  round brackets. A cloud run that could not read League leaves such a game standing
  (`realClubsShort`), since the row may name a club League picks. Never a slot of the name, which
  names nobody; never the user's own club, a page's own team or a club said to be real; and never a
  club a League Standings team links, picked in Settings or carried onto by its name, which only the
  League pass can see (`leagueLinkedClubs`), so the device's tidy and the cloud's read League first
  as the boards do. Nor a drop word's stand-in named after one of those clubs in a pool it plays in,
  read as the import's gate reads the name, by its pool and key (`namedAfterSpared`). The import
  files a row of a vouched club's name against such a stand-in on a day the club played nobody, so
  the stand-in holds the club's game, and the refile and claim steps settle it as any other.
  Deleted, the game went with it, and the next pull filed the row again, every night, with a line
  each time saying a practice page had gone. A cloud run that cannot read League deletes no page by
  its name that night rather than one a season's pick leans on. An old page's games that another
  club's own schedule lists are kept, its side turned into a slot; a drop word's games go with it.
  On the backup of 11 October 2026 this deletes 520 pulled clubs, 121 of them old pages and 33 read
  only through the names on their links; 76 were on a board that day, 237 were already off every
  board by that night's sweep, and none was on the list of clubs said to be real. They held 434
  games, 251 scored; 35 are kept (27 scored), 31 on slots and 4 stood back up against the stand-in
  the other club's row was filed against. Two clubs whose stored name has a word none of their links
  has are left. Of the stand-ins, 130 of drop words go with the 166 games they held against pulled
  clubs (47 scored), and 56 old pages' 85 games (16 scored) move onto slots; a full tidy leaves none
  of these names standing in, where it left 175. A deletion here is undone only by a backup, where
  the nightly sweep's marks have **Put back**.

A team below the youngest level ranked here, or one GameChanger gives no age
for, is skipped rather than filed: a nationwide list carries thousands of 6U and
7U squads whose results say more about which league plays coach pitch than about
any team. The list drops them before the pull so their schedules are never even
fetched, and the import skips any that get that far. **Each level has its own table and only lists teams
of that level** — a 9U team never appears on the 11U ranking. What a season year
shares is the _fit_, not the table, so that a 9U who plays up in a tournament
still counts for both sides: see [Playing up and down](ratings.md#playing-up-and-down).

An age group is an **age level** (8U-18U) and a **year** (2027 on), zero or more
League Standings seasons that belong to it, and optionally the age group it
**continues from**. Both are dropdowns, so the label is always "10U 2028" and
never two spellings of the same season. Groups created before the picker existed
keep the name they were typed with; editing one reads the age and year back out
of that name where it can.

| Concept               | What it does                                                                                                                                                                                                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Assigned seasons      | Those seasons' whole schedules fold in. Put a Fall and a Spring season at the same age when both are the same squad-year.                                                                                                                                                              |
| Advance to new season | Creates next year's group from this one — a year older, a year later (9U 2027 → 10U 2028), already continuing from it, already carrying "our team". Seasons are not copied: next year's don't exist yet. 18U stays 18U while the year moves, since a player can spend two years there. |
| `continuesFromId`     | Last year's version of this squad. Its opponents keep appearing in the name dropdown as the squad ages up. **Only names travel across years** — a 10U group that continues from a 9U one starts at zero games. Levels within one season year do pool; across years they never do.      |
| `myTeamId`            | "Our" team, per age group, so a club running a 9U and an 11U at once has one of each. Never touches the rating math.                                                                                                                                                                   |

Two age groups running at the same time and not linked share no names, which is
what stops a 9U opponent appearing while logging an 11U game.
