# Plan: fewer stand-ins — connect the clubs GameChanger already has

## Context

Team Rankings holds far too many stand-ins (`nameOnly` teams: an opponent a schedule named that is
tied to no GameChanger id). The user's example: **Cincy Stix 9U Navy** (Harrison, OH) beat
**Hurricanes** (also OH) 13-2 on 20 Sep 2026. The Stix typed "Hurricanes"; the Hurricanes typed
"Stix". Both clubs are on GameChanger.

What the research found (reproduced in tests against the real import + tidy):

| Case | What happens today | Why |
|---|---|---|
| A–C: no other OH "Hurricanes" at 9U | Linked correctly | Name/state/fixture rules suffice |
| **D**: another OH "Hurricanes" 9U pulled first | Stix's win filed on the **wrong club**; real Hurricanes' half left on a "Stix" stand-in | `reclaimMisfiled` only trusts a row naming the puller exactly |
| **E**: namesake exists + coaches typed different start times | **Both halves on stand-ins**, no game between the clubs | No step ever compares two stand-in rows; import's fixture tests demand equal times |
| Cross-state neighbours (Cincinnati–NKY, KC, St. Louis…) | Same as E | "Same state" is the only proximity test |
| **F**: GameChanger page names no age | Club refused outright; every game other clubs filed against it is a stand-in forever | 36,194 teams on the no-age list; the pooled-opponents rung matches by picture, which the import's own measurement says never repeats (7,948 of 7,948 distinct) |

Also: `unpulledClubs.ts` says "all but a few hundred" of ~40k stand-ins were absent from the pulled
list — but `listCoverage` measured that by **exact** `teamNameKey` equality, so "Stix" never matched
"Cincy Stix Navy". The true reachable share is unknown and likely much larger.

## Part 1 — join the two halves of one game (DONE in this branch)

Already written and passing (23 tests; 13 of 14 guards verified by breaking them):

- `src/lib/stateBorders.ts` (new): land-border table, `inOneRegion(a, b)` = same state, bordering, or unknown.
- `src/lib/teamRankings/names.ts`: `nameFitsWithin(a, b)` — every word of the shorter name is in the
  longer (drops "baseball/club/bc/bbc/the/team", bare numbers, "Headlines1"→"headlines").
- `src/lib/gameChangerImport.ts`:
  - `joinCrossedHalves` — new tidy step "joined", after "named". Joins row X (club A vs stand-in S) and
    row Y (club B vs stand-in T) when: same squad year and day; results mirror (or, unscored, same
    start time); S fits B and T fits A; A, B in one region; levels within `PLAYS_UP_TO`; unique from
    **both** ends (clock breaks ties). Keeps X, records B in `alsoFrom`, drops emptied stand-ins. (Case E.)
  - `reclaimMisfiled.holds` — also accepts the real club's own row against a stand-in whose name fits
    the puller, in region, with mirrored result (or same start time). (Case D.)
  - `TIDY_RULES_VERSION` 5→6 so every existing pool is re-tidied once on next open.
- Wiring: `TIDY_STEPS`, `PoolTidy.joined`, `describeTidy`, `TidyProgressView` label, `pullTracker` log line;
  test pins updated (`poolSignature` r6, `tidyProtocol` step list).

Remaining for Part 1:
1. Add the missing guard: two candidate halves **at the same start time** must not join (the
   "first of several taken" break currently fails no test). Verify by breaking it.
1b. **Headlines1 / Headlines2** (the Hurricanes' labels for two different Headlines clubs, each with its
   own GameChanger id): `nameFitsWithin` reads both as "Headlines", so the name can't tell them apart
   and must not try. The fixture does: the Oct 2 5:30 PM row can only join the Headlines club whose own
   schedule holds that game, and the Oct 9 7:15 PM row the one holding that one; if both squads fit one
   fixture, nothing is joined. Add a test: one schedule with "Headlines1" and "Headlines2" on two dates,
   two pulled Headlines clubs (e.g. "Headlines 9U Nagel" and a second squad) each holding one of the
   games → each row joins its own club, never the other. Break-check: point both rows at one club.
   Standing rule, written into the `nameFitsWithin` comment: the loose name fit is only ever the name
   half of a fixture test, never an identity on its own (Part 3's name-only rules keep `teamNameKey`,
   where "headlines1" ≠ "headlines2").
2. README: update the "Identity is asymmetric" table and "The tidy runs by itself" paragraph.
3. Full gate, commit (prose message: what, why, what proves it), push `rash/festive-gauss-m1cnhr`,
   draft PR, subscribe to it.

## Part 2 — age a no-age team from the games the pool already holds (biggest lever)

A refused no-age team's opponents usually **are** in the pool, holding the other half of each game
against a stand-in for it. Use the same fixture test as Part 1 to identify those opponents, then read
their age.

- New rung `ageFromFixtures(schedule, index)` in `gameChangerImport.ts`, after `ageFromPooledOpponents`
  (line ~1534). For each of the team's dated games: find pool rows that day, in the squad year its
  season gives (`squadYearForGcSeason`), where a pulled club C filed from its own schedule against a
  stand-in whose name fits this team, C's name fits the opponent typed here, result mirrored (or same
  start time), `inOneRegion`, exactly one match. Each C is an opponent identified by fixture; its level
  comes from `index.levelsByTeam` (skip clubs seen at two levels).
- Decide like `ageFromPooledOpponents`: ≥ `MIN_OPPONENT_AGE_EVIDENCE` distinct identified opponents,
  clear majority, ties refused. Whether 2 fixture-identified opponents are enough is decided by Part 3's
  measurement, not assumed.
- Index: add a stand-in word index (`standInsByWord`, keyed by pool + word) maintained in `indexGame`,
  so candidates come from the rarest word of the team's name rather than a scan; reuse `gamesByTeamDate`.
- Report it as `ageFromFixtures` on `GcImportOutcome`, as the other rungs are.
- Already-refused teams get it on their next weekly re-ask (`agelessQueue`), no migration needed; once
  filed, Part 1's tidy joins their games and the stand-ins disappear.
- Tests: an Ohio "Hurricanes" with no GameChanger age and three pulled 9U opponents holding the other
  halves → filed at 9U, games joined; guards for mismatched results, out-of-region, split levels, two
  fixtures fitting one game.

## Part 3 — measure on the real pool, then widen "same state" to "same region"

The pool backup is hundreds of MB and can't leave the user's machine, so this is a script the user runs.

- `scripts/standInSweep.ts` + `npm run standins:sweep -- <League_Forecast_Backup_*.json>`, loading the
  backup exactly as `scripts/agelessSweep.ts` does (`parseTeamRankingsJson`). Prints:
  1. Stand-ins and results they hold, before and after `tidyPool` with Parts 1–2.
  2. What is left, by cause: a pulled club fits by name in region (matching gap); a no-age list entry
     fits (Part 2 reach); nothing fits (never pulled — needs an id).
  3. Precision of the region widening, using Part 1's fixture joins as ground truth: would "one club of
     that name in the puller's state, else exactly one in a bordering state" have picked the same club?
  4. `listCoverage` re-measured with `nameFitsWithin` instead of exact names.
- Only if bordering-state precision matches the ~9-in-10 the code cites for same-state: add a bordering
  tier to `refileStandIns` (none in state → exactly one in bordering states; town tiebreak kept) and use
  `inOneRegion` in `resolveOpponent`'s lone-namesake check. Keep one stand-in per state (prevents knots).
  Bump `TIDY_RULES_VERSION` again.

## Part 4 — needs GameChanger reachable from the session (research only)

Blocked here by the environment's network policy (`api.team-manager.gc.com`, `web.gc.com` → 403 at the
proxy). With those hosts allowed: check whether a schedule payload links an opponent the coach selected
from GameChanger search, and whether a public team search exists. Either would let the never-pulled
remainder be found automatically instead of by hand.

## Critical files

- `src/lib/gameChangerImport.ts` — `joinCrossedHalves`, `reclaimMisfiled`, tidy wiring; Part 2 rung + index
- `src/lib/stateBorders.ts` (new), `src/lib/teamRankings/names.ts` (`nameFitsWithin`)
- `src/lib/__tests__/crossedHalves.test.ts` (new); `gameChangerImport.test.ts`, `src/workers/tidyProtocol.test.ts`
- `src/components/teamRankings/TidyProgressView.tsx`, `src/lib/pullTracker.ts`, `README.md`
- Part 3: `scripts/standInSweep.ts`, `package.json`, `src/lib/unpulledClubs.ts` (`listCoverage`)

## Verification

- `npx vitest run src/lib/__tests__/crossedHalves.test.ts`, then the full gate:
  `npm run format:check && npm run lint && npm run typecheck && npm run test:coverage && npm run build`,
  then `npm run test:e2e`.
- Every new guard verified by breaking the line it guards and watching its test fail.
- In the app after deploy: opening it re-tidies once (rules v6); the tidy grid's new **Join** column
  shows how many games were joined; Pool Health's stand-in count drops; the Stix's 20 Sep game reads
  "vs Hurricanes" with both clubs linked.
- Part 3: the user runs `npm run standins:sweep` on a backup and shares the printed summary.
