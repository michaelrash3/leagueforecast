# Product improvement delivery plan

The approved roadmap is deliberately split into reviewable changes. This first change delivers
the performance foundation only; it does not introduce a persistence migration and it does not
change season, backup, cloud-copy, score-entry, or forecast behavior.

## Phase 1A — view delivery (this change)

- Lazy-load each populated League view behind one layout-stable loading panel and a view-level
  recovery boundary.
- Reuse each in-flight chunk request so hover, focus, idle prefetch, and navigation are idempotent.
- Prefetch only the likely next destination: Schedule after Dashboard and Forecast after
  Standings. Direct hover and keyboard focus warm the destination the user indicates.
- Emit a machine-readable `dist/bundle-report.json` and fail `npm run bundle:check` with the name
  of a regressed initial, critical, view, or CSS asset.

The empty-season setup remains eager because it is the first useful experience for a new browser.
Global state remains in `App`; lazy views continue receiving the same props.

### Measurements

Production builds were compared on the same checkout and Node environment. Raw and gzip sizes do
not include source maps.

| Asset                          |                     Before |                      After |
| ------------------------------ | -------------------------: | -------------------------: |
| Initial application JavaScript | 528.55 kB / 160.87 kB gzip |  240.73 kB / 79.28 kB gzip |
| CSS                            |   95.25 kB / 13.96 kB gzip |   95.25 kB / 13.96 kB gzip |
| Dashboard view                 |           in initial chunk |     5.96 kB / 1.76 kB gzip |
| Schedule view                  |           in initial chunk |    23.98 kB / 6.62 kB gzip |
| Forecast view                  |           in initial chunk |    38.99 kB / 7.97 kB gzip |
| Team Rankings view             | 389.37 kB / 115.09 kB gzip | 389.44 kB / 115.08 kB gzip |

The initial application chunk fell by 54.5% raw and 50.4% gzip. Runtime Web Vitals and interaction
latency require repeatable fixtures and browser instrumentation, so no runtime improvement is
claimed in this slice.

## Phase 1B — refresh domain foundation

- Persist versioned, per-source refresh state alongside the existing per-level completion log.
  Existing browsers and cloud copies therefore keep their current cadence and completion history;
  the detailed state begins empty rather than destructively rewriting the legacy log.
- Classify new and corrected finals, new and rescheduled fixtures, opponent changes, removals or
  cancellations, metadata changes, and protected manual-score conflicts with a pure comparison.
- Give refresh workers expiring ownership leases so overlapping attempts cannot both commit, and
  stable source/revision idempotency keys so retries identify the same import.
- Retry transient failures with a bounded one-to-sixteen-minute exponential backoff. Stop after
  five failures and do not automatically retry invalid, ineligible, unauthenticated, or conflicted
  sources.

This foundation deliberately does not start a browser or server scheduler yet. The next slice can
wire the state transitions into the existing cloud runner and import UI without inventing retry,
conflict, or concurrency rules inside components.

## Phase 2A / 3A — scenario persistence foundation

- Add a versioned, season-scoped scenario format with names, timestamps, selected outcomes,
  optional scores, and a source schedule fingerprint.
- Detect assumptions invalidated by completed, removed, or participant-changed games and provide a
  pure rebase that preserves unaffected picks while reporting every discarded assumption.
- Encode shared scenarios independently of season snapshots, reject invalid or oversized payloads,
  and leave applying an incoming scenario to the explicit preview UI that follows.

## Dependency-ordered continuation

1. **Refresh scheduling and status integration.** Connect the refresh domain to cloud-runner and
   manual-import completion, then surface last attempt/success, next eligibility, stale, offline,
   retry, and manual-action states. Add the server-side scheduled entry point only after the same
   idempotency and lease rules are enforced by its atomic store.
2. **Calculation dependency map.** Measure render and worker duration with fixed small, medium,
   and large seasons. Gate forecast-only hooks by active view and give worker jobs monotonic IDs so
   obsolete responses cannot win. Preserve header and team-drawer dependencies explicitly.
3. **Structured data quality.** Introduce versioned finding codes, severities, fingerprints, deep
   links, and dismissal recurrence. Start with existing duplicate/date/schedule checks, then add a
   dedicated lazy view and undo-backed repair previews.
4. **Mobile navigation.** Add the five-item primary navigation and accessible More menu while
   retaining the desktop tablist, roving tab index, URL/Back behavior, and warning visibility.
5. **Refresh UI and notifications.** Surface refresh states in Schedule and Import. Only after an
   explicit opt-in, request browser permission; persist subscriptions by device and batch events
   behind stable deduplication keys.
6. **Versioned scenarios.** Add migration, persistence, stale fingerprints, rebase, presets, and
   comparison before adding share previews and URL limits. A received scenario must remain a
   preview until explicitly applied.
7. **Structured explanations and game-day entry.** Return signed model factors and separately
   label probability, confidence, and uncertainty. Build the mobile score flow on existing undo
   and offline writes, with explicit manual/import conflict resolution.
8. **Competition formats.** Migrate old seasons to an explicit top-N format that is behaviorally
   identical before implementing divisions, pools, wild cards, reseeding, and double elimination.
9. **Measured large-list work.** Add fixed performance fixtures and browser metrics, then apply
   incremental rendering or virtualization only above demonstrated thresholds. Keep semantic,
   printable non-virtualized representations.

Each continuation step must independently pass format, lint, typecheck, unit, build, relevant
Playwright, compatibility, and new performance checks. Shared workspaces, calendar export, and
cross-season trend reporting remain outside this plan.
