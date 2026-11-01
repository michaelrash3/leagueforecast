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
 * - **A Team Rankings section's own load**: what opening it fetches beyond the first download and
 *   Team Rankings' own load, since a section is only ever opened from the page.
 * - **Team Rankings' modules at start**: which of the modules only Team Rankings runs the first
 *   download holds, read off the build's source maps. None may be there (`TEAM_RANKINGS_ONLY`).
 *
 * Writes the numbers to `dist/bundle-report.json` for any later comparison, prints them, and exits
 * non-zero naming each limit passed. A limit sits above what it measured when set (below), so an
 * ordinary change fits and a real regression does not; raising one is a deliberate edit here whose
 * commit says why.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const DIST = "dist";
/** The project's root, which a source map's paths are read against. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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
 * the count of each past board carried beside its places (`pastBoardAsOf`). Team Rankings to 164.5
 * KB the same day for The Weekly, 163.9 KB against 162.1 KB on main (163,866 bytes against
 * 162,078): the week's upsets, game ahead and streaks worked out on the device (`theWeekly.ts`), the
 * card that says them and the club's own week, the Games tab's Upsets, and the reader of a published
 * board's week. The first download, 252.9 KB against 252.6 KB, carries that reader with the board's.
 * Team Rankings to 165.5 KB the same day for the My Team card's season and a club's form, 164.8 KB
 * against 163.9 KB on main (164,834 bytes against 163,944): the schedule's rank in its state, the
 * record beside the one the ratings expected and its one-run games, the weekend ahead, and the
 * panel's last five games against the margins expected (`clubForm.ts`). They are added on the Team
 * Rankings pages (`withSeason`) rather than in `myTeamGlance`, which League Standings reads: there
 * they had put 0.8 KB on the first download, which stays 252.9 KB.
 * Team Rankings to 166.5 KB on 28 Oct 2026 for the one pulled club of a name near the namer (tidy
 * rules 34, `oneNamesake`), 165.5 KB against 164.9 KB on main (165,471 bytes against 164,886): the
 * rule, the pulled clubs' names read loosely, and the two clubs' shared opponents it reads a club
 * far off by, all in the tidy, which is part of that load. The loose reading of a name moved beside
 * `teamNameKey` rather than bringing the stand-in report into the chunk, which had put it over; the
 * first download, 253.4 KB against 253.3 KB, carries the few lines of it. Dashboard to 6.8 KB on
 * 29 Oct 2026 for the phone's Dashboard, 6.5 KB against 6.2 KB before: each upcoming game as one
 * line on a phone until it is opened (`PredictionLine`) and the width read that decides it.
 * Dashboard to 7.0 KB on 30 Oct 2026 for "Since you last looked", 6.9 KB against 6.7 KB before
 * (6,894 bytes against 6,688): the load of the card and the boundary around it, the forecasts and
 * names it is handed, and the digest it stands in for. The card itself is a view of its own below,
 * fetched as the Dashboard opens, with a limit set as the small views' were, 1.5 KB above what it
 * measured; it builds the season's games from the records App holds rather than App building them,
 * which had put the first download at 255.0 KB.
 * The first download went the other way on 30 Oct 2026, 248.0 KB against 254.9 KB on main (247,951
 * bytes against 254,912), with nothing removed and nothing fetched later: the logic the page loads
 * at start is one boot chunk (`bootChunk.ts`), where the bundler had cut it into the entry chunk and
 * 23 files of what it shares with later views, each compressed afresh and carrying its own imports
 * and exports. The entry chunk keeps the components, 41.7 KB, so its line now has room it did not;
 * the first download's line, which holds both, is the one that binds. Team Rankings went from 166.2
 * KB to 165.3 KB with it, and each League view by 0 to 0.4 KB.
 * Team Rankings came down on 31 Oct 2026, 60.3 KB against 166.2 KB on main (60,292 bytes against
 * 166,193), with nothing removed: each section's code is fetched as the section is first opened
 * (`teamRankings/sections.ts`), and the tidy's stamp (`tidyStamp.ts`) and the pool's packing for
 * the tidy worker (`tidyWire.ts`) are modules of their own, so opening the page no longer fetches
 * the tidy: the Import and Setup sections do as they open, since they name its steps and read the
 * pool through it, and the page does to run it with no worker. Its line comes down to 62.0 KB, 1.7
 * KB above what it measured, so what left stays out. Each section is a line of its own below, set
 * as the views' were, a tenth above what it measured and at least 1.5 KB: Games 10.9 KB (10,882
 * bytes), Import, the GameChanger pull, 57.8 (57,776), Scouting 7.4 (7,442), its tournament panel
 * 3.6 (3,610), Archive 2.3 (2,321) and Setup 68.9 (68,918). The first download is 251.8 KB, as it
 * was.
 * The first download came down the same day, 221.2 KB against 251.8 KB on main (221,174 bytes
 * against 251,816), with nothing removed: modules whose few lines League Standings' start reads sat
 * beside a great deal only Team Rankings runs, and the first download carried all of it. Each was
 * split along that line (README "Performance notes"), and the check below holds what is left of
 * them out of the first download by name (`TEAM_RANKINGS_ONLY`). Its line stays at 255.0 KB, the
 * owner's to lower. What left is fetched where it runs: the rating fit, the roster's names and the
 * copies of a game with Team Rankings, whose open went from 60.3 KB to 84.1 KB (60,292 bytes to
 * 84,108), and the GameChanger client's parsers, the pull's tracker and the refresh's schedule with
 * the sections that pull and tidy, Import 67.7 KB against 57.8 (67,690 bytes) and Setup 75.9 KB
 * against 68.9 (75,895). A first visit straight to Team Rankings fetches 305.3 KB, against 312.1 KB
 * with the sections alone on demand and 418.0 KB on main. The Team Rankings line goes to 86.0 KB,
 * 1.9 KB above what it measured, Import's to 74.5 KB and Setup's to 83.5 KB, a tenth above; the
 * other sections and League Standings' views moved by under 0.1 KB.
 * Dashboard to 7.5 KB on 1 Nov 2026 for each prediction card reading as one forecast, 7.3 KB
 * against 6.9 KB on main (7,301 bytes against 6,928): the Model Read in the per-game model's own
 * terms (`modelRead.ts`), which only the Dashboard shows, and the card's margin, expected score and
 * both ranges read off that model's forecast rather than the prediction engine's. The forecast
 * itself, the ranges the Gold odds draw a game within (`forecastGame`, `drawnMarginSpan`), is worked
 * out where the chance beside it already was, in the first download, 222.8 KB against 222.6 KB
 * (222,809 bytes against 222,563), less the engine's measured ranges, which went with it.
 */
const BUDGET = {
  firstDownload: 255_000,
  entryChunk: 97_500,
  css: 15_200,
  views: {
    Dashboard: 7_500,
    "Power Ratings": 3_800,
    Schedule: 8_200,
    Standings: 8_000,
    "League Stats": 3_700,
    Forecast: 18_800,
    "Data Quality": 3_500,
    Settings: 13_700,
    "Seasons at a glance": 4_400,
    "Since you last looked": 4_500,
    "Team Rankings": 86_000,
  },
  sections: {
    Games: 12_400,
    Import: 74_500,
    Scouting: 9_000,
    Tournament: 5_200,
    Archive: 3_900,
    Setup: 83_500,
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
  "Since you last looked": ["src/components/league/SinceLastLook.tsx"],
  "Team Rankings": ["src/components/TeamRankingsView.tsx"],
};

/**
 * The modules each Team Rankings section loads from (`teamRankings/sections.ts`). The tournament
 * panel is drawn below the scouting report and loads beside it, but is a chunk of its own.
 */
const SECTIONS = {
  Games: ["src/components/teamRankings/GamesSection.tsx"],
  Import: ["src/components/GameChangerImportPanel.tsx"],
  Scouting: ["src/components/teamRankings/ScoutingSection.tsx"],
  Tournament: ["src/components/teamRankings/TournamentPanel.tsx"],
  Archive: ["src/components/teamRankings/ArchiveSection.tsx"],
  Setup: ["src/components/teamRankings/SetupSection.tsx"],
};

/**
 * Modules only Team Rankings runs, which League Standings' first download must not hold. Each of
 * these, or the module it was split from, held what the page reads at start beside what only Team
 * Rankings runs, and the first download carried all of it: the start's part is now a module of its
 * own, and these are what is left (README "Performance notes"). With them are the two modules that
 * left the first download beside them, how much an old result still counts (`ratingRecency.ts`)
 * and the words in a name that say it is no team (`teamNameRules.ts`), and the tidy
 * (`gameChangerImport.ts`), which the first download never held and which is on its own about the
 * room that line has: 35.0 KB (35,046 bytes) against 33.8. A static import of one of them from
 * anything the page loads at start brings the whole module back into the first download, and the
 * first download's own line, which has room, would not say so; this does, by name. Read off the
 * source maps, which list every module a file of the build holds, and each must be in some file of
 * the build, or a rename would make the check pass for good.
 */
const TEAM_RANKINGS_ONLY = [
  "src/lib/teamRankings.ts",
  "src/lib/gameChangerApi.ts",
  "src/lib/pullTracker.ts",
  "src/lib/gameChangerSchedule.ts",
  "src/lib/scheduleCommunities.ts",
  "src/lib/teamRankings/opponentWeb.ts",
  "src/lib/live/views/boardShape.ts",
  "src/lib/notThisTeam.ts",
  "src/lib/teamRankingsArchive.ts",
  "src/lib/rankMovement.ts",
  "src/lib/teamRankings/rosterNames.ts",
  "src/lib/teamRankings/gameRows.ts",
  "src/lib/ratingRecency.ts",
  "src/lib/teamNameRules.ts",
  "src/lib/gameChangerImport.ts",
];

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

/** The source modules a built file holds, as its source map lists them. */
const sourcesOf = (file) => {
  if (!file.endsWith(".js")) return [];
  try {
    const map = JSON.parse(readFileSync(`${DIST}/${file}.map`, "utf8"));
    return map.sources.map((source) => relative(ROOT, resolve(dirname(`${DIST}/${file}`), source)));
  } catch {
    return [];
  }
};
const builtModules = new Set(
  Object.values(manifest).flatMap((entry) => (entry.file ? sourcesOf(entry.file) : []))
);
for (const module of TEAM_RANKINGS_ONLY) {
  if (!builtModules.has(module))
    throw new Error(`No file of the build holds ${module}: was the module renamed or removed?`);
}
const startModules = new Set([...first].flatMap(sourcesOf));
const entryFile = manifest["index.html"]?.file;
/** What a visit has once Team Rankings is open, which a section's own load is beyond. */
const rankingsOpen = new Set([...first, ...closure(VIEWS["Team Rankings"][0])]);
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
  sections: Object.fromEntries(
    Object.entries(SECTIONS).map(([section, modules]) => {
      const files = new Set();
      modules.forEach((module) => closure(module, files));
      return [section, total([...files].filter((file) => !rankingsOpen.has(file)))];
    })
  ),
  teamRankingsAtStart: TEAM_RANKINGS_ONLY.filter((module) => startModules.has(module)),
};

writeFileSync(
  `${DIST}/bundle-report.json`,
  `${JSON.stringify({ budget: BUDGET, report }, null, 2)}\n`
);

const kb = (bytes) => `${(bytes / 1000).toFixed(1)} KB`;
const over = [];
const line = (name, measured, limit, said = name) => {
  const mark = measured > limit ? "OVER" : "ok";
  if (measured > limit) over.push(`${said}: ${kb(measured)} against a limit of ${kb(limit)}`);
  console.log(`${mark.padEnd(5)}${name.padEnd(28)}${kb(measured).padStart(10)}  of ${kb(limit)}`);
};
console.log("Gzipped downloads, against the budget (scripts/bundleBudget.mjs):");
line("First download", report.firstDownload, BUDGET.firstDownload);
line("Entry chunk", report.entryChunk, BUDGET.entryChunk);
line("Stylesheet", report.css, BUDGET.css);
for (const [view, measured] of Object.entries(report.views)) {
  line(`Opening ${view}`, measured, BUDGET.views[view]);
}
for (const [section, measured] of Object.entries(report.sections)) {
  line(`  then ${section}`, measured, BUDGET.sections[section], `Team Rankings' ${section}`);
}
{
  const held = report.teamRankingsAtStart;
  for (const module of held)
    over.push(`the first download holds ${module}, which only Team Rankings runs`);
  const said = held.length === 0 ? `none of ${TEAM_RANKINGS_ONLY.length}` : held.join(", ");
  console.log(
    `${(held.length > 0 ? "OVER" : "ok").padEnd(5)}${"Team Rankings modules at start".padEnd(32)}${said}`
  );
}
if (over.length > 0) {
  for (const message of over) console.log(`::error::Over the bundle budget: ${message}`);
  process.exit(1);
}
