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
it can merge. Majors are *not* excluded — each arrives as its own pull request, because each one is
a migration, and a red check on one is a cheap and accurate answer to "can we take this yet?".
A few are blocked upstream at any given time; `.github/dependabot.yml` names which and why, and
the day an upstream plugin catches up, the PR that was red goes green on its own.

## Two modes

The header switches the whole app between them. They keep separate storage and
separate teams.

| Mode                 | What it is                                                                                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **League Standings** | One season of one league, on a fixed schedule, with full box scores. Standings, power ratings, playoff odds, magic numbers, a simulated forecast.                                            |
| **Team Rankings**    | Any team from any source, scores only. Tournament games, another league's results, an opponent you are about to play. Everyone is rated against everyone else, adjusted for who they played. |

See [Team Rankings](#team-rankings) below for how the two connect.

## Features

| Area                 | Highlights                                                                             |
| -------------------- | -------------------------------------------------------------------------------------- |
| **Standings**        | Records, cut-line status, SOS, trends, AI league analysis or deterministic story.      |
| **Games**            | R/H/K entry, predictions, final toggle, filters, auto re-projection.                   |
| **Season Predictor** | Forecast board, bubble watch, cut-line games, game forecasts, trend charts.            |
| **Team drawer**      | Team stats, path summary, magic/elimination numbers, swing games, compare view.        |
| **Settings**         | Season label, cutoff, points, tiebreaker, recap grouping, aggression.                  |
| **Power UX**         | Command palette, shortcuts, dark mode, share URL, CSV import/export, undo, onboarding. |
| **Installable PWA**  | Installable via `vite-plugin-pwa` (basic precache).                                    |
| **A11y**             | Dialog semantics, focus management, keyboard nav, labeled inputs.                      |
| **Perf**             | Worker simulation, debounced updates, memoized lookups/scenarios.                      |
| **Team Rankings**    | Age groups, opponent-adjusted ratings, scouting report, CSV/paste import, team detail. |

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

Nothing can be logged until an age group exists, because every game has to know
which ranking it belongs to. A 9U score says nothing about an 11U game, so the
two never mix.

An age group is an **age level** (8U-18U) and a **year** (2027 on), zero or more
League Standings seasons that belong to it, and optionally the age group it
**continues from**. Both are dropdowns, so the label is always "10U 2028" and
never two spellings of the same season. Groups created before the picker existed
keep the name they were typed with; editing one reads the age and year back out
of that name where it can.

| Concept           | What it does                                                                                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Assigned seasons  | Those seasons' whole schedules fold in. Tick a Fall and a Spring season together when both are the same squad-year.                                                                                                      |
| Advance to new season | Creates next year's group from this one — a year older, a year later (9U 2027 → 10U 2028), already continuing from it, already carrying "our team". Seasons are not copied: next year's don't exist yet. 18U stays 18U while the year moves, since a player can spend two years there. |
| `continuesFromId` | Last year's version of this squad. Its opponents keep appearing in the name dropdown as the squad ages up. **Only names travel** — results never pool, so a 10U group that continues from a 9U one starts at zero games. |
| `myTeamId`        | "Our" team, per age group, so a club running a 9U and an 11U at once has one of each. Never touches the rating math.                                                                                                     |

Two age groups running at the same time and not linked share no names, which is
what stops a 9U opponent appearing while logging an 11U game.

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
| Score errors          | Kid Pitch only. Off drops the E box from score entry and E/G from the stat pages.                                                                                         |
| Win / Tie points      | Math calculations and Gold status.                                                                                                                                        |
| Tiebreaker order      | Tournament seeding after winning percentage: two-team head-to-head, run differential, runs allowed, runs scored.                                                          |
| Team Rankings results | Whether tournament games logged in Team Rankings sharpen this league's game forecasts (`useScoutResults`). Forecasts only — records and standings are always league-only. |
| Recap grouping        | Builds stories per game, date, or week.                                                                                                                                   |
| Model aggression      | Prediction weighting profile.                                                                                                                                             |

## Data + persistence

- `league_teams_v1`, `league_matchups_v1`, `league_logs_v1`, `league_settings_v1`
- Team Rankings keeps its own keys, shared across seasons:
  `league_forecast_scout_teams_v1`, `league_forecast_scout_games_v1`,
  `league_forecast_scout_age_groups_v1`
- `league_undo_snapshot_v1`
- League stories are generated locally from standings facts. With `GEMINI_API_KEY` set, Gemini rewrites the same facts into prose; see [AI league story](#ai-league-story). No key is required for the app to work.
- One-time migration from older `league_*` keys
- CSV import/export with BOM/formula guard handling

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
