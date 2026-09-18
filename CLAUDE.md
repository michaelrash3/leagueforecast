# League Forecast

Browser-first youth-baseball app: League Standings (one league's season, standings and a Monte
Carlo forecast) and Team Rankings (a nationwide pool pulled from GameChanger, rated with a
ridge-regularised least-squares fit). React 19, Vite, TypeScript strict, Tailwind 4, Vitest.
Everything lives in the browser (localStorage and IndexedDB); two Vercel functions in `api/`.
`README.md` is the design document; read the section for whatever you touch.

## Commands

The gate CI runs, in this order, and what a change must pass before it is pushed:

```sh
npm run format:check && npm run lint && npm run typecheck && npm run test:coverage && npm run build
```

- One test file: `npx vitest run src/lib/__tests__/sim.test.ts`
- End to end (needs a build first): `npm run build && npm run test:e2e`
- Format everything: `npm run format`

Tests are two Vitest projects: `*.test.ts` run in Node, `*.test.tsx` in jsdom.

## Layout

- `src/lib/` pure logic. `sim.ts` the forecast, `teamRankings.ts` the rating, `teamRankingsCompact.ts`
  the storage codec and the readers of a stored pool, `teamRankingsStorage.ts` the cache in front
  of IndexedDB, `ratingRecency.ts` how old games are weighed.
- `src/workers/` one file per worker plus a pure `*Protocol.ts` beside it holding what crosses the
  port and what the worker does with it; the protocol is what gets tested.
- `src/hooks/` worker lifecycles and app state slices. `src/components/` the views, split into
  `league/` and `teamRankings/`.
- `scripts/` research tools, run with Node's type stripping (`npm run recency:sweep`).

## Conventions

- Pin, then change. Before touching a numeric path, snapshot its output in a test; the change must
  match to the digit unless it is meant to move the number, and then the commit says so.
- A new guard test is verified by breaking the code it guards and watching it fail.
- Identity, not digests, for "did the input change": arrays are new exactly when the data is.
- No `any`, no `@ts-ignore`, no `TODO`; `noUncheckedIndexedAccess` is on.
- Comments explain why, in prose, and say what was measured when a number is claimed.
- Commit messages are prose paragraphs: what changed, why, and what proves it.

## On Claude Code on the web

`.claude/hooks/session-start.sh` installs dependencies. A Chromium for Playwright is preinstalled
at `$PLAYWRIGHT_BROWSERS_PATH`; never run `playwright install` here. `curl -I` against the deployed
site returns 403 through the proxy, so response headers cannot be checked from the container.
