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
 * With --why-unjoined it reads the stand-ins the nightly says should have joined their one pulled
 * namesake, row by row through the refile, and counts why each row stayed (`unjoinedReasons`);
 * with --name-sha256=HEX as well, every club of the one name whose key (`teamNameKey`) has that
 * digest, and each row filed against a stand-in of it, nameless (`oneNameRows`).
 *
 * Options: --year=2027 (the squad year), --today=DAY (the board's day; the members' day by
 * default), --cuts=DAY,DAY with --score-from=DAY (the boards' days and the day scoring starts, the
 * ones every read has used by default), --top=25 (the stand-ins named, most games first), --public (numbers only),
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
  createHash,
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
  MODEL_VARIANTS,
  runModelSweep,
  type ModelSweep,
  type SliceBand,
} from "../src/lib/modelSweep.ts";
import type { PairedReading } from "../src/lib/scoutBacktest.ts";
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
  loadScoutGames,
  loadScoutGamesForYear,
  loadScoutTeams,
  resetTeamRankingsStore,
} from "../src/lib/teamRankingsStorage.ts";
import {
  ageGroupYear,
  ageGroupLevel,
  gcCarriersOf,
  isOffClubId,
  isScoutGamePlayed,
  NO_SCOUT_TEAM,
  rankingPoolGroupIds,
  readPick,
  scoutFitRanks,
  teamNameKey,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
} from "../src/lib/teamRankings.ts";
import { openStores } from "./cloudPool.ts";
import { poolFixture } from "./poolFixture.ts";
import { readSweepFile, sweepTidy } from "./sweepTidy.ts";
import {
  clubGameLines,
  oneNameLines,
  oneNameRows,
  unjoinedReasonLines,
  unjoinedReasons,
} from "../src/lib/unjoinedReasons.ts";

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

/**
 * The days the sweep fits its boards on and scores the games from: the ones every read has used
 * (`MODEL_CUTS`, `MODEL_SCORE_FROM`), or others named (`--cuts=DAY,DAY --score-from=DAY`) to read
 * the boards later in a season, where clubs stand on more games than in September. Each must be a
 * day, and the scoring day after every cut, or the sweep stops before reading anything.
 */
const sweepCuts = (() => {
  const named = flag("cuts");
  const from = flag("score-from");
  if (!named && !from) return { cuts: MODEL_CUTS, scoreFrom: MODEL_SCORE_FROM };
  const cuts = (named ?? "").split(",").filter(Boolean);
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (cuts.length === 0 || !from || !cuts.every((cut) => day.test(cut)) || !day.test(from)) {
    console.log(
      "Name the cuts and the scoring day together, as days: --cuts=DAY,DAY --score-from=DAY."
    );
    process.exit(2);
  }
  if (cuts.some((cut) => cut >= from)) {
    console.log("The scoring day must come after every cut.");
    process.exit(2);
  }
  return { cuts, scoreFrom: from };
})();

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
    "  cut         rated games before   scored after   decided   left out: across ages, stand-ins   residual scale"
  );
  for (const cut of sweep.cuts) {
    say(
      `  ${cut.cut}  ${String(cut.trained).padStart(19)}  ${String(cut.scored).padStart(13)}  ${String(cut.decided).padStart(8)}  ${String(cut.crossAge).padStart(10)}  ${String(cut.standIns).padStart(9)}   ${cut.residualScale.toFixed(3).padStart(14)}`
    );
  }
  say(
    `  Scored: ${sweep.games} games over the cuts, ${sweep.decided} of them decided; ` +
      `${sweep.crossAge} across ages and ${sweep.standIns} with a stand-in left out, ` +
      "since no board states those."
  );
  const keyWidth = Math.max(12, ...sweep.variants.map(({ key }) => key.length));
  say("\n  Lower is better. Against the shipped model, game by game, + is better, z by club:");
  say(
    `  ${"setting".padEnd(keyWidth)}  log loss  Brier    margin²   log loss vs shipped        Brier vs shipped           margin² vs shipped        fits`
  );
  for (const variant of sweep.variants) {
    const vs = variant.vsShipped;
    say(
      `  ${variant.key.padEnd(keyWidth)}  ${fixed(variant.logLoss).padEnd(8)}  ${fixed(variant.brier).padEnd(7)}  ${fixed(variant.squared, 2).padStart(7)}   ${paired(vs?.logLoss).padEnd(25)}  ${paired(vs?.brier).padEnd(25)}  ${paired(vs?.squared, 3).padEnd(24)}  ${variant.seconds.toFixed(0)} s`
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
  describeSlices(sweep, keyWidth);
};

/**
 * Where the chances go wrong, for the shipped model and every setting that reads a matchup's
 * ratings or its curve differently (`ModelVariant.ratings`, `.share`, `.weight`): in each band of
 * each slice (`VariantSlices`), the chance said to the side read less how often it won, in points,
 * so + is too sure of that side. Every setting's band holds the same games.
 */
const describeSlices = (sweep: ModelSweep, keyWidth: number) => {
  const shown = new Set(
    MODEL_VARIANTS.filter(
      (variant, at) =>
        at === 0 ||
        variant.ratings !== undefined ||
        variant.share !== undefined ||
        variant.weight !== undefined
    ).map(({ key }) => key)
  );
  const rows = sweep.slices.filter(({ key }) => shown.has(key));
  const first = rows[0];
  if (!first) return;
  const cell = (band: SliceBand) => {
    if (band.games === 0) return "-".padStart(16);
    const by = (band.said - band.won) * 100;
    return `${by >= 0 ? "+" : ""}${by.toFixed(1)}`.padStart(16);
  };
  const versus = ({ vsShipped }: SliceBand) => {
    if (!vsShipped) return "-".padStart(16);
    const z = vsShipped.standardError > 0 ? vsShipped.by / vsShipped.standardError : 0;
    return `${vsShipped.by >= 0 ? "+" : ""}${vsShipped.by.toFixed(4)} (${z.toFixed(1)})`.padStart(
      16
    );
  };
  const table = (heading: string, of: (slices: (typeof rows)[number]) => SliceBand[]) => {
    say(`\n  ${heading}`);
    say(
      `    ${"".padEnd(keyWidth)}${of(first)
        .map(({ label }) => label.padStart(16))
        .join("")}`
    );
    say(
      `    ${"games".padEnd(keyWidth)}${of(first)
        .map(({ games }) => String(games).padStart(16))
        .join("")}`
    );
    say(
      `    ${"won".padEnd(keyWidth)}${of(first)
        .map(({ games, won }) => (games > 0 ? `${(won * 100).toFixed(1)}%` : "-").padStart(16))
        .join("")}`
    );
    for (const slices of rows) {
      say(`    ${slices.key.padEnd(keyWidth)}${of(slices).map(cell).join("")}`);
    }
    say(`    log loss lower than shipped's in the band, + better, z by club:`);
    say(
      `    ${"shipped's".padEnd(keyWidth)}${of(first)
        .map(({ games, logLoss }) => (games > 0 ? fixed(logLoss) : "-").padStart(16))
        .join("")}`
    );
    for (const slices of rows.slice(1)) {
      say(`    ${slices.key.padEnd(keyWidth)}${of(slices).map(versus).join("")}`);
    }
  };
  say(
    "\n  Where the chances go wrong: the chance said less how often that side won, in points (+ too" +
      "\n  sure of it), every setting's band holding the same decided games."
  );
  table("The favourite, by days from the cut to the game:", ({ horizon }) => horizon);
  table("The favourite, by the weighed games behind the thinner club:", ({ thinnest }) => thinnest);
  table("The thinner club, by how far apart the two ratings' errors are:", ({ apart }) => apart);
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
    ? fromBackup(path, !has("stand-in-rules") && !has("why-unjoined"))
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
  if (has("why-unjoined")) {
    say(
      `\n${"=".repeat(78)}\nWhy the stand-ins that should have joined did not\n${"=".repeat(78)}`
    );
    const { refused } = source.tidyAnswers();
    const digest = flag("name-sha256");
    if (digest) {
      const pool = { ageGroups: source.ageGroups, teams: source.teams, games: source.allGames() };
      const matches = (key: string) => createHash("sha256").update(key).digest("hex") === digest;
      oneNameLines(oneNameRows(pool, year, matches, refused)).forEach((line) => say(line));
      // Each pulled club of the name, game by game, against the games the boards are built from.
      const known = deriveAllKnown({
        ageGroups: source.ageGroups,
        teams: source.teams,
        yearGames: source.gamesOfYear(year),
        readSeason: source.readSeason,
        autoRemoved: source.autoRemoved,
      });
      const board = { games: new Set(known.games.map((game) => game.id)), removed: known.removed };
      pool.teams
        .filter((team) => !team.nameOnly && !team.placeholder && matches(teamNameKey(team.name)))
        .forEach((team) =>
          clubGameLines(pool, team.id, year, board, source.today).forEach((line) => say(line))
        );
      // Each League Standings team of the name, nameless: how its link reads and where it went.
      const pulledOfName = new Set(
        pool.teams
          .filter((team) => team.gcTeams?.length && matches(teamNameKey(team.name)))
          .map((team) => team.id)
      );
      const byId = new Map(known.teams.map((team) => [team.id, team]));
      const carriers = gcCarriersOf(pool.teams);
      const lookup = new Map(pool.teams.map((team) => [team.id, team]));
      source.ageGroups.forEach((group) => {
        group.seasonIds.forEach((seasonId, at) => {
          const season = source.readSeason(seasonId);
          season.teams
            .filter((team) => matches(teamNameKey(team.name)))
            .forEach((team) => {
              const pick = team.scoutTeamId;
              const read = readPick(team, lookup, carriers);
              const onto = known.leagueClubs.get(group.id)?.get(seasonId)?.get(team.id);
              const ontoClub = onto === undefined ? undefined : byId.get(onto);
              const games = known.derivedGames.filter(
                (game) => game.teamAId === onto || game.teamBId === onto
              );
              say(
                `  League team of the name, on the ${ageGroupLevel(group) ?? "?"}U ${
                  ageGroupYear(group) ?? "?"
                } page, season ${at + 1} of ${group.seasonIds.length}: pick ${
                  pick === undefined
                    ? "none"
                    : pick === NO_SCOUT_TEAM
                      ? "NOT IN TEAM RANKINGS"
                      : pulledOfName.has(pick)
                        ? "the pulled club"
                        : lookup.has(pick)
                          ? "another club"
                          : "an id no club holds"
                }; its GameChanger id ${
                  team.scoutGcTeamId === undefined
                    ? "none kept"
                    : [...pulledOfName].some((id) =>
                          lookup
                            .get(id)
                            ?.gcTeams?.some((link) => link.teamId === team.scoutGcTeamId)
                        )
                      ? "the pulled club's"
                      : "another's or none's"
                }; read as ${
                  read.moved !== undefined
                    ? "MOVED"
                    : read.pick === undefined
                      ? "no pick"
                      : pulledOfName.has(read.pick)
                        ? "the pulled club"
                        : "another club"
                }; carried onto ${
                  onto === undefined
                    ? "nothing"
                    : pulledOfName.has(onto)
                      ? "the pulled club"
                      : isOffClubId(onto)
                        ? "A CLUB OF ITS OWN (not in Team Rankings)"
                        : ontoClub?.gcTeams?.length
                          ? "another pulled club"
                          : "A CLUB MADE FOR IT"
                }; ${games.length} league games, ${games.filter((game) => isScoutGamePlayed(game)).length} scored`
              );
            });
        });
      });
    }
    unjoinedReasonLines(
      unjoinedReasons(
        { ageGroups: source.ageGroups, teams: source.teams, games: source.allGames() },
        year,
        refused
      )
    ).forEach((line) => say(line));
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
      cuts: sweepCuts.cuts,
      scoreFrom: sweepCuts.scoreFrom,
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
