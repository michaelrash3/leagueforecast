# Names, the Games tab and importing

_Part of the design documents; the map is in the repository's [README](../../README.md)._

## Names

Age levels are stripped everywhere: "South Lexington Red 9u" is stored as "South
Lexington Red". The age level is already carried by the age group, and keeping it
in the name would split one club into a new team every year as it plays up. A
bracket comes off as one thing, separator included — "Premier Ohio Lopez 9U/10U" is
stored as "Premier Ohio Lopez", not as "Premier Ohio Lopez /" — because the level
was read off the whole bracket, so the name has to lose the whole bracket. A club
pulled before that rule existed is found by its GameChanger id rather than by its
name, so nothing would ever heal it; its next pull cleans the stored name.

Clicking a team opens everything logged for it, and is also where a name is
corrected. **Renaming onto a name that already exists merges the two** — which is
how a game logged against "TBD", or a club typed two ways, reaches the team it
belongs to.

**What a club's panel says first.** Since 1 November 2026 the sheet leads with the club as
the board on screen places it: its place on the page's board and among its state's clubs there,
and its rating ("#17 of 190 nationally · #7 of 47 in KY · rating +2.5", read as the My Team
card reads its own, `myTeamGlance`), with no place for a club the board does not list; then its
record and form; then its games, those still to come soonest first with their starts, then its
results newest first, each day in words. The tools that change its data (its name, its
GameChanger links with Unlink, its age, Same team as and its state) are folded under **Fix this
club's data**, closed as the sheet opens: a button, so the keyboard reaches it and a screen
reader hears whether it is open, and whatever is typed in it stays while it is folded. The sheet
opened on those tools, a phone screen of them above the games (at 390 px the games began 917 px
down a 3,858 px sheet, the farthest-off first), with no place or rating at all, so the #1
club's sheet did not say #1 and a stray tap landed among tools that rename, unlink or fold a
club. Close and Watch are 44 px buttons where they were 33 by 16 px links. The cloud's board
draws the same panel and reads the place off the board it hands it; where nothing on the panel
can change the club, the fold is **This club's data**. Pool health's lists and the toast after
**Not this team** say their days in words too.

## The Games tab

The Games tab lists a page's games — pulled, pasted or typed in — for today
only, and no others until asked. Today is the reader's own day, as every date on
the page is read. The list began as a week either side of the app's last update,
and on 2 October 2026 the user cut it to today's games. A squad year today is
not in has no today to show: a finished season lists its last day with games,
and one not yet begun its first, so neither opens on an empty list.

**A day with no games.** Most weekdays in season have none, and the tab opened on
"No games today": a parent looking on a Friday night for Saturday's games had to
go to Show all. Since 1 November 2026 a day in season with no games opens on the
next day that has them, and says so ("No games today (Sun, Nov 1). The next games
are on Sat, Nov 7."), with **Last game day** a step back to the last day that had
them and **Next game day** forward again; with none still to come it opens on the
last. A day with games is listed alone, as the user ruled on 2 October, and a
season finished or not begun opens as above.

Nothing is out of reach. A line under the heading says how many games the day
leaves out, how many of those have no date and how many were due earlier and
still have no score, and **Show all** lists every one: the games still to play
first, soonest first by day and start, then the rest newest first, the undated
last (`everyGameListed`); a day's own list is in the same order, so a day ahead
reads its first start first. Newest first throughout, the farthest-off game led the
list, and on a seeded page of 2,693 games the next day's first game came 497th.
An old game is still scored from here. A score is two whole numbers of runs (`typedScores`); a Save
pressed with a box left empty says so, where until October 2026 it recorded 0–0. A game just added stays on the list whatever its date, so it
does not vanish the moment it goes in. On the pool of 29 September 2026 the 12U
page of 2027 held 45,107 games: 326 of them were that day's, against 11,348
within a week either side, and 2,465 dated earlier had no score yet. The list
still draws them a hundred at a time (`gamesWindow.ts`, `GamesSection`).

**One club's games.** A box above the list finds a club on the page by name and lists every
game it has there, whatever the day, newest first; **Every club** goes back to the day's list.
A club's season was otherwise a scroll through a whole page's games, every one of them listed.
Kept per page, as everything else the list shows is.

**What if?** Beside any game whose two clubs both have a row on the board on screen, on the
Games tab and in a club's panel, on the live board and this device's copy alike. It opens a
line under the game: the two clubs met today, on the ratings the board shows, worked out on the
device (`previewMatchup`) and said as Compare with says it (`forecastWords`), with the same
warning where nothing joins the two. On a played game it is what the board makes of the two
now, not what anyone expected then. Nothing is fetched for it (`WhatIf`).

## Importing

Paste games or pick a `.csv`. It is read on the device: no API key, no network
call, nothing to run out. Two layouts are recognised:

```
Date,Home Team,Home Team Score,Away Team,Away Team Score
August 22 2026,NV Stars Scout,12,Ambush,2
September 5 2026,Ambush,,NV Stars Scout,
```

```
Date,Opponent,Us,Them
2026-08-22,Velocirabbits,6,5
```

The first names both teams and needs nothing else. The second is one team's
schedule, so every score is from that team's side and the importer asks who that
is. Blank scores mean _not played yet_ in either layout.

Also read: spreadsheet (tab) pastes, headerless CSVs, `Home`/`Visitor` column
variants, a single combined `6-5` or `W 6-5` score column, quoted names
containing commas, a `Team` column crediting each row to that team, and schedule
lines like `SAT 22 vs. Velocirabbits W 6-5` under an `August 2026` heading.

Everything goes through a review table before it is saved. Two things are never
guessed: a year that is not in the data (`8/22` alone gets no date rather than a
wrong one), and a line that cannot be read, which is listed back as skipped.
Rows already logged here arrive flagged and excluded, placeholders (`TBD`,
`Winner of Game 3`) are called out, and a name close to a team already known
offers it as a one-click correction.
