# NKB Season Tracker

Single-page web app that tracks team standings, projections, and Gold Bracket odds for the NKB season. All data lives in the browser via `localStorage` — no backend.

## Stack

- Vite 5 + React 18 + TypeScript 5
- Tailwind CSS 3
- Web Worker for Monte Carlo simulation (off the main thread)
- Vitest for unit tests on pure helpers
- ESLint (`@typescript-eslint`, `react`, `react-hooks`, `jsx-a11y`) + Prettier

## Commands

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production bundle to dist/
npm run preview    # serve the production bundle
npm test           # vitest in watch mode
npm test -- --run  # one-shot for CI
npm run typecheck  # tsc -b without emit
npm run lint       # ESLint over src/
npm run format     # Prettier over src/
```

Node `>=20`; the repo pins to `.nvmrc`.

## Features

| Area | Highlights |
| --- | --- |
| **Standings** | Live record + diff + Gold % + status; sortable cut-line tracking; SOS rank; sparkline trend per team; weekly recap card with copy-to-clipboard. |
| **Games** | Per-game R/H/K entry, prediction strip, swap/delete/final toggle, scoreboard filter, automatic standings/odds re-projection. |
| **Projection** | Forecast Board (Now / Projected / Range / Projected Record / Gold Odds / Run Diff / TPI), Games-That-Matter-Most, Bubble Watch, Projected Cut-Line Games, full Game Forecasts with confidence/upset risk, **Race-to-the-Cut-Line** line chart over recent games. |
| **What-If Lab** | Toggle each remaining game's winner between Away / Model / Home and watch standings, projected ranks, and Gold % update live (worker-driven). |
| **Team drawer** | Per-team stats + path summary (plain English), magic / elimination numbers, full Gold-odds line chart, next-two swing games, clinch scenarios, **Compare** button opens a side-by-side compare drawer with head-to-head, common opponents, win/loss/runs/TPI tile-by-tile. |
| **Settings** | Season label, Gold cutoff, win/tie points, run-diff tiebreaker, score cap, model aggression (Conservative / Balanced / Aggressive) — all wired into `calculateTeams`, `predictGame`, `applyResult`, `rankTeams`. |
| **Power UX** | ⌘K / Ctrl-K command palette (jump to team/view, share, export, theme), `?` shortcuts help, `g s/g g/g m/g w/g t` view jumps, `d` theme toggle, dark mode, shareable URL (state encoded in the hash), CSV import/export with formula-injection guards + BOM strip, undo toasts on destructive actions, 4-step onboarding tour. |
| **A11y** | Modals (TeamDrawer, CompareDrawer, CommandPalette, ShortcutsHelp) are `role="dialog" aria-modal="true"` with focus trap + Escape + body scroll lock + focus restore. Tabs are `role="tablist"` with arrow-key nav. Inputs have programmatic labels. |
| **Perf** | Monte Carlo simulator + trend states run in a Web Worker (`src/workers/sim.worker.ts`) with debounce + cancellation; standings render via `Map<id, T>` lookups (no `.find` in render loops); per-team scenarios memoized. |

## Architecture

```
src/
  App.tsx                       # main component + view partials (Standings/Games/Model/What-If/Settings)
  main.tsx                      # React root
  index.css                     # Tailwind directives
  lib/
    types.ts                    # shared types + defaults (DEFAULT_SETTINGS, MODEL_AGGRESSION)
    util.ts                     # clamp, parseNumber, isFinal, blankLog
    format.ts                   # displayName, teamAbbr, recordText, buildTeamFormats
    date.ts                     # normalizeDateInput, parseDateValue, formatGameDate(Long)
    csv.ts                      # parseCSVLine, csvEscape (formula-injection guard), stripBom
    sim.ts                      # calculateTeams, predictGame, applyResult, projectStandings,
                                # rankTeams, simulateGoldOdds, standingsPoints, getMathGoldStatus
    scenario.ts                 # what-if overlay -> projected standings / odds (reuses sim.ts)
    magic.ts                    # magic / elimination numbers per team for Gold
    insights.ts                 # pathSummary, weeklyRecap, recapToMarkdown, summarizeStandings
    share.ts                    # encode/decode snapshot in URL hash (base64), build share URL
    storage.ts                  # versioned localStorage loaders/writers w/ schema guards
  hooks/
    useSimulationWorker.ts      # debounced odds + trend hooks, inline fallback when Worker unavailable
    useToast.ts                 # tiny toast hook (info/success/error/undo)
    useDarkMode.ts              # persisted theme, respects prefers-color-scheme
    useShortcuts.ts             # generic keydown router incl. chord combos ("g s")
    useFocusTrap.ts             # focus trap + Escape helpers shared by modals
    useBreakpoint.ts            # matchMedia hook
    useUrlState.ts              # reads / clears the shared-snapshot URL hash
  workers/
    sim.worker.ts               # Monte Carlo worker, posts odds + trend results
  components/
    Toast.tsx                   # toast renderer
    WhatIfLab.tsx               # remaining-games overrides + live standings panel
    CompareDrawer.tsx           # side-by-side team comparison drawer
    WeeklyRecap.tsx             # recap card with copy-to-clipboard
    CommandPalette.tsx          # ⌘K-driven palette over teams/views/actions
    ShortcutsHelp.tsx           # ? modal listing shortcuts
    OnboardingTour.tsx          # 4-step first-run coachmark sequence
    charts/
      LineChart.tsx             # shared SVG line chart (used by Gold-odds + Race-to-Cut-Line)
      RaceToCutLine.tsx         # rank-over-time line chart with cut-line band
      HeadToHeadMatrix.tsx      # color-coded W/L/T grid (available, not yet surfaced)
  styles/tokens.ts              # pill/card/tab/button class helpers
```

## Settings (all wired into the model)

| Setting              | Effect                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------- |
| Season label         | Displayed in header + filename for CSV/JSON exports                                     |
| Gold cutoff          | Top-N teams qualify for Gold Bracket; drives all "in / out" math                         |
| Win / Tie points     | Used in `standingsPoints`, max-points math, clinch/elimination calculations             |
| Run-diff tiebreaker  | When off, ranking falls straight from win% to TPI                                       |
| Max score cap        | Clamp applied inside `predictGame` before rounding                                      |
| Model aggression     | Scales the TPI and momentum weights in `predictGame` (Conservative 0.6× / Balanced 1.0× / Aggressive 1.4×) |

## Data + persistence

- `league_teams_v1`, `league_matchups_v1`, `league_logs_v1`, `league_settings_v1` — versioned localStorage keys with schema validation on read and quota handling on write.
- `league_undo_snapshot_v1` — last destructive-action snapshot powering the in-app Undo toast (reset, CSV import, delete game).
- First load migrates the older unsuffixed `league_*` keys, then removes them.
- CSV import/export uses a 13-column schedule format (Game ID, Date, Away/Home Team + Innings + R/H/K + BIP). Imports strip BOM and the spreadsheet formula-injection prefix; exports re-add the guard.

## Performance notes

- `simulateGoldOdds` and the trend states run in `src/workers/sim.worker.ts` via `useSimulationOdds` / `useSimulationTrend`. Both hooks debounce (200–250 ms), cancel in-flight runs when inputs change, and fall back to inline sim when `Worker` is unavailable (tests, SSR).
- All `.find` lookups in render loops were replaced with `Map<string, T>` built once per `useMemo`. Per-team scenario seeds, control-level, and game-impact computations are memoized into `Map`s.

## Keyboard shortcuts

- `⌘K` / `Ctrl-K` — Command palette
- `?` (shift `/`) — Shortcuts help
- `g s` / `g g` / `g m` / `g w` / `g t` — Jump to Standings / Games / Projection / What-If / Settings
- `d` — Toggle dark mode
- `Esc` — Close any modal / drawer / palette

## Accessibility

- `TeamDrawer` is `role="dialog" aria-modal="true"` with focus trap, Escape to close, body scroll lock, and focus restore on close.
- Header tabs use `role="tablist"` / `role="tab"` with left/right arrow-key navigation and `aria-controls`.
- Every input has a programmatic label (`<label htmlFor>` or `aria-label`). Score inputs are `inputMode="numeric"` with `maxLength={2}`.
- Standings rows are keyboard-activatable (Enter / Space).

## Deploy

Vercel infers Vite via `vercel.json`. CI (`.github/workflows/ci.yml`) runs `lint → typecheck → test → build` on push and PR.
