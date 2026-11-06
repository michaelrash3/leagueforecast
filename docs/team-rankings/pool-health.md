# What a pull left behind, and what to check

_Part of the design documents; the map is in the repository's [README](../../README.md)._

A run over thousands of teams always leaves some behind, and a count hides it.
**Worth a look** lists every one, in three kinds:

| Kind             | What it means                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Not reached**  | The schedule never arrived — no such team, a refusal, a timeout, the proxy not deployed. Often worth another try. |
| **Not filed**    | It arrived with nowhere to go: no age group, no season, or a level below the youngest ranked here.                |
| **Check the id** | It arrived and was filed, but it is not the team the list named.                                                  |

Each team is one row. One that could not be filed and whose id also returned another team than the
list named is a **Not filed** row that says both, since the wrong id may be why: a pull of 4 October
2026 listed 39 such teams twice, once as filed. A team left for its own season — from a season the
pull was not asked for (`other-season`), or with no age and no games from a season not being played
(`out-of-season`) — is the pull doing what it was told, and the run's summary counts each kind in a
line of its own; that pull listed 283 of the second among its 5,668 rows. Either is listed after
all when its id returned another team, which is then the thing to look at.

A batch the proxy's host answers with a bare 5xx, no JSON in it, is tried again like a dropped
connection: every answer the proxy gives is JSON, so one without is the function falling over or
its host having no instance free, which passes. The same pull lost the ten teams of one batch to a
bare 500 that was not retried.

That last one exists because a twelve-character id is unreadable, so a wrong one
is invisible: the pull fetches whatever the id really is, files it under its own
name, and says nothing. The list already carries what each team was meant to be,
and the profile carries what it turned out to be, so the two are compared.

Which comparisons are worth making was measured on a real pull of 40,760 teams
where both sides described the same teams. The rule for each is whatever fires
on something worth seeing without burying it:

| Compared                        | Disagreed   | Kept                                                                                                                   |
| ------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| Name shares no significant word | 1           | yes — and that one was "SWS" for "South Wake Storm"                                                                    |
| Season                          | 0           | yes — free, and it catches an id reused for last year's squad                                                          |
| State                           | 174 (0.43%) | yes                                                                                                                    |
| Age level, by two or more       | 31 (0.08%)  | yes                                                                                                                    |
| Age level, by one               | 343 (0.84%) | **no** — in 267 the team's own _name_ held the list's level, so it is GameChanger's age group that wanders, not the id |

A name spelled two ways is never reported: "Trash Pandas" and "Trash Pandas
Baseball Club" share two real words, and only a name with nothing in common is
a different club. Nothing is corrected and nothing is held back — the schedule
is filed either way, since the profile is the better authority on a team asked
for by id. On that pull, 206 rows of 40,760 were flagged, one of them loudly.

Each row gives the team id, the name where anything knew one, the reason in a
few words, the sentence the failing layer wrote, and a link to the team on
GameChanger. **Download the list** writes the lot as a CSV, because a few
hundred rows is spreadsheet work rather than something to scroll on a phone —
the panel draws the first two hundred and the file has them all.

**Played against a stand-in.** **Check the pool** in Pool health counts the slots
and the clubs known only by name, and the results against them (`poolHealth`), and
says the share the owner tracks with exactly what it counts: of the pool's played
games, every squad year together, those with a club on one side and a slot or a
club known only by name on the other. The tile of slots alone is **TBD slots**; it
said "Stand-ins" until 31 October 2026, though it counted slots only, beside a
count of results against a stand-in that counted both. The nightly's share is
not this one: it is the stand-in report's, of one squad year's stored games with a
stand-in on either side ("The nightly refresh on GitHub"), so a game between two
stand-ins counts there and not here, and here every year counts.

**One squad on GameChanger twice.** **Check the pool** in Pool health also lists pairs of pulled
clubs that post the same games: at least two against the same opponent at the same minute with the
same result, with no game ever against each other and no two different games within the hour of each
other (`proposeTwinSquads`). Most are one squad set up twice under two names — a coach's own team
and a parent's, a tournament desk's copy, "BUCS DB" and "DB Bucs" — and each such game counts twice
for every club that played it. Two different games is read off the results, not the names: one game
each schedule typed its own way, "No Chance Wildthings" and "No Chance Wild Things" at one start
with one result, is one game. On the pool of 24 September 2026 the list held 55 pairs and 145 of the
283 games two pulled clubs held twice. One game in common is not enough: the same search with one
club's games moved a week found 68 pairs sharing one, against 125 on the real dates, and none
sharing two, a week or a fortnight either way. On the pool of 26 September it holds 76; folding each
takes 285 doubled games out, and the tidy after it 65 more, and moves 175 clubs' records, 172 toward
GameChanger's own, 121 of them onto it, and 1 away. Nothing is folded for you: **Keep** folds the
other team into the one you pick, with its games and its GameChanger link, and **Not the same** is
remembered against the two GameChanger ids. Where the two schedules named an opponent two ways —
"Thunderwolves" and "Thunderwolves Scout", or a club itself on GameChanger twice — the pool holds
two opponents, and the fold cannot make the two copies one game: after the 76 folds, 28 minutes on
the kept clubs still held two games against two opponents, most of them one game named two ways.

Until a pair is folded, and for a pair sharing only one game, which the list does not offer, the
tidy reads the copy itself (`markCountedElsewhere`). Club C's game against club Y that both C's and
Y's own schedules hold is the game; club X's own row of it, typed against C, at the same hour with
the same result from C's seat and held by no schedule of C's, is the squad's second GameChanger
team posting it again. That row stays where it is, X's game on X's page, but counts for nothing
(`ScoutGame.countedElsewhere`), so C is credited with the game once. Only a bare row is read, only
where one such game fits it and X's own schedules hold no other game that hour, and every tidy
reads it again: a score posted apart or Y's row gone, and it counts once more. On the backup of 11
October 2026, tidied, that sets 678 rows not to count, against 1.75 with each such row moved one
to four weeks either side, where its game is not (0.26%); on the backup of 25 September 2026,
before most of those second teams were pulled, 33 against 2.25. The list below, of clubs credited
twice, went from 957 groups to 279 on the first.

Where no such game fits within the hour, the tidy looks out to three hours, since a squad's second
team often lists the game at another clock, and reads the copy the same way where exactly one game
fits there. The owner chose this on 21 October 2026 knowing it is the weaker rule. On the 11
October backup it sets 52 more rows not to count, 41 of them within two hours, against 0.75 and
0.625 with each row moved one to four weeks. A week's move finds few games near a row, though, and
the games themselves say more: two real games of one club an hour to two apart, both held by both
sides' own schedules, give it one result 0.69% of the time (226 of 32,913), two to three hours
apart 0.80% (113 of 14,165), and those rows had 1,007 and 575 such games near them. So as many as
seven and five of the 52, about one in five, may be a real game the club's schedule left out, now
not counted. The list of clubs credited twice went from 279 groups to 227, all of them past the
hour (127 to 75), and a second tidy finds nothing more.

Past the hour the copying club's own schedules are asked about the game's hour as well as the
copy's (found by Codex on #432): a squad that played a game of its own when C played Y did not post
that game, and its row against C is a game of its own, C's own row of it missing. Of the 52, 14
were such a club's, and count again: 38 are set not to count, and the list reads 241 groups, 89 of
them past the hour.

**Clubs credited twice with one game.** **Check the pool** also lists every time a pulled club
holds two counted games on one day that start within the hour of each other with the same result
(`countedTwice`). A club plays one game at a time, so that is one game entered twice, nearly always
against two entries for one opponent: a club on GameChanger twice, a name spelled two ways, or a
stand-in beside the club it stands for. On the pool of 26 September 2026, tidied, pulled clubs held
3,771 pairs of counted games within the hour of each other on one day, 627 of them with the same
result, where two different results match about 0.38% of the time: about 12 by chance. The list
holds 591 groups at 547 clubs. Nothing is changed for you: each club opens from the list with both
games in its panel, and **Download the list** writes every group with both opponents and starts.

What the hour leaves over is read again out to three hours, where one of the two games is not on the
club's own schedule: a club set up twice on GameChanger often lists the one game at two clocks — the
Oilers' own 17-6 over "Top Guns" at 14:30 was Topguns' own copy at 16:00. Two games both on the
club's own schedule are its schedule saying two, a doubleheader with one score twice, and never
share a group past the hour. The hour's groups are read first and kept whole: on the pool of 26
September 2026 as main tidies it, all 509 stay and 127 are added (16 of them two clubs' own copies
of one game against the same opponent). The same search with the club's games moved a week, two or
three matched 0.41% of candidate pairs, so roughly one added row in eight to fourteen is two games
after all; they are marked **past the hour** in the card and the file, to be checked on GameChanger,
and one may be a copy to leave out rather than two entries to fold.

**Clubs filed at the wrong age.** **Check the pool** also lists the pulled clubs that look filed at
one age and play another in the squad year being played (`wrongAge.ts`): the Cincinnati Hornets
_Fall Ball_ problem, filed 8U by GameChanger's age field and playing 9U every week. A club on the
wrong board sits there all season, every game against the age it really plays read as playing up
or down, and its rating carries an edge it never earned. Two readings list one, each a rule about
evidence:

- **Its name and its opponents.** The GameChanger name of one of its squads that year states
  another age than it is filed at (the squads' names, since a club's own name often drops the age),
  at least two distinct pulled opponents are filed at that age, and they are a strict majority of
  the pulled opponents whose age is known.
- **Its opponents alone,** for a name with no age in it: at least three distinct pulled opponents
  at one other age, 80% or more of those whose age is known, met in at least two different weeks.
  The weeks are what keep out a club that played up at one tournament.

On the pool of 26 September 2026 that is 214 clubs by name, 170 of them filed younger than their
name says, and 39 by opponents alone, the Hornets among them; 201 and 41 on the 28th. A row withdrawn
by its own schedule, a club against itself and an opponent never pulled say nothing, and a club
whose age was set by hand is never listed. It is worked out in the tidy worker beside the other
lists, about a second on those pools. Nothing is changed for you: **Set 9U** files the club at the
age the evidence points to and holds it there through later pulls, exactly as setting it on the
club's own panel does (games moved, with an undo), in the squad year it was read in whichever year
the board is showing; **It plays up** (or down) says the age it has is right, remembered against its
GameChanger ids (`loadAgeRightClubs`), and backed up with the real clubs, so it is not asked again.
Under the list a line says how many clubs it is keeping off on that answer; **Show them** names
them, and **Put it back** forgets the answer, and the club is listed again.

**Leaders with few outside games.** **Check the pool** also lists every club in a state's top 10 or
the nation's top 25 on the board its page opens on whose group of the schedule, its community as the
rating's start reads it (**Where a rating starts**), has played fewer than 3 rated games outside
itself, or that is off the largest piece of the schedule altogether (`fewOutside.ts`,
`fewOutsideLeaders.ts`). The board a page opens on is the one it shows where the address names no
half: the calendar's half of its year, unless that half holds under a tenth of the other's counted
games, and the whole year for a page with no year; so the list follows the fall boards through the
autumn and the spring's once the spring is under way, as the owner reads them. Its rating starts at
its group's level, and nothing the group plays inside itself can say whether that level is right: a
club of a league that plays only itself can go 8-0 and lead its state, and its board cannot say
whether the league is strong or weak. Only games against teams outside the group settle it, and
GameChanger names those opponents on a schedule but gives them no id, so they have to be found by
hand and pasted into a pull. The list says which. It goes by state rank, a club with no state after
every club with one, then by national rank; each club says its page, the half its board is of, and
its places, its group once (how many entries, pulled, known only by name, entered by hand and TBD,
and its games outside it), and the opponents it played that are known only by name, with their games
against it and in all, under "Pull these opponents to connect its group"; where it played none of
its own, its group's, those known only by name and then the clubs in it entered by hand (a League
Standings team no pulled club stands for, or an opponent typed in), which no pull has linked to
GameChanger either and are found the same way; and only where its group holds neither, that every
team in it is already pulled. Each list of names copies one a line, ready to search GameChanger for,
and each club opens its own panel on the page whose board it leads. It reads the boards' own rows
and the fit they were cut from, built as the boards are built, on the device by the tidy worker and
on the server in the look's answer (`health.inspect`), so the two cards show one list. The live
page's look says the day the boards on screen were published for where it is not the device's
(between midnight and the night's rebuild, or all day while a rebuild is held), and the server fits
the list for that day, so its places are the boards'; the rest of the look stays on the device's
day. Nothing on a board, a club's panel or any other page changes, and no club or group is called
anything on it but what it holds.

On the owner's backup of 11 October 2026, read off the fall boards its pages open on (which held all
222,010 of the 2027 year's rated games, so they are its year boards to the digit), it held 1,160
clubs in 652 groups: 1,020 off the largest piece and 140 in it with 1 or 2 outside games, 141 of
them state #1s and 8 in a national top 25. Between them they had played 1,900 distinct opponents
known only by name over 2,928 games; 422 had played none of their own, and 192 of those are in
groups where every side is pulled already, with no one left to find; none of the four backups'
listed groups holds a club entered by hand, since they carry no League Standings season. On 25, 26
and 29 September it held 1,557, 1,581 and 1,413, each the measured list club for club, and on all
four the list off the boards the pages open on is the list off the year boards exactly. On the
seeded pool read on its April day, every page with a year opens on its spring board, and 12 of its
19 leaders lead a spring board without being listed off the year's. It comes with the look rather
than as the card opens because it is a fit of every year: 9.5 s on the 11 October copy in Node 24,
against 1.1 s for all the card shows as it opens. Pulling the opponents does not always join a group
to the rest: of the clubs listed in September and still ranked on 11 October, 653 were in groups
whose sides had played 3 or more new games across the old edge and still had fewer than 3 more
outside games, having met other thin groups. So a club stays on the list until its group has played
3 games outside itself, however many of its opponents were pulled.
