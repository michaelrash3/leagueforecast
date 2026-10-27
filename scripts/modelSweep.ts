/**
 * The research sweep of Team Rankings' model as shipped (PR 5), on a pool read once: how well the
 * boards' chances and margins forecast the games played after them, whether the fit's two settings
 * or the floor under a matchup's chance would forecast them better (`src/lib/modelSweep.ts`), and
 * how much of the squad year leans on stand-ins, the clubs a pool knows only by name
 * (`src/lib/standInReport.ts`). A research tool, as `recencySweep.ts` is: what it finds becomes a
 * constant by a later commit that pins the boards first.
 *
 *   npm run model:sweep -- <backup.json>      a backup the app wrote (`readSweepFile`)
 *   FIREBASE_SERVICE_ACCOUNT="$(cat key.json)" npm run model:sweep -- --cloud
 *                                             the cloud copy, read once, read only
 *   npm run model:sweep -- --fixture[=CLUBS]  the seeded pool (`poolFixture.ts`), clubs a page
 *
 * With --stand-in-rules it measures the stand-in rule instead (`src/lib/standInRules.ts`): the
 * whole pool tidied as the nightly tidies it, under the rules as shipped and under each reading of
 * `inStateNamesakes`, and for each how much of the year still leans on a stand-in or a slot and how
 * the rows it filed read (`readRules`).
 *
 * Options: --year=2027 (the squad year), --today=DAY (the board's day; the members' day by
 * default), --top=25 (the stand-ins named, most games first), --public (numbers only),
 * --seal=FILE with --seal-to-key=PEM (the named lines, sealed to that public key), and
 * --open=FILE --with-key=PEM (unseal one with the private key).
 *
 * The cloud copy is read as the nightly reads it (`cloudPool.ts`, `loadPoolFrom`), its League
 * Standings seasons as the publish reads them (`readCloudLeague`), on stores opened to read
 * (`openStores(key, false)`), so nothing here can write to it. Nothing is saved.
 *
 * On GitHub (`GITHUB_ACTIONS`), or with --public, it prints numbers only, since this repository and
 * its Actions logs are public: the stand-ins' names go only into the sealed file, which only the
 * private key's holder opens.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import {
  constants,
  createCipheriv,
  createDecipheriv,
  createPublicKey,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
} from "node:crypto";
import { coerceAutoRemovals, type AutoRemovals } from "../src/lib/autoRemoved.ts";
import {
  deriveAllKnown,
  gamesOnPages,
  type LeagueSeasonData,
  type SeasonReader,
} from "../src/lib/live/allKnown.ts";
import { asWorkerSees } from "../src/lib/live/views/board.ts";
import { readCloudLeague, seasonReaderOf } from "../src/lib/live/cloudLeague.ts";
import { fetchValues } from "../src/lib/cloud/cloudEngine.ts";
import { LEAGUE_PART } from "../src/lib/cloud/cloudPlan.ts";
import { loadPoolFrom, sparedByTidy } from "../src/lib/cloud/cloudRunner.ts";
import { failureWords } from "../src/lib/cloud/firestoreRest.ts";
import { todayIsoDay } from "../src/lib/date.ts";
import {
  describeTidy,
  SHIPPED_TIDY_RULES,
  tidyPool,
  type GcImportState,
  type TidyRules,
} from "../src/lib/gameChangerImport.ts";
import {
  MODEL_CUTS,
  MODEL_SCORE_FROM,
  runModelSweep,
  type ModelSweep,
} from "../src/lib/modelSweep.ts";
import type { PairedReading } from "../src/lib/scoutBacktest.ts";
import { standInReport, type StandInReport, type StandInWhy } from "../src/lib/standInReport.ts";
import {
  filedByName,
  leaningOf,
  readRules,
  slotsRead,
  wrongShare,
  type Leaning,
  type NearCount,
  type RuleReading,
} from "../src/lib/standInRules.ts";
import {
  loadAgeGroups,
  loadAutoRemoved,
  loadKeptApart,
  loadNotThisTeam,
  loadScoutGames,
  loadScoutGamesForYear,
  loadScoutTeams,
  resetTeamRankingsStore,
} from "../src/lib/teamRankingsStorage.ts";
import {
  ageGroupYear,
  rankingPoolGroupIds,
  scoutFitRanks,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
} from "../src/lib/teamRankings.ts";
import { openStores } from "./cloudPool.ts";
import { poolFixture } from "./poolFixture.ts";
import { readSweepFile, sweepTidy } from "./sweepTidy.ts";

declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  exitCode?: number;
  exit: (code?: number) => never;
  memoryUsage: () => { rss: number };
  stdout: { write: (text: string, done: () => void) => boolean };
};

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const found = args.find((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
  if (found === undefined) return undefined;
  return found.includes("=") ? found.slice(found.indexOf("=") + 1) : "";
};
const has = (name: string) => flag(name) !== undefined;

/** Whatever was read, laid out the same way: what follows cannot tell the sources apart. */
type Source = {
  label: string;
  ageGroups: AgeGroup[];
  teams: ScoutTeam[];
  gamesOfYear: (year: number) => ScoutGame[];
  /** Every year's games, for a tidy, which reads the pool whole as the nightly does. */
  allGames: () => ScoutGame[];
  readSeason: SeasonReader;
  leagueRead: boolean;
  autoRemoved: AutoRemovals;
  today: string;
};

const NO_SEASON: LeagueSeasonData = { teams: [], matchups: [], logs: {} };

const fromBackup = (path: string): Source => {
  const file = readSweepFile(readFileSync(path, "utf8"));
  if (!file) {
    throw new Error(
      `${path} is not a backup that holds a Team Rankings pool: export the Team Rankings JSON from` +
        ' Setup, or the whole-browser backup from Settings ("Backup JSON").'
    );
  }
  const { pool, seasons } = file;
  const tidy = sweepTidy(pool, seasons);
  describeTidy(tidy).forEach((note) => console.log(`  tidy: ${note}`));
  const { ageGroups, teams, games } = tidy.state;
  const yearOf = new Map(ageGroups.map((group) => [group.id, ageGroupYear(group)]));
  return {
    label: `the backup ${path}`,
    ageGroups,
    teams,
    gamesOfYear: (year) => games.filter((game) => yearOf.get(game.ageGroupId) === year),
    allGames: () => games,
    readSeason: seasons ?? (() => NO_SEASON),
    leagueRead: seasons !== null,
    autoRemoved: coerceAutoRemovals(pool.answers?.autoRemoved ?? []),
    today: flag("today") || todayIsoDay(),
  };
};

/** The seeded pool every live view is measured on: nobody's club, and every case a board turns on. */
const fromFixture = (): Source => {
  const clubsPerPage = Number(flag("fixture") || 300);
  const pool = poolFixture({ seed: 7, clubsPerPage });
  const yearOf = new Map(pool.ageGroups.map((group) => [group.id, ageGroupYear(group)]));
  return {
    label: `the seeded pool (${clubsPerPage} clubs a page)`,
    ageGroups: pool.ageGroups,
    teams: pool.teams,
    gamesOfYear: (year) => pool.games.filter((game) => yearOf.get(game.ageGroupId) === year),
    allGames: () => pool.games,
    readSeason: (id) => pool.seasons[id] ?? NO_SEASON,
    leagueRead: true,
    autoRemoved: coerceAutoRemovals([]),
    today: flag("today") || pool.today,
  };
};

/**
 * The cloud copy, read once into the app's pool store in memory, on stores opened to read; and its
 * League Standings seasons as the publish reads them, their documents or the copy's own part.
 */
const fromCloud = async (): Promise<Source> => {
  const key = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!key) throw new Error("No FIREBASE_SERVICE_ACCOUNT here, so there is no cloud copy to read.");
  const opened = openStores(key, false);
  const copy = await loadPoolFrom(opened.copy);
  if (!copy) throw new Error("There is no cloud copy yet.");
  console.log(`Read the cloud copy once: ${copy.keys} pieces, ${copy.bytes} bytes stored.`);
  let readSeason: SeasonReader = () => NO_SEASON;
  let leagueRead = false;
  try {
    const league = await readCloudLeague(opened.leagueDocs);
    if (league.ok && league.from === "docs") {
      readSeason = league.readSeason;
      leagueRead = true;
    } else if (league.ok) {
      const part = copy.manifest.parts.find((one) => one.key === LEAGUE_PART);
      const fetched = part ? await fetchValues({ store: opened.copy, parts: [part] }) : null;
      const reader = fetched?.ok ? seasonReaderOf(fetched.values.get(LEAGUE_PART)) : null;
      if (reader) {
        readSeason = reader;
        leagueRead = true;
      }
    }
  } catch (error) {
    console.log(`  League Standings could not be read (${failureWords(error)}); without it.`);
  }
  return {
    label: "the cloud copy",
    ageGroups: loadAgeGroups(),
    teams: loadScoutTeams(),
    gamesOfYear: loadScoutGamesForYear,
    allGames: loadScoutGames,
    readSeason,
    leagueRead,
    autoRemoved: loadAutoRemoved(),
    today: flag("today") || todayIsoDay(),
  };
};

/* ------------------------------------------------------------------------- sealing the names */

const SEALED_FORMAT = "league-forecast-model-sweep-sealed";
const OAEP = { padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" };

const toBase64 = (bytes: Uint8Array): string => {
  let text = "";
  for (let at = 0; at < bytes.length; at += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(text);
};
const fromBase64 = (text: string): Uint8Array =>
  Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const joined = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  parts.forEach((part) => {
    out.set(part, at);
    at += part.length;
  });
  return out;
};

/**
 * `text` sealed to `publicKey`: AES-256-GCM under a fresh key, that key under RSA-OAEP. Only the
 * holder of the private key opens it, so the sealed text may be printed in a public log.
 */
const seal = (text: string, publicKey: ReturnType<typeof createPublicKey>): string => {
  const aes = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", aes, iv);
  const data = joined(cipher.update(new TextEncoder().encode(text)), cipher.final());
  return JSON.stringify({
    format: SEALED_FORMAT,
    key: toBase64(publicEncrypt({ key: publicKey, ...OAEP }, aes)),
    iv: toBase64(iv),
    tag: toBase64(cipher.getAuthTag()),
    data: toBase64(data),
  });
};

const open = (sealed: string, privateKey: string): string => {
  const parsed = JSON.parse(sealed) as Record<string, string>;
  if (parsed.format !== SEALED_FORMAT) throw new Error("That is not a sealed model sweep.");
  const aes = privateDecrypt({ key: privateKey, ...OAEP }, fromBase64(parsed.key ?? ""));
  const decipher = createDecipheriv("aes-256-gcm", aes, fromBase64(parsed.iv ?? ""));
  decipher.setAuthTag(fromBase64(parsed.tag ?? ""));
  const text = joined(decipher.update(fromBase64(parsed.data ?? "")), decipher.final());
  return new TextDecoder().decode(text);
};

/* ----------------------------------------------------------------------------------- printing */

const publicLog = has("public") || process.env.GITHUB_ACTIONS === "true";
const printed: string[] = [];
const sealedLines: string[] = [];
const say = (line = "") => {
  console.log(line);
  printed.push(line);
};
/** Lines that name clubs: printed only where the log is private, sealed either way. */
const sayNamed = (lines: string[], heading: string) => {
  if (lines.length === 0) return;
  sealedLines.push(heading, ...lines, "");
  if (publicLog) {
    say(`  (${lines.length} line(s) naming clubs left out of this log; sealed)`);
    return;
  }
  say(`  ${heading}`);
  lines.forEach((line) => say(line));
};

const started = Date.now();
const since = () => `${((Date.now() - started) / 1000).toFixed(1)} s`;
const share = (part: number, whole: number) =>
  whole === 0 ? "-" : `${((100 * part) / whole).toFixed(1)}%`;
const fixed = (value: number, places = 4) => (Number.isFinite(value) ? value.toFixed(places) : "-");

/** A setting against the shipped one: lower is better, so a positive `by` is a gain. */
const paired = (reading: PairedReading | null | undefined, places = 4) => {
  if (!reading) return "-";
  const z = reading.standardError > 0 ? reading.by / reading.standardError : 0;
  const sign = reading.by >= 0 ? "+" : "";
  return `${sign}${reading.by.toFixed(places)} ± ${reading.standardError.toFixed(places)} (z ${z.toFixed(1)})`;
};

const describeSweep = (sweep: ModelSweep) => {
  say(
    `\n${"=".repeat(78)}\nThe model as shipped, and each setting moved on its own\n${"=".repeat(78)}`
  );
  if (sweep.cuts.length === 0) {
    say("No ranked page of that squad year: nothing to fit.");
    return;
  }
  say(
    "  cut         rated games before   scored after   decided   left out: across ages, stand-ins"
  );
  for (const cut of sweep.cuts) {
    say(
      `  ${cut.cut}  ${String(cut.trained).padStart(19)}  ${String(cut.scored).padStart(13)}  ${String(cut.decided).padStart(8)}  ${String(cut.crossAge).padStart(10)}  ${String(cut.standIns).padStart(9)}`
    );
  }
  say(
    `  Scored: ${sweep.games} games over the cuts, ${sweep.decided} of them decided; ` +
      `${sweep.crossAge} across ages and ${sweep.standIns} with a stand-in left out, ` +
      "since no board states those."
  );
  say("\n  Lower is better. Against the shipped model, game by game, + is better, z by club:");
  say(
    "  setting       log loss  Brier    margin²   log loss vs shipped        Brier vs shipped           margin² vs shipped        fits"
  );
  for (const variant of sweep.variants) {
    const vs = variant.vsShipped;
    say(
      `  ${variant.key.padEnd(12)}  ${fixed(variant.logLoss).padEnd(8)}  ${fixed(variant.brier).padEnd(7)}  ${fixed(variant.squared, 2).padStart(7)}   ${paired(vs?.logLoss).padEnd(25)}  ${paired(vs?.brier).padEnd(25)}  ${paired(vs?.squared, 3).padEnd(24)}  ${variant.seconds.toFixed(0)} s`
    );
  }
  say("\n  What each setting is:");
  for (const variant of sweep.variants) say(`    ${variant.key}: ${variant.why}`);
  say("\n  The shipped model's calibration: the favourite's chance, and how often it won:");
  say("    chance said     games   said    won");
  for (const band of sweep.calibration) {
    if (band.games === 0) continue;
    say(
      `    ${(band.from * 100).toFixed(0).padStart(3)}-${(band.to * 100).toFixed(0).padEnd(3)}%   ${String(band.games).padStart(9)}   ${(band.said * 100).toFixed(1).padStart(5)}%  ${(band.won * 100).toFixed(1).padStart(5)}%`
    );
  }
};

const describeStandIns = (report: StandInReport) => {
  say(
    `\n${"=".repeat(78)}\nStand-ins: clubs known only by name, and bracket slots\n${"=".repeat(78)}`
  );
  say(
    `  The year's games: ${report.games}; with a stand-in on a side: ${report.withStandIn}` +
      ` (${share(report.withStandIn, report.games)}).`
  );
  say(
    `  Played: ${report.played}; with a stand-in: ${report.playedWithStandIn}` +
      ` (${share(report.playedWithStandIn, report.played)}).`
  );
  say(
    `  Stand-ins holding a game: ${report.nameOnly} known only by name, ${report.placeholders} bracket slots.`
  );
  say(
    `  Of those known only by name: ${report.withNamesake} share a name with a club pulled this year` +
      ` (${share(report.withNamesake, report.nameOnly)}), ${report.withoutNamesake} have none.`
  );
  const bucket = (label: string, b: StandInReport["onPage"]) =>
    say(`    ${label}: ${b.clubs} clubs, holding ${b.games} games (${b.played} played)`);
  say("  The clubs known only by name, by where a pulled club of the same name is:");
  bucket("on a page they played on (likely the same club, not joined)", report.onPage);
  bucket("only on another page", report.elsewhere);
  bucket("nowhere (a club nobody has pulled)", report.unmatched);
  say(`  Played games against a bracket slot nobody resolved: ${report.slotPlayed}.`);
  if (report.top.length > 0) {
    say(
      `  The ${report.top.length} holding the most games: ${report.top.map((club) => club.games).join(", ")}.`
    );
  }
  sayNamed(
    report.top.map(
      (club) =>
        `    ${club.name} (${club.teamId}): ${club.games} games, ${club.played} played, ` +
        `${club.namesakes} pulled namesake(s)`
    ),
    "The stand-ins known only by name holding the most games:"
  );
  const reasons: Array<[StandInWhy, string]> = [
    [
      "oneSameState",
      "one pulled club of the name on its page, in the namers' state (should have joined)",
    ],
    ["oneOtherState", "one on its page, in another state"],
    ["several", "several of the name on its page"],
    ["nearOne", "none of the name on its page, one spelled near it"],
    ["nearSeveral", "none of the name on its page, several spelled near it"],
    ["elsewhere", "a namesake only on another page"],
    ["unmatched", "nothing of the name or near it (never pulled)"],
  ];
  say("  Why each club known only by name was not joined to a pulled club:");
  for (const [reason, label] of reasons) bucket(label, report.why[reason]);
  for (const [reason, label] of reasons) {
    sayNamed(
      report.topWhy[reason].map(
        (club) =>
          `    ${club.name} (${club.teamId}): ${club.games} games, ${club.played} played` +
          (club.candidate ? ` -> ${club.candidate.name} (${club.candidate.teamId})` : "")
      ),
      `Holding the most games, ${label}:`
    );
  }
};

/* ------------------------------------------------------------------- the stand-in rule, read */

/** The readings of the stand-in rule measured, the rules as shipped first. */
const RULE_READINGS: { key: string; why: string; rules: TidyRules }[] = [
  { key: "shipped", why: "the tidy as it ships", rules: SHIPPED_TIDY_RULES },
  {
    key: "in-state",
    why: "the one pulled club of the name in the namer's state, at the row's level, any name",
    rules: { inState: { rareAmong: 1, nearLevel: false } },
  },
  {
    key: "in-state-rare",
    why: "the same, only a name with a word in no more than 1 in 2,000 pulled clubs' names",
    rules: { inState: { rareAmong: 2_000, nearLevel: false } },
  },
  {
    key: "in-state-near",
    why: "the same as in-state, or failing one at the row's level, one a level either side",
    rules: { inState: { rareAmong: 1, nearLevel: true } },
  },
];

const describeLeaning = (label: string, leaning: Leaning) =>
  say(
    `  ${label}: ${leaning.withStandIn} of ${leaning.games} games lean on a stand-in or a slot` +
      ` (${share(leaning.withStandIn, leaning.games)}), ${leaning.playedWithStandIn} of` +
      ` ${leaning.played} played (${share(leaning.playedWithStandIn, leaning.played)});` +
      ` ${leaning.playedWithSlot} played against a slot; ${leaning.standIns} clubs known only by name.`
  );

const nearShare = (count: NearCount) =>
  `${count.near} of ${count.rows} (${share(count.near, count.rows)})`;

const describeReading = (reading: RuleReading, right: NearCount, why: string) => {
  say(`\n  ${reading.key}: ${why}`);
  say(
    `    tidy: ${reading.passes} pass(es), ${reading.refiled} rows refiled, ${reading.resettled}` +
      ` resettled, ${reading.named} slot or stand-in rows settled (${reading.seconds.toFixed(0)} s)`
  );
  describeLeaning("  after", reading.after);
  say(
    `    played slot games: ${reading.slots.played}; ${reading.slots.timed} with a start,` +
      ` ${reading.slots.standInAtTheHour} with a stand-in's row at the hour`
  );
  say(`    rows moved off a stand-in onto a pulled club: ${reading.moved.rows}`);
  say(
    `      between neighbours: ${nearShare(reading.moved)}; their decoys: ${nearShare(reading.decoy)}`
  );
  const wrong = wrongShare(reading.moved, reading.decoy, right);
  say(
    `      the share wrong, read between: ${wrong === null ? "-" : `${(100 * wrong).toFixed(1)}%`}`
  );
  sayNamed(
    reading.sample.map(
      (one) => `    ${one.namer} named "${one.name}" -> ${one.club} (${one.state})`
    ),
    `A sample of the rows ${reading.key} moved:`
  );
};

/**
 * The whole pool tidied under each reading, as the nightly tidies it: the pairs kept apart, the
 * names the owner refused, and the clubs it spares (`sparedByTidy`, every club where League was not
 * read). Each reading starts from the pool as read; the copy is not written.
 */
const measureStandInRules = (source: Source, year: number) => {
  say(`\n${"=".repeat(78)}\nThe stand-in rule, read on the whole pool\n${"=".repeat(78)}`);
  const pool: GcImportState = {
    ageGroups: source.ageGroups,
    teams: source.teams,
    games: source.allGames(),
  };
  const apart = loadKeptApart();
  const refused = loadNotThisTeam();
  const spared = sparedByTidy(pool, source.leagueRead ? source.readSeason : null);
  const tidy = (state: GcImportState, rules: TidyRules) =>
    tidyPool(state, undefined, apart, refused, spared, rules);
  describeLeaning("before", leaningOf(pool, year));
  const slots = slotsRead(pool, year);
  say(
    `  played slot games: ${slots.played}; ${slots.timed} with a start, ${slots.standInAtTheHour}` +
      " with a stand-in's row at the hour (the rest have nothing at that hour to pair with)"
  );
  const right = filedByName(pool, year);
  say(`  rows filed by name as shipped (the club's own schedules not holding them): ${right.rows}`);
  say(`    between neighbours: ${nearShare(right)} (how often a right reading of a name is)`);
  for (const { key, why, rules } of RULE_READINGS) {
    try {
      describeReading(
        readRules(pool, year, key, rules, tidy, Number(flag("top") || 25), () => performance.now()),
        right,
        why
      );
    } catch (error) {
      say(`  ${key} stopped: ${failureWords(error)}`);
      process.exitCode = 1;
    }
    say(`  (${key} done at ${since()})`);
  }
};

/* -------------------------------------------------------------------------------------- run */

const main = async (): Promise<void> => {
  const opening = flag("open");
  if (opening) {
    const pem = flag("with-key");
    if (!pem)
      throw new Error("Name the private key the names were sealed to: --with-key=<private.pem>.");
    console.log(open(readFileSync(opening, "utf8"), readFileSync(pem, "utf8")));
    return;
  }
  const path = args.find((arg) => !arg.startsWith("--"));
  if (!path && !has("cloud") && !has("fixture")) {
    console.log(
      "usage: npm run model:sweep -- <backup.json> | --cloud | --fixture[=CLUBS]  [options]\n" +
        "  see the head of scripts/modelSweep.ts for the options"
    );
    process.exitCode = 1;
    return;
  }
  const source = path ? fromBackup(path) : has("cloud") ? await fromCloud() : fromFixture();
  const year = Number(flag("year") || 2027);
  say(`Model sweep on ${source.label}, squad year ${year}, the board's day ${source.today}.`);
  say(
    `  ${source.ageGroups.length} pages, ${source.teams.length} teams; League Standings` +
      ` ${source.leagueRead ? "read" : "not read"}. Read in ${since()}.`
  );
  if (has("stand-in-rules")) {
    measureStandInRules(source, year);
    finish();
    return;
  }
  const page = source.ageGroups.find(
    (group) => ageGroupYear(group) === year && scoutFitRanks(group.id, source.ageGroups)
  );
  if (!page) {
    say(`No ranked page of squad year ${year} in this pool.`);
    process.exitCode = 1;
    return;
  }
  // The year's pool as the boards fit it: League Standings' games with the stored ones, the clubs
  // taken off left out, after the worker's codec, as the community sweep and the nightly read it.
  const known = deriveAllKnown({
    ageGroups: source.ageGroups,
    teams: source.teams,
    yearGames: source.gamesOfYear(year),
    readSeason: source.readSeason,
    autoRemoved: source.autoRemoved,
  });
  const pool = asWorkerSees(
    known.teams,
    gamesOnPages(known.games, rankingPoolGroupIds(page.id, source.ageGroups))
  );
  say(`  The year's pool: ${pool.teams.length} clubs, ${pool.games.length} games (${since()}).`);

  try {
    describeStandIns(
      standInReport(pool.teams, pool.games, source.ageGroups, year, Number(flag("top") || 25))
    );
    say(`  (the stand-ins done at ${since()})`);
  } catch (error) {
    say(`The stand-in report stopped: ${failureWords(error)}`);
    process.exitCode = 1;
  }

  try {
    const sweep = runModelSweep({
      ageGroups: source.ageGroups,
      teams: pool.teams,
      games: pool.games,
      year,
      cuts: MODEL_CUTS,
      scoreFrom: MODEL_SCORE_FROM,
      today: source.today,
      now: () => performance.now(),
    });
    describeSweep(sweep);
    say(`  (the model sweep done at ${since()})`);
  } catch (error) {
    say(`The model sweep stopped: ${failureWords(error)}`);
    process.exitCode = 1;
  }

  finish();
};

/** The named lines sealed, and the closing lines, whichever measurement ran. */
const finish = () => {
  const sealTo = flag("seal");
  const keyPem = flag("seal-to-key");
  if (sealTo && keyPem) {
    writeFileSync(
      sealTo,
      seal(sealedLines.join("\n"), createPublicKey(readFileSync(keyPem, "utf8")))
    );
    say(
      `\nThe ${sealedLines.length} named line(s) are sealed in ${sealTo}. Open them with the private key:` +
        `\n  npm run model:sweep -- --open=${sealTo} --with-key=<private.pem>`
    );
  } else if (sealTo) {
    say("\nNo --seal-to-key, so nothing was sealed.");
  }
  say(`\nDone in ${since()}, memory ${Math.round(process.memoryUsage().rss / 2 ** 20)} MB.`);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `\`\`\`text\n${printed.join("\n")}\n\`\`\`\n`);
};

try {
  await main();
} catch (error) {
  // The message only: nothing here quotes the key, and a stack adds nothing a public log needs.
  console.log(`The sweep stopped: ${failureWords(error)}`);
  process.exitCode = 1;
} finally {
  // The store opens a channel to other tabs that would keep the process alive.
  resetTeamRankingsStore();
}
// Written out before the exit: into a pipe, as on GitHub, the log's last lines were lost without it.
await new Promise<void>((done) => process.stdout.write("", done));
process.exit(process.exitCode ?? 0);
