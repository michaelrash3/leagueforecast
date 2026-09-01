# League Forecast

A browser-first web app for league predictions, power ratings, matchup analysis, and forecast accuracy. All league data stays in the browser; the only server-side piece is one optional serverless function that writes the AI league story.

## Stack

- Vite 5.4 latest-line + React 18.3 + TypeScript 5.9
- Tailwind CSS 3.4 latest-line
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

Node `>=24` (see `.nvmrc`) for the latest available LTS/current runtime baseline used by this project.

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
    charts/
      LineChart.tsx
      HeadToHeadMatrix.tsx
  styles/tokens.ts
```

## Settings

| Setting          | Effect                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| Season label     | Header/export label.                                                                                             |
| Gold cutoff      | Number of teams in Gold Bracket.                                                                                 |
| Win / Tie points | Math calculations and Gold status.                                                                               |
| Tiebreaker order | Tournament seeding after winning percentage: two-team head-to-head, run differential, runs allowed, runs scored. |
| Recap grouping   | Builds stories per game, date, or week.                                                                          |
| Model aggression | Prediction weighting profile.                                                                                    |

## Data + persistence

- `league_teams_v1`, `league_matchups_v1`, `league_logs_v1`, `league_settings_v1`
- `league_undo_snapshot_v1`
- League stories are generated locally from standings facts. With `GEMINI_API_KEY` set, Gemini rewrites the same facts into prose; see [AI league story](#ai-league-story). No key is required for the app to work.
- One-time migration from older `league_*` keys
- CSV import/export with BOM/formula guard handling

## AI league story

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
(`unconfigured`, `rate-limited`, `upstream-error`, `no-model`,
`invalid-request`), and the UI keeps showing the deterministic story rather than
an error.

The League Story header says which state it is in, so a misconfiguration is
diagnosable at a glance instead of looking like "the AI just isn't running":

| Header shows                     | Meaning                                                       |
| -------------------------------- | ------------------------------------------------------------- |
| `AI` badge                       | Gemini wrote this. The tooltip names the model that answered. |
| `AI off — no API key`            | The function ran but `GEMINI_API_KEY` is not readable by it.  |
| `AI off — endpoint not deployed` | Nothing is serving `/api/league-summary`.                     |
| `AI limit reached`               | Gemini rate limit; try again shortly.                         |
| `No AI model available`          | The key listed no usable model.                               |
| `AI unavailable`                 | Something else upstream. The tooltip carries the message.     |

A **Retry** button re-requests it, and **Rewrite** asks for a fresh take on an
analysis that already succeeded. The endpoint is throttled per IP (best effort,
in-memory).

### Diagnosing it

`GET /api/league-summary` is a health check you can open in a browser — no
console needed:

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
| `?probe=1` → `ok: false`            | The key cannot list models: wrong key type, or API restrictions.                            |

Two Vercel behaviors cause most of the confusion: environment variables are
**scoped per environment** (a Production-only variable is invisible to preview
deploys), and a variable added after the last build **is not picked up until you
redeploy**.

The probe is rate limited like the summary endpoint and reports no secret
material.

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
