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
 * With --stand-in-halves it measures where the other half of each played game against a stand-in is,
 * if anywhere (`src/lib/standInHalves.ts`): another pulled club's own row a day either side with the
 * result mirrored, filed against the namer, against a stand-in or slot, or against a third club,
 * narrowed a step at a time until one is left (`HALF_FUNNEL`: the levels, the day, the start, the
 * level; never the state), and the same a week either side for the rate each step settles on one by
 * chance; for every stand-in and for those with nothing of their name pulled (`standInReport`'s
 * "unmatched"); and the same funnel where the answer is known (`testKnownPairs`), for how often it
 * settles on the wrong club; the strictest pairing, the start, the result and a word of the name
 * together (`strictPairs`); and each page's own club's standing line read two ways, its share of
 * the whole board and of the clubs whose web reaches the line (`rankLineCheck.ts`).
 *
 * With --stand-in-levers it says what the year's share of games on a stand-in is made of (a slot,
 * how many games the name holds, why the name is not a pulled club's), how far each lever would
 * take it, and whether boards that file each name onto its pulled namesake forecast later games
 * better than the boards as they are, with the share each filing leaves and what it does to the
 * boards (`src/lib/standInLevers.ts`); leaving the few-game names' games out was read on 28 October
 * 2026 and forecast clearly worse.
 *
 * With --stand-in-cases it reads, for the played rows against stand-ins, how often another pulled
 * club's own row starts within the clock whatever its result, scored or not, and how often its
 * club's name shares a word, or a rare one, with the stand-in's, beside a week either side; then a
 * sample of the rows against stand-ins with nothing of their name pulled, each with the pulled clubs
 * whose names read most like it and every row on the clock (`src/lib/standInCases.ts`), sealed.
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
import { gunzipSync, gzipSync } from "node:zlib";
import { coerceAutoRemovals, type AutoRemovals } from "../src/lib/autoRemoved.ts";
import { coerceKeptApart, type KeptApart } from "../src/lib/keptApart.ts";
import {
  deriveAllKnown,
  gamesOnPages,
  leagueLinkedClubsOf,
  type LeagueSeasonData,
  type SeasonReader,
} from "../src/lib/live/allKnown.ts";
import { coerceNotThisTeam, type NotThisTeam } from "../src/lib/notThisTeam.ts";
import { asWorkerSees } from "../src/lib/live/views/board.ts";
import { readCloudLeague, seasonReaderOf } from "../src/lib/live/cloudLeague.ts";
import { fetchValues } from "../src/lib/cloud/cloudEngine.ts";
import { LEAGUE_PART } from "../src/lib/cloud/cloudPlan.ts";
import { loadPoolFrom, sparedByTidy } from "../src/lib/cloud/cloudRunner.ts";
import { failureWords } from "../src/lib/cloud/firestoreRest.ts";
import { todayIsoDay } from "../src/lib/date.ts";
import {
  describeTidy,
  ONE_NAMESAKE_TIDY_RULES,
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
  findHalves,
  funnelEnd,
  HALF_FUNNEL,
  HALF_KINDS,
  tallyFunnel,
  nearScores,
  strictPairs,
  testKnownPairs,
  type FunnelTally,
  type KnownPairTally,
  type NearScoreTally,
  type HalfKind,
  type StandInRow,
} from "../src/lib/standInHalves.ts";
import { inOneRegion } from "../src/lib/stateBorders.ts";
import {
  filedByName,
  fittedJoinsOf,
  leaningOf,
  readingWrongShare,
  readRules,
  withSlotRowsMoved,
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
  fitScoutYearFor,
  rankingPoolGroupIds,
  rowsOfYearFit,
  scoutFitRanks,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
} from "../src/lib/teamRankings.ts";
import { ageGroupLevel, segmentOn } from "../src/lib/teamRankings/seasons.ts";
import { rankLineCheck, topOf } from "../src/lib/rankLineCheck.ts";
import {
  boardShift,
  GAME_COUNTS,
  namesakeFilings,
  standInBreakdown,
  wordFilings,
  type GameCount,
} from "../src/lib/standInLevers.ts";
import { shiftDay } from "../src/lib/standInHalves.ts";
import {
  caseIndex,
  CLOCK_MINUTES,
  RARE_AMONG,
  standInCases,
  tallyClock,
  type CaseOwnRow,
  type ClockTally,
} from "../src/lib/standInCases.ts";
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
  const { pool, seasons } = file;
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
  // Compressed first, so a long sample is short enough to copy out of a log.
  const data = joined(cipher.update(gzipSync(new TextEncoder().encode(text))), cipher.final());
  return JSON.stringify({
    format: SEALED_FORMAT,
    gzip: "1",
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
  return new TextDecoder().decode(parsed.gzip === "1" ? gunzipSync(text) : text);
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
  {
    key: "rules-34",
    why: "the tidy as the cloud copy was last tidied: the one pulled club of the name near the namer",
    rules: ONE_NAMESAKE_TIDY_RULES,
  },
  {
    key: "rules-35",
    why: "and the namesake join reading a name that fits a club against its slot, between neighbours",
    rules: SHIPPED_TIDY_RULES,
  },
  {
    key: "rules-35-anywhere",
    why: "and the same wherever the two clubs are",
    rules: { ...SHIPPED_TIDY_RULES, fitted: { region: false } },
  },
];

/** The days every row against a slot is moved for the fitted join's decoys. */
const SLOT_SHIFTS = [-14, -7, 7, 14];

/**
 * The fitted namesake join on the pool as rules 34 left it: the games each reading joins, and the
 * same with every row against a slot a week or a fortnight either side (`withSlotRowsMoved`).
 */
const measureFittedJoins = (settled: GcImportState, refused: ReadonlySet<string>) => {
  say(`\n  The namesake join reading a name that only fits, on the pool as rules-34 left it:`);
  const readings: [string, TidyRules][] = [
    ["near", SHIPPED_TIDY_RULES],
    ["anywhere", { ...SHIPPED_TIDY_RULES, fitted: { region: false } }],
  ];
  for (const [key, rules] of readings) {
    const real = fittedJoinsOf(settled, rules, ONE_NAMESAKE_TIDY_RULES, refused, inOneRegion, 40);
    const shifted = SLOT_SHIFTS.map(
      (days) =>
        fittedJoinsOf(
          withSlotRowsMoved(settled, days),
          rules,
          ONE_NAMESAKE_TIDY_RULES,
          refused,
          inOneRegion
        ).joined
    );
    const chance = shifted.reduce((sum, joined) => sum + joined, 0) / shifted.length;
    say(
      `    ${key}: ${real.joined} games joined (${real.near} between neighbours); with the slot` +
        ` rows ${SLOT_SHIFTS.join("/")} days off: ${shifted.join("/")}, ${chance.toFixed(2)} a shift` +
        ` (${share(chance, real.joined)} of the day's)`
    );
    sayNamed(
      real.sample.map(
        (one) => `    ${one.namer} named "${one.name}" -> ${one.club} (${one.states}, ${one.score})`
      ),
      `A sample of the games the ${key} reading joined:`
    );
  }
};

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
      let settled: GcImportState | undefined;
      describeReading(
        readRules(
          pool,
          year,
          key,
          rules,
          tidy,
          Number(flag("top") || 25),
          () => performance.now(),
          key === "rules-34"
            ? (state) => {
                settled = state;
              }
            : undefined
        ),
        right,
        why
      );
      if (settled) measureFittedJoins(settled, refused);
    } catch (error) {
      say(`  ${key} stopped: ${failureWords(error)}`);
      process.exitCode = 1;
    }
    say(`  (${key} done at ${since()})`);
  }
};

/* ------------------------------------------------------- the other halves of stand-in games */

const KIND_WORDS: Record<HalfKind, string> = {
  namer: "against the namer",
  standIn: "against a stand-in or slot",
  other: "against a third club",
};

const describeFunnel = (label: string, tally: FunnelTally) => {
  const of = (part: number) => share(part, tally.rows);
  say(`\n  ${label}: ${tally.rows} played rows against a stand-in`);
  say(
    "    settled on one candidate at each step (a week either side, by chance, a week on average):"
  );
  let settled = 0;
  let chance = 0;
  HALF_FUNNEL.forEach((step, at) => {
    settled += tally.settled[at]!;
    chance += tally.decoySettled[at]!;
    say(
      `      ${step.key}: ${tally.settled[at]} (by chance ${tally.decoySettled[at]!.toFixed(1)});` +
        ` so far ${settled} (${of(settled)}), by chance ${chance.toFixed(1)} (${of(chance)})`
    );
  });
  say(
    `    emptied by a step before one was left: ${tally.emptied} (${of(tally.emptied)}; by chance` +
      ` ${tally.decoyEmptied.toFixed(1)}); several still after the last: ${tally.several}` +
      ` (${of(tally.several)}; by chance ${tally.decoySeveral.toFixed(1)})`
  );
  say(
    `    the ${settled} settled: ` +
      HALF_KINDS.map((kind) => `${KIND_WORDS[kind]} ${tally.kinds[kind]}`).join(", ") +
      `; the same page ${tally.samePage}; the same or a bordering state ${tally.inRegion};` +
      ` names fit ${tally.namesFit}, share a word ${tally.shareWord}`
  );
  say(
    `    stand-ins with two rows or more settled: on one club ${tally.agreeing}` +
      ` (${tally.agreeingRows} rows), on two or more ${tally.split}`
  );
};

const describeKnownPairs = (label: string, tally: KnownPairTally) => {
  say(
    `\n  ${label}: ${tally.pairs} games; the two rows' results do not mirror: ${tally.notMirrored}`
  );
  const tried = tally.pairs - tally.notMirrored;
  let right = 0;
  let wrong = 0;
  HALF_FUNNEL.forEach((step, at) => {
    right += tally.right[at]!;
    wrong += tally.wrong[at]!;
    say(
      `      ${step.key}: right ${tally.right[at]}, wrong ${tally.wrong[at]}; so far right ${right}` +
        ` (${share(right, tried)}), wrong ${wrong} (${share(wrong, tried)}),` +
        ` wrong of those settled ${share(wrong, right + wrong)}`
    );
  });
  say(
    `    emptied ${tally.emptied} (${share(tally.emptied, tried)}); several still ${tally.several}` +
      ` (${share(tally.several, tried)})`
  );
};

const describeNearScores = (label: string, tally: NearScoreTally) => {
  const read = tally.rows - tally.noStart;
  const of = (part: number) => share(part, read);
  say(
    `    ${label}: ${tally.rows} rows, ${tally.noStart} with no start of their own; of the ${read} with one:`
  );
  say(
    `      the result mirrored exactly: ${tally.exact} (${of(tally.exact)}; by chance` +
      ` ${tally.decoyExact.toFixed(1)}, ${of(tally.decoyExact)})`
  );
  say(
    `      none exact, off by one or two runs in all: ${tally.near} (${of(tally.near)}; by chance` +
      ` ${tally.decoyNear.toFixed(1)}, ${of(tally.decoyNear)}); exactly one such: ${tally.nearOne}` +
      ` (by chance ${tally.decoyNearOne.toFixed(1)}); the same winner ${tally.nearSameWinner}`
  );
  say(
    `      all off by three or more: ${tally.far} (${of(tally.far)}); nothing at that start:` +
      ` ${tally.none} (${of(tally.none)})`
  );
};

const measureStandInHalves = (source: Source, year: number) => {
  say(`\n${"=".repeat(78)}\nThe other half of each game against a stand-in\n${"=".repeat(78)}`);
  const page = source.ageGroups.find(
    (group) => ageGroupYear(group) === year && scoutFitRanks(group.id, source.ageGroups)
  );
  if (!page) {
    say(`No ranked page of squad year ${year} in this pool.`);
    process.exitCode = 1;
    return;
  }
  // The year's pool as the boards hold it, the clubs taken off left out, every row's own schedule
  // kept (the worker's codec drops it, so it is not used here).
  const known = deriveAllKnown({
    ageGroups: source.ageGroups,
    teams: source.teams,
    yearGames: source.gamesOfYear(year),
    readSeason: source.readSeason,
    autoRemoved: source.autoRemoved,
  });
  const games = gamesOnPages(known.games, rankingPoolGroupIds(page.id, source.ageGroups));
  say(`  The year's pool: ${known.teams.length} clubs, ${games.length} games (${since()}).`);
  const report = standInReport(known.teams, games, source.ageGroups, year, Number.MAX_SAFE_INTEGER);
  const whyOf = new Map(report.top.map((club) => [club.teamId, club.why]));
  say(
    `  The year's games: ${report.games}; with a stand-in or slot on a side: ${report.withStandIn}` +
      ` (${share(report.withStandIn, report.games)}). Played: ${report.played}; with one:` +
      ` ${report.playedWithStandIn} (${share(report.playedWithStandIn, report.played)}).`
  );
  say(
    `  Clubs known only by name: ${report.nameOnly}; with nothing of the name pulled ("unmatched"):` +
      ` ${report.why.unmatched.clubs}, holding ${report.why.unmatched.games} games.`
  );
  const levels = new Map(source.ageGroups.map((group) => [group.id, ageGroupLevel(group)]));
  const levelOf = (id: string) => levels.get(id);
  const search = findHalves(known.teams, games, levelOf);
  say(
    `  Played rows against a stand-in: ${search.rows.length}; not read (no result, set not to` +
      ` count): ${search.unplayed}. Searched in ${since()}.`
  );
  const unmatched = (row: StandInRow) => whyOf.get(row.standInId) === "unmatched";
  describeFunnel("Every stand-in", tallyFunnel(search, known.teams));
  describeFunnel(
    'Stand-ins with nothing of their name pulled ("unmatched")',
    tallyFunnel(search, known.teams, HALF_FUNNEL, unmatched)
  );
  describeFunnel(
    "Stand-ins with a pulled club of the name somewhere",
    tallyFunnel(search, known.teams, HALF_FUNNEL, (row) => !unmatched(row))
  );

  // The owner's question: the same date and start, the result a run or two off.
  say(
    `\n  Another club's own row at the same date and start (levels within two, any state),` +
      ` its result mirrored or off by a run or two (${since()}):`
  );
  for (const [within, words] of [
    [60, "starts within an hour either way"],
    [1, "starts to the minute"],
  ] as const) {
    say(`\n   ${words}:`);
    const [every, unmatchedOnly] = nearScores(known.teams, games, levelOf, within, [
      () => true,
      (row) => whyOf.get(row.standInId) === "unmatched",
    ]);
    describeNearScores("every stand-in", every!);
    describeNearScores('"unmatched"', unmatchedOnly!);
  }

  // The strictest pairing: the start, the result exactly, and a word of the name, beside chance.
  say(
    `\n  The strictest pairing: another club's own row at the row's start, the result mirrored` +
      ` exactly, levels within two, its club's name sharing a word with the stand-in's or fitting` +
      ` it (${since()}):`
  );
  for (const [within, names, words] of [
    [1, "shareWord", "to the minute, a word in common"],
    [1, "fit", "to the minute, the names fitting"],
    [60, "shareWord", "within the hour, a word in common"],
  ] as const) {
    const [every, unmatchedOnly] = strictPairs(known.teams, games, levelOf, within, names, [
      () => true,
      (row) => whyOf.get(row.standInId) === "unmatched",
    ]);
    for (const [label, tally] of [
      ["every stand-in", every!],
      ['"unmatched"', unmatchedOnly!],
    ] as const) {
      say(
        `    ${words}, ${label}: one ${tally.one} of ${tally.rows} (${share(tally.one, tally.rows)};` +
          ` by chance ${tally.decoyOne.toFixed(1)}), several ${tally.several} (by chance` +
          ` ${tally.decoySeveral.toFixed(1)}); stand-ins answered twice or more by one club` +
          ` ${tally.agreeing} (${tally.agreeingRows} rows), by two or more ${tally.split}`
      );
    }
  }

  // The funnel where the answer is known: games both clubs' own schedules list, one side held out.
  say(
    `\n  The funnel where the answer is known: a game both clubs' schedules list, one club's row read` +
      ` as if it had named a stand-in, the other's put back among the year's rows (${since()}).`
  );
  describeKnownPairs("Every such game", testKnownPairs(known.teams, games, levelOf));
  describeKnownPairs(
    "Those the claim step took from a name (the stand-in case itself)",
    testKnownPairs(
      known.teams,
      games,
      levelOf,
      HALF_FUNNEL,
      (row) => row.filedAgainst !== undefined
    )
  );

  // A sample of the unmatched rows settled, to read by eye: names, sealed. Evenly through the
  // list, not its first few, which one namer's schedule would fill.
  const byId = new Map(known.teams.map((team) => [team.id, team]));
  const nameOf = (id: string) => {
    const team = byId.get(id);
    return team ? `${team.name}${team.state ? ` (${team.state})` : ""}` : id;
  };
  const settled = search.rows.flatMap((row) => {
    const end = funnelEnd(row.found);
    return unmatched(row) && "settled" in end ? [{ row, end }] : [];
  });
  const sample = Number(flag("top") || 16);
  const step = Math.max(1, Math.floor(settled.length / sample));
  sayNamed(
    settled
      .filter((_, at) => at % step === 0)
      .slice(0, sample)
      .map(({ row, end }) => {
        const runs = `${row.game.teamAScore}-${row.game.teamBScore}`;
        const gap =
          end.one.minutesApart === undefined
            ? "no start"
            : `${Math.round(end.one.minutesApart)} min`;
        return (
          `    ${row.game.date} ${nameOf(row.namerId)} v "${nameOf(row.standInId)}" ${runs}` +
          ` -> ${nameOf(end.one.clubId)} v ${nameOf(end.one.opponentId)}; at` +
          ` "${HALF_FUNNEL[end.settled]!.key}"; ${end.one.daysApart} day(s), ${gap},` +
          ` ${end.one.levelGap ?? "?"} level(s) apart`
        );
      }),
    "Unmatched stand-ins the funnel settled on one club:"
  );

  describeRankLines(source, year);
};

/**
 * The owner's report of 27 October 2026, "my team is ass and the graph keeps going up": for each
 * page's own club (`AgeGroup.myTeamId`), its standing week by week read two ways, its share of the
 * whole board (the line the card draws) and its share of the clubs whose web reaches the line, and
 * by rating alone, beside how many of the board are listed last for a short web
 * (`rankLineCheck.ts`). Percentages and the board's counts in the log, the club's places sealed.
 */
const describeRankLines = (source: Source, year: number) => {
  say(`\n${"=".repeat(78)}\nThe page's own club's standing line, read two ways\n${"=".repeat(78)}`);
  const { segment } = segmentOn(source.today);
  const halfStart = segment === "fall" ? `${year - 1}-08-01` : `${year}-01-01`;
  const days: string[] = [];
  for (let back = 0; ; back += 7) {
    const day = shiftDay(source.today, -back)!;
    if (day < halfStart) break;
    days.unshift(day);
  }
  const known = deriveAllKnown({
    ageGroups: source.ageGroups,
    teams: source.teams,
    yearGames: source.gamesOfYear(year),
    readSeason: source.readSeason,
    autoRemoved: source.autoRemoved,
  });
  const owned = source.ageGroups.filter(
    (group) =>
      ageGroupYear(group) === year && group.myTeamId && scoutFitRanks(group.id, source.ageGroups)
  );
  if (owned.length === 0) say("  No page of the year names its own club.");
  owned.forEach((page, at) => {
    const pool = asWorkerSees(
      known.teams,
      gamesOnPages(known.games, rankingPoolGroupIds(page.id, source.ageGroups))
    );
    const lines = rankLineCheck(
      page.id,
      page.myTeamId!,
      pool.teams,
      pool.games,
      source.ageGroups,
      segment,
      days
    );
    say(`\n  Page ${at + 1} of ${owned.length} (${since()}):`);
    lines.forEach((line) => {
      const pct = (rank: number | undefined, of: number) =>
        rank === undefined ? "-" : `top ${topOf(rank, of)}%`;
      say(
        `    ${line.asOf}: board ${line.of}, listed last ${line.listedLast}` +
          ` (${share(line.listedLast, line.of)}); the club ${pct(line.rank, line.of)} of the board,` +
          ` ${pct(line.provenRank, line.proven)} of the rest, ${pct(line.ratingRank, line.of)} by rating`
      );
    });
    sayNamed(
      lines.map(
        (line) =>
          `    ${line.asOf}: #${line.rank ?? "-"} of ${line.of}; #${line.provenRank ?? "-"} of` +
          ` ${line.proven} reaching the line; #${line.ratingRank ?? "-"} by rating;` +
          ` rating ${line.rating === undefined ? "-" : line.rating.toFixed(2)}`
      ),
      `Page ${at + 1}'s own club, week by week:`
    );
  });
};

/* ------------------------------------------------------------------------ the stand-in levers */

const WHY_WORDS: Record<StandInWhy, string> = {
  oneSameState: "one pulled club of the name on its page, in the namers' state",
  oneOtherState: "one on its page, in another state",
  several: "several of the name on its page",
  nearOne: "none of the name on its page, one spelled near it",
  nearSeveral: "none of the name on its page, several spelled near it",
  elsewhere: "a namesake only on another page",
  unmatched: "nothing of the name or near it",
};

/**
 * The owner's target of 27 October 2026, stand-in games at or below 15%: what the year's share is
 * made of (`standInBreakdown`), how far each lever would take it, and what leaving out the games of
 * names holding one or two games would do to the boards (`boardShift`, the year fitted with and
 * without them).
 */
const measureStandInLevers = (source: Source, year: number) => {
  say(`\n${"=".repeat(78)}\nThe year's games on a stand-in, and the levers\n${"=".repeat(78)}`);
  const page = source.ageGroups.find(
    (group) => ageGroupYear(group) === year && scoutFitRanks(group.id, source.ageGroups)
  );
  if (!page) {
    say(`No ranked page of squad year ${year} in this pool.`);
    process.exitCode = 1;
    return;
  }
  const known = deriveAllKnown({
    ageGroups: source.ageGroups,
    teams: source.teams,
    yearGames: source.gamesOfYear(year),
    readSeason: source.readSeason,
    autoRemoved: source.autoRemoved,
  });
  const games = gamesOnPages(known.games, rankingPoolGroupIds(page.id, source.ageGroups));
  const report = standInReport(known.teams, games, source.ageGroups, year, Number.MAX_SAFE_INTEGER);
  const whyOf = new Map(report.top.map((club) => [club.teamId, club.why]));
  const b = standInBreakdown(known.teams, games, source.ageGroups, year, (id) => whyOf.get(id));
  const of = (part: number, whole = b.games) => share(part, whole);
  say(
    `  The year's games: ${b.games}; on a stand-in: ${b.onStandIn} (${of(b.onStandIn)}) (${since()}).`
  );
  say(`    on a bracket slot: ${b.slots} (${of(b.slots)})`);
  say("    on a name, by how many games of the year the name holds:");
  for (const count of GAME_COUNTS) {
    say(`      ${count}: ${b.byCount[count]} (${of(b.byCount[count])})`);
  }
  say("    on a name, by why it is not a pulled club's (and of those, its name's only game):");
  for (const why of Object.keys(WHY_WORDS) as StandInWhy[]) {
    say(
      `      ${WHY_WORDS[why]}: ${b.byWhy[why] ?? 0} (${of(b.byWhy[why] ?? 0)}); one-off` +
        ` ${b.oneOffByWhy[why] ?? 0}`
    );
  }

  // The levers, each on what the ones before left.
  const sumWhy = (counts: readonly GameCount[], whys: readonly StandInWhy[]) =>
    counts.reduce(
      (sum, count) => sum + whys.reduce((part, why) => part + (b.byCountWhy[count][why] ?? 0), 0),
      0
    );
  const kept: GameCount[] = ["3-4", "5-9", "10+"];
  const oneOff = b.byCount["1"];
  const twoGame = b.byCount["2"];
  const namesakes = sumWhy(kept, ["oneSameState", "oneOtherState", "nearOne"]);
  const elsewhere = sumWhy(kept, ["elsewhere"]);
  say(
    "\n  The levers, each on what the ones before left (games left out shrink the year as well):"
  );
  let on = b.onStandIn;
  let total = b.games;
  const step = (words: string, off: number, leftOut: boolean) => {
    on -= off;
    if (leftOut) total -= off;
    say(`    ${words}: ${off} games; the share ${share(on, total)}`);
  };
  say(`    as it is: the share ${share(on, total)}`);
  step("leave out games of names holding one game", oneOff, true);
  step("and of names holding two", twoGame, true);
  step(
    "file the names with one pulled club of the name or near it on their page",
    namesakes,
    false
  );
  step("and those whose namesake is only on another page", elsewhere, false);
  say(
    `    (the strictest pairing by start, result and a word of the name answered about 3,944 rows,` +
      ` which overlap these)`
  );

  // What leaving the few-game names out would do to the boards.
  const pool = asWorkerSees(known.teams, games);
  const { segment } = segmentOn(source.today);
  const pages = source.ageGroups.filter(
    (group) => ageGroupYear(group) === year && scoutFitRanks(group.id, source.ageGroups)
  );
  const fitAll = fitScoutYearFor(
    page.id,
    pool.teams,
    pool.games,
    source.ageGroups,
    segment,
    source.today
  );
  if (!fitAll) {
    say("  No fit of the year to compare against.");
    return;
  }
  // Whether boards trained with each name filed onto its namesake forecast the games after each
  // cut better or worse: the bar a change to the fit is held to, on the same games the boards as
  // they are are scored on. Leaving the few-game names' games out was read the same way on 28
  // October 2026 (GitHub run 40606022999) and forecast clearly worse: log loss z -6.2 for the names
  // holding one game, -7.8 for two or fewer, -2.3 for the slots alone.
  const fileOne = namesakeFilings(pool.teams, pool.games, source.ageGroups, year, "one");
  const fileNear = namesakeFilings(pool.teams, pool.games, source.ageGroups, year, "near");
  const fileElsewhere = namesakeFilings(
    pool.teams,
    pool.games,
    source.ageGroups,
    year,
    "elsewhere"
  );
  // The owner, 28 October 2026: "You just aren't matching them appropriately." The names whose
  // words a pulled club's name holds, or that hold its (`wordFilings`), on top of the namesakes.
  const byWords = (region: boolean) =>
    wordFilings(pool.teams, pool.games, source.ageGroups, year, fileElsewhere, region);
  const inRegion = byWords(true);
  const anywhere = byWords(false);
  const filings = [
    {
      reach: "one",
      why: "each name filed onto the one pulled club of the name on its page",
      onto: fileOne,
    },
    { reach: "near", why: "and where none is, the one spelled near it", onto: fileNear },
    {
      reach: "elsewhere",
      why: "and where neither is, the one of the name in the year within two levels",
      onto: fileElsewhere,
    },
    {
      reach: "words",
      why: "and the one whose name's words the name holds or is held in, in a namer's region",
      onto: new Map([...fileElsewhere, ...inRegion]),
    },
    {
      reach: "words-any",
      why: "the same in any state",
      onto: new Map([...fileElsewhere, ...anywhere]),
    },
  ];
  const nameAt = new Map(pool.teams.map((team) => [team.id, team]));
  const pairs = [...inRegion];
  const every = Math.max(1, Math.floor(pairs.length / 40));
  sayNamed(
    pairs
      .filter((_, at) => at % every === 0)
      .slice(0, 40)
      .map(([standInId, clubId]) => {
        const club = nameAt.get(clubId);
        return `    "${nameAt.get(standInId)?.name}" -> ${club?.name} (${club?.state ?? "?"})`;
      }),
    "Names filed by their words, in a namer's region, a sample:"
  );
  const byId = new Map(pool.teams.map((team) => [team.id, team]));
  const standing = (id: string) => {
    const team = byId.get(id);
    return (team?.nameOnly === true || team?.placeholder === true) && !team.gcTeams?.length;
  };
  const yearPages = new Set(pages.map((one) => one.id));
  const yearGames = pool.games.filter((game) => yearPages.has(game.ageGroupId));
  say(`\n  Each name filed onto its namesake (${since()}):`);
  filings.forEach(({ reach, why, onto }) => {
    const left = yearGames.filter((game) =>
      [game.teamAId, game.teamBId].some((id) => !onto.has(id) && standing(id))
    ).length;
    say(
      `    ${reach}: ${why}: ${onto.size} names filed; the share ${share(left, yearGames.length)}` +
        ` of ${yearGames.length} games`
    );
  });

  say(`\n  Forecasting later games with them filed (${since()}):`);
  try {
    describeSweep(
      runModelSweep({
        ageGroups: source.ageGroups,
        teams: pool.teams,
        games: pool.games,
        year,
        cuts: MODEL_CUTS,
        scoreFrom: MODEL_SCORE_FROM,
        today: source.today,
        now: () => performance.now(),
        variants: [
          { key: "shipped", why: "the boards as they are" },
          ...filings.map(({ reach, why, onto }) => ({ key: `file-${reach}`, why, refile: onto })),
        ],
      })
    );
  } catch (error) {
    say(`  The forecast stopped: ${failureWords(error)}`);
    process.exitCode = 1;
  }

  for (const { reach, onto } of filings) {
    const refiled = pool.games.flatMap((game) => {
      const teamAId = onto.get(game.teamAId) ?? game.teamAId;
      const teamBId = onto.get(game.teamBId) ?? game.teamBId;
      return teamAId === teamBId ? [] : [{ ...game, teamAId, teamBId }];
    });
    const fit = fitScoutYearFor(
      page.id,
      pool.teams,
      refiled,
      source.ageGroups,
      segment,
      source.today
    );
    say(`\n  The boards with the names filed, ${reach} (${since()}):`);
    if (!fit) continue;
    pages.forEach((one, at) => {
      const shift = boardShift(
        rowsOfYearFit(fitAll, one.id, undefined, source.ageGroups),
        rowsOfYearFit(fit, one.id, undefined, source.ageGroups)
      );
      say(
        `    page ${at + 1}: ${shift.compared} clubs; top 25 kept ${shift.topKept} of ${shift.top};` +
          ` the middle club moved ${shift.medianMove} places; ${shift.movedTenth} moved more than` +
          ` a tenth of the board`
      );
    });
  }
};

/**
 * The owner, 28 October 2026: "They are not private on gamechanger. You just aren't matching them
 * appropriately." For the played rows against stand-ins, how often another pulled club's own row
 * starts within the clock, scored or not, and how often its club's name shares a word, or a rare
 * one, with the stand-in's, beside a week either side; then a sample of the rows against stand-ins
 * with nothing of their name pulled, laid out with the clubs whose names read most like theirs and
 * every row on the clock, to read by eye (`standInCases.ts`). Names sealed.
 */
const measureStandInCases = (source: Source, year: number) => {
  say(`\n${"=".repeat(78)}\nThe rows against stand-ins, laid out\n${"=".repeat(78)}`);
  const page = source.ageGroups.find(
    (group) => ageGroupYear(group) === year && scoutFitRanks(group.id, source.ageGroups)
  );
  if (!page) {
    say(`No ranked page of squad year ${year} in this pool.`);
    process.exitCode = 1;
    return;
  }
  const known = deriveAllKnown({
    ageGroups: source.ageGroups,
    teams: source.teams,
    yearGames: source.gamesOfYear(year),
    readSeason: source.readSeason,
    autoRemoved: source.autoRemoved,
  });
  const games = gamesOnPages(known.games, rankingPoolGroupIds(page.id, source.ageGroups));
  const report = standInReport(known.teams, games, source.ageGroups, year, Number.MAX_SAFE_INTEGER);
  const whyOf = new Map(report.top.map((club) => [club.teamId, club.why]));
  const levels = new Map(source.ageGroups.map((group) => [group.id, ageGroupLevel(group)]));
  const index = caseIndex(known.teams, games, (id) => levels.get(id));
  say(
    `  Played rows a pulled club's own schedule gave against a stand-in: ${index.against.length};` +
      ` pulled names: ${index.names} (${since()}).`
  );
  const describe = (label: string, tally: ClockTally) => {
    const vs = (part: number, chance: number) =>
      `${part} (${share(part, tally.rows - tally.noStart)}; a week off ${share(chance, tally.rows - tally.noStart)})`;
    say(`\n  ${label}: ${tally.rows} rows read, ${tally.noStart} with no start.`);
    say(
      `    another club's own row within ${CLOCK_MINUTES} min, two levels: ${vs(tally.any, tally.decoy.any)}`
    );
    say(`    and its club's name sharing a word: ${vs(tally.sharesWord, tally.decoy.sharesWord)}`);
    say(
      `    and a word in no more than 1 in ${RARE_AMONG} pulled names: ` +
        vs(tally.sharesRare, tally.decoy.sharesRare)
    );
    say(
      `    of those sharing a word, the result mirrored ${tally.mirrored}, scored otherwise` +
        ` ${tally.scoredOtherwise}, not scored ${tally.unscored}`
    );
  };
  const unmatched = (row: { standInId: string }) => whyOf.get(row.standInId) === "unmatched";
  describe(
    'Stand-ins with nothing of their name pulled ("unmatched")',
    tallyClock(index, unmatched, 8000)
  );
  describe(
    "Stand-ins with a pulled club of the name somewhere",
    tallyClock(index, (row) => !unmatched(row), 8000)
  );
  say(`  (${since()})`);

  const nameOf = (id: string) => {
    const team = index.byId.get(id);
    if (!team) return id;
    const tag = team.gcTeams?.length ? "" : team.placeholder ? " [slot]" : " [stand-in]";
    return `${team.name}${team.state ? ` (${team.state})` : ""}${tag}`;
  };
  const clock = (at: number) =>
    Number.isNaN(at) ? "--:--" : new Date(at).toISOString().slice(11, 16);
  const result = (row: { own?: number; opponent?: number }) =>
    row.own === undefined ? "no score" : `${row.own}-${row.opponent}`;
  const ownRow = (other: CaseOwnRow) =>
    `${other.game.date!.slice(5)} ${clock(other.at)} v ${nameOf(other.opponentId)} ${result(other)}` +
    `${other.level === undefined ? "" : ` ${other.level}U`}`;
  const held = new Map(report.top.map((club) => [club.teamId, club]));
  const cases = standInCases(index, unmatched, Number(flag("top") || 40));
  sayNamed(
    cases.flatMap(({ row, byName, byClock }, at) => {
      const standIn = held.get(row.standInId);
      const head =
        `#${at + 1} ${row.game.date} ${clock(row.at)} ${nameOf(row.namerId)} ${row.level ?? "?"}U` +
        ` ${result(row)} v "${index.byId.get(row.standInId)?.name ?? row.standInId}"` +
        ` (holds ${standIn?.games ?? "?"} games)`;
      return [
        head,
        ...byName.map(
          ({ clubId, like, thatDay }) =>
            `   name: ${nameOf(clubId)} [${like.shared.join(" ")}; ${like.weight.toFixed(1)}]` +
            ` ${thatDay.length === 0 ? "no rows that day or either side" : thatDay.slice(0, 4).map(ownRow).join(" | ")}`
        ),
        ...byClock.map(
          ({ other, like }) =>
            `   clock: ${Math.round((other.at - row.at) / 60000)} min ${nameOf(other.clubId)}` +
            ` ${ownRow(other)}${like.shared.length ? ` [${like.shared.join(" ")}]` : ""}`
        ),
      ];
    }),
    "Rows against stand-ins with nothing of their name pulled, laid out:"
  );
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
  if (has("stand-in-levers")) {
    try {
      measureStandInLevers(source, year);
    } catch (error) {
      say(`The stand-in levers stopped: ${failureWords(error)}`);
      process.exitCode = 1;
    }
    finish();
    return;
  }
  if (has("stand-in-cases")) {
    try {
      measureStandInCases(source, year);
    } catch (error) {
      say(`The stand-in cases stopped: ${failureWords(error)}`);
      process.exitCode = 1;
    }
    finish();
    return;
  }
  if (has("stand-in-halves")) {
    try {
      measureStandInHalves(source, year);
    } catch (error) {
      say(`The stand-in halves stopped: ${failureWords(error)}`);
      process.exitCode = 1;
    }
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
