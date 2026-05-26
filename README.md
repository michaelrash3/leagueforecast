# NKB Season Tracker

A browser-only web app for NKB standings, projections, and Gold Bracket odds.

## Stack

- Vite 5 + React 18 + TypeScript 5
- Tailwind CSS 3
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

Node `>=20` (see `.nvmrc`).

## Features

| Area | Highlights |
| --- | --- |
| **Standings** | Records, cut-line status, SOS, trends, weekly recap. |
| **Games** | R/H/K entry, predictions, final toggle, filters, auto re-projection. |
| **Season Predictor** | Forecast board, bubble watch, cut-line games, game forecasts, trend charts. |
| **Team drawer** | Team stats, path summary, magic/elimination numbers, swing games, compare view. |
| **Settings** | Season label, cutoff, points, tiebreaker, aggression. |
| **Power UX** | Command palette, shortcuts, dark mode, share URL, CSV import/export, undo, onboarding. |
| **Installable PWA** | Installable via `vite-plugin-pwa` (basic precache). |
| **A11y** | Dialog semantics, focus management, keyboard nav, labeled inputs. |
| **Perf** | Worker simulation, debounced updates, memoized lookups/scenarios. |

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
    insights.ts
    share.ts
    storage.ts
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

| Setting | Effect |
| --- | --- |
| Season label | Header/export label. |
| Gold cutoff | Number of teams in Gold Bracket. |
| Win / Tie points | Standings and math calculations. |
| Run-diff tiebreaker | Tie ordering behavior. |
| Model aggression | Prediction weighting profile. |

## Data + persistence

- `league_teams_v1`, `league_matchups_v1`, `league_logs_v1`, `league_settings_v1`
- `league_undo_snapshot_v1`
- One-time migration from older `league_*` keys
- CSV import/export with BOM/formula guard handling

## Performance notes

- Simulation and trend work run in `src/workers/sim.worker.ts`.
- Hooks debounce updates and cancel in-flight runs.
- Render lookups and scenario computations are memoized.

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

## Deploy

Vercel deploys the Vite app. CI runs lint, typecheck, tests, and build.
