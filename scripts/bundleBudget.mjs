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
 */
const BUDGET = {
  firstDownload: 252_000,
  entryChunk: 95_500,
  css: 15_200,
  views: {
    Dashboard: 5_500,
    "Power Ratings": 3_800,
    Schedule: 8_200,
    Standings: 8_000,
    "League Stats": 3_700,
    Forecast: 13_200,
    "Data Quality": 3_500,
    Settings: 12_600,
    "Team Rankings": 153_000,
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
