# League Forecast

A browser-first web app for league predictions, power ratings, matchup analysis, and forecast accuracy. The app works out everything in the browser and keeps its data there; signed in to the owner's list, a browser also keeps one cloud copy in Firestore, so every device opens on the same data ([Your data on every device](docs/data/every-device.md)). Firebase functions write the AI league story, pull GameChanger schedules and run the cloud copy's jobs.

## Stack

- Vite 8 + React 19 + TypeScript 6
- Tailwind CSS 4 (configured in CSS; there is no tailwind.config.js)
- Web Worker-based Monte Carlo simulation
- Firebase HTTP functions for the AI league story (`server/league-summary.ts`, Gemini then Groq)
  and GameChanger pulls (`server/gc-team.ts`); Vercel serves the static website
- Vitest, with coverage reported on every pull request and held to the thresholds in
  `vite.config.ts`
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

See [Team Rankings](docs/team-rankings/README.md#team-rankings) below for how the two connect.

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

| Area                      | Highlights                                                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Standings**             | Records, cut-line status, SOS, trends, AI league analysis or deterministic story.                                                                                                                 |
| **Games**                 | Score entry, predictions, final toggle, filters, auto re-projection, fill from a pull, a league site's schedule pasted in.                                                                        |
| **Data Quality**          | Findings on the season's games, teams and settings, grouped by severity, with links to each, previewed repairs and undo.                                                                          |
| **Since you last looked** | What another device changed since this one last looked, on the Dashboard until seen; a card of what moved for the followed team since the last visit; opt-in notifications while the app is open. |
| **Season Predictor**      | Forecast board, bubble watch, cut-line games, game forecasts, trend charts.                                                                                                                       |
| **Team drawer**           | Team stats, seed range, magic/elimination numbers, swing games, compare view.                                                                                                                     |
| **Our team**              | The team this browser follows leads the Dashboard: place, record, Gold % and its last move, next game and seeds, magic number, a jump to enter a score.                                           |
| **Settings**              | Season label, cutoff, points, tiebreaker, recap grouping, aggression.                                                                                                                             |
| **Power UX**              | Shortcuts, dark mode, share URL, CSV import/export, undo, onboarding.                                                                                                                             |
| **Installable PWA**       | Installable via `vite-plugin-pwa` (basic precache).                                                                                                                                               |
| **A11y**                  | Dialog semantics, focus management, keyboard nav, labeled inputs.                                                                                                                                 |
| **Perf**                  | Worker simulation, debounced updates, memoized lookups/scenarios.                                                                                                                                 |
| **Team Rankings**         | A page per age level, national top 25 and state top 10, cross-age ratings, scouting report with next-game projections, CSV/paste import, team detail.                                             |
| **GameChanger**           | Pull a team list's schedules, resumable, on a weekly rota; pairings proposed for approval.                                                                                                        |

## Architecture

A map rather than a manifest — the directories and the files worth knowing about, not every file.

```
server/
  league-summary.ts     # Firebase handler: AI recap of standings movement (Gemini, then Groq)
  gc-team.ts            # Firebase handler: GameChanger pull
scripts/
  poolFixture.ts        # a seeded pool of a real pool's shape, for the live views' tests and timings
  modelSweep.ts         # research: the shipped model's forecasts scored, settings moved, stand-ins
  recencySweep.ts       # research: which recency scheme predicts best on a real pool
  sweepTidy.ts          # the pool it fits: a backup through the device's tidy, vouched clubs spared
  verify-gc-pull.ts     # the one check that talks to GameChanger for real
src/
  App.tsx               # League Standings: its state, the hooks below, and every view it renders
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
    geminiModels.ts  leagueSummary.ts  leagueSummaryClient.ts  leagueSummaryHealth.ts
    scheduleText.ts        # reads pasted text / CSV into games, entirely on the device
    leagueScheduleText.ts  # the same for a league's own schedule, home and away kept
    teamRankings.ts        # age groups, ratings, name matching, rename/merge
    teamRankings/leagueBridge.ts  # which club each League team is, and what results it is handed
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
  hooks/                # worker lifecycles, routing, shortcuts, theme, toasts; and the sections of
                        # the three largest components, one hook each, called where their code was:
                        # App's (the odds, the race, game forecasts and edits, Data Quality, the
                        # season builder, saves, links, the story, our team, the drawer's team),
                        # Team Rankings' (team edits, pool answers, Find a team, games by hand,
                        # starting over, the week, What if) and the GameChanger panel's (useGc*)
  workers/
    sim.worker.ts  rankings.worker.ts  tidy.worker.ts
    rankingsProtocol.ts  tidyProtocol.ts  # what crosses to each worker; pure, so tested
    tidyWire.ts            # the pool packed for the tidy worker, apart from the tidy itself
  components/
    viewChunk.ts        # a view or section loaded on demand
    league/             # League Standings views: standings, games, forecast, settings
    teamRankings/       # Team Rankings sections and cards; sections.ts loads each on demand
    bracket/  charts/
    ShortcutsHelp.tsx  OnboardingTour.tsx  Toast.tsx
    GameChangerImportPanel.tsx  ScheduleImportPanel.tsx  TeamDetailPanel.tsx
  styles/
    tokens.ts  raceTone.ts
```

## Design documents

How each part works and why, measured where a number is claimed, one document per area. Read the
one for whatever you touch; each keeps the headings it had here, so a reference to a section by its
heading finds it in the document listed for it.

- **Team Rankings** ([docs/team-rankings/](docs/team-rankings/README.md)): [age groups](docs/team-rankings/age-groups.md);
  [a page per age level](docs/team-rankings/pages.md); [the scouting report](docs/team-rankings/scouting.md);
  [how the two modes connect](docs/team-rankings/two-modes.md); [placeholders](docs/team-rankings/placeholders.md),
  the stand-ins and slots and the tidy that joins them; [what a pull left behind](docs/team-rankings/pool-health.md);
  [names, the Games tab and importing](docs/team-rankings/names-games-importing.md);
  [pulling from GameChanger](docs/team-rankings/pulling.md); [states, and the ratings a forecast reads](docs/team-rankings/ratings.md),
  with **The model, measured**.
- **League Standings** ([docs/league-standings.md](docs/league-standings.md)): the postseason format, the
  playoff machine and saved scenarios, why the forecast says what it does, our team, games in
  playing order, a season's team list and a pasted schedule, seasons at a glance, archiving, Data
  Quality, Since you last looked, and Settings.
- **Data + persistence** ([docs/data/](docs/data/README.md)): [on the device](docs/data/on-the-device.md),
  the pool's store and backups; [your data on every device](docs/data/every-device.md);
  [pulls in the cloud and on GitHub](docs/data/cloud-pulls.md); [the nightly, and the boards published after pulls and edits](docs/data/nightly.md),
  with **When a run fails**; [boards and views a server builds](docs/data/views.md);
  [the live board on a member's device](docs/data/live-board.md); [rebuilds after saves, League Standings in the cloud, and edits as commands](docs/data/cloud-league-and-edits.md).
- [AI write-ups](docs/ai-write-ups.md), [Performance notes](docs/performance.md),
  [Accessibility and design](docs/accessibility-and-design.md) (with the design system and the
  platform baseline), and [Deploy](docs/deploy.md).
- Plans and checks of their own, as before: [circular-schedule deduction](docs/circular-schedule-deduction.md),
  [fewer stand-ins](docs/fewer-stand-ins-plan.md), [verifying the GameChanger pull](docs/verifying-the-gamechanger-pull.md).

# Reliability checks

- Backtesting harness (`src/lib/backtest.ts`) reports calibration buckets, Brier score, and upset capture rate using finalized historical games.
- Storage/share decoding and settings coercion are defensive against corrupted payloads and out-of-range values.

# Keyboard shortcuts

- `?` — Shortcuts help
- `d` — Dark mode
- `Esc` — Close modal/drawer

The ⌘K command palette and the two-key `g` jumps were taken out in October 2026: the tabs do the
same job, and on the cloud board, where Team Rankings is read, neither ever worked.
