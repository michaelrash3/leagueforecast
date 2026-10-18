# League Forecast

A browser-first web app for league predictions, power ratings, matchup analysis, and forecast accuracy. All league data stays in the browser; the only server-side piece is one optional serverless function that writes the AI league story.

## Stack

- Vite 8 + React 19 + TypeScript 6
- Tailwind CSS 4 (configured in CSS; there is no tailwind.config.js)
- Web Worker-based Monte Carlo simulation
- Firebase HTTP functions for the AI league story (`server/league-summary.ts`, Gemini then Groq)
  and GameChanger pulls (`server/gc-team.ts`); Vercel serves the static website
- Vitest, with coverage reported (not enforced) on every pull request
- ESLint + Prettier

## Commands

```sh
npm install
npm run dev
npm run build
npm run preview
npm test
npm test -- --run
npm run typecheck
npm run lint
npm run format
```

Node `24.x`, pinned in both `package.json` and `.nvmrc` so CI and the deployment always agree.
Moving to a new major is a deliberate change to those two files, not something that happens on
its own the day one ships.

Dependency currency is handled by Dependabot (`.github/dependabot.yml`): patch and minor updates
arrive batched into one pull request a week, which CI builds, type-checks, lints and tests before
it can merge. Majors arrive one per pull request, because each is a migration — except the ones
that cannot install today, which are ignored by exact version so the pull request list does not
stay permanently red. `.github/dependabot.yml` names each, says what would unblock it, and says
how to re-check rather than trusting what it says. Ignoring by version and not by update-type is
the point: eslint 10 is skipped, eslint 11 will still get asked about.

## Two modes

The header switches the whole app between them. They keep separate storage and
separate teams.

| Mode                 | What it is                                                                                                                                                                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **League Standings** | One season of one league, on a fixed schedule. Final scores are all it asks for; the fuller box score is optional. Standings, power ratings, playoff odds, magic numbers, a simulated forecast.                                                                                   |
| **Team Rankings**    | Any team from any source, scores only — entered by hand or pulled from GameChanger. Tournament games, another league's results, an opponent you are about to play. Everyone is rated against everyone else, adjusted for who they played and for the age level they played it at. |

See [Team Rankings](#team-rankings) below for how the two connect.

**A season over New Year.** League Standings writes a date as "M/D", with no year,
and put every season in the order of one calendar year: a fall league that plays on
into January had its January first, and gave a January game as a team's next one.
A season is now ordered by its own dates. Its year turns in the month after the
longest run of months it plays nothing in (`seasonStartMonth`), so November to
January reads in that order everywhere a season is put in order — the next game,
the schedule, form and the Gold-odds trend, the timeline, the backtest and the
simulation's walk through the results — and a summer league running into August
starts in its June. A season inside one calendar year is ordered exactly as before.

## Features

| Area                      | Highlights                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Standings**             | Records, cut-line status, SOS, trends, AI league analysis or deterministic story.                                                                       |
| **Games**                 | Score entry, predictions, final toggle, filters, auto re-projection, fill from a pull.                                                                  |
| **Data Quality**          | Findings on the season's games, teams and settings, grouped by severity, with links to each, previewed repairs and undo.                                |
| **Since you last looked** | What another device changed since this one last looked, on the Dashboard until seen; opt-in notifications while the app is open.                        |
| **Season Predictor**      | Forecast board, bubble watch, cut-line games, game forecasts, trend charts.                                                                             |
| **Team drawer**           | Team stats, path summary, magic/elimination numbers, swing games, compare view.                                                                         |
| **Our team**              | The team this browser follows leads the Dashboard: place, record, Gold % and its last move, next game and seeds, magic number, a jump to enter a score. |
| **Settings**              | Season label, cutoff, points, tiebreaker, recap grouping, aggression.                                                                                   |
| **Power UX**              | Command palette, shortcuts, dark mode, share URL, CSV import/export, undo, onboarding.                                                                  |
| **Installable PWA**       | Installable via `vite-plugin-pwa` (basic precache).                                                                                                     |
| **A11y**                  | Dialog semantics, focus management, keyboard nav, labeled inputs.                                                                                       |
| **Perf**                  | Worker simulation, debounced updates, memoized lookups/scenarios.                                                                                       |
| **Team Rankings**         | A page per age level, national top 25 and state top 10, cross-age ratings, scouting report with next-game projections, CSV/paste import, team detail.   |
| **GameChanger**           | Pull a team list's schedules, resumable, on a weekly rota; pairings proposed for approval.                                                              |

## Architecture

A map rather than a manifest — the directories and the files worth knowing about, not every file.

```
server/
  league-summary.ts     # Firebase handler: AI recap of standings movement (Gemini, then Groq)
  gc-team.ts            # Firebase handler: GameChanger pull
scripts/
  poolFixture.ts        # a seeded pool of a real pool's shape, for the live views' tests and timings
  recencySweep.ts       # research: which recency scheme predicts best on a real pool
  sweepTidy.ts          # the pool it fits: a backup through the device's tidy, vouched clubs spared
  verify-gc-pull.ts     # the one check that talks to GameChanger for real
src/
  App.tsx               # League Standings: state, handlers and every view it renders
  main.tsx
  index.css
  lib/                  # pure modules; almost all the logic lives here
    types.ts  util.ts  format.ts  date.ts  csv.ts  validate.ts
    sim.ts                 # predictions, Monte Carlo odds, bracket odds
    powerRating.ts         # ridge-regularised opponent-adjusted least squares
    ratingRecency.ts       # how much an old result still counts
    predictionEngine.ts    # power ratings, recent form, confidence tiers
    magic.ts  clinchingPaths.ts  bracket.ts
    backtest.ts            # league-side calibration + Brier score
    scoutBacktest.ts       # pool-side hold-out, and the recency comparison
    insights.ts            # deterministic recap + league-story generation
    geminiModels.ts  leagueSummary.ts  leagueSummaryClient.ts
    scheduleText.ts        # reads pasted text / CSV into games, entirely on the device
    teamRankings.ts        # age groups, ratings, name matching, rename/merge
    teamRankingsStorage.ts # the pool's IndexedDB store, with a synchronous cache in front
    teamRankingsCompact.ts # the tuple-and-dictionary storage format
    live/                  # what a page knows (allKnown.ts), the views built from it (views/),
                           # the same in the browser and on a server, how a server
                           # publishes them for members to read (viewStore.ts,
                           # publishCopy.ts), and rebuilds them after a save
                           # (rebuildPlan.ts, rebuildLedger.ts, rebuild.ts,
                           # rebuildTrigger.ts, rebuildWorkerProtocol.ts)
    gameChanger*.ts        # pulling, importing, reporting and tracking a pull
    apiShared.ts           # handler types, client key and throttle, shared by both functions
    storage.ts  idb.ts  backup.ts  share.ts
  hooks/                # worker lifecycles, routing, shortcuts, theme, toasts
  workers/
    sim.worker.ts  rankings.worker.ts  tidy.worker.ts
    rankingsProtocol.ts  tidyProtocol.ts  # what crosses to each worker; pure, so tested
  components/
    league/             # League Standings views: standings, games, forecast, settings
    teamRankings/       # Team Rankings sections and cards
    bracket/  charts/
    CommandPalette.tsx  ShortcutsHelp.tsx  OnboardingTour.tsx  Toast.tsx
    GameChangerImportPanel.tsx  ScheduleImportPanel.tsx  TeamDetailPanel.tsx
  styles/
    tokens.ts  raceTone.ts
```

## Team Rankings

A separate ranking pool for teams from anywhere: tournament opponents, another
league, a club you are about to play. Only scores are entered — there are no box
scores here — and every team is rated against every other by the same
opponent-adjusted model the league uses.

### Age groups

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

#### Which age a team is

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
the opponents' names, where its opponents are filed, the clubs its games identify, or you) and
GameChanger's own age field verbatim (`ageLabel`), and the link line reads "filed at 8U, from its
league or organization on your list; GameChanger gives no age". The user asked on 28 September 2026
why a club whose name carries no age was filed at 8U, and nothing stored could say: the rules
that read opponents' names only run when nothing above them answered, so it was the age field or
the list, and which one was lost. A link pulled before this says nothing until its next pull.

#### High school squads are left out

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

| In the name or the age field                     | Read as                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| `Varsity`, `JV`, `Junior Varsity`                | high school, always                                                 |
| `JV/V`                                           | high school — the JV says the lone `V` beside it is varsity         |
| `HS`, `High School`, with no age label           | high school                                                         |
| `HS` with an age label — "Lincoln HS 16U"        | **kept**: a summer squad playing an age bracket against travel ball |
| A lone `V` on its own — "Madison V"              | neither; it goes to the review card, below                          |
| Any of the above under 14U — "Varsity Elite 12U" | **kept**: a travel club that likes the word                         |

Three edges are deliberate. A squad word wins over an age label, because a side
calling itself varsity is playing the school season whatever else it writes; the
letters have to be their own word, so "CHS Cardinals" is a club, not a school; and
one thing outranks both, which is an age nobody in high school could be playing at.
A freshman is fourteen at the youngest, so "Varsity Elite 12U" and "JV Sluggers 10U"
are travel clubs that like the words. That floor matters more than it looks: a
wrongly refused club leaves nothing behind to notice it by — no row, no count against
its name, nothing — so the rule errs towards keeping whenever the age contradicts it.

Their games go with them, and one of those losses is real: a travel side that
played the local varsity loses that result. It goes because the other half of it is
a club the pool refuses, and a game with one side missing is a dangling row rather
than a result. Carrying the handful that cross the line would mean carrying the
cluster they lead into, which is the thing this rule exists to avoid.

#### Softball, and pages that are no team, are left out

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
still counts for both sides: see [Playing up and down](#playing-up-and-down).

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

### A page per age level

The season year is a picker and the levels below it are tabs: pick 2028, then
move along 9U, 10U, 11U. Changing the year holds the level where the new year has
one, so walking a squad forward is one control rather than two.

Each page is a URL — `?view=rankings&age=10&year=2028` — so a page can be sent to
somebody rather than described to them. The URL is what decides the open page,
which is what makes Back and Forward move between them. A link naming only a year
opens that year's youngest page; only a level opens it in whichever year has it;
a link to a page that no longer exists leaves the view where it is and the URL is
corrected rather than obeyed. `?view=` carries the mode too, so a link opens in
Team Rankings instead of wherever that browser happened to be last.

**A default age.** With no page in the link, Team Rankings opens on the age chosen
under the age tabs ("Open on 9U by default"), on this device. It is kept as the
group grows up rather than as one page: the user's rule was "If I have 9u as my
default in 2027, I will want 10u as my default in 2028", so the pick is read as a
class, its year less its level, and each season opens that class's page in the
squad year being played — 10U in 2028, 11U in 2029 (`defaultPageFor`). While a new
season's pages have yet to be made it opens the latest year that has the class's
page, and with none, the first stored page as before. A link naming a page still
wins, and choosing another tab during a visit is unchanged; the default only
decides where an open lands.

A page leads with a **national top 25** and a **state top 10**, the state being
the default state below where one is kept, then yours where it is known, and
otherwise whichever has the most teams there. The place shown in each is the
place in _that_ list: a state top ten is ten teams rated against the whole country
and then listed together, so the second-best team in the state is #2. The full
table is behind a toggle, for finding one particular team in a pool of thousands.

**A default state.** Beside the state top 10's picker, "Make OH my default"
keeps the state on screen as the one the card opens on, on this device, as the
default age is kept; on that state the card says "Opens on OH" with a Clear. It
opens there on every page with a ranked club from that state, and on a page with
none it opens as it did before, the default kept for the next page that has one
(`defaultStateOf`). Both boards read it, the cloud's and this device's. Picking
another state during a visit is unchanged and keeps nothing. Either button lets
go of a state picked in the select, so the default places the card from then on:
making one leaves the card where it is, and Clear opens it as it would with no
default, on this page and the next.

**Which half a page opens on.** The fall and the spring are two tables, and with no
half in the link a page opens on the one the calendar is in, unless that half holds
less than a tenth of the other's counted games (`HALF_WORTH_SHOWING`). A winter's
tournaments are a sliver of an autumn: the 26 September 2026 pool held 150,408 games
scored in August and September and 317 scheduled for all of January and February.
Opened on the calendar's half the day it held any game, the board went to the spring
on the first January weekend anywhere in the country, a table of a few Florida and
Texas clubs. The halves are counted by the rule the fit counts by (`countsTowardRating`),
so a score typed ahead for March, or a game kept only for the record, is not a spring
either; the pool of 26 September already held two scores dated March 2027.

Above both, the team marked as yours (★) gets a card of its own: its place in the
whole table and among its own state's clubs, its record and rating, and its next
game with the chance to win it (`myTeamGlance`). "Where are we ranked?" is asked at
every field, and without the card the only answer was Show all and a hundred rows
at a time. The card reads only what the page already has, so it costs nothing.

**Movement since last week.** The national board and the card mark how far each
club has moved since the board of a week ago: ▲3, ▼5, or "new" for a club that was
not ranked then. A board keeps no history, so last week's is fitted again from the
games played by then (`ranksAsOf`), once the board on screen is up, in the rankings
worker for a large pool. That fit gives every page of the year at once and only its
places are kept, a number a club, rather than a second year's fit of about 44 MB. The
worker answers each tab of the year from what it kept, except a page too young to rank,
which has no places of its own and leaves none for its siblings: before that was kept
apart, a reader who opened 8U first saw no arrows on 9U. A result posted since for a game played before that day is counted in it, so last week
recomputed can differ from what was on screen then. In the first week of a half there
is no board a week ago and nothing is marked.

**The rank line.** Under the card's place, a line of the club's place week by week:
last week's board, then each week before it, then today's, first place at the top.
Each week is another fit of the year as it stood that day, so the worker is asked
for them one at a time, naming the club so only its place comes back, and keeps every
board of a line and one more (`RANK_HISTORY_WEEKS`, eight at most, so nine boards, about
28 MB on a year of 76,792 clubs), so walking it does not push last week's out and going
back to a page fits none of them again. A page switch waits on at most one week's fit,
and the walk stops at a week whose board was empty, where the half had not begun, or
at two weeks running without the club on it. Nothing is drawn until two weeks have a place.

### Scouting report

Pick a team and it answers two questions. **Next up** is the games still on that
team's schedule — a pulled GameChanger schedule carries its future fixtures with
no score, so they are already in the pool and nothing has to be typed — each with
the date, the opponent's rank, the projected margin and a win probability. An
opponent nobody has pulled has no rating, and the row says "not rated here yet"
rather than inventing one. Below it, the same projection against every ranked
team on the page, which is the question to ask before entering a tournament.

**Compare with** sets a second club beside the report's and answers first, right
under the two boxes and above the write-up of the team's rank: who should win, who
should lose, by how many runs, and each side's chance ("Hill Hawks should beat River
Otters by 2.3 runs. Win chance: Hill Hawks 64%, River Otters 36%"). The numbers are
`previewMatchup`'s, the same the report gives that club added by name, put into words
by `forecastWords`; a margin too small to move either chance off 50% is called dead
even rather than handed a winner. It carries no caveat, even for two clubs nothing in
the pool joins: every forecast is an estimate, and the answer is what was asked for.
A club picked on another page that is not ranked on this one says so. The answer
needs only the two ratings, so it shows the moment a club is picked.

Under it, the reason for it (`compareClubs`): the games the two played against each
other, every club both have played with each one's score against it ("we beat the
Bears by 5, they beat them by 1"), and each side's best wins and worst losses by the
rank of who it was against, and its last five. It reads the games the board counts,
in the half it is showing, each score as that club's own schedule gave it. Two
results of one day stay in the order the pool lists them, as a club's panel lists
them. The forecast is one number; this is the evidence it is made of. Names and
scores only.

**Tournament field** plays a weekend out before it is played. Build the field by
name, or from the report team's own next opponents in one press, choose pools and
a bracket of two, four or eight, and the event is simulated 2,000 times on the
board's ratings (`simulateTournament`). The field is drawn into pools by snaking
down the ratings, as organisers do; each pool plays a round robin; the clubs with
the most pool wins go to a single-elimination bracket seeded on those wins; each
game is won with the scouting report's chance. Ties on wins are drawn, because a
tournament's run-differential rules are its own. The panel gives the field's
strength (average rating and rank, and its best club) and each club's chance to
win its pool, reach the final and win, marking as a guess a club whose rating was
worked out against a different set of teams from most of the field. Fields are
saved in this browser by name, per age group.

The projection is the rating difference, capped at 14 runs, put through a
logistic curve; no home-field term, because at this level which side is "home" is
a coin flip. The curve's spread rises with age, 3.75 runs at 8U and 0.10 more a
year, because a margin says less about who wins as players get older. It was 2.8
at every level, and on the pool of 26 September, fitted up to three different
days and scored on the games after each, that was overconfident: favourites it
called at about 75% won 69 to 71% of the time, and at about 85% won 82 to 83%. A
spread rising from 2.95 by 0.09 a year fixed that for ratings capped at 8 runs;
when the cap went to 12 (below) the ratings stretched and the spread was fitted
again, the same way, through the app's own fit. Favourites it calls at about 75%
won 73 to 75% of the time, and at about 85% won 85 to 86.5%. The cap and the
curve move together: cap 12 on the old curve read worse than cap 8 on it.

**What if?** Under each fixture is the question the projection cannot answer: not
who is favoured on Saturday, but where Saturday leaves you. A rating here is not a
property of a club — it is the solution of one least-squares fit over every counted
game in the pool — so the answer is the whole table fitted again with the result in
it. The panel shows a rung per whole run, from a defeat by twelve to a win by twelve,
each with the place it would leave you and how far that moved you.

It is a margin table rather than two buttons because the margin is the larger half of
the answer: winning by one against winning by twelve moves a club further than winning
against losing at the projected margin. Twelve is the top rung because `RATING_CAP` is
twelve, so a 13-1 and a 20-0 are the same evidence.

Three fits are enough for all twenty-four rungs, exactly. The fit is least squares and the
cap is applied before it, so within ±12 runs every fitted rating is affine in the margin
assumed, and the two ends give it at every margin between. The shown rating is that less
an evidence discount: the pool's residual scale times a number fixed for each club, its
games weighed by its opponents', which no margin changes. The scale is not linear, but its
square is the mean of squared residuals, each affine in the margin, so it is a parabola,
and a third fit at a tie pins it. A straight line between the two ends missed a real
re-fit's rank 2 times in 160 synthetic cases with stand-ins (at the cap of 8 then in use);
drawn this way there are none, and the worst rating error is 1.6e-10 runs.

The discount weighs each game by what it can say about the club: `1 - 1/(1.5 + the
opponent's games)`. A win over a stand-in seen once mostly pins the stand-in, which has
nothing else to go on, and leaves the club 0.6 of a game, what the ridge leaves it; a win
over a club with twenty games leaves 0.95. So eight wins over one-game stand-ins are
discounted more than eight over clubs with seasons of their own, and the Games column still
counts every game. On the 2027 year of 26 September, with the cap then at eight and the
win-chance curve fitted to it, fitted as the app fits it and scored on the next week's
same-level games at eight cut days, the Brier score improved at every cut, −0.00010 ±
0.00002 over 73,614 games; thinning every count by the pool's average ratio, or shuffling
which opponent a game was against, gained nothing, so it is the opponents that help. The
shown win chance moves a median 0.14 points. On the 14U 2027 board of the same pool,
"Florida", 19-2 with all 21 games against stand-ins or slots, goes from #22 to #24, and
Texas Edge Black, 5-0 against clubs, from #24 to #23.

Nothing in the panel is coloured by outcome. Winning is not always good news and
losing is not always bad: a narrow loss to a much stronger club can lift a thinly
played side, because the table rates who you played and one more game is one more
thing the rating stands on. Measured on a 40-club pool with the cap then at eight, a side
with three games that loses by two to the best club in it goes from #31 to #27.

The hypothetical is fitted as if the game were played today. That is deliberate and
the alternative is worse: older games count for less, so a result dated weeks ahead
arrives as the newest thing in the pool and outweighs the season that has actually
happened. A fixture in the other half of the year, one with no date on a half board,
and one against a club nobody has rated are all refused rather than answered — the
first two would move a table they do not belong to, and the third would add a row to
the table instead of moving one within it.

### How the two modes connect

**League → Team Rankings, always.** A season assigned to an age group brings its
whole schedule: upcoming games show their opponent right away, and once a game is
scored in League Standings it counts as a final here too.

**Team Rankings → League, by choice.** Tournament results sharpen that league's
_opponent-adjusted power ratings_, the matchup analysis built on them, and —
through those ratings — the Forecast board's game picks, the simulated season,
playoff odds and the bracket. See the `useScoutResults` setting. They help most where a
schedule is thin: two teams who never met become comparable through an opponent
they both played elsewhere. The Power Ratings' recent form and trend count them
too, since a tournament last weekend is how a team is playing now; form walks league
and tournament games together in the order they were played, by the day and not by
the text of the date. Records, standings, elo and the standings' strength of
schedule stay league-only. Games carried in from the league are excluded on the
way back, so nothing is counted twice.

**Which club is which, answered once.** The two halves keep separate ids for the
same club and rarely agree on how long a name is — a league roster saying "Trash
Pandas" against a GameChanger team called "Trash Pandas Baseball Club". Matching
on the name alone was a guess that failed silently: that club's tournament
results were filed under an opponent of their own, where they sharpened nothing,
and nothing anywhere said so.

**Which Team Rankings club is each team?**, in Settings, asks once and keeps the
answer. It offers the clubs that could be this team, ordered by how many of that
team's own league opponents they have also played, since a schedule is far harder
to coincide with than a name: "Trash Pandas Baseball Club — Hebron, KY · 2
opponents in common: Bears, Cougars". Each row says where it stands — a **Guess**
matched on the name and is not confirmed, **Which one?** means two clubs share
the name and neither has played anyone you play, **Not here** is an answer rather
than a gap, and **Clash** means two teams picked one club so neither counts.

The same evidence settles the guess: where two clubs share a name, the one that
has played the clubs you play is taken, and where that is not decisive the panel
says so rather than crediting both clubs' games to whichever came first. The
header counts what is linked and how many outside results are counting, so a
league that is contributing nothing cannot look like one that is.

A pick is stored on the league team, so it rides that season's backup, duplicate
and undo. Share links deliberately leave it out: a pool id is minted in the
browser that made it and means nothing in anyone else's.

A pick is by id, so a club the league reaches only through picks can be renamed on
Team Rankings and keeps the league's games. A club any season reaches by its name
(a guess, the roster's club of that name, or two picks that clash) has its name
locked, because renaming it would move the league's copy of a game off the club
while the pull's copy stayed, and the game would count twice. Renaming a picked
club to another club's name merges the two and removes the club the pick pointed
to, and the panel says that pick must be made again in Settings.

**Team Rankings → League scores, on request.** Once a club pulls its own
GameChanger team, every result of its league season is already in the pool, and
typing those scores a second time into the league schedule is work the app can
do. **Fill scores from Team Rankings**, on Games, offers them.

It matches a league game to a pool result on the two teams and the day —
the league stores a date as month and day, so that is the common ground — within
the age groups that claim this season. It fills runs, and only runs, which is
everything the standings, the records and the projections are built from.

Nothing is written before the review is read, and three rules keep a wrong score
out of a table nobody can check:

| Case                                 | What happens                                                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| The league game is blank             | Filled, and marked final. Ticked by default.                                                               |
| The two spell a club differently     | Offered as **Check name**, with both spellings shown. Never applied unasked.                               |
| The club's own row names only a slot | Offered as **Check opponent** — its only league game that day, against "TBD". Never applied unasked.       |
| The two clubs' schedules differ      | Both scores shown and either can be filled. Ticked only when they agree on the winner (**Check score**).   |
| A different score is already entered | Shown side by side and left alone unless that row is chosen by name.                                       |
| A pairing plays twice on one day     | Paired in schedule order when both sides have the same number of games; otherwise reported, never guessed. |

**Games the schedule is missing (3.7).** Where both teams of a game are linked to their clubs,
Fill scores also lists the pool's played games between two of the league's clubs on a day the
schedule has those two meet nowhere (`LeagueFillPlan.missing`), to be added with their score,
final. The second game of a doubleheader the league scheduled once is not offered: it is as
likely a scrimmage, and is left to be added by hand. A game that looks like a tournament's
(`tournamentReason`: entered under an event, or either club played somebody else that day) starts
unticked, and since GameChanger's schedules do not say who was at home, each can be swapped.

**Starting a season from its clubs (3.7).** A new season can start from Team Rankings instead of
from typed names, a CSV or the demo: **Start from Team Rankings clubs** on the empty season's
page. Pick a Team Rankings page (the one of the baseball year being played comes first), the
league's clubs on it (the clubs the hand picker offers, GameChanger's at that level or one
below), and the days to look in (the half being played, to begin with). The pool's games among
those clubs come back by day (`draftStart`): played ones with their score and, where the two
clubs' schedules disagree, the other club's version said beside it; ones still to play blank; a
likely tournament meeting unticked. Untick what is not the league's and swap what is the other
way round, and the season is made (`seasonFromStart`): a team per club, named as Team Rankings
names it and linked to it (`scoutTeamId`), and a game per one kept, the played ones final. Only
the name and the link are taken from a club, never its coaches. The season is then put on the
page it was started from, as Setup's League seasons card puts one (`season.assign`), so the
forecast and Fill scores read the right page from the first game. Every step is the same code
on this device's pool and on the server's (`answerStart`, the `league.start` question), so a
member's phone, which holds no pool, sees exactly what a visitor's browser works out. One Undo
takes back the teams and games; the season stays on its page, where an empty one changes
nothing.

The league and GameChanger rarely agree on how long a club's name is — "Trash
Pandas" against "Trash Pandas Baseball Club" — and a league game left unmatched
looks exactly like one that has not been played, which is what makes silence
here dangerous. So a game the names missed gets a second look against the
results on its own day, under the looser rule the importer already uses, and
anything that lines up is offered rather than applied. Correcting the name in
Team Rankings makes it match on its own from then on. Two clubs close enough to
be confused with each other on the same day are reported instead: "South
Lexington Red" and "…Blue" are four characters apart and are two real teams.

A league team linked to a club in Settings is that club whatever either half
calls it, so it fills as plainly as a name that matches, and its games are read on
every page of the squad year rather than only the pages claiming the season: the
Cincinnati Hornets' fall team is listed at 8U, and its copy of the league's 25
September game sat on the 8U page. Unlinked, another page's club of the same name
is as likely the same organisation's older squad, so it is left alone.

A club's own schedule that was never told the opponent files the game against a
slot, "TBD- 09/25/26, 7:15 PM", and when the other club's schedule is not in the
pool nothing names the game at all. So a league game neither pass can see gets a
last look: the same club, off its own schedule, against a slot on the day of its
only league game, and its only such row. It is offered as **Check opponent**,
never ticked. Stand-ins are not taken, only slots: hiding each real game on the
9U page in turn, taking stand-ins as well offered a different game in its place
9.1% of the time, slots alone 1.5%.

The two clubs' own schedules disagree about one two-sided game in ten on the 9U
page, mostly by a run. Both versions are shown and either can be filled; where
they agree on the winner the fill stays ticked, and where one has a different
winner or a tie it waits as **Check score**.

Games the league itself put into the pool are excluded on the way back, so a
season can never confirm its own scores. Anything already typed into a game —
hits, strikeouts, the innings it was stored with — survives the fill untouched.
So does a score typed in after the review was made: a game whose runs or final
mark have changed since, while the review was open or while the server was
asked for it, is left as it is, and the message says how many were.

**One fixture, one game.** A club that tracks a league here and also pulls the
GameChanger team playing in it has the same fixture twice over: once derived
from the league schedule, once pulled. The pool counts it once, preferring the
league's own record where the league has scored it, so a rating never counts a
game twice. The day is what decides this — the same two clubs meeting on another
date played outside league play, and that game stands on its own. Results
carried back into the league's own forecasts skip its fixtures for the same
reason, whether a club's names match on both sides or it is linked to its league
team under another.

Both copies have to name the same two clubs for that to work, so a league team is
carried in as the club **Which Team Rankings club is each team?** links it to — the
pick, or the guess — and only a team with neither goes by its name. By name alone
it went to whichever club of that name the roster listed first: a Cincinnati 9U
league's "Cincinnati Angels- Red" landed on an 11U "Cincinnati Angels Red" pulled
earlier, the Trash Pandas' own pull had the same game against the 9U club, and the
board showed them 0-7 against GameChanger's 0-6.

A team answered **Not here** is carried in as a club of its own, named as the
league names it, which no name ever leads to: not a league team's name, not the
link panel's guess for a team nobody has answered for, and not a name a pulled
schedule writes, however a game has come to be filed against it. Carried by its
name, as it was until
October 2026, its games landed on a club of that name the person had just said it
is not. The club's id is read off the name ("S-off-" and the name's words, and
for a name with anything but plain letters, digits and spaces, the whole name
written out in base64url after an underscore, so "A.B" and "A B" are two clubs), so it
is the same on every pass and every device, and one already saved to the roster,
as marking it "our team" saves it, is the one carried onto again, under the
league's name: renamed while no league game on the page locked its name, it would
have had the copies of its games read against a name the league never gave it.
Teams answered Not here under one name, on any page of the year, are one club, as
a name is everywhere else. Every other copy of such a game names some other club of the
team's name: a stand-in the import made for it, a pulled club the import filed it
against, or a club typed in by hand. Such a row is filed with the league's own
game when one of its clubs played the team in the league that day, in the same
rating pool, and its other club's name fits the team's; for a league game between
two such teams, when its two clubs fit one name each. With only one league game it
could be, the rules for any copy of a league game then decide which survives,
so the game counts once whatever the copies say the score was, and once on the
schedule before it is played. The league's forecast reads such a row the same way
and leaves it out of the results it takes from Team Rankings, since the league's
own schedule already has the game. A copy kept in the league game's place, while the
league has no score for it, is read as the team's own club's game, not the game
of the club its name led to. A row between two of the league's own clubs goes
with their own league game first. An answer is the season's, as the link panel
shows it: a team answered Not here in the fall and not in the spring is two clubs
on the board until it is answered in both, and a star or state set on the club
its name reached before the answer stays on that club. A game typed in against
the name no longer warns that it is logged already, though it is still counted
once.

A club's own schedule sometimes files the league game against nobody the league
names — a slot such as "TBD- 09/25/26, 7:15 PM", or a one-off spelling of the
opponent — and when the opponent's own schedule is not in the pool, nothing else
pairs it. Such a row, pulled from the club's own schedule and never one typed in
by hand, is the league game when the club, the day and the score from its side
all agree, and only one league game of the club's that day fits; the league's
copy stays, since it names the opponent. 513 Force - Bouley's 0-13
to the Cincinnati Hornets on 25 September was two losses until this, and two
more of that league's games were counted twice the same way, from the Angels'
and Headlines Nagel's schedules against a "513 Force" known by no other name.
Each club's own copy is read on its own, so when both schedules filed the game
against nobody, both copies go. The league's forecast leaves the same rows out
of the results it reads from Team Rankings once the league has the game's final
score, so they are not counted twice there either.

Both passes look across the squad year, not only the page that claims the
league, because the rating is fitted over the year and a club filed at another
age files its own copy on that age's page. The Cincinnati Hornets' fall team is
"Cincinnati Hornets \*Fall Ball\*", which the app filed at 8U — its name carries no
age — and its rows of the league's 9U games sat on the 8U page, never matched. The
name guess cannot find that club — its name is not the league's and it has no game
on the 9U page — so the league's Hornets have to be linked to it in Settings, with
the wide search, or its age set to 9U on its panel, which moves its games onto the
9U page (see **Naming an age**).
Linked, the pool of 27 September with the three October games played counts
every league game once (Yeager Dreyer 2-0, Headlines Nagel 3-0, Trash Pandas
0-7); unlinked or linked to the 9U listing, four were counted twice either way.
The forecast still reads page by page, since it reads only the pages that claim
the league.

### Placeholders

"TBD", "Winner of Game 3", a blank cell on a bracket: a schedule says these when
nobody has decided who is playing yet. They are kept as **slots**, not teams.

The game is real, so it is kept and it counts for the club that played it — a
slot stands in the fit as one unknown opponent, and beating one reads much like
beating an ordinary team. What a slot never does is gather. Every placeholder is
its own slot, because a single shared "TBD" would sit in the rating graph as an
opponent that dozens of unrelated clubs had all played, and the model would read
that as evidence about how they compare to each other. Slots are not ranked,
never offered as a name to log a game against, and never matched to a real club
that looks similar.

A slot is not a club even when GameChanger has a club of that name. Coaches make
teams called "Tbd", "Practice", "Scrimmage" or "14U" to hold a date, and a
nationwide pull fetches them like any other (the import now refuses a "Practice" or a
"Scrimmage" outright, and the tidy deletes one already pulled; **Softball, and pages that are no
team, are left out**); filed on one, every undecided game in
the country joined it, so a Puerto Rico club's "TBD" and an Ohio club's sat on one
Washington "Tbd". A name that could be nothing but a slot — the whole of it a slot
word, a round, an age, or "TBD" and when — is filed as a slot whoever carries the
name (`namesNobody`), and the tidy takes rows filed on such a club by name off it
again: 25 rows on the backup of 26 September 2026. The club's own schedule is left
alone. A longer name still goes to the one pulled club that carries it, since a
club really can call its squad "Miami Bulldogs Tournament".

**One fixture listed twice on a club's own schedule.** GameChanger does this: the
same game arrives under two game ids, with the opponent spelled two ways —
"Cincinnati Angels Red" and "Cincinnati Angels- Red", 13-21 on both — and a club's
record counted the loss twice. The opponent resolves to one team either way, since
`teamNameKey` reads punctuation between words as spacing; it was the two rows that
stayed two games.

Two ids off one schedule are normally two games, and that stays the rule. A real
pull found four games against one club on a single day, and folding those together
would delete three results. The exception is narrow and rests on a fact rather than
a guess: **nobody plays two games at once**, so where both rows carry a start time
and it is the same one, there is only one fixture there. "The same one" means under
a minute apart: 1,013 rows of the pool of 24 September 2026 started at an odd second
or millisecond, and 12 pairs off one schedule were a fraction of a second apart.

The same fact settles it when the two rows disagree about the score. Two different
results at one start time is a disagreement about one game, not two games — keeping
both counted a loss and a win for a game played once. The game keeps the score the row
it stands on gives, and the other listing's is written into the game's note, the way the
two sides of a fixture that disagree are already noted, so nothing is lost silently.
Where the row the game stands on has no score, the other listing's fills it, marked as
that listing's (`scoreFromTwin`): it goes with the listing if the two turn out to be two
games, and gives way the moment the game's own row posts. Kept as the game's own, a
listing's score stayed behind when a doubleheader first listed at one placeholder start
came apart, and the result counted twice.

Within the hour, one schedule's two rows are one game only when they give the same
result. A coach writes a doubleheader down at its slot times, and the same pool held
109 pairs of rows exactly an hour apart with two different results — 23-6 and 12-2 —
that are plainly two games. A repeated result is different: of 212 scored pairs off
one schedule within the hour, 34 gave the same result (16%), against 81 of 6,044
pairs two hours or more apart (1.3%), which are doubleheaders. That is the same game
listed twice.

Where a start time is missing from either row the two are kept, however alike they
look — with nothing to tell a repeated fixture from a repeated row, losing a real
game is the worse error.

An all-day entry counts as having no start time. GameChanger writes a start for one
anyway, midnight UTC with no timezone in the entries audited on 24 September 2026,
and read as a time it made every all-day game on a date the same instant. Its date
is kept and the placeholder is not.

**One game on two clubs' schedules.** A start on a schedule is when the game was
planned. A tournament runs behind and neither coach moves the placeholder, so the two
clubs' copies of one game drift apart: Legacy Baseball Club had its 14-2 win over
River City Raptors on 29 August 2026 at 1:00 PM, the Raptors had it at 2:00 PM, and the pool
held it twice, because two starts used to mean two games whoever wrote them down. On
the pool of 24 September 2026, 1,213 pairs of rows off two schedules gave the same pair
the same result on the same day at different starts; the same search a week off, where
no game is, found 7.

So a row off the other club's schedule can be the same game on any of these, strongest
first:

| Two clubs' copies of a day's meeting                         | One game?                                   |
| ------------------------------------------------------------ | ------------------------------------------- |
| Starting within the hour, with the same result               | Yes — 1,115 of the 1,213 were within it     |
| The same result, however far apart the clocks                | Yes, the nearer the likelier                |
| At the very same start, a result still to come on one side   | Yes                                         |
| Starting within the hour, a result still to come on one side | Yes, the nearer the likelier                |
| No start on one side                                         | Yes, a copy with a result first             |
| Starting within the hour, scored differently                 | Yes, each club keeping its own score        |
| Neither, left on each schedule that day with nothing to pair | Yes, by count, as many as the shorter list  |
| The rest of the longer list                                  | No — that is a game only one of them listed |
| A day apart, the same result or the same start               | Yes, where nothing else those days could be |
| On two GameChanger teams of one club, left by the links      | No — one club's two teams are not a count   |

**A day is read whole.** Which copy each game takes is decided for the whole day at once
rather than a link at a time (`planDay`): every way of pairing the two schedules' games is
weighed, and the one that best accounts for both schedules together wins. The strongest
single link first used to lose a result wherever it was the wrong link for the day — three
review rounds found one shape after another — and each rule added to rank one link over
another moved the loss to another shape. The weighing:

- **Both schedules' games in both schedules' order.** A coach lists the games in the order
  they were played, whatever the clock says, so first pairs with first. Legacy posts game 1
  of a doubleheader as an 8-11 loss and the Raptors post game 2 as an 11-8 win an hour
  later: the Raptors' copy belongs to game 2, not to game 1 because the score repeats. And a
  clock exactly an hour out all day pairs 9:00 with 10:00 and 10:00 with 11:00, rather than
  the two 10:00 rows. Rows with no start fit wherever they fit best.
- **A result that agrees outranks a copy with nothing in it, however near.** Taken for a
  blank game beside it, a copy's result counts twice until the other game is posted, and for
  good if that game was a slot never played. On the pool of 24 September 2026 a 9U club with
  four games was charged one 9-12 loss twice that way. Taken for the game it repeats, the
  worst is a result missing until it is posted, and once both clubs have scored everything,
  the same result within the hour puts each copy where it belongs.
- **A scorekeepers' dispute is worth little** — two different results within the hour are
  one game when nothing else explains them, but never at the cost of a result that agrees —
  **except at the very same start**, where two scores within four runs of each other are one
  game ahead of a blank copy elsewhere. Of the 131 games two schedules scored differently in
  the pool of 24 September 2026, 94 were a single run apart and 117 within four. A wider
  dispute is still one game where nothing reads better — mostly one entry's slip, a 13-6
  win entered from the wrong seat or 20 typed for 11 — but it is worth no more than the
  least of disputes, so a 4-4 at the same start as a 0-10 does not outbid a clock an hour
  out.
- **A result is never lent to a blank game while a scored game it could be, at least as
  near, is left with no copy of its own** — one with the same result, or within four runs:
  it would count twice. A 4-4 at 10:00 against the other club's 5-4 at 10:00 once went to an
  all-day blank on one schedule and stood as two games; where the nearer game has a copy of
  its own, as in a doubleheader whose clocks sit an hour apart, the result is the blank
  game's to take.
- **One schedule repeating a result within the hour is that schedule listing the game
  twice** — worth less than any pairing of those rows with the other club's copies, so it
  is read that way only where the other club does not list a game for each. A mercy-rule
  doubleheader, 10-0 twice, stays two games wherever the other club lists both slots,
  posted or not, timed or all day. A game listed twice is as near the other club's copy as
  the nearer of its two rows.
- **Two copies that contradict are never one game** by any link, but **what the day leaves
  is settled by count** (`pairedByCount`). Two clubs each list every game they play each
  other, so a game on one schedule that nothing on the other accounts for is one of the
  other's, under a clock or a score that did not read as it: a tournament running behind with
  nobody moving the placeholders, a coach's GameChanger set to another zone, 3:00 typed for
  15:00, two scorekeepers who disagree. On the pool of 24 September 2026, after the links, 786
  days still had such a game on each schedule, each counted twice; 660 had one a side, 432 of
  those at clocks a whole number of hours apart — 199 two hours, 58 twelve. So as many are
  paired as the shorter list holds, whatever they say: in both schedules' order first, as the
  plan itself has it — paired for two scores four runs apart, a club's two wins on a clock four
  and a half hours out became one game — then the pairing whose copies read most alike (the
  same result, a dispute within four runs, a start twelve hours out), then the nearer starts. A
  club's 8-3 win at 19:00 goes to the other's 6-8 loss at 15:30, not its 0-2 at 17:00. Two
  GameChanger teams of one club are not two accounts of a game, so they are never paired by
  count: each lists its own games, and a result paired wrongly would be lost.
- **The same rows read the same way whatever order they were pulled in.** A copy is read
  by its scored rows and the best of them, and every choice between readings falls to the
  rows' ids, never to their place in the pool: a fuzz of 2,000 days found 50 that read
  differently when only the order of their rows changed, until that was so.

Each schedule's rows at one start are one game before any of this (nobody plays two games
at once). Days with a row that no schedule stands behind, such as a game typed in by hand,
or with three schedules, are few (one in the pool) and are still settled a link at a time,
with the same guard against contradicting copies. A game takes one row off each schedule,
and two games that each hold a row off both schedules stay two unless the rows share a
start.

**A day apart.** One club can date a game a day off the other: a date typed a day out, or a
game moved to the next day on one schedule only. Once each day was read whole, 466 pairs of
days in that pool had a game one club listed only on the first day and the other only on the
second; in 432 each club listed just that one game, and 212 of those gave the same result on
both schedules, 142 at the same clock time a day apart. Across two days that follow each other,
a game only one club accounts for is joined to the other club's on the same result — before
either day's count, which gave one club's Sunday copy of a 9-10 loss to the other club's blank
Sunday placeholder and left the Saturday's loss to count again, unless both copies have a blank
game on their own day to pair with: a 10-0 win each day, each club scoring one of the two, is
the doubleheader it looks like. After the count, a copy is joined at the very same instant,
which is one game however it was dated, and on the same clock a day off where the results do not
say two games (one missing, or within four runs), where nothing else either club lists those
two days could be it: 284 copies in that pool. A result that merely comes close, or none at
all, hours apart across midnight, is left as two; so is a start a day off with results further
apart than scorekeepers are, fifteen in all, five of them naming different winners. The copy
folded in keeps its own day, so if it stands up again it stands up on that day.

**A fold is never final.** A game keeps every row folded into it whole — the schedule,
the row's id, its start, its day where that is not the game's, and its score from its own
seat (`alsoRows`) — and every tidy stands those rows back up, each on its own day, beside the
games still standing and groups the days again from scratch. So a fold made on one day's schedules answers to the next day's: a copy that
went to the wrong game of a doubleheader on a tie moves when a score says which it was,
two games listed at one placeholder slot come apart when the schedule moves one, and a
row that fits nothing now stands up as a game under its own id — filed under its own
club's page, by the level it played at, so a cross-age game's copy stood back up is
where a refresh of that page alone finds it by id. (One row filed twice — under one id,
or under a game's id and the id of a row it took over — is kept once: the copy against a
real club over a stand-in, then the one holding folded rows, with the newest score either
copy carries. The tidy used to fold both away, and then to keep the stale copy's.) A re-pull finds its row
by id, updates the record and leaves the grouping to the tidy; a row the schedule no
longer lists — deleted, cancelled, moved to another day — has its record removed on that
schedule's next pull. A game standing on such a row is marked (`withdrawn`), and the next tidy
takes it away and stands up the rows folded into it to be placed again: a game Legacy deleted
and entered again, all day before and timed now, otherwise stood beside its new entry holding
the Raptors' copy, one game counted twice. What the user said of the game goes with each row
that stands in its place: an exclusion, and a score typed in, which is written into every row
folded into the game, blank or not. A game that holds another row of the same schedule still
listed is not taken away — the next pull stands it on that row — and nor is one that holds the
other club's copy only as a schedule on record, with no row to stand up. Nothing is taken on an
answer with no row that can be filed — every row undated, or cancelled, is as likely a field
GameChanger renamed as a club that cancelled its season — nor for a row the answer held in a
shape this app could not read, such as an entry with no opponent: the pull keeps the id of every
entry the schedule answered with (`rowIds`), read or not. The same answers never take the
club's rows out of other clubs' games either. The same regrouping run twice changes nothing, which is what lets
the tidy stop: on the pool of 24 September 2026 a second tidy over the first one's
result, saved and read back, finds nothing to do, and a fuzz of 2,000 random days groups each
the same whatever order its rows came in. A tidy that only moves a row from one
game to another, or takes back a score whose row has gone, counts as a change
(`regrouped`), so the pull that ran it saves it rather than stamping the pool tidied with
the fix left in memory. Records written before rows were kept say only the schedule
(`alsoFrom`), and there a row is taken back only within the hour and agreeing — the
folded row coming back, which 21 of the 23 results listed twice that way in the same pool
were — with the same result however far off the clocks, as any two schedules' copies of one
game are, or at the game's very start whatever it says, which is how an earlier join left two
coaches' different scores at one start.

**One row, one place.** A row folded into one game can also stand as a game of its own, or sit
folded in a second. A refresh of a club's own page cannot see a cross-age copy of its game on the
other club's page (`pullSections`), and filed the row again, against a stand-in where the name
found nobody at that level. The regroup compares the rows of one pair on one day and never saw
both, so the club counted the game twice: on the pool of 18:40, 26 September 2026, 246 rows stood
as a game and sat folded in another, 10 more sat folded in two, and 155 counted twice for their own
club. The tidy now keeps each row in one place (`oneRowOnePlace`). A row folded into two stays in
the one ranked higher, as a repeated id is ranked, then the one whose own result agrees with it,
then the one at its start: 5 Star Coastal Gold's 6-13 sat in CBU Georgia's own 13-6 and in the WA
Bulldogs' blank copy, and there gave the Bulldogs a win GameChanger does not. A row standing as a
game between two real clubs, or holding another schedule's row, stays standing and comes out of the
other game. Otherwise the standing copy is the refresh's and goes, and its start, day and score, the
newest word on the row, go onto the record in the other game for the regroup to read again. Unless
the standing copy says the other game is another game: its own result has the club winning where
the other game's own row has it losing or level, or the other game's only score is the one this row
lent it. Written in regardless, Western Reserve's 5-6 loss to "Western 2" read as Milan winning 6-5
a game Milan's own row lost 3-16, and a 9U club's only result, a tie lent by a row since scored
11-6 against the Diamondbacks, became an 11-6 loss.

On that pool the first tidy takes 2 passes and a second finds nothing. 230 games go; 155
single-link records move, every one toward the club's own rows (124 onto them), and 146 toward
GameChanger's own count (91 onto it). The 9 that move away from GameChanger's land on the club's own
rows: the pool is missing games GameChanger has. No row is in two games after it, and none counts
twice for its club. A club can still count twice where the other game stands on the other club's
own row naming it, since which club that schedule meant is not the tidy's to say; Pool Health lists
those, 512 of them where there were 647.

Such a record answered for the club's row that day with no row to read. When the row came back
filed against another name, the claim step took the game as holding the club's row already, and
the row stood beside it, the same game ten minutes off, counted twice. So a pull now does two
things with a record like that:

- A new row of the schedule, filed by name against nobody the pool knows, that the one copy
  holding the record could be — the same day, within the hour, not scored further apart than
  scorekeepers are — goes back on record in that copy, whole, as it would have stayed had rows
  been kept (`heldOnRecord`). Filed as a game of its own, it once let the tidy pair the copy with
  the club's other game against that club that day, a 3-12 folded into a 6-3.
- Where the answer files no row into the game at all, the schedule comes off the record. Every
  row a pull files goes on record whole, so the row the record stood for is one the schedule no
  longer files there: deleted, or filed now against another name, further off. Which row it was
  is not known, so a row the answer held unread does not keep it, and an answer with no row to
  trust takes nothing off. A different result hours off, the club's one row against the other
  club that day, now reads as the game where the row was kept does: one game, each club's own
  score.

On the pool of 24 September 2026, 20,576 schedules were on record with no row kept. A tidy that
let a club's own row through beside a record of its own schedule within the hour claimed 27 more
rows and left 23 fewer games, and the pulls were left to decide which records had gone. The pool of
26 September said they had not: pulled on an older version, a club's own row stood 353 times
beside a copy holding its schedule on record with the same result within the hour, the game
counted twice. So the claim step no longer reads a record with no row kept as the club's row in
the copy, and takes a row of the club's within the hour of it as it takes one into any other copy;
further off, where the record may be another meeting that day, it leaves both. On that pool it
claims 367 more rows and leaves 367 fewer games, and 357 single-link clubs' records move: 345
toward GameChanger's own record, 242 of them onto it, and 12 away — clubs already short of
GameChanger's count, whose double had hidden a game the pool does not hold.

A start the schedule itself has since moved is taken on the next pull, and so is a day it has
moved the game to, which the rows folded into the game on its old day move to with it: left on
the old day, a game both clubs put back a week stood as two once the other club's copy took the
new one. Another
schedule's start is never written over a row, nor fills a row that has none, since that
is the other coach's clock — an all-day 5-3 win given the Raptors' 2:00 PM start sat at the
very start of Legacy's own 2:00 PM game, and the next tidy read the two as one listed twice.
A game whose own row the schedule deleted, entered again under a new id, stands on the new
row from then on — its result, its start, set or cleared, and the pulls after it — so a
correction to the new row reaches the game, and one entered again all day is not split
from the row it replaced. A club's second listing of a game its first row leaves blank
gives the game its score, corrections included, marked as the listing's. Deleting a club
remembers every row its games stood on, and a game's id where it took over a row entered
again. Deleting a game from Pool Health's dated-ahead list remembers the rows that carried the
score (`scoringRowsOf`): the row the game stands on where the score is its own, and every
folded row with a score of its own. Remembering only the row the game stood on let the other
club's scored copy back on its next pull; remembering every row would keep the other club's
real fixture, a game still to play, out for good. On the pool of 24 September 2026 the tidy
folds 3,866 rows this way, settles 9 slots and stand-ins into the named game beside them, and
claims 2,997 rows filed by name for the other club's copy of the game (**A row filed by name
beside a game the club never listed**, below), leaving 241,471 games. Legacy's page reads six
games again.

**Each club keeps its own score.** The Dragons' schedule says they beat the Hens 11-8;
the Hens' says they lost 8-10; it is one game, listed on both at 10am. The game used to
carry one score, whichever schedule had been pulled last, so the Hens' page could show
the Dragons' version of the Hens' own game, and the score flipped as the daily refresh
went round. Two schedules disagreed about 13,865 games in the pool of 24 September 2026,
563 of them about who won.

Side A of a pulled game is always the club whose schedule it came off — every one of
the pool's 248,371 games — and its score is side A's own. Side B's own schedule's score
now sits beside it (`reportedByB`) instead of over it, and fills it only where side A
has posted nothing yet — marked as borrowed (`scoreFromB`), so it goes if side B's row
moves to another game and gives way the moment side A posts its own. Each club's page
and record read its own schedule
(`scoreSeenBy`); the rating reads the game once, at the average of the two margins
(`ratedMargin`), so the Dragons are rated 2.5 runs better that day and a game both clubs
claim to have won reads as even. A score typed in by hand answers for both clubs and
clears the other schedule's, and the record of side B's row takes the typed score from
that club's seat, or the next tidy would stand the row up and put its old score back.
Every other way a pull fills side A's blank from side B's schedule — settling a "TBD"
into a named game, joining two clubs that each filed the game against a stand-in — marks
the score borrowed the same way.

On that pool the first tidy gives 1,501 folded games both scores, 131 of them different
and 13 disagreeing about the winner, and 160 a score borrowed from side B; the rest fill
in as each club is refreshed. Every
2027 rating moves a little, since every game is fitted together, and none by more than
0.57 of a run.

Most slots name themselves. A bracket posts "TBD" on one team's schedule and
the real fixture on the other's, so pulling both sides answers the question:
after a run, a slot whose fixture another schedule named is folded into that
named row — one fixture, one game, both sides real. The named row wins because
a schedule that names a club is saying who turned up, and a score it had not
posted yet is taken from the slot's row.

That only happens where it is certain. The naming row has to come from another
club's schedule, since a team listing both a placeholder and a named opponent
on one day is playing two games and neither names the other — and nor can a game that
already holds a row off the slot's own schedule, other than the slot row itself (a
refresh of one page files again a row the pool holds folded into a game on another page,
and that copy settles back), unless at the same start: one schedule
lists a game once, and a row settled there was one the regroup stood back up against the
named club, a result filed against a club that never played it. Where both rows
give a start time they have to agree on it, which is what tells the halves of a
doubleheader apart. A day with two clubs that could both be the answer is left
alone.

**A name is checked against the club's own schedule.** GameChanger gives an opponent as the words
a coach typed and nothing else, so a name is where to look, not who played. A game goes on a pulled
club by its name only where that club's own schedule has a game that day or the day either side —
the day either side because two schedules can date one game a day apart, and the collapse joins
those (**A day apart**). Every road a name takes asks it: the import's match (`planOpponent`), the
refile of a stand-in's rows (`refileStandIns`), and the tidy, which takes a row a name filed onto a
club whose own schedule has no game near that day off it, onto a stand-in of the name, or a slot
where the club's name reads as a weekend (`resettleOffLevel`). The game itself and the picture are
not names and are not asked: a club whose own schedule holds the fixture, or whose picture the row
carries, is that club. A club whose schedule came back empty has no game on any day, so a neighbour's
game against it stands against a stand-in of its name. The user asked for this check on 28
September 2026, when an Illinois club's 8 August loss to "Eagles" sat on the Eagles of Independence,
Kentucky — the one 9U Eagles across Illinois's border — whose own schedule opened on 3 September,
so the page said 1-3 where GameChanger says 1-2. On the backup of 26 September 2026 at 18:40 the
tidy took 23,282 rows off pulled clubs, claimed 717 more into the other club's copy than before, and
changed 4,700 single-link records: 4,395 toward GameChanger's own record, 3,094 of them onto it, and
278 away, 106 of those off it. Of the 278, 191 are clubs whose GameChanger record counts more games
than their own schedule's rows in the pool hold: a game the pull did not bring back, which the name
had stood in for.

**A name no other club carries.** A schedule is written ahead only as far as its coach has got, so
the day check keeps a club's own upcoming games off it until its coach enters them. On 29 September
2026 "513 Force - Bouley" of Cincinnati had one game of its own, and a Kentucky club's and an Ohio
club's schedules each named it for a game in October: search found the club three times, twice as
a stand-in. The user's rule: a name that specific can only be the one club, and a vague "Eagles"
can't be combined. So a name files a row onto a pulled club without a game that day where it can
mean no other (`soleNamesakes`): the one pulled club carrying the name at that level in that squad
year anywhere, in the namer's state or one bordering it; a word of the name in no more of the pulled
clubs' names than one in 18,000 (on that day's pool, two of its 38,296: "bouley" was in one, "eagles"
in 212, and "Samurai", "Arrows", "Walkoff" and "Firebirds" in 8 to 15); and a day no earlier than a
week before the club's own first game of the year. A share rather than a count, because a word is
rare only against enough names to say so: in a fifth of that pool "Walkoff" was in two names, and a
pool of fewer than 18,000 pulled names holds no word rare enough, so a club's own pool keeps the day
check whole. The refile files such a row and the step that takes rows off a club leaves it, asking
the same question. On the backup of 29 September 2026 the tidy filed 3,660 stand-in rows onto 2,018
clubs, 1,047 of them scored, which emptied 1,985 stand-ins; four games two clubs had each filed
against a stand-in for the other were then one game, not two. A second tidy moved nothing.

**Not this team.** The matcher will still be wrong sometimes, and the club's panel is where that
shows. Beside each game a club has only because a name on another club's schedule was matched to
it, the panel offers **Not this team** (`filedByNameOn`): a row off GameChanger, off a schedule of
the club on the game's other side, which is the schedule that wrote the name, on a pulled club, with
nothing of the club's own saying the game is its — no row of its schedules folded in, claimed in or
on record, and no picture naming it, which is GameChanger's identity or, after Same team as, the
owner's word. A game the club's own schedule lists, one typed in and a League Standings game are
never offered it, and nor is a row off a schedule nobody holds: an Unlink leaves the club's own rows
of the link it took off on the club, and on the backup of 29 September 2026 one such row was the
one game of 8,200 whose schedule was not the other side's. Unlink, which the panel offered before,
could not help, since the row did not come from a link. Pressing it takes the game off the club
onto what the row would have been had the name matched nothing (`takeOffClub`): the stand-in a pull
of that schedule would reuse for the name, at the level the row gave it, in its squad year and named
from the namer's state, or a new one where there is none, or a slot for a name that can only be one.
And it takes with it, in the same change, every other game the same club's schedules filed onto
this one by the name (`takenWith`), in whichever squad year: the refusal below covers each of them,
and left to the tidy they came off out of Undo's reach. On a page kept in the browser a stand-in
made for the game sets the page's tidy off at once, which took the other rows off for the refusal
while the Undo was still on screen, and Undo then brought back the one game alone, the stand-in
staying with the others (on the backup of 29 September 2026, 648 of the 7,515 club and namer
pairs offered hold two or more such games, at most six). The toast says how many games went, and
the club's record, rating and board move with them; Undo puts every one back as it was, takes away
the stand-ins made for them, and forgets the refusals the press added. It is a command
(`game.notThisTeam`), so a page kept in the browser runs it on its own store and the live page sends
it to the edit function, the club's card naming the games it is offered beside by their stored ids
(`ClubCard.byName`), since a card carries no other. The button's name, as a screen reader says it,
names the games it takes and the club it takes them off, since "Not this team" beside an
opponent's name reads as a remark about the opponent; it is a 24-pixel target, and a press, which
takes the button's own row away, leaves focus on the panel's list of games rather than on the page.

The answer is remembered, as the pairs kept apart are: in the pool's own key
(`league_forecast_gc_not_this_team_v1`), in every backup and in the cloud copy, against each
GameChanger id of the club that wrote the name, the name as the import reads it (`teamNameKey`) and
each of the club's GameChanger ids. Every listing of the namer's, not only the one the row came off:
a club on GameChanger twice, or once for the spring and once for the fall, is one club writing the
name, and keyed by the row's schedule alone the second listing's next row of the name went back onto
the club (47 of the games offered on that backup were named by a club with two listings, and 2 held
the other listing's row in the very game). Not against the game: a re-pull finds a row taken off a club by its id and keeps
the stand-in it has, so what brings the mistake back is the refile putting the stand-in on the club
the next time the club has a game that day, and the namer's next row of that name, a league
opponent being named over and over. The schedule and the name stay in the key, so another schedule
naming the club, or this one naming it another way, is matched as before, and the pool keeps no
row's name, so the club's name is the name: a name files a row onto a pulled club only where the two
read the same. Every road a name takes onto a club asks it (`refusesName`): the import's match by
the name (`planOpponent`: the one club of it, the one something corroborates), the refile, a
namesake taking a row off a club far from its age, and the slot settle where the row it would
settle into is the name again. The step that takes a name's rows off a club (`resettleOffLevel`)
takes any row of the refused name it finds there off it too, at the next tidy: none, after a press,
which took them all, but a row a copy restored from before the refusal brings back. What a refusal never
stands against is the club's own schedule (`listedByOwn`): where that lists the game against the
namer, the fixture match, the holder test, the slot settle, the crossed halves, the reclaim and the
claim step put it on the club as they would with no refusal, since the club saying it played the
game is not a reading of a name. Kept from those too, the two clubs' next real meeting stood twice
on the namer's record, once against the club from the club's schedule and once against a stand-in
from the namer's. The picture still names the club as well, being GameChanger's identity. The
import panel and the
tidy on this page, in its worker or not, read the list, and so does every pull run on the cloud
copy (`runCloudPull`: the nightly refresh and a list pulled in the cloud), its import and its tidy
alike, and Pool health's count of what a tidy would settle (`settleableNow`, on the page, in its
worker and in the server's `health.inspect`), which asked without it offered a Settle the tidy
refuses and stayed on screen after every tidy; the command adds to it: the refusals it does not hold
already, which its Undo takes off again and nothing else. Once the toast has gone a refusal is
listed nowhere and nothing in the app takes it back: Same team as, folding the stand-in into the
club, puts the games it holds back on the club by the owner's word (`namedByAvatar`), which no
refusal overrules, but the refusal stays for the name's next rows. A page to list the refusals and
withdraw one is not built yet: what withdrawing should do with the games already on a stand-in is
the owner's to decide.

**A row filed by name beside a game the club never listed.** Where another club's own schedule
lists a game against a club that none of the club's own schedules gives a row, that game is on the
club's schedule somewhere — under whatever its coach typed for the other club. The import files a
row by the name it was given: against a club of that name, or a stand-in where GameChanger lists
none. So a row of the club's own that day filed against a stand-in, or against a pulled club
whose own schedules never list the game, is read against that copy, and where the two are one
game the row is claimed into it (`claimFiledRows`), as the club's own row of it.

Against a stand-in the clock and the scores decide, whatever it is called: within the hour, as two
schedules' copies of one game are (nobody plays two an hour apart), with a result still to come on
one side or two within four runs of each other, or with the same result. On the pool of 24 September
2026, after a whole tidy, 1,542 of its 82,471 games against a stand-in sat beside such a copy that
way. The stand-in's name shared a word with the club the other schedule named in 68% of those within
the hour with a result to come and 67% of those scored close, against 3% to 10% of the pairs the
same search makes a week either side, and most of the rest were a shorthand no word test sees —
"R.E.B." for Rockland Elite Black, "KBC" for Kennedale Baseball Club. Scores further apart than
scorekeepers are stay two games: they shared a word 13% of the time within the hour and 34% at the
very same start — mostly a game of another club of the same name, filed against this one by name
— and so did copies more than an hour off, 18% of those with a result to come. A slot has no name
to test and is held to the same clock and scores.

Two readings go further, both on the very same result against a slot or a stand-in whose name
fits the copy's club. The first reaches a copy holding the club's schedule on record at any clock:
"Chicos Augusta" at 16:30 was Chicos Augusta's own 17:35 copy, 10-1 both, and Coastal Kangaroos
Vincent read 3-2 against GameChanger's 2-2. The second reaches the day either side, into a copy
that holds nothing of the club's, for a row whose own day has no copy for it: Catoosa Mudcats'
9-16 against "Frost Falcons" on the 12th was Frost Falcons' own copy at the same 13:00 on the
13th. A copy two days' rows both want goes to the row on its own day, or to neither, and a row of
its own day that could be it counts as wanting it though it went into nothing, two copies it could
not choose between: read off the choices alone, a row a day off took the copy it might be. On the
tidy of the 26 September backup the two claim 44 and 47 rows, and 89 single-link clubs' records
move: all 89 toward their own schedule (68 onto it), 88 toward GameChanger's (50 onto it), and one
away, a club whose GameChanger record covers another span. A second tidy changes nothing, and in
two shuffled orders the pool ends with the same games and claims, differing from the stored order
in exactly the kept ids main's own shuffled tidies differ in.

A pulled club's name did say something, so against one only scores that agree outweigh it: the same
result within the hour, or two within four runs at the very start or within the hour. Kentucky
Athletics' 9-3 over "Dream Chasers Blue" was Hit Dogs Evansville's own 3-9 fifteen minutes on: the
Hit Dogs played that weekend under the name of a GameChanger team with no games of its own, every
opponent filed them under it, and each of those games stood twice. The same pool held 1,358 rows
filed against a pulled club that never listed them beside another club's copy with the same result
within the hour, and the two clubs' names shared a word in 81% of them; most are one club's two
GameChanger teams — "Gem City Throwbacks - Wright" and "GC Throwbacks - Wright Fall", whose
opponents filed seven games against the first and whose own schedule listed all seven as the
second. A result still to come says nothing against a name GameChanger lists — blank rows at one
start paired a "Rangers" typed with another club's copy — and waits until the scores are in.

Every row and copy of the club's day is read at once: as many pairs as the day allows, then in both
schedules' order, then the stronger links — the same result, the very same start, within the hour.
Where two readings are as good as each other, only what they agree on is settled, so one game off
two GameChanger teams of one club, 5-1 at 9:30 on both, is left as it is, and a claim already made
counts for nothing of its own, so the day reads the same whichever club was pulled first. The copies
of a club the claiming club has a row against of its own, that day or the day either side, that no
row of theirs is paired with yet wait for the collapse to pair it: claimed first, a stand-in row
once took the copy that row was, and left it standing on its own, one game counted twice. They wait
only where the collapse could still read that row as the copy: on its own day, or a day off with the
same result, at the very same instant, or at the same clock with results no further apart than
scorekeepers are, the one test the collapse joins a game across the night by (`dayApartStrength`),
and a pull's mark waits by the same. Waiting on a row a day off that is plainly another game waited
for good: G3 - Bonanno's 3-9 against "CBU" was CBU United Faber Navy's own 9-3 at the same start,
and G3's 1-2 against CBU United the next afternoon held it back, so the 3-9 counted twice. On the
pool of 24 September 2026 that was 41 games, and 73 clubs' records moved, 71 toward GameChanger's
own, 46 onto it and none off it. A score a claim lent the copy is not the copy's to wait on: read as
its own, the claim went back the next pass, and the pass after made it again. A row the club it
names answers for, by a copy of its own that fits, is that club's, whether that copy stands or is
itself claimed into a third club's copy: read off the standing copies alone, two clubs that each had
a second GameChanger team naming the other's first, Power Baseball 2028 Victus and JR7 Baseball on
11 September 2026, had each pass claim the row that stood and give back the one that was claimed,
and every tidy of that pool ran to its limit. A stand-in the other club's own schedule has played is
not that club — a 1-13 against "Natives Black" once went to Salty Stars, who play Natives Black in
October — and a pulled club it has played gives way only to the same result: the NL Vandals' 15-3
against "Downingtown West Wolfpack Blue" was Downingtown Wolfpack Gold's own 3-15 at the very same
start, though the Gold play the Blue, but where the other club had played the named one the two
names shared a word in 13% of the 30 pairs scored apart within the hour, about what chance gives.
What a club has played is read off every row of its own schedules, whichever row a game stands on.
Nor is an age typed into a name more than two levels from the one that club played at. Nor, across
regions, is the clock alone: with no result on one side or the other, a claim joins two clubs only
in one state or two that border (`inOneRegion`), and the slot settle holds to the same, whatever
the stand-in is called. A copy names a club because its coach typed a name the import found in the
pool, and a common name is found in many places: a 9U club in North Liberty, Iowa, that played
"Cubs" was filed against the 11U Cubs of Frisco, Texas, one of 75 teams of that name, and the Texas
club's own 11-6 over the Diamondbacks at the same 15:45 went into the Iowa club's blank copy as its
loss. Of the 3,714 claims on the pool of 26 September 2026, 7 joined clubs of two regions, 6 of
them on scores that agree or nearly do; the seventh, a Connecticut club's blank row naming a New
York team in an Indiana club's blank copy, goes back. It is a refusal once the day is read, not a
weight in reading it, so a region never picks between two copies the clock could not. Rows naming
one team on one day go to one club or none, and a row claimed away is no copy for another row to go
into in the same pass.

Nothing claimed is final. The claim keeps the team the row was filed against and the level its name
gave (`FoldedRow.filedAgainst`), through every save, backup and merge, and every tidy reads each
club's day again with its claims stood back up. A claim the schedules no longer bear out goes back
to that team: the other club's copy withdrawn or moved more than an hour off, a result posted that
says two games, the club's own schedule naming the other club after all, a copy that fits better
pulled since, or the copy moved onto a namesake whose own schedule lists it. The regroup never moves
a claim — which copy a claimed row is, is the claim's to say, and a row read as one more game
against the club that claimed it went to a copy the claim had refused, five runs off at the same
hour, and back, every pass until the tidy stopped. A claimed row keeps its own schedule's day when
the copy holding it moves, and a stand-in with no game left stays in the roster while a claimed row
can go back to it. One with neither, which a game or a club the user deleted leaves behind, the tidy
takes out once its passes are done (`idleStandIns`), unless a page has it as its own team: pruned in
each pass, the changed roster sent the tidy round once more to find nothing. A game the user has
thrown out keeps the claims it holds: released, a row would stand as a game of its own and count.
Deleting a club that is not one stands the claims its games held back up, and keeps it as a name
only where a claimed row elsewhere goes back to it; removing a team from a page keeps it in the
roster for the same reason; and a claimed row filed against a team the tidy takes out as not
baseball, or as a high school, goes with it, as the import would not file it. Kept as a bare fold,
as the first version of this did it, a claim outlived all of that.

The pool does not keep a row's name, so the next pull of such a fold's schedule reads the name again
and marks the fold as the claim it is (`filedMarkFor`). Where the stand-in the row had is gone, the
pull makes one for the name. It marks only what the claim step would have claimed. The row must be
on the same day, on the other side of the other club's own copy, with no other row of the club in
that copy. The claim step's rules for a stand-in must hold, and no row of the club against the other
club may be waiting that day or either side of it that could still be the copy. It leaves alone a
fold whose name files it against the other club:

- the other club's name, a GameChanger listing's name, or its picture;
- a shorthand for the other club's name at the very start, wherever the two clubs are, as the
  slot settle files one;
- a name the club's other rows already stand against the other club under, as a hand merge
  leaves them;
- a name that finds a pulled club.

It also leaves the same result, and the very start with results that do not disagree. The slot
settle folds those with no mark, and would fold them again after every release. And it marks no
fold of a name the club's other rows that day are in another club's copy under, marked by the
same pull or claimed already: rows naming one team on one day go to one club or none, so the claim
step stood every one of them back up beside the copy it had been in, each game counted twice. A
fold the fixture match or the slot settle made at the very start, with results a run or so apart,
is marked too, the first time its club is pulled after it: it is the claim the claim step makes
where the two clubs' rows come in the other order. The pull counts the stand-ins it makes among
the teams it made.

This was measured on the pool of 24 September 2026, tidied by the first version, by pulling again
every schedule holding such a fold. The pulls marked 1,103 folds and made 815 stand-ins. After a
tidy, 1,099 of them are the claims that a tidy of the pool from before the first version makes. 3
went back to their stand-in, as that tidy leaves them, and 3 rows elsewhere were claimed as it
claims them. One stays claimed where that tidy leaves the row standing, on a day both pools count
twice. The pool then holds 241,469 games, two fewer than that tidy leaves: Boro Force typed "Crash
Outs" for two games that day, held in two clubs' copies, and that tidy stands both back up beside
them where the note marks neither. A second pull marks nothing and makes nothing. 126 of that
tidy's claims are left as they were:

- 94 rows typed with the other club's own name;
- 13 whose name now finds a pulled club or a stand-in the other club has played;
- 12 with the same result, or at the very start with results that agree;
- 7 that are not the first version's folds.

A merge can leave a claim filed against the very club whose copy holds it: "Sharks" merged into
the Bears by hand, or a club's two GameChanger teams paired. The row's name is that club's now, so
the claim is settled (`isSettledClaim`). The claim step does not read it or take it back, a
re-pull leaves it alone, and it counts as the club's own row in its copy, as a row filed against
the club by name does: the regroup reads the copy as holding it, and so do the steps that move a
copy to a namesake (`reclaimMisfiled`, `resettleOffLevel`). Read as a claim, it went back against
that club beside the club's own copy, and the collapse folded it in again with no mark, which the
next pull would have marked as filed against a new "Sharks". Read by the regroup as a copy with no
row of the club in it, it took the club's other game against that club that day, a 7-3 lost
into a 2-4; read by a namesake step, the copy went to a namesake and the row stood back up, one
loss counted twice. A merge that folds a stand-in's row into the survivor's copy settles it too
(`settledOnMerge`), whether or not a claim was made first. A merge made before claims existed left
no mark, and nothing in the pool tells its fold from the first version's, so the note can make
the merged name again as a stand-in for such a row; the game still counts once while the copy
holds it.

On that pool the tidy claims 2,997 rows: 1,782 filed against a pulled club, 939 against a named
stand-in and 276 slots, in three passes; a second tidy after a storage round trip changes nothing,
no row is held twice, the tidy takes out only the 28 rows it took out before, and 883 stand-ins
stay only as where a claimed row goes back. Among the claims against a pulled club
the two names share a word in 83% of those at the very start with the same result, 92% of those
scored within four runs there, and 78% of those within the hour with the same result. The Athletics'
page reads 9-0, one game against the Hit Dogs. Against the tidy before it, 2,484 of the 43,432 teams
rated in 2027 have another record: a club loses a game it had counted twice, or the games its
opponents filed against it by name that another of its GameChanger teams, or another club, played.

**A stand-in carrying the other club's very name.** Both clubs can file their copy of one game
against a stand-in, one of them under the other club's very name. One club's coach types the other
club's name as GameChanger lists it, and the other club files the same game, at the same minute
with the result mirrored, against a shorthand of the first club's name. A name goes onto a pulled
club only where the import can say which one, and the named club can be a level up, on another
page, so each row stands against a stand-in and both clubs count the game. The crossed halves want
each stand-in's name to fit the other club and the two clubs to be neighbours; the slot settle and
the claim step want one of the rows to name the other club already. On the backup of 11 October
2026 an audit found 714 scored rows this way, on 633 stand-ins: the namesake a level off (294), out
of the namer's region (241), one of several of the name in its state (78), or named from no state
(65).

So the tidy joins them (`joinNamesakeHalves`): club A's own row against a stand-in whose name is
pulled club B's (`teamNameKey`, in the squad year, at any level, from any state), and B's own row
of the game against a stand-in or a slot, starting within the hour with the result mirrored, the
only such match for either row. A false pair needs a second club of B's name, or a second club
naming B, to have played that hour to that score. Two more things are asked of the pair, each
measured against the same search with B's row a week or a fortnight either side, where the game is
not:

- B's opponent is a slot, or a stand-in sharing a word of three letters or more with A's name,
  filler words off (`nameFitWords`). Over the backups of 25, 26 and 29 September and 11 October
  2026 a stand-in sharing no word made a false pair 5.0% of the time (374 pairs), against 0.80%
  for one that shares a word and 0.28% for a slot.
- The two clubs' own levels for the game are at most two apart (`PLAYS_UP_TO`): three or more
  apart was false 11.9% of the time (88 pairs).

And where both coaches typed an age, one of the two is the other club's own, since two clubs'
sibling squads can mirror a score at one instant; one age a level off on its own is let through,
since refusing every typed age that was not the other club's turned away 173 of the 500 pairs on
the backup of 11 October 2026 and found the same 7 pairs a shift off with it and without. A
stand-in A's own schedule has played as a team of its own is no name for A, a row the user threw
out stays out, and a name the owner refused (**Not this team**) files nothing onto the club it was
refused for, whichever row wrote it: A's name for B, or B's name for A. Asked of A's name alone, a
pair whose stand-ins each carried the other club's very name was joined the other way round, on B's
row with A's as the claim, though the owner had said A's name was not B. A row with no result waits
for one: on the four backups, rows blank on both sides at the same minute paired as often a week
off as on the day (1,796 pairs, against 1,809 a shift off).

Nor is a pair the only match beside a copy of the game already standing between either club and
another pulled club, within the hour and with a result no further from the club's own row's than
two scorekeepers' are (`CLOSE_DISPUTE_RUNS`), as the claim step reads a row against a stand-in
beside a copy. Such a copy is one more reading of the game, and the pairs above were counted
without it: a second club of B's name pulled after the join, its own row naming A as GameChanger
lists it, went onto A by that name beside the joined game, since A's row no longer stood against
the stand-in the import would have folded it into, and A counted the game twice through every tidy
after, where the tidy before the join counted it once. So did B, where a club pulled after the join
named B. Beside such a copy the join comes apart, and the claim step, or the refile and the
collapse, put each club's row into the copy that names it, as they do where every schedule is in
at the first tidy. No pair joined on the four backups has such a copy beside it, and the tidy of
each is the same to the byte with the question and without; a week or a fortnight off, it turned
away one candidate a backup, each one the word test turned away too, so the 7 pairs a shift stand.

Built, with those guards, the tidy joins 220, 211, 301 and 486 games on the backups of 25, 26 and
29 September and 11 October 2026, 1,218 in all where the rule alone found 1,244, and the same
search a week or a fortnight off finds 7 pairs a shift: under 0.6%. A second tidy joins nothing
more and takes nothing apart. Of the 486 on the backup of 11 October, 310 have a stand-in on B's
side and 176 a slot, and 233 are on one page, 229 a level apart and 24 two. The squad year's fit
rates 221,233 games there where it rated 221,719, and no club's record changes, since each page
reads its own schedule's rows; of the 47,971 pulled clubs on the 2027 pages, 2,407 move by more
than 0.1, 390 by more than 0.5 and 97 by more than 1, the most by 4.3. The tidy of that backup
took 161 to 172 seconds over three runs, against 148 to 154 without the step, which takes 1.3
seconds a pass and runs six passes there.

The game stays on A's row, the one that named B, on A's page. B goes in for the stand-in at the
level B's own row gives it, since read at A's page level, as a side with no typed age is, 122 of
the 253 joined games across two pages on the backup of 11 October 2026 would have rated B a level
or two from its own; and B's row goes into the game as a claim filed against the team it named
(`claimInto`), as the claim step holds the rows it claims. The game counts once, in the squad
year's one fit, for both clubs, and each club's page reads its own schedule's score.

Nothing joined is final, as a claim is not. The game keeps the stand-in its own row named and the
level that name gave (`ScoutGame.joinedFrom`), in the stored pool, every backup and the cloud copy,
whose data schema went to 2 for it, since an older build would drop it and the join could no longer
be taken back. Every tidy reads the two rows again as their schedules filed them, and a join they no
longer bear out puts each row back where it was: a result or a start since posted that does not fit,
a second club of the name with a row that does, a copy of the game naming either club itself, the
owner refusing either name, B's row gone from its schedule. Until then every other step reads B's
row as B's own row of the game, as it reads a claim a merge settled (`isJoinedClaim`): the claim
step leaves it to the join, which it would otherwise give back each pass for the join to make again;
the regroup keeps B's schedule on record, so B's other game against A that day is not read as this
one; and the reclaim does not move the game to another club of B's name. A pull of either schedule
finds its row by id and changes nothing, unless A's schedule now types another age for B, or none,
which the game keeps as the level to put back; and a refresh of B's page that cannot see the game on A's
files the row again, which the tidy folds back in (**One row, one place**). A game the user has
thrown out stays as the user left it, and one whose stand-in has since gone from the roster keeps
the join as a plain claim. Deleting B, or B taken off the boards for the user (**Clubs removed for
you**), puts A's row back against the stand-in it named (`unjoinedRow`, `unjoinsWithout`) and keeps
it off the rows remembered as deleted, rather than take A's own row of the game with a club its
schedule never named, which A's next pull would then never have filed again; B's own row goes with
B, as any claim of B's does.

A row filed by name on a pulled club that plays nowhere near the age it was played at is not that
club's (`resettleOffLevel`): more than two levels off, it goes to the one namesake that plays near
it, or to a stand-in. Two levels off is inside what a squad plays up or down, and still somebody
else's where the age was typed into the name and nothing of the club's own says it plays there:
every listing two off, none of its own rows within a level of it, no row of its own that day. On the
pool of 24 September 2026 GameChanger's own record left out 82% of the games filed that way that it
decided, against 14% at the club's own level. Those rows go to a stand-in and to no namesake, and
the refile (`refileStandIns`) does not put one onto the club of that name at the typed age on the
name alone where the name is a club's at another level in reach too and that club's own schedules
list nothing that day: handed to the namesake at the typed age, 47 of the 49 clubs that took one on
the pool of 26 September moved away from GameChanger's own record. On that pool the move takes 522
rows off, and 178 clubs' records change: 164 toward GameChanger's own, 106 of them onto it, and 14
away, 5 of those off it — a squad that did play up, or a namesake the game was matched to after.

Nor is a row filed by name on a pulled club in a region its filer does not play in: two states on
the border map that are neither the same nor next door (`farApart`), where no game both clubs'
schedules have a row in, and no pulled club each has met in a game both sides' schedules have,
backs it. Two Texas clubs' games against "Braves" sat on a Florida Braves as two wins its own
schedules do not have. Such a row goes to a stand-in, which the refile files onto the one club of
the name in the filer's state or next door. A meeting counts only where both schedules have it,
because a row only one side holds may be a misfile of its own, and two misfiles, one each way,
would vouch for each other. A province or Puerto Rico, which the map does not hold, says nothing
about distance, and a slot's name stays on the one pulled club that carries it, as the import
files it. On the pool of 26 September 2026 at 18:40 the tidy takes 121 rows off, and 31 clubs'
records change: 30 toward GameChanger's own, 13 of them onto it, and one away, a loss its club's
schedule has not scored yet, whose row the move let join the club's own copy of the game.

A row that named its opponent by the club's GameChanger picture is kept apart from all of that
(`ScoutGame.namedByAvatar`). The picture is the one identifier GameChanger gives that means the
same club on two schedules, so a Florida row naming a Texas club by it played that club, and no
rule that reads a name — the region, the age, the misfile check, the claim step — moves it off.
The import records the club on a row it files by the picture and on a later pull of a row already
filed against the club its picture names, and Same team as records it on every row of a team known
only by a name — a stand-in, a slot, one made by hand — that the user folds into a pulled club,
since that is the user saying who played: folded with no mark, the two stand-ins of "513 Force -
Bouley" went back to stand-ins at the next tidy, the club's own schedule having no game those days
(`mergeScoutTeams`). A row the region rule moved before the picture was kept
stays where the rule put it until the other club's own schedule lists the game. A later pull whose
picture names another pulled club takes the club off the row, and the rules that read names read it
again; a pull with no picture, which GameChanger often sends, leaves it. A row folded into the
other club's copy of the game keeps the club on its record there (`FoldedRow.namedByAvatar`), so a
correction that stands it back up stands up the same row; a claimed row's record takes a picture
naming the team it goes back to as well as one naming the club that claimed it, so a row whose
claim the schedules release goes back to that team still carrying it. The stored pool, the JSON
backup and the CSV a season export carries all keep it.

A name nobody pulled is one stand-in per name, level and squad year among the clubs of a state that
named it, and a lookup that missed made a second: a class year looked up at the page's age rather
than the class's, a pull run before a rule. The tidy makes one of two such entries
(`mergeDuplicateStandIns`) where the name carries a graduating class or no more than one pulled club
in the pool carries it, a club of one state named both, and neither played another opponent within
the hour of the other. A common name, two Arizona clubs' "Pirates", is as often two teams and is
left. On the pool of 26 September 2026 that merged 127 of the 173 such entries, ten of them "Mojo
Gold 2036", and moved 226 clubs' ratings by more than a tenth of a run and no club's record.
Each entry is held against every earlier one it was not merged into, not the first alone: held
against the first, two "Canes National 2031" entries named from Virginia stayed two behind one
named from Florida, and five such pairs stood on the pool of 26 September at 18:40, all made one
now in the roster's order and in two shuffled ones.

Anything still unnamed is the ordinary rename: open the slot, type the club's
real name, and the game moves there — merging into that club if it is already in
the pool.

### What a pull left behind, and what to check

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

### Names

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

### The Games tab

The Games tab lists a page's games — pulled, pasted or typed in — for today
only, and no others until asked. Today is the reader's own day, as every date on
the page is read. The list began as a week either side of the app's last update,
and on 2 October 2026 the user cut it to today's games. A squad year today is
not in has no today to show: a finished season lists its last day with games,
and one not yet begun its first, so neither opens on an empty list.

Nothing is out of reach. A line under the heading says how many games the day
leaves out, how many of those have no date and how many were due earlier and
still have no score, and **Show all** lists every one: an old game is still
scored from here. A score is two whole numbers of runs (`typedScores`); a Save
pressed with a box left empty says so, where until October 2026 it recorded 0–0. A game just added stays on the list whatever its date, so it
does not vanish the moment it goes in. On the pool of 29 September 2026 the 12U
page of 2027 held 45,107 games: 326 of them were that day's, against 11,348
within a week either side, and 2,465 dated earlier had no score yet. The list
still draws them a hundred at a time (`gamesWindow.ts`, `GamesSection`).

### Importing

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

### Pulling from GameChanger

Team Rankings stops being hand-entered. Paste GameChanger team ids, team page
links, or a whole spreadsheet export — the same reader handles all three, BOM,
quoted names and tab-separated columns included. Each team's schedule is read and
filed under its own age group and squad year, and the pages are created as they
are needed, because a nationwide list cannot expect a page to exist for every
level first. Under a header, an id is read from the id column, the link column,
or a link anywhere in the row, and nowhere else: a row with only its name filled
in once sent that name to GameChanger as an id.

#### Two lists: teams, and the organizations they belong to

A team export can carry more than the team. The columns this reader now takes —
`Organization ID`, `Organization Name`, `Organization Type`, `League Associations`,
`Tournament Associations` — answer a question GameChanger's public API will not: there
is no team-to-organization route, so nothing the app _fetches_ can say which club or
league a team is in. A crawl that found the team through its organization knows, and
these columns are where it says so. Every one is optional, and independently so: a row
naming a tournament and no club is an independent team playing one event.

Associations read as `Name|Id`, several separated by semicolons. **A league may age a
team and a tournament may not**, and the difference is not a nicety: you play your own
age in your league and you enter tournaments _up_. An 11U team whose league is
"NKB 11u" and whose tournaments include "NB Summer Slam 12U" is telling you both
things, and reading the second as an age would file it a year old and make every game
in its own league read as playing down.

So a league's age is a rung of its own: **below the club's own word and above its
opponents'**. A league naming an age is a statement about every team in it, which beats
reading the company a team keeps and loses to the club filling in its own page — and a
person naming an age by hand still outranks all of it. Two leagues naming different
ages is not an answer, because one of them is about a different squad of the same club,
so it refuses rather than picking. The whole rung only ever fires on a team GameChanger
left with no age at all.

Organizations are a **second file**, not rows mixed into the first, and the reason is
that nothing inside one file could tell them apart: an organization id and a team id
are the same shape. Two files make every row unambiguous by where it is, leave the team
reader untouched, and mean no list already saved can be misread. Its columns are the
ones the export writes — `Entity Type`, `Entity Name`, `Organization ID`, the three URL
columns (any of which yields the id), `City`, `State`, `Season Name`, `Season Year`,
`Sport`, `Team Count` — and the season pair is read leniently across both cells,
because a real export puts `2027` in the _name_ column with the year column empty.

**The Organizations file is read from the pull panel**, beside the team list, and kept:
a file read later adds to it, replacing only the organizations it names again, so an
export taken part way through a crawl and then the whole of it add up. What makes it
worth reading is its `Team IDs` column — the teams under each organization, which is the
link the team export almost never carries: its league column was empty on every row of
three real exports, 309,504 rows between them. A team a pull brings back with no age from
GameChanger or its own name, whether from the pasted list or from the rota asking again
about a team waiting on an age, takes the age its organizations' names agree on
(`orgMembership.ts`), read by the same `ageFromOrgName` that measured 95.1% against teams
with an age of their own; two organizations naming different ages give nothing. Never
against GameChanger's own band: a team filed "Under 13" is not filed at 16U because an
organization's name says so. A waiting team a file can now age is asked about again at
once, as one somebody named an age for by hand would be. A partial export of 22 September
2026 kept 1,798 organizations over 11,515 teams and would age 141 waiting ones, 139 of
them inside the band GameChanger gives them and the other two refused by it.

`Entity Type` says what a thing is, not how its teams should be rated. A travel
organization is a club; a tournament is an event whose brackets often name an age; and
a **league is neither automatically** — "NKB 11u" is a travel league and
"Mt. Carmel Little League" is rec ball, and only the name says which.

GameChanger's public API allows only its own site as an origin, so the browser
cannot call it. `server/gc-team.ts` is a Firebase handler that reads a team's
profile and games on the app's behalf and maps every failure to a reason the
panel can explain. It sends the same `Accept` versions and `gc-app-name` header
the site does. `GC_EXTRA_HEADERS` takes a JSON object of extra headers for the
day AWS WAF starts challenging server traffic.

**Only the accounts on the cloud copy's list can pull.** The Firebase proxy
answers a request only when it carries the Firebase sign-in of
an account on the list (**Your data on every device**), and tells anyone else
`members-only` with what to do (**The GameChanger proxy on Firebase** says how it
checks). A browser nobody has signed in to, or one signed in with an account the
copy turned away, is told at the top of the pull panel, and every button there
that would start a pull is off, so nothing starts only to stop on its first
request. A run that began signed in and is turned away part way, by an account
taken off the list say, stops there, says why, and leaves the teams it had not
pulled unsettled, so **Carry on** asks for them again once signed back in.
Everyone else keeps the rest of the app with the data in their own browser, and
share links.

**The function passes GameChanger's answers through, and the browser reads them.**
Vercel bills a function by the CPU it keeps busy, and on 28 September 2026 the
app's Hobby plan ran out of it: four hours of Fluid Active CPU over 443,000 calls,
about 33 ms a call. Nearly all of that was the function reading what it fetched —
parsing and normalizing a thirty-game schedule measured 3.1 ms of CPU a team, 31 ms
for a request of ten, against 0.04 ms a team to pass the two bodies on as text. So
the app asks for `?ids=…&raw=1`: the same fetches, the same profile cache and the
same failures classified by status, but each team comes back as GameChanger's own
profile and schedule text, which the browser reads with the same normalizers
(`gcTeamFromBodies`) to the same team. Raw bodies are about 30% bigger than the
normalized answer and the same size compressed. The parsed answer stays for a
caller that does not ask, such as a tab still running an older copy of the app.

**Identity is asymmetric, on purpose.**

|                                   |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A team pulled by id               | _is_ that id. GameChanger mints a new one every season, so a club's Fall and Spring squads arrive as two teams and stay two until somebody pairs them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| An opponent                       | has no id — GameChanger never gives one, and its picture is different on every listing, so it identifies nobody. The game itself is matched first: a club whose own schedule holds this fixture is the club, by the same result or the same start time, though not two results more than four runs apart. Failing that, the name — at that level, in that season year, and in the puller's own state, since nine opponents in ten are; a sole namesake in another state waits as a stand-in. And a name puts a game on a pulled club only where that club's own schedule has a game that day or the day either side: a name is where to look, not who played. |
| A stand-in                        | is a name a schedule wrote down and nobody has pulled. One per name, level and state: a "Red Sox" named by clubs in ten states is ten stand-ins, not one club they all played.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| A club already here as a stand-in | is adopted rather than duplicated when its own turn comes: the stand-in its own schedule confirms, else the one at its level whose namers are in its state. In a full pull nearly every team appears as somebody's opponent first.                                                                                                                                                                                                                                                                                                                                                                                                                            |

The same game is on both teams' schedules and a re-pull brings back a schedule
almost entirely unchanged; both are matched rather than filed again (**One game on
two clubs' schedules** says how), and only a score that has since been played is
written. A 0-0 is read as no score entered,
which is what GameChanger means by it.

**A squad year runs August 1 to July 31.** "2027" is the squad that plays Fall
2026 and Spring 2027, and its season began on 2026-08-01. GameChanger lists a
club's older games under its new id often enough that a nationwide pull carried
three thousand of them; a game dated outside its squad year is left out on
arrival and deleted from a pool that already holds one.

**A winter is filed by its games.** GameChanger's label for a winter names either
year it straddles — "Winter 2026" and "Winter 2027" are both names for the one
that starts in November 2026 — so a winter team's squad year is the one most of
its games are dated in, and with none, the squad year being played if the label
can mean it, else the year after (`squadYearOfGcTeam`). Read off the label alone,
"Winter 2027" was squad year 2028: a pull of this season skipped such a squad as
another season's, and filed anyway, every game it played was dropped as dated
before its season began. Its age is read in that year too, because a class year
in the age field is a different age each year ("2034" is 11U in 2027 and 12U in
2028); the season picker keeps a winter row under either year it could be; and
the season pairings read a link in the year of the page it was filed on. The 719
winter teams in the 26 September 2026 pool are all labelled Winter 2026 with their
games in squad year 2027, and stay where they were filed.

**A pull files the season being played, unless told otherwise.** A crawl that
searches every season of a calendar year hands over last spring's and summer's
squads beside this fall's, each under a new GameChanger id with nothing else to
say its year is finished. So the panel carries a season picker under the list,
with the season being played ticked (2027 on 24 September 2026, which is Fall 2026
through Summer 2027), the one before it, and any other the list's `Season` column
names, each with the number of rows that name it. A row from a season left unticked
is dropped before a request is spent on it. A row that does not say is fetched and settled by
GameChanger's own season: the importer refuses a team from any other year before
its age is read (`other-season`), so it never joins the waiting list, and the
run's summary counts those in a line of their own instead of listing them under
**Worth a look**. The choice is kept with the run, so a resumed run files what it
was started for, and the same list asked for different seasons starts over. The
rota keeps to the season being played as well; see the next section.

**A team turned away is remembered.** A crawl that searched every season exports no
Season column, and pasting it again on 26 September 2026 sent 220,103 ids, about
22,000 calls, most of them teams an earlier pull had already refused as another
season's. Each finished run now keeps what it turned away (`refusedClubs.ts`): for
good when it is about what the team is (wiffle ball or softball, high school, adult, over the
oldest age; not a page whose name says it is no team, since a coach can rename one), and against its squad year when it was another season's, so it is left
out of a paste only while that year is unticked. A pill says how many were left out,
and **Ask again** forgets them. It is a cache of GameChanger's answers, like the
too-young list beside it, and stays out of backups.

**The tidy runs by itself.** At the end of every pull, and whenever the app opens
on a pool whose shape differs from the one it last tidied (once the page's first
board is up, since handing the tidy the pool is a copy of all of it on the page's
own thread, and made while the board was being asked for it held the rows back
by 1.5 s on a nationwide pool), the whole pool is gone over until a pass finds
nothing more: games outside their squad year are
deleted; a stand-in is settled by the other club's schedule (a mirrored result
settles it even when the two coaches typed different start times, and two
results that contradict are folded into one only at the very same start time,
against a stand-in whose name is a shorthand for the club, since nobody plays two
games at once — or, whatever the name, into a copy the club's own schedules left out, within the
hour and within four runs); a game each club filed against
a stand-in for the other is joined into one game between them (the same day; both results in and
mirrored, or one result and the other half unplayed at the same start time, or two results that
differ at the same start time where nothing that agrees fits — two unplayed halves
wait until they are scored; two mirrored results joined whatever start times the coaches typed,
since 104 of the 1,211 games this joined on a real pool were more than an hour apart and the same
search a week off matched no more for ignoring the clock; each stand-in's name a shorthand
for the other club's — "Stix" for "Cincy Stix Navy" — with no age a coach typed pointing at
another squad and no two different squad numbers; the two clubs in one state or two that share a
border, unless the two results mirror within the hour, as a tournament's travel has them — 93
games on the pool of 26 September 2026, where the same search a week off finds none; and no other
pair that fits as well); so is a game one club filed against a stand-in of the other club's very
name and the other against a stand-in or a slot, mirrored within the hour and the only match each
way (**A stand-in carrying the other club's very name**); a
game sitting by name on
one club moves to the namesake whose own schedule holds it, even where that schedule wrote the
puller down in shorthand or scored the game differently at the same start time, and where it has the
game at its very start with the result mirrored against a slot, any stand-in, or a club of the
puller's name whose own schedules never list it — then also to a club whose name fits the one the
row names, in one region, and never onto the puller itself (the Padres and Marlins of one Texas rec
league were filed crossed, each club's own row on the other's namesake; on the pool of 26 September
2026 the first tidy moved 479 rows and left 404 fewer games, and 403 single-link records changed,
400 toward the club's own rows and 262 onto them, found through an index of each club's own rows by
start and score, since a lookup by name cost 6 s a pass); a stand-in's rows
are filed onto the one club of that name in the puller's state (two in the state:
the one in the puller's own town; none in the state: the one in a bordering state, if exactly one
is — on the stand-in fixtures export of 22 September 2026 that was the club the game itself named
1,174 times in 1,240), and only where that club's own schedule has a game that day or the day
either side, or the name is one no other club carries (**A name no other club carries**); a row a
name filed onto a pulled club whose own schedule has none is taken off it onto
a stand-in of the name, as **A name is checked against the club's own schedule** sets out; two ids are one
squad only when their _own_ schedules filed the same fixture, at one level, in
one state, under one listing name; and two clubs' copies of one game are one game as
**One game on two clubs' schedules** sets out, kept once with the other side's score
noted where they disagree — as is every game above that two coaches scored apart at one
start time (on the stand-in fixtures export of 22 September 2026, 265 games joined, 479
settled and 35 taken back from a namesake). Where the other side is only a name — a
stand-in, a slot, a namesake — the start still has to be the same one, read as the same
minute: a club's own schedule can put two games an hour apart, so within the hour says
nothing about which club a name meant — except against a copy none of the club's own schedules
gives a row, which answers for nothing else the club listed. "Tidy now" on the
import panel runs the same thing for whoever wants to watch.

A pairing with the **same name, same town and same state**, a season apart at
one level, is applied on its own at the end of a pull: that is a club, not a
coincidence. Anything short of all three is **proposed, never applied** — the panel lists the clubs that look like the same club a season on (same name at the same level plus a pulled club in common, or the same picture; a shared name and state alone is no offer, since every rec league in a state has a Yankees), with a tick-all for the
list and a tap on any name to lay the two side by side: GameChanger's name for
each, town, state, record, games held here, and every opponent, with the ones in
common marked. A team's own panel lists the GameChanger ids it is known by,
unlinks one that was paired wrongly, and folds this team into another for one
that arrived twice. Beside each id it gives GameChanger's own season record for
it and when it was last pulled, so a record that looks off can be checked without
leaving the page. It says no more than that: on the pool of 24 September 2026
GameChanger's record disagreed with the team's own GameChanger schedule for about a
quarter of clubs, so a difference is a reason to look, not a verdict.

A run of a few thousand teams takes a while and saves as it goes: the pool is
written every two thousand teams, and less often as it grows, up to every five
thousand, because each save writes the whole pool however few teams came with it.
The cursor only advances after the write, so stopping, reloading or closing the
tab costs at most those two thousand teams, or five thousand on a nationwide pool.

#### How much comes round at once

Two cadences, chosen in the import panel and remembered. **Every age group, daily**
is the default: the board is only as current as its newest game, and waiting for a
level's turn means answering with a week-old week. It costs a full run's worth of
requests and of saving each day, which is the reason the other choice exists.

**One or two levels a day** spreads the work over a week instead, so no day's run
is long enough to be worth interrupting and nothing is more than seven days old:

| Day       |          | Day      |                      |
| --------- | -------- | -------- | -------------------- |
| Sunday    | 8U, 9U   | Thursday | 12U, 13U             |
| Monday    | 16U, 17U | Friday   | catch up on failures |
| Tuesday   | 10U, 11U | Saturday | 14U, 15U             |
| Wednesday | 18U      |          |                      |

`WEEKLY_ROTATION` in `src/lib/gameChangerSchedule.ts` is the whole of that table;
nothing else reads a day or a level. On the daily cadence every day is also a
catch-up day, which matters more than it sounds: a team with no age is on no page,
so a refresh by level walks past it for ever, and on the rota Friday is the only
day that asks about them at all.

Either way a day is counted once — opening the app twice in an evening does not
pull twice — and a level is marked done only when its run actually finishes, so
stopping half way leaves it due. When today is already done there is a button to
run it again anyway, for when something has changed that a day log cannot know
about. On the live page that is **Refresh now** on the Import tab, which runs the
same refresh in the cloud ("Refresh now in the cloud").

Either way, and that button too, only the season being played comes round. A
finished season's pages cannot change, so walking them every day spent a whole
year's worth of requests on nothing. What that costs is a result posted after
August 1 for a game in late July, which the rota no longer goes back for. The
teams waiting on an age are asked about only as the season being played's too (see
**A year put away stays away**).

**Nor a team pulled a few hours ago, unless it is playing.** A team pulled within
the last 16 hours (`MIN_PULL_GAP_HOURS`) waits for a later run unless its own
schedule holds a game dated yesterday, today or tomorrow (`idsPlayingAround`), and
the panel says how many waited. Three whole-pool refreshes ran within 42 hours on 25
and 26 September 2026. Of the 53,140 ids that two of them, fifteen hours apart, both
pulled, 10,783 (20.3%) came back with anything new, nearly all of it dated the day
it was pulled; the ids with a game within a day of the earlier pull were 32.3% of
the pull and held 75.2% of the changed ones. The rest of what changed is picked up
by the next day's run instead of costing a second pull of every team. The button
that runs a finished day again keeps to the gap as well, since a second press on
the same evening is how those three refreshes happened, and a team playing today is
never held.

The teams with no age are paced by that same principle, and used not to be. Each
is asked at most once a week — unless somebody has answered for it since its last
ask, which jumps the queue; see **Naming an age** — and left alone only once it has
had both its eight asks and eight real weeks since it was first found. The count on its own used to
be the whole rule, and nothing in `ageUnknown.ts` read a calendar — so eight
"passes" was however long eight presses of a button took. Driving the real
`dueRefresh` and `updateAgeUnknown` over a calendar, a short list was abandoned on
day 8, a list of 4,013 on day 15, and eight presses in one afternoon finished it on
day 2, while the card said "left alone after 8 weeks". `AGELESS_PER_CATCH_UP` is now
a ceiling on how much one run may hold in memory rather than a pacer, so the whole
list is offered at once and a list longer than the ceiling has its overflow asked
the next day rather than the next week.

A club somebody throws out is answered for, and both halves of that now hold: the row leaves the
waiting list at once rather than sitting there until a later pull happens to clean it up, and the
rota stops offering it. Neither used to be true. The decision was written to the dropped-clubs list
and nothing else changed, so the club was handed to the puller on every catch-up day, fetched twice,
and refused by `importOne` only after both requests had been spent — two requests a week, per club,
for an answer already given. At a dozen clubs that is invisible; at thirty thousand it is not.

A team GameChanger says is below the youngest level ranked here is remembered rather
than rediscovered. The paste already drops rows that name a too-young age themselves,
but a row naming no age is kept — most do not name one — so it is fetched, GameChanger
says 7U, and the schedule is refused. Nothing used to remember that, so the next
export spent the same two requests on the same answer, for thousands of teams. The id
now goes in a list of its own, the paste skips it, and `importOne` refuses it before
reading a game. It is a cache of a fact rather than a record of a decision, which is
why it is kept apart from the clubs the user threw out: burying a dozen deliberate
deletions under four thousand toddlers would make that list unreadable. A GameChanger
id is minted per team per season, so this can never hold a club down as it ages up —
next year is a different id.

A club somebody **threw out** is skipped the same way, before a request: the paste
drops it with an "N you threw out, skipped" pill, and every run settles one it still
carries — a run saved before the club went, or a rota or roster run's list — without
asking GameChanger. The importer refused it anyway, but only after fetching its profile
and games, and each refusal was then a row under "Worth a look". Re-pasting the
seasoned list was 53,385 requests of which 20,146 were clubs already thrown out; the
retry the re-paste exists for now spends its requests on the rows that never made it
in.

Only that team's own schedule can answer the question about it. `ageFromOpponentNames`
reads the opponent names off the schedule just fetched, and neither the pool nor the
index is on that path — so pulling other clubs never settles an age, however many of
them name one. What changes the answer is the club editing its GameChanger page, or
the team playing more games against opponents who do name an age.

Nothing fires by itself — there is no server here, and a browser cannot run while
it is closed — so the panel answers "what is due?" when the app is next opened.

**Teams waiting on an age.** Setup carries a card for the ones nothing could settle,
ten at a time. Ten because four thousand rows is not a queue, it is a wall; and the
ten do not reshuffle while they are worked — they stay the ten, shrinking as they are
answered, and the next ten arrive once the last is done. Nothing extra is stored to
track that: a team is answered when somebody named its age or threw it out, and both
of those are already stored, so the queue is derived from them and cannot drift out of
step. Closing the tab loses which ten were in front of you and no work.

Each row carries the GameChanger id and the complete name — the two things needed to
go and look a team up — a link to its page, the reason the age could not be read, and
whatever was kept when it was refused. The reason is the useful part:
`ageFromOpponentNames` gives up for four different reasons and returns one `undefined`
for all of them, so the counts are kept and say which. "None of its four opponents
writes an age" is a rec league and will never come good; "two of its three say 9U" is
settled in a second; no games at all is a blank schedule.

**Only the teams a person can answer.** The owner, 18 October 2026, with 11,489 on the live list:
"No single person can search through 11,000 teams." So the ten are drawn only from teams with
something on the row to answer from, and every other row is set aside, for one of five reasons
read off the row (`setAsideByRule`, `agelessQueue.ts`): the name says it is no team (a word the
import refuses a page on, "old team" or "not a real", only "Team" with a number, a letter or an
age, no letters, two characters or fewer); the schedule reads as made up (named void or do not
use, every game scored on a day that has not happened, or `looksInvented` at half a point or
more); it reads as a high school side (GameChanger's school label, a side that plays varsity and
JV teams, a school's name or initials the refusal at the door does not take); it has no games yet,
or nothing was kept to say it has any; or it has games and not one opponent writes an age of 8U to
18U, which no reading of its opponents can ever age (`writesARankedAge`: an opponent writing 6U or
19U is counted as writing an age, and the tally read back from storage keeps only the ages this app
ranks, so such a row read "Its opponents do not agree: ." over nothing at all, and its line now
says that none of the ages written is one this app ranks). A roster short of nine is set aside as
before. Set aside is worked out afresh from the row each time and never stored, so nothing is
deleted: the rota goes on asking about every such team inside its budget (`ageUnknownDue` and
`ageUnknownAsking` never read the queue), each ask writes a new row with what the schedule says
now, and a team whose new row no longer reads so is back among the ten by itself.

The search still reads the whole list and says of each why it is aside, and under the note the
reading that set it aside and no other (`asideBecause`): a school's name with a practice word in
it is aside as a school, by its name, and says so, not that it reads as a practice account. A side
the import would refuse as a school's, by its name or GameChanger's field, is "left out of the
rankings and off this queue"; one only read as a school's, by who it plays or initials in its
name, is "kept off this queue", and an age named for it files and ranks it as any team's does.

An age can be named for any row but one the import refuses before it reads an age
(`refusedByName`, `refusedAsSchool`): a thrown-out club, a squad refused as a school's, and a page
whose name says it is no team ("Team 7", a practice) or another game, whose age the next ask would
throw away with the row. A page refused by its name keeps the throw-out, which lands at once, and
its note says its next check takes it off the list unless the club has renamed it by then; a squad
refused as a school's keeps no buttons, as before. A name with no letters, or of two characters,
the import files, and an age named for one lands. An age named before for a page the import now
refuses says so ("the next refresh leaves it out rather than filing it"), with its Undo.

The groups under **Settled by rule**, and the pass that clears them, read every row still being
asked about, the set-aside rows among them, as they read before; the downloaded file holds the
queue's rows. Under "Showing 10 of N" the card says in one line how many each rule set aside, that
each comes back on its own once a later check finds that changed, and that Find a team still
finds every one; the live page's card says the same, from the counts the server's `ageless.queue`
now carries. The card's opening line says what is left: teams with opponents who write an age,
too few of them to file the team by or not agreeing on one. On the backup below, 1,361 of the
queue have one such opponent, 181 two and 218 three or more.

Measured on the backup of 11 October 2026, read on 18 October: of the 13,169 listed, 3,067 were
off the queue for a short roster and 10,102 on it. With the rule, 1,760 are on it, the teams at
least one of whose opponents writes an age of 8U to 18U; set aside are 6,713 that play nobody who
writes one (2,873 of them with six opponents or more, and 113 whose opponents write only an age
out of that range), 1,618 with no games, 3,067 with fewer than nine players, 10 whose name says no
team and one high school side, and none for a made-up schedule, the import refusing those at the
door now. Searching each of the 13,169 by its id gives the same reasons in the same numbers. The
first sitting over the list (`agelessSitting`) took 138 ms where it took 187, and the next, with
every row's reading cached, 14 ms where it took 36 (medians of seven, Node 24, the two builds read
in one session).

**Two opponents agreeing are enough.** Three agreeing is the old bar and still the one a
split is judged by, but two opponents naming one age with nobody naming another now
settle a team too (`ageFromTwoOpponents`), held to GameChanger's own band. It was
measured before it shipped: over the pool-names export of 23 September 2026, on teams
whose age the pool already files, it matched the filed age for 10,330 of 10,623 — 97.2%
exact, 99.7% within a year, against 99.0% for three — and on the waiting list of the same
day it answers 554. Rows whose stored name or opponents the rules of that day already
answer jump the re-ask rota once (`withRulesMoved`, dated `AGELESS_RULES_CHANGED_AT`), so
the next pull files them rather than the week after; on that list, 815 of 16,611. One
opponent alone is 93.6% and is not enough: one team in sixteen would land a year or more
off.

A team whose name says a high school squad is not on this card at all, even one that
went onto the list before that rule existed: the name settles it, so it costs none of
the ten, and the next time the rota asks, the answer comes back `high-school` and the
entry retires itself.

Nor is a team whose GameChanger roster lists fewer than nine players (`shortRoster`), by
the user's rule of 28 September 2026: it takes nine to field a side. On the waiting list of
26 September that was 3,232 of 13,962 teams, 1,742 of them with nobody listed at all, where
the clubs pulled with an age list fewer than nine on 1,717 of 53,252 GameChanger teams. It is
held off rather than thrown out: the row stays stored, the rota keeps asking about it while
it has asks left, and each ask replaces what was known — so a squad still being assembled
comes back on its own once a check finds nine. A team nobody gave a count for stays on the
card, and the search still finds a short one and says why it is off the queue.

A lone `V` is the opposite case and stays. "Madison V" is the varsity side on a school
schedule and is equally a squad number, a colour or a coach's initial, and one letter
is too thin to refuse a real club on. So it comes to the **top** of the queue, with
the reason written out — it is the one row here anybody can settle by opening a single
page — and the card carries a **High school** button beside **Not a real team**, since
a varsity side is a real team that simply plays a season this app does not rank. Both
buttons do the same thing to storage: thrown out at once, and never brought back.

**Finding one team.** The card carries a search box, and it reads the **whole list** rather than
the queue. It matches the name, the GameChanger id, the town and state, and the opponents the card
already shows — a club is remembered by where it is from as readily as by its exact squad name.
Every word has to appear and they need not be adjacent or in order, because the real names on this
list read "Mears 1 - 2026" and a plain substring test turned "mears 2026" into no matches at all.
Best match first — the whole name, then the start of it, then anywhere — because ordering matches
by how invented a page looks puts the wanted team past the cut. That is the point of it: the queue is the small end, ten at a time out of tens of
thousands, so "I know this club is in here" is very often a team the queue is deliberately not
showing. A match that is off the queue is shown with the reason — you threw it out, you already
named its age, it reads as a high school squad, it was left alone after its asks ran out, or one
of the rules that set a row aside — and for the two of those that are your own answers, an **Undo
that** button takes it back.
Before this there was no way to undo either one anywhere in the app.

**An age from the organization a team sits under.** The very bottom of the ladder. An
organization named "TPABL 12U" or "GLL 8u Fall 2026" is saying what age plays under it, and
for a team with no age of its own that beats nothing, which is what such a team has.
GameChanger's public API has no route from a team to its organization, so this only arrives
from a crawl that found the team through one.

Refused for events and for spans, and both refusals are measured. Over 17,003 teams
carrying an organization, 2,240 had both an org naming an age and an age of their own to
check against. The org's age agreed **90.1%** of the time; excluding event-sounding names
took it to 94.1%, excluding spans to 93.9%, and excluding both to **95.1%**. The errors are
overwhelmingly one-directional — of 221 disagreements, 197 had the organization _older_ —
which is the play-up signature: "(09/25/2026) 17/18u Super Fall Invitational" holds 16U
teams, "Suburban Travel 13/14u" holds 13U ones.

The span filter allows an optional `U` after the first number as well as the second,
because clubs write it both ways and without that "13U-16U" reads as a plain 16U and files
thirteen-year-olds three years old.

95% is not good enough to outrank anything a team says about itself, so it sits under the
league rung and under the company a team keeps, and only ever answers a team that has no
other answer at all. On a real backlog it reaches **273** rows — small, and honestly so.

**An age from the company the pool already knows.** The last rung of the ladder, and the
one that reaches the backlog's most hopeless population. `ageFromOpponentNames` reads an
age out of an opponent's _name_, so it can never settle a team in a closed league where
nobody writes an age in anything — "Team 4" playing "Team 2" and "Team 5". Over a real
36,194-row backlog, 10,709 rows are exactly that shape.

But the pool has usually met those opponents. A team refused for having no age has just had
its whole schedule fetched, and most of the clubs on it are already filed, at an age
something else settled. That answer was one lookup away and nothing asked for it.

**By identity, never by name.** The opponent is matched on its avatar key — stable per club
across schedules, and what `resolveOpponent` already trusts. That is what makes this safe: a
name match on "Team 4" would collect a stranger from the other side of the country, and a
pool holding tens of thousands of teams has a great many "Team 4"s. Where two clubs share a
picture the picture identifies nobody, and the opponent is skipped; where the pool has a
club filed at two ages it is running two squads, and it says nothing about this one.

Held to the same bar as the name rule — `MIN_OPPONENT_AGE_EVIDENCE` distinct opponents
agreeing, a tie refused — because it is the same kind of claim: circumstantial, about the
company a club keeps, and wrong in the same way if a squad plays up all season. It sits
below the name reading for the same reason: a club writing "12U" in its own name is telling
you about itself, while this tells you who it plays.

**An age from the games themselves.** The picture turned out to be no kind of identifier —
7,948 teams in a nationwide pull carried 7,948 different ones — so the rung above seldom
answers. The games do. Each pulled club that played a no-age team holds its own half of the
game, filed against a stand-in carrying whatever its coach typed for that team.
`ageFromFixtures` finds those halves the way the crossed-halves join does: a row a pulled club
filed that day off its own schedule, against a stand-in whose name is a shorthand for this
team, with the result mirrored or at the same start time — and the name this team typed a
shorthand for that club, the two in one region. A game two clubs could each have been names
nobody. Each club counts once, at its own listing's level, and a club listed at two levels says
nothing. The answer is held to the name rule's bar: three clubs, a strict majority, three on
the level it gives. On the stand-in fixtures export of 22 September 2026 the two clubs of one
game were filed at one level 73.5% of the time and a level apart 22%, so one club's level is a
guess and three agreeing is not. From the waiting list's own file, which keeps only three of
each team's opponents, it ages at least 32 teams, and every one of the 31 whose GameChanger age
field gives a band lands inside it. It sits below the picture, and is recorded on the
pull as `ageFromFixtures` as well as among the ages from opponents.

**And last of all, an age the name writes loosely.** The ordinary reader wants an age
with word boundaries round it and a U on both ends of a span, which is what keeps
"12UNDER", a date or a squad number out. So it misses "Spiders12U", "10U_Hartman",
"Donegal Green 12u2", "U13s Blue", and spans written without their U, "Giants 11-12" and
"Braves 9/10". `ageLevelFromLooseName` reads those, a span at its older end the way one
with a U is read: two ages a year or two apart, in order, and not a date or a score. A span
can be two school grades as easily as two ages, and the user settled that in these names it
is ages; a name that says "grade", or puts an ordinal against a number, is left alone. It
is the very bottom rung, below the games, so no team anything else ages moves, and it never
files against GameChanger's own band. On the pool-names export of 23 September 2026 it
fires on 537 of the 102,845 names the ordinary reader finds nothing in — the glued forms
92.9% exactly the age filed and 98.8% within a year, the spans 72.4% and 93.3%, most of the
rest filed at the younger end. On the week's waiting list it reads 545; the band refuses
12, and of the rest 514 are filed and 19 turned away as under 8U. Recorded
on the pull as `ageFromLooseName`.

**A name outranks an age column, on a pasted list.** The age ladder reads two kinds of
age field and does not trust them equally. GameChanger's own `age_group`, first-hand from
its API, outranks a plain age in the team's name. The age column of a pasted list does
not: there the name wins.

The reason is that a column is only as good as whoever built the file, and a name is the
club's own statement. Measured against the 60,040 teams this pool already ranks: over an
83,941-row export the column and the name disagreed 21,320 times, and for the 8,822 of
those whose team could be found in the pool by name, the **name** matched the filed age
7,603 times — 86.2% — against the column's 187, or 2.1%. That export's column turned out
to be the age bucket its crawler had searched rather than the team's own: it was identical
to the file's own `Found Via Ages` in 59,794 of 59,799 rows. "BattleHawks 10U" carried
11U, "MBC 8U" carried 9U, "BNE NTH 1 12U" carried 18U.

A correctly built list points the same way, less starkly. The "Check the id" pull of
40,760 teams found the two disagreeing by one 343 times, with the name carrying the right
level in 267 of them — so it is the age field that wanders, even when nothing is wrong
with it.

**And a name too young to read stops the ladder** rather than letting the column answer
for it. `MIN_GC_AGE_LEVEL` is 6, so "4U Sparrows" and "5U T-Ball Couto Baseball" read as
nothing at all — and without this the ladder fell through to a column that offered 9U.
298 names in that export state an age below the floor and the column offers 9U or 8U for
248 of them. Refusing leaves the team ageless, which is the safe direction: an unaged team
costs its own ranking, where a team aged five years wrong corrupts every club it played.

Across the whole export the two rules move 20,869 rows to a different age and refuse 254
outright, leaving 62,818 exactly where they were.

**The age field GameChanger was already sending.** The age group is not only "12U" and
"Varsity". It carries a small closed vocabulary of its own, and for a long time this app
understood none of it: `parseGcAgeLevel`, `ageLevelOf` and `isSchoolAgeLabel` all returned
nothing for every value in it, so teams whose own page plainly said what they were sat on
the waiting list being asked about every week.

Measured over the 36,194 teams waiting on 22 September 2026, where the field is set on
36,182 of them — 99.97% — and holds exactly eleven values: `Under 13` (27,485), `Between
13 - 18` (3,967), `Over 18` (2,049), `college` (719), `18O` (535), `middle_13O` (419),
`middle_12U` (379), `high_varsity` (313), `high_freshman` (164), `elementary` (104) and
`high_junior_varsity` (48). They are read three ways.

**Adult and college** — `Over 18`, `18O`, `college` — are refused outright, the way a
wiffle ball team is. This app ranks youth baseball, so there is no age on one of these to
find: the `Over 18` rows include "Long island Angels 44" playing "LISM Patriots 44+", and
the `college` rows "MCC Wolves" playing "Coffeyville CC". Asking weekly is two requests a
week spent on a question with no answer. `18O` means eighteen and over and is the one that
brushes against a real 18U squad; of the 3,303 rows carrying any of the three, thirty have
a name that reads 18U-ish and almost all of those are plainly college ("UNT Club Baseball
2026-2027") or a league's own admin account ("FALL Board 2027"). The handful left is the
price of the other three thousand, and a refusal is undoable where a wrong age is not.

**The school bands** — `high_*`, `middle_*`, `elementary` — retire on the same terms as a
varsity side, because that is what they are: "Sentinel JH Bulldogs", "7th CyFair ISD -
Salyards MSM" playing "Cy fair Combo 7th Grade". Note `middle_12U` names an age and is
still not read as one. A seventh-grade school side is a school side; reading the 12 would
file it against travel clubs it never plays.

**The two bands bound an age without giving one.** `Under 13` and `Between 13 - 18` cover
87% of the backlog and can file nobody — there is no single age in either — but they can
refuse one, and that is where their value turns out to be. Against every candidate rule in
`agelessTriage.ts` over the same rows, 1,186 of the 1,203 ages those rules derive already
sit inside the band, 98.6%. All seventeen that do not are the same mistake: a PONY division
word read off a mascot or a university. "SMSU Mustangs Home" is Southwest Minnesota State,
filed `college`, and was about to be ranked at 10U; "Owls Colt" and "Canes Colts" are filed
`Under 13` and were about to be ranked at 16U. The veto lives in `agelessVerdicts` rather
than inside each rule, so a rule written later cannot forget it.

`Under 13` is read as a ceiling of 13 rather than 12, deliberately loosely: Little League's
Intermediate division is ages 11 to 13 and this app files it at 13U, so a twelve-year-old
in that division is `Under 13` and 13U at once and neither is wrong. Read strictly, the
band vetoes 178 Intermediate teams it has no business vetoing.

**The pool's own names, for measuring a rule against what it must not break.** Pool health
carries a **Download the pool names** button: ids, names, the age each team is already
filed under, and the same evidence the backlog rows carry — games, scored, ahead of today,
shutout blowouts, opponents, how many of them named an age, which ages, and a sample of
the ones that named none. No games themselves, so a hundred thousand teams is a few
megabytes. Nothing in the app reads it.

The opponents' ages are read off `GcTeamLink.name` — the name GameChanger gave, age label
and all — rather than the pool's own stored name, which `cleanTeamName` strips the age from.
That distinction is not a detail: "how many of its opponents write an age" is the question
`closed-cluster` turns on, and against cleaned names the answer is no for essentially every
team in the pool by construction. The first export carrying evidence had 50,810 of 50,822
ranked teams reading zero, which made `closed-cluster` look like it fired on 36.5% of the
working pool when in truth the file could not tell.

The evidence half is there because without it the tripwire can only measure the rules that
read a name. The five that read a schedule — `closed-cluster`, `school-by-evidence`,
`near-miss-tally`, `no-games`, `scored-ahead` — could not fire against a file of bare names
at all, and reported a zero that means "not measured" and looks exactly like "safe".
`closed-cluster` alone proposes a verdict for 10,709 backlog rows, so that distinction was
worth the columns. The counts use the same definitions `agelessEvidence` uses, per distinct
opponent rather than per game, because the tripwire compares what a rule does here against
what it does on the backlog and two readings of "opponents" would make that meaningless.

**The stand-in fixtures, for measuring a join by the game rather than the name.** Pool health
also carries **Download the stand-in fixtures**. A stand-in is a club known only because a
pulled schedule named it; the pool-names export found 46,118 of them holding 83,142 results,
4,995 with exactly one ranked club of the same name, age and year, and at least 1,357 of those
mirrored — each of two pulled clubs holding a stand-in for the other, one real game filed as two
halves that never meet. GameChanger's games carry no opponent id, so a name is all a schedule
gives; but a club plays one game at one instant, which makes the start time a proof a name can
never be, misspellings included.

The file holds every row with a stand-in or a TBD on one side and, beside it, each row that
could be its other half. The puller's own second row at the same instant (`same-club`): it
cannot have played two games at once. Another club's unsettled row at the same instant — against
a stand-in, a slot, or a pulled club of exactly the puller's name — whose names both support the
pairing, or one name and a mirrored result (`fixture`). And the same on the same day at another
time (`same-day`), held to both names and no contradicting result, because the two schedules of
one game do not always agree on its start: requiring the times to match once left about a
thousand settled games standing. "Support" is generous on purpose, so a stricter rule can be
tried on the file afterwards: the same key, the same letters run together, a word in common, or
a word one slip apart — which lets a changed digit through too, and "2032" beside "2033" is two
graduating classes, not a typo.

Both searches are run again a week either side, same weekday and hour (`decoy`, `day-decoy`),
where the schedule looks the same and the game is not there, so the rate at which each matches
by chance is in the file beside what it finds — a week rather than an hour, because an hour off
is exactly the mistake two coaches typing one start time make. Rows with nothing beside them are
written as `none`, because they are the denominator. Each side's date, result and last pull are
there too, because the first question about a pair that never joined is why the rung that joins
exact names did not — it needs the dates to agree and the results to mirror.

What the searches leave out was measured, on a pool of 241,000 games built from the pool's own
120,210 team names paired at random, with 5,000 true mirrored pairs planted in it — all 5,000
were found. A row between two clubs already connected to each other is left out: admitting those
raised the stand-in rows with a decoy at the instant from 460 to 2,057 and those with a same-day
"match" from 1,343 to 5,649, all chance, and took thirty seconds rather than twelve. One shared
word with nothing else behind it found
a "match" at the instant for 18,679 of the 84,000 unplanted stand-in rows, more than one in five,
and admitting one name with a mirrored result on the day took the same-day search from 1,343
rows to 6,104 — every one of them chance — so neither is in the file. What chance is left shows
up as about 230 decoys a week-side at the instant and 960 on the day, against 94,000 stand-in
rows. It took twelve seconds, and the button says how far along it is. Nothing in the app reads
it.

Two rules still cannot be measured this way whatever the file holds: `adult-label` and
`school-label` read GameChanger's own age field, which the pool keeps no copy of. The sweep
names them as not measured rather than printing their zero. It goes to `npm run ageless:sweep -- <backlog> --pool=<names>`, which cannot
otherwise ask the only question that matters about a candidate rule — what it would do to
the teams that already work. Because the file carries the filed age, a hit splits into
"agrees with the pool" and "disagrees", and it is the second column that should be zero.

**Clearing what a rule has settled.** The waiting card lists, under **Settled by rule**,
each rule that has claimed rows, with its count, a tickbox and a few of the names, and one
button clears everything ticked in a single pass. It asks first, where the single throw-out
deliberately does not: the argument there is that a dialog in front of the common case
costs a click to guard against the rare one, and here the action _is_ the rare one,
thousands of rows at once that nobody can check by eye afterwards. The dialog says how many
each rule is clearing.

The rules are named by id in `CLEARABLE_RULES`, never picked by tier, and each is a call
already made rather than a guess. Two repeat GameChanger's own age field — adult or college,
and a school squad. The rest are the user's, made over the 38,603 rows waiting on
22 September 2026:

- **Named void or do not use** — cleared whatever its schedule. 68 rows.
- **Tee ball and younger** — tee ball, PONY's Shetland and Foal, and a name stating an age
  under 8U; below the youngest level ranked, as every such team already is at the door. It
  stands down for a name that writes a rankable age of its own. 1,919 rows.
- **Rec ball in a closed league**, cleared for good: nothing will ever age such a team from
  its opponents or join it to a club this app ranks. A team counts only once it has played,
  when nobody it played writes an age, its own name states none (not even loosely, as
  `ageLevelFromLooseName` reads one), and it does not call itself
  an all-star, travel, select, elite or tournament side. Then any one of three things marks
  it: GameChanger files it under Little League, Cal Ripken/Babe Ruth or PONY (13,538); it or a
  team it played is named for a rec division or league — Majors, Minors, AAA, Farm, Coach
  Pitch, "LL", or a league's initials written in capitals like NCLL (4,370); or two of the
  teams it played carry a Major League club's name, the way a house league hands them out
  (1,813). Of those 19,721, 37 carry a word a travel club might, and all but three are Little
  League "National" divisions or plainly house league.

Between them 21,708 of the 38,603, 56%. League initials are read in capitals only, from a stem
of four letters with at most one vowel, and never as an ordinary word: read case-blind,
"Fall", "Ball" and "O'Neill" all end in LL, and a first draft cleared "Aces" for having played
"Riverside Rats Fall 26". The rules that only propose — a closed league that names itself
nothing, a horse mascot, a grade word — are never on the list.

**An empty schedule is judged by its season.** A team with no age and no games at all is
asked about again weekly while its season is being played, because the schedule is a thing
somebody has yet to write. From a season that is over or not begun, the import drops it from
the list without remembering it (`out-of-season`), so a later pull finds it again once its
season comes round with games, and the run's summary counts it rather than listing it under
**Worth a look**. The windows are wide and overlap — spring February to June,
summer May to August, fall August to November, winter November to February under either
year's label — because erring towards "being played" only costs a weekly request. The
season rides on the waiting row and in the downloaded file's **Season** column.

The pass is stored whole before the rows go, at a lazy key beside the pull log, so **undo
outlives the toast**. That matters more here than anywhere else: a team refused at the
door was never filed, so the row on the waiting list is the only record it was ever asked
about, and undoing by re-fetching would cost two requests a team to learn what was already
known. One pass is kept, not a history — what somebody wants is to take back the thing
they just did — and a new pass replaces it, which is also what bounds the size.

**Taking the list away with you.** Thirty-six thousand rows is not a queue anybody works
ten at a time, and the card cannot become a spreadsheet. So a **Download the list** button
writes one: every team still waiting, each with the evidence behind it — the age field
GameChanger did give, its sanctioning body, town, state and season, the games and how many were
scored on days that have not happened, the opponents and whether any of them named an age,
the roster count — and an empty **Answer** column to fill in. It sorts and filters on a
bigger screen than the one it was collected on, and it is the file `npm run ageless:sweep`
reads when the rules are being measured.

It is also the only way this list leaves the browser at a workable size. It rides in the
whole-browser backup too, but that file carries every season and every game beside it and
runs to hundreds of megabytes on a nationwide pool — too big to move, and mostly things
nobody looking at this question needs. These rows are a few megabytes.

The first three columns are named to hit the aliases the team importer already matches, so
a worked file pastes back into the import box as a team list. The fourth is deliberately
**not**: the observed age field is called `Age Field`, never `Age Group`, because the
importer reads `age group`, `age`, `age level` and `division` as the age. Naming it that
way would let GameChanger's own rejected label beat the answer the reader was asked for
precisely because it was rejected — silently, and the moment a division-name rule joins the
ladder. A test pins the name.

Throwing one out does not ask first. This is a queue worked ten at a time and mostly full of junk
that takes a second to recognise, so a dialog in front of every one puts a second click on the
common case to guard against the rare one. The guard sits after the action instead, as an **Undo**
on the toast, where it costs nothing unless it is needed — and it can, because nothing is
destroyed: the club was never filed, so throwing it out writes an id to a list and the undo takes
it straight back off. A team that gets past the toast is still findable by name here.

Saying what age a team is now puts it back in the queue even if it had been left alone, because a
person answering is a third thing that can change the answer and the only one the give-up rule
does not know about. Without that, an age typed against an abandoned team sat in storage and never
reached a schedule.

From 27 September to 18 October 2026 the teams least likely to be real came first, then the
ones that read as high school sides, then everyone else — the user's order, since working this
list was mostly clearing it. Those two groups are the rows now set aside (above), so what is left
on the queue keeps the order it had among itself: least likely real first, one carrying a lead,
then the stalest. **Unlikely to be real** is a name nobody gives a team that plays (the words the import refuses
a page on, `notATeamWord`, and "old team" and "not a real"; "Team 1"; no letters in any script;
two characters or fewer), a triage rule that says so (named void or do-not-use, every game
scored on a day that has not happened), or `looksInvented` at half a point or more — the
score counts games carrying scores on days that have not happened, shutout blowouts, a
record claiming far more games than the schedule lists, a roster under nine. Half a point
because a fifth is one blowout in one scored game, a real team's bad day. **Probably high
school** is GameChanger's school label, a side that plays varsity and JV teams, or a school
name the refusal at the door does not take ("Tigers High-school", "LCHS Fall Ball 2026", a
freshman side), never for a side GameChanger bands under thirteen. Within each group the
least likely real goes first, an empty schedule a little ahead of one with games; then one
carrying a lead; then the stalest. Over the 13,958 waiting on 26 September that is 144
unlikely (113 of them test and practice accounts), 100 high school, and the rest; the first
thirty rows are all "Test", "Practice" and "Delete Me". Read with the import's words from 17
October, the 13,169 waiting in the backup of 11 October hold 49 unlikely by name where the old list
read 23, none lost; 57 of them are refused by name on their next ask and leave. It ran the other way for a while,
likeliest real first, on the argument that the real decisions are what a sitting should
reach.

It is **only an ordering** either way round. A row sorted up says why in one plain line,
and that is all: nothing is thrown out on it, no row is coloured by it, and sorting first
is not the app calling a team fake; an empty schedule is a club somebody made this morning
as often as it is a fiction.

**One shape is thrown out outright: a schedule that is nothing but results from the future.**
Every game on it has a score and every one is dated after today — "Test team" with 68 of 68,
"ShotByKoRob Scout Team" with 13 of 13. No reading of that is innocent, and the rule is the
user's, stated flatly: if a team's entire schedule is completed games in the future, the team is
fake. The import refuses such a schedule as `invented` before it asks the team's age, so it never
joins the waiting list to be asked about every week, and the run hands its id up to the clubs the
user has thrown out. That last part is what makes it stick: the dates give it away only until
they pass, and a schedule of October results refused in September would read as a season played
by November. Only the whole schedule counts — one game already played, or one future game still
waiting for its result, and it is left to `unrealClubs` and a person, as before. A game dated
today is never ahead, and a league row's "M/D" is never compared. The waiting list's
`scored-ahead` rule reads the same definition off the evidence a row kept, so a team already
waiting is named the same way before its next re-ask throws it out; the floor of five games it
used to carry is gone.

**What is left is listed worst offender first, and each row opens its schedule.** Pool
health's "Scored on a day that has not happened" charges each such game to the club whose own
schedule filed it (`filedBy`: the pulled id in `source`, and any other schedule whose own row
scored it), not to both sides. A schedule that listed the fixture with nothing in it filed no
result: every copy of a game folded in is now on record, the victim's placeholder for it
included, and counting those put a real club on the list at three of five beside the club
that invented the scores. An invented game is written by one club against another that never played it, so
counting both put the victim on the list with every invention against it — a real club an
inventor listed as its opponent every week came out above the inventor. A game nothing traces
to a schedule, one typed by hand, still counts against both. The rows drawn above the club list
follow the same order, the worst club's first, and every club and every row links to the
filing club's GameChanger page, so investigating one is a click rather than a search. Past the
first twelve clubs, "Show all" lists the rest.

A club on that list that you know is real can be taken off it: **It's real** remembers its
GameChanger ids beside the clubs thrown out (`loadRealClubs`), backed up with them, so the next
pull does not put it back. Its games dated ahead still count for nothing; only the question is
answered. An answer given by mistake can be taken back: a line under the list says how many
clubs it is keeping off on your word, **Show them** names them, and **Put it back** puts one on
the list again, where it was.

**A win by more than thirty runs is suspected of being made up.** Nobody wins a youth game by
9,999 runs, and the pool of 26 September held a game that said so, with 143 others won by more
than 30, 19 of them by more than 100. The rating cap, then 8, held each to an 8-run win;
uncapped, one of them put a club with no other result at the top of the 9U board. Now such a
game counts toward no rating or record (`isImplausibleScore`, read as the rating reads a margin,
both clubs' reports together), and Pool health lists it, widest first, to be deleted —
remembered, as a row dated ahead is — or vouched for with **It's real**, which keeps the margin
vouched for (`ScoutGame.scoreConfirmed`) and counts the game while it still reads that margin: a
vouched-for 31-0 corrected or re-pulled as 9,999-0 is suspect again. Thirty is the user's line;
one game in eighty is won by more than 20. On that pool 253 clubs' records change, and the 9U
board barely moves: the median club by one place, nine by a hundred or more, the top ten not at
all.

The clubs that post them head Pool health's **Clubs that may not be real**, the user's call of 28
September 2026: a club whose schedule filed a win by more than thirty runs that nobody has
vouched for is listed whether or not anything of its is dated ahead, charged to the side that
won it where that side's schedule filed it (`filedBy`), so a club whose own schedule records a
rout against it is not said to have won one, and those clubs come first, most such wins first,
with a red pill saying how many; the clubs with results dated ahead follow in their old order.
The list is its own section now, so it shows when nothing is dated ahead at all. **Delete club**
acts at once, without a dialog, as the user asked the same day.

**Clubs removed for you.** The user asked on 11 October 2026 for the obviously fake teams to be
spotted and taken off without them, and for teams named void, test or demo to be among them. So
each night, after its pull and its tidy, and on a night with nothing to pull as well, the nightly
sweeps the cloud copy for them (`obviousFakes.ts`, run from `cloudRunner.ts`), as each leg of
**Refresh now** in the cloud does. A leg of a list pulled in the cloud does not, a pasted list's or
a catch-up's (**Ask again about teams nobody could age**, **Check short rosters again**), nor does
a list with nothing new to pull: the sweep walks every game of the pool, and a whole squad year,
about three times the pool of 11 October, is to come in through pasted lists, so each of their
legs is kept as light as it can be and that night's refresh sweeps what they filed. A pull
in a browser that keeps its own pool sweeps that pool when it ends, in the tidy worker after the
tidy (1.5 s on the pool of 26 September at 18:40 and 2.5 s on 11 October's measured in Node,
which the page's thread would spend frozen). A pulled club is taken off when it shows one of four
signs and nothing keeps it:

- **Routs nobody else lists** (A): two or more wins by 40 runs or more that nobody has vouched
  for, filed by its own schedule, and none of its wins by 40 or more listed by the losing club's
  own schedule, at any age: the user's "repeated wins by 40 or more instead of 30" of 11 October.
  At thirty the sign waited for 11U unless one of the wins was by fifty, since a young travel team
  routs stand-ins and three clubs of 8U to 10U the user had called real were each one such win
  from it on 11 October. At forty the wait changes no mark on the five backups of 25 September to
  11 October, and with the word "real" set aside the sweep takes none of the 131 clubs the user
  had called real, 72 of them 10U and under, so it is gone.
- **One impossible rout** (B): a win by 75 or more that the loser's own schedule does not list. On
  11 October 2026 no game both clubs' schedules list, and none of the 77 scores the user has
  vouched for, reaches fifty (the widest of each is 42.5); on 29 September one game both list read
  54.5, and on 26 September, before the user's own sweep of the 28th, three reached fifty, the
  widest 119. A game the loser lists is never a sign, whatever its margin.
- **Results from the future** (C): three or more scored games, half or more of them its own
  schedule's results dated eight or more days ahead, no opponent's schedule lists any of its
  results dated ahead, and no real opponent's schedule lists any game of it at all. The eight days
  keep out a game keyed a day or two off. The three games are the user's word of 11 October: it
  "can't be a situation where they only have 2 games listed and one of them is in the future". On
  the five backups that leaves C two clubs on each of 25 and 26 September, each with two of its
  three scores dated weeks ahead, both deleted by hand since, and takes from it the next season's
  squads with fewer than three scores that were all it marked on 29 September (two) and 11 October
  (one). Where a club C takes is next season's squad, the list says so, with the day of its first
  score ahead. The last clause is what lets C's lift below hold: without it a club whose mark one
  real game had lifted showed the sign again that night, short of the guard's three or half, and
  was marked afresh, on a day after that game, so that game could never lift it again. On the five
  backups of 25 September to 11 October it changes no mark.
- **A name nobody plays under** (N): its name, or the name of a GameChanger team filed under it,
  has void, test or demo as a word of its own, in any case ("Contest", "Avoid", "Demons" and
  "Testudo" do not), read by the import's own rules for those three words (`madeUpHit`): so
  voided, testing, do not use and DNU, and a word run into another, but not the Austin organisation
  called TEST, Skiles Test or a test-prep sponsor. On the backup of 11 October 2026 the sign's own
  pattern of before read 249 pulled clubs by name, all ten of that organisation's teams among them;
  the rules read 300, those ten fewer and 61 more. It is marked by GameChanger team, so a club with
  one such team among others stands. Since the tidy now deletes a pulled club every one of whose
  names says it is no team, N mostly marks what the tidy leaves: one such team among others.

What keeps a club: any of its GameChanger ids, or its club id, said to be real (**It's real**);
being any page's own team; the user's word on it, a pair kept apart, an age named or a score
vouched for in a game of it; for A, B and C but not N, real opponents' own schedules listing three
of its scored games, or half of them, a real opponent being a pulled club that shows no sign (C
read without its clause about real opponents, which would make the question ask itself) whatever
marks it carries, since a mark outlives its sign and two clubs marked for their stray scores,
playing each other in the spring, would otherwise keep each other off for good; and a League
Standings team that picks it or is carried onto it by its name. The last only a pass that reads
League Standings can see, so it is checked where the boards are derived, and a club so linked stays
on every board whatever its marks say; Pool health asks the same of every squad year with a season
on a page (`leagueKeptClubs`), so on the live page its two questions read League Standings too.

A mark is kept by GameChanger id, as the clubs thrown out and said to be real are, with the day it
was made and why, in a pool key of its own (`league_forecast_gc_auto_removed_v1`) that the cloud
copy, every backup and every device carry. Nothing is deleted. The club, its games and its links
stay filed and are pulled as before; only the derivation of what the boards know (`deriveAllKnown`)
leaves out a club every one of whose ids is marked, with every game naming it, the way Delete club
would take it out (`withoutClubs`), so the boards, the club cards, Find a team and the ratings all
go without it. A claimed row in one of its games that is another club's own stands back up against
the team it was filed against; one that is the removed club's own goes with it (Delete club now
does the same), which on 11 October left 4 games naming a removed club and now leaves none. A game
the namesake join made with the removed club in for a stand-in is the other club's own row, which
goes back against that stand-in, as Delete club puts it back (**A stand-in carrying the other
club's very name**), rather than go with a club its own schedule never named.
A year's archive is frozen from the same pool (`archivedFrom`), so its tables are the boards on
screen. The Games tab still lists a removed club's stored games, which a mark leaves filed, with
the club named "(removed for you)" rather than a bare "?". A mark stays until something lifts it,
so a club whose results dated ahead have merely been reached stays off: any guard lifts it; A and
B lift on the sign's own escape, A once a losing club's own schedule lists one of the wins counted
or any win of the club's by 40 or more, B once the win counted is listed or every win of the
club's by 75 or more is one its loser lists, read off the club's games as they now stand rather
than the counted game's id alone, since a game the loser comes to list can be filed under another
id (9 of the 97 one-sided games between pulled clubs that both schedules came to list between 29
September and 11 October did); C lifts once a real opponent's schedule lists even one game of the
club's dated after the mark, which is how a squad whose scores ran ahead of its games answers once
it plays, and such a club no longer shows C, so it stays lifted; N lifts once neither the club's
name nor its GameChanger team's has the word. Saying a club is real forgets its marks there and then, with the
answer and in its Undo, rather than at the next sweep, so a club marked after the card was opened
is back on the boards as it is said; a restored backup that says a club is real does the same.

Pool health lists them under **Removed for you**, newest first, each with when and why in a line
("named 'test'", "its GameChanger team is named '…'" where only that name has the word, "next
season's squad, 3 scores dated from 2027-04-01") and a link to each schedule, and on none of its
other lists: neither what it shows as it opens nor what **Check the pool** finds (the twin pairs,
the rows counted twice, the wrong ages), where on 11 October 1 of the 100 twin pairs paired a removed
club with a standing one, a fold that would have put its games back unsaid, and 7 of the 985 rows
counted twice named one. A club a League Standings team links is listed too, said to be kept on
its boards, and stays on the other lists. **Put back on the boards** forgets the club's marks and
says it is real, so no later sweep takes it again; **Delete for good** deletes it as Delete club
does, which forgets its marks too; **Put back the N taken off on** a day forgets every mark of that
night's sweep and says nothing of the clubs, which is how a sweep that went wrong is taken back as a
whole once what made it go wrong is mended (the next sweep takes off again any club still showing
its sign); **Delete the N taken off on** a day **for good**, once the ones worth keeping are back,
deletes the rest of that night's as **Delete for good** does each, and **Delete all N for good**,
offered where several nights are listed, every night's; each offers Undo. The two bulk deletes say
how many first, as many clubs at once cannot be checked by eye afterwards, and leave a club a League
Standings team links, whose link a deletion would break. A club put back or deleted from the card
leaves its list at once, before the lists are read again, so a bulk delete pressed in between never
takes a club just put back. On the live page one edit takes at most 500 clubs
(`MAX_COMMAND_STEPS`), so a longer list goes as several, and the dialog says first that it cannot be
undone; where a later one fails, only the clubs of those that went leave the list. One edit asks for its Undo, but the server keeps an edit's Undo only up to 500 steps too, and
a club deleted takes 2 with no games and one more for each squad year its games are in, more than a
count of clubs can bound: where the server sends none back, the toast says there were too many to
take back at once (`EditSaid.noUndo`), rather than leaving its Undo out without a word. Find a team says of a pasted id taken off that it was removed, when,
and where to put it back. The thrown-out list is never written, so a re-paste or a re-pull refiles
the club and its mark keeps it off; a fold keeps a club on the boards unless every id it carries is
marked.

Measured with this code on the backups, each swept from no marks. On 11 October 2026 the sweep
takes off 249 of 69,487 pulled clubs, all by N, eight of them only through a GameChanger team's
name; A, B and C find none, the obvious ones having been deleted by hand on 28 September. 48 of
them are on a board, the best 47th, and leaving them off reorders the top 25 of two boards with
nobody new in either. On 29 September it takes off 86, all by N; 39 are on a board, the best 98th,
and the top 25 of four boards reorder with nobody new. On the pool of 26 September at 18:40,
before that sweep by hand, A, B and C take off 21 clubs (9 by A, 16 by B, 2 by C, some by two),
every one of which the user had deleted by 11 October, and N 84 more; 54 of the 105 are on a
board, the best 106th, and the top 25 of four boards reorder with nobody new. Of the 66 clubs the
user deleted by hand between one backup and the next from 25 September to 11 October, A, B and C
had taken 21 off the backup before, every one of them among the 46 deleted between 26 September
at 18:40 and 29 September. On no backup of the five is a club the user had said was real by 11
October taken off, even with that word set aside (131 such clubs were pulled on 11 October).

**Naming an age** is the fourth way a team gets one, and it stands in until the club
answers for itself. The named level is used ahead of GameChanger's own field, which is
what lets somebody correct a team filed at the wrong age rather than only one filed at
none — but the moment GameChanger's answer _changes_ from what it was when the name
was given, GameChanger wins and the named level is dropped. `insteadOf` records what
GameChanger was saying at the time, so that is a comparison rather than a guess. A
level outside the ranked range is refused rather than clamped: a stored 6U would be an
answer that files nowhere, taking the team off the waiting list and putting it on no
page, so it would vanish from both.

**Setting a club's age on its panel** is the same answer given to a club the app has already
filed, and it holds harder. The team panel has an **Age** line for any club with a GameChanger
link in the year: the level the app filed it at, and a choice of another. The case that asked for
it, on 28 September 2026, was "Cincinnati Hornets \*Fall Ball\*": filed at 8U 2027 while every club
on its schedule is 9U and several of their names say so, and 8U is below the youngest level with
a table, so it was ranked nowhere and its 9U league could not pick it in Settings. Setting it moves
what is already filed at once (`setClubAge`): its links, the rows its own schedules filed (onto
the new level's page, made if there is none) and its side of every game that recorded an age for
it; a row another club filed stays on that club's page. And it pins the level in the named ages
against each of its GameChanger ids (`NamedAge.pinned`, with the level it replaced in `was`). A
pinned level stands whatever GameChanger later says: it corrects where the app filed a club, and
the level on a link is not always GameChanger's word — a league list, the club's opponents or its
name can have decided it — so "has GameChanger changed its mind?" is not a question it can be
held to. The panel's link line says "filed at 8U" for the same reason, where it said "8U" as if
GameChanger had. The toast's **Undo** restores exactly what was there, and **Let the app decide**
takes the pin off and puts each of the club's ids back at the level it had been filed at, until a
pull decides again: a club whose fall and spring ids the app had filed a level apart goes back a
level apart. An id whose earlier level was never known stays where it is for the next pull to
decide. The Age choice starts from the level shown on the page, and starts again when the panel,
left open, is on another year's page.

Naming is only an instruction to the next pull: it is applied when that team's schedule
is next fetched, because the page it is filed under, the link written against it and the
age carried on each of its games all have to agree, and only a fetch produces those. So
a named team goes to the **front** of the next refresh's queue and is exempt from the
week between asks. It has to be: a team is on the review card precisely because a pull
has just failed to age it, so its last ask is a day or two old, and the week gate used to
refuse it — leaving "it will be filed on the next refresh" false for up to a week with
nothing on screen saying so, and the team on no page and therefore invisible to the
League Standings scout picker, which only offers clubs that are on one. The exemption is
spent by the ask it buys, since the fetch moves the last-asked stamp past the answer's
own: an answer GameChanger overrules gets that one ask and then goes back to once a week
rather than being fetched for ever.

**Two things the profile says are kept for the rules to read.** GameChanger reports a
team's **sanctioning body** — `usssa`, `little league` — and the **coaches** on its
public profile, and the app read neither. The body is the only field that says whose
word a division name is, which is the whole difficulty with them: "Majors" is a Little
League division of nine- to twelve-year-olds and a USSSA skill class at any age, and
"AAA" is a local Little League convention, a USSSA grade, and a provincial tier in
Canada. The coaches matter for a different reason, measured elsewhere in this file: two
teams sharing two of them are the same club 97% of the time by state and 89% by town,
and before this that signal only ever arrived on a pasted list — never on the thousands
of teams pulled by id alone. Both ride on a waiting team's row too, since its schedule
is read once and thrown away and a fact not written down there costs two requests to
learn again.

**Finding a club by its coach.** Every club picker — Find a team, the Scouting boxes, a
club's Same team as, and Settings' choice of which club each league team is — searches
the coaches off a club's GameChanger teams as well as its name, and lists up to three of
them under each result, the one the search found first and in bold. Forty clubs can
share a name, and the person looking for one usually knows its coach. On the pool of 26
September, 52,881 of the 53,010 pulled clubs carry at least one coach, three at the
median.

**Finding a club by where it is.** The same pickers take the words in any order and read a
state's name as its code, so "hurricanes ohio" finds the Hurricanes whose line ends in OH:
before, the whole query had to appear as written, and a state had to be typed the way the list
abbreviates it. A state matches its code only as a whole capitalised word, so "indiana" finds IN
but not the "in" of "Pride in Pinstripes". It also matches its name written out anywhere, a
coach's name included: "ohio" finds "Ohio Elite", and "georgia smith" still finds the Texas club
Georgia Smith coaches. GameChanger lists some clubs with no state at all — 1,832 of the 53,010
pulled clubs on that pool — and those are placed by the clubs they played instead: "Wilmington,
played by OH, KY clubs", up to three states, most games first (`statesThatPlayed`). The state a
pulled club's opponents most often come from is its own for 92% of the 48,045 clubs that have
one, and 1,265 of the clubs with none have played a club that does. Clubs known only as a name
on someone else's schedule are found too, on the page their games were filed on, and open there
with every game they are in, though no table ranks them. With them the search offers about
93,000 clubs, so it sorts the list and reads its text once, in the background after the list is
built, rather than on every keystroke: 130 to 190 ms a keystroke became 35 to 55, measured in
Node on 93,000 made-up clubs.

**Finding a club by its GameChanger id.** The same pickers take a GameChanger team id, or a link
to a team's page, and answer with the club that id is linked to (`gcIdsInSearch`): an id is what
somebody holding a team's page has, and until 28 September 2026 a pasted one found nothing. A
twelve-letter word counts as an id only where a club carries it exactly, so a name that long still
searches as a name, and a pasted link no club carries says so rather than only that nothing
matched: the app has no record of the id. That is all it can say, and not that the id was
never pulled: a pull that turns a team away for its season, as a high school or adult side,
or for a request that failed keeps no record of it past the run. So it says to pull the id
on its own with this season and last ticked, the two the pull's picker always offers, which
files it or says why not; a team from an older season is refused, and the run says so. Only
Find a team says it, since only it looks an id up in the whole pool and the lists the app
keeps: a picker over fewer clubs, Same team as or the league's club picker, says only that
no team in its list carries the id.

A pulled id can also end somewhere other than a club, and Find a team says where
(`whereIsGcId`): waiting on an age nobody could read, thrown out, younger than 8U by
GameChanger's word, or filed during a pull still running, which the held index has not
seen. A bare id is answered this way too when it is shaped like one, a digit or a capital
past its first letter, which "Thunderbolts" is not. And a pulled club with no games in the
pool yet, its schedule empty or none of it filed, now has the page its latest link is
filed under (`teamPages`), where it had none and so could not be found at all, not even
by its own id. Both came of the user, on 28 September 2026, pasting an id they knew had
been pulled and being told no team matched.

**Find a team stays up while a pull runs.** Its index is not rebuilt during a run, since every
save hands back new teams and a rebuild reads every stored year; it used to be switched off
instead, which took the box off the top of Rankings for as long as a pull went on. It is held
now: the box finds the pool as it stood when the run began, and is built once more when the run
lets go (`useClubSearch`'s `hold`).

**A backup carries the answers, not just the pool.** The named ages, the thrown-out
clubs, the too-young ids, the deleted rows, the kept-apart pairs and the waiting list
all ride in an `answers` block — in the Team Rankings pool file as well as the
whole-browser one, which was not true until recently: the block was built when a backup
was taken and restored when one was read, and the writer in between left it out. So the
pool file restored answers it had never saved, and since a reset clears every one of
them, the file offered as the way back could not bring them back. None of it can be recomputed — a pool can be pulled
again, a judgement about whether a club is real cannot — and without this, restoring
into a fresh browser threw an evening's work away and then set about rediscovering the
problems it had answered. The block is optional and absent means leave what is there
alone, because "this file predates it" and "this file has nothing to say" are the same
bytes.

**Start from scratch means the whole app.** The reset in Team Rankings' Setup leaves the
browser as if it had never opened the app: every League Standings season, the Team
Rankings pool, every answer above, the Organizations file and the settings. It used to
keep the answers and leave League Standings alone, on the reasoning that a reset was for
the data and not the judgements about it; to the person pressing it, a reset that keeps
anything is not one — they cleared the app and found it still refusing clubs and filing
teams at the ages it had before. `localStorage` goes by prefix (`league_`, `lf_`,
`nkb_`) rather than by a list of keys, so one added later goes too, and the pool's
IndexedDB store is emptied of every key and then read back. If the store keeps any of it,
`localStorage` is left alone — its note saying where the pool lives is what lets a
second try find the rest — and the app says the reset did not finish. Then the page
reloads, since every view holds copies of what it read.

### States

A team can carry a two-letter state, and the rankings can be narrowed to one — or
to the teams whose state is not set yet. Set it on the team panel, or let an
import fill it in: `Home State` / `Away State` on a game list, `State` on a
schedule. An imported state never overwrites one already there.

Filtering is presentational. Ratings come from every game regardless, so a
filtered table renumbers but keeps each row's place in the full table alongside.

### The rating in a forecast

Every game pick blends two views. The league's own per-game stats — runs scored
and allowed, walks, hits, errors, strikeouts, recent form — and the
opponent-adjusted rating, which is the only number that knows _who_ a team
played, and which counts tournament results where Team Rankings is switched on.

How far it leans on the rating depends on how many games that rating rests on:
0.40 with none, 0.52 at one game, 0.70 at four, 0.80 at eight. The floor is not
zero because a rating of 0 means "league average", which is a better guess than
a record built from a single game. The count is of _rated_ games, league plus
tournament, so a team with two league games and five tournament results is
trusted like the known quantity it is.

That the rating deserves most of the weight was measured, not assumed: 400
simulated leagues per case with known true team strengths, swept over the weight,
walk-forward so no pick ever saw its own result. Every measure improved the
further the pick leaned on the rating, in all six schedule-by-pitch-mode cases.
The reason is spread rather than direction — the stats model's expected margin
swings about twice as wide as real margins do, while the rating's is about right.

Measured on the shipped code, 200 leagues a case, against the same code with the
rating withheld:

| Schedule                   | Pitch   | Brier           | Winner accuracy | Margin error, runs |
| -------------------------- | ------- | --------------- | --------------- | ------------------ |
| Balanced                   | player  | 0.2377 → 0.2267 | 63.2% → 63.7%   | 3.82 → 3.66        |
| Balanced                   | machine | 0.2275 → 0.2255 | 63.6% → 63.7%   | 4.22 → 3.71        |
| Unbalanced                 | player  | 0.2376 → 0.2268 | 62.5% → 63.0%   | 3.89 → 3.70        |
| Unbalanced                 | machine | 0.2282 → 0.2258 | 62.5% → 63.0%   | 4.32 → 3.74        |
| Unbalanced + Team Rankings | player  | 0.2376 → 0.2243 | 62.5% → 64.1%   | 3.89 → 3.64        |
| Unbalanced + Team Rankings | machine | 0.2282 → 0.2234 | 62.5% → 63.9%   | 4.32 → 3.67        |

The last two rows are the point of the bridge: the same unbalanced schedule, with
the tournament results counted, picks about a point of accuracy more.

Two honest limits. The simulation draws margins the way the rating model assumes
they work, so it cannot tell you whether real baseball has structure the stats
model catches and the rating misses. And the walk-forward backtest reports a
floor rather than the shipped model's accuracy, because an outside result carries
no date and cannot be placed on the league's timeline without leaking the future.

A team the fit never rated carries no rating at all, and its forecast is exactly
the number it was before any of this existed.

**Measured on real games, the rating pulls harder and is fitted to real margins.**
The weight above says how much of a pick the rating gets; `RATING_EDGE_PER_RUN`
says how hard a run of rating pulls it, and the league's cap on run differential
used to bound the rating itself. Both were set on simulations: 0.25 a run, held
below the 0.43 that fitted best because overdispersed simulated scoring punished
anything higher, and the league's own cap of 8. The user ruled on 28 September
2026 that the cap is a standings rule the forecast need not follow, so both were
measured on the pool of 26 September instead. Every state's pulled clubs on a 2027
page (20 or more) made a pseudo-league; its games among themselves up to 13, 19 or
20 September were the season so far, the pool's other games touching those clubs
were the Team Rankings results a linked league is handed, and the 54,265 league
games after each cut were scored through the app's own engine and `predictGame`.

| Cap, weight         | Log loss with results | Without | Called ~75%, won |
| ------------------- | --------------------- | ------- | ---------------- |
| 8, 0.25 (as it was) | 0.6431                | 0.6484  | 90%              |
| 20, 0.25            | 0.6327                | 0.6394  | 85%              |
| 20, 0.43 (as it is) | 0.6230                | 0.6303  | 76%              |
| none, 0.43          | 0.6229                | 0.6303  | 76%              |

So the forecast's fit counts each game's margin up to 20 runs (`FORECAST_RUN_CAP`)
whatever the league's setting — twenty rather than none so a mistyped 91-1 is not a
ninety-run win — and the rating pulls at 0.43 a run. The standings, their
run-differential tiebreaker and the per-game stats model keep the league's cap. The
Dashboard's matchup odds were refitted on the same games: a spread of 4.7 runs where
it was 2.8 (log loss 0.6254 to 0.6188 with results), and 3.95 for machine and coach
pitch, which is what the 8U pages fitted.

### Ratings

A rating estimates how many runs a team beats an average opponent by, adjusted
for opponent strength, capped at ±12 so one blowout cannot run away with a season.
Only completed games count; scheduled ones exist so a future opponent can be
logged early. Win probabilities are clamped to 8–92% — youth baseball has no
locks.

Until teams share opponents, directly or through a chain, a rating is close to a
plain run differential.

**Where the twelve came from, and how to check it.** The case for _having_ a cap
is plain — without one a 20-0 against a weak club outweighs a season of close
wins against strong ones — but the case for _eight_, which the rating used until
the end of September 2026, was never made here. It was inherited from League Standings,
where the cap is a rule of the league (coach and machine pitch carry a
per-inning run limit), and applied flat from 8U to 18U even though the same
settings put player pitch at twelve. Setup's **Check the model** card sweeps it:
`compareRunCaps` refits the pool at four, six, eight, ten, twelve and sixteen
runs — and at no cap at all — and reports what each one predicted. The last row
is the one that asks whether _having_ a cap earns anything, rather than which
cap is best. On a pool whose margins all fit inside eight it ties every cap from
eight up, exactly as it must: a clamp that never reaches is not a clamp.

The sweep moves the fit's cap and holds the scoring target still, and that
separation is the whole reason the answer can be believed. One constant used to
do both jobs, so a smaller cap was a smaller error for nothing — the target
shrank under the model. Measured on four thousand realistic margins against a
model that cannot improve (it predicts zero every game), letting the target
follow the cap gives 2.25 runs at a cap of four rising to 2.95 uncapped, a clean
ordering that is pure artefact; pinned, that same model scores 2.605 at every
cap, as it must.

_Where_ it is pinned is a second choice, and a sweep with an open end cannot
make it freely: a target clipped at eight marks a wider candidate down for
swinging where the target has been flattened. Three sixteen-team pools, two
rounds each, the same hold-out, comparing a target pinned at eight against the
margin as played:

| truth                           | cap 8 → pinned / played | no cap → pinned / played |
| ------------------------------- | ----------------------- | ------------------------ |
| inside eight, no blowouts       | 0.894 / 0.894           | 0.892 / 0.892            |
| inside eight, 10% junk blowouts | 1.930 / 2.527           | 2.245 / 2.843            |
| genuinely spans past eight      | 2.517 / 5.231           | 2.760 / **1.091**        |

The pin changes no ordering on the first two — the same cap wins either way —
and inverts the third, where pinned at eight reads "no cap is worse than twelve"
and the margin as played has it beating everything by a factor of two. So the
sweep grades on the margin as played: still one target for every candidate,
which is the property that matters, and the least arbitrary one going, since the
margin is a fact and the cap is a choice. It reads higher in absolute terms than
the **Off by, on average** figure above it, which does clip at the cap, so the
rows are to be compared with each other rather than with that one. The
called-right column is the check on all of it — direction is clamped by
nothing — though it is the quieter signal, since direction is easy wherever two
sides are far apart.

The sweep and the win-chance curve together moved the cap to twelve. On the 9U
2027 pool of 27 September the sweep read twelve clearly better than eight
(below). Then, on the backup of 26 September tidied as the app tidies it, the
year was fitted as the board would have been on 13, 19 and 20 September and
scored on the decided games between ranked clubs after each (22,685, 17,064 and
8,155 of them): twelve with the curve refitted to it (`matchupOddsSpread`)
predicted them better than eight on its own curve at all three — log loss 0.6042
to 0.6012, 0.5980 to 0.5949 and 0.5864 to 0.5842 — and called the same share of
winners. Twelve on eight's curve read worse than either, so the two moved
together. About one game in three is decided by more than eight and one in eight
by more than twelve, so twelve still stops a rout counting in full; the move
kept 20 of the 9U top 25, and 201 of the 250 places in the ten pages' top 25s,
where no cap at all kept 13 and 147. The League Standings cap, which is a rule
rather than a guess, is untouched.

Run at twelve on the 9U page of 26 September, the card names nothing clearly
better: sixteen and no cap read 0.006 and 0.003 runs a game lower, inside the
noise, and eight 0.049 higher. Sixteen is in the sweep so that the cap in use has
a neighbour above it as well as below. The card is there so the number stays a
measurement rather than an inheritance.

The card names another cap only when it predicted the held-back games clearly
better than the one in use: paired game by game, since every row faces the same
games, lower on average by more than the bar its rivals share, over thirty games
or more (`pairedImprovement`). The lowest average alone is not enough — two
settings' errors on one game move together, so a gap in the averages is only an
answer once the pairing says how far it can be trusted. The standard error is
counted by club, since every game of a club leans on the one rating the fit gave
it, and never less than the games read as independent. The bar is two standard
errors for one rival and rises with the rivals tried, the chance that two leaves
split between them: 2.53 for the four age gaps and 2.67 for the six caps, as
four or six tries at one bar of two would give chance that many goes at naming
one. On the 9U 2027 pool of 27 September a cap of 12 read 0.050 runs a game
better than the eight then in use over 31,581 held-back games, 9.2 standard errors, and ten read
0.034, 10.9; no cap at all read 0.032 worse, well inside its own spread. That was
with the wins by more than thirty runs, one of them 9,999, still counted; with them
set aside, as they now are, no cap reads about as well as twelve (above).

#### Recent form

Newer games pull harder: **half weight every 90 days**. A side that lost through
September and has been winning since is rated closer to the side it is now than
to the one it was.

This is how the systems League Forecast is modelled on do it. Massey's
least-squares ratings de-weight early-season games; Pomeroy's weight each game by
when it was played, with more weight the more recent, so a rating describes a
team _now_; and the Elo family gets there by construction, a recent result
moving the number further than an old one. None of them steps the weight at a
boundary inside the season, and neither does this. **The season is still the
season**: every age group sharing a squad year is still fitted as one pool, an
autumn game is still in the fit, and it simply counts for less than a spring one
by the time spring comes — about a third of a fresh game's weight after five
months, a quarter after six. A slope rather than a cliff.

Ninety days rather than thirty or sixty is because of the winter. Squad years
run August to July with a four-month gap in the middle, and a fast half-life
would make the autumn irrelevant by spring, which is a season split under
another name.

It changes the **fit and nothing else**. Games played, record and strength of
schedule are descriptions of a season rather than beliefs about a team, and a
side played twelve games whatever the fit leans on. Weights are normalised to
average one, so the ridge is handed the same total evidence and nothing is
regressed further toward the mean than it was before. The weights depend only on
the gaps between games, never on the clock, so a rating is a pure function of
the pool and two readings a week apart agree.

**What the evidence is.** `scripts/recencySweep.ts` fits a backup as the app
ranks it, after the app's own tidy, told the clubs the owner vouched for as the
device's tidy is (`scripts/sweepTidy.ts`), so no page of theirs is deleted for
a name that reads as no team: the clubs the backup says are real, and, from the
whole-browser backup (Settings, "Backup JSON"), every club a League Standings
team links, read off the seasons it carries beside the pool. A Team Rankings
file, JSON or CSV, carries no seasons, only their ids on its pages, so from one
a club only a League team links is not spared, and the sweep warns of that
whenever its tidy deleted a page for its name from a pool whose pages play in
League seasons. It was run against a
nationwide pool seven weeks into a squad year, the only backup small enough to
export. It could not put the cross-winter question, because that pool had no
winter in it. In season, at four nested cuts, the day-based schemes beat
counting every game the same on every one, and the games-since schemes were
indistinguishable from it — on a small hold-out, without the shuffled-calendar
null run to completion, so a direction rather than a finding. Practice and the
direction agree. The comparison is `compareRecencySchemes`, which the sweep runs;
Setup's **Check the model** card runs the plain backtest, the age-gap priors and
the run caps (`checkTheModel`), in the rankings worker a run at a time so the page
never waits on it. Changing the scheme is one line in `src/lib/ratingRecency.ts`: every candidate is in
`RECENCY_SCHEMES`, and `noDecay` restores exactly the behaviour that shipped
before weighting existed.

#### Playing up and down

Fall tournaments routinely pair a team against the level above or below. Every
age group sharing a **season year** is therefore fitted as one pool, with each
game carrying the gap between the two sides: the older side is expected to win by
what a year of age is worth at those levels (`AGE_STEP_RUNS` in
`src/lib/powerRating.ts`): 5 runs from 8U to 9U, 4 from 9U to 10U, 3 a year from
10U to 15U, 2 from 15U to 16U and 1 a year from 16U up. A 9U losing by about four
to a 10U comes out even rather than punished. Strength of schedule is read from each team's own seat, so it
weighs heavier for the team playing up and lighter for the one playing down.

**A year of age is held, not fitted.** Until 27 September 2026 the fit started
from two runs and let the data correct it, and it read 0.85, 0.92, 0.97 and 1.02
as the 2027 season filled. That figure was the fit's, not the game's. Nearly every
club plays at one level (only 1,153 of 76,787 in the pool of 26 September appear
at a second), so moving every level's ratings by a steady amount and the gap by
the opposite fits the results just as well. The games cannot set the gap, and the
ridge pulling every rating toward average set it instead, low. Simulated on that
season's own schedule, the fit reads 0.81 to 1.05 when the truth is 1.75. Read
directly instead — each club rated on its same-level games alone, then each
one-year cross-age game between clubs with eight or more of those — a year is
worth 2.00 ± 0.24 runs.

Held at two, the ratings predict the games after a cut better at 7, 13 and 20
September. The app's own backtest scores the games between two clubs the fit had
rated 0.0075, 0.0078 and 0.0042 runs better. On every game it scores slightly
worse (at most 0.005): a game with a side the fit never saw is predicted by the
gap alone, a real 9U-10U game is closer than a year of age says because the young
clubs that play up are mostly strong ones, and the page never shows such a
prediction. On the 9U 2027 board of 26 September three of the top 25 change: The
Pack - Greene, Ct Cannons and HTX Wildcatters, who spent the fall playing 10Us,
come in, and three that padded against their own level or younger go out. Every
level's board moves some; 18U most (the largest top-100 move is 136 places), where
the one-year step read directly is smaller (0.34 ± 0.41 runs from 17U to 18U, on
278 games) and was not shown to be harmed or helped. Setup's model check holds the
pool at 1, 1.5, 2, 2.5 and 3 and names another value only when it predicted the
games between two rated clubs clearly better than two, by the same paired rule as
the caps. Since the table below, those values scale the whole table, 2 being the
table as it is, and the card words them as a share of it (1.5 is "75% of those
values"). On the pool of 27 September 1.5 read 0.0011 runs a game better over
21,986 such games, 1.1 standard errors, and the card had named it best on that
alone; 2.5 and 3 read clearly worse. All of that was measured with the rating
capped at eight. Run again with the cap at twelve, on the 9U page of 26
September, two still read best of the five (4.9810 runs a game on 21,967 games
between rated clubs, 1.5 a ten-thousandth behind) and the card named nothing.

**What a year is worth depends on the age** (11 October 2026). Two runs was one
reading pooled over every level. Read the same direct way on the pool of 11
October, level by level: 8U–9U 5.85 ± 1.01 runs (47 games), 9U–10U 4.16 ± 0.30
(385), 10U–11U 2.57 ± 0.39 (236), 11U–12U 2.91 ± 0.24 (610), 12U–13U 2.99 ± 0.58
(99), 13U–14U 3.28 ± 0.44 (169), 14U–15U 4.18 ± 0.77 (39), 15U–16U 2.12 ± 0.44
(178), and nothing above that (16U–17U −1.48 ± 1.16 on 29 games, 17U–18U −0.97 ±
0.66 on 87). So a 9U that played a 10U was charged for a gap half as big as the
one it faced. The table rounds those readings, holding the thin top levels at one.
For predicting games it is no better than two everywhere: cut in September and
scored on what came after, the error over every held-back game was 5.1849 runs
against 5.1832, and on the 490 held back between 9U and 10U clubs 4.82 against
4.80, since a club that plays up is rated partly on those very games. It is in
because the board should rank a young club against its own age: on two runs a
year, the 9U Otters went from first in Kentucky to third on two losses to 10U
sides, behind clubs of 8-0 and 7-0 against weak schedules; with the table they are
second, 0.04 behind the first. Losses still count; what changes is how much a year
of age is expected to explain. The boards' rules went to 4 with it
(`BOARD_RULES`), so the republish after the deploy rebuilds every board, and
the boards' fit to version 2 (`BOARD_FIT_VERSION`), so a device still on an
older build leaves the new fits alone rather than working each game out with
the old gap.

**Pooling the fit is not pooling the tables.** Each level lists only its own
teams — a 9U that beats an 11U in a tournament stays on the 9U page, and the 11U
page never shows it. What the pool changes is that the game counts for both of
them rather than being discarded or counted as if they were the same age.

A team is listed on the page for the level it actually plays at: its GameChanger
level where that is known, otherwise the level recorded on most of its games. So
a 10U that spent the year playing down is rated alongside the 9Us it played and
listed on the 10U page — which is also why its panel counts the whole pool, or it
would read 0-0 beneath a row saying otherwise.

With no cross-age games in a pool, the arithmetic is exactly what it was before.

Only 9U and up get a table. 8U results are kept as evidence about the 9U teams
that played down against them, but at that age the results say more about which
league is machine pitch than about the teams.

Above 150 teams the fit switches from Gaussian elimination to conjugate gradient,
which is what makes a nationwide pool solvable at all; the two agree to within
1e-6 on a 300-team graph. It runs in a Web Worker, so the page does not lock up
while it refits — the table keeps the last true answer and says it is refitting.

The **?** beside "Full rankings" explains all of this in the app, with the
constants read from the code so the explanation cannot drift from the maths.

A game can also be logged but kept out of the maths — **Don't count** on a
logged game. Fall tournaments routinely pair a team against the age group above
or below, and those results say nothing about how it stacks up inside its own.
A team whose games here are all scheduled, or all set not to count, is not
ranked at all rather than shown at 0-0 · +0.0.

Nor does a game count that a club's schedule lists against the club's own name
(`playsItself`): a scrimmage of its own squad, or a namesake the import could not
tell from it. It says nothing about the club against anyone else, and counted,
one 6-4 read as two wins and two games from the club's two seats. On the pool of
26 September 2026, 55 such games were scored in the squad year on 37 clubs; of the
35 with one GameChanger link and its record, the double count matched
GameChanger's for none, counting once matched 9 and leaving out 14, and leaving
out was the nearer for 21 clubs against 13. The team panel still lists the game,
and says why it is not in the record.

#### Where a rating starts

The fit counts 1.5 virtual games for every club against an average opponent: the
ridge that keeps a thin record from running away. Until board rules 7 those games
were played at 0.0, and that has a consequence no table shows. Summed over a piece
of the schedule that plays nobody outside it, the games cancel, so the piece's
ratings average exactly 0.0, the pool's average, whatever the piece is worth. A rec
league whose clubs only play each other then has an 8-0 club rated as high in its
state as an 8-0 travel club. The games inside a league say who is best in it, not
how good it is.

So each club's virtual games are played at its league's starting level
(`scheduleCommunities.ts`). A league is a community of the schedule, read off the
fit's rated games and nothing else: each piece off the largest is one league, kept
whole, and the largest piece is split by modularity (Louvain at resolution 20,
weighed against the whole year's games). Every node is visited in the roster's
order and every tie goes to the community a node is in, then to the lowest
numbered, using sums of counts only, so the communities come out the same on every
engine and whatever order the games are in. A league's outside games are its rated
games with exactly one side in it, and it starts at −1.6 / (1 + outside / 10) runs:
1.6 below average with none, 0.8 with ten, 0.15 with a hundred. A piece off the
largest then averages exactly −1.6, and a club's own games move it from where it
started as they always did. On the boards of 11 October 2026 the 2027 year held
4,900 communities. Of its 48,096 ranked clubs, 9,209 were on islands, and on the
largest piece 4,813 were in leagues with 1 to 10 outside games, 4,687 with 11 to 30
and 29,387 with more.

Measured on that backup (the 2027 year, 222,010 rated games), fitted on the boards
of 1, 8 and 15 September and checked on the games after 22 September:

- Against well-connected opponents, at equal shown rating, island clubs had done
  1.66 ± 0.22 runs worse than shown on the boards then published (1,108
  appearances), and clubs whose league had 1 to 10 outside games 1.15 to 1.63 worse
  (901). Over all six weekly windows from 1 September the same comparison reads 1.54
  for islands (1,624) and 0.8 to 1.4 for the rest (1,261).
- The starting level fitted on the early games was −1.60 ± 0.23 runs, and ten
  outside games halving it fitted best of 2, 3, 5, 10, 20 and 40. Resolution 5
  predicted the later games worse, and 50 no better than 20.
- On the 59,405 later games it lowered the squared error by 0.095 ± 0.022 runs²
  against the boards then published, and the Brier score of the win chance by
  0.00034 ± 0.00007. On the 7,448 where a weakly connected club (an island, or 10
  or fewer outside games) met an outsider, it lowered it by 0.72 ± 0.16 runs².
- On the 11 October year boards 60 of the 548 state #1s changed. Island #1s went
  from 156 to 126 and weakly connected ones from 217 to 181. The national top 25s
  kept 215 of their 250 places, and clubs from leagues with 31 or more outside
  games kept 184 of their 186; 13 of their 276 state #1s changed. 10 of those 13
  also change with only the old deduction taken off (below), and the starting level
  with the deduction kept, fitted with it at −1.65, would have changed 5.

What it cannot do:

- A strong group that has truly played nobody else is shown 1.6 runs below where
  its games alone would put it, as a weak one is. Only games against outsiders can
  tell the two apart, and Pool health's look lists the leaders of groups with fewer
  than 3 of them, with the opponents to find and pull (**Leaders with few outside
  games**, under **What a pull left behind**).
- The effect grew through the autumn: refitted on the later games the level reads
  −1.90 ± 0.20, so −1.6 is the cautious value, and after it the isolated clubs
  still did 0.5 to 0.9 runs worse than shown against well-connected ones. It is
  re-measured every week for that reason (below).
- It was measured on years of 38,589 games and more. On a pool far smaller, such as
  a few dozen clubs, the resolution finds no league at all: it joins two clubs of k
  games each only once the schedule holds about 10·k² games, some 1,200 for clubs of
  eleven. The largest piece is then kept whole, as an island is, so every piece
  starts at −1.6, every rating is the old fit's 1.6 lower, and the order and every
  margin between two clubs are as they were. Left a club apiece, each club's own
  games would have counted as its league's games outside itself, and of two closed
  leagues of twelve and eleven clubs the larger would have started 0.84 runs above
  the other. Where the
  resolution joins some of the largest piece's clubs and leaves others alone, those
  others still start by their own game count, a second discount for a thin record.
- Few leagues have played so much outside themselves that they start right at 0.0,
  so the average club on the largest piece now sits a little below it: the mean
  rating of its ranked clubs went from +0.13 to −0.07.

It replaced board rules 6's circular-schedule deduction, which measured as doing
little on the later games as a whole: taken off alone it changed their squared
error by +0.010 ± 0.009 runs², and with the starting level in, keeping it would
have lowered it by another 0.014 ± 0.009, which is not significant. It was not
nothing, though. Between clubs of two well-connected leagues, taking it off alone
cost 0.062 ± 0.027 runs² on 6,244 later games, and on the 11 October year boards it
changed 26 of the 548 state #1s, 16 of them well-connected clubs', and left
well-connected clubs 177 of their 186 national top-25 places. The starting level
wins most of that back: 184 of the 186 places, and 13 of those #1s changed. The communities take 1.2 to 1.3 s
on that year (95,568 nodes, Node 24) and the deduction took 0.7 to 1.0 s, so a fit
of the full year takes about half a second longer: 4.8 to 5.9 s against 4.4 to
5.6 s, over five runs each. Each row says where its club started (`levelPrior`)
and its league's outside games (`outsideGames`), which a device needs to rebuild
the fit's rating from the club's games and the panel says in words (below). The
what-if (Scouting report) stays exact: its three fits read the same schedule, so
their starts agree.

##### How the level is re-measured, and when it moves

The −1.6 is held in code (`CLOSED_START_RUNS`), as the age table is, not refitted
with each board. It is read again every week and judged by the rule the age gap and
the run cap are judged by, and it changes only by a commit that raises the boards'
rules (`BOARD_RULES`, with the boards pinned first).

The re-measure is `compareClosedLevels` (`scoutBacktest.ts`). It reads the four weeks
before the day it is asked on, Monday to Sunday when that is a Monday. Each week is a
cut: the year fitted as the board would have fitted it the morning the week began
(`fitScoutYear`, every rated game before it, the starts included), and the week's
games between two clubs that fit rated, scored on the ratings it showed. The fit is
linear in its starts, so one more solve per cut is enough: every start at its share
of a run of level (`startingShare`), every game a draw with no age gap. That solve is
the response of each rating to a run of level, and the fit at any level is the held
fit plus the response times the distance, its evidence discount read again at its own
residual scale.

- **The level** is read off the four weeks together, by least squares of each game's
  residual with no start on the response across it, clustered by week and by the
  league of the side that has played less outside itself.
- **The judgement** takes a week at a time, each scored with the level the other three
  read. It uses `pairedImprovement` on the shown ratings' absolute error, one rival, so
  a bar of 2.00 standard errors, and at least 30 games.
- **Never in sample.** On the games it was read from, the four age bands' levels
  measured beside it (below) were named clearly better on the measurement's weeks
  (z 2.46 against their bar of 2.28) when scored apart they are not (z 1.03).
- **Never on point ratings**, which the plain backtest scores. The discount already
  lowers thin clubs, and a club whose league keeps to itself is often a thin one, so
  on point ratings a deeper level reads better than it does on the board: by the
  rule's own absolute error, with each week left out, z 1.72 against −0.77 on shown
  ratings, short of the bar. It falsely cleared the bar there in sample (z 3.59) and
  on the last two weeks judged with the first two weeks' level (2.27), and by squared
  error even with each week left out (2.63).

On the owner's backup of 11 October 2026, asked the Monday after:

- the four weeks from 14 September held 79,981 games (10,590 week-and-league
  clusters), and read −1.74 ± 0.16;
- the weeks of 19,710, 25,909, 27,834 and 6,528 games were scored with −1.89, −1.64,
  −1.70 and −1.74;
- each week's games were 0.00010 ± 0.00013 runs a game worse than with −1.6 (z
  −0.77), not clearly better, so the held level stands;
- the start as held still earned 0.103 ± 0.018 runs² of squared error on those weeks,
  against no start at all.

It took 20 s and about 1 GB above the loaded pool (2.8 GB at most) in Node 24 on four
2.1 GHz cores, four fits of 59,427 to 93,430 nodes and a solve after each.

**Where it runs.**

- _Once a week, in the nightly refresh on GitHub_, as of the week's Monday: the first
  live run of the week (Monday to Sunday, by the members' day the run starts on) that
  finds the record kept older than that Monday makes it, so it is made once a week
  however late GitHub starts the run (`closedLevelMondayDue`). From 1 November the
  cron's 04:17 UTC is 23:17 the evening before, Eastern, and the seven scheduled runs
  of 11 to 17 October 2026 started 4 h 15 min to 7 h 38 min late, so the start's
  weekday alone would have skipped a week whenever a Sunday run started under 43
  minutes late and the Monday one later, and made one twice the other way round. A
  dry run re-measures on a Monday only. It reads the pool the night has just built
  the boards from, the squad year whose boards hold the most games in the four weeks,
  League Standings' games counted with the stored ones: the Team
  Rankings pool the run holds, and the League Standings seasons as the publish read
  them, handed on rather than listed again (`remeasureAfterPublish`,
  `closedLevelWeekly.ts`), so it reads nothing more of the cloud and a score saved
  after the publish reaches neither. A night whose views were not published does not
  re-measure, and a later night of the week tries again. Its own scheduled workflow
  would have read the copy again.
- _The live run keeps the answer_ as one small document beside the views,
  `live/closedLevel` (`closedLevelRecord.ts`), which the Model check card reads as it
  opens and shows as one line, before anything is pressed: "Last weekly re-measure, 12
  Oct, on the 2027 squad year. Starting level for leagues with few outside games: held
  at −1.6; the four weeks to 11 Oct read −1.74 ± 0.16 on 79,981 games; not yet clearly
  better." It names the squad year, since the card shows it on every page and a page of
  another year reads its own pool when pressed. The line names no club or league, and
  calls nothing closed.
- _A level clearly better opens an issue_, "A new starting level is ready for leagues
  with few outside games" ("When a run fails"), with the level read, the gain and its
  standard error, and that the change is a commit. A later Monday that judges the level
  and finds none clearly better closes it; one with too few games to judge leaves it
  open.
- _The Model check runs the same re-measure_ when pressed, last of its runs, on the
  device's worker and on the server (`model.check`), and its card gives the same line
  for the page's year under "Where a rating starts".

**One level per age band was measured and not shipped.** Bands of 9-10U, 11-12U,
13-14U and 15-18U were fitted on the weeks of 1 to 21 September. On the 59,405 later
games they were 0.0045 ± 0.0025 runs² worse than the single −1.6, where they needed
to be two standard errors better. The bands did not keep their values through the
season: 9-10U read −1.30 ± 0.38 early and −2.68 ± 0.37 later, and 15-18U −1.59 ± 0.49
and −0.59 ± 0.39. Re-measured on the last four weeks and scored a week at a time, they
beat −1.6 by nothing (z +0.32).

The band to watch is 15-18U. On the later games −1.6 over-corrects there: its island
clubs did 0.72 ± 0.57 runs better than shown against well-connected opponents (168
appearances), and its weakly connected clubs 0.55 ± 0.40 (341). Over the last four
weeks the start cost 15-18U 0.055 ± 0.050 runs² (10,111 games). None of it reaches two
standard errors yet.

#### Game by game

On the cloud's board a club's panel says, under each game it counted, what that game
did to its rating there (`gameBreakdown`, `gameWords`). Above the list the board's
rating is split in two: what the club's games give it, the fit's own rating
(`pointRating`), and what its record adds or takes off, the evidence discount
(Scouting report, **What if?**). The discount compares the club's spread, how unsure its
rating is, with the mean spread over every club the fit rated in the span, on every page
of the pool, never one board's rows (`discountMiddle`): a record that makes the rating
surer than the average club's adds, and one that makes it less sure takes off. "Fall 2026
rating +2.8: +2.5 from your games, +0.3 because your record makes your rating surer than
the average club's." The line first said "fuller than most", which counts the board's
clubs, and the mean is not the median: the spread falls ever more slowly as games are
added, so on the 29 September 2026 backup more than half the clubs gained on 10 of the 20
boards with lines, 57.8% on one. Nor is it a count of games: of the 45,554 clubs that
gained, 8,146 had fewer effective games than their board's average.

The two ratings are printed as the board's row prints its Rating and Best guess
(`formatBoardRating`), "-0.0" and all, and the record's part is what those two printed
figures differ by, so the three add up on screen and one that rounds to nothing says the
rating is all from the club's games. Rounded as whole tenths instead, the line differed
from its row on 2,158 of the 88,106 clubs with lines on that backup, every one a "0.0"
over a row's "+0.0" or "-0.0". The page's own club reads "your", any other "its".

Where the fit started the club (**Where a rating starts**) is not said. The start is in
the rating "from its games" already, since the fit played its virtual games there and its
league's opponents started there too, and the owner chose that no club's panel say its
league keeps to itself, on any device and to a member as much as anyone, so the line stays
the two-part split above and a test holds that it never names a league, its outside games
or a start.

Under each counted W, L or T row are two figures, keyed once above the list. **Played
like** is the rating that makes the score exactly what the fit expected: the opponent's
rating, plus the margin counted, less the runs the age gap was worth. A club's fitted
rating is the weighted mean of these over its games, with the ridge's 1.5 games played
at its starting level (**Where a rating starts**), which its row carries; on the 2027
year of 29 September 2026, with those games then at nought, that held for all 83,693 of
its teams to 5.6e-9, the solver's own tolerance, which is what lets a device rebuild the
board's own row from them. **Moved** is the rating the board shows with the game, less the rating it
would show without it, every other game weighed as it was, every club's starting level
(**Where a rating starts**) and the fit's residual scale and middle held. A refit without
one of a league's few outside games would also start the league lower, from −1.45 to −1.60
for a league with one and from −1.23 to −1.33 for one with three, which Moved leaves out. It has two parts: the score's, what the margin did to the fit's rating,
and the record's, what one more game on the record did to the discount, which is never
below nought. When the score's part reads as a fall of a tenth or more and the whole
does not, both are said, rounded so they add up: "moved your rating +0.1 (score -0.1,
one more game +0.2)". A move that rounds to nothing says "less than 0.1".

A clause follows only where it applies, and names what takes the row's score to the
margin counted. The row shows the club's own schedule's score, and the fit reads the two
schedules' average where they disagree (`ratedMargin`), held to the cap. "Counted as a
12-run win, the most one game counts" is for an average past the cap where the club's
own score, held to the cap, is already the margin counted; "counted as a 1.5-run win, the
two schedules' scores averaged" for an average inside the cap or exactly on it, which
the cap did nothing to; and both together for an average past the cap that the club's
own score, held to it, does not reach: one inside the cap, or one past it on the other
side. So a club whose own schedule has it losing 0-13 and whose opponent's has it winning
37-0 is counted as a 12-run win, the average exactly, and is told of the average alone.
On the 29 September 2026 backup the first rule read off the row's score instead, and of
the 88,032 lines with a margin clause it named the wrong reason on 212: the cap for 106
averages that landed exactly on it from a score past it, and both for 106 that landed
on it from a score inside it or on it. Then "2 runs added for playing a year up", "2
runs taken off for playing a year down" or 4 runs for two years, for a game against
another level (above).

A game against a side seen once, a stand-in or a club known only from this one schedule,
reads nearer the club's own rating than its score would, and moves it little. With
nothing else to go on, the fit lets that side's rating take most of the result: for a
game of average weight, with the ridge at 1.5, played like comes out two-fifths the
club's rating, three-fifths the margin counted and three-fifths that side's start
(**Where a rating starts**). A side met once almost always falls in the club's own league,
since joining it gains a game and costs next to nothing, so that start is the club's:
for an island club such a line reads 0.96 runs below what the club's rating and the
margin alone would give. The game says more about the stand-in than about the club,
which is also why the discount counts it as 0.6 of a game.

Played like is exact, but for the 4 places a side with no row on the board carries its
rating to (within 5e-5), and so is the record's part. The score's part is worked out as
if the club's opponents met nobody else in common (the star estimate), since the exact
answer is the year's pool fitted again without the game, which no phone does as a panel
opens. Against those exact refits, the weights and starts held, on 414 games of 60 clubs drawn from
the 29 September 2026 backup's 2027 year, it was off by 0.006 in the middle, 0.061 at the
95th percentile and 0.268 at most, gave the same tenth on 355 of the 414 and never the
wrong sign. A short record is the least exact: at the 95th percentile, 0.061 for clubs
with 3 to 8 games, 0.048 for 9 to 20 and 0.016 for 21 or more. Taking the game alone
against the club's other games, the obvious shortcut, was off by 0.207 at the 95th
percentile and gave the same tenth on 238. Both parts are said, the score's reading -0.1
or lower and the whole not, on 30,996 of the 532,020 lines the backup's 20 boards with a
fit gave its 88,106 clubs: on 24,230 the whole rounds to nothing ("moved its rating less
than 0.1 (score -0.1, one more game +0.1)"), and on 6,766 it reads +0.1 or more. A move
that rounds to nothing is said on 36,674 lines in all.

No line, and no word of one, is drawn where the lines cannot be shown to add up to the
board's own row (The live board on a member's device, **What each game did**): a board
without a fit, a club with no row on the board on screen, a half or page moved to whose
board is still on its way, and a card and board from different publishes, until both are
read again. A row still to come, one outside the half on screen, one set not to count
and one against the club's own name never carry one. The line above the list and its key
are drawn only while a row on the list carries a line, so a pending Not this team that
takes every such row off takes them too, though the lines, worked out from the card as
published, are still in hand. Team Rankings on this device's own copy draws none, having
no published board to explain.

## Postseason format

Not every league has a playoff cut line, so the season's ending is a setting:

| Format            | What it means                                                                                                                                                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Cut line`        | The top `Gold cutoff` teams make the Gold Bracket. The default, and the only format with Gold odds, playoff status, a bubble, clinching and magic numbers.                                                                                                                                 |
| `Bracket, no cut` | Every team is seeded into the bracket by final standings. The bracket stays, but nothing is inside or outside a line, so every cut-line concept goes: Gold odds, playoff status, the bubble, clinching, magic and elimination numbers, and the cut-line commentary in the season timeline. |
| `No postseason`   | Regular season only. No bracket, no Gold odds, no clinching.                                                                                                                                                                                                                               |

With `No postseason`, everything that only exists to describe a bracket is
removed as well: the header cut-off card, the Standings postseason tile, Gold
Odds Over Recent Games, Projected Cut Line Games, and the Gold Odds column in
the Forecast projected standings.

Both cut-less formats are swept the same way — the difference between them is
only whether a bracket is played. A grep of every view in `Bracket, no cut`
mode turns up no mention of Gold, a cut line, the bubble, clinching or
elimination.

Turning the cut line off is not just cosmetic: clinching, elimination, cut-line
crossings and the bubble are all _defined_ relative to a cut, so without one
they are dropped from the standings table, the recap, and the AI write-ups
rather than reported against a cutoff that stands for nothing. The AI is told
explicitly that no cut line exists and to cover the race for the top instead.

**Magic and elimination numbers read a tie on points as the tiebreakers' to
settle.** The exact solver works on points, and a tie on them is decided in the
table by fewer losses and then the league's tiebreakers, which can hang on games
not yet played. It used to hand every tie to the lower team id — the first four
letters of the name — so "513 FORCE - BOULEY" was told it had clinched wherever it
was level, and the Trash Pandas who held the head-to-head were told they were out.
Simulated over round robins at the pool's own 3.3% tie rate, 11-20% of finished
seasons carried a line the final table contradicted. A clinch now counts every
level team ahead and an elimination counts none of them; where only the other
side holds, the line says so — "1 more win guarantees at least a share of the
last Gold Bracket spot; the tiebreakers decide", or "after 1 more loss, only a won
tiebreak keeps the team in" — rather than claim either. Once nothing is left to
play, the table's own rank answers.

## Playoff machine

"If we beat the Bears and the Comets lose, where are we?" The Forecast tab has a
panel for it. Each game left can be settled by hand — the away side, the home side,
or **Sim** to leave it to the model — and the table below it is the season with
those games played: records, places and the cut line from the same code as the real
standings, with the league's own tiebreakers, and Gold % simulated over the games
still unpicked (`scenarioSeason`). A pick plays out at the model's expected score,
turned round where the pick goes against the model, because run differential breaks
ties and a winner alone does not give one; a score can be typed instead, up to 99 runs a
side, which is as many as a saved scenario or a link keeps (`MOST_RUNS`). Ratings are
not refitted on made-up results, so the rest of the page does not move. Each team's row
says how the picks move it against the season as it stands: its place (▲2), its Gold %
(+65), and **Clinches** or **Out** where the picks settle what the season does not yet.

### Saved scenarios

Picks not saved as a scenario go when the page does, or at a change of season: a look at
another tab and back finds the machine as it was left, the picks and the scenario open, which
the page holds while the Forecast tab is closed (`MachineLeft`). They are one season's, told
apart by `activeSeasonKey` whether the Forecast tab is open or not, so that a season deleted
and its id given out again, or one restored over, leaves none to the season now under that id.
A scenario (2.7, `src/lib/savedScenarios.ts`) is a name, the picks with any typed scores, and
each picked game's teams and date as they stood, kept on this device per season, the most recently
changed first, thirty at most (a save that pushes the oldest out names it). One parent's
"what if we win out" is theirs, not the season's, so a scenario is never written into
the season, a backup or the cloud; it goes when its season does, not to a season made under
the deleted one's id, and moves with its season when a cloud merge gives that a new id
([Data + persistence](#data--persistence)). A scenario is opened from the **Scenario**
list, its picks changed and **Save changes**, **Rename**d, **Duplicate**d with the picks as
they are now, or **Delete**d with its picks left on screen unsaved. **Clear picks** starts
again. Choosing another entry in the list while the picks on screen are not saved, made
with no scenario open or changed in the one open, first asks whether to **Let them go**
or **Keep them**, rather than losing them at a glance at another scenario. Each change
is made to the scenarios as stored rather than to the list on the page, so one kept in
another tab meanwhile stays. A change to the open scenario starts from it as stored too:
**Rename** keeps the picks another tab saved to it meanwhile, **Save changes** the name
it was given there, **Duplicate** and **Delete** name it as it is called there, and one
another tab let go of is not brought back by any of them, nor copied under its old name; the
page says so, and its picks stay on screen, unsaved. Back on the Forecast tab, the list is
read as stored, but the open scenario is the one the picks on screen were made against, so
picks another tab saved to it meanwhile are not taken for changes made here. Picks
another tab saved to it that **Rename** or **Bring it up to date** takes in are shown in
place of the older ones here, and said so, unless picks changed here are waiting to be
saved, which stay: shown older, they would pass for changes, and **Save changes** would
write them over picks never seen here. A stored scenario of a later version is left as
it was, unread, through every change.

**Quick picks** fill the games in one go: **Favorites win** has the model's pick win every
game left, **Fill the rest with favorites** only the games not yet picked, and **Wins out**
or **Loses out** settles every game left of the team chosen beside them (the team this
browser follows, to begin with), leaving its other picks as they were.

A scenario knows when the season has moved on under it (`scenarioTrouble`): a picked game
played (the real result stands), taken off the schedule, or given other teams marks it
"(out of date)" in the list, and opening it lists what happened. Those picks are left out
of what is shown, and **Bring it up to date** saves it without them, saying how many went.
A game only moved to another day keeps its pick. The same holds for picks being made when
a game changes under them, from another device say: a pick counts only on the game it was
made on, until picked again.

**Share** copies a link, `?view=league#scenario=…`, carrying the scenario's name, its
picks and each picked game's teams and date, and nothing of the season, up to 6,000
characters (more picks than fit are refused, with a word to save them instead). Opening
one waits for the season to be the one the device shows, since matched sooner it would
be against this device's games from before, missing any added elsewhere: while the cloud
is still finding out who is signed in (the app draws without waiting longer than four
seconds for it) and while a member's device first meets the cloud's seasons (both
`leagueArriving`), and while League kept live waits for the cloud's version. Until then
the link stays in the address bar, kept there when a team's panel opens or closes,
because a first meeting's seasons arrive with a reload and the address bar is all that
carries the link across. Those seasons come only when the page is left, left alone a
while or asked, so that wait alone is said, with **Load them now**. It then shows the
picks, the soonest first, and which of them are not on games this season still has to
play between the same teams, and asks **Keep it** or **Not now**
(`src/lib/scenarioLink.ts`, fetched only when a link is opened). Kept, it joins the
saved scenarios for the season open here with only the picks that apply, and opens in the
playoff machine as if chosen from its list. Pasted into the address bar of the app open on
League Standings, a link opens in the page already running (one tapped on a phone may too,
where the installed app opens links in the window it has open, which has not been checked),
and there picks on screen not saved are asked about first. While that is asked, the
scenario open stays as this tab has it, unless keeping the link pushed it out of the
thirty, when it leaves the list and its picks stay on screen, unsaved; and a new name, a
delete or a switch asked about for the scenario open before is put away rather than left to
act on the link's. Either way the link leaves the address bar, and the season is never
changed. A link none of whose picks apply is said so, with a word to open the season it was
made for.

## Why the forecast says what it does

Each of the Dashboard's upcoming predictions has a **Why Aces at 64%?** button (2.8). The
win chance is read off a projected margin, and the prediction engine now gives that margin
as data with every forecast (`LeaguePrediction.explanation`), as the sum of its parts in
runs, which add up to it exactly:

- **Results**: each side's average margin in the games its rating was fitted from (league
  and Team Rankings, each counted up to `FORECAST_RUN_CAP`), shrunk toward average by the
  games behind it as the fit does, `n / (n + 1.5)` of it;
- **Opponents faced**: the rest of the gap between the two ratings, which is the fit's
  allowance for the opponents each side played. With every game neutral and counted once,
  as the engine's are, a rating is exactly `n / (n + 1.5)` of its average margin plus its
  opponents' average rating, so this is exactly the opponents' share. The panel gives each
  side's opponents' average and the share of it its rating counts
  (`MatchupEvidence.scheduleShare`), since the averages alone can point the other way: one
  game against weak opponents counts 0.4 of them, five against slightly better ones 0.77, so
  the weaker schedule can cost less and the part lean to the side that played it;
- **Head-to-head**: the nudge for their own meetings, never more than 1.5 runs;
- **Home field**: not counted, since who bats last is a coin toss at this level (it would
  show only if a fitted home edge appeared from games with a real home side);
- **Cap**: what the 14-run cap on a projected margin took off. It is a limit on the
  forecast, not evidence for either side, so it leans neither way and is never a side's
  strongest reason; the margin's parts take it off the leader.

Beside them is what the margin does not count again or at all: recent form (already in the
results), runs scored and allowed in league games, the Team Rankings results behind each
rating, how many games each rating rests on, each side's newest result and how long before
the game it was (or after, or on the same day: a game whose date has passed with no score is
still forecast, and the sides may have played since), and what the per-game model behind the
Schedule's odds and the Gold chances makes of the same game (`forecastExplanation.ts`).

The panel leads with the strongest reason for each side (a part of the margin where there is
one), then the margin as its parts ("Aces by 2.3 runs, from results +3.1, opponents faced
−1.2, head-to-head +0.4"), with every factor on request. **What could change it** names a
side with fewer than three games behind its rating, a newest result more than three weeks
before the game, Team Rankings results from a club linked by a name more than one club
carries, a rating and raw scoring that point different ways, and the two models disagreeing
(backing different sides, or 15 points apart). Five numbers the page shows are said apart,
since they are easily taken for one another: the **win chance** of this game, its **range**
(below), the model's **confidence** (how much it has to go on, not a second chance of
winning), **Gold %** (the chance of finishing above the cut line over the season), and the
**accuracy so far** (the season's finished games replayed one at a time, each called from the
games before it: a record of past games, not a promise about this one). The panel's code is
fetched the first time one is opened.

### How far one game can stray

Under each card's projected winner is the **range** of margins eight games in ten like it end
within, and under the expected score each side's runs (2.10, `forecastRange.ts`): "Range:
Bears by 6 to Aces by 13" and "Range: Aces 0–13, Bears 0–9" for Aces by 3.5, expected 6.4 to
2.9. It is 9 runs either side of the projected margin at player pitch and 10 at machine pitch,
and 6.5 and 8 runs either side of each expected score (never below none), in whole runs worked
out from the margin and score the card shows. It says how much a single game varies, not how
sure the model is, so it is the same width however many games are behind the ratings.

The widths are measured, not read off the curve the win chance comes from. On 1,006
pseudo-leagues from the 29 Sep 2026 pool (each state's pulled clubs on a 2027 page with
twenty or more, their games with one another up to a mid-September cut the season so far,
their other results what the bridge would hand over, and every later game between them
scored), 81.0% of 89,998 player-pitch games ended inside the margin range and 81.9% of 7,492
machine-pitch games; 79% and 78% where either side had played two games or fewer, 85% and 88%
where both had played six or more. That curve would have put the band at 10.3 and 8.7 runs,
holding 85% of player-pitch games but only 73% of machine-pitch ones. Both sides scored inside
their score ranges in 79.5% and 79.7% of games: 85% where sides average four to six runs, 74%
where they average eight or more.

On the Forecast tab, the seed odds grid has a **Likely** column: the seeds a team finishes in
once the best and worst tenth of simulated seasons are left out, so at least eight simulated
seasons in ten (`seedRange.ts`). It is not the Projected Standings' **Range**, which is the
best and worst seed one remaining result can move the projection to. That walk is a season's
projection for each way each remaining game can go, so it waits until 60 or fewer games
remain (`useSeedRanges`); until then the column, the phone rows and the Bubble Watch show a
dash and the caption says the range is paused, rather than every team's projection at both
ends, which would read as a seed nothing left to play can move.

## Our team

The Dashboard leads with one team, picked there, for the questions asked at the
field: where are we, what are our chances, who is next. The card gives its place
and record, its Gold % and how far the last result moved it (the last step of the
trend line), its next game with the chance of winning it and the seed a win or a
loss leaves, the magic number once few enough games remain to work it out exactly,
and **Enter a score**, which opens the Schedule on that team's games. The pick is
this browser's, one per season (`readOurTeam`), and deliberately not a setting:
settings travel in a shared link, and a parent's team is not the coach's they send
the standings to. It is not in a backup either, for the same reason. It goes with its season,
so a season made under a deleted one's id follows no team until one is picked there.

When the team is linked to a Team Rankings club, the card also gives the club's place
on its board — "37th of 1,812 nationally (▲3) · 4th of 160 in OH · 9U 2027 · Fall
2026, as of 9/27". League Standings cannot rank a club itself, since a board is a fit
of the whole year's pool, so each time a board is up on the Team Rankings side the
places of the clubs its page's league seasons are linked to are written to a small
per-browser cache (`leagueClubRanks.ts`), a season's places replaced whole and gone with
the season, and the card reads them with the day they were read, in the reader's own time zone. A board that
settles with none of the season's clubs on it takes their places away rather than
leaving the last ones showing. Only a board of a half the season plays its games in
writes them: a fall league's places are read off the fall board, and looking at the
spring one, which holds none of the league's games, leaves the card as it was rather
than blanking it.

The Standings tab reads the same cache for every team, not just the followed one: under each
linked team's name, "#12 of 3,947 nationally", and beside it a **Scout** button (3.6). Scout
opens Team Rankings' Scouting with that club's report up, on the page its place was read off:
each place keeps the age level, squad year and half of its board (`clubRankPage`), and the
button writes them into the route (`scoutRoute`), so the report is on the board the number came
from. A place kept before pages were opens whatever page Team Rankings would have opened. The
club itself is not put in the URL: Team Rankings carries every parameter it does not own from
page to page, so a club named there would reopen its report on every later visit and reload.
It is held in memory instead (`scoutRequest.ts`) and let go once a page, the cloud's board or
this device's own, has it on screen.

## Data Quality

What in a season's games, teams and settings is wrong or worth a second look, each as a
finding (`src/lib/leagueFindings.ts`, 2.3) with a stable code, a severity, the games, teams or
setting it is about, why it matters, what to do, whether it makes the forecast less to be
trusted, and a fingerprint. The Dashboard keeps only the count of each severity and a line when
the forecast is affected; the **Data Quality** tab lists them in three groups:

- **Needs attention**: a season of one team (one with none is still being set up, and
  raises nothing), a game naming a team not on the roster, a team against itself, a final
  with a score missing (counted as if that side scored nothing), a past game scored and never
  marked final (not counted at all), a Gold cut line every team is on one side of, one Team
  Rankings club linked to two league teams while its results count.
- **Worth reviewing**: the same game on the schedule twice, a past game still without a score, a
  date that cannot be read, a final over 40 runs a side or won by more than 30, fewer games
  scheduled than the games-per-team setting (which holds clinching back), teams without a final
  once the league has played about three games each, two teams of one name, a link to a club
  Team Rankings no longer has.
- **Information**: an undated game, a schedule giving teams two or more games apart, teams
  without a final early on, a link guessed from a name more than one club carries, two finals of
  one pair on one day with different scores.

The same game twice is never a finding that needs attention, since that could not be put aside
and a league date carries no time: two games of one pair on one day are a copy or a doubleheader,
and only the commissioner knows which. Until it is put aside it affects the forecast, which plays
each copy not yet final as a game still to come and counts each final, so the finding names both
possibilities. Two finals with different scores are two games played and read as a doubleheader,
information only; two with one score are what one game entered twice looks like, and a finding
put aside as a doubleheader comes back only then.

League dates carry no year, so what is past is read with the season on one timeline: in its own
order (`seasonStartMonth`, as the rest of the app reads it), placed in whichever year puts the
whole season nearest today (`seasonDaysFromToday`). A spring season seen in October is all past,
its March games with its May ones; next spring's schedule entered in December is all to come, its
June with its March; and a December game seen in January was last month's. Read a date at a time,
each in its own nearest year, a season more than about six months from today was split, its far
end on the wrong side of today. Each finding links to
what it is about: a game opens the Schedule with its card focused, a team its panel, a setting
the field in Settings. Three can be put right from the tab, each after a preview of exactly what
it will do, as one undo step, and reported by what it actually changed, worked out again from
the season as it stands: **Delete the extra copies** (only copies with nothing at all entered on
them, a box score without runs counting as something, never the last copy of a game, even if
another device deleted the one kept while the question was open, and asked first), **Mark them
final** (past games with both scores in), and **Use the schedule's count** for games per team. A finding that does not need attention can be **put aside** on this device,
per season (`readPutAside`); it comes back when what it is about changes or it grows more
serious, and a finding that needs attention cannot be put aside. What is put aside goes with its
season: a season made under a deleted one's id, from the same team names, has the same
fingerprints, and would otherwise find its findings already put aside.

## Since you last looked

League Standings kept live takes in other devices' edits as they are made: another coach's
scores, a game moved, a team renamed. A device that was closed, or on Team Rankings, used to come
back to a season that was simply different. Now each device keeps the season as it last looked at
it (`src/lib/seasonDigest.ts`, 2.6, a line per game and team and where each team stood in the
race, a few kilobytes per season, kept for the last 12 seasons opened), and the Dashboard opens
with **Since you last looked** while anything differs: counted ("3 new finals, 1 corrected score
and 1 clinch"), then listed, the followed team's first, each a link to its game or team, until
**Got it**. The Dashboard's tab carries the count meanwhile, in a phone's bar too.

- **What counts:** a new final, a corrected one, one no longer final, a game added, moved, given
  another opponent or removed, a final's box score changed, a team added, removed or renamed, a
  team clinching a Gold Bracket place or eliminated from one, and the followed team's Gold chance
  moving by the notification setting's points (10 while notifications are off, or set to never
  tell of it; `digestOddsMove`). Runs typed into a game not yet final are no one's news.
- **What this device does itself is never news.** The season store says where each change came
  from (`SeasonChange`): this page's own edit is taken as seen as it is made, another device's is
  news, and a season opened brings its own last look. A forecast that follows an edit made here
  is taken as seen too, unless news from elsewhere is still unread, which it may follow from; an
  edit that moves nothing the forecast reads (runs typed into a game still being played, a bracket
  score) leaves the next forecast to be news like any other.
- **Where looking starts.** The first time a device opens a season, what it holds once League kept
  live has heard the cloud for it is where its looking starts, not 48 games of news: the cloud's
  version laid over its own, or its own when the cloud held nothing it lacked (League goes live
  either way, and that is the moment). The race starts from the forecast of that season, worked
  out afresh when the cloud's word brought scores, not from the one on screen before them. A full
  backup restored here is this device's doing as well: each season it restores that the device
  had looked at is taken as seen as restored (`applyFullBackup`), not only the one that opens. A
  restore that could not write every season takes none of them as seen. Once it has written the
  list of seasons, those it left out or replaced have still lost their looks, as everything kept of
  a season goes with it ([Data + persistence](#data--persistence)); only a restore that could not
  write that list leaves every look as it was.
- **One device, however many tabs.** The installed app beside a browser tab is two pages each
  kept live, and each hears the other's edits from the cloud as it would another device's. The
  last look is the device's, so each tab writes only what it took as seen, laid over the look as
  stored, and takes from the stored look what reads as it does in the season it shows: an edit
  made in one tab is seen in the other when it arrives there, the forecast after it once the tab
  that made it has taken it as seen, and a Got it in one is a Got it in all of them. A clinch the
  news brings, when Got it came before the forecast settled, is still news in each. This holds
  where the pages share the browser's storage, which is how they hear of each other. On an iPhone
  or iPad an app added to the Home Screen, and on a Mac a web app added to the Dock from Safari,
  keeps storage of its own apart from the browser, so it is a device of its own, with its own
  last look, notification choices and record of what it has announced.
- **A last look is one season's.** It goes when its season leaves the browser, and a season made
  under a deleted one's id starts with none of it, as with everything else a device keeps of a
  season ([Data + persistence](#data--persistence)): otherwise the deleted season's games and
  teams were listed as removed since the last look. Another tab still showing the season does
  not put its look back when it hears it go, nor when anything is done in it afterwards: a tab
  whose look another tab let go of, by a deletion, a restore, a cloud merge or Start again,
  keeps none of that season until it opens one again.

**Notifications**, in Settings, are off until turned on, and the browser is asked for permission
only then. Each kind is a choice of its own: the followed team's finals and corrected scores, its
schedule changes, clinches, eliminations, the followed team's Gold chance moving by 5 to 25
points, and League Standings stopping on something a person has to see to (a season deleted on
another device, one the cloud cannot read). **Send a test notification** shows it works.
They come only while League Forecast is open, in a tab or installed, and only for news that
arrived after the page was put away: gathered for 20 seconds into one notification, so a run of
scores is one, and each change announced once on the device however many tabs are open or times
it reloads (`readNotified`, one tab at a time through the Web Locks API). A move in the odds is
the same news while it stays within the same whole steps of the chosen points, which way it went
from the last look, so it is not announced again each time a final elsewhere moves the forecast a
point; a game given a second new opponent is news again. A choice changed in one tab holds in the
others at once, where they share storage as above. What a season has had announced goes with
the season, so one made under a deleted season's id, from the same team names, still has its
clinches and eliminations announced. Pressing one comes back to the app
(`public/notification-click.js`, in the service worker). Nothing is sent to a server, and
**nothing arrives while the app is closed**: that needs a push service holding each device's
subscription and sending to it, which the app does not have.

## Settings

| Setting               | Effect                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Season label          | Header/export label.                                                                                                                                                      |
| Postseason            | `Cut line` (top N make the Gold Bracket), `Bracket, no cut` (every team qualifies), or `No postseason`.                                                                   |
| Gold cutoff           | Number of teams in the Gold Bracket. Only applies when the postseason is set to `Cut line`.                                                                               |
| Score detail          | `Runs only` (the default) or `Full box score`. Runs alone drive the standings, the records and every projection; the fuller box score only adds the per-game stat pages.  |
| Score errors          | Full box score and Kid Pitch only. Off drops the E box from score entry and E/G from the stat pages.                                                                      |
| Win / Tie points      | League standings, simulations, and Gold status.                                                                                                                           |
| Tiebreaker order      | Score tiebreakers after league points and fewer losses: two-team head-to-head, run differential, runs allowed, runs scored.                                               |
| Team Rankings results | Whether tournament games logged in Team Rankings sharpen this league's game forecasts (`useScoutResults`). Forecasts only — records and standings are always league-only. |
| Recap grouping        | Builds stories per game, date, or week.                                                                                                                                   |
| Model aggression      | Prediction weighting profile.                                                                                                                                             |

## Data + persistence

- `league_teams_v1`, `league_matchups_v1`, `league_logs_v1`, `league_settings_v1`
- Team Rankings keeps its own keys, shared across seasons:
  `league_forecast_scout_teams_v1`, `league_forecast_scout_games_v1`,
  `league_forecast_scout_age_groups_v1`, plus `league_forecast_gc_pull_v1` (an
  interrupted pull's place) and `league_forecast_gc_refresh_v1` (the rota's record)
- `league_undo_snapshot_v1`
- What a device keeps of a season beside it, never in the season, a backup or the cloud, is kept
  by season id: its last look (`lf_league_seen_v1`), the findings put aside
  (`lf_league_findings_put_aside_v1`), the team followed (`lf_our_team_v1`), that team's club's
  place on Team Rankings (`lf_league_club_ranks_v1`), the server's last bridge to Team Rankings
  (`lf_league_bridge_v2`), the saved scenarios (`lf_league_scenarios_v1`) and the news already
  announced (`lf_league_notified_v1`, one list whose entries each begin with their season's id).
  Season ids are given out again: counted from the seasons held, so deleting the last season and
  making one gives back its id, and every browser's first season is `default`. So all of it goes
  when its season leaves the browser: deleted, or left out of a restore or the cloud copy's seasons, or replaced in either by another
  season under its id (made at another moment). An id given to a season new here, made, copied or
  brought down from the cloud, starts with nothing under it (`forgetSeasons`). A season of this
  device's that a cloud merge gives a new id takes all of it to that id, and takes it back when a
  backup from before the merge puts it under its old id again (the same season: made at the same
  moment, under whichever id). Nothing goes until the
  list of seasons is written without its season: a tab that may no longer write the seasons,
  because another tab has taken a copy in since (`cloudGuard.ts`), neither deletes a season nor
  lets go of what was kept of it. The page reads the team followed and the findings put aside
  again for each season it opens, told apart by id and the moment it was made, so neither a
  switch back to an id nor a restore that puts another season under the open one shows what
  was kept of the season before.
- League stories are generated locally from standings facts. With `GEMINI_API_KEY` set, Gemini rewrites the same facts into prose, and with `GROQ_API_KEY` Groq does when Gemini cannot; see [AI league story](#ai-league-story). No key is required for the app to work.
- One-time migration from older `league_*` keys
- CSV import/export with BOM/formula guard handling

### Where the Team Rankings pool lives

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
as a toast, which is the only thing left that can still say so.

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
(`other-season`), which also takes it off the waiting list.

An archived table keeps the numbers it was frozen with, since its games are gone and nothing
can fit it again. Tables frozen before the cap moved from eight to twelve, at the end of
September 2026, were rated with the cap at eight and are not comparable with later ones;
nothing on the card marks which is which beyond the day each was frozen.

### Backups

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

#### Restoring

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

### Your data on every device

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
  Two seasons that share only an id (every browser's first season is
  `default`) are kept apart: this device's takes a new one, and everything the
  device keeps of it beside the season, as [Data + persistence](#data--persistence)
  lists it, goes with it to the new id, leaving nothing under the old one, which
  is now the other season's.
- **The Team Rankings pool** settles key by key, the later change winning,
  since a pool is too large and too interlinked to merge row by row.
- **What lost** is kept in the copy, pieces and all, for 30 days and at most
  six settlements (`KEEP_DAYS`, `KEEP_GROUPS`). The panel lists it, and
  **Bring back…** makes it current again from any device, asking twice and
  keeping what it replaces in turn. The server makes it current, for the
  copy's owner alone (1.6), and the device then takes it like any other save.

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

### Pulls in the cloud

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

### A pasted list, pulled in the cloud

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
leaves the rest of the 8 GiB for the bytes a heap does not count. A heap failure is
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

### Refresh now in the cloud

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

### Pulls in the cloud: the one-time setup

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

### The nightly refresh on GitHub

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

It runs every night at 04:17 UTC, which is 12:17 in the morning Eastern in summer
and 11:17 at night in winter. It used to be set for 07:17, and GitHub started it about
seven hours late (between 14:09 and 14:33 UTC on 6 to 9 October 2026), so it was moved
three hours earlier; a scheduled run starts when GitHub gets to it. A run by hand is **Actions → Nightly refresh → Run
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
against its caps; then the failures in a row, a pause, and a run reserved and
not yet settled. A ledger that cannot be read says so on its own line and leaves
the night's colour alone, as do failed rebuilds: they are not the refresh's
work. This is what tells whether a week of dry runs went well before `mode` is
set to `live`.

### Boards published when a pull ends

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

### Boards published after an edit

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

### Boards caught up on GitHub

A save's rebuild ("Views a server publishes") puts an import or an edit on the
boards within minutes, but only while the rebuilds run. Switched off, paused,
failing, or deferred to a later month by their budget (as they were from 14
October 2026, October's spent, until 1 November), a save reached the boards only
with the nightly, which GitHub starts hours late. A pull's end and an edit's
check now publish in those times ("Boards published when a pull ends", "Boards
published after an edit"); a publish that failed still waits for this. So every
half hour one of
GitHub's servers looks (`.github/workflows/catch-up.yml`, `scripts/catchUp.ts`,
`npm run catch-up`), and publishes the boards where they are behind the copy and
nothing else is about to. Its rules are `catchUp.ts`'s, kept out of the script so
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
issue of its own ("When a run fails"): the next run tries again within the half
hour, and a night that fails raises its own. A run by hand is **Actions → Boards
catch-up → Run workflow**.

### When a run fails

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

An issue is public, as the repository is, so it says when (UTC, to the minute),
what failed in a word or two, and the run's link, and nothing from the log. The
words are fixed in `runAlarms.ts`, which works out what to raise or settle from
the run step's outcome and the words the nightly hands over: the rebuilds'
(`rebuilds=paused`, `failing`, `none` or `off`), and on a Monday the starting
level's (`closedLevel=held`, `unjudged`, or `better` and five numbers, which it reads
back as numbers and writes again in its own words). It is tested; the workflows
only run `npm run alarm -- nightly` or `-- republish` as their last step,
whatever came before. It runs `gh` with the run's own token, which the workflow
lets write issues and nothing more (`permissions: issues: write`). An alarm
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

### Boards a server can build

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

### Views a server publishes

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
gets that club's rank line too (`history`): its place week by week, walked back from
last week's board by the same step the page walks it with (`rankLineStep` in
`rankMovement.ts`), with last week's place on the end. Each past week is another fit
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
that refit a year are (`capsSpent`). October's totals were left as they stood, which keeps the
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

### The live board on a member's device

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
copy as this device last read or saved it (`copySeen`), never against the
device's own pool, which may not be taken in yet: current when the board was built
from the very board inputs the copy held (`boardInputsPrintOf`), behind when the
copy has moved on or no one build vouches for the boards, owed when this device
has unsaved changes to a board input, and unknown before it has read the copy.
A change to anything a board does not read counts for nothing, and neither does a
League change while League Standings is kept live (`copyOwed`): it goes to the
season's own document, which the boards are built from, and is never sent to the
copy, so counted owed it held every board as waiting on this device for good.

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
board once it is drawn, so it is there by then. The pages are the meta's whenever
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
only when a club is opened. A club whose card cannot be read (no card, a bucket
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
no rebuild and is not waited on. Opening a panel brings the server's pool up
(`warm`), at most once in ten minutes of calls. While the device is offline, or
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
(`club.drop`), a rout counted (`game.confirm`), a fold (`teams.merge`, asked about first
with what the server says it moves), an age (`club.age`, with an Undo), every suggested
age at once (planned on the server's pool, `ages.plan`, and sent as one batch with one
Undo), the answers (a club real, a club at the right age, two clubs kept apart), and the
clubs removed for you: **Put back on the boards** (its marks forgotten and the club said to
be real, `autoRemoved` and `answers` as one batch, with an Undo), a night's clubs put back
at once (`autoRemoved`, with an Undo) and **Delete for good** (`club.drop`, with an Undo).
Both questions read League Standings, as the boards do, so a club a League Standings team
links is said to be kept rather than removed. Once
an edit is made, what the pool shows is asked for again, so the lists are the copy's as it
now stands; an answer kept is shown at once, and the question already on its way is let
go, since it was asked before the answer was given. The file of every club worth pulling
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
(`EditSaid.same`, said where the copy already held the edit). Pulling a pasted list is the
pull in the browser, so its card opens the page on this device's copy until the cloud runs
one; with every other area drawn, that card is now the tests' way to hand the page over.
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

### Rebuilds after saves: the one-time setup

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

### League Standings in the cloud

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
| `schema`                         | The layout's version, 1. A device reads and writes no document of a later one. |
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
  the season itself is in storage, so a base never holds what storage does not:
  a game deleted on another device while this one was closed stays deleted,
  rather than coming back from this device's copy. A base is used only for the
  season it was kept for, one made at the same moment; a season made since under
  a deleted season's id is a season of its own. With no base, the first meeting
  keeps everything either side holds, the cloud's record winning where both hold
  one; a season here that held nothing takes the cloud's in whole and from then on
  carries its creation time (`adoptSeasonCreatedAt`), so the next visit knows it
  for the same season.
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
  controls, a shared link, the command palette, a toast's Undo, is refused, with
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
  the nightly may have pulled since, at most once every five minutes. A question
  out is never thrown away for another about the same teams: a change noted
  meanwhile is asked about once its answer is in, and being shown anew asks
  nothing while one is out. An answer for teams or scores since changed is
  dropped. A question unanswered is asked again after 5 s, 30 s, 2 minutes and
  10 minutes, then every half hour until one is answered (every 2 minutes until 16 Oct 2026,
  when a pool the server could not answer in time made each try a cold 8 GiB load). The last bridge for a season, the bridge alone
  and never the clubs, about 2,400 characters, is kept on the device
  (`lf_league_bridge_v2`, the last four seasons, the open one alone when storage is
  full; what an earlier build kept under `lf_league_bridge_v1`, every club with it,
  is let go of) and read back through the same checks as one from the network, so
  the forecast has its outside results the moment the season opens, and offline.
  It goes with its season, as everything a device keeps of one does
  ([Data + persistence](#data--persistence)), and what was heard this visit is held
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

### Team Rankings edits as commands

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
the one save each makes; the functions' smoke run holds a member's delete refused.

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
copy's owner can …", as the functions' smoke run holds for all four of the owner's commands.
`editRun.test.ts` holds the start, its Undo, a version a device kept brought back, the boards
emptied and published again, and a save landing between.

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
Year lists and archive/delete previews use `edit`, beside the corresponding writes. Both
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

## AI write-ups

Two panels are written by Gemini when a key is configured: the **League Story**
on Standings (what just happened) and the **Forecast Write-up** on Forecast
(what the model expects next). Both use the same endpoint, model selection, and
failure handling; the request names which one it wants.

### League Story

The Standings panel writes a "League Story" after every update. It is generated
deterministically from standings facts, and — when a Gemini key is configured —
replaced by a Gemini analysis written in a beat-writer voice. **The
deterministic story is always the fallback**, so the app behaves identically
without a key.

The AI analysis is given everything the manager has entered, not just the
cut-line movement:

| Sent to the model    | Why                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| Final scores         | What actually happened in this update.                                                                  |
| Standings movement   | Rank changes, clinches, eliminations, cut-line crossings, ranked by impact.                             |
| Full standings table | Record, Gold odds, status, projected finish, run differential.                                          |
| Power ratings        | Opponent-adjusted rating, recent form, trend, SOS rank — where the model disagrees with the raw record. |
| Stat leaders         | Leader, runner-up, and league average for each metric, with which direction is good.                    |
| Season context       | Games finalized vs scheduled, so the model can flag a thin sample instead of overreaching.              |

Only derived values are sent — ranks, odds, ratings, per-game averages. Raw game
logs never leave the browser.

### Forecast Write-up

The Forecast panel explains the projection rather than restating the table: the
headline projected finish, the Gold Bracket race and how thin the cut line is,
the upcoming games that swing the most, where the projection is least certain,
and how much to trust it given the model's measured accuracy.

| Sent to the model | Why                                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| Projected finish  | Projected rank and record, Gold odds with margin of error, realistic seed range.                                      |
| Game predictions  | Favorite and win probability for each upcoming game, with its impact tier.                                            |
| Games that matter | The high-leverage games the app flags, and the reason each one matters.                                               |
| Model accuracy    | Backtested hit rate, Brier score, and upset capture, so the write-up can say how much weight the projection deserves. |

The prompt requires the model to treat projections as projections, and to
describe a near-coin-flip as one rather than as a expectation.

It is requested only while the Forecast view is open, and re-requested when the
results actually change — not on every simulation tick, whose odds jitter by a
point or two between runs.

### Configuration

| Environment variable | Required | Effect                                                                        |
| -------------------- | -------- | ----------------------------------------------------------------------------- |
| `GEMINI_API_KEY`     | No       | Enables the AI story. Server-side only — never exposed to the browser.        |
| `GEMINI_MODEL`       | No       | Pins one model id (e.g. `gemini-2.5-flash`). Tried first, then the auto list. |
| `GROQ_API_KEY`       | No       | Groq writes the story when Gemini cannot. Server-side only, like Gemini's.    |
| `GROQ_MODEL`         | No       | Pins one Groq model id (e.g. `llama-3.3-70b-versatile`). Tried first.         |

Set `GEMINI_API_KEY` and `GROQ_API_KEY` as GitHub Actions repository secrets, and
optional `GEMINI_MODEL` and `GROQ_MODEL` as repository variables. The **Firebase functions**
workflow passes them to Firebase on deployment. For a local Firebase deployment, use the
gitignored `functions/.env.<project-id>` file. Do
_not_ prefix them with `VITE_`: any `VITE_*` variable is inlined into the client
bundle and would publish the key to every visitor. The browser posts recap facts
to the Firebase `leagueSummary` function and the function calls Gemini with the key, and Groq with
its key when Gemini cannot write the story.

### Model selection

The app is not pinned to a Gemini version. On each cold start it calls
`GET /v1beta/models` with the configured key, keeps the models that support
`generateContent`, and orders them so the newest is attempted first:

1. Highest generation number — `gemini-4` before `gemini-3` before `gemini-2.5`.
   A `*-latest` alias inherits the newest generation in the list.
2. Tier: `flash`, then `pro`, then `flash-lite`. Flash leads because the story is
   a short summarization task with the most generous rate limits.
3. Stable before `preview` before `-exp`, within one generation.
4. Rolling ids before dated snapshots (`gemini-2.5-flash` before
   `gemini-2.5-flash-preview-09-2025`).

The request walks down that list (up to four models) and returns the first
success, so a missing, retired, or rate-limited model degrades to the next best
one. A newly released Gemini is picked up automatically, with no code change.
If listing models fails, a hand-maintained fallback list in
`src/lib/geminiModels.ts` is used instead. The list is cached for 30 minutes per
warm instance.

### Groq, when Gemini cannot

The user added a Groq key on 28 September 2026 for when Gemini's quota runs out, which it
does at the worst time, a day of results entered at once. With `GROQ_API_KEY` set, a story
Gemini could not write is asked of Groq instead, with the same prompt and instructions:
Gemini at its quota on every model, most often, but also a key Gemini rejects or no model to
ask. Either key alone is enough. With both, Gemini is asked first, and 8 of the 25 seconds a
story may take are kept back so a Gemini walk that times out still leaves Groq an attempt.

Groq's models are chosen the way Gemini's are (`src/lib/groqModels.ts`). The key lists them
(`GET /openai/v1/models`), the speech, safety-classifier and agentic ones are dropped, and the
rest are tried in a hand-kept order of preference (`GROQ_PREFERRED_MODEL_IDS`), a general
model first since a recap needs no reasoning, then any others the key lists, newest first, up
to three. When the list cannot be read, the preferred list is tried as it stands, and a model
Groq has retired answers with an error and the next is tried. A reasoning model's `<think>`
text is taken out, and an answer cut off at the token cap is refused for the next model. The
`AI` badge's tooltip says which provider wrote the story, and when both are at their limits the
answer is `rate-limited`, with both providers' messages.

### Failure behavior

Every failure path returns a non-200 with a machine-readable `reason`
(`unconfigured`, `throttled`, `rate-limited`, `upstream-error`, `no-model`,
`invalid-request`), and the UI keeps showing the deterministic story rather than
an error.

`throttled` and `rate-limited` are deliberately separate. `throttled` is this
app's own per-browser limit, refused before any model is contacted — so nothing
was asked of Gemini and walking the model list would not have helped.
`rate-limited` means Gemini itself refused every model that was tried.

The League Story header says which state it is in, so a misconfiguration is
diagnosable at a glance instead of looking like "the AI just isn't running":

| Header shows                     | Meaning                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `AI` badge                       | Gemini or Groq wrote this. The tooltip names which, and the model.                  |
| `AI off — no API key`            | The function ran but neither `GEMINI_API_KEY` nor `GROQ_API_KEY` is readable by it. |
| `AI off — endpoint not deployed` | The Firebase `leagueSummary` function is unavailable.                               |
| `Paused — too many retries`      | This app's own per-browser limit. No model was attempted.                           |
| `AI limit reached`               | Gemini's quota refused every model tried, and Groq's too when its key is set.       |
| `No AI model available`          | The key listed no usable model.                                                     |
| `AI unavailable`                 | Something else upstream. The tooltip carries the message.                           |

A **Retry** button re-requests it, and **Rewrite** asks for a fresh take on an
analysis that already succeeded. The endpoint is throttled per IP (best effort,
in-memory).

### Diagnosing it

When a write-up is unavailable, the panel header shows a **Why?** button. It
asks the endpoint what is actually wrong and prints the answer in place — which
model the key can reach, or that the key is not reaching the function, or that
nothing is serving the endpoint at all. It runs as a `fetch`, so a stale service
worker cannot answer it with the cached app shell.

The same check is available directly at `GET /leagueSummary` on Firebase — no console
needed:

```
https://us-central1-league-forecast-youth.cloudfunctions.net/leagueSummary
https://us-central1-league-forecast-youth.cloudfunctions.net/leagueSummary?probe=1
```

| Result                              | Meaning                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| **404**                             | The function is not deployed or not routed. The app shows `AI off — endpoint not deployed`.      |
| `keyConfigured: false`              | The function is deployed but `GEMINI_API_KEY` is not reaching it.                                |
| `keyHadSurroundingWhitespace: true` | The stored value has leading/trailing whitespace (a paste artifact).                             |
| `keyLength`                         | Length only, never the value — catches a truncated paste.                                        |
| `commit`                            | The deployed commit. If it predates your change, the deploy has not happened yet.                |
| `vercelEnv`                         | Legacy diagnostic field; empty on Firebase.                                                      |
| `?probe=1` → `ok: true`             | The key can list models; `candidates` shows the attempt order, newest first.                     |
| `?probe=1` → `ok: false`            | Gemini rejected the key. The response quotes Google's own error and names the fix.               |
| `?probe=1` → `listError`            | Google's verbatim status and message for the model listing.                                      |
| `?probe=1` → `generation`           | Result of one tiny `generateContent` call — a key can be able to generate but not list.          |
| `groq`                              | The Groq key's side: `keyConfigured`, `keyLength`, `keyHadSurroundingWhitespace`, `pinnedModel`. |
| `?probe=1` → `groq.probe`           | Whether Groq lists models for its key, the order they would be tried, and Groq's own error.      |

Credentials previously stored in Vercel do not reach Firebase. Copy the provider keys into
GitHub Actions repository secrets and redeploy **Firebase functions** after changing them.

A key **restricted to HTTP referrers** is the trap worth knowing about: it works
from a browser and fails from a server, because a server sends no referrer. That
reads as "the key is fine, the server is broken" when it is the other way round.
The probe names this case explicitly, along with a disabled Generative Language
API, an IP-restricted key, and an over-quota key.

Even when listing fails, the app still reaches the newest model: the fallback
list leads with the `gemini-flash-latest` and `gemini-pro-latest` aliases, which
always resolve to Google's current release for their tier.

The probe is rate limited under its own smaller budget, kept separate from the
summary endpoint's so a burst of retries cannot starve the diagnostic that
explains them, and it reports no secret material. When the probe is the thing
being throttled it says so, rather than reporting a key Gemini never saw as one
Gemini rejected.

### Local development

`npm run dev` serves the Vite app and uses the deployed Firebase APIs. When the summary
function has no provider keys, the deterministic story is shown. API tests exercise the
shared handlers with recorded provider responses and require no deployed credentials.

## Performance notes

- **League Standings' views load on demand** (2.1, `src/components/league/leagueViews.ts`).
  Dashboard, Power Ratings, Schedule, Standings, League Stats, Forecast (with its
  playoff machine), Settings, the team drawer and the comparison it opens are chunks
  of their own; the first download carries the app's state and calculations, and a
  view's markup arrives when it is first shown. A view already loaded is drawn at
  once, with no placeholder, so going back to a tab never flickers; one still
  loading shows "Loading Forecast…" in its place, and a load that fails is that
  view's **Try again** or **Reload the page**, never a blank page. The team drawer
  and the comparison have a boundary each, so a failed download there is theirs
  alone: said over the page where the drawer would have been, with **Close** beside
  the two (Close takes the team out of the address, so a reload does not open it
  again), and the next opening asks afresh. Try again asks for the chunk afresh
  rather than repeating the failure React's `lazy` keeps for good, but a browser may
  keep a download that failed for the rest of the visit: Chromium 141, checked in
  the review of 2.1, answers the same chunk with the same failure without sending a
  request, a prefetch that failed offline included, and there only **Reload the
  page** fetches it again. A tab
  starts loading when it is pointed at or focused, and once a tab is drawn and the
  page has been idle 1.5 s, the tab most often opened next does too: the Schedule
  after the Dashboard, the Forecast after the Standings, and nothing else, so a
  phone on one bar fetches only what it is likely to show.
  - **Measured** (gzipped, level 9, `npm run bundle:check`): the first download
    went from 261.6 KB to 229.7 KB, and its entry chunk from 120.1 KB to 86.9 KB.
    Opening a view now adds 2.2 KB (League Stats) to 11.7 KB (Forecast);
    Team Rankings adds 138.9 KB, against 134.5 KB before, since code it shared
    with League's views is now its own chunk rather than in the first download,
    so a visit straight to Team Rankings fetches 368.6 KB rather than 396.1 KB.
  - **The bundle budget.** `scripts/bundleBudget.mjs`, run in CI after the build,
    holds the first download, the entry chunk, the stylesheet and each view's own
    load to limits about a tenth above these numbers (at least 1.5 KB for the
    small views), writes them to `dist/bundle-report.json`, and fails naming what
    grew. Source maps are built but never downloaded, so they are not counted.
  - **The numbers did not move.** `src/AppLeagueNumbers.test.tsx` pins what each
    tab shows on a fixed six-team season, the forecast seeded from the season;
    it was recorded before the split and matches after it.
- **League Standings works out only what is on screen** (2.2). Every number it
  shows is read from the games marked final, so its calculations are keyed on
  those scores alone (`finalLogsOf`, held by `useSeasonState`), which stay the same
  object while a score is typed into a game still being played: a keystroke there
  works nothing out again, and the season is worked out once, when the game is
  marked final. What one tab alone shows waits for that tab: the model's backtest
  (Dashboard and Forecast) and the season timeline, the bubble and the games that
  matter most (Forecast), joining the clinch paths, seed ranges, scenario impacts,
  game forecasts and bracket odds that already did. The backtest and the timeline,
  each of which refits the season once per game played, remember their last answer
  (`rememberLast`), so a tab opened again on an unchanged season costs nothing.
  Worker results were already safe from going stale: each job carries an id and
  the key of its input, and an answer for an older one is dropped
  (`useWorkerJob`).
  - **Measured** (`npm run score:bench` on the built app, CPU slowed four times at
    phone width, the old and new builds run back to back): on a twelve-team season
    with 54 games left, a key in a score box took a median 416 ms to show (p90
    520 ms) and now takes 24 ms (p90 32 ms); after marking a game final the page
    was busy for 566 ms and is now busy for 167 ms. On an eight-team season with 12
    left, keys went from 64 ms to 16 ms and the time busy after a final from 167 ms
    to none at all over 50 ms. **The cost:** the first Forecast opened after new
    finals now works out its timeline and backtest then, 2.4 s against 1.7 s on the
    twelve-team season (unchanged on the eight-team one); opened again, it is 1.0 s
    as before.
  - **The numbers did not move.** The pin above holds a half-scored game that is
    not final; it matched before the change and after it.
  - **Guarded** by `src/AppOnScreen.test.tsx`, which counts the calculations
    themselves: none while a score is typed, no backtest, timeline or bubble when a
    game is marked final on the Schedule, and each once when its tab opens, not
    again on a second visit.
- Simulation and trend work run in `src/workers/sim.worker.ts`.
- The rankings worker keeps one decoded pool and the page names it by revision.
  The pool crosses to it only when the pool itself changes, in the compact form
  IndexedDB stores, and a page switch, a half of the year or a different "my
  team" ships nothing at all. Measured on a 40,000-team, 400,000-game pool, the
  copy every request used to carry was 125 MB on the wire and about 3.3 s of
  serialising and deserialising; the compact shipment is 33 MB and about 0.7 s,
  and it happens once per change rather than once per fit. The tidy worker takes
  the pool the same way and hands back only the parts it changed, so a tidy that
  found nothing to do no longer re-saves the whole pool.
- Team Rankings opens on the board it last showed (`savedBoard.ts`), marked
  "Refitting…" until the open's own fit lands, which replaces it. One board is
  kept, on the device, under a key of its own in the pool's IndexedDB store that
  is not a pool key, so it never travels to the cloud copy and goes with a
  reset; it is shown only on the page, half and "my team" it was fitted for. A
  kept board whose rows lack any field a row carries, or hold one of the wrong
  type, is dropped rather than drawn. On the 114,500-team pool of 29 September
  2026 the rows came up at 3.9 s rather than 7.8 s, and the fresh board landed
  when it always had.
- A member who turns on the cloud's board ("The live board on a member's
  device") sees its rows before the pool is read. On the 29 September 2026
  backup (116,485 teams), 12U 2027, the medians of five runs, each in a fresh
  browser, were:

  |                                                       | 4× CPU, phone screen | 1× CPU, desktop |
  | ----------------------------------------------------- | -------------------- | --------------- |
  | Live off: the saved board                             | 18.8 s               | 3.77 s          |
  | Live, board read from the network (150 ms round trip) | 7.3 s                | 2.14 s          |
  | Live, board kept on the device                        | 6.6 s                | 1.91 s          |
  | Team Rankings' own fit lands, Live off / on           | 28.0 / 28.7 s        | 7.9 / 9.5 s     |
  - **The run.** The build is served by `vite preview`. The boards were
    published from the backup by the nightly's own code into files a
    scratch-only version of the reader served after the round trip, standing
    in for a signed-in member. Firestore and the sign-in were not in the run;
    the startup wait for the cloud copy is on both sides and was left out.
  - **The board.** 12U 2027's board is 3.39 MB of JSON, 646 KB gzipped, one
    piece. All 33 boards are 3.4 MB gzipped with a 7 KB meta, built in 11.5 s.
  - **What the board still waits for.** Of the phone's 6.6 s, 5.4 s is the
    main thread reading the pool from IndexedDB before the app mounts, which
    the board does not need.
  - **What comes after.** Team Rankings mounts once the board hands over, and
    its first render is one long task of up to 10.6 s on the phone (2.2 s on
    the desktop), against 5.2 s (1.1 s) after the saved board, whose wait
    comes before its rows instead. Its own fit lands about as late as without
    Live, once the board has handed over to it.

- Every page of a squad year is fitted over the same games, so the rankings
  worker fits a year once and cuts each page from that fit, keyed on the pool,
  its pages, the half, the day and the age groups (not on which team is yours).
  The page hands the worker the year's games as the same array for every page of
  the year, so a switch from 9U to 10U ships nothing. On the 18:40 pool a switch
  went from about 5 s in the worker to about 55 ms, with every page's rows the
  same to the digit. The fit itself solves over flat arrays rather than Maps:
  the 9U 2027 fit went from about 4.0 s to 2.3 s with the same bits.
- The collapse of league games and their pulled copies keys only rows between
  clubs a league row names; on the 18:40 pool it went from about 1.1 s to 30 ms
  with no league laid over it, and dropped the same rows with one.
- The Monte Carlo loop copies the league once per simulated season and writes
  results onto that copy, rather than copying every team per game; on twelve
  teams and sixty games that took 220 seasons from 195 ms to 7 ms. It stops
  once every team's odds are known to two points by the same Wilson interval
  shown beside them, with a ceiling of 4,000 seasons, and the ± on screen is
  computed from the seasons actually played.
- Hooks debounce updates and cancel in-flight runs. A run is keyed on the counts,
  the seed (every final score), the settings and each team's opponent-adjusted
  rating as a value, so linking a club or a pull in Team Rankings re-simulates the
  Gold %, champion odds and bracket, while typing into a game still in progress
  does not. Each point of Gold Odds Over Recent Games carries the rating as of its
  own last game, with the outside results played by then, and the last point is
  rated exactly as the Gold % column is, so the line ends where the column stands.
- Render lookups and scenario computations are memoized.
- Simulation/projection apply evolving in-iteration team state for deterministic, non-stale forecasts.
- Worker + inline fallback paths emit lightweight runtime timing debug logs (`[sim-worker]` / `[sim-inline]`).

## Reliability checks

- Backtesting harness (`src/lib/backtest.ts`) reports calibration buckets, Brier score, and upset capture rate using finalized historical games.
- Storage/share decoding and settings coercion are defensive against corrupted payloads and out-of-range values.

## Keyboard shortcuts

- `⌘K` / `Ctrl-K` — Command palette
- `?` — Shortcuts help
- `g s` / `g g` / `g m` / `g t` — View jumps
- `d` — Dark mode
- `Esc` — Close modal/drawer/palette

## Accessibility

- Dialogs use `role="dialog"` + `aria-modal="true"`.
- Tabs support keyboard navigation.
- Inputs are programmatically labeled.
- Standings rows support Enter/Space.
- A club's name is never cut to "…". On a 360px phone a name had 112 to 134px, and
  most real club names need more: five of eight Standings names, 21 Schedule cells
  and 15 of the National Top 25 were cut, and clubs of one organisation were cut to
  the same label. Names wrap onto a second line instead, on every League tab, the
  bracket and Team Rankings' top lists. League Stats keeps its ellipsis from `xl`,
  where its six-column grid would otherwise split names mid-word.
- Below `sm` the Scouting report is cards, one per fixture and one per opponent,
  rendered in place of the tables (`useWideViewport`) rather than beside them: a
  six-column table in a card's width left the win chance and outlook past the edge
  of every row. The search boxes have a visible edge, and on a phone the picker's
  question sits whole above its box, where "fare?" used to print over the name.
- Below `sm` the Forecast bracket stacks its rounds, one under another, each game
  card the width of the screen. Side by side, a round's column was as wide as its
  longest line, so at 360px every card was 421 to 438px in a 286px scroller and all
  18 of the demo's run boxes and Set Final buttons sat past the edge. From `sm` up
  the rounds run left to right as before; `e2e/phone.spec.ts` holds both.

- **On a phone the tabs are a bar along the bottom of the screen** (2.4,
  `src/components/TabNav.tsx`, below `sm` as `useNarrowViewport` asks it). League
  Standings' bar holds Dashboard, Schedule, Standings and Forecast, each an icon over
  its label, and **More** for Power Ratings, League Stats, Data Quality, Settings,
  the tour and the keyboard shortcuts; Team Rankings' holds Rankings, Games, Import
  and Scouting, with Archive and Setup under More. Before, all eight League tabs sat
  in one row that scrolled sideways, with Settings past the edge. A row of the five
  would not fit either: their labels alone measured 295px in 12px type against the
  288px a 320px screen leaves, so the bar sizes its labels with the screen, 9px at
  320px and below to 11px from 390px, which keeps "Dashboard" inside its cell even
  at 125% browser zoom (a 360px phone is then 288px of page).
  - A view under More whose badge is urgent, Data Quality while something needs
    attention, is also a strip across the top of the bar ("Data Quality: 1 needs
    attention") rather than a sixth cell, which would not fit. More carries the
    badges of what is behind it, and names the view open under it to a screen reader
    ("More: Settings"). A badge's words describe its tab rather than join its name.
  - The open view's cell, or More while the open view is behind it, is dark and has
    a bar across its top edge. The dark label alone measured 2.67:1 against a
    closed one (2.63:1 in dark mode), under the 3:1 a state shown by colour alone
    needs.
  - The cells keep their tab roles, the roving `tabIndex`, the arrow keys and now
    Home and End; More is a disclosure button. Escape closes its list, and so does a
    tap anywhere else, a tab in the bar included, or the keyboard moving on past the
    list's end or back past More. A view or an action chosen from the list, or from
    the strip, leaves the focus on More, which then names the view. The button
    pressed goes with the list, and the focus used to fall to the top of the page
    with it, or be handed back there by a dialog the action opened (the keyboard
    shortcuts). The list is never taller than the screen leaves above the bar and
    scrolls inside itself past that; at 320 by 256 (1280 by 1024 at 400% zoom) Power
    Ratings had sat wholly above the screen, out of reach. The panel is named by its
    view's tab, and a view under More has none in the bar, so the bar carries a
    hidden name for it in that tab's place. Wide screens keep the row of tabs, with
    the same keys and badges.
  - Pages leave room below for the bar, and toasts sit above it. The page's scroll
    padding keeps the bar and its strip clear too, so a control the keyboard moves
    to is scrolled above the bar rather than to the screen's edge behind it: at 360
    by 640, tabbing down Settings had left two fields wholly under the bar and two
    partly, and leaves none now.
  - The app-mode switch fills a phone's row, each tab as wide as its label and the
    room left over shared between them. At its old size it was 336px wide in the
    288px a 320px screen leaves, which widened the whole page there; the new 320px
    checks found it. In equal halves "League Standings" ran out past its tab at
    288px unless its type was let down to 11px; sized by label, both stay at 12px
    or more with their text inside them from 280px up.
  - `e2e/phone.spec.ts` holds the bar at 320, 360 and 390px and at 125% zoom (every
    cell and More on screen, each label inside its cell, More's list on screen), the
    last of a page clear of the bar, and a tablet keeping all eight tabs in a row.
    Team Rankings' sections keep their links (`?section=`); League's views are, as
    before, carried by a share link rather than the address.

## Design system

The looks the app shares live in `src/styles/tokens.ts` (2.5), so a page title, a
footnote or a failed panel reads the same on every League view.

- **Text roles** (`textRole`): page title, the line under it, section title, card
  title, body, meta (dates, counts, sources), numeric (figures in tabular digits, so
  columns line up) and overline, a label a reader can do without. League's tables
  (Standings, Power Ratings, the Forecast's projected table, a team's games) set their
  figures in tabular digits too.
- **Three surfaces** (`surface`): the page itself, a card for what a page is about,
  and a quiet inset, without a border or shadow of its own, for what groups within
  one, so not every piece of content is an equally loud white card.
- **Page headers** (`PageHeader`): Standings, Power Ratings, League Stats, Forecast,
  Data Quality and Settings open the same way, with the title the tab named, its help
  button and a line saying what the view is for. On the Dashboard, Power Ratings is a
  section of that page and is titled as one.
- **States** (`StatePanel`, `stateTone`): empty, loading, error, offline and stale,
  each on a surface of its own. A failure interrupts a screen reader
  (`role="alert"`), the passing states are announced (`role="status"`), and an empty
  panel is simply part of the page. A view's placeholder while its code loads, the
  empty panels, a view that failed to draw (with Try again), and the line over League
  Standings kept live (stale while it connects, offline, or an error when the season
  can't be edited) all go through it.
- **No text under 12px.** The app set 10px and 11px type in 89 places: table headings,
  the names of figures, the run labels on a game card, a team's record. It is all 12px
  now, but for the phone's tab bar, whose labels are sized with the screen, and a line
  chart's labels inside its SVG. Section headings that were small capitals, such as
  Data Quality's "Worth reviewing", are now section titles.
- **4.5:1 contrast for text, 3:1 for large text.** What fell short, and what it is now:
  - Grey on the page: slate-500 measured 4.35:1 on the page's slate-100, under the
    line on the "Updated through" leads and on inactive tabs. The text roles and tabs
    are slate-600 at the lightest, 6.90:1.
  - White on emerald-600 measured 3.67:1 (Save + Final, the Safe seed badge, the
    success toast), and emerald-600 text on white the same. Both are emerald-700,
    5.37:1.
  - White on orange-500, the Chasing seed badge, measured 2.89:1; its figures are dark
    now, 6.98:1.
  - Red-600 on a dark game card's slate-800, the Delete button, measured 3.08:1;
    red-400 is 5.07:1.
  - The seed odds grid shaded up to full blue-500, under which white figures measured
    3.68:1 and grey ones less. It stops at 80% blue, with dark figures in light mode
    (7.26:1 at the strongest) and white in dark (5.01:1). Its cut-line column heading
    was red-500 on white, 3.81:1, and is red-700, 6.42:1.
  - The schedule-difficulty cards drew their opponents at 80% opacity (4.46:1 on the
    amber card); they are full strength now. The toast's dismiss button was 70% white
    on the toast, 2.53:1, and is white.
- **How it is checked.**
  - `src/styles/tokens.test.ts` reads Tailwind's palette from its own theme
    (`tailwindcss/theme.css`, in OKLCH, converted as a browser draws it: slate-500
    comes out #62748e) and measures every text role on every surface, each status
    pill on a card and each state panel's words, in light mode and dark.
  - `src/components/textSize.test.ts` reads every component, Team Rankings' too, and
    the shared styles in `tokens.ts` for a size set below 12px, a size sized with the
    screen counted by its floor (the app-mode switch's `clamp(11px,…)` was 11.52px on
    a 320px phone, under the 360px the browser checks measure at).
  - `e2e/design.spec.ts` measures the built app: League Standings in light mode and
    dark, on a phone (360px), a tablet (768px) and a desktop (1280px), on every view of
    the demo season, on the first launch with no season, and while a view is loading
    and after it fails to. Every visible run of text is measured against what is
    actually painted behind it (see-through layers blended down to the first solid
    one), no text may be under 12px, and nothing may be wider than the screen. On the
    2.4 build it found 10 or 11px text in about 40 places on League's pages and a
    dozen colour pairs under 4.5:1; it finds none now. Text over a gradient or a
    picture, in a chart's SVG, or on a control that is switched off is counted but not
    measured.
  - **No pixel-by-pixel screenshot comparison in CI.** A screenshot from one Chromium
    and its fonts differs from another's, so a baseline taken here would fail in CI on
    how text is drawn rather than on the design. The checks above read the styles the
    browser computed, which do not depend on fonts. To look the pages over by eye,
    `SCREENS=1 npx playwright test e2e/design.spec.ts` (after a build) keeps a
    full-page screenshot of every state in `test-results/`.
  - The offline and stale states appear only for a member's League kept live, which the
    browser tests cannot sign in to; the unit tests (`StatePanel.test.tsx`) and the
    contrast test cover them instead.

## Platform baseline

This project tracks the newest dependency/runtime baseline that can be installed and verified in the current environment. The npm registry was unavailable through the configured proxy during the latest modernization pass, so the package manifest was advanced to the newest versions already present in the local lockfile/cache and runtime (`node` 24). When registry access is available, the next modernization target is the current stable major line for React, Vite, Tailwind CSS, ESLint, Vitest, and vite-plugin-pwa.

## Deploy

Vercel deploys the static Vite app. There is no `api/` directory, so this repository
does not create Vercel serverless functions. Firebase deploys both HTTP APIs, `gcTeam`
and `leagueSummary`, and the app uses their URLs by default. `VITE_GC_PROXY_URL` is an
optional override for another proxy, rather than a setting needed to avoid Vercel CPU.
CI runs lint, typecheck, tests, build, and checks that both default endpoints are Firebase.

To stop Vercel function CPU usage, merge and deploy this version of the site. Existing
deployments retain their old functions; remove obsolete preview deployments in Vercel if
they still receive traffic. Usage already incurred remains in the month's total. Optional
AI provider keys belong in GitHub Actions secrets for the Firebase deployment, not Vercel.
Without those keys the app continues to use its local story generator.

### The GameChanger proxy on Firebase

The proxy runs as a Firebase function. Vercel's Hobby plan
bills a function's invocations and CPU, and a nationwide pull spends both: 443,000
calls had used the month's four hours of Active CPU by 28 September 2026. The
function in `functions/` is the shared handler in `server/gc-team.ts`, bundled by
esbuild, with two things a function on another host adds for itself
(`serveGcProxy`): CORS for the app's own pages, including exposing `Retry-After` so
the pull can still hold itself back, and gzip, which Vercel does for a function and
Firebase does not. The app defaults to the project's Firebase function even when
`VITE_GC_PROXY_URL` is absent; there is no fallback to a Vercel API. CI builds the bundle and runs
it on a fake request (`functions/smoke.mjs`) on every change to it, and the
**Firebase functions** workflow deploys it on merge once the project is connected.

**For the list's accounts alone.** Until 2 October 2026 the proxy answered
anyone: GameChanger's endpoints need no login, and nothing it hands back is
secret. Its cost is what changed that. The function is billed by the time it
spends and the bytes it sends, past a free allowance, and the project stops itself
at a dollar (below), so anybody who found the URL could spend the month's dollar
and stop every pull with it. Now a request carries the caller's Firebase sign-in
token (`Authorization: Bearer …`), and the proxy asks Firestore, with that same
token, for the caller's own entry on the list (`memberCheck.ts`). The rules answer
that read for a member and refuse it for anyone else, so the list and the rules
stay the one place that says who is let in, and the proxy holds no key of its own:
Firestore checks the token's signature, hour and project before the rules run. An
answer is kept ten minutes, never past the token's own hour, so a pull of
thousands of teams costs a read or two. A request with no token is turned away
with a 401 without asking anything, one from an account not on the list with a
403, both `reason: "members-only"`; one Firestore could not be asked about is a
503, and kept for no time. `?probe=1` stays open, since it touches nothing
upstream. The app sends the token itself (`gcAuthorization.ts`, set by the cloud
session), and the proxy's CORS lets the header through. A turned-away request
still runs the function, for a few milliseconds and a few hundred bytes, where a
pull's request waits seconds on GameChanger and sends back schedules.

The nightly refresh and the other jobs on GitHub ask GameChanger through the
handler in their own process (`gcTeamHandler`), never through the URL, so the
list does not apply to them. **Verify the GameChanger pull** now asks the
deployed proxy only what a stranger can: that it is up, and that it turns a
request with no sign-in away (**Strangers**, a failure if it answers instead). It
pulls its real teams through the handler in its own process, as the nightly
does, which proves GameChanger answers GitHub's servers and still sends what the
app reads, and no longer proves it answers the Firebase function's: the check has
no account on the list to sign in with. A member's next pull from the app is
that check, and says `blocked` if Google's servers are ever refused.

**What it costs.** It needs the pay-as-you-go Blaze plan, since the free Spark plan
runs no functions; Blaze's free monthly allowances are used first. The daily refresh
of the 26 September pool was 53,254 teams in 5,330 calls, about 160,000 calls a month,
far inside the two million a month Cloud Functions gives free, and each call spends
its time waiting on GameChanger rather than computing. What can pass the free level
is the bytes sent back to the browser, which is why the answer is gzipped. The size
of GameChanger's replies could not be measured from here, so treat the bill as
unknown until the first week's usage is in; a budget alert of a few dollars catches
it either way.

**Connecting it, once.**

1. In the [Firebase console](https://console.firebase.google.com), create a project
   (or pick one) and note its **project ID**. Under **Usage and billing**, switch it
   to **Blaze**, and set a budget alert.
2. Open [Cloud Shell](https://console.cloud.google.com/?cloudshell=true) in that
   project and run this, with your project ID on the first line. It turns on the
   services a deploy needs, makes a deploy account for GitHub with the roles it
   needs, and prints that account's key:

   ```sh
   PROJECT=your-project-id
   gcloud config set project "$PROJECT"
   # Cloud Billing too: every functions deploy runs Firebase's extensions step, which
   # reads the project's plan through it, and the deploy account cannot turn it on.
   gcloud services enable iam.googleapis.com cloudresourcemanager.googleapis.com \
     compute.googleapis.com cloudfunctions.googleapis.com cloudbuild.googleapis.com \
     artifactregistry.googleapis.com run.googleapis.com eventarc.googleapis.com \
     pubsub.googleapis.com cloudscheduler.googleapis.com storage.googleapis.com \
     cloudbilling.googleapis.com
   SA="github-deploy@$PROJECT.iam.gserviceaccount.com"
   gcloud iam service-accounts create github-deploy --display-name "GitHub deploy"
   for ROLE in roles/firebase.admin roles/cloudfunctions.admin roles/run.admin \
     roles/iam.serviceAccountUser roles/artifactregistry.admin \
     roles/serviceusage.serviceUsageConsumer; do
     gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$SA" \
       --role "$ROLE" --condition=None > /dev/null
   done
   # Builds run as the project's default compute account, which new projects no
   # longer give the role it needs.
   NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
   gcloud projects add-iam-policy-binding "$PROJECT" \
     --member "serviceAccount:$NUMBER-compute@developer.gserviceaccount.com" \
     --role roles/cloudbuild.builds.builder --condition=None > /dev/null
   gcloud iam service-accounts keys create key.json --iam-account "$SA"
   cat key.json
   ```

3. In GitHub, under the repository's **Settings → Secrets and variables → Actions**,
   add a secret `FIREBASE_SERVICE_ACCOUNT` holding the whole key printed above, and a
   variable `FIREBASE_PROJECT_ID` holding the project ID. Then delete the key from
   Cloud Shell (`rm key.json`). It can deploy to the project, so it belongs in that
   secret and nowhere else.
4. Under **Actions**, run **Firebase functions**. Its log ends with the function's
   URL, `Function URL (gcTeam(us-central1)): https://…`.
5. Under **Actions**, run **Verify the GameChanger pull** with **proxy** set to that
   URL. It checks the function is up and turns a stranger away (**For the list's
   accounts alone**, above). Whether GameChanger's firewall lets a Google server
   through as it does Vercel's is the first pull from the app, signed in, through
   the function. Setting the repository variable `VERIFY_GC_PROXY` to the URL makes
   the weekly check use it too.
6. Deploy the latest site. It defaults to this project's Firebase `gcTeam` URL. Only
   when using another Firebase project, set `VITE_GC_PROXY_URL` to its function URL
   before building the site. The Firebase **Usage** page shows requests arrive.

**A hard stop on the bill.** Google Cloud has no spending cap: a budget only sends
email. The `billingCap` function (`src/lib/billingCap.ts`) makes one, the way
Google's own guide to capping costs does. The budget publishes each of its readings,
several a day, to the Pub/Sub topic `billing-cap`; once a reading says the month's
cost has reached the budget, the function takes the project off its billing account,
and every paid service in it stops, the proxy included, until billing is linked
again. It runs as a service account of its own, the only one allowed to do that,
and the ceiling is the budget's amount rather than a number in the code, so moving
it is an edit to the budget. Google's cost figures arrive hours late, so a stop can
land a little past the amount. Whether the proxy's ordinary use stays under a dollar
is not known until the first week's usage is in, for the reason above.

Set it up once, in Cloud Shell, **before the first deploy** (the deploy creates the
function, and fails for want of its account otherwise):

```sh
PROJECT=your-project-id
gcloud config set project "$PROJECT"
gcloud services enable cloudbilling.googleapis.com billingbudgets.googleapis.com
# The stop's own account: it may unlink billing and be called by its trigger.
gcloud iam service-accounts create billing-cap --display-name "Billing hard stop"
CAP="billing-cap@$PROJECT.iam.gserviceaccount.com"
for ROLE in roles/billing.projectManager roles/run.invoker roles/eventarc.eventReceiver; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$CAP" \
    --role "$ROLE" --condition=None > /dev/null
done
# The deploy account wires the function to its topic.
for ROLE in roles/pubsub.editor roles/eventarc.admin; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member "serviceAccount:github-deploy@$PROJECT.iam.gserviceaccount.com" \
    --role "$ROLE" --condition=None > /dev/null
done
# What a project's first event-triggered function needs, which the deploy grants
# itself only if it may change the project's roles, and the deploy account may not.
NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member "serviceAccount:service-$NUMBER@gcp-sa-pubsub.iam.gserviceaccount.com" \
  --role roles/iam.serviceAccountTokenCreator --condition=None > /dev/null
for ROLE in roles/run.invoker roles/eventarc.eventReceiver; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member "serviceAccount:$NUMBER-compute@developer.gserviceaccount.com" \
    --role "$ROLE" --condition=None > /dev/null
done
# The topic, which budgets may publish to.
gcloud pubsub topics create billing-cap
gcloud pubsub topics add-iam-policy-binding billing-cap \
  --member serviceAccount:billing-budget-alert@system.gserviceaccount.com \
  --role roles/pubsub.publisher > /dev/null
# The budget: a dollar a month on this project, emailing at half and at all of it,
# and publishing every reading to the topic. A budget names its project by number.
BILLING=$(gcloud billing projects describe "$PROJECT" --format='value(billingAccountName)')
gcloud billing budgets create --billing-account "${BILLING#billingAccounts/}" \
  --display-name "Hard stop" --budget-amount 1.00USD \
  --filter-projects "projects/$NUMBER" \
  --threshold-rule percent=0.5 --threshold-rule percent=1.0 \
  --notifications-rule-pubsub-topic "projects/$PROJECT/topics/billing-cap"
```

A budget made in the console does the same once **Connect a Pub/Sub topic to this
budget**, under its actions, names `billing-cap`. After a deploy, the function's
log (Firebase console, **Functions**, `billingCap`) shows a line for every reading:
"Under the budget (0.12 USD of 1.00 USD); nothing done."

**If it stops the project.** Pulls fail, since the proxy is down. The app does not
switch requests to Vercel. To start it again, raise the budget's amount first, or the next reading
turns billing off again, since the month's cost is still past it; then link the
project to its billing account (**Billing → Account management**, the project's
menu, **Change billing**) and run **Firebase functions** to bring the functions back.

### Cached live data and reconnection

The Import refresh panel keeps a validated status snapshot per account, so opening
it shows saved counts while the cloud reconnects. Cached catch-up actions wait for
fresh status before offering their team lists.

Live rankings, games and scouting views use IndexedDB independently of the browser
pool, which stays closed in cloud mode. Saved views render before a network request
for their replacements, and remain visible during background refreshes or a dropped
connection. Only a first visit without saved data needs a loading screen. Usable
board snapshots are saved together; a new manifest does not strand the cache on
bytes that have not downloaded yet. Cache entries are hash checked and isolated by copy. A membership refusal clears
them, and changing the signed-in account discards its saved snapshot.

Transient status reads and import starts reconnect automatically, with delays capped
at 30 seconds and at most five tries again (`MAX_RECONNECTS`), after which the card says what
went wrong and offers to try again. A question or a warm-up the server gave up on (`aborted`,
or past its time) is not asked again on its own at all: each try is a cold load of the whole
pool. Sign-in and permission refusals remain actionable. Unkeyed edits are
not blindly repeated after an uncertain save, because doing that could duplicate an
edit. Import starts are safe to retry by their persistent job identity.
