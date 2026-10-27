/**
 * The bundle budget (2.1): what a visit downloads, measured from the build in `dist/` and held to
 * limits, so a change that makes the first visit or a view heavier says so by name instead of
 * passing unnoticed. Run after `npm run build`: `npm run bundle:check`.
 *
 * Sizes are gzipped, as a browser receives them (level 9; a CDN's brotli is smaller still), of the
 * JavaScript and CSS a visit actually fetches. Source maps are built too, but no browser downloads
 * them, so they are left out rather than inflating the numbers.
 *
 * - **First download**: the page's entry script, everything it preloads, and its stylesheet.
 * - **A view's own load**: what opening it fetches beyond the first download, its chunk and every
 *   chunk that one imports that the first download has not already brought.
 *
 * Writes the numbers to `dist/bundle-report.json` for any later comparison, prints them, and exits
 * non-zero naming each limit passed. A limit sits above what it measured when set (below), so an
 * ordinary change fits and a real regression does not; raising one is a deliberate edit here whose
 * commit says why.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const DIST = "dist";

/**
 * Limits, in gzipped bytes: about a tenth above what each measured when set (9 Oct 2026, after the
 * League views were split), and at least 1.5 KB above for the small views, where a tenth is a
 * line of markup. Before the split the first download was 261.6 KB with a 120.1 KB entry chunk,
 * and every League view was in it.
 *
 * Raised since, each by its commit: Forecast to 18.3 KB on 10 Oct 2026 for saved playoff scenarios
 * (2.7), which measured 16.6 KB against 12.1 KB before; opening a scenario link is kept out of it,
 * fetched only when a link is opened. Dashboard to 6.4 KB the same day for the forecast
 * explanations (2.8), 5.8 KB against 5.3 KB: each prediction card's "Why…?" button and what loads
 * its explanation, which is itself 3.7 KB fetched only when one is opened. The entry chunk to
 * 97.5 KB the same day for the fixes of Phase 2's final review, 96.4 KB against 94.5 KB before, as
 * built after each area's commits: the Data Quality findings the Dashboard counts (doubleheaders,
 * one timeline of dates, what a copy holds) 0.6 KB, Since you last looked across tabs 0.4, the
 * team panel and comparison failing alone with Close 0.3, the phone bar's More and focus 0.2,
 * letting go of a deleted season's state 0.2, the held scenario link 0.1 and the Range caption
 * 0.1. Each corrects what the shell already did, so none is a chunk of its own to split off.
 * Team Rankings to 156.0 KB on 18 Oct 2026 for Pool health's leaders with few outside games, 153.7
 * KB against 151.8 KB before. Their section is fetched only once a look lists some; what is left
 * is the reader of the server's answer and the device's own sum for a page with no worker. Fetched
 * apart, that sum split shared storage code out of the first download and made it 0.7 KB heavier,
 * so it stays. Team Rankings to 157.5 KB the same day for the card of teams waiting on an age
 * showing only the teams a person can answer, 156.7 KB against 155.7 KB on main: the queue's five
 * reasons for setting a row aside, the counts and the line under the ten, and the notes, checks and
 * reasons a found row is drawn with. The reader of the server's answers takes the rule asides and
 * the search's fields from modules of their own, which keeps the queue and the import it reads in
 * Setup's chunk; read from the queue, they split that chunk in two and made it 0.3 KB heavier.
 * Fetched apart, the card split shared storage code out of the first download, 0.9 KB heavier and
 * past that limit, so it stays. Team Rankings to 158.3 KB on 19 Oct 2026 for the namesake join
 * reading a stand-in that shares no word with the namer's name, 157.5 KB against 157.3 KB on main:
 * the guards that reading is held to and the index of every name a pulled club is listed under,
 * since the tidy's code is part of that load. Team Rankings to 159.0 KB on 23 Oct 2026 for Bring it
 * back in Find a team, 158.4 KB against 158.2 KB on main: the offer beside a deleted team's id, the
 * answers edit that takes it off the deleted list, and the line the search says after. Team
 * Rankings to 159.5 KB the same day for filing a team below the opponents' bar at the oldest age it
 * has played, 159.1 KB against 158.8 KB on main: the oldest opponent's age read as a pull files a
 * team (`opponentAgeBar`) and the waiting list's rule for it, since the import's code is part of
 * that load. Team Rankings to 160.0 KB the same day for Codex's two findings on that change, 159.5
 * KB against 159.2 KB before them: a club's rows moved off the guess carry its level, and the
 * import's index is read again for the clubs a pull moved (`restatePlaces`). The first download to
 * 255.0 KB on 25 Oct 2026 for the League season tools, 254.2 KB against 252.0 KB on main (the entry
 * chunk 92.7 KB against 90.9): the Our team card's needed results (`neededResults`, `needsLines`)
 * and its next game's Gold chance with a win and a loss and who to root for (`goldSwing`, and the
 * counts the Gold odds run keeps for the team followed), the Season over line (`seasonFinalOf`), and
 * the title odds taking bracket games already played. Each is worked out where the Dashboard and the
 * odds already are, so none is a chunk of its own; the race chart's table walk, which only the
 * Forecast draws, is fetched with the chart. Settings to 13.5 KB on 26 Oct 2026 for Seasons at a
 * glance, 13.3 KB against 12.6 KB before: the Seasons card's toggle, and the boundary and loader
 * its own download is drawn through, 0.24 KB; and 0.43 KB for the list of files Vite hands its
 * loader with that download (`__vite__mapDeps`), which names every file of the first download
 * because the glance reads the brackets, the Season over line and League kept live's stored copies
 * from the entry chunk. Started from the entry chunk instead, a list would be in the first
 * download, which has the least room. The glance itself is a view of its own below, fetched only
 * once opened, with a limit set as the small views' were, 1.5 KB above what it measured. Team
 * Rankings to 161.0 KB the same day for the League schedule paste, 160.4 KB against 160.0 KB on
 * main (160,373 bytes against 159,956), with no Team Rankings code changed: the paste reads its
 * cells and dates with the schedule reader Team Rankings' schedule import uses (`scheduleText.ts`),
 * so the build moved that reader out of the Games section's chunk into one the two share. The
 * section's chunk went from 9.3 KB to 6.8 KB and the reader's own is 2.9 KB: the same code,
 * compressing 0.4 KB worse in two files than in one. Team Rankings to 161.5 KB the same day for
 * starting a League season from a GameChanger organization, 161.0 KB against 160.4 KB on main
 * (160,953 bytes against 160,438), again with no Team Rankings code changed: the organization's
 * panel pulls its teams' schedules with the client Team Rankings' pulls use
 * (`gameChangerClient.ts`), so the build moved that client out of Team Rankings' chunk into one the
 * two share. The view's chunk went from 44.1 KB to 41.8 KB and the client's own is 2.8 KB, 0.5 KB
 * worse in two files than in one. The organization's own request is a module of its own
 * (`gcOrgClient.ts`), fetched with the panel, so Team Rankings does not carry it; in the client,
 * it had made this 161.1 KB. Forecast to 18.8 KB on 26 Oct 2026 for the small fixes of PR 7, 18.6 KB
 * against 18.1 KB on main (18,587 bytes against 18,148): Model Health's mark for the chance given
 * and its Brier note beside a coin flip's, the "Why" panel and the AI panel's words for a league
 * with no cut line or a caller off the cloud copy's list, and the seed range worked out from any
 * tab. Team Rankings to 162.0 KB the same day for the same PR, 161.7 KB against 161.2 KB on main
 * (161,742 bytes against 161,167): "Add our next opponents" kept to the next weekend
 * (`nextWeekend.ts`), the schedule reader's start times, age ranges and turning year, which Team
 * Rankings' schedule import shares, and a stand-in a league team is carried onto listed as its
 * club. Settings to 13.7 KB the same day for the same PR, 13.5 KB against 13.3 KB on main (13,506
 * bytes against 13,279): the line offering what the last restore replaced, and the notification
 * choices with no cut-line words in a league without a cut. The first download went the other way,
 * 253.7 KB against 254.1 KB on main: the two-tab
 * protocol (`tabTurnChannel.ts`), its banner and the AI health check are fetched when needed, and
 * four imports that reached first-download code from a view's chunk were cut, each of which had
 * made the build split shared code out of the first download into files of their own (the
 * confidence words, `confidenceTier.ts`; the restore's kept data, handed to Settings by App; the
 * AI panel's check, by a context; and the summaries' members-only words, beside the summaries'
 * types). Before those it was 257.6 KB. Team Rankings to 162.5 KB on 27 Oct 2026 for the My Team
 * card's standing line, 162.1 KB against 161.9 KB on main (162,078 bytes against 161,946): the
 * line draws each week's place as a share of that week's board (`topShare`, `StandingLine`), with
 * the count of each past board carried beside its places (`pastBoardAsOf`).
 */
const BUDGET = {
  firstDownload: 255_000,
  entryChunk: 97_500,
  css: 15_200,
  views: {
    Dashboard: 6_400,
    "Power Ratings": 3_800,
    Schedule: 8_200,
    Standings: 8_000,
    "League Stats": 3_700,
    Forecast: 18_800,
    "Data Quality": 3_500,
    Settings: 13_700,
    "Seasons at a glance": 4_400,
    "Team Rankings": 162_500,
  },
};

/** The modules each view loads from, as the build manifest names them. */
const VIEWS = {
  Dashboard: ["src/components/league/DashboardView.tsx"],
  "Power Ratings": ["src/components/league/PowerRatingsView.tsx"],
  Schedule: ["src/components/league/GamesView.tsx"],
  Standings: ["src/components/league/StandingsView.tsx"],
  "League Stats": ["src/components/league/TeamStatsView.tsx"],
  Forecast: ["src/components/league/ModelView.tsx", "src/components/league/PlayoffMachine.tsx"],
  "Data Quality": ["src/components/league/DataQualityView.tsx"],
  Settings: [
    "src/components/league/SeasonManager.tsx",
    "src/components/ScoutLinkPanel.tsx",
    "src/components/league/SettingsView.tsx",
  ],
  "Seasons at a glance": ["src/components/league/SeasonsAtAGlance.tsx"],
  "Team Rankings": ["src/components/TeamRankingsView.tsx"],
};

const gzipped = new Map();
const sizeOf = (file) => {
  if (!gzipped.has(file)) {
    gzipped.set(file, gzipSync(readFileSync(`${DIST}/${file}`), { level: 9 }).length);
  }
  return gzipped.get(file);
};

const manifest = JSON.parse(readFileSync(`${DIST}/.vite/manifest.json`, "utf8"));
const html = readFileSync(`${DIST}/index.html`, "utf8");

/** The page's own downloads: its entry script, what it preloads, and its stylesheets. */
const first = new Set(
  [...html.matchAll(/(?:src|href)="\/?(assets\/[^"]+\.(?:js|css))"/g)].map((match) => match[1])
);

/** A module's chunk and every chunk it imports statically, with their stylesheets. */
const closure = (key, into = new Set()) => {
  const entry = manifest[key];
  if (!entry) throw new Error(`The build manifest has no ${key}: was the module renamed?`);
  if (into.has(entry.file)) return into;
  into.add(entry.file);
  for (const css of entry.css ?? []) into.add(css);
  for (const imported of entry.imports ?? []) closure(imported, into);
  return into;
};

const total = (files) => [...files].reduce((sum, file) => sum + sizeOf(file), 0);
const entryFile = manifest["index.html"]?.file;
const report = {
  firstDownload: total(first),
  entryChunk: entryFile ? sizeOf(entryFile) : 0,
  css: total([...first].filter((file) => file.endsWith(".css"))),
  views: Object.fromEntries(
    Object.entries(VIEWS).map(([view, modules]) => {
      const files = new Set();
      modules.forEach((module) => closure(module, files));
      return [view, total([...files].filter((file) => !first.has(file)))];
    })
  ),
};

writeFileSync(
  `${DIST}/bundle-report.json`,
  `${JSON.stringify({ budget: BUDGET, report }, null, 2)}\n`
);

const kb = (bytes) => `${(bytes / 1000).toFixed(1)} KB`;
const over = [];
const line = (name, measured, limit) => {
  const mark = measured > limit ? "OVER" : "ok";
  if (measured > limit) over.push(`${name}: ${kb(measured)} against a limit of ${kb(limit)}`);
  console.log(`${mark.padEnd(5)}${name.padEnd(28)}${kb(measured).padStart(10)}  of ${kb(limit)}`);
};
console.log("Gzipped downloads, against the budget (scripts/bundleBudget.mjs):");
line("First download", report.firstDownload, BUDGET.firstDownload);
line("Entry chunk", report.entryChunk, BUDGET.entryChunk);
line("Stylesheet", report.css, BUDGET.css);
for (const [view, measured] of Object.entries(report.views)) {
  line(`Opening ${view}`, measured, BUDGET.views[view]);
}
if (over.length > 0) {
  for (const message of over) console.log(`::error::Over the bundle budget: ${message}`);
  process.exit(1);
}
