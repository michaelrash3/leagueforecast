# Performance notes

_Part of the design documents; the map is in the repository's [README](../README.md)._

- **League Standings' views load on demand** (2.1, `src/components/league/leagueViews.ts`).
  Dashboard, Power Ratings, Schedule, Standings, League Stats, Forecast (with its
  playoff machine), Settings, the team drawer and the comparison it opens are chunks
  of their own; the first download carries the app's state and calculations, and a
  view's markup arrives when it is first shown. A view already loaded is drawn at
  once, with no placeholder, so going back to a tab never flickers; one still
  loading shows "Loading Forecast…" in its place, and a load that fails is that
  view's **Try again** or **Reload the page**, never a blank page. The team drawer
  and the comparison have a boundary each, so a failed download there is theirs
  alone: said over the page where the drawer would have been, with **Close** beside
  the two (Close takes the team out of the address, so a reload does not open it
  again), and the next opening asks afresh. Try again asks for the chunk afresh
  rather than repeating the failure React's `lazy` keeps for good, but a browser may
  keep a download that failed for the rest of the visit: Chromium 141, checked in
  the review of 2.1, answers the same chunk with the same failure without sending a
  request, a prefetch that failed offline included, and there only **Reload the
  page** fetches it again. A tab
  starts loading when it is pointed at or focused, and once a tab is drawn and the
  page has been idle 1.5 s, the tab most often opened next does too: the Schedule
  after the Dashboard, the Forecast after the Standings, and nothing else, so a
  phone on one bar fetches only what it is likely to show.
  - **Measured** (gzipped, level 9, `npm run bundle:check`): the first download
    went from 261.6 KB to 229.7 KB, and its entry chunk from 120.1 KB to 86.9 KB.
    Opening a view now adds 2.2 KB (League Stats) to 11.7 KB (Forecast);
    Team Rankings adds 138.9 KB, against 134.5 KB before, since code it shared
    with League's views is now its own chunk rather than in the first download,
    so a visit straight to Team Rankings fetches 368.6 KB rather than 396.1 KB.
  - **The bundle budget.** `scripts/bundleBudget.mjs`, run in CI after the build,
    holds the first download, the entry chunk, the stylesheet and each view's own
    load to limits about a tenth above these numbers (at least 1.5 KB for the
    small views), writes them to `dist/bundle-report.json`, and fails naming what
    grew. Source maps are built but never downloaded, so they are not counted.
  - **The numbers did not move.** `src/AppLeagueNumbers.test.tsx` pins what each
    tab shows on a fixed six-team season, the forecast seeded from the season;
    it was recorded before the split and matches after it.
- **One file for the logic the page loads at start** (`src/lib/bootChunk.ts`, the boot chunk in
  `vite.config.ts`). The bundler had cut the first download's logic into the entry chunk and 23
  files of the 55 modules it shares with views loaded later, every one fetched at start anyway,
  each compressed afresh and carrying its own imports and exports. Every logic module
  (`src/lib`, `src/styles`) that a chain of static imports from the entry reaches is now in one
  file, worked out from the build's own module graph rather than a list, so a module added later
  lands where it should. Components stay in the entry chunk, since a chunk takes the modules its
  own import along and a component there brought React's core out of React's own chunk. The first
  download went from 254.9 KB to 248.0 KB gzipped (247,951 bytes), Team Rankings from 166.2 to
  165.3 KB, with nothing removed and nothing fetched later. The cost is caching: a release that
  changes any logic module has a returning visitor fetch the whole 124 KB file again.
- **Team Rankings' sections load on demand** (`src/components/teamRankings/sections.ts`, through
  the views' own `viewChunk`). Opening Team Rankings fetched every section's code, the Import panel
  and the tidy it runs, Setup's cards and Pool health, the games list, the scouting report and its
  tournament panel, and the archive, though the page opens on the rankings and shows one section at
  a time. Now the rankings, and the state and handlers every section reads, come with the page, and
  a section's code when it is first opened, or a little before: when its tab is pointed at or
  focused, and, once the rankings are drawn and the page has been idle 1.5 s, the Games section's.
  A section still loading says so in its place ("Loading the archive…"), each in a boundary of its
  own, so nothing else is swapped for that line: not the rankings, and not the scouting report while
  the tournament panel below it loads, which says nothing as it does. A load that fails is the
  section's Try again, which fetches it afresh; the tournament panel, a chunk of its own, fails in a
  boundary of its own, so the report above it stays drawn. The tidy's stamp, which the page reads
  as it opens to decide whether a tidy is due, is a module of its own (`tidyStamp.ts`), as is the
  pool's packing for the tidy worker (`tidyWire.ts`), so opening the page fetches neither the tidy
  nor the inspection. The Import and Setup sections fetch the tidy's module (`gameChangerImport.ts`)
  as they open, worker or not, since they name its steps and read the pool through it; otherwise
  the page fetches the two only to run them itself, where it has no worker (`usePoolTidy`).
  - **Measured** (gzipped, `npm run bundle:check`, 31 October 2026): opening Team Rankings went from
    166.2 KB to 60.3 KB, with nothing removed. A section's own first open fetches Games 10.9 KB,
    Import 57.8, Scouting 7.4 and its tournament panel 3.6, Archive 2.3 and Setup 68.9, each held to
    a line of its own in the budget. The first download did not move.
  - **The cost**: the first open of each section after a release waits for its download, which on a
    slow connection is a moment of "Loading Setup…" until the service worker has stored the release.
  - **Guarded** by `src/components/teamRankings/sectionsLoad.test.tsx`: a tab pointed at or focused
    starts its section's load, the Games section's starts once the page is idle, a load that fails
    is that section's Try again and fetches afresh, and the scouting report stays on screen while
    the tournament panel's code loads and when it fails. In the built app,
    `e2e/teamRankingsSections.spec.ts` opens Team Rankings and finds none of its sections' code
    fetched (read off the source maps, by module), draws each section from its own, and has Setup's
    look at the pool answered by the tidy worker, with no page error and no worker failing.
- **Team Rankings' code leaves League Standings' first download.** A bundler puts a module whole
  wherever anything reaches it, and League Standings' start read a few lines from modules that were
  otherwise Team Rankings': the age a name states from the GameChanger client (`gameChangerApi.ts`),
  the bridge and a pick's helpers from the rating code (`teamRankings.ts`), the cleaning and keys of
  a name, what counts toward a rating, a saved board's row check, the board rules' version, a pull
  log's version, the refresh cadence, a kept season's reader, the stored "Not this team" list and a
  club's movement on its page. Each of those is now a module of its own (`gcAge.ts`,
  `gcFetchErrors.ts`, `teamRankings/leagueBridge.ts`, `live/views/rankingRow.ts`,
  `live/views/boardRules.ts`, `pullTrackerVersion.ts`, `refreshCadence.ts`, `archivedSeason.ts`,
  `notThisTeamStored.ts`, `movement.ts`), which the module it came from re-exports; `names.ts` and
  `games.ts` keep their start's part instead, and what only Team Rankings runs of them moved into
  `teamRankings/rosterNames.ts` and `teamRankings/gameRows.ts`, which `teamRankings.ts` re-exports
  beside them. The modules the start loads, and League Standings' own views, import the new ones.
  A pull's tracker is made by the pull and handed to the pool's slot with its claim (`beginPull`),
  so the slot, which League Standings reads, stays one module and the tracker leaves it; the claim
  will not compile without one, so no pull is claimed without its log. Some of Team Rankings' code
  is still there: the readers the pool's store and its backup check what they keep with, which
  load with the store (`teamRankingsStorage.ts`).
  - **Measured** (gzipped, `npm run bundle:check`, 31 October 2026): the first download went from
    251.8 KB to 221.2 KB, with nothing removed and nothing computed differently. What left is
    fetched where it runs: opening Team Rankings went from 60.3 KB to 84.1 KB, and the Import and
    Setup sections, which pull and tidy, from 57.8 to 67.7 KB and from 68.9 to 75.9 KB. A first
    visit straight to Team Rankings fetches 305.3 KB, against 418.0 KB before either change.
  - **The numbers did not move.** `src/lib/__tests__/bootSplitPins.test.ts`, written before
    anything moved, pins what one pool works out (the bridge's results, the forecast reading them,
    a board, a matchup, ages, names, which games count and the tidy's stamp), and it holds with the
    board, rating, forecast and parity pins already in the suite; every moved declaration is the
    same text it was, an `export` added where its old module reads it back.
  - **Guarded** by the bundle check, which reads the build's source maps and fails naming any of
    the modules left holding only Team Rankings' code (`TEAM_RANKINGS_ONLY` in
    `scripts/bundleBudget.mjs`) that the first download holds again, since one static import from
    anything the page loads at start would bring a whole module back and the first download's own
    line has room to hide it. The list holds the two modules that left with them too
    (`ratingRecency.ts`, `teamNameRules.ts`), and the tidy (`gameChangerImport.ts`), which the
    first download never held and which on its own is about that room, 35.0 KB against 33.8.
- **League Standings works out only what is on screen** (2.2). Every number it
  shows is read from the games marked final, so its calculations are keyed on
  those scores alone (`finalLogsOf`, held by `useSeasonState`), which stay the same
  object while a score is typed into a game still being played: a keystroke there
  works nothing out again, and the season is worked out once, when the game is
  marked final. What one tab alone shows waits for that tab: the model's backtest
  (Dashboard and Forecast) and the season timeline, the bubble and the games that
  matter most (Forecast), joining the clinch paths, seed ranges, scenario impacts,
  game forecasts and bracket odds that already did. The backtest and the timeline,
  each of which refits the season once per game played, remember their last answer
  (`rememberLast`), so a tab opened again on an unchanged season costs nothing.
  Worker results were already safe from going stale: each job carries an id and
  the key of its input, and an answer for an older one is dropped
  (`useWorkerJob`).
  - **Measured** (`npm run score:bench` on the built app, CPU slowed four times at
    phone width, the old and new builds run back to back): on a twelve-team season
    with 54 games left, a key in a score box took a median 416 ms to show (p90
    520 ms) and now takes 24 ms (p90 32 ms); after marking a game final the page
    was busy for 566 ms and is now busy for 167 ms. On an eight-team season with 12
    left, keys went from 64 ms to 16 ms and the time busy after a final from 167 ms
    to none at all over 50 ms. **The cost:** the first Forecast opened after new
    finals now works out its timeline and backtest then, 2.4 s against 1.7 s on the
    twelve-team season (unchanged on the eight-team one); opened again, it is 1.0 s
    as before.
  - **The numbers did not move.** The pin above holds a half-scored game that is
    not final; it matched before the change and after it.
  - **Guarded** by `src/AppOnScreen.test.tsx`, which counts the calculations
    themselves: none while a score is typed, no backtest, timeline or bubble when a
    game is marked final on the Schedule, and each once when its tab opens, not
    again on a second visit.
- Simulation and trend work run in `src/workers/sim.worker.ts`.
- The rankings worker keeps one decoded pool and the page names it by revision.
  The pool crosses to it only when the pool itself changes, in the compact form
  IndexedDB stores, and a page switch, a half of the year or a different "my
  team" ships nothing at all. Measured on a 40,000-team, 400,000-game pool, the
  copy every request used to carry was 125 MB on the wire and about 3.3 s of
  serialising and deserialising; the compact shipment is 33 MB and about 0.7 s,
  and it happens once per change rather than once per fit. The tidy worker takes
  the pool the same way and hands back only the parts it changed, so a tidy that
  found nothing to do no longer re-saves the whole pool.
- Team Rankings opens on the board it last showed (`savedBoard.ts`), marked
  "Refitting…" until the open's own fit lands, which replaces it. One board is
  kept, on the device, under a key of its own in the pool's IndexedDB store that
  is not a pool key, so it never travels to the cloud copy and goes with a
  reset; it is shown only on the page, half and "my team" it was fitted for. A
  kept board whose rows lack any field a row carries, or hold one of the wrong
  type, is dropped rather than drawn. On the 114,500-team pool of 29 September
  2026 the rows came up at 3.9 s rather than 7.8 s, and the fresh board landed
  when it always had.
- A member who turns on the cloud's board ("The live board on a member's
  device") sees its rows before the pool is read. On the 29 September 2026
  backup (116,485 teams), 12U 2027, the medians of five runs, each in a fresh
  browser, were:

  |                                                       | 4× CPU, phone screen | 1× CPU, desktop |
  | ----------------------------------------------------- | -------------------- | --------------- |
  | Live off: the saved board                             | 18.8 s               | 3.77 s          |
  | Live, board read from the network (150 ms round trip) | 7.3 s                | 2.14 s          |
  | Live, board kept on the device                        | 6.6 s                | 1.91 s          |
  | Team Rankings' own fit lands, Live off / on           | 28.0 / 28.7 s        | 7.9 / 9.5 s     |
  - **The run.** The build is served by `vite preview`. The boards were
    published from the backup by the nightly's own code into files a
    scratch-only version of the reader served after the round trip, standing
    in for a signed-in member. Firestore and the sign-in were not in the run;
    the startup wait for the cloud copy is on both sides and was left out.
  - **The board.** 12U 2027's board is 3.39 MB of JSON, 646 KB gzipped, one
    piece. All 33 boards are 3.4 MB gzipped with a 7 KB meta, built in 11.5 s.
  - **What the board still waits for.** Of the phone's 6.6 s, 5.4 s is the
    main thread reading the pool from IndexedDB before the app mounts, which
    the board does not need.
  - **What comes after.** Team Rankings mounts once the board hands over, and
    its first render is one long task of up to 10.6 s on the phone (2.2 s on
    the desktop), against 5.2 s (1.1 s) after the saved board, whose wait
    comes before its rows instead. Its own fit lands about as late as without
    Live, once the board has handed over to it.

- Every page of a squad year is fitted over the same games, so the rankings
  worker fits a year once and cuts each page from that fit, keyed on the pool,
  its pages, the half, the day and the age groups (not on which team is yours).
  The page hands the worker the year's games as the same array for every page of
  the year, so a switch from 9U to 10U ships nothing. On the 18:40 pool a switch
  went from about 5 s in the worker to about 55 ms, with every page's rows the
  same to the digit. The fit itself solves over flat arrays rather than Maps:
  the 9U 2027 fit went from about 4.0 s to 2.3 s with the same bits.
- The collapse of league games and their pulled copies keys only rows between
  clubs a league row names; on the 18:40 pool it went from about 1.1 s to 30 ms
  with no league laid over it, and dropped the same rows with one.
- **Cleaned names are remembered.** Every pass that compares two clubs' names
  cleans each to its key first (`teamNameKey`: the age label, the asides and the
  punctuation off, several regular expressions a name), and the League pass, the
  bridge to League Standings and the tidy clean the same names on every pass and
  every open. The key is now remembered by name (`rememberUpTo`), up to half a
  million names, past which all are let go and it starts again. And the link
  between the two halves (`linkLeagueTeams`), which runs for every League
  Standings season, keeps the roster's clubs by id and each page's places in a
  year's games against the arrays it is handed, where it walked the whole roster
  and the whole year each time. An array can stand for what it holds because the
  app replaces a roster or a list of games when it changes and never edits one in
  place: the import's fold edits only its own copies, and hands them on once it
  has finished with them.
  - **Measured** on the seeded full-size pool (`scripts/poolFixture.ts` at 12,000
    clubs a page: 121,204 clubs, 344,553 games), in Node, the median of three runs
    each taken in turn with the code before: the League pass over the three squad
    years (`deriveAllKnown`) went from 2.8 s to 2.1 s the first time and from
    2.6 s to 1.6 s asked again; the bridge for the three seasons
    (`leagueScoutBridge`) from 2.7 s to 1.0 s, and from 2.6 s to 1.1 s; the tidy
    from 8.7 s to 7.1 s at 40,404 clubs and from 28.9 s to 26.1 s at full size. A
    full-size tidy asks for 2,465,586 keys of 101,384 names, which hold about
    5 MB; the roster's index holds about 12 MB and a year's games' 2 MB, as long
    as their arrays are held.
  - **The answers did not move.** `rememberedNames.test.ts` pins the League pass,
    the bridge (asked twice) and the tidy on the seeded fixture, and the keys of
    its 3,034 names, each recorded before the change; every full-size answer
    above hashed the same before and after.
  - **Guarded** there too: a roster or a list of games that replaces another is
    read afresh, and a season two pages claim gets its games in the list's
    order; `rememberUpTo.test.ts` holds the memo to its bound.
- The Monte Carlo loop copies the league once per simulated season and writes
  results onto that copy, rather than copying every team per game; on twelve
  teams and sixty games that took 220 seasons from 195 ms to 7 ms. It stops
  once every team's odds are known to two points by the same Wilson interval
  shown beside them, with a ceiling of 4,000 seasons, and the ± on screen is
  computed from the seasons actually played.
- Each simulated game draws its winner at the model's chance and its margin from
  a normal curve around the predicted margin, held to the winner's side of level,
  8.0 runs wide for kid pitch and 6.7 for machine and coach pitch (the odds
  curve's spread read as a normal curve); a league that has had ties draws them
  at its own share, read as though ten games without one came first
  (`drawMargin`). Before, every game was booked at the predicted score, so an
  upset was always won by a run and run differential split two teams level on
  points the same way in every season. On made-up leagues forecast part way and
  scored against how each really finished, the Gold odds' log loss came out lower
  in six of nine settings, level in two, and higher in one, a small league far
  apart in strength whose games varied much less than the pool's do; drawing each
  team's strength once a season as well counted the ratings' uncertainty twice
  and made the odds too shy, so it is not done.
- Hooks debounce updates and cancel in-flight runs. A run is keyed on the counts,
  the seed (every final score), the settings and each team's opponent-adjusted
  rating as a value, so linking a club or a pull in Team Rankings re-simulates the
  Gold %, champion odds and bracket, while typing into a game still in progress
  does not. Each point of Gold Odds Over Recent Games carries the rating as of its
  own last game, with the outside results played by then, and the last point is
  rated exactly as the Gold % column is, so the line ends where the column stands.
- Render lookups and scenario computations are memoized.
- Simulation/projection apply evolving in-iteration team state for deterministic, non-stale forecasts.
- Worker + inline fallback paths emit lightweight runtime timing debug logs (`[sim-worker]` / `[sim-inline]`).
