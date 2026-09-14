# League Forecast

A browser-first web app for league predictions, power ratings, matchup analysis, and forecast accuracy. All league data stays in the browser; the only server-side piece is one optional serverless function that writes the AI league story.

## Stack

- Vite 7 + React 19 + TypeScript 6
- Tailwind CSS 4 (configured in CSS; there is no tailwind.config.js)
- Web Worker-based Monte Carlo simulation
- One Vercel Serverless Function (`api/league-summary.ts`) for the Gemini-written league story
- Vitest
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

## Features

| Area                 | Highlights                                                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Standings**        | Records, cut-line status, SOS, trends, AI league analysis or deterministic story.                                          |
| **Games**            | Score entry, predictions, final toggle, filters, auto re-projection, fill from a pull.                                     |
| **Season Predictor** | Forecast board, bubble watch, cut-line games, game forecasts, trend charts.                                                |
| **Team drawer**      | Team stats, path summary, magic/elimination numbers, swing games, compare view.                                            |
| **Settings**         | Season label, cutoff, points, tiebreaker, recap grouping, aggression.                                                      |
| **Power UX**         | Command palette, shortcuts, dark mode, share URL, CSV import/export, undo, onboarding.                                     |
| **Installable PWA**  | Installable via `vite-plugin-pwa` (basic precache).                                                                        |
| **A11y**             | Dialog semantics, focus management, keyboard nav, labeled inputs.                                                          |
| **Perf**             | Worker simulation, debounced updates, memoized lookups/scenarios.                                                          |
| **Team Rankings**    | A page per age level, national top 25 and state top 10, cross-age ratings, scouting report, CSV/paste import, team detail. |
| **GameChanger**      | Pull a team list's schedules, resumable, on a weekly rota; pairings proposed for approval.                                 |

## Architecture

```
api/
  league-summary.ts     # Vercel function: Gemini recap of standings movement
src/
  App.tsx
  main.tsx
  index.css
  lib/
    types.ts
    util.ts
    format.ts
    date.ts
    csv.ts
    sim.ts
    magic.ts
    insights.ts           # deterministic recap + league-story generation
    geminiModels.ts       # Gemini model discovery + newest-first ranking
    leagueSummary.ts      # shared request contract + prompt building
    scheduleText.ts       # reads pasted text / CSV into games, entirely on the device
    teamRankings.ts       # age groups, opponent-adjusted ratings, name matching, rename/merge
    teamRankingsStorage.ts # its own localStorage keys, shared across seasons
    leagueSummaryClient.ts # browser client for /api/league-summary
    share.ts
    storage.ts
    backtest.ts
  hooks/
    useSimulationWorker.ts
    useLeagueSummary.ts
    useToast.ts
    useDarkMode.ts
    useShortcuts.ts
    useFocusTrap.ts
    useBreakpoint.ts
    useUrlState.ts
  workers/
    sim.worker.ts
  components/
    Toast.tsx
    CompareDrawer.tsx
    WeeklyRecap.tsx
    CommandPalette.tsx
    ShortcutsHelp.tsx
    OnboardingTour.tsx
    TeamRankingsView.tsx
    TeamDetailPanel.tsx
    ScheduleImportPanel.tsx
    charts/
      LineChart.tsx
      HeadToHeadMatrix.tsx
  styles/tokens.ts
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
| Assigned seasons      | Those seasons' whole schedules fold in. Tick a Fall and a Spring season together when both are the same squad-year.                                                                                                                                                                    |
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

A page leads with a **national top 25** and a **state top 10**, the state being
yours where it is known and otherwise whichever has the most teams there. The
place shown in each is the place in _that_ list: a state top ten is ten teams
rated against the whole country and then listed together, so the second-best team
in the state is #2. The full table is behind a toggle, for finding one particular
team in a pool of thousands.

### How the two modes connect

**League → Team Rankings, always.** A season assigned to an age group brings its
whole schedule: upcoming games show their opponent right away, and once a game is
scored in League Standings it counts as a final here too.

**Team Rankings → League, by choice.** Tournament results sharpen that league's
_game forecasts_ — see the `useScoutResults` setting. They help most where a
schedule is thin: two teams who never met become comparable through an opponent
they both played elsewhere. Records, standings, elo, recent form and strength of
schedule stay league-only. Games carried in from the league are excluded on the
way back, so nothing is counted twice.

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
| A different score is already entered | Shown side by side and left alone unless that row is chosen by name.                                       |
| A pairing plays twice on one day     | Paired in schedule order when both sides have the same number of games; otherwise reported, never guessed. |

The league and GameChanger rarely agree on how long a club's name is — "Trash
Pandas" against "Trash Pandas Baseball Club" — and a league game left unmatched
looks exactly like one that has not been played, which is what makes silence
here dangerous. So a game the names missed gets a second look against the
results on its own day, under the looser rule the importer already uses, and
anything that lines up is offered rather than applied. Correcting the name in
Team Rankings makes it match on its own from then on. Two clubs close enough to
be confused with each other on the same day are reported instead: "South
Lexington Red" and "…Blue" are four characters apart and are two real teams.

Games the league itself put into the pool are excluded on the way back, so a
season can never confirm its own scores. Anything already typed into a game —
hits, strikeouts, the innings it was stored with — survives the fill untouched.

**One fixture, one game.** A club that tracks a league here and also pulls the
GameChanger team playing in it has the same fixture twice over: once derived
from the league schedule, once pulled. The pool counts it once, preferring the
league's own record where the league has scored it, so a rating never counts a
game twice. The day is what decides this — the same two clubs meeting on another
date played outside league play, and that game stands on its own. Results
carried back into the league's own forecasts skip its fixtures for the same
reason.

### Names

Age levels are stripped everywhere: "South Lexington Red 9u" is stored as "South
Lexington Red". The age level is already carried by the age group, and keeping it
in the name would split one club into a new team every year as it plays up.

Clicking a team opens everything logged for it, and is also where a name is
corrected. **Renaming onto a name that already exists merges the two** — which is
how a game logged against "TBD", or a club typed two ways, reaches the team it
belongs to.

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
level first.

GameChanger's public API allows only its own site as an origin, so the browser
cannot call it. `api/gc-team.ts` is a serverless function that reads a team's
profile and games on the app's behalf and maps every failure to a reason the
panel can explain. It sends the same `Accept` versions and `gc-app-name` header
the site does. `GC_EXTRA_HEADERS` takes a JSON object of extra headers for the
day AWS WAF starts challenging server traffic.

**Identity is asymmetric, on purpose.**

|                                    |                                                                                                                                                                                                                            |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A team pulled by id                | _is_ that id. GameChanger mints a new one every season, so a club's Fall and Spring squads arrive as two teams and stay two until somebody pairs them.                                                                     |
| An opponent                        | has no id — GameChanger never gives one. The avatar is the only identifier that means the same thing on two schedules, so it is matched on that first, then on a name, and then only within one age level and season year. |
| A club already here as an opponent | is adopted rather than duplicated when its own turn comes. In a full pull nearly every team appears as somebody's opponent first.                                                                                          |

The same game is on both teams' schedules and a re-pull brings back a schedule
almost entirely unchanged; both are matched rather than filed again, and only a
score that has since been played is written.

Pairings are **proposed, never applied**. At the end of a pull the panel offers
the clubs that look like the same club a season on — same picture, or same name
at the same level — and nothing is paired unless it is ticked. A team's own panel
lists the GameChanger ids it is known by, unlinks one that was paired wrongly,
and folds this team into another for one that arrived twice.

A run of a few thousand teams takes a while and saves as it goes: the pool is
written every twenty-five teams and the cursor only advances after the write, so
stopping, reloading or closing the tab costs at most those twenty-five.

#### The weekly rota

Re-pulling a whole list nightly is thousands of requests for data that has mostly
not moved, so each age group comes round once a week instead:

| Day       |          | Day      |                      |
| --------- | -------- | -------- | -------------------- |
| Sunday    | 8U, 9U   | Thursday | 12U, 13U             |
| Monday    | 16U, 17U | Friday   | catch up on failures |
| Tuesday   | 10U, 11U | Saturday | 14U, 15U             |
| Wednesday | 18U      |          |                      |

Every level is at most seven days old and no day's run is long enough to be worth
interrupting. `WEEKLY_ROTATION` in `src/lib/gameChangerSchedule.ts` is the whole
of the schedule; nothing else reads a day or a level.

Nothing fires by itself — there is no server here, and a browser cannot run while
it is closed — so the panel answers "what is due?" when the app is next opened. A
level is marked done only when its run actually finishes, so stopping half way
leaves it due.

### States

A team can carry a two-letter state, and the rankings can be narrowed to one — or
to the teams whose state is not set yet. Set it on the team panel, or let an
import fill it in: `Home State` / `Away State` on a game list, `State` on a
schedule. An imported state never overwrites one already there.

Filtering is presentational. Ratings come from every game regardless, so a
filtered table renumbers but keeps each row's place in the full table alongside.

### Ratings

A rating estimates how many runs a team beats an average opponent by, adjusted
for opponent strength, capped at ±8 so one blowout cannot run away with a season.
Only completed games count; scheduled ones exist so a future opponent can be
logged early. Win probabilities are clamped to 8–92% — youth baseball has no
locks.

Until teams share opponents, directly or through a chain, a rating is close to a
plain run differential.

#### Playing up and down

Fall tournaments routinely pair a team against the level above or below. Every
age group sharing a **season year** is therefore fitted as one pool, with each
game carrying the gap between the two sides: the older side is expected to win by
about two runs per year of age, a prior the data then refines. An 8U losing by
about that much to a 9U comes out even rather than punished. Strength of schedule
is read from each team's own seat, so it weighs heavier for the team playing up
and lighter for the one playing down.

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

## Settings

| Setting               | Effect                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Season label          | Header/export label.                                                                                                                                                      |
| Postseason            | `Cut line` (top N make the Gold Bracket), `Bracket, no cut` (every team qualifies), or `No postseason`.                                                                   |
| Gold cutoff           | Number of teams in the Gold Bracket. Only applies when the postseason is set to `Cut line`.                                                                               |
| Score detail          | `Runs only` (the default) or `Full box score`. Runs alone drive the standings, the records and every projection; the fuller box score only adds the per-game stat pages.  |
| Score errors          | Full box score and Kid Pitch only. Off drops the E box from score entry and E/G from the stat pages.                                                                      |
| Win / Tie points      | Math calculations and Gold status.                                                                                                                                        |
| Tiebreaker order      | Tournament seeding after winning percentage: two-team head-to-head, run differential, runs allowed, runs scored.                                                          |
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
- League stories are generated locally from standings facts. With `GEMINI_API_KEY` set, Gemini rewrites the same facts into prose; see [AI league story](#ai-league-story). No key is required for the app to work.
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

Moving across is all or nothing: a value that will not write abandons the whole
migration with `localStorage` untouched, and the old copies are dropped only once
every value is known to be in the new store. A browser without IndexedDB — a
private window, an old one, blocked site data — never leaves the `localStorage`
path, which is unchanged.

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

A CSV with no section markers is treated as all schedule, so every CSV exported
before sections existed, and every hand-made one, still imports unchanged.

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

Set these in Vercel under **Project → Settings → Environment Variables**, for
every environment you want the AI story in, then redeploy. Do
_not_ prefix them with `VITE_`: any `VITE_*` variable is inlined into the client
bundle and would publish the key to every visitor. The browser posts recap facts
to `/api/league-summary` and the function calls Gemini with the key.

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

| Header shows                     | Meaning                                                       |
| -------------------------------- | ------------------------------------------------------------- |
| `AI` badge                       | Gemini wrote this. The tooltip names the model that answered. |
| `AI off — no API key`            | The function ran but `GEMINI_API_KEY` is not readable by it.  |
| `AI off — endpoint not deployed` | Nothing is serving `/api/league-summary`.                     |
| `Paused — too many retries`      | This app's own per-browser limit. No model was attempted.     |
| `Gemini limit reached`           | Gemini's own quota refused every model tried.                 |
| `No AI model available`          | The key listed no usable model.                               |
| `AI unavailable`                 | Something else upstream. The tooltip carries the message.     |

A **Retry** button re-requests it, and **Rewrite** asks for a fresh take on an
analysis that already succeeded. The endpoint is throttled per IP (best effort,
in-memory).

### Diagnosing it

When a write-up is unavailable, the panel header shows a **Why?** button. It
asks the endpoint what is actually wrong and prints the answer in place — which
model the key can reach, or that the key is not reaching the function, or that
nothing is serving the endpoint at all. It runs as a `fetch`, so a stale service
worker cannot answer it with the cached app shell.

The same check is available directly at `GET /api/league-summary` — no console
needed:

```
https://<your-site>/api/league-summary
https://<your-site>/api/league-summary?probe=1
```

| Result                              | Meaning                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------- |
| **404**                             | The function is not deployed or not routed. The app shows `AI off — endpoint not deployed`. |
| `keyConfigured: false`              | The function is deployed but `GEMINI_API_KEY` is not reaching it.                           |
| `keyHadSurroundingWhitespace: true` | The stored value has leading/trailing whitespace (a paste artifact).                        |
| `keyLength`                         | Length only, never the value — catches a truncated paste.                                   |
| `commit`                            | The deployed commit. If it predates your change, the deploy has not happened yet.           |
| `vercelEnv`                         | `production` or `preview` — environment variables are scoped per environment.               |
| `?probe=1` → `ok: true`             | The key can list models; `candidates` shows the attempt order, newest first.                |
| `?probe=1` → `ok: false`            | Gemini rejected the key. The response quotes Google's own error and names the fix.          |
| `?probe=1` → `listError`            | Google's verbatim status and message for the model listing.                                 |
| `?probe=1` → `generation`           | Result of one tiny `generateContent` call — a key can be able to generate but not list.     |

Two Vercel behaviors cause most of the confusion: environment variables are
**scoped per environment** (a Production-only variable is invisible to preview
deploys), and a variable added after the last build **is not picked up until you
redeploy**.

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

`npm run dev` serves the Vite app only, so `/api/league-summary` returns 404 and
the deterministic story is shown. To exercise the AI path locally, run
`vercel dev` with `GEMINI_API_KEY` in a local `.env` file (git-ignored).

## Performance notes

- Simulation and trend work run in `src/workers/sim.worker.ts`.
- Hooks debounce updates and cancel in-flight runs.
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

## Platform baseline

This project tracks the newest dependency/runtime baseline that can be installed and verified in the current environment. The npm registry was unavailable through the configured proxy during the latest modernization pass, so the package manifest was advanced to the newest versions already present in the local lockfile/cache and runtime (`node` 24). When registry access is available, the next modernization target is the current stable major line for React, Vite, Tailwind CSS, ESLint, Vitest, and vite-plugin-pwa.

## Deploy

Vercel deploys the Vite app plus the `api/` serverless function. CI runs lint,
typecheck, tests, and build. Set `GEMINI_API_KEY` in the Vercel project to turn
on the AI league story; without it the deploy still works and uses the local
story generator.
