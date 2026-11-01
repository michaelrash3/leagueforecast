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
 * With --league-models it measures League Standings' two win chances on its own seasons instead:
 * every final game of every season walked forward as the season's backtest walks it
 * (`walkForward`), each called from the finals before it and the Team Rankings results played
 * before its day, by the per-game model (`predictGame`) and by the prediction engine
 * (`buildPredictionEngine`), and both scored on who won. --min-played=N leaves out a game until each
 * side has N finals behind it (none, as the backtest asks).
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
import { coerceKeptApart, type KeptApart } from "../src/lib/keptApart.ts";
import {
  deriveAllKnown,
  gamesOnPages,
  leagueLinkedClubsOf,
  retiredWithPicks,
  type LeagueSeasonData,
  type SeasonReader,
} from "../src/lib/live/allKnown.ts";
import { coerceNotThisTeam, type NotThisTeam } from "../src/lib/notThisTeam.ts";
import { asWorkerSees } from "../src/lib/live/views/board.ts";
import {
  readCloudLeague,
  seasonReaderOf,
  type LeagueDocsList,
} from "../src/lib/live/cloudLeague.ts";
import { docToSeason } from "../src/lib/live/leagueDocs.ts";
import { coerceBackup } from "../src/lib/backup.ts";
import { walkForward } from "../src/lib/backtest.ts";
import type { ExternalResult } from "../src/lib/predictionEngine.ts";
import {
  finalScoresKey,
  leagueFixturesOf,
  leagueScoutBridge,
} from "../src/lib/teamRankings/leagueBridge.ts";
import { DEFAULT_SETTINGS } from "../src/lib/types.ts";
import { fetchValues } from "../src/lib/cloud/cloudEngine.ts";
import { LEAGUE_PART } from "../src/lib/cloud/cloudPlan.ts";
import { loadPoolFrom, sparedByTidy } from "../src/lib/cloud/cloudRunner.ts";
import { failureWords } from "../src/lib/cloud/firestoreRest.ts";
import { todayIsoDay } from "../src/lib/date.ts";
import {
  DAY_CHECK_TIDY_RULES,
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
import { pairedImprovement, type PairedReading } from "../src/lib/scoutBacktest.ts";
import {
  share,
  STAND_IN_WHYS,
  standInReport,
  standInShareLines,
  standInWhyLines,
  type StandInReport,
} from "../src/lib/standInReport.ts";
import {
  filedByName,
  leaningOf,
  readingWrongShare,
  readRules,
  type Leaning,
  type NearCount,
  type RuleReading,
} from "../src/lib/standInRules.ts";
import {
  loadAgeGroups,
  loadAutoRemoved,
  loadKeptApart,
  loadNotThisTeam,
  loadRetiredIds,
  loadScoutGames,
  loadScoutGamesForSeason,
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
import { readSweepFile, sweepTidy, type SweepSeason } from "./sweepTidy.ts";
import { sweepStored } from "../src/lib/sweepStored.ts";
import { lopsidedDrops } from "../src/lib/lopsidedDrops.ts";
import { LOPSIDED_MARGIN } from "../src/lib/autoRemoved.ts";
import { blastRadius, poolYears, radiusWords } from "../src/lib/cloud/blastRadius.ts";

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
  /**
   * Every League Standings season the source holds, in its order, with its name (which only the
   * sealed lines carry) and the settings it is forecast by: the pitch and the aggression the
   * per-game model reads, and whether its Team Rankings results count. None where League was not
   * read.
   */
  leagueSeasons: readonly SweepSeason[];
  /**
   * The stored games a season's bridge reads (`leagueScoutBridge`), as the app hands them to it
   * (`loadScoutGamesForSeason`); the bridge keeps those on the pages that claim the season.
   */
  gamesForSeason: (seasonId: string) => ScoutGame[];
  autoRemoved: AutoRemovals;
  /**
   * What a tidy honours, as the source holds it: the pairs kept apart, the names refused, and the
   * clubs it spares on a pool. A backup carries its own (Codex on #471); the cloud copy and the
   * seeded pool are in the store, as the nightly reads them.
   */
  tidyAnswers: () => {
    apart: KeptApart;
    refused: NotThisTeam;
    spared: (pool: GcImportState) => ReadonlySet<string>;
  };
  today: string;
};

/** The answers a pool in the store gives the tidy, as the nightly gives them (`sparedByTidy`). */
const storedTidyAnswers =
  (readSeason: SeasonReader | null): Source["tidyAnswers"] =>
  () => ({
    apart: loadKeptApart(),
    refused: loadNotThisTeam(),
    spared: (pool) => sparedByTidy(pool, readSeason),
  });

const NO_SEASON: LeagueSeasonData = { teams: [], matchups: [], logs: {} };

/**
 * A backup, put through the app's own tidy first (`sweepTidy`) unless `tidied` is false: the
 * stand-in rule's readings each tidy the pool themselves, and one already tidied under the rules as
 * shipped leaves no reading anything to compare (Codex on #471).
 */
const fromBackup = (path: string, tidied = true): Source => {
  const file = readSweepFile(readFileSync(path, "utf8"));
  if (!file) {
    throw new Error(
      `${path} is not a backup that holds a Team Rankings pool: export the Team Rankings JSON from` +
        ' Setup, or the whole-browser backup from Settings ("Backup JSON").'
    );
  }
  const { pool, seasons, leagueSeasons = [] } = file;
  let read: GcImportState = { ageGroups: pool.ageGroups, teams: pool.teams, games: pool.games };
  if (tidied) {
    const tidy = sweepTidy(pool, seasons);
    describeTidy(tidy).forEach((note) => console.log(`  tidy: ${note}`));
    read = tidy.state;
  }
  const { ageGroups, teams, games } = read;
  const yearOf = new Map(ageGroups.map((group) => [group.id, ageGroupYear(group)]));
  return {
    label: `the backup ${path}`,
    ageGroups,
    teams,
    gamesOfYear: (year) => games.filter((game) => yearOf.get(game.ageGroupId) === year),
    allGames: () => games,
    readSeason: seasons ?? (() => NO_SEASON),
    leagueRead: seasons !== null,
    leagueSeasons,
    // Every game: the bridge keeps the ones on the pages that claim the season, in this order.
    gamesForSeason: () => games,
    autoRemoved: coerceAutoRemovals(pool.answers?.autoRemoved ?? []),
    // As `sweepTidy` spares and honours them: the backup's own word, not this machine's store.
    tidyAnswers: () => ({
      apart: coerceKeptApart(pool.answers?.keptApart ?? []),
      refused: coerceNotThisTeam(pool.answers?.notThisTeam ?? []),
      spared: (read) =>
        new Set([
          ...(pool.answers?.realClubs ?? []),
          ...(seasons ? leagueLinkedClubsOf(read, seasons) : []),
        ]),
    }),
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
    // Its seasons carry no settings of their own, so each is forecast by the app's defaults.
    leagueSeasons: Object.keys(pool.seasons).map((id) => ({
      id,
      name: id,
      settings: DEFAULT_SETTINGS,
    })),
    gamesForSeason: () => pool.games,
    autoRemoved: coerceAutoRemovals([]),
    tidyAnswers: storedTidyAnswers((id) => pool.seasons[id] ?? NO_SEASON),
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
  let leagueSeasons: SweepSeason[] = [];
  try {
    // The documents listed once, as the publish lists them, and kept: `readCloudLeague` reads the
    // seasons' games from them, and their names and settings, which it leaves out, are read here.
    let listed: Awaited<ReturnType<LeagueDocsList>> = [];
    const league = await readCloudLeague(async () => (listed = await opened.leagueDocs()));
    if (league.ok && league.from === "docs") {
      readSeason = league.readSeason;
      leagueRead = true;
      // By id, the last document of one standing, as the reader keeps it.
      const byId = new Map<string, SweepSeason>();
      listed.forEach(({ id, fields }) => {
        const read = docToSeason(fields, id);
        if (!read.ok) return;
        const { season } = read;
        byId.set(season.id, { id: season.id, name: season.name, settings: season.settings });
      });
      leagueSeasons = [...byId.values()];
    } else if (league.ok) {
      const part = copy.manifest.parts.find((one) => one.key === LEAGUE_PART);
      const fetched = part ? await fetchValues({ store: opened.copy, parts: [part] }) : null;
      const value = fetched?.ok ? fetched.values.get(LEAGUE_PART) : undefined;
      const reader = fetched?.ok ? seasonReaderOf(value) : null;
      if (reader) {
        readSeason = reader;
        leagueRead = true;
        // The part as the reader took it (`coerceBackup`), for the seasons' names and settings.
        const parsed = value === undefined || value === null ? null : coerceBackup(value);
        leagueSeasons =
          parsed?.kind === "full"
            ? parsed.backup.seasons.map(({ id, name, settings }) => ({ id, name, settings }))
            : [];
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
    leagueSeasons,
    gamesForSeason: loadScoutGamesForSeason,
    autoRemoved: loadAutoRemoved(),
    tidyAnswers: storedTidyAnswers(leagueRead ? readSeason : null),
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
/** Lines that name clubs or seasons: printed only where the log is private, sealed either way. */
const sayNamed = (lines: string[], heading: string) => {
  if (lines.length === 0) return;
  sealedLines.push(heading, ...lines, "");
  if (publicLog) {
    say(`  (${lines.length} line(s) naming clubs or seasons left out of this log; sealed)`);
    return;
  }
  say(`  ${heading}`);
  lines.forEach((line) => say(line));
};

const started = Date.now();
const since = () => `${((Date.now() - started) / 1000).toFixed(1)} s`;
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
  // The numbers in the words the nightly says them in too (`standInShareLines`).
  standInShareLines(report).forEach((line) => say(line));
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
  standInWhyLines(report).forEach((line) => say(line));
  for (const [reason, label] of STAND_IN_WHYS) {
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
  {
    key: "day-check",
    why: "the tidy before 27 October 2026: a name filed onto a club only on a day of its own",
    rules: DAY_CHECK_TIDY_RULES,
  },
  { key: "shipped", why: "the tidy as it ships", rules: SHIPPED_TIDY_RULES },
  {
    key: "in-state",
    why: "the one pulled club of the name in the namer's state, at the row's level, any name",
    rules: { inState: { rareAmong: 1, nearLevel: false, vouched: false } },
  },
  {
    key: "in-state-rare",
    why: "the same, only a name with a word in no more than 1 in 2,000 pulled clubs' names",
    rules: { inState: { rareAmong: 2_000, nearLevel: false, vouched: false } },
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
  say(`    rows moved off a stand-in onto a pulled club: ${reading.moved.rows}`);
  say(
    `      between neighbours: ${nearShare(reading.moved)}; their decoys: ${nearShare(reading.decoy)}`
  );
  const wrong = readingWrongShare(reading, right);
  say(
    reading.selectedOnNeighbours
      ? "      the share wrong: not read, the rule chose these rows for being neighbours"
      : `      the share wrong, read between: ${wrong === null ? "-" : `${(100 * wrong).toFixed(1)}%`}`
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
  const { apart, refused, spared: sparedOf } = source.tidyAnswers();
  const spared = sparedOf(pool);
  const tidy = (state: GcImportState, rules: TidyRules) =>
    tidyPool(state, undefined, apart, refused, spared, rules);
  describeLeaning("before", leaningOf(pool, year));
  const right = filedByName(pool, year);
  say(`  rows filed by name (the club's own schedules not holding them): ${right.rows}`);
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

/* ------------------------------------------------------------------- the lopsided deletions */

/**
 * What the nightly's sweep would delete for a game won or lost by `LOPSIDED_MARGIN` or more
 * (`lopsidedDrops`), on the copy as read: by squad year, the clubs and every game they are in, how
 * lopsided each one's worst game is, and whether the other club's own schedule lists that game and
 * with what score. Asked after the nightly of 31 October 2026 held its save for taking 1,646 of
 * 2026's 16,036 games and 40 of its 10,626 clubs. Nothing is written.
 */
const measureLopsided = (source: Source) => {
  say(`\n${"=".repeat(78)}\nWhat the 40-run sweep would delete\n${"=".repeat(78)}`);
  const pool: GcImportState = {
    ageGroups: source.ageGroups,
    teams: source.teams,
    games: source.allGames(),
  };
  const [before, after] = sweepStored(pool, source.today);
  const hundred = (marks: AutoRemovals) =>
    [...marks.values()].filter((mark) => mark.signs.includes("hundred")).length;
  say(
    `  League Standings ${source.leagueRead ? "read" : "NOT read, so every club is spared and none deleted"}.`
  );
  say(
    `  GameChanger teams marked for a ${LOPSIDED_MARGIN}+ game: ${hundred(before)} before, ${hundred(after)} after the sweep.`
  );
  const spared = source.tidyAnswers().spared(pool);
  const drops = new Set(lopsidedDrops(after, pool.teams, spared));
  const unspared = new Set(lopsidedDrops(after, pool.teams, new Set()));
  say(
    `  Clubs it would delete: ${drops.size} (${unspared.size - drops.size} more spared: real, or linked by League).`
  );
  const yearOf = new Map(pool.ageGroups.map((group) => [group.id, ageGroupYear(group)]));
  const byId = new Map(pool.teams.map((team) => [team.id, team]));
  type Year = {
    games: number;
    removed: number;
    clubs: Set<string>;
    dropped: Set<string>;
    pages: Set<string>;
  };
  const years = new Map<number, Year>();
  for (const game of pool.games) {
    const year = yearOf.get(game.ageGroupId);
    if (year === undefined) continue;
    let held = years.get(year);
    if (!held) {
      held = { games: 0, removed: 0, clubs: new Set(), dropped: new Set(), pages: new Set() };
      years.set(year, held);
    }
    held.games += 1;
    held.pages.add(game.ageGroupId);
    held.clubs.add(game.teamAId);
    held.clubs.add(game.teamBId);
    const a = drops.has(game.teamAId);
    const b = drops.has(game.teamBId);
    if (a || b) held.removed += 1;
    if (a) held.dropped.add(game.teamAId);
    if (b) held.dropped.add(game.teamBId);
  }
  const share = (part: number, whole: number) =>
    whole === 0 ? "0%" : `${((100 * part) / whole).toFixed(1)}%`;
  for (const [year, held] of [...years.entries()].sort(([x], [y]) => x - y)) {
    say(
      `  ${year}: ${held.pages.size} pages, ${held.games} games, ${held.clubs.size} clubs in games; ` +
        `would delete ${held.dropped.size} clubs and ${held.removed} games (${share(held.removed, held.games)}).`
    );
  }
  // Each deleted club: its games, its worst own-schedule game, and what the other side says.
  const gamesOf = new Map<string, ScoutGame[]>();
  for (const game of pool.games) {
    for (const club of [game.teamAId, game.teamBId]) {
      if (!drops.has(club)) continue;
      const list = gamesOf.get(club);
      if (list) list.push(game);
      else gamesOf.set(club, [game]);
    }
  }
  const sizes = { "1-5": 0, "6-20": 0, "21-40": 0, "41+": 0 };
  const worst = { "40-49": 0, "50-74": 0, "75-99": 0, "100+": 0, "none on its own schedule": 0 };
  const other = { "lists it, same score": 0, "lists it, other score": 0, "does not list it": 0 };
  let pulled = 0;
  const named: string[] = [];
  for (const club of drops) {
    const games = gamesOf.get(club) ?? [];
    const n = games.length;
    sizes[n <= 5 ? "1-5" : n <= 20 ? "6-20" : n <= 40 ? "21-40" : "41+"] += 1;
    const team = byId.get(club);
    if (team?.gcTeams?.length) pulled += 1;
    const own = games
      .filter(
        (game) =>
          game.teamAId === club &&
          game.teamAScore !== undefined &&
          game.teamBScore !== undefined &&
          Math.abs(game.teamAScore - game.teamBScore) >= LOPSIDED_MARGIN
      )
      .sort(
        (x, y) => Math.abs(y.teamAScore! - y.teamBScore!) - Math.abs(x.teamAScore! - x.teamBScore!)
      );
    const top = own[0];
    if (!top) {
      worst["none on its own schedule"] += 1;
      named.push(
        `${team?.name ?? club} [${club}]: ${n} games; no ${LOPSIDED_MARGIN}+ game on its own schedule here`
      );
      continue;
    }
    const margin = Math.abs(top.teamAScore! - top.teamBScore!);
    worst[margin < 50 ? "40-49" : margin < 75 ? "50-74" : margin < 100 ? "75-99" : "100+"] += 1;
    const theirs = top.reportedByB;
    const said = !theirs
      ? "does not list it"
      : theirs.teamAScore === top.teamAScore && theirs.teamBScore === top.teamBScore
        ? "lists it, same score"
        : "lists it, other score";
    other[said] += 1;
    named.push(
      `${team?.name ?? club} [${club}] (${yearOf.get(top.ageGroupId) ?? "?"}, ${top.ageGroupId}): ${n} games; ` +
        `worst ${top.date ?? "undated"} ${top.teamAScore}-${top.teamBScore} v ${byId.get(top.teamBId)?.name ?? top.teamBId}` +
        `; the other side ${said}${theirs ? ` (${theirs.teamAScore}-${theirs.teamBScore})` : ""}`
    );
  }
  say(
    `  Of the ${drops.size}: ${pulled} pulled from GameChanger, ${drops.size - pulled} known only by name.`
  );
  say(
    `  Games each: ${Object.entries(sizes)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ")}.`
  );
  say(
    `  Worst game on its own schedule: ${Object.entries(worst)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ")}.`
  );
  say(
    `  That game, on the other club's schedule: ${Object.entries(other)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ")}.`
  );
  sayNamed(named, "The clubs the sweep would delete, each with its worst game:");

  // And the tidy the nightly runs after its filing, alone, on the pool as read: what it would take
  // away by year, as the nightly's cap counts it (`blastRadius`), so the two causes can be told apart.
  const { apart, refused } = source.tidyAnswers();
  // Called as the nightly calls it (`runCloudPull`): the rules as shipped, and the ids the pool has
  // let go of, raised over every club a League Standings pick names, so no slot or stand-in is
  // minted as one of them.
  const tidied = tidyPool(
    pool,
    undefined,
    apart,
    refused,
    spared,
    SHIPPED_TIDY_RULES,
    retiredWithPicks(loadRetiredIds(), source.leagueRead ? source.readSeason : null, pool.teams)
  );
  const radius = blastRadius(poolYears(pool), {
    games: new Set(tidied.state.games.map((game) => game.id)),
    clubs: new Set(tidied.state.teams.map((team) => team.id)),
  });
  say(
    `  The tidy alone: folded ${tidied.folded}, paired ${tidied.paired}, collapsed ${tidied.collapsed}, pruned ${tidied.pruned}.`
  );
  for (const year of radius) say(`  The tidy alone, ${radiusWords(year)}.`);
  say(`  (the tidy done at ${since()})`);
  // What the tidy alone does to each year's share of games against a stand-in, in the nightly's
  // words, so a tidy-rules change can be read on the copy as the stand-in rules were.
  for (const { year } of radius) {
    say(`  ${year}, before the tidy:`);
    standInShareLines(standInReport(pool.teams, pool.games, pool.ageGroups, year, 0)).forEach(
      (line) => say(`  ${line}`)
    );
    say(`  ${year}, after the tidy alone:`);
    standInShareLines(
      standInReport(tidied.state.teams, tidied.state.games, tidied.state.ageGroups, year, 0)
    ).forEach((line) => say(`  ${line}`));
  }
};

/* --------------------------------------------------- League Standings' two win chances, scored */

/**
 * The finals each side must have behind it before one of its games is scored: none, as the
 * season's backtest asks (`backtestPredictions` scores every final from the season's first), unless
 * --min-played says otherwise. The lines by the thinner side's finals read the early games apart.
 */
const BACKTEST_MIN_PLAYED = 0;

/** One final game, called by both models from what was known before it, and who won it. */
type BothCalled = {
  /** Whether its forecast was handed Team Rankings results. */
  linked: boolean;
  /** Machine or coach pitch, which the per-game model and the engine's curve each read apart. */
  machine: boolean;
  /** The finals of the season the thinner side had played before it. */
  earlier: number;
  awayWon: boolean;
  /** The away side's chance, by the per-game model (`predictGame`) and by the engine. */
  perGame: number;
  engine: number;
  /** Its two teams, numbered across every season, which the standard error counts games by. */
  away: number;
  home: number;
};

const lossOf = (chance: number, won: boolean) => -Math.log(won ? chance : 1 - chance);
const brierOf = (chance: number, won: boolean) => (chance - (won ? 1 : 0)) ** 2;

/**
 * Both models' mean log loss and Brier over `games`, and the engine's less the per-game model's,
 * game by game (`pairedImprovement`, its reference the engine's): below zero, the engine is
 * better. Its standard error counts the games by team, as the sweep's other readings do, since
 * every game a team plays leans on the one rating each model gave it.
 */
const bothRead = (games: readonly BothCalled[]) => {
  const mean = (of: (game: BothCalled) => number) =>
    games.length === 0 ? Number.NaN : games.reduce((sum, game) => sum + of(game), 0) / games.length;
  const sides = new Uint32Array(games.length * 2);
  games.forEach((game, at) => {
    sides[at * 2] = game.away;
    sides[at * 2 + 1] = game.home;
  });
  const engineLess = (score: (chance: number, won: boolean) => number) =>
    pairedImprovement(
      { errors: Float32Array.from(games, (game) => score(game.perGame, game.awayWon)) },
      { errors: Float32Array.from(games, (game) => score(game.engine, game.awayWon)), sides },
      false
    );
  return {
    games: games.length,
    perGame: {
      logLoss: mean((game) => lossOf(game.perGame, game.awayWon)),
      brier: mean((game) => brierOf(game.perGame, game.awayWon)),
    },
    engine: {
      logLoss: mean((game) => lossOf(game.engine, game.awayWon)),
      brier: mean((game) => brierOf(game.engine, game.awayWon)),
    },
    logLoss: engineLess(lossOf),
    brier: engineLess(brierOf),
  };
};

const describeBoth = (label: string, games: readonly BothCalled[]) => {
  const read = bothRead(games);
  const four = (value: number) => fixed(value).padEnd(6);
  say(
    `  ${label.padEnd(30)} ${String(read.games).padStart(6)}   ${four(read.perGame.logLoss)}  ${four(read.perGame.brier)}   ${four(read.engine.logLoss)}  ${four(read.engine.brier)}   ${paired(read.logLoss).padEnd(26)}  ${paired(read.brier)}`
  );
};

/** A model's calibration from the favourite's side, in the sweep's bands and words. */
const describeCalibration = (label: string, games: readonly BothCalled[], engine: boolean) => {
  say(`\n  ${label} calibration: the favourite's chance, and how often it won:`);
  say("    chance said     games   said    won");
  const favourites = games.map((game) => {
    const win = engine ? game.engine : game.perGame;
    return win >= 0.5 ? { said: win, won: game.awayWon } : { said: 1 - win, won: !game.awayWon };
  });
  for (let step = 0; step < 10; step += 1) {
    const from = 0.5 + step * 0.05;
    const to = from + 0.05;
    const band = favourites.filter(
      ({ said }) => said >= from - 1e-12 && (said < to - 1e-12 || step === 9)
    );
    if (band.length === 0) continue;
    const said = band.reduce((sum, one) => sum + one.said, 0) / band.length;
    const won = band.filter((one) => one.won).length / band.length;
    say(
      `    ${(from * 100).toFixed(0).padStart(3)}-${(to * 100).toFixed(0).padEnd(3)}%   ${String(band.length).padStart(9)}   ${(said * 100).toFixed(1).padStart(5)}%  ${(won * 100).toFixed(1).padStart(5)}%`
    );
  }
};

/**
 * League Standings' two win chances on its own seasons (asked 1 November 2026): the per-game
 * model's (`predictGame`), which every League screen shows and the Gold odds play by, and the
 * prediction engine's, a logistic over its projected margin held to 8-92%, which scored a little
 * better on the pseudo-leagues `oddsSpread.ts` describes. Every season's finals are walked as its
 * backtest walks them (`walkForward`): each called from the finals before it and, where a Team
 * Rankings page claims the season and its settings count them, the results the app's bridge hands
 * the forecast (`leagueScoutBridge`) played before its day; then both chances are scored on who
 * won. The fits are the backtest's own, so the two models face the same games with the same
 * knowledge. Numbers only: the seasons' names are sealed.
 */
const measureLeagueModels = (source: Source) => {
  say(
    `\n${"=".repeat(78)}\nLeague Standings: the per-game model and the prediction engine, game by game\n${"=".repeat(78)}`
  );
  if (!source.leagueRead) {
    say("  League Standings was not read: nothing to walk.");
    process.exitCode = 1;
    return;
  }
  const minPlayed = Math.max(0, Math.floor(Number(flag("min-played") || BACKTEST_MIN_PLAYED)) || 0);
  const called: BothCalled[] = [];
  const seasonLines: string[] = [];
  const named: string[] = [];
  let claimed = 0;
  let counted = 0;
  let handed = 0;
  let resultsHanded = 0;
  let finals = 0;
  let ties = 0;
  let unscored = 0;
  let early = 0;
  let unforecast = 0;
  let stopped = 0;
  let numbered = 0;
  for (const read of source.leagueSeasons) {
    const season = source.readSeason(read.id);
    const { settings } = read;
    const before = called.length;
    const tally = { finals: 0, ties: 0, unscored: 0, early: 0 };
    let results = 0;
    try {
      // Handed to the forecast as the app hands them (`useScoutBridge`): the bridge's results where
      // the settings count them, and its squad year either way, which places "M/D" among ISO days.
      let outside: ExternalResult[] = [];
      let squadYear: number | undefined;
      if (source.ageGroups.some((group) => group.seasonIds.includes(read.id))) {
        claimed += 1;
        const fixtures = leagueFixturesOf(
          season.teams,
          season.matchups,
          finalScoresKey(season.matchups, season.logs)
        );
        const bridge = leagueScoutBridge(
          read.id,
          source.ageGroups,
          source.teams,
          source.gamesForSeason(read.id),
          season.teams,
          fixtures
        );
        squadYear = bridge.squadYear;
        if (settings.useScoutResults) {
          counted += 1;
          outside = bridge.results;
        }
      }
      results = outside.length;
      const linked = results > 0;
      if (linked) {
        handed += 1;
        resultsHanded += results;
      }
      const machine = settings.pitchMode !== "player";
      const number = new Map(season.teams.map((team, at) => [team.id, numbered + at]));
      numbered += season.teams.length;
      const played = new Map<string, number>();
      walkForward(
        season.teams,
        season.matchups,
        season.logs,
        settings,
        { outside, ...(squadYear !== undefined ? { squadYear } : {}) },
        ({ game, log, engine, prediction }) => {
          const earlier = Math.min(played.get(game.away) ?? 0, played.get(game.home) ?? 0);
          // Every final is played for the games after it, a tie too, as the walk knows it.
          played.set(game.away, (played.get(game.away) ?? 0) + 1);
          played.set(game.home, (played.get(game.home) ?? 0) + 1);
          tally.finals += 1;
          const awayRuns = Number(log.awayRuns);
          const homeRuns = Number(log.homeRuns);
          if (!Number.isFinite(awayRuns) || !Number.isFinite(homeRuns)) {
            tally.unscored += 1;
            return;
          }
          // A tie has no winner to score, and the backtest scores none; the games after it know it
          // all the same.
          if (awayRuns === homeRuns) {
            tally.ties += 1;
            return;
          }
          if (earlier < minPlayed) {
            tally.early += 1;
            return;
          }
          const forecast = engine.predictions.find((one) => one.gameId === game.id);
          const away = number.get(game.away);
          const home = number.get(game.home);
          if (!forecast || away === undefined || home === undefined) {
            unforecast += 1;
            return;
          }
          called.push({
            linked,
            machine,
            earlier,
            awayWon: awayRuns > homeRuns,
            perGame: prediction.awayWinPct,
            // The engine's chance as it gives it, to the hundredth (`winProbability`).
            engine: forecast.winProbability.teamA,
            away,
            home,
          });
        }
      );
    } catch (error) {
      // Its games are left out whole, and why is sealed: an error can quote what it was reading.
      stopped += 1;
      called.length = before;
      sayNamed([`    ${read.name} [${read.id}]: ${failureWords(error)}`], "A season that stopped:");
      continue;
    }
    finals += tally.finals;
    ties += tally.ties;
    unscored += tally.unscored;
    early += tally.early;
    const mine = called.slice(before);
    if (mine.length === 0) continue;
    const both = bothRead(mine);
    const lossLess = both.engine.logLoss - both.perGame.logLoss;
    const brierLess = both.engine.brier - both.perGame.brier;
    seasonLines.push(
      `  ${String(seasonLines.length + 1).padStart(6)}  ${settings.pitchMode.padEnd(7)}  ${String(results).padStart(7)}  ${String(tally.finals).padStart(6)}  ${String(tally.ties).padStart(4)}  ${String(mine.length).padStart(6)}   ${fixed(both.perGame.logLoss)}  ${fixed(both.engine.logLoss)}  ${lossLess >= 0 ? "+" : ""}${fixed(lossLess)}   ${fixed(both.perGame.brier)}  ${fixed(both.engine.brier)}  ${brierLess >= 0 ? "+" : ""}${fixed(brierLess)}`
    );
    named.push(`    season ${seasonLines.length}: ${read.name} [${read.id}]`);
  }

  say(
    `  Seasons read: ${source.leagueSeasons.length}; claimed by a Team Rankings page: ${claimed}, ` +
      `${counted} of them set to count its results, ${handed} handed at least one ` +
      `(${resultsHanded} results in all, each read only by games on later days).`
  );
  say(`  Seasons scored: ${seasonLines.length}${stopped ? `; ${stopped} stopped (sealed)` : ""}.`);
  say(
    `  Finals walked: ${finals}. Ties: ${ties}, not scored, as the backtest scores none, and played` +
      ` for the games after them. Scores that are no number: ${unscored}, the same.`
  );
  say(
    `  Early games skipped: ${early}, until each side had ${minPlayed} final(s) behind it` +
      `${minPlayed === BACKTEST_MIN_PLAYED ? " (none, as the backtest asks: it scores from the season's first final)" : ""}.` +
      `${unforecast ? ` Left out with no engine forecast: ${unforecast}.` : ""}`
  );
  say(`  Games scored: ${called.length} (${since()}).`);

  say(
    "\n  Lower is better. engine − predictGame, game by game: below zero the engine is better," +
      " ± a standard error counted by team, and z:"
  );
  say(
    `  ${"games".padEnd(30)} ${"scored".padStart(6)}   predictGame       engine            engine − predictGame`
  );
  say(
    `  ${"".padEnd(30)} ${"".padStart(6)}   log loss Brier    log loss Brier    log loss                    Brier`
  );
  describeBoth("all", called);
  describeBoth(
    "linked to Team Rankings",
    called.filter((game) => game.linked)
  );
  describeBoth(
    "league games alone",
    called.filter((game) => !game.linked)
  );
  describeBoth(
    "player pitch",
    called.filter((game) => !game.machine)
  );
  describeBoth(
    "machine or coach pitch",
    called.filter((game) => game.machine)
  );
  describeBoth(
    "a side with no final before",
    called.filter((game) => game.earlier === 0)
  );
  for (const least of [1, 2, 4, 8]) {
    describeBoth(
      `each side ${least}+ finals before`,
      called.filter((game) => game.earlier >= least)
    );
  }

  describeCalibration("The per-game model's (predictGame)", called, false);
  describeCalibration("The prediction engine's", called, true);

  say("\n  By season, numbered (which is which is sealed); chances scored the same way:");
  say(
    "  season  pitch    results  finals  ties  scored   log loss: predictGame engine  e − p    Brier: predictGame engine  e − p"
  );
  seasonLines.forEach((line) => say(line));
  sayNamed(named, "The seasons, by the numbers above:");
  say(`  (League Standings' two chances done at ${since()})`);
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
  const source = path
    ? fromBackup(path, !has("stand-in-rules"))
    : has("cloud")
      ? await fromCloud()
      : fromFixture();
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
  if (has("lopsided")) {
    measureLopsided(source);
    finish();
    return;
  }
  if (has("league-models")) {
    measureLeagueModels(source);
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
