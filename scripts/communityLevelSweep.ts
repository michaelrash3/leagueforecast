/**
 * Measures a results-aware league level against the counted one, on a pool read once, and in the
 * same run says why the clubs behind games won by a hundred or more are or are not taken off and
 * what H at a lower line would take off. A research tool, as `recencySweep.ts` is: what it finds
 * becomes a constant, or a rule, by a commit that pins the boards first.
 *
 *   npm run community:sweep -- <backup.json>          a backup the app wrote (`readSweepFile`)
 *   FIREBASE_SERVICE_ACCOUNT="$(cat key.json)" npm run community:sweep -- --cloud
 *                                                     the cloud copy, read once, read only
 *   npm run community:sweep -- --synthetic[=SEED]     the seeded pool, with the Longhorns planted
 *
 * Options: --year=2027 (the squad year compared), --cuts=2026-09-01,2026-09-08,2026-09-15,
 * --score-from=2026-09-23, --score-to=DAY, --today=DAY (the board's day; the members' day by
 * default), --club=Longhorns --city=Edgewood --state=KY --club-page="9U 2027" (the club printed
 * under each variant), --level-variants=k20,k5 (the level variants fitted beside the control, every
 * one when left out; the control alone with --level-variants=control, which is all the proven orders
 * read), --clubs=N (the synthetic pool's clubs a page), --no-league (League Standings
 * not read from the cloud), --no-gc (the club's league is not asked of GameChanger), --skip-levels
 * or --skip-removals (one section only), --public (numbers
 * only), --seal=FILE (the named lines, sealed to the key's own public key, or with
 * --seal-to-key=PEM to that public key), and --open=FILE (unseal one, with
 * FIREBASE_SERVICE_ACCOUNT set to the same key, or --with-key=PEM the private key).
 *
 * The cloud copy is read as the nightly reads it (`cloudPool.ts`, `loadPoolFrom`), its League
 * Standings seasons as the publish reads them (`readCloudLeague`), on stores opened to read
 * (`openStores(key, false)`), so a slip anywhere here cannot write to it, and every piece is read
 * once. Nothing is saved: the sweep's marks are worked out in memory and printed.
 *
 * On GitHub (`GITHUB_ACTIONS`), or with --public, it prints numbers, days and scores only, as every
 * workflow of this public repository does: no club, league or name. The lines that name clubs (the
 * club asked about, the clubs behind each game won by a hundred, the sample of clubs H at forty
 * would take off) go only into the sealed file, which opens with the Firebase key the run read the
 * copy with, so the owner can read them without a second read of the copy.
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
import type { SweepAnswers } from "../src/lib/obviousFakes.ts";
import {
  deriveAllKnown,
  gamesOnPages,
  leagueLinkedClubsOf,
  type LeagueSeasonData,
  type SeasonReader,
} from "../src/lib/live/allKnown.ts";
import { asWorkerSees } from "../src/lib/live/views/board.ts";
import { readCloudLeague, seasonReaderOf } from "../src/lib/live/cloudLeague.ts";
import { fetchValues } from "../src/lib/cloud/cloudEngine.ts";
import { LEAGUE_PART } from "../src/lib/cloud/cloudPlan.ts";
import { loadPoolFrom } from "../src/lib/cloud/cloudRunner.ts";
import { failureWords } from "../src/lib/cloud/firestoreRest.ts";
import { todayIsoDay } from "../src/lib/date.ts";
import { describeTidy } from "../src/lib/gameChangerImport.ts";
import {
  loadAgeGroups,
  loadArchiveIndex,
  loadAutoRemoved,
  loadKeptApart,
  loadNamedAges,
  loadRealClubs,
  loadScoutGames,
  loadScoutGamesForYear,
  loadScoutTeams,
  resetTeamRankingsStore,
  storedGamesByYear,
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
import { LONGHORNS } from "./closedLeagueFixture.ts";
import {
  DEFAULT_CUTS,
  DEFAULT_SCORE_FROM,
  describeCommunitySweep,
  LEVEL_VARIANTS,
  runCommunitySweep,
} from "./communitySweep.ts";
import { describeRemovalDiagnosis, runRemovalDiagnosis } from "./removalDiagnosis.ts";
import { compareWithGameChanger, describeClubLeague } from "./clubLeagueReport.ts";
import { fetchGcTeams } from "../src/lib/gameChangerClient.ts";
import { handlerFetch } from "./handlerFetch.ts";
import { readSweepFile, sweepTidy } from "./sweepTidy.ts";
import { sweepFixture } from "./sweepFixture.ts";

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

/** Whatever was read, laid out the same way: the analysis after this cannot tell the sources apart. */
type Source = {
  label: string;
  ageGroups: AgeGroup[];
  /** The stored roster, as `loadScoutTeams` decodes it. */
  teams: ScoutTeam[];
  gamesOfYear: (year: number | undefined) => ScoutGame[];
  /** Every stored year at once, as the nightly's sweep reads the pool. */
  allGames: () => ScoutGame[];
  readSeason: SeasonReader;
  leagueRead: boolean;
  autoRemoved: AutoRemovals;
  answers: SweepAnswers;
  archived: ReadonlyArray<{ id: string; ageLevel?: number; year?: number }>;
  storedByYear: () => { year: number | undefined; games: number }[];
  today: string;
};

const NO_SEASON: LeagueSeasonData = { teams: [], matchups: [], logs: {} };

/** Stored games per squad year, counted off a list as the store counts its shards. */
const byYearOf = (ageGroups: AgeGroup[], games: ScoutGame[]) => {
  const yearOf = new Map(ageGroups.map((group) => [group.id, ageGroupYear(group)]));
  const counts = new Map<number | undefined, number>();
  games.forEach((game) => {
    const year = yearOf.get(game.ageGroupId);
    counts.set(year, (counts.get(year) ?? 0) + 1);
  });
  return [...counts].map(([year, count]) => ({ year, games: count }));
};

/** A list's games, one squad year's at a time. */
const yearsOf = (ageGroups: AgeGroup[], games: ScoutGame[]) => {
  const yearOf = new Map(ageGroups.map((group) => [group.id, ageGroupYear(group)]));
  return (year: number | undefined) => games.filter((game) => yearOf.get(game.ageGroupId) === year);
};

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
  const answers = pool.answers;
  return {
    label: `the backup ${path}`,
    ageGroups,
    teams,
    gamesOfYear: yearsOf(ageGroups, games),
    allGames: () => games,
    readSeason: seasons ?? (() => NO_SEASON),
    leagueRead: seasons !== null,
    autoRemoved: coerceAutoRemovals(answers?.autoRemoved ?? []),
    answers: {
      realClubs: new Set(answers?.realClubs ?? []),
      keptApart: new Set(answers?.keptApart ?? []),
      namedAges: new Map((answers?.namedAges ?? []).map((named) => [named.teamId, named])),
    },
    archived: (pool.archives ?? []).map(({ id, ageLevel, year }) => ({
      id,
      ...(ageLevel === undefined ? {} : { ageLevel }),
      ...(year === undefined ? {} : { year }),
    })),
    storedByYear: () => byYearOf(ageGroups, games),
    today: flag("today") || todayIsoDay(),
  };
};

const fromSynthetic = (): Source => {
  const seed = Number(flag("synthetic") || 7);
  const clubsPerPage = Number(flag("clubs") || 300);
  const pool = sweepFixture({ seed, clubsPerPage });
  return {
    label: `the seeded pool (seed ${seed}, ${clubsPerPage} clubs a page), a closed league planted`,
    ageGroups: pool.ageGroups,
    teams: pool.teams,
    gamesOfYear: yearsOf(pool.ageGroups, pool.games),
    allGames: () => pool.games,
    readSeason: (id) => pool.seasons[id] ?? NO_SEASON,
    leagueRead: true,
    autoRemoved: coerceAutoRemovals(pool.marks),
    answers: { realClubs: new Set(pool.realClubs), keptApart: new Set(), namedAges: new Map() },
    archived: [],
    storedByYear: () => byYearOf(pool.ageGroups, pool.games),
    today: flag("today") || pool.today,
  };
};

/**
 * The cloud copy, read once into the app's own pool store in memory, on stores opened to read; and
 * its League Standings seasons as the publish reads them, their documents or the copy's own part.
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
  if (!has("no-league")) {
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
  }
  console.log(
    leagueRead
      ? "  League Standings read, as the publish reads it."
      : "  League Standings not read: pages that carry seasons are fitted without their games."
  );
  return {
    label: "the cloud copy",
    ageGroups: loadAgeGroups(),
    teams: loadScoutTeams(),
    gamesOfYear: loadScoutGamesForYear,
    allGames: loadScoutGames,
    readSeason,
    leagueRead,
    autoRemoved: loadAutoRemoved(),
    answers: { realClubs: loadRealClubs(), keptApart: loadKeptApart(), namedAges: loadNamedAges() },
    archived: loadArchiveIndex(),
    storedByYear: storedGamesByYear,
    today: flag("today") || todayIsoDay(),
  };
};

/* ------------------------------------------------------------------------- sealing the names */

const SEALED_FORMAT = "league-forecast-community-sweep-sealed";
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
const privateKeyOf = (keyJson: string): string => {
  try {
    const key = (JSON.parse(keyJson) as { private_key?: unknown }).private_key;
    if (typeof key === "string") return key;
  } catch {
    // Not the parser's message, which would quote the key.
  }
  throw new Error("FIREBASE_SERVICE_ACCOUNT is not a service account key's JSON.");
};

/**
 * The public key the named lines are sealed to: the PEM file `--seal-to-key` names, else the one
 * derived from the Firebase key the run reads the copy with. The repository is public and so is a
 * run's log, so the sealed text may be printed there; only the private key's holder opens it, and
 * a key made for the reader, whose private half never leaves the reader's machine, lets the sealed
 * text be read from the log itself, with no artifact to download and no Firebase key to hand.
 */
const sealingKey = (keyJson: string | undefined): ReturnType<typeof createPublicKey> | null => {
  const pem = flag("seal-to-key");
  if (pem) return createPublicKey(readFileSync(pem, "utf8"));
  return keyJson ? createPublicKey(privateKeyOf(keyJson)) : null;
};

/**
 * `text` sealed to `publicKey`: AES-256-GCM under a fresh key, that key under RSA-OAEP. Only the
 * holder of the private key opens it.
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
  if (parsed.format !== SEALED_FORMAT) throw new Error("That is not a sealed sweep report.");
  const aes = privateDecrypt({ key: privateKey, ...OAEP }, fromBase64(parsed.key ?? ""));
  const decipher = createDecipheriv("aes-256-gcm", aes, fromBase64(parsed.iv ?? ""));
  decipher.setAuthTag(fromBase64(parsed.tag ?? ""));
  const text = joined(decipher.update(fromBase64(parsed.data ?? "")), decipher.final());
  return new TextDecoder().decode(text);
};

/* -------------------------------------------------------------------------------------- run */

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
    say(
      `  (${lines.length} line(s) naming clubs left out of this log${has("seal") ? "; sealed" : ""})`
    );
    return;
  }
  say(`  ${heading}`);
  lines.forEach((line) => say(line));
};

const started = Date.now();
const since = () => `${((Date.now() - started) / 1000).toFixed(1)} s`;

const main = async (): Promise<void> => {
  const opening = flag("open");
  if (opening) {
    // With --with-key, the PEM private key the sealing key was made from; else the Firebase key.
    const pem = flag("with-key");
    const key = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!pem && !key)
      throw new Error("Set FIREBASE_SERVICE_ACCOUNT to the key the run read the copy with.");
    console.log(
      open(readFileSync(opening, "utf8"), pem ? readFileSync(pem, "utf8") : privateKeyOf(key!))
    );
    return;
  }
  const path = args.find((arg) => !arg.startsWith("--"));
  if (!path && !has("cloud") && !has("synthetic")) {
    console.log(
      "usage: npm run community:sweep -- <backup.json> | --cloud | --synthetic[=SEED]  [options]\n" +
        "  see the head of scripts/communityLevelSweep.ts for the options"
    );
    process.exitCode = 1;
    return;
  }
  const source = path ? fromBackup(path) : has("cloud") ? await fromCloud() : fromSynthetic();
  say(`Community-level sweep on ${source.label}, the board's day ${source.today}.`);
  say(
    `  ${source.ageGroups.length} pages, ${source.teams.length} teams; League Standings` +
      ` ${source.leagueRead ? "read" : "not read"}; ${source.autoRemoved.size} GameChanger ids marked` +
      ` as plainly made up. Read in ${since()}.`
  );

  if (!has("skip-levels")) {
    try {
      const year = Number(flag("year") || 2027);
      const page = source.ageGroups.find(
        (group) => ageGroupYear(group) === year && scoutFitRanks(group.id, source.ageGroups)
      );
      if (!page) {
        say(
          `\nNo ranked page of squad year ${year} in this pool: the level comparison has nothing to fit.`
        );
      } else {
        // The year's pool as the boards fit it: League Standings' games with the stored ones, the
        // clubs taken off left out, after the worker's codec (`weeklyClosedLevel` does the same).
        const known = deriveAllKnown({
          ageGroups: source.ageGroups,
          teams: source.teams,
          yearGames: source.gamesOfYear(year),
          readSeason: source.readSeason,
          autoRemoved: source.autoRemoved,
        });
        const poolIds = rankingPoolGroupIds(page.id, source.ageGroups);
        const pool = asWorkerSees(known.teams, gamesOnPages(known.games, poolIds));
        say(`\n${"=".repeat(78)}\nWhere a league's rating starts\n${"=".repeat(78)}`);
        // The control always, first: every other variant and each proven order is read against it.
        const variantKeys = flag("level-variants")?.split(",");
        const chosen = LEVEL_VARIANTS.filter(
          (variant, at) => at === 0 || (variantKeys ?? []).includes(variant.key)
        );
        const sweep = runCommunitySweep({
          ageGroups: source.ageGroups,
          teams: pool.teams,
          games: pool.games,
          pageId: page.id,
          today: source.today,
          cuts: (flag("cuts") || DEFAULT_CUTS.join(",")).split(","),
          scoreFrom: flag("score-from") || DEFAULT_SCORE_FROM,
          ...(flag("score-to") ? { scoreTo: flag("score-to")! } : {}),
          club: {
            name: flag("club") || LONGHORNS.name,
            city: flag("city") || LONGHORNS.city,
            state: flag("state") || LONGHORNS.state,
            page: flag("club-page") || "9U 2027",
          },
          ...(variantKeys ? { variants: chosen } : {}),
          now: () => performance.now(),
        });
        const report = describeCommunitySweep(sweep);
        report.lines.forEach((line) => say(line));
        sayNamed(report.named, "The club asked about, by name:");
        say(`  (the level comparison done at ${since()})`);
        // The club's league as its own schedule names it, and what GameChanger lists now for each
        // of its clubs that the pool lacks: asked of GameChanger from this machine, through the
        // proxy's own handler (`handlerFetch.ts`), as the nightly asks, never the cloud's proxy.
        const league = sweep.clubLeague;
        if (league) {
          const ids = league.league.flatMap((club) => club.gcTeamIds);
          const pulledNow =
            has("synthetic") || has("no-gc") || ids.length === 0
              ? undefined
              : await fetchGcTeams(ids, { fetchImpl: handlerFetch(), concurrency: 2 });
          const told = describeClubLeague(
            league,
            pulledNow && compareWithGameChanger(league, pool.teams, pool.games, pulledNow)
          );
          told.lines.forEach((line) => say(line));
          sayNamed(told.named, "Its league, club by club, and what GameChanger lists now:");
          say(`  (the league report done at ${since()})`);
        }
      }
    } catch (error) {
      say(`The level comparison stopped: ${failureWords(error)}`);
      process.exitCode = 1;
    }
  }

  if (!has("skip-removals")) {
    try {
      const teams = source.teams;
      const games = source.allGames();
      const ageGroups = source.ageGroups;
      say(
        `\n${"=".repeat(78)}\nClubs taken off for a game won by a hundred, and H at lower lines\n${"=".repeat(78)}`
      );
      const found = runRemovalDiagnosis({
        ageGroups,
        teams,
        games,
        answers: source.answers,
        marks: source.autoRemoved,
        today: source.today,
        leagueLinked: source.leagueRead
          ? leagueLinkedClubsOf({ ageGroups, teams, games }, source.readSeason)
          : null,
        archived: source.archived,
        storedByYear: source.storedByYear(),
      });
      const report = describeRemovalDiagnosis(found);
      report.lines.forEach((line) => say(line));
      sayNamed(report.named, "The games and clubs above, by name and id:");
      say(`  (the removal sections done at ${since()})`);
    } catch (error) {
      say(`The removal sections stopped: ${failureWords(error)}`);
      process.exitCode = 1;
    }
  }

  const sealTo = flag("seal");
  if (sealTo) {
    const publicKey = sealingKey(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (!publicKey) say("\nNo key to seal the named lines with, so nothing was sealed.");
    else {
      writeFileSync(sealTo, seal(sealedLines.join("\n"), publicKey));
      say(
        `\nThe ${sealedLines.length} named line(s) are sealed in ${sealTo}. Open them with the private key:` +
          `\n  npm run community:sweep -- --open=${sealTo} --with-key=<private.pem>` +
          `\n  (or, sealed to the Firebase key, FIREBASE_SERVICE_ACCOUNT="$(cat key.json)" in its place)`
      );
    }
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
