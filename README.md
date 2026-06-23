# League Forecast

A browser-only web app for league predictions, power ratings, matchup analysis, and forecast accuracy.

## Stack

- Vite 5.4 latest-line + React 18.3 + TypeScript 5.9
- Tailwind CSS 3.4 latest-line
- Web Worker-based Monte Carlo simulation
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
| **Standings**        | Records, cut-line status, SOS, trends, deterministic league story, weekly recap.       |
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
    insights.ts       # deterministic recap + league-story generation
    share.ts
    storage.ts
    backtest.ts
  hooks/
    useSimulationWorker.ts
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
- League stories are generated locally from standings facts; no API key or AI service is required.
- One-time migration from older `league_*` keys
- CSV import/export with BOM/formula guard handling

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

Vercel deploys the Vite app. CI runs lint, typecheck, tests, and build.
