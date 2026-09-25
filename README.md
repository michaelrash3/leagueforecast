# League Forecast

A browser-first web app for league predictions, power ratings, matchup analysis, and forecast accuracy. All league data stays in the browser; the only server-side piece is one optional serverless function that writes the AI league story.

## Stack

- Vite 8 + React 19 + TypeScript 6
- Tailwind CSS 4 (configured in CSS; there is no tailwind.config.js)
- Web Worker-based Monte Carlo simulation
- Two Vercel Serverless Functions: `api/league-summary.ts` for the Gemini-written league story,
  `api/gc-team.ts` for the GameChanger pull
- Vitest, with coverage reported (not enforced) on every pull request
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

See [Team Rankings](#team-rankings) below for how the two connect.

## Features

| Area                 | Highlights                                                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Standings**        | Records, cut-line status, SOS, trends, AI league analysis or deterministic story.                                                                     |
| **Games**            | Score entry, predictions, final toggle, filters, auto re-projection, fill from a pull.                                                                |
| **Season Predictor** | Forecast board, bubble watch, cut-line games, game forecasts, trend charts.                                                                           |
| **Team drawer**      | Team stats, path summary, magic/elimination numbers, swing games, compare view.                                                                       |
| **Settings**         | Season label, cutoff, points, tiebreaker, recap grouping, aggression.                                                                                 |
| **Power UX**         | Command palette, shortcuts, dark mode, share URL, CSV import/export, undo, onboarding.                                                                |
| **Installable PWA**  | Installable via `vite-plugin-pwa` (basic precache).                                                                                                   |
| **A11y**             | Dialog semantics, focus management, keyboard nav, labeled inputs.                                                                                     |
| **Perf**             | Worker simulation, debounced updates, memoized lookups/scenarios.                                                                                     |
| **Team Rankings**    | A page per age level, national top 25 and state top 10, cross-age ratings, scouting report with next-game projections, CSV/paste import, team detail. |
| **GameChanger**      | Pull a team list's schedules, resumable, on a weekly rota; pairings proposed for approval.                                                            |

## Architecture

A map rather than a manifest — the directories and the files worth knowing about, not every file.

```
api/
  league-summary.ts     # Vercel function: Gemini recap of standings movement
  gc-team.ts            # Vercel function: CORS proxy for the GameChanger pull
scripts/
  recencySweep.ts       # research: which recency scheme predicts best on a real pool
  verify-gc-pull.ts     # the one check that talks to GameChanger for real
src/
  App.tsx               # League Standings: state, handlers and every view it renders
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
    geminiModels.ts  leagueSummary.ts  leagueSummaryClient.ts
    scheduleText.ts        # reads pasted text / CSV into games, entirely on the device
    teamRankings.ts        # age groups, ratings, name matching, rename/merge
    teamRankingsStorage.ts # the pool's IndexedDB store, with a synchronous cache in front
    teamRankingsCompact.ts # the tuple-and-dictionary storage format
    gameChanger*.ts        # pulling, importing, reporting and tracking a pull
    apiShared.ts           # handler types, client key and throttle, shared by both functions
    storage.ts  idb.ts  backup.ts  share.ts
  hooks/                # worker lifecycles, routing, shortcuts, theme, toasts
  workers/
    sim.worker.ts  rankings.worker.ts  tidy.worker.ts
    rankingsProtocol.ts  tidyProtocol.ts  # what crosses to each worker; pure, so tested
  components/
    league/             # League Standings views: standings, games, forecast, settings
    teamRankings/       # Team Rankings sections and cards
    bracket/  charts/
    CommandPalette.tsx  ShortcutsHelp.tsx  OnboardingTour.tsx  Toast.tsx
    GameChangerImportPanel.tsx  ScheduleImportPanel.tsx  TeamDetailPanel.tsx
  styles/
    tokens.ts  raceTone.ts
```

## Team Rankings

A separate ranking pool for teams from anywhere: tournament opponents, another
league, a club you are about to play. Only scores are entered — there are no box
scores here — and every team is rated against every other by the same
opponent-adjusted model the league uses.

### Age groups

A GameChanger pull creates the pages it needs: every team says which age level
and season it belongs to, and each schedule is filed under the page for that
squad year, made on the spot if it is not there. Setting one up by hand is for a
league tracked without GameChanger — and nothing can be logged by hand until an
age group exists, because every game has to know which ranking it belongs to.

What a pull cannot work out is which page **your own** league season belongs on:
nothing in a GameChanger schedule mentions your league. So Setup asks that
directly — "what age does this League Standings season play?" — one row per
season, and answering makes the page if the pull has not already. A season moves
off whatever page held it before, since one league season is played at one age
and leaving it on two would count its games twice.

#### Which age a team is

Five things can say, and they are asked in this order. `ageLevelOf` in
`gameChangerApi.ts` is the whole of it, and the profile normalizer and the list-row
reader both call it, so a row and the team it names can never read as two different
ages.

| Where it is written                                                  | Example                     | Read as                                |
| -------------------------------------------------------------------- | --------------------------- | -------------------------------------- |
| **A bracket in the name**                                            | "Premier Ohio Lopez 9U/10U" | the older end — 10U                    |
| The age field — GameChanger's `age_group`, or a pasted list's column | "9U", "12UA", "11U/12U"     | that label, a bracket at its older end |
| A graduating class in the age field                                  | "2029" in squad year 2027   | 16U                                    |
| A single age label in the name                                       | "Trash Pandas 9u"           | 9U                                     |
| A graduating class in the name                                       | "Midwest Nationals 2030"    | 15U, two years out or further          |

The bracket sits above the age field, which is the one place the name outranks a
stated age. The field holds one value picked from a dropdown when the team was
created, and a club running a 9U/10U squad routinely picks the younger of the two —
so the two are not so much in conflict as one being half of the other. Filed at the
younger end, every game the squad plays in its own bracket reads as playing up, and
the rating hands it an advantage it never earned. The name is also the measured
better witness here: of the 343 teams where a pasted list and GameChanger disagreed
about the age by one, 267 had the list's level in the team's own name (the table
under **Check the id**).

A person outranks all five. A level named by hand stands in until GameChanger's own
answer _changes_ — see **Naming an age**.

#### High school squads are left out

A varsity or JV side plays other varsity and JV sides. Its whole schedule is the
school season, so its results join almost nothing else in the pool — and a
least-squares rating across a cluster that barely touches the rest is not so much
wrong as meaningless: the numbers inside it are relative to each other and to
nothing else. Filing one at 18U would put that cluster in the 18U table next to
travel clubs and invite exactly the comparison the data cannot carry. So the whole
category is refused.

Refused on the name, the way wiffle ball and blitzball are, which means the same
three things: the rows never cost a request out of a pasted list, the import turns
the schedule away with the reason `high-school`, and a tidy pass deletes any that
reached the pool before the rule existed. Nothing has to remember an id — the name
refuses it again every export, including ids never seen before.

| In the name or the age field                     | Read as                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| `Varsity`, `JV`, `Junior Varsity`                | high school, always                                                 |
| `JV/V`                                           | high school — the JV says the lone `V` beside it is varsity         |
| `HS`, `High School`, with no age label           | high school                                                         |
| `HS` with an age label — "Lincoln HS 16U"        | **kept**: a summer squad playing an age bracket against travel ball |
| A lone `V` on its own — "Madison V"              | neither; it goes to the review card, below                          |
| Any of the above under 14U — "Varsity Elite 12U" | **kept**: a travel club that likes the word                         |

Three edges are deliberate. A squad word wins over an age label, because a side
calling itself varsity is playing the school season whatever else it writes; the
letters have to be their own word, so "CHS Cardinals" is a club, not a school; and
one thing outranks both, which is an age nobody in high school could be playing at.
A freshman is fourteen at the youngest, so "Varsity Elite 12U" and "JV Sluggers 10U"
are travel clubs that like the words. That floor matters more than it looks: a
wrongly refused club leaves nothing behind to notice it by — no row, no count against
its name, nothing — so the rule errs towards keeping whenever the age contradicts it.

Their games go with them, and one of those losses is real: a travel side that
played the local varsity loses that result. It goes because the other half of it is
a club the pool refuses, and a game with one side missing is a dangling row rather
than a result. Carrying the handful that cross the line would mean carrying the
cluster they lead into, which is the thing this rule exists to avoid.

A team below the youngest level ranked here, or one GameChanger gives no age
for, is skipped rather than filed: a nationwide list carries thousands of 6U and
7U squads whose results say more about which league plays coach pitch than about
any team. The list drops them before the pull so their schedules are never even
fetched, and the import skips any that get that far. **Each level has its own table and only lists teams
of that level** — a 9U team never appears on the 11U ranking. What a season year
shares is the _fit_, not the table, so that a 9U who plays up in a tournament
still counts for both sides: see [Playing up and down](#playing-up-and-down).

An age group is an **age level** (8U-18U) and a **year** (2027 on), zero or more
League Standings seasons that belong to it, and optionally the age group it
**continues from**. Both are dropdowns, so the label is always "10U 2028" and
never two spellings of the same season. Groups created before the picker existed
keep the name they were typed with; editing one reads the age and year back out
of that name where it can.

| Concept               | What it does                                                                                                                                                                                                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Assigned seasons      | Those seasons' whole schedules fold in. Put a Fall and a Spring season at the same age when both are the same squad-year.                                                                                                                                                              |
| Advance to new season | Creates next year's group from this one — a year older, a year later (9U 2027 → 10U 2028), already continuing from it, already carrying "our team". Seasons are not copied: next year's don't exist yet. 18U stays 18U while the year moves, since a player can spend two years there. |
| `continuesFromId`     | Last year's version of this squad. Its opponents keep appearing in the name dropdown as the squad ages up. **Only names travel across years** — a 10U group that continues from a 9U one starts at zero games. Levels within one season year do pool; across years they never do.      |
| `myTeamId`            | "Our" team, per age group, so a club running a 9U and an 11U at once has one of each. Never touches the rating math.                                                                                                                                                                   |

Two age groups running at the same time and not linked share no names, which is
what stops a 9U opponent appearing while logging an 11U game.

### A page per age level

The season year is a picker and the levels below it are tabs: pick 2028, then
move along 9U, 10U, 11U. Changing the year holds the level where the new year has
one, so walking a squad forward is one control rather than two.

Each page is a URL — `?view=rankings&age=10&year=2028` — so a page can be sent to
somebody rather than described to them. The URL is what decides the open page,
which is what makes Back and Forward move between them. A link naming only a year
opens that year's youngest page; only a level opens it in whichever year has it;
a link to a page that no longer exists leaves the view where it is and the URL is
corrected rather than obeyed. `?view=` carries the mode too, so a link opens in
Team Rankings instead of wherever that browser happened to be last.

A page leads with a **national top 25** and a **state top 10**, the state being
yours where it is known and otherwise whichever has the most teams there. The
place shown in each is the place in _that_ list: a state top ten is ten teams
rated against the whole country and then listed together, so the second-best team
in the state is #2. The full table is behind a toggle, for finding one particular
team in a pool of thousands.

### Scouting report

Pick a team and it answers two questions. **Next up** is the games still on that
team's schedule — a pulled GameChanger schedule carries its future fixtures with
no score, so they are already in the pool and nothing has to be typed — each with
the date, the opponent's rank, the projected margin and a win probability. An
opponent nobody has pulled has no rating, and the row says "not rated here yet"
rather than inventing one. Below it, the same projection against every ranked
team on the page, which is the question to ask before entering a tournament.

The projection is the rating difference, capped at 14 runs, put through a
logistic curve; no home-field term, because at this level which side is "home" is
a coin flip.

**What if?** Under each fixture is the question the projection cannot answer: not
who is favoured on Saturday, but where Saturday leaves you. A rating here is not a
property of a club — it is the solution of one least-squares fit over every counted
game in the pool — so the answer is the whole table fitted again with the result in
it. The panel shows a rung per whole run, from a defeat by eight to a win by eight,
each with the place it would leave you and how far that moved you.

It is a margin table rather than two buttons because the margin is the larger half of
the answer: winning by one against winning by eight moves a club further than winning
against losing at the projected margin. Eight is the top rung because `RATING_CAP` is
eight, so a 9-1 and a 20-0 are the same evidence.

Two fits are enough for all sixteen rungs. The fit is least squares and the cap is
applied before it, so within ±8 runs every fitted rating is affine in the margin
assumed; the shown rating is that less an evidence discount whose only
margin-sensitive term is the pool's residual scale, which one game out of thousands
moves by a rounding error. Swept against a real re-fit at every margin over pools of
12 to 6,000 clubs, the rank was right in every case and the worst rating error was
7.4e-3 runs, on the smallest pool.

Nothing in the panel is coloured by outcome. Winning is not always good news and
losing is not always bad: a narrow loss to a much stronger club can lift a thinly
played side, because the table rates who you played and one more game is one more
thing the rating stands on. Measured on a 40-club pool, a side with three games that
loses by two to the best club in it goes from #31 to #27.

The hypothetical is fitted as if the game were played today. That is deliberate and
the alternative is worse: older games count for less, so a result dated weeks ahead
arrives as the newest thing in the pool and outweighs the season that has actually
happened. A fixture in the other half of the year, one with no date on a half board,
and one against a club nobody has rated are all refused rather than answered — the
first two would move a table they do not belong to, and the third would add a row to
the table instead of moving one within it.

### How the two modes connect

**League → Team Rankings, always.** A season assigned to an age group brings its
whole schedule: upcoming games show their opponent right away, and once a game is
scored in League Standings it counts as a final here too.

**Team Rankings → League, by choice.** Tournament results sharpen that league's
_opponent-adjusted power ratings_, the matchup analysis built on them, and —
through those ratings — the Forecast board's game picks, the simulated season,
playoff odds and the bracket. See the `useScoutResults` setting. They help most where a
schedule is thin: two teams who never met become comparable through an opponent
they both played elsewhere. Records, standings, elo, recent form and strength of
schedule stay league-only. Games carried in from the league are excluded on the
way back, so nothing is counted twice.

**Which club is which, answered once.** The two halves keep separate ids for the
same club and rarely agree on how long a name is — a league roster saying "Trash
Pandas" against a GameChanger team called "Trash Pandas Baseball Club". Matching
on the name alone was a guess that failed silently: that club's tournament
results were filed under an opponent of their own, where they sharpened nothing,
and nothing anywhere said so.

**Which Team Rankings club is each team?**, in Settings, asks once and keeps the
answer. It offers the clubs that could be this team, ordered by how many of that
team's own league opponents they have also played, since a schedule is far harder
to coincide with than a name: "Trash Pandas Baseball Club — Hebron, KY · 2
opponents in common: Bears, Cougars". Each row says where it stands — a **Guess**
matched on the name and is not confirmed, **Which one?** means two clubs share
the name and neither has played anyone you play, **Not here** is an answer rather
than a gap, and **Clash** means two teams picked one club so neither counts.

The same evidence settles the guess: where two clubs share a name, the one that
has played the clubs you play is taken, and where that is not decisive the panel
says so rather than crediting both clubs' games to whichever came first. The
header counts what is linked and how many outside results are counting, so a
league that is contributing nothing cannot look like one that is.

A pick is stored on the league team, so it rides that season's backup, duplicate
and undo. Share links deliberately leave it out: a pool id is minted in the
browser that made it and means nothing in anyone else's.

**Team Rankings → League scores, on request.** Once a club pulls its own
GameChanger team, every result of its league season is already in the pool, and
typing those scores a second time into the league schedule is work the app can
do. **Fill scores from Team Rankings**, on Games, offers them.

It matches a league game to a pool result on the two teams and the day —
the league stores a date as month and day, so that is the common ground — within
the age groups that claim this season. It fills runs, and only runs, which is
everything the standings, the records and the projections are built from.

Nothing is written before the review is read, and three rules keep a wrong score
out of a table nobody can check:

| Case                                 | What happens                                                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| The league game is blank             | Filled, and marked final. Ticked by default.                                                               |
| The two spell a club differently     | Offered as **Check name**, with both spellings shown. Never applied unasked.                               |
| A different score is already entered | Shown side by side and left alone unless that row is chosen by name.                                       |
| A pairing plays twice on one day     | Paired in schedule order when both sides have the same number of games; otherwise reported, never guessed. |

The league and GameChanger rarely agree on how long a club's name is — "Trash
Pandas" against "Trash Pandas Baseball Club" — and a league game left unmatched
looks exactly like one that has not been played, which is what makes silence
here dangerous. So a game the names missed gets a second look against the
results on its own day, under the looser rule the importer already uses, and
anything that lines up is offered rather than applied. Correcting the name in
Team Rankings makes it match on its own from then on. Two clubs close enough to
be confused with each other on the same day are reported instead: "South
Lexington Red" and "…Blue" are four characters apart and are two real teams.

Games the league itself put into the pool are excluded on the way back, so a
season can never confirm its own scores. Anything already typed into a game —
hits, strikeouts, the innings it was stored with — survives the fill untouched.

**One fixture, one game.** A club that tracks a league here and also pulls the
GameChanger team playing in it has the same fixture twice over: once derived
from the league schedule, once pulled. The pool counts it once, preferring the
league's own record where the league has scored it, so a rating never counts a
game twice. The day is what decides this — the same two clubs meeting on another
date played outside league play, and that game stands on its own. Results
carried back into the league's own forecasts skip its fixtures for the same
reason.

### Placeholders

"TBD", "Winner of Game 3", a blank cell on a bracket: a schedule says these when
nobody has decided who is playing yet. They are kept as **slots**, not teams.

The game is real, so it is kept and it counts for the club that played it — a
slot stands in the fit as one unknown opponent, and beating one reads much like
beating an ordinary team. What a slot never does is gather. Every placeholder is
its own slot, because a single shared "TBD" would sit in the rating graph as an
opponent that dozens of unrelated clubs had all played, and the model would read
that as evidence about how they compare to each other. Slots are not ranked,
never offered as a name to log a game against, and never matched to a real club
that looks similar.

**One fixture listed twice on a club's own schedule.** GameChanger does this: the
same game arrives under two game ids, with the opponent spelled two ways —
"Cincinnati Angels Red" and "Cincinnati Angels- Red", 13-21 on both — and a club's
record counted the loss twice. The opponent resolves to one team either way, since
`teamNameKey` reads punctuation between words as spacing; it was the two rows that
stayed two games.

Two ids off one schedule are normally two games, and that stays the rule. A real
pull found four games against one club on a single day, and folding those together
would delete three results. The exception is narrow and rests on a fact rather than
a guess: **nobody plays two games at once**, so where both rows carry a start time
and it is the same one, there is only one fixture there. "The same one" means under
a minute apart: 1,013 rows of the pool of 24 September 2026 started at an odd second
or millisecond, and 12 pairs off one schedule were a fraction of a second apart.

The same fact settles it when the two rows disagree about the score. Two different
results at one start time is a disagreement about one game, not two games — keeping
both counted a loss and a win for a game played once. The game keeps the score the row
it stands on gives, and the other listing's is written into the game's note, the way the
two sides of a fixture that disagree are already noted, so nothing is lost silently.
Where the row the game stands on has no score, the other listing's fills it, marked as
that listing's (`scoreFromTwin`): it goes with the listing if the two turn out to be two
games, and gives way the moment the game's own row posts. Kept as the game's own, a
listing's score stayed behind when a doubleheader first listed at one placeholder start
came apart, and the result counted twice.

Within the hour, one schedule's two rows are one game only when they give the same
result. A coach writes a doubleheader down at its slot times, and the same pool held
109 pairs of rows exactly an hour apart with two different results — 23-6 and 12-2 —
that are plainly two games. A repeated result is different: of 212 scored pairs off
one schedule within the hour, 34 gave the same result (16%), against 81 of 6,044
pairs two hours or more apart (1.3%), which are doubleheaders. That is the same game
listed twice.

Where a start time is missing from either row the two are kept, however alike they
look — with nothing to tell a repeated fixture from a repeated row, losing a real
game is the worse error.

An all-day entry counts as having no start time. GameChanger writes a start for one
anyway, midnight UTC with no timezone in the entries audited on 24 September 2026,
and read as a time it made every all-day game on a date the same instant. Its date
is kept and the placeholder is not.

**One game on two clubs' schedules.** A start on a schedule is when the game was
planned. A tournament runs behind and neither coach moves the placeholder, so the two
clubs' copies of one game drift apart: Legacy Baseball Club had its 14-2 win over
River City Raptors on 29 August 2026 at 1:00 PM, the Raptors had it at 2:00 PM, and the pool
held it twice, because two starts used to mean two games whoever wrote them down. On
the pool of 24 September 2026, 1,213 pairs of rows off two schedules gave the same pair
the same result on the same day at different starts; the same search a week off, where
no game is, found 7.

So a row off the other club's schedule can be the same game on any of these, strongest
first:

| Two clubs' copies of a day's meeting                           | One game?                                   |
| -------------------------------------------------------------- | ------------------------------------------- |
| Starting within the hour, with the same result                 | Yes — 1,115 of the 1,213 were within it     |
| The same result, however far apart the clocks                  | Yes, the nearer the likelier                |
| At the very same start, a result still to come on one side     | Yes                                         |
| Starting within the hour, a result still to come on one side   | Yes, the nearer the likelier                |
| No start on one side                                           | Yes, a copy with a result first             |
| Starting within the hour, scored differently                   | Yes, each club keeping its own score        |
| Neither, with one game left on each schedule that day          | Yes, scored differently, as it always was   |
| Neither, with more on one schedule than the other accounts for | No — that is a game only one of them listed |

**A day is read whole.** Which copy each game takes is decided for the whole day at once
rather than a link at a time (`planDay`): every way of pairing the two schedules' games is
weighed, and the one that best accounts for both schedules together wins. The strongest
single link first used to lose a result wherever it was the wrong link for the day — three
review rounds found one shape after another — and each rule added to rank one link over
another moved the loss to another shape. The weighing:

- **Both schedules' games in both schedules' order.** A coach lists the games in the order
  they were played, whatever the clock says, so first pairs with first. Legacy posts game 1
  of a doubleheader as an 8-11 loss and the Raptors post game 2 as an 11-8 win an hour
  later: the Raptors' copy belongs to game 2, not to game 1 because the score repeats. And a
  clock exactly an hour out all day pairs 9:00 with 10:00 and 10:00 with 11:00, rather than
  the two 10:00 rows. Rows with no start fit wherever they fit best.
- **A result that agrees outranks a copy with nothing in it, however near.** Taken for a
  blank game beside it, a copy's result counts twice until the other game is posted, and for
  good if that game was a slot never played. On the pool of 24 September 2026 a 9U club with
  four games was charged one 9-12 loss twice that way. Taken for the game it repeats, the
  worst is a result missing until it is posted, and once both clubs have scored everything,
  the same result within the hour puts each copy where it belongs.
- **A scorekeepers' dispute is worth little** — two different results within the hour are
  one game when nothing else explains them, but never at the cost of a result that agrees —
  **except at the very same start**, where two scores within four runs of each other are one
  game ahead of a blank copy elsewhere. Of the 131 games two schedules scored differently in
  the pool of 24 September 2026, 94 were a single run apart and 117 within four. A wider
  dispute is still one game where nothing reads better — mostly one entry's slip, a 13-6
  win entered from the wrong seat or 20 typed for 11 — but it is worth no more than the
  least of disputes, so a 4-4 at the same start as a 0-10 does not outbid a clock an hour
  out.
- **A result is never lent to a blank game while a scored game it could be, at least as
  near, is left with no copy of its own** — one with the same result, or within four runs:
  it would count twice. A 4-4 at 10:00 against the other club's 5-4 at 10:00 once went to an
  all-day blank on one schedule and stood as two games; where the nearer game has a copy of
  its own, as in a doubleheader whose clocks sit an hour apart, the result is the blank
  game's to take.
- **One schedule repeating a result within the hour is that schedule listing the game
  twice** — worth less than any pairing of those rows with the other club's copies, so it
  is read that way only where the other club does not list a game for each. A mercy-rule
  doubleheader, 10-0 twice, stays two games wherever the other club lists both slots,
  posted or not, timed or all day. A game listed twice is as near the other club's copy as
  the nearer of its two rows.
- **Two copies that contradict are never one game** by any link. The day's leftovers are
  still settled by count: one game left on each schedule, both scored, is one game two
  coaches scored differently.
- **The same rows read the same way whatever order they were pulled in.** A copy is read
  by its scored rows and the best of them, and every choice between readings falls to the
  rows' ids, never to their place in the pool: a fuzz of 2,000 days found 50 that read
  differently when only the order of their rows changed, until that was so.

Each schedule's rows at one start are one game before any of this (nobody plays two games
at once). Days with a row that no schedule stands behind, such as a game typed in by hand,
or with three schedules, are few (one in the pool) and are still settled a link at a time,
with the same guard against contradicting copies. A game takes one row off each schedule,
and two games that each hold a row off both schedules stay two unless the rows share a
start.

**A fold is never final.** A game keeps every row folded into it whole — the schedule,
the row's id, its start and its score from its own seat (`alsoRows`) — and every tidy
stands those rows back up beside the games still standing and groups the day again from
scratch. So a fold made on one day's schedules answers to the next day's: a copy that
went to the wrong game of a doubleheader on a tie moves when a score says which it was,
two games listed at one placeholder slot come apart when the schedule moves one, and a
row that fits nothing now stands up as a game under its own id — filed under its own
club's page, by the level it played at, so a cross-age game's copy stood back up is
where a refresh of that page alone finds it by id. (One row filed twice — under one id,
or under a game's id and the id of a row it took over — is kept once: the copy against a
real club over a stand-in, then the one holding folded rows, with the newest score either
copy carries. The tidy used to fold both away, and then to keep the stale copy's.) A re-pull finds its row
by id, updates the record and leaves the grouping to the tidy; a row the schedule no
longer lists — deleted, cancelled, moved to another day — has its record removed on that
schedule's next pull. The same regrouping run twice changes nothing, which is what lets
the tidy stop: on the pool of 24 September 2026 a second tidy over the first one's
result, saved and read back, finds nothing to do. A tidy that only moves a row from one
game to another, or takes back a score whose row has gone, counts as a change
(`regrouped`), so the pull that ran it saves it rather than stamping the pool tidied with
the fix left in memory. Records written before rows were kept say only the schedule
(`alsoFrom`), and there a row is taken back only within the hour and agreeing — the
folded row coming back, which 21 of the 23 results listed twice that way in the same pool
were — or at the game's very start whatever it says, which is how an earlier join left two
coaches' different scores at one start.

A start the schedule itself has since moved is taken on the next pull; another
schedule's start is never written over a row, nor fills a row that has none, since that
is the other coach's clock — an all-day 5-3 win given the Raptors' 2:00 PM start sat at the
very start of Legacy's own 2:00 PM game, and the next tidy read the two as one listed twice.
A game whose own row the schedule deleted, entered again under a new id, stands on the new
row from then on — its result, its start, set or cleared, and the pulls after it — so a
correction to the new row reaches the game, and one entered again all day is not split
from the row it replaced. A club's second listing of a game its first row leaves blank
gives the game its score, corrections included, marked as the listing's. Deleting a game
that took over a row remembers both the row and the game's id, from Pool Health's
dated-ahead list and from deleting a club alike. On the pool of 24 September 2026 the tidy
folds 2,779 rows this way and settles 7 slots: 6 whose starts were a fraction of a second
apart, and a stand-in copy of a 3-2 win that had two games of that score to choose from
until one was seen to hold the club's own row already. Legacy's page reads six games
again.

**Each club keeps its own score.** The Dragons' schedule says they beat the Hens 11-8;
the Hens' says they lost 8-10; it is one game, listed on both at 10am. The game used to
carry one score, whichever schedule had been pulled last, so the Hens' page could show
the Dragons' version of the Hens' own game, and the score flipped as the daily refresh
went round. Two schedules disagreed about 13,865 games in the pool of 24 September 2026,
563 of them about who won.

Side A of a pulled game is always the club whose schedule it came off — every one of
the pool's 248,371 games — and its score is side A's own. Side B's own schedule's score
now sits beside it (`reportedByB`) instead of over it, and fills it only where side A
has posted nothing yet — marked as borrowed (`scoreFromB`), so it goes if side B's row
moves to another game and gives way the moment side A posts its own. Each club's page
and record read its own schedule
(`scoreSeenBy`); the rating reads the game once, at the average of the two margins
(`ratedMargin`), so the Dragons are rated 2.5 runs better that day and a game both clubs
claim to have won reads as even. A score typed in by hand answers for both clubs and
clears the other schedule's, and the record of side B's row takes the typed score from
that club's seat, or the next tidy would stand the row up and put its old score back.
Every other way a pull fills side A's blank from side B's schedule — settling a "TBD"
into a named game, joining two clubs that each filed the game against a stand-in — marks
the score borrowed the same way.

On that pool the first tidy gives 1,501 folded games both scores, 131 of them different
and 13 disagreeing about the winner, and 160 a score borrowed from side B; the rest fill
in as each club is refreshed. Every
2027 rating moves a little, since every game is fitted together, and none by more than
0.57 of a run.

Most slots name themselves. A bracket posts "TBD" on one team's schedule and
the real fixture on the other's, so pulling both sides answers the question:
after a run, a slot whose fixture another schedule named is folded into that
named row — one fixture, one game, both sides real. The named row wins because
a schedule that names a club is saying who turned up, and a score it had not
posted yet is taken from the slot's row.

That only happens where it is certain. The naming row has to come from another
club's schedule, since a team listing both a placeholder and a named opponent
on one day is playing two games and neither names the other — and nor can a game that
already holds a row off the slot's own schedule, other than the slot row itself (a
refresh of one page files again a row the pool holds folded into a game on another page,
and that copy settles back), unless at the same start: one schedule
lists a game once, and a row settled there was one the regroup stood back up against the
named club, a result filed against a club that never played it. Where both rows
give a start time they have to agree on it, which is what tells the halves of a
doubleheader apart. A day with two clubs that could both be the answer is left
alone.

Anything still unnamed is the ordinary rename: open the slot, type the club's
real name, and the game moves there — merging into that club if it is already in
the pool.

### What a pull left behind, and what to check

A run over thousands of teams always leaves some behind, and a count hides it.
**Worth a look** lists every one, in three kinds:

| Kind             | What it means                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Not reached**  | The schedule never arrived — no such team, a refusal, a timeout, the proxy not deployed. Often worth another try. |
| **Not filed**    | It arrived with nowhere to go: no age group, no season, or a level below the youngest ranked here.                |
| **Check the id** | It arrived and was filed, but it is not the team the list named.                                                  |

That last one exists because a twelve-character id is unreadable, so a wrong one
is invisible: the pull fetches whatever the id really is, files it under its own
name, and says nothing. The list already carries what each team was meant to be,
and the profile carries what it turned out to be, so the two are compared.

Which comparisons are worth making was measured on a real pull of 40,760 teams
where both sides described the same teams. The rule for each is whatever fires
on something worth seeing without burying it:

| Compared                        | Disagreed   | Kept                                                                                                                   |
| ------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| Name shares no significant word | 1           | yes — and that one was "SWS" for "South Wake Storm"                                                                    |
| Season                          | 0           | yes — free, and it catches an id reused for last year's squad                                                          |
| State                           | 174 (0.43%) | yes                                                                                                                    |
| Age level, by two or more       | 31 (0.08%)  | yes                                                                                                                    |
| Age level, by one               | 343 (0.84%) | **no** — in 267 the team's own _name_ held the list's level, so it is GameChanger's age group that wanders, not the id |

A name spelled two ways is never reported: "Trash Pandas" and "Trash Pandas
Baseball Club" share two real words, and only a name with nothing in common is
a different club. Nothing is corrected and nothing is held back — the schedule
is filed either way, since the profile is the better authority on a team asked
for by id. On that pull, 206 rows of 40,760 were flagged, one of them loudly.

Each row gives the team id, the name where anything knew one, the reason in a
few words, the sentence the failing layer wrote, and a link to the team on
GameChanger. **Download the list** writes the lot as a CSV, because a few
hundred rows is spreadsheet work rather than something to scroll on a phone —
the panel draws the first two hundred and the file has them all.

### Names

Age levels are stripped everywhere: "South Lexington Red 9u" is stored as "South
Lexington Red". The age level is already carried by the age group, and keeping it
in the name would split one club into a new team every year as it plays up. A
bracket comes off as one thing, separator included — "Premier Ohio Lopez 9U/10U" is
stored as "Premier Ohio Lopez", not as "Premier Ohio Lopez /" — because the level
was read off the whole bracket, so the name has to lose the whole bracket. A club
pulled before that rule existed is found by its GameChanger id rather than by its
name, so nothing would ever heal it; its next pull cleans the stored name.

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

### Pulling from GameChanger

Team Rankings stops being hand-entered. Paste GameChanger team ids, team page
links, or a whole spreadsheet export — the same reader handles all three, BOM,
quoted names and tab-separated columns included. Each team's schedule is read and
filed under its own age group and squad year, and the pages are created as they
are needed, because a nationwide list cannot expect a page to exist for every
level first.

#### Two lists: teams, and the organizations they belong to

A team export can carry more than the team. The columns this reader now takes —
`Organization ID`, `Organization Name`, `Organization Type`, `League Associations`,
`Tournament Associations` — answer a question GameChanger's public API will not: there
is no team-to-organization route, so nothing the app _fetches_ can say which club or
league a team is in. A crawl that found the team through its organization knows, and
these columns are where it says so. Every one is optional, and independently so: a row
naming a tournament and no club is an independent team playing one event.

Associations read as `Name|Id`, several separated by semicolons. **A league may age a
team and a tournament may not**, and the difference is not a nicety: you play your own
age in your league and you enter tournaments _up_. An 11U team whose league is
"NKB 11u" and whose tournaments include "NB Summer Slam 12U" is telling you both
things, and reading the second as an age would file it a year old and make every game
in its own league read as playing down.

So a league's age is a rung of its own: **below the club's own word and above its
opponents'**. A league naming an age is a statement about every team in it, which beats
reading the company a team keeps and loses to the club filling in its own page — and a
person naming an age by hand still outranks all of it. Two leagues naming different
ages is not an answer, because one of them is about a different squad of the same club,
so it refuses rather than picking. The whole rung only ever fires on a team GameChanger
left with no age at all.

Organizations are a **second file**, not rows mixed into the first, and the reason is
that nothing inside one file could tell them apart: an organization id and a team id
are the same shape. Two files make every row unambiguous by where it is, leave the team
reader untouched, and mean no list already saved can be misread. Its columns are the
ones the export writes — `Entity Type`, `Entity Name`, `Organization ID`, the three URL
columns (any of which yields the id), `City`, `State`, `Season Name`, `Season Year`,
`Sport`, `Team Count` — and the season pair is read leniently across both cells,
because a real export puts `2027` in the _name_ column with the year column empty.

**The Organizations file is read from the pull panel**, beside the team list, and kept:
a file read later adds to it, replacing only the organizations it names again, so an
export taken part way through a crawl and then the whole of it add up. What makes it
worth reading is its `Team IDs` column — the teams under each organization, which is the
link the team export almost never carries: its league column was empty on every row of
three real exports, 309,504 rows between them. A team a pull brings back with no age from
GameChanger or its own name, whether from the pasted list or from the rota asking again
about a team waiting on an age, takes the age its organizations' names agree on
(`orgMembership.ts`), read by the same `ageFromOrgName` that measured 95.1% against teams
with an age of their own; two organizations naming different ages give nothing. Never
against GameChanger's own band: a team filed "Under 13" is not filed at 16U because an
organization's name says so. A waiting team a file can now age is asked about again at
once, as one somebody named an age for by hand would be. A partial export of 22 September
2026 kept 1,798 organizations over 11,515 teams and would age 141 waiting ones, 139 of
them inside the band GameChanger gives them and the other two refused by it.

`Entity Type` says what a thing is, not how its teams should be rated. A travel
organization is a club; a tournament is an event whose brackets often name an age; and
a **league is neither automatically** — "NKB 11u" is a travel league and
"Mt. Carmel Little League" is rec ball, and only the name says which.

GameChanger's public API allows only its own site as an origin, so the browser
cannot call it. `api/gc-team.ts` is a serverless function that reads a team's
profile and games on the app's behalf and maps every failure to a reason the
panel can explain. It sends the same `Accept` versions and `gc-app-name` header
the site does. `GC_EXTRA_HEADERS` takes a JSON object of extra headers for the
day AWS WAF starts challenging server traffic.

**Identity is asymmetric, on purpose.**

|                                   |                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A team pulled by id               | _is_ that id. GameChanger mints a new one every season, so a club's Fall and Spring squads arrive as two teams and stay two until somebody pairs them.                                                                                                                                                                                                                                          |
| An opponent                       | has no id — GameChanger never gives one, and its picture is different on every listing, so it identifies nobody. The game itself is matched first: a club whose own schedule holds this fixture is the club. Failing that, the name — at that level, in that season year, and in the puller's own state, since nine opponents in ten are; a sole namesake in another state waits as a stand-in. |
| A stand-in                        | is a name a schedule wrote down and nobody has pulled. One per name, level and state: a "Red Sox" named by clubs in ten states is ten stand-ins, not one club they all played.                                                                                                                                                                                                                  |
| A club already here as a stand-in | is adopted rather than duplicated when its own turn comes: the stand-in its own schedule confirms, else the one at its level whose namers are in its state. In a full pull nearly every team appears as somebody's opponent first.                                                                                                                                                              |

The same game is on both teams' schedules and a re-pull brings back a schedule
almost entirely unchanged; both are matched rather than filed again (**One game on
two clubs' schedules** says how), and only a score that has since been played is
written. A 0-0 is read as no score entered,
which is what GameChanger means by it.

**A squad year runs August 1 to July 31.** "2027" is the squad that plays Fall
2026 and Spring 2027, and its season began on 2026-08-01. GameChanger lists a
club's older games under its new id often enough that a nationwide pull carried
three thousand of them; a game dated outside its squad year is left out on
arrival and deleted from a pool that already holds one.

**A pull files the season being played, unless told otherwise.** A crawl that
searches every season of a calendar year hands over last spring's and summer's
squads beside this fall's, each under a new GameChanger id with nothing else to
say its year is finished. So the panel carries a season picker under the list,
with the season being played ticked (2027 on 24 September 2026, which is Fall 2026
through Summer 2027), the one before it, and any other the list's `Season` column
names, each with the number of rows that name it. A row from a season left unticked
is dropped before a request is spent on it. A row that does not say is fetched and settled by
GameChanger's own season: the importer refuses a team from any other year before
its age is read (`other-season`), so it never joins the waiting list, and the
run's summary counts those in a line of their own instead of listing them under
**Worth a look**. The choice is kept with the run, so a resumed run files what it
was started for, and the same list asked for different seasons starts over. The
rota keeps to the season being played as well; see the next section.

**The tidy runs by itself.** At the end of every pull, and whenever the app opens
on a pool whose shape differs from the one it last tidied, the whole pool is
gone over until a pass finds nothing more: games outside their squad year are
deleted; a stand-in is settled by the other club's schedule (a mirrored result
settles it even when the two coaches typed different start times, and two
results that contradict are folded into one only at the very same start time,
against a stand-in whose name is a shorthand for the club, since nobody plays two
games at once); a game each club filed against
a stand-in for the other is joined into one game between them (the same day; both results in and
mirrored, or one result and the other half unplayed at the same start time, or two results that
differ at the same start time where nothing that agrees fits — two unplayed halves
wait until they are scored; two mirrored results joined whatever start times the coaches typed,
since 104 of the 1,211 games this joined on a real pool were more than an hour apart and the same
search a week off matched no more for ignoring the clock; each stand-in's name a shorthand
for the other club's — "Stix" for "Cincy Stix Navy" — with no age a coach typed pointing at
another squad and no two different squad numbers; the two clubs in one state or two that share a
border; and no other pair that fits as well); a game sitting by name on
one club moves to the namesake whose own schedule holds it, even where that schedule wrote the
puller down in shorthand or scored the game differently at the same start time; a stand-in's rows
are filed onto the one club of that name in the puller's state (two in the state:
the one in the puller's own town; none in the state: the one in a bordering state, if exactly one
is — on the stand-in fixtures export of 22 September 2026 that was the club the game itself named
1,174 times in 1,240); two ids are one
squad only when their _own_ schedules filed the same fixture, at one level, in
one state, under one listing name; and two clubs' copies of one game are one game as
**One game on two clubs' schedules** sets out, kept once with the other side's score
noted where they disagree — as is every game above that two coaches scored apart at one
start time (on the stand-in fixtures export of 22 September 2026, 265 games joined, 479
settled and 35 taken back from a namesake). Where the other side is only a name — a
stand-in, a slot, a namesake — the start still has to be the same one, read as the same
minute: a club's own schedule can put two games an hour apart, so within the hour says
nothing about which club a name meant. "Tidy now" on the
import panel runs the same thing for whoever wants to watch.

A pairing with the **same name, same town and same state**, a season apart at
one level, is applied on its own at the end of a pull: that is a club, not a
coincidence. Anything short of all three is **proposed, never applied** — the panel lists the clubs that look like the same club a season on (same name at the same level plus a pulled club in common, or the same picture; a shared name and state alone is no offer, since every rec league in a state has a Yankees), with a tick-all for the
list and a tap on any name to lay the two side by side: GameChanger's name for
each, town, state, record, games held here, and every opponent, with the ones in
common marked. A team's own panel lists the GameChanger ids it is known by,
unlinks one that was paired wrongly, and folds this team into another for one
that arrived twice.

A run of a few thousand teams takes a while and saves as it goes: the pool is
written every five hundred teams and the cursor only advances after the write,
so stopping, reloading or closing the tab costs at most those five hundred.

#### How much comes round at once

Two cadences, chosen in the import panel and remembered. **Every age group, daily**
is the default: the board is only as current as its newest game, and waiting for a
level's turn means answering with a week-old week. It costs a full run's worth of
requests and of saving each day, which is the reason the other choice exists.

**One or two levels a day** spreads the work over a week instead, so no day's run
is long enough to be worth interrupting and nothing is more than seven days old:

| Day       |          | Day      |                      |
| --------- | -------- | -------- | -------------------- |
| Sunday    | 8U, 9U   | Thursday | 12U, 13U             |
| Monday    | 16U, 17U | Friday   | catch up on failures |
| Tuesday   | 10U, 11U | Saturday | 14U, 15U             |
| Wednesday | 18U      |          |                      |

`WEEKLY_ROTATION` in `src/lib/gameChangerSchedule.ts` is the whole of that table;
nothing else reads a day or a level. On the daily cadence every day is also a
catch-up day, which matters more than it sounds: a team with no age is on no page,
so a refresh by level walks past it for ever, and on the rota Friday is the only
day that asks about them at all.

Either way a day is counted once — opening the app twice in an evening does not
pull twice — and a level is marked done only when its run actually finishes, so
stopping half way leaves it due. When today is already done there is a button to
run it again anyway, for when something has changed that a day log cannot know
about.

Either way, and that button too, only the season being played comes round. A
finished season's pages cannot change, so walking them every day spent a whole
year's worth of requests on nothing. What that costs is a result posted after
August 1 for a game in late July, which the rota no longer goes back for. The
teams waiting on an age are asked about as before, whatever their season.

The teams with no age are paced by that same principle, and used not to be. Each
is asked at most once a week — unless somebody has answered for it since its last
ask, which jumps the queue; see **Naming an age** — and left alone only once it has
had both its eight asks and eight real weeks since it was first found. The count on its own used to
be the whole rule, and nothing in `ageUnknown.ts` read a calendar — so eight
"passes" was however long eight presses of a button took. Driving the real
`dueRefresh` and `updateAgeUnknown` over a calendar, a short list was abandoned on
day 8, a list of 4,013 on day 15, and eight presses in one afternoon finished it on
day 2, while the card said "left alone after 8 weeks". `AGELESS_PER_CATCH_UP` is now
a ceiling on how much one run may hold in memory rather than a pacer, so the whole
list is offered at once and a list longer than the ceiling has its overflow asked
the next day rather than the next week.

A club somebody throws out is answered for, and both halves of that now hold: the row leaves the
waiting list at once rather than sitting there until a later pull happens to clean it up, and the
rota stops offering it. Neither used to be true. The decision was written to the dropped-clubs list
and nothing else changed, so the club was handed to the puller on every catch-up day, fetched twice,
and refused by `importOne` only after both requests had been spent — two requests a week, per club,
for an answer already given. At a dozen clubs that is invisible; at thirty thousand it is not.

A team GameChanger says is below the youngest level ranked here is remembered rather
than rediscovered. The paste already drops rows that name a too-young age themselves,
but a row naming no age is kept — most do not name one — so it is fetched, GameChanger
says 7U, and the schedule is refused. Nothing used to remember that, so the next
export spent the same two requests on the same answer, for thousands of teams. The id
now goes in a list of its own, the paste skips it, and `importOne` refuses it before
reading a game. It is a cache of a fact rather than a record of a decision, which is
why it is kept apart from the clubs the user threw out: burying a dozen deliberate
deletions under four thousand toddlers would make that list unreadable. A GameChanger
id is minted per team per season, so this can never hold a club down as it ages up —
next year is a different id.

Only that team's own schedule can answer the question about it. `ageFromOpponentNames`
reads the opponent names off the schedule just fetched, and neither the pool nor the
index is on that path — so pulling other clubs never settles an age, however many of
them name one. What changes the answer is the club editing its GameChanger page, or
the team playing more games against opponents who do name an age.

Nothing fires by itself — there is no server here, and a browser cannot run while
it is closed — so the panel answers "what is due?" when the app is next opened.

**Teams waiting on an age.** Setup carries a card for the ones nothing could settle,
ten at a time. Ten because four thousand rows is not a queue, it is a wall; and the
ten do not reshuffle while they are worked — they stay the ten, shrinking as they are
answered, and the next ten arrive once the last is done. Nothing extra is stored to
track that: a team is answered when somebody named its age or threw it out, and both
of those are already stored, so the queue is derived from them and cannot drift out of
step. Closing the tab loses which ten were in front of you and no work.

Each row carries the GameChanger id and the complete name — the two things needed to
go and look a team up — a link to its page, the reason the age could not be read, and
whatever was kept when it was refused. The reason is the useful part:
`ageFromOpponentNames` gives up for four different reasons and returns one `undefined`
for all of them, so the counts are kept and say which. "None of its four opponents
writes an age" is a rec league and will never come good; "two of its three say 9U" is
settled in a second; no games at all is a blank schedule.

**Two opponents agreeing are enough.** Three agreeing is the old bar and still the one a
split is judged by, but two opponents naming one age with nobody naming another now
settle a team too (`ageFromTwoOpponents`), held to GameChanger's own band. It was
measured before it shipped: over the pool-names export of 23 September 2026, on teams
whose age the pool already files, it matched the filed age for 10,330 of 10,623 — 97.2%
exact, 99.7% within a year, against 99.0% for three — and on the waiting list of the same
day it answers 554. Rows whose stored name or opponents the rules of that day already
answer jump the re-ask rota once (`withRulesMoved`, dated `AGELESS_RULES_CHANGED_AT`), so
the next pull files them rather than the week after; on that list, 815 of 16,611. One
opponent alone is 93.6% and is not enough: one team in sixteen would land a year or more
off.

A team whose name says a high school squad is not on this card at all, even one that
went onto the list before that rule existed: the name settles it, so it costs none of
the ten, and the next time the rota asks, the answer comes back `high-school` and the
entry retires itself.

A lone `V` is the opposite case and stays. "Madison V" is the varsity side on a school
schedule and is equally a squad number, a colour or a coach's initial, and one letter
is too thin to refuse a real club on. So it comes to the **top** of the queue, with
the reason written out — it is the one row here anybody can settle by opening a single
page — and the card carries a **High school** button beside **Not a real team**, since
a varsity side is a real team that simply plays a season this app does not rank. Both
buttons do the same thing to storage: thrown out at once, and never brought back.

**Finding one team.** The card carries a search box, and it reads the **whole list** rather than
the queue. It matches the name, the GameChanger id, the town and state, and the opponents the card
already shows — a club is remembered by where it is from as readily as by its exact squad name.
Every word has to appear and they need not be adjacent or in order, because the real names on this
list read "Mears 1 - 2026" and a plain substring test turned "mears 2026" into no matches at all.
Best match first — the whole name, then the start of it, then anywhere — because ordering matches
by how invented a page looks puts the wanted team past the cut. That is the point of it: the queue is the small end, ten at a time out of tens of
thousands, so "I know this club is in here" is very often a team the queue is deliberately not
showing. A match that is off the queue is shown with the reason — you threw it out, you already
named its age, the name reads as a high school squad, or it was left alone after its asks ran out
— and for the two of those that are your own answers, an **Undo that** button takes it back.
Before this there was no way to undo either one anywhere in the app.

**An age from the organization a team sits under.** The very bottom of the ladder. An
organization named "TPABL 12U" or "GLL 8u Fall 2026" is saying what age plays under it, and
for a team with no age of its own that beats nothing, which is what such a team has.
GameChanger's public API has no route from a team to its organization, so this only arrives
from a crawl that found the team through one.

Refused for events and for spans, and both refusals are measured. Over 17,003 teams
carrying an organization, 2,240 had both an org naming an age and an age of their own to
check against. The org's age agreed **90.1%** of the time; excluding event-sounding names
took it to 94.1%, excluding spans to 93.9%, and excluding both to **95.1%**. The errors are
overwhelmingly one-directional — of 221 disagreements, 197 had the organization _older_ —
which is the play-up signature: "(09/25/2026) 17/18u Super Fall Invitational" holds 16U
teams, "Suburban Travel 13/14u" holds 13U ones.

The span filter allows an optional `U` after the first number as well as the second,
because clubs write it both ways and without that "13U-16U" reads as a plain 16U and files
thirteen-year-olds three years old.

95% is not good enough to outrank anything a team says about itself, so it sits under the
league rung and under the company a team keeps, and only ever answers a team that has no
other answer at all. On a real backlog it reaches **273** rows — small, and honestly so.

**An age from the company the pool already knows.** The last rung of the ladder, and the
one that reaches the backlog's most hopeless population. `ageFromOpponentNames` reads an
age out of an opponent's _name_, so it can never settle a team in a closed league where
nobody writes an age in anything — "Team 4" playing "Team 2" and "Team 5". Over a real
36,194-row backlog, 10,709 rows are exactly that shape.

But the pool has usually met those opponents. A team refused for having no age has just had
its whole schedule fetched, and most of the clubs on it are already filed, at an age
something else settled. That answer was one lookup away and nothing asked for it.

**By identity, never by name.** The opponent is matched on its avatar key — stable per club
across schedules, and what `resolveOpponent` already trusts. That is what makes this safe: a
name match on "Team 4" would collect a stranger from the other side of the country, and a
pool holding tens of thousands of teams has a great many "Team 4"s. Where two clubs share a
picture the picture identifies nobody, and the opponent is skipped; where the pool has a
club filed at two ages it is running two squads, and it says nothing about this one.

Held to the same bar as the name rule — `MIN_OPPONENT_AGE_EVIDENCE` distinct opponents
agreeing, a tie refused — because it is the same kind of claim: circumstantial, about the
company a club keeps, and wrong in the same way if a squad plays up all season. It sits
below the name reading for the same reason: a club writing "12U" in its own name is telling
you about itself, while this tells you who it plays.

**An age from the games themselves.** The picture turned out to be no kind of identifier —
7,948 teams in a nationwide pull carried 7,948 different ones — so the rung above seldom
answers. The games do. Each pulled club that played a no-age team holds its own half of the
game, filed against a stand-in carrying whatever its coach typed for that team.
`ageFromFixtures` finds those halves the way the crossed-halves join does: a row a pulled club
filed that day off its own schedule, against a stand-in whose name is a shorthand for this
team, with the result mirrored or at the same start time — and the name this team typed a
shorthand for that club, the two in one region. A game two clubs could each have been names
nobody. Each club counts once, at its own listing's level, and a club listed at two levels says
nothing. The answer is held to the name rule's bar: three clubs, a strict majority, three on
the level it gives. On the stand-in fixtures export of 22 September 2026 the two clubs of one
game were filed at one level 73.5% of the time and a level apart 22%, so one club's level is a
guess and three agreeing is not. From the waiting list's own file, which keeps only three of
each team's opponents, it ages at least 32 teams, and every one of the 31 whose GameChanger age
field gives a band lands inside it. It sits below the picture, and is recorded on the
pull as `ageFromFixtures` as well as among the ages from opponents.

**And last of all, an age the name writes loosely.** The ordinary reader wants an age
with word boundaries round it and a U on both ends of a span, which is what keeps
"12UNDER", a date or a squad number out. So it misses "Spiders12U", "10U_Hartman",
"Donegal Green 12u2", "U13s Blue", and spans written without their U, "Giants 11-12" and
"Braves 9/10". `ageLevelFromLooseName` reads those, a span at its older end the way one
with a U is read: two ages a year or two apart, in order, and not a date or a score. A span
can be two school grades as easily as two ages, and the user settled that in these names it
is ages; a name that says "grade", or puts an ordinal against a number, is left alone. It
is the very bottom rung, below the games, so no team anything else ages moves, and it never
files against GameChanger's own band. On the pool-names export of 23 September 2026 it
fires on 537 of the 102,845 names the ordinary reader finds nothing in — the glued forms
92.9% exactly the age filed and 98.8% within a year, the spans 72.4% and 93.3%, most of the
rest filed at the younger end. On the week's waiting list it reads 545; the band refuses
12, and of the rest 514 are filed and 19 turned away as under 8U. Recorded
on the pull as `ageFromLooseName`.

**A name outranks an age column, on a pasted list.** The age ladder reads two kinds of
age field and does not trust them equally. GameChanger's own `age_group`, first-hand from
its API, outranks a plain age in the team's name. The age column of a pasted list does
not: there the name wins.

The reason is that a column is only as good as whoever built the file, and a name is the
club's own statement. Measured against the 60,040 teams this pool already ranks: over an
83,941-row export the column and the name disagreed 21,320 times, and for the 8,822 of
those whose team could be found in the pool by name, the **name** matched the filed age
7,603 times — 86.2% — against the column's 187, or 2.1%. That export's column turned out
to be the age bucket its crawler had searched rather than the team's own: it was identical
to the file's own `Found Via Ages` in 59,794 of 59,799 rows. "BattleHawks 10U" carried
11U, "MBC 8U" carried 9U, "BNE NTH 1 12U" carried 18U.

A correctly built list points the same way, less starkly. The "Check the id" pull of
40,760 teams found the two disagreeing by one 343 times, with the name carrying the right
level in 267 of them — so it is the age field that wanders, even when nothing is wrong
with it.

**And a name too young to read stops the ladder** rather than letting the column answer
for it. `MIN_GC_AGE_LEVEL` is 6, so "4U Sparrows" and "5U T-Ball Couto Baseball" read as
nothing at all — and without this the ladder fell through to a column that offered 9U.
298 names in that export state an age below the floor and the column offers 9U or 8U for
248 of them. Refusing leaves the team ageless, which is the safe direction: an unaged team
costs its own ranking, where a team aged five years wrong corrupts every club it played.

Across the whole export the two rules move 20,869 rows to a different age and refuse 254
outright, leaving 62,818 exactly where they were.

**The age field GameChanger was already sending.** The age group is not only "12U" and
"Varsity". It carries a small closed vocabulary of its own, and for a long time this app
understood none of it: `parseGcAgeLevel`, `ageLevelOf` and `isSchoolAgeLabel` all returned
nothing for every value in it, so teams whose own page plainly said what they were sat on
the waiting list being asked about every week.

Measured over the 36,194 teams waiting on 22 September 2026, where the field is set on
36,182 of them — 99.97% — and holds exactly eleven values: `Under 13` (27,485), `Between
13 - 18` (3,967), `Over 18` (2,049), `college` (719), `18O` (535), `middle_13O` (419),
`middle_12U` (379), `high_varsity` (313), `high_freshman` (164), `elementary` (104) and
`high_junior_varsity` (48). They are read three ways.

**Adult and college** — `Over 18`, `18O`, `college` — are refused outright, the way a
wiffle ball team is. This app ranks youth baseball, so there is no age on one of these to
find: the `Over 18` rows include "Long island Angels 44" playing "LISM Patriots 44+", and
the `college` rows "MCC Wolves" playing "Coffeyville CC". Asking weekly is two requests a
week spent on a question with no answer. `18O` means eighteen and over and is the one that
brushes against a real 18U squad; of the 3,303 rows carrying any of the three, thirty have
a name that reads 18U-ish and almost all of those are plainly college ("UNT Club Baseball
2026-2027") or a league's own admin account ("FALL Board 2027"). The handful left is the
price of the other three thousand, and a refusal is undoable where a wrong age is not.

**The school bands** — `high_*`, `middle_*`, `elementary` — retire on the same terms as a
varsity side, because that is what they are: "Sentinel JH Bulldogs", "7th CyFair ISD -
Salyards MSM" playing "Cy fair Combo 7th Grade". Note `middle_12U` names an age and is
still not read as one. A seventh-grade school side is a school side; reading the 12 would
file it against travel clubs it never plays.

**The two bands bound an age without giving one.** `Under 13` and `Between 13 - 18` cover
87% of the backlog and can file nobody — there is no single age in either — but they can
refuse one, and that is where their value turns out to be. Against every candidate rule in
`agelessTriage.ts` over the same rows, 1,186 of the 1,203 ages those rules derive already
sit inside the band, 98.6%. All seventeen that do not are the same mistake: a PONY division
word read off a mascot or a university. "SMSU Mustangs Home" is Southwest Minnesota State,
filed `college`, and was about to be ranked at 10U; "Owls Colt" and "Canes Colts" are filed
`Under 13` and were about to be ranked at 16U. The veto lives in `agelessVerdicts` rather
than inside each rule, so a rule written later cannot forget it.

`Under 13` is read as a ceiling of 13 rather than 12, deliberately loosely: Little League's
Intermediate division is ages 11 to 13 and this app files it at 13U, so a twelve-year-old
in that division is `Under 13` and 13U at once and neither is wrong. Read strictly, the
band vetoes 178 Intermediate teams it has no business vetoing.

**The pool's own names, for measuring a rule against what it must not break.** Pool health
carries a **Download the pool names** button: ids, names, the age each team is already
filed under, and the same evidence the backlog rows carry — games, scored, ahead of today,
shutout blowouts, opponents, how many of them named an age, which ages, and a sample of
the ones that named none. No games themselves, so a hundred thousand teams is a few
megabytes. Nothing in the app reads it.

The opponents' ages are read off `GcTeamLink.name` — the name GameChanger gave, age label
and all — rather than the pool's own stored name, which `cleanTeamName` strips the age from.
That distinction is not a detail: "how many of its opponents write an age" is the question
`closed-cluster` turns on, and against cleaned names the answer is no for essentially every
team in the pool by construction. The first export carrying evidence had 50,810 of 50,822
ranked teams reading zero, which made `closed-cluster` look like it fired on 36.5% of the
working pool when in truth the file could not tell.

The evidence half is there because without it the tripwire can only measure the rules that
read a name. The five that read a schedule — `closed-cluster`, `school-by-evidence`,
`near-miss-tally`, `no-games`, `scored-ahead` — could not fire against a file of bare names
at all, and reported a zero that means "not measured" and looks exactly like "safe".
`closed-cluster` alone proposes a verdict for 10,709 backlog rows, so that distinction was
worth the columns. The counts use the same definitions `agelessEvidence` uses, per distinct
opponent rather than per game, because the tripwire compares what a rule does here against
what it does on the backlog and two readings of "opponents" would make that meaningless.

**The stand-in fixtures, for measuring a join by the game rather than the name.** Pool health
also carries **Download the stand-in fixtures**. A stand-in is a club known only because a
pulled schedule named it; the pool-names export found 46,118 of them holding 83,142 results,
4,995 with exactly one ranked club of the same name, age and year, and at least 1,357 of those
mirrored — each of two pulled clubs holding a stand-in for the other, one real game filed as two
halves that never meet. GameChanger's games carry no opponent id, so a name is all a schedule
gives; but a club plays one game at one instant, which makes the start time a proof a name can
never be, misspellings included.

The file holds every row with a stand-in or a TBD on one side and, beside it, each row that
could be its other half. The puller's own second row at the same instant (`same-club`): it
cannot have played two games at once. Another club's unsettled row at the same instant — against
a stand-in, a slot, or a pulled club of exactly the puller's name — whose names both support the
pairing, or one name and a mirrored result (`fixture`). And the same on the same day at another
time (`same-day`), held to both names and no contradicting result, because the two schedules of
one game do not always agree on its start: requiring the times to match once left about a
thousand settled games standing. "Support" is generous on purpose, so a stricter rule can be
tried on the file afterwards: the same key, the same letters run together, a word in common, or
a word one slip apart — which lets a changed digit through too, and "2032" beside "2033" is two
graduating classes, not a typo.

Both searches are run again a week either side, same weekday and hour (`decoy`, `day-decoy`),
where the schedule looks the same and the game is not there, so the rate at which each matches
by chance is in the file beside what it finds — a week rather than an hour, because an hour off
is exactly the mistake two coaches typing one start time make. Rows with nothing beside them are
written as `none`, because they are the denominator. Each side's date, result and last pull are
there too, because the first question about a pair that never joined is why the rung that joins
exact names did not — it needs the dates to agree and the results to mirror.

What the searches leave out was measured, on a pool of 241,000 games built from the pool's own
120,210 team names paired at random, with 5,000 true mirrored pairs planted in it — all 5,000
were found. A row between two clubs already connected to each other is left out: admitting those
raised the stand-in rows with a decoy at the instant from 460 to 2,057 and those with a same-day
"match" from 1,343 to 5,649, all chance, and took thirty seconds rather than twelve. One shared
word with nothing else behind it found
a "match" at the instant for 18,679 of the 84,000 unplanted stand-in rows, more than one in five,
and admitting one name with a mirrored result on the day took the same-day search from 1,343
rows to 6,104 — every one of them chance — so neither is in the file. What chance is left shows
up as about 230 decoys a week-side at the instant and 960 on the day, against 94,000 stand-in
rows. It took twelve seconds, and the button says how far along it is. Nothing in the app reads
it.

Two rules still cannot be measured this way whatever the file holds: `adult-label` and
`school-label` read GameChanger's own age field, which the pool keeps no copy of. The sweep
names them as not measured rather than printing their zero. It goes to `npm run ageless:sweep -- <backlog> --pool=<names>`, which cannot
otherwise ask the only question that matters about a candidate rule — what it would do to
the teams that already work. Because the file carries the filed age, a hit splits into
"agrees with the pool" and "disagrees", and it is the second column that should be zero.

**Clearing what a rule has settled.** The waiting card lists, under **Settled by rule**,
each rule that has claimed rows, with its count, a tickbox and a few of the names, and one
button clears everything ticked in a single pass. It asks first, where the single throw-out
deliberately does not: the argument there is that a dialog in front of the common case
costs a click to guard against the rare one, and here the action _is_ the rare one,
thousands of rows at once that nobody can check by eye afterwards. The dialog says how many
each rule is clearing.

The rules are named by id in `CLEARABLE_RULES`, never picked by tier, and each is a call
already made rather than a guess. Two repeat GameChanger's own age field — adult or college,
and a school squad. The rest are the user's, made over the 38,603 rows waiting on
22 September 2026:

- **Named void or do not use** — cleared whatever its schedule. 68 rows.
- **Tee ball and younger** — tee ball, PONY's Shetland and Foal, and a name stating an age
  under 8U; below the youngest level ranked, as every such team already is at the door. It
  stands down for a name that writes a rankable age of its own. 1,919 rows.
- **Rec ball in a closed league**, cleared for good: nothing will ever age such a team from
  its opponents or join it to a club this app ranks. A team counts only once it has played,
  when nobody it played writes an age, its own name states none (not even loosely, as
  `ageLevelFromLooseName` reads one), and it does not call itself
  an all-star, travel, select, elite or tournament side. Then any one of three things marks
  it: GameChanger files it under Little League, Cal Ripken/Babe Ruth or PONY (13,538); it or a
  team it played is named for a rec division or league — Majors, Minors, AAA, Farm, Coach
  Pitch, "LL", or a league's initials written in capitals like NCLL (4,370); or two of the
  teams it played carry a Major League club's name, the way a house league hands them out
  (1,813). Of those 19,721, 37 carry a word a travel club might, and all but three are Little
  League "National" divisions or plainly house league.

Between them 21,708 of the 38,603, 56%. League initials are read in capitals only, from a stem
of four letters with at most one vowel, and never as an ordinary word: read case-blind,
"Fall", "Ball" and "O'Neill" all end in LL, and a first draft cleared "Aces" for having played
"Riverside Rats Fall 26". The rules that only propose — a closed league that names itself
nothing, a horse mascot, a grade word — are never on the list.

**An empty schedule is judged by its season.** A team with no age and no games at all is
asked about again weekly while its season is being played, because the schedule is a thing
somebody has yet to write. From a season that is over or not begun, the import drops it from
the list without remembering it (`out-of-season`), so a later pull finds it again once its
season comes round with games. The windows are wide and overlap — spring February to June,
summer May to August, fall August to November, winter November to February under either
year's label — because erring towards "being played" only costs a weekly request. The
season rides on the waiting row and in the downloaded file's **Season** column.

The pass is stored whole before the rows go, at a lazy key beside the pull log, so **undo
outlives the toast**. That matters more here than anywhere else: a team refused at the
door was never filed, so the row on the waiting list is the only record it was ever asked
about, and undoing by re-fetching would cost two requests a team to learn what was already
known. One pass is kept, not a history — what somebody wants is to take back the thing
they just did — and a new pass replaces it, which is also what bounds the size.

**Taking the list away with you.** Thirty-six thousand rows is not a queue anybody works
ten at a time, and the card cannot become a spreadsheet. So a **Download the list** button
writes one: every team still waiting, each with the evidence behind it — the age field
GameChanger did give, its sanctioning body, town, state and season, the games and how many were
scored on days that have not happened, the opponents and whether any of them named an age,
the roster count — and an empty **Answer** column to fill in. It sorts and filters on a
bigger screen than the one it was collected on, and it is the file `npm run ageless:sweep`
reads when the rules are being measured.

It is also the only way this list leaves the browser at a workable size. It rides in the
whole-browser backup too, but that file carries every season and every game beside it and
runs to hundreds of megabytes on a nationwide pool — too big to move, and mostly things
nobody looking at this question needs. These rows are a few megabytes.

The first three columns are named to hit the aliases the team importer already matches, so
a worked file pastes back into the import box as a team list. The fourth is deliberately
**not**: the observed age field is called `Age Field`, never `Age Group`, because the
importer reads `age group`, `age`, `age level` and `division` as the age. Naming it that
way would let GameChanger's own rejected label beat the answer the reader was asked for
precisely because it was rejected — silently, and the moment a division-name rule joins the
ladder. A test pins the name.

Throwing one out does not ask first. This is a queue worked ten at a time and mostly full of junk
that takes a second to recognise, so a dialog in front of every one puts a second click on the
common case to guard against the rare one. The guard sits after the action instead, as an **Undo**
on the toast, where it costs nothing unless it is needed — and it can, because nothing is
destroyed: the club was never filed, so throwing it out writes an id to a list and the undo takes
it straight back off. A team that gets past the toast is still findable by name here.

Saying what age a team is now puts it back in the queue even if it had been left alone, because a
person answering is a third thing that can change the answer and the only one the give-up rule
does not know about. Without that, an age typed against an abandoned team sat in storage and never
reached a schedule.

Likeliest real first, by `looksInvented` read low to high — the score counts games
carrying scores on days that have not happened, shutout blowouts, a record claiming far
more games than the schedule lists, a roster under nine. It ran the other way to begin
with, on the argument that junk is quick to clear. That is the wrong thing to optimise:
ten rows is a sitting whether they are junk or not, and a sitting that opens on three
fictions is one where the real decisions — the ones that actually put a team on a page —
are the part nobody reaches. A fiction is quick to throw out from anywhere in the list;
a genuine club is only ever aged from the front of it. Among rows nothing else separates,
one carrying a lead goes ahead, then the stalest.

It is **only an ordering** either way round. Every part of the score has an innocent
reading, so nothing is ever thrown out on that number, no row is coloured by it, and
sorting last is not the app calling a team fake; an empty schedule is a club somebody
made this morning as often as it is a fiction.

**One shape is thrown out outright: a schedule that is nothing but results from the future.**
Every game on it has a score and every one is dated after today — "Test team" with 68 of 68,
"ShotByKoRob Scout Team" with 13 of 13. No reading of that is innocent, and the rule is the
user's, stated flatly: if a team's entire schedule is completed games in the future, the team is
fake. The import refuses such a schedule as `invented` before it asks the team's age, so it never
joins the waiting list to be asked about every week, and the run hands its id up to the clubs the
user has thrown out. That last part is what makes it stick: the dates give it away only until
they pass, and a schedule of October results refused in September would read as a season played
by November. Only the whole schedule counts — one game already played, or one future game still
waiting for its result, and it is left to `unrealClubs` and a person, as before. A game dated
today is never ahead, and a league row's "M/D" is never compared. The waiting list's
`scored-ahead` rule reads the same definition off the evidence a row kept, so a team already
waiting is named the same way before its next re-ask throws it out; the floor of five games it
used to carry is gone.

**What is left is listed worst offender first, and each row opens its schedule.** Pool
health's "Scored on a day that has not happened" charges each such game to the club whose own
schedule filed it (`filedBy`: the pulled id in `source`, and any other schedule whose own row
scored it), not to both sides. A schedule that listed the fixture with nothing in it filed no
result: every copy of a game folded in is now on record, the victim's placeholder for it
included, and counting those put a real club on the list at three of five beside the club
that invented the scores. An invented game is written by one club against another that never played it, so
counting both put the victim on the list with every invention against it — a real club an
inventor listed as its opponent every week came out above the inventor. A game nothing traces
to a schedule, one typed by hand, still counts against both. The rows drawn above the club list
follow the same order, the worst club's first, and every club and every row links to the
filing club's GameChanger page, so investigating one is a click rather than a search. Past the
first twelve clubs, "Show all" lists the rest.

**Naming an age** is the fourth way a team gets one, and it stands in until the club
answers for itself. The named level is used ahead of GameChanger's own field, which is
what lets somebody correct a team filed at the wrong age rather than only one filed at
none — but the moment GameChanger's answer _changes_ from what it was when the name
was given, GameChanger wins and the named level is dropped. `insteadOf` records what
GameChanger was saying at the time, so that is a comparison rather than a guess. A
level outside the ranked range is refused rather than clamped: a stored 6U would be an
answer that files nowhere, taking the team off the waiting list and putting it on no
page, so it would vanish from both.

Naming is only an instruction to the next pull: it is applied when that team's schedule
is next fetched, because the page it is filed under, the link written against it and the
age carried on each of its games all have to agree, and only a fetch produces those. So
a named team goes to the **front** of the next refresh's queue and is exempt from the
week between asks. It has to be: a team is on the review card precisely because a pull
has just failed to age it, so its last ask is a day or two old, and the week gate used to
refuse it — leaving "it will be filed on the next refresh" false for up to a week with
nothing on screen saying so, and the team on no page and therefore invisible to the
League Standings scout picker, which only offers clubs that are on one. The exemption is
spent by the ask it buys, since the fetch moves the last-asked stamp past the answer's
own: an answer GameChanger overrules gets that one ask and then goes back to once a week
rather than being fetched for ever.

**Two things the profile says are kept for the rules to read.** GameChanger reports a
team's **sanctioning body** — `usssa`, `little league` — and the **coaches** on its
public profile, and the app read neither. The body is the only field that says whose
word a division name is, which is the whole difficulty with them: "Majors" is a Little
League division of nine- to twelve-year-olds and a USSSA skill class at any age, and
"AAA" is a local Little League convention, a USSSA grade, and a provincial tier in
Canada. The coaches matter for a different reason, measured elsewhere in this file: two
teams sharing two of them are the same club 97% of the time by state and 89% by town,
and before this that signal only ever arrived on a pasted list — never on the thousands
of teams pulled by id alone. Both ride on a waiting team's row too, since its schedule
is read once and thrown away and a fact not written down there costs two requests to
learn again.

**A backup carries the answers, not just the pool.** The named ages, the thrown-out
clubs, the too-young ids, the deleted rows, the kept-apart pairs and the waiting list
all ride in an `answers` block — in the Team Rankings pool file as well as the
whole-browser one, which was not true until recently: the block was built when a backup
was taken and restored when one was read, and the writer in between left it out. So the
pool file restored answers it had never saved, and since a reset clears every one of
them, the file offered as the way back could not bring them back. None of it can be recomputed — a pool can be pulled
again, a judgement about whether a club is real cannot — and without this, restoring
into a fresh browser threw an evening's work away and then set about rediscovering the
problems it had answered. The block is optional and absent means leave what is there
alone, because "this file predates it" and "this file has nothing to say" are the same
bytes.

**Start from scratch means the whole app.** The reset in Team Rankings' Setup leaves the
browser as if it had never opened the app: every League Standings season, the Team
Rankings pool, every answer above, the Organizations file and the settings. It used to
keep the answers and leave League Standings alone, on the reasoning that a reset was for
the data and not the judgements about it; to the person pressing it, a reset that keeps
anything is not one — they cleared the app and found it still refusing clubs and filing
teams at the ages it had before. `localStorage` goes by prefix (`league_`, `lf_`,
`nkb_`) rather than by a list of keys, so one added later goes too, and the pool's
IndexedDB store is emptied of every key and then read back. If the store keeps any of it,
`localStorage` is left alone — its note saying where the pool lives is what lets a
second try find the rest — and the app says the reset did not finish. Then the page
reloads, since every view holds copies of what it read.

### States

A team can carry a two-letter state, and the rankings can be narrowed to one — or
to the teams whose state is not set yet. Set it on the team panel, or let an
import fill it in: `Home State` / `Away State` on a game list, `State` on a
schedule. An imported state never overwrites one already there.

Filtering is presentational. Ratings come from every game regardless, so a
filtered table renumbers but keeps each row's place in the full table alongside.

### The rating in a forecast

Every game pick blends two views. The league's own per-game stats — runs scored
and allowed, walks, hits, errors, strikeouts, recent form — and the
opponent-adjusted rating, which is the only number that knows _who_ a team
played, and which counts tournament results where Team Rankings is switched on.

How far it leans on the rating depends on how many games that rating rests on:
0.40 with none, 0.52 at one game, 0.70 at four, 0.80 at eight. The floor is not
zero because a rating of 0 means "league average", which is a better guess than
a record built from a single game. The count is of _rated_ games, league plus
tournament, so a team with two league games and five tournament results is
trusted like the known quantity it is.

That the rating deserves most of the weight was measured, not assumed: 400
simulated leagues per case with known true team strengths, swept over the weight,
walk-forward so no pick ever saw its own result. Every measure improved the
further the pick leaned on the rating, in all six schedule-by-pitch-mode cases.
The reason is spread rather than direction — the stats model's expected margin
swings about twice as wide as real margins do, while the rating's is about right.

Measured on the shipped code, 200 leagues a case, against the same code with the
rating withheld:

| Schedule                   | Pitch   | Brier           | Winner accuracy | Margin error, runs |
| -------------------------- | ------- | --------------- | --------------- | ------------------ |
| Balanced                   | player  | 0.2377 → 0.2267 | 63.2% → 63.7%   | 3.82 → 3.66        |
| Balanced                   | machine | 0.2275 → 0.2255 | 63.6% → 63.7%   | 4.22 → 3.71        |
| Unbalanced                 | player  | 0.2376 → 0.2268 | 62.5% → 63.0%   | 3.89 → 3.70        |
| Unbalanced                 | machine | 0.2282 → 0.2258 | 62.5% → 63.0%   | 4.32 → 3.74        |
| Unbalanced + Team Rankings | player  | 0.2376 → 0.2243 | 62.5% → 64.1%   | 3.89 → 3.64        |
| Unbalanced + Team Rankings | machine | 0.2282 → 0.2234 | 62.5% → 63.9%   | 4.32 → 3.67        |

The last two rows are the point of the bridge: the same unbalanced schedule, with
the tournament results counted, picks about a point of accuracy more.

Two honest limits. The simulation draws margins the way the rating model assumes
they work, so it cannot tell you whether real baseball has structure the stats
model catches and the rating misses. And the walk-forward backtest reports a
floor rather than the shipped model's accuracy, because an outside result carries
no date and cannot be placed on the league's timeline without leaking the future.

A team the fit never rated carries no rating at all, and its forecast is exactly
the number it was before any of this existed.

### Ratings

A rating estimates how many runs a team beats an average opponent by, adjusted
for opponent strength, capped at ±8 so one blowout cannot run away with a season.
Only completed games count; scheduled ones exist so a future opponent can be
logged early. Win probabilities are clamped to 8–92% — youth baseball has no
locks.

Until teams share opponents, directly or through a chain, a rating is close to a
plain run differential.

**Where the eight came from, and how to check it.** The case for _having_ a cap
is plain — without one a 20-0 against a weak club outweighs a season of close
wins against strong ones — but the case for _eight_ was never made here. It is
inherited from League Standings, where the cap is a rule of the league (coach
and machine pitch carry a per-inning run limit), and then applied flat from 8U
to 18U even though the same settings put player pitch at twelve. Setup's **Check
the model** card now sweeps it: `compareRunCaps` refits the pool at four, six,
eight, ten and twelve runs — and at no cap at all — and reports what each one
predicted. The last row is the one that asks whether _having_ a cap earns
anything, rather than which cap is best. On a pool whose margins all fit inside
eight it ties every cap from eight up, exactly as it must: a clamp that never
reaches is not a clamp.

The sweep moves the fit's cap and holds the scoring target still, and that
separation is the whole reason the answer can be believed. One constant used to
do both jobs, so a smaller cap was a smaller error for nothing — the target
shrank under the model. Measured on four thousand realistic margins against a
model that cannot improve (it predicts zero every game), letting the target
follow the cap gives 2.25 runs at a cap of four rising to 2.95 uncapped, a clean
ordering that is pure artefact; pinned, that same model scores 2.605 at every
cap, as it must.

_Where_ it is pinned is a second choice, and a sweep with an open end cannot
make it freely: a target clipped at eight marks a wider candidate down for
swinging where the target has been flattened. Three sixteen-team pools, two
rounds each, the same hold-out, comparing a target pinned at eight against the
margin as played:

| truth                           | cap 8 → pinned / played | no cap → pinned / played |
| ------------------------------- | ----------------------- | ------------------------ |
| inside eight, no blowouts       | 0.894 / 0.894           | 0.892 / 0.892            |
| inside eight, 10% junk blowouts | 1.930 / 2.527           | 2.245 / 2.843            |
| genuinely spans past eight      | 2.517 / 5.231           | 2.760 / **1.091**        |

The pin changes no ordering on the first two — the same cap wins either way —
and inverts the third, where pinned at eight reads "no cap is worse than twelve"
and the margin as played has it beating everything by a factor of two. So the
sweep grades on the margin as played: still one target for every candidate,
which is the property that matters, and the least arbitrary one going, since the
margin is a fact and eight is a choice. It reads higher in absolute terms than
the **Off by, on average** figure above it, which does clip at eight, so the
rows are to be compared with each other rather than with that one. The
called-right column is the check on all of it — direction is clamped by
nothing — though it is the quieter signal, since direction is easy wherever two
sides are far apart.

Nothing changes on the strength of the sweep by itself — `RATING_CAP` is still
eight and the League Standings cap, which is a rule rather than a guess, is
untouched. The card is there so the number stops being inherited and starts
being a measurement.

#### Recent form

Newer games pull harder: **half weight every 90 days**. A side that lost through
September and has been winning since is rated closer to the side it is now than
to the one it was.

This is how the systems League Forecast is modelled on do it. Massey's
least-squares ratings de-weight early-season games; Pomeroy's weight each game by
when it was played, with more weight the more recent, so a rating describes a
team _now_; and the Elo family gets there by construction, a recent result
moving the number further than an old one. None of them steps the weight at a
boundary inside the season, and neither does this. **The season is still the
season**: every age group sharing a squad year is still fitted as one pool, an
autumn game is still in the fit, and it simply counts for less than a spring one
by the time spring comes — about a third of a fresh game's weight after five
months, a quarter after six. A slope rather than a cliff.

Ninety days rather than thirty or sixty is because of the winter. Squad years
run August to July with a four-month gap in the middle, and a fast half-life
would make the autumn irrelevant by spring, which is a season split under
another name.

It changes the **fit and nothing else**. Games played, record and strength of
schedule are descriptions of a season rather than beliefs about a team, and a
side played twelve games whatever the fit leans on. Weights are normalised to
average one, so the ridge is handed the same total evidence and nothing is
regressed further toward the mean than it was before. The weights depend only on
the gaps between games, never on the clock, so a rating is a pure function of
the pool and two readings a week apart agree.

**What the evidence is.** `scripts/recencySweep.ts` was run against a
nationwide pool seven weeks into a squad year, the only backup small enough to
export. It could not put the cross-winter question, because that pool had no
winter in it. In season, at four nested cuts, the day-based schemes beat
counting every game the same on every one, and the games-since schemes were
indistinguishable from it — on a small hold-out, without the shuffled-calendar
null run to completion, so a direction rather than a finding. Practice and the
direction agree. Setup's **Check the model** card runs the same comparison in
the app (`compareRecencySchemes`), so a pool this is wrong for will say so, and
changing it is one line in `src/lib/ratingRecency.ts`: every candidate is in
`RECENCY_SCHEMES`, and `noDecay` restores exactly the behaviour that shipped
before weighting existed.

#### Playing up and down

Fall tournaments routinely pair a team against the level above or below. Every
age group sharing a **season year** is therefore fitted as one pool, with each
game carrying the gap between the two sides: the older side is expected to win by
about two runs per year of age, a prior the data then refines. An 8U losing by
about that much to a 9U comes out even rather than punished. Strength of schedule
is read from each team's own seat, so it weighs heavier for the team playing up
and lighter for the one playing down.

**Pooling the fit is not pooling the tables.** Each level lists only its own
teams — a 9U that beats an 11U in a tournament stays on the 9U page, and the 11U
page never shows it. What the pool changes is that the game counts for both of
them rather than being discarded or counted as if they were the same age.

A team is listed on the page for the level it actually plays at: its GameChanger
level where that is known, otherwise the level recorded on most of its games. So
a 10U that spent the year playing down is rated alongside the 9Us it played and
listed on the 10U page — which is also why its panel counts the whole pool, or it
would read 0-0 beneath a row saying otherwise.

With no cross-age games in a pool, the arithmetic is exactly what it was before.

Only 9U and up get a table. 8U results are kept as evidence about the 9U teams
that played down against them, but at that age the results say more about which
league is machine pitch than about the teams.

Above 150 teams the fit switches from Gaussian elimination to conjugate gradient,
which is what makes a nationwide pool solvable at all; the two agree to within
1e-6 on a 300-team graph. It runs in a Web Worker, so the page does not lock up
while it refits — the table keeps the last true answer and says it is refitting.

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
| Score detail          | `Runs only` (the default) or `Full box score`. Runs alone drive the standings, the records and every projection; the fuller box score only adds the per-game stat pages.  |
| Score errors          | Full box score and Kid Pitch only. Off drops the E box from score entry and E/G from the stat pages.                                                                      |
| Win / Tie points      | League standings, simulations, and Gold status.                                                                                                                           |
| Tiebreaker order      | Score tiebreakers after league points and fewer losses: two-team head-to-head, run differential, runs allowed, runs scored.                                               |
| Team Rankings results | Whether tournament games logged in Team Rankings sharpen this league's game forecasts (`useScoutResults`). Forecasts only — records and standings are always league-only. |
| Recap grouping        | Builds stories per game, date, or week.                                                                                                                                   |
| Model aggression      | Prediction weighting profile.                                                                                                                                             |

## Data + persistence

- `league_teams_v1`, `league_matchups_v1`, `league_logs_v1`, `league_settings_v1`
- Team Rankings keeps its own keys, shared across seasons:
  `league_forecast_scout_teams_v1`, `league_forecast_scout_games_v1`,
  `league_forecast_scout_age_groups_v1`, plus `league_forecast_gc_pull_v1` (an
  interrupted pull's place) and `league_forecast_gc_refresh_v1` (the rota's record)
- `league_undo_snapshot_v1`
- League stories are generated locally from standings facts. With `GEMINI_API_KEY` set, Gemini rewrites the same facts into prose; see [AI league story](#ai-league-story). No key is required for the app to work.
- One-time migration from older `league_*` keys
- CSV import/export with BOM/formula guard handling

### Where the Team Rankings pool lives

League Standings stays in `localStorage`. The Team Rankings pool outgrew it once
a GameChanger pull was possible, so it lives in **IndexedDB** — hundreds of
megabytes, often as much as the disk allows, and free in exactly the way
`localStorage` is free: it is the user's own machine.

It is also written compactly. Rows are tuples and anything repeated is an index
into a dictionary, so a game that read

```json
{"id":"gc_gcTEAM12_0-1-0","teamAId":"S-CLUB2","teamAScore":5,…,"source":{…}}
```

is stored as `[2,3,5,3,0,212,0,9,9,0,0,"0-1-0"]`. Measured across pools the size
of a real pull, that is **5.3 to 5.7 times smaller**: four thousand teams take
2.69 MB rather than 14.36.

|                            | Pool it holds                                     |
| -------------------------- | ------------------------------------------------- |
| `localStorage`, as objects | about 2,500 teams                                 |
| `localStorage`, compact    | about 14,000                                      |
| IndexedDB, compact         | far past anything a browser will be asked to rank |

IndexedDB is asynchronous and this app reads its pool during render, so the pool
is read into memory once before anything mounts and the synchronous reads stay
synchronous; writes go out behind them, coalesced per key. A write is therefore
reported as _accepted_ rather than as landed, and one that later fails surfaces
as a toast, which is the only thing left that can still say so.

Moving across is all or nothing: a value that will not write abandons the whole
migration with `localStorage` untouched, and the old copies are dropped only once
every value is known to be in the new store. A browser without IndexedDB — a
private window, an old one, blocked site data — never leaves the `localStorage`
path, which is unchanged.

**The games are stored one key per squad year.** Every game the pool had ever
seen used to live under one key, and reading the pool meant decoding all of it:
two hundred thousand objects for the season on screen and as many again for the
one before it, which nobody was looking at. A squad year is already its own
rating pool — nothing in one year's fit reads another year's games — so it is the
unit of storage too. The Team Rankings view decodes the year on screen and keeps
that one; switching years decodes the other and lets the first go. What needs the
whole pool — a tidy, a pull, a backup, an archive, merging or renaming a club,
the search box that finds a club on another year's page — reads every year from
storage at the moment it runs and holds it only that long. Saving one year cannot
touch another: a game filed under another year's page is laid over that year's
copy by id rather than lost with the page it left. Changing an age group's year
moves its games; deleting the group files them with the yearless, where nothing
shows them and nothing loses them. Teams are not split, because one copy of a
club is the only way a rename in one year is a rename in both. A pool written the
old way is moved across on startup, and the old key emptied only once every
year's write has been confirmed. The League Standings side reads only the years
its linked age groups sit in.

**Saving the whole pool is not something a caller is taken at its word on.** The
save that rewrites every squad year used to empty any year the array it was
handed had no games for, which reads as obviously right — a caller holding the
whole pool has nothing for a year only when that year is empty. It is ruinous for
a caller that is not holding the whole pool, and "the whole pool" is a claim
about the caller that the array itself cannot make. The Import section was given
an empty array by a wiring mistake, so the GameChanger panel folded a pull into
nothing and saved that over everything; a hundred thousand games went and the
pull reported success. Now a stored year the save has no games for is left
exactly as it was unless the save names that year, and the save comes back with
the years it spared — which a caller that really does hold the whole pool never
has any of. Emptying every year at once is its own function, `replaceScoutGames`,
and restoring a backup is the only caller of it. The check costs nothing: a year
with no games is dropped rather than written empty, so the stored keys already
are the years that hold games. It is not a whole guarantee, and is not meant to
read as one — a save holding a year's games can still overwrite that year with
fewer of them, and nothing here can tell that from a deletion somebody asked for.
What it closes is the whole-year case, which is the one that loses a season.

**A squad year leaves whole, archived or deleted.** Setup's **Archive or delete a season**
card takes one baseball year at a time — every age on it, because they are rated together
and taking one page would quietly change the tables of the rest. **Archive** freezes each
page's final tables, a half at a time, and then lets the games go. **Delete** keeps nothing
(`deleteSquadYear`): the year's pages, every stored game filed under them, the clubs that
played in no other year, and any tables already archived from it. A club that also plays in
another year stays, since one copy of a club is how a rename reaches both years, but loses
the GameChanger ids filed under the deleted pages: those ids are that year's squads, and a
link left to a page that is gone would be the one trace of the year still in the pool. A
page that carried a squad on from one of the year's pages stops doing so. League Standings
keeps its seasons either way; only the links from the deleted pages go, so their fixtures
stop feeding a ranking. The confirmation says how many pages, games and clubs go, and how
many clubs stay without that year's ids.

### Backups

**Backup JSON is a whole-browser backup.** It carries every storage key this app
owns, not just the season you happen to be looking at:

| Storage                                                         | In the file                                         |
| --------------------------------------------------------------- | --------------------------------------------------- |
| `league_seasons_v1`, `league_active_season_v1`                  | `seasons[].id`/`name`/`createdAt`, `activeSeasonId` |
| `league_season_<id>_{teams,matchups,logs,bracketLogs,settings}` | one `seasons[]` entry per season                    |
| `league_forecast_scout_{teams,games,age_groups}_v1`             | `teamRankings`                                      |
| `nkb_theme_v1`, `lf_app_mode_v1`                                | `preferences`                                       |
| `league_season_<id>_undo_v1`                                    | **omitted on purpose** — see below                  |

The one omission is each season's undo snapshot. It is scratch state for a
single action, it duplicates the season it belongs to (so carrying it would
roughly double the file), and restoring a stale one would offer an "undo" back
to a state from some other session.

The active season is read from live app state rather than storage, because
score writes are debounced — a backup taken right after typing a score would
otherwise miss it.

**Export CSV stays season-scoped**: this season's schedule, then `# Section:`
blocks for the Team Rankings age groups, ranked teams, and logged games. A
`# Section: <name>` line opens each block — one cell in a spreadsheet, and a
line no header or data row can be mistaken for. Names are written beside the
IDs to keep the file readable, but the IDs are what a restore reads.

#### Restoring

Importing a JSON backup does one of two things, decided by the file:

| File                                             | Effect                                                                                        |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Has `seasons[]` (current format)                 | Replaces **everything** in this browser: all seasons, the Team Rankings pool, theme and mode. |
| Has top-level `teams`/`matchups`/`logs` (pre-v2) | Replaces the active season only, as it always did, and stays undoable.                        |

A whole-browser restore reaches further than the undo snapshot can hold — a
season the backup does not carry is gone — so it is not offered as undoable.
Instead the confirmation dialog lists every season in the file and says plainly
what is being replaced, and the toast afterwards offers **Download replaced
data**: a backup of the state that was just overwritten, built before the write.

For the Team Rankings pool specifically, restoring **replaces** it rather than
merging into it, since one backup carries every age group. Both import dialogs
say so, including the case a count would not reveal: a file saved while the pool
was empty clears it. A file with no rankings data at all — including any backup
written before this shipped — leaves the live pool exactly as it is.

A CSV with no section markers is treated as all schedule, so every CSV exported
before sections existed, and every hand-made one, still imports unchanged.

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
- The rankings worker keeps one decoded pool and the page names it by revision.
  The pool crosses to it only when the pool itself changes, in the compact form
  IndexedDB stores, and a page switch, a half of the year or a different "my
  team" ships nothing at all. Measured on a 40,000-team, 400,000-game pool, the
  copy every request used to carry was 125 MB on the wire and about 3.3 s of
  serialising and deserialising; the compact shipment is 33 MB and about 0.7 s,
  and it happens once per change rather than once per fit. The tidy worker takes
  the pool the same way and hands back only the parts it changed, so a tidy that
  found nothing to do no longer re-saves the whole pool.
- The Monte Carlo loop copies the league once per simulated season and writes
  results onto that copy, rather than copying every team per game; on twelve
  teams and sixty games that took 220 seasons from 195 ms to 7 ms. It stops
  once every team's odds are known to two points by the same Wilson interval
  shown beside them, with a ceiling of 4,000 seasons, and the ± on screen is
  computed from the seasons actually played.
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
