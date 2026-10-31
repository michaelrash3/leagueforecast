import { todayIsoDay } from "../date";
import { forgetClubs, isDeletedClub } from "../deletedGames";
import {
  PASTE_HANDFUL,
  withListed,
  type GcTeamListEntry,
  type GcTeamResponse,
  type GcTeamSchedule,
} from "../gameChangerApi";
import {
  PULL_CONCURRENCY,
  PULL_MAX_CONCURRENCY,
  type FetchGcTeamsOptions,
} from "../gameChangerClient";
import {
  createGcImporter,
  poolSignature,
  stampFromNewerRules,
  tidyChangedAnything,
  tidyPool,
  vouchedByImport,
  type GcImportOutcome,
  type GcImportState,
  type TidyWatcher,
} from "../gameChangerImport";
import { lastPulled, localDayKey, markRefreshed, type RefreshLog } from "../gameChangerSchedule";
import { orgAgesByTeam } from "../orgMembership";
import { isRefusedClub } from "../refusedClubs";
import { memoryIo } from "../poolMemoryIo";
import { persistPool } from "../poolPersist";
import { settleRunLists } from "../pullLists";
import { refreshNow, storedRota, type RefreshNow } from "../storedRota";
import { pulledGcTeamIds } from "../teamRankings";
import { leagueLinkedClubsOf, type SeasonReader } from "../live/allKnown";
import { leagueSeasonsOf, NO_LEAGUE_DOCS, type LeagueDocsList } from "../live/cloudLeague";
import type { SweepPool } from "../obviousFakes";
import { sweepStored } from "../sweepStored";
import { lopsidedDrops } from "../lopsidedDrops";
import { runPoolCommand } from "../live/runPoolCommand";
import { segmentOn } from "../teamRankings/seasons";
import { isTooYoungClub } from "../tooYoungClubs";
import {
  applyCloudPoolValues,
  flushPoolWrites,
  initTeamRankingsStore,
  loadAgeGroups,
  loadAgeUnknown,
  loadDeletedGames,
  loadDroppedClubs,
  loadKeptApart,
  loadNamedAges,
  loadNotThisTeam,
  loadOrgMembership,
  loadRealClubs,
  loadRefreshLog,
  loadScoutGames,
  loadScoutTeams,
  loadTidyStamp,
  loadRefusedClubs,
  loadTooYoungClubs,
  onCloudPoolWrite,
  readCloudPoolValue,
  resetTeamRankingsStore,
  saveAutoRemoved,
  saveDroppedClubs,
  saveRefreshLog,
  saveTidyStamp,
  IMPORT_INDEX_KEYS,
} from "../teamRankingsStorage";
import { blastRadius, pastTheLine, poolYears, type YearRadius } from "./blastRadius";
import { commitChanges, fetchValues, type Change, type CloudStore } from "./cloudEngine";
import { ingestReading, type IngestReading } from "./ingestCanary";
import {
  DATA_SCHEMA,
  epochOf,
  sameEpoch,
  type CloudManifest,
  type CopyEpoch,
} from "./cloudManifest";
import { hashValue } from "./cloudPack";
import { LEAGUE_PART } from "./cloudPlan";

/**
 * A GameChanger pull run on the cloud copy rather than in a browser (README, "Pulls in the cloud"):
 * the nightly refresh, and a pasted list sent from a device. It reads the copy's Team Rankings into
 * the app's own pool store held in memory, as a device taking in a copy does, asks GameChanger for
 * the teams, files every answer through the same importer, tidy and end-of-run lists a pull in the
 * browser uses (`withListed`, `persistPool`, `settleRunLists`), and saves back to the copy the
 * values that changed and nothing else.
 *
 * The answers are asked for once. Where another device saved while they were being fetched, the
 * copy is read again and the same answers filed onto it, so a device's change made in the meantime
 * is built on rather than written over; a copy that keeps moving under three tries is left alone.
 * A copy whose Team Rankings was started again meanwhile is not built on: the answers were asked
 * for the pool as it was, and filing them into the emptied one would undo the start
 * (`CloudManifest.epoch`). League Standings and archived seasons are neither read nor written: a
 * pull touches neither.
 *
 * Nothing here reaches the network except through `store` and `fetchTeams`, so every rule is tried
 * against stand-ins (`cloudRunner.test.ts`). A Node process that runs it ends it with
 * `resetTeamRankingsStore`, which closes the channel the store opens to other tabs.
 */

/**
 * A leg of a refresh whose teams were worked out once, at its start ("Refresh now",
 * `pullJobRunner.ts`): these teams, and `ageLevels` logged as refreshed on `markOn`'s day, by the
 * last leg alone (`markOn` null on every other), and only where it asked about every team.
 */
export type RotaWalk = {
  teamIds: readonly string[];
  ageLevels: readonly number[];
  markOn: Date | null;
  /**
   * When the teams were worked out. A team the copy says was pulled after it is not asked about
   * again: that pull came after the press, so it is what the press asked for. It is how a leg tried
   * again after its save landed, when the job could not then be told (an update or a worker that
   * failed between the two), skips the teams that save already holds rather than asking
   * GameChanger about them all a second time minutes later.
   */
  workedAt: Date;
};

/** What to pull. */
export type CloudPullJob =
  /**
   * The teams the Refresh button would pull today, worked out from the copy's own settings. With a
   * `limit`, only the first that many, for a trial run; the day is then not logged as refreshed.
   * With a `walk`, a leg of a refresh worked out before, whose teams are not worked out again.
   */
  | { kind: "rota"; force?: boolean; limit?: number; walk?: RotaWalk }
  /**
   * A list of teams, filed in these squad years only: a paste, of which only the teams the pool
   * lacks are pulled, or with `refresh` a catch-up, every team on it (`listIds`).
   */
  | {
      kind: "list";
      entries: readonly GcTeamListEntry[];
      seasonYears: readonly number[];
      refresh?: boolean;
    };

export type CloudPullDeps = {
  store: CloudStore;
  /** `fetchGcTeams`, reaching GameChanger however the place running this does. */
  fetchTeams: (ids: string[], options: FetchGcTeamsOptions) => Promise<Map<string, GcTeamResponse>>;
  now: () => Date;
  /** Who the copy's manifest says saved (`ManifestPart.by`): "nightly", "cloud-pull". */
  device: string;
  signal?: AbortSignal;
  /** Told as each stage begins, for a job's progress. Counts only. */
  onStage?: (stage: CloudPullStage) => void;
  /**
   * Keep the values the run replaces as an earlier version of the copy, which any device can
   * bring back from its cloud panel (`KeptPart`). An unattended job's way back from a bad night.
   */
  keep?: boolean;
  /**
   * The copy, and the start of its Team Rankings, that the job this run is a part of first read
   * (`PullJob.on`, the staged import's plan): a run that finds another ends `copy-replaced` before
   * asking GameChanger anything, and its saves are held to it. Without it, the run holds its saves
   * to the copy and epoch it reads itself.
   */
  startedOn?: CopyEpoch;
  /**
   * The League Standings seasons' documents (`league/`), read as the boards read them
   * (`leagueSeasonsOf`) so the import and the tidy spare every club a League Standings team links.
   * None by default, which reads the copy's own `league` part, as League was kept before it had
   * documents.
   */
  leagueDocs?: LeagueDocsList;
  /**
   * Hold a save that would take too much of a year away (`blastRadius.ts`): the run ends `held`,
   * with what it would have taken, and the copy stays as it was. The nightly's, which runs
   * unattended; a pull a person starts saves what it filed.
   */
  cap?: boolean;
};

/** How a filing run reads League Standings, once as it starts to file: null where it could not. */
type LeagueRead = () => Promise<SeasonReader | null>;

/** Age passes request only unresolved ids; older sources can ignore the optional selection. */
export type ImportScheduleSource = (teamIds?: ReadonlySet<string>) => AsyncIterable<GcTeamSchedule>;

export type CloudPullStage =
  | { stage: "loading" }
  | { stage: "fetching"; done: number; total: number; failed: number }
  | { stage: "filing" }
  | { stage: "tidying" }
  | { stage: "saving"; attempt: number };

export type CloudPullEnd =
  /** Every team asked about was answered, one way or another, and the copy saved. */
  | "finished"
  /**
   * Stopped before every team was asked about; what was fetched is saved, and when nothing was,
   * the run ends at once without filing or saving anything.
   */
  | "stopped"
  /** GameChanger refused often enough that asking more would only fail more; what came is saved. */
  | "gave-up"
  /** Nothing was due, or the list was empty once thrown-out clubs were taken off it. */
  | "nothing-due"
  /** There is no cloud copy to pull into. */
  | "no-copy"
  /** The copy was saved by a newer build, or tidied by newer rules: this one leaves it alone. */
  | "newer-copy"
  /** Another device kept saving while this one tried to: nothing was written. */
  | "copy-kept-changing"
  /**
   * The copy was deleted and started again while this run fetched, or its Team Rankings was
   * started again, an earlier version brought back or a backup restored (`CloudManifest.epoch`),
   * since this run or the job it is part of read it. Its answers were for the pool as it was, and
   * the copy now is somebody's fresh start, so nothing was written to it.
   */
  | "copy-replaced"
  /**
   * The save would have taken more of a year's games or clubs than the line allows
   * (`pastTheLine`), so nothing was written; `held` says what it would have taken.
   */
  | "held";

export type CloudPullResult = {
  end: CloudPullEnd;
  /** Teams asked for. */
  asked: number;
  /** Teams GameChanger answered with a schedule, and teams it did not. */
  answered: number;
  failed: number;
  /** Teams filed, and the games that added or changed. */
  filed: number;
  gamesAdded: number;
  gamesUpdated: number;
  /** The keys this run wrote to the copy, and the copy's version after it. */
  changed: string[];
  version?: number;
  /** Times the copy had moved on and the answers were filed onto it again. */
  replays: number;
  /**
   * The copy the pool in this process's store now is: the one saved, or the one read when there was
   * nothing to save or nothing due. Absent on every other end, where the store holds filing no copy
   * has, or no copy at all, so nothing may be built from it as if it were one.
   */
  manifest?: CloudManifest;
  /** Where the run ended `held`: each year the save would have taken too much of. */
  held?: YearRadius[];
  /**
   * What the sweep deleted under the owner's 40-run rule, counted: in the copy where the run saved,
   * and what it would have deleted where it was held.
   */
  deleted?: { clubs: number; games: number };
  /** How much of what GameChanger listed the filing could read (`ingestCanary.ts`). */
  ingest?: IngestReading;
};

/**
 * Whether a pull asked GameChanger about teams and heard back about none: the proxy, GameChanger
 * or the network down for the whole run. Such a run saves nothing, since nothing changed, and
 * read as a quiet night; the nightly ends red on it, which is what raises its alarm.
 */
export const heardNothing = ({ asked, answered }: Pick<CloudPullResult, "asked" | "answered">) =>
  asked > 0 && answered === 0;

/** Tries at saving onto a copy that keeps moving before giving up on it. */
const MAX_TRIES = 3;

/** The store in memory, empty until the cloud's values are laid in. */
export { memoryIo };

/**
 * A key a pull never loads into its pool, never writes, and must never send. League Standings is
 * read apart, once a filing asks for the clubs it links (`leagueSeasonsOf`), and never kept.
 */
const outOfReach = (key: string): boolean => key === LEAGUE_PART || key.includes("_archive_rows_");

export type LoadedCopy = {
  manifest: CloudManifest;
  /** The pool's pieces read, and their size as stored. */
  keys: number;
  bytes: number;
  /** What each value read says, by key (`contentHash`): what a run's writes are set against. */
  said: ReadonlyMap<string, string>;
};

/** `value` with every object's keys in order, so two values that say the same thing read alike. */
const inOrder = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(inOrder);
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, inOrder(record[key])])
  );
};

/**
 * What a value says, whatever order its fields were written in. A copy's own fingerprint
 * (`ManifestPart.hash`) is of the value as saved, and the same age group made by the importer and
 * read back through storage lists its fields in two orders: set against that, a pull that changed
 * nothing sent the age groups again, and every device took a copy that was not new.
 */
const contentHash = (value: unknown): Promise<string> => hashValue(inOrder(value));

/**
 * Reads the cloud copy's pool into the app's pool store, in memory, starting it afresh, so the
 * app's loaders (`loadScoutTeams`, `loadRefreshLog`, …) read the copy. Null when there is no copy,
 * and when `signal` stopped the read before it ended, which a caller passing one tells apart by
 * the signal: a pull in the cloud stopped while it reads the copy ends at the next of the copy's
 * values rather than after all of them. On 11 October 2026 a 9,270-team pull stopped within a
 * minute or so of starting ran 379 s in all and filed nothing: the stop was read only once
 * GameChanger was to be asked, and the whole pool was tidied after it for no answer at all. Throws
 * on a piece missing or damaged, and on a pool key this build does not keep.
 */
export const loadPoolFrom = async (
  store: CloudStore,
  signal?: AbortSignal
): Promise<LoadedCopy | null> => {
  const manifest = await store.readManifest();
  if (!manifest) return null;
  const parts = manifest.parts.filter((part) => !outOfReach(part.key));
  // A value at a time, as `fetchValues` reads them in any case, so a stop is seen between them.
  const values = new Map<string, unknown>();
  for (const part of parts) {
    if (signal?.aborted) return null;
    const fetched = await fetchValues({ store, parts: [part] });
    if (!fetched.ok) throw new Error("A piece of the cloud copy's pool is missing or damaged.");
    for (const [key, value] of fetched.values) values.set(key, value);
  }
  if (signal?.aborted) return null;
  resetTeamRankingsStore();
  await initTeamRankingsStore(memoryIo());
  // Release the previous pool before hashing, and hash before building its second representation.
  // Otherwise the loaded pool sits beside the original values and the hash's temporary JSON.
  const said = new Map<string, string>();
  for (const [key, value] of values) said.set(key, await contentHash(value));
  if (!(await applyCloudPoolValues(values))) {
    throw new Error("The cloud copy holds a pool key this build does not keep.");
  }
  values.clear();
  return {
    manifest,
    keys: parts.length,
    bytes: parts.reduce((sum, part) => sum + part.bytes, 0),
    said,
  };
};

/**
 * A list's teams worth a request, as the device's own pull panel picks them from a paste: none
 * refused for good or as another season's, and none too young to rank, which would be refused at
 * filing after costing a request. Of a paste, only the teams the pool lacks; a handful pasted by
 * hand with none new is a refresh of those, which is how a schedule that changed today is read
 * before the rota comes round. A catch-up (`refresh`) pulls every one again.
 *
 * A row the paste marked as no team by its name (`notATeam`), which the live page's paste box
 * sends for this to settle, goes on as any row where the import's gate would pass it without
 * League Standings (`vouchedByImport`): its id on the real list, or the club carrying it the
 * user's own, a page's own team or on the real list, which is how the device's panel keeps it.
 *
 * League is the one voucher not read here. A staged import chooses its teams from the team index
 * alone, never the games (`selectImportTeams`), and League links a club by its name off the games
 * of a season's pages, so which clubs it vouches for cannot be worked out until the import files.
 * A marked row carried by a club only League could vouch for is therefore sent beside the rest,
 * for the import to settle with League read, but counts toward no handful: counted, a club's
 * practice link kept beside its clean one, or a page renamed since its last pull, tipped a
 * handful of 25 over the line and the refresh asked about nothing, where the device, which reads
 * League, left out such a row nobody vouched for and pulled the 25. It costs a request the import
 * may then refuse, and only where a page plays in a League season at all: with none, League
 * vouches for nobody, and the row is left out with every marked row the import is sure to refuse.
 */
const listIds = (job: Extract<CloudPullJob, { kind: "list" }>): string[] => {
  const refused = loadRefusedClubs();
  const tooYoung = loadTooYoungClubs();
  const teams = loadScoutTeams();
  const ageGroups = loadAgeGroups();
  const pulled = pulledGcTeamIds(teams);
  const vouched = vouchedByImport({ ageGroups, teams, games: [] }, loadRealClubs());
  const leagueMay = ageGroups.some((group) => group.seasonIds.length > 0);
  const sent = job.entries.flatMap(({ teamId, notATeam }) => {
    if (isRefusedClub(refused, teamId, job.seasonYears) || isTooYoungClub(tooYoung, teamId)) {
      return [];
    }
    if (!notATeam || vouched(teamId)) return [{ teamId, counted: true }];
    return leagueMay && pulled.has(teamId) ? [{ teamId, counted: false }] : [];
  });
  const ids = sent.map((row) => row.teamId);
  if (job.refresh === true) return ids;
  const kept = sent.filter((row) => row.counted).map((row) => row.teamId);
  // A row League may vouch for is a pool club's, so never fresh: it rides with a handful alone.
  const fresh = kept.filter((teamId) => !pulled.has(teamId));
  return fresh.length > 0 ? fresh : kept.length <= PASTE_HANDFUL ? ids : [];
};

/** Download selection reads just the team index, the pages and exclusions, once per whole import. */
export const selectImportTeams = async (
  store: CloudStore,
  job: Extract<CloudPullJob, { kind: "list" }>,
  alreadyPulledAfter?: Date
): Promise<CopyEpoch & { entries: GcTeamListEntry[] }> => {
  const manifest = await store.readManifest();
  if (!manifest) throw new Error("There is no cloud copy to import into.");
  if (manifest.schema > DATA_SCHEMA) throw new Error("Update the cloud importer before importing.");
  const fetched = await fetchValues({
    store,
    parts: manifest.parts.filter((p) => IMPORT_INDEX_KEYS.has(p.key)),
  });
  if (!fetched.ok) throw new Error("The cloud team index could not be read.");
  resetTeamRankingsStore();
  await initTeamRankingsStore(memoryIo());
  if (!(await applyCloudPoolValues(fetched.values)))
    throw new Error("The team index could not be loaded.");
  const dropped = loadDroppedClubs();
  const wanted = new Set(listIds(job).filter((id) => !isDeletedClub(dropped, id)));
  if (alreadyPulledAfter) {
    for (const [id, when] of lastPulled(loadScoutTeams())) {
      if (when > alreadyPulledAfter.getTime()) wanted.delete(id);
    }
  }
  const entries = [
    ...new Map(job.entries.filter((e) => wanted.has(e.teamId)).map((e) => [e.teamId, e])).values(),
  ].sort((a, b) => a.teamId.localeCompare(b.teamId, "en"));
  resetTeamRankingsStore();
  // The copy and the start of its Team Rankings the teams were chosen from, which the import files
  // into at the end, hours later, or not at all (`finishStagedImport`).
  return { ...epochOf(manifest), entries };
};

/**
 * Whether the copy the store holds is not this build's to change or build from: saved by a newer
 * build, or tidied by newer rules. Read off the pool once it is loaded (`loadPoolFrom`), so a server
 * that publishes the copy's views without pulling (`scripts/republish.ts`) asks it as a pull does.
 */
export const copyTooNew = (manifest: CloudManifest): boolean =>
  manifest.schema > DATA_SCHEMA || stampFromNewerRules(loadTidyStamp());

export type WorkedOutRefresh =
  | ({
      ok: true;
      /** The copy and the start of its Team Rankings the teams were worked out from. */
      on: CopyEpoch;
    } & RefreshNow)
  | { ok: false; end: Extract<CloudPullEnd, "no-copy" | "newer-copy"> };

/**
 * What "Refresh now" pulls, worked out from the copy at `now` as the card that offers it says
 * (`refreshNow`), for the first leg of its job to keep as the list every leg walks. It reads the
 * copy into the store as a pull does, so the leg then reads it once more for the pull itself: on the
 * nightly's numbers of 29 September 2026, what was left of its 101 s once the 27 s of asking and
 * the 62 s of filing are taken off, about 12 s, covered reading the copy and saving it both.
 */
export const workOutRefresh = async (store: CloudStore, now: Date): Promise<WorkedOutRefresh> => {
  const copy = await loadPoolFrom(store);
  if (!copy) return { ok: false, end: "no-copy" };
  if (copyTooNew(copy.manifest)) return { ok: false, end: "newer-copy" };
  return { ok: true, on: epochOf(copy.manifest), ...refreshNow(now) };
};

/**
 * What a filing did with each schedule, and how many entries each schedule listed, read or not
 * (`rowIds`), at the same places, for the ingest canary (`ingestReading`).
 */
type Filed = {
  outcomes: GcImportOutcome[];
  rows?: readonly number[];
  /** What the sweep deleted under the owner's 40-run rule: the clubs, and every game they were in. */
  deleted?: Deleted;
};

/** Clubs deleted for a game won or lost by 40 or more, and the games that went with them. */
type Deleted = { clubs: string[]; games: string[] };

/** The levels a run logs as refreshed once it has asked about every team, and on which day. */
type Marking = {
  ageLevels: readonly number[];
  /**
   * The day a refresh worked out at its start was for (`RotaWalk.markOn`), or null for the run's
   * own day, as the nightly logs it.
   */
  on: Date | null;
};

/**
 * The log with `mark`'s levels refreshed. The nightly's on its own day, as it always was. A walked
 * refresh's on the day it was worked out for, since its legs may end after midnight, and logged
 * with the day they ended on would tell that day's nightly its levels were done when they were
 * yesterday's; and never moving a level back, so a refresh that ends after the next day's nightly
 * logged its levels leaves that day's mark where the nightly put it.
 */
const withRefreshed = (log: RefreshLog, mark: Marking, now: Date): RefreshLog => {
  if (!mark.on) return markRefreshed(log, [...mark.ageLevels], now);
  const day = localDayKey(mark.on);
  return markRefreshed(
    log,
    mark.ageLevels.filter((level) => !((log[String(level)] ?? "") > day)),
    mark.on
  );
};

/**
 * The sweep for clubs plainly made up (`obviousFakes.ts`) over `pool`, the store's pool as the run
 * leaves it, on the run's own day, its marks saved where they changed. Saved into the store like
 * the rest of the run's filing, so they go to the copy in the run's one commit.
 *
 * A refresh's runs alone sweep, the nightly's and each leg of Refresh now's (`sweeps`), never a
 * pasted list's. The sweep walks every game of the pool, 1.5 s on the pool of 26 September 2026
 * at 18:40 and 2.5 s on 11 October's, measured in Node, and a whole squad year of about three
 * times the 11 October pool is to come in through pasted lists, leg after leg: each list leg is
 * kept as light as it can be, and the night's refresh sweeps what they filed.
 */
const sweep = (pool: SweepPool, now: Date, spared: ReadonlySet<string>): Deleted => {
  const [before, after] = sweepStored(pool, todayIsoDay(now));
  if (after !== before && !saveAutoRemoved(after)) {
    throw new Error("The store in memory refused the clubs taken off as plainly made up.");
  }
  /*
   * And deleted outright, as Delete club deletes one (`club.drop`, one command a club, as Pool
   * health sends them): every club marked for a game its own schedule reports won or lost by
   * `LOPSIDED_MARGIN` or more, the owner's rule of 27 October 2026 (`lopsidedDrops`). The club, every
   * game it is in and its mark go, and its GameChanger ids are refused by later pulls. Never one
   * the tidy spares (`sparedByTidy`), so a night that could not read League deletes none, and a
   * club a season's pick leans on stays marked, on its boards, as before.
   */
  const drops = lopsidedDrops(after, loadScoutTeams(), spared);
  // The games each goes with, read before it goes, for the nightly's cap (`blastRadius`).
  const gamesOf = new Map(drops.map((teamId) => [teamId, [] as string[]]));
  for (const game of drops.length > 0 ? loadScoutGames() : []) {
    gamesOf.get(game.teamAId)?.push(game.id);
    if (game.teamBId !== game.teamAId) gamesOf.get(game.teamBId)?.push(game.id);
  }
  const clubs: string[] = [];
  // A set, as a game two deleted clubs played is in both of theirs (Codex on #495).
  const games = new Set<string>();
  for (const teamId of drops) {
    const run = runPoolCommand({ kind: "club.drop", teamId });
    if (!run.ok && run.why !== "missing") {
      throw new Error("The store in memory refused a club deleted for a lopsided score.");
    }
    if (!run.ok) continue;
    clubs.push(teamId);
    for (const game of gamesOf.get(teamId) ?? []) games.add(game);
  }
  return { clubs, games: [...games] };
};

/**
 * Whether `job` sweeps: a refresh of the pool (a rota job), never a list, a catch-up list with
 * `refresh` included, which asks about every team on it but is still a list leg.
 */
const sweeps = (job: CloudPullJob): boolean => job.kind === "rota";

/** The sweep alone, for a refresh with nothing to pull: the pool as the copy holds it. */
const sweepOnly = async (now: Date, league: LeagueRead): Promise<Filed> => {
  const pool = { ageGroups: loadAgeGroups(), teams: loadScoutTeams(), games: loadScoutGames() };
  const deleted = sweep(pool, now, sparedByTidy(pool, await league()));
  if (!(await flushPoolWrites())) throw new Error("The store in memory refused the sweep's marks.");
  return { outcomes: [], deleted };
};

/**
 * Files `answers` into the pool the store holds, tidies it, and writes it back with what the run
 * learned, as a pull in the browser ends: the tidy stamped so no device tidies it again, the
 * lists, the invented clubs thrown out, on a refresh the clubs plainly made up taken off, and the
 * day logged where a rota finished.
 */
const fileAnswers = async (
  job: CloudPullJob,
  ids: readonly string[],
  answers: ReadonlyMap<string, GcTeamResponse>,
  mark: Marking | null,
  complete: boolean,
  now: Date,
  league: LeagueRead
): Promise<Filed> =>
  fileScheduleSource(
    job,
    () =>
      (async function* () {
        for (const id of ids) {
          const answer = answers.get(id);
          if (answer?.ok) yield answer.schedule;
        }
      })(),
    mark,
    complete,
    now,
    league,
    undefined,
    undefined,
    false,
    undefined,
    undefined,
    invalidIdsOf(answers)
  );

/**
 * The ids GameChanger said are not team ids (HTTP 400), which a run remembers for good: none where
 * no id was answered, as the staged import holds too (`runStagedImport`). A route that answers
 * every id alike with HTTP 400 (GameChanger changing it, or the proxy broken) would otherwise mark
 * every real club in the run for good, and every later paste would skip them.
 */
const invalidIdsOf = (answers: ReadonlyMap<string, GcTeamResponse>): string[] =>
  [...answers.values()].some((answer) => answer.ok)
    ? [...answers].flatMap(([id, answer]) =>
        !answer.ok && answer.reason === "invalid-id" ? [id] : []
      )
    : [];

/**
 * The clubs the tidy deletes none of for its name (`dropNotATeam`): those said to be real, and
 * every club a League Standings team links (`leagueLinkedClubs`), which only the League pass sees,
 * as the device's tidy is told them. Where League could not be read, every team in the pool, so the
 * step deletes nothing that run rather than a club a season's pick leans on, which a deletion would
 * leave pointing at nothing; the next run that reads League does what this one left. Exported for
 * the research sweep that tidies the copy as the nightly does (`scripts/modelSweep.ts`).
 */
export const sparedByTidy = (pool: GcImportState, seasons: SeasonReader | null): Set<string> => {
  const real = loadRealClubs();
  if (!seasons) return new Set([...real, ...pool.teams.map((team) => team.id)]);
  return new Set([...real, ...leagueLinkedClubsOf(pool, seasons)]);
};

const fileScheduleSource = async (
  job: CloudPullJob,
  schedules: ImportScheduleSource,
  mark: Marking | null,
  complete: boolean,
  now: Date,
  league: LeagueRead,
  onTidy?: () => void | Promise<void>,
  watchTidy?: TidyWatcher,
  retryUnaged = false,
  onOutcomes?: (outcomes: readonly GcImportOutcome[]) => Promise<void>,
  onAgeProgress?: (pass: number, done: number, total: number) => Promise<void>,
  invalidIds: readonly string[] = []
): Promise<Filed> => {
  const pool = { ageGroups: loadAgeGroups(), teams: loadScoutTeams(), games: loadScoutGames() };
  const orgAges = orgAgesByTeam(loadOrgMembership());
  // The names the owner has said are not a club ("Not this team"), as a pull in the browser reads
  // them: neither the import nor the tidy after it files such a name onto that club again.
  const refused = loadNotThisTeam();
  // League Standings, read once for the import and the tidy both (`sparedByTidy`).
  const seasons = await league();
  const importer = createGcImporter(pool, {
    deleted: loadDeletedGames(),
    droppedClubs: loadDroppedClubs(),
    tooYoung: loadTooYoungClubs(),
    namedAges: loadNamedAges(),
    notThisTeam: refused,
    /*
     * And the clubs the owner vouched for, whose schedule no word in their name refuses, as the
     * tidy deletes none of them: the real list, and what League Standings links where it could be
     * read. Where it could not, the real list alone, so a night with no League files no page the
     * rules refuse; its tidy then deletes nothing.
     */
    realClubs: new Set([
      ...loadRealClubs(),
      ...(seasons ? leagueLinkedClubsOf(pool, seasons) : []),
    ]),
    // Where League could not be read, that the list is short: a row the gate turns away then takes
    // no game already filed on it, as that night's tidy deletes no club for its name.
    ...(seasons ? {} : { realClubsShort: true }),
    // The run's own day, which is the user's where the process runs in their time zone.
    today: todayIsoDay(now),
    ...(job.kind === "list" && job.seasonYears.length > 0
      ? { seasonYears: new Set(job.seasonYears) }
      : {}),
    // The waiting teams the rota asks about beside its own, held to the season being played as
    // the Import tab's "Ask again" holds them, so a squad from a year put away is refused
    // (`other-season`) and leaves the list rather than being filed back onto that year's page.
    ...(job.kind === "rota"
      ? {
          seasonYears: new Set([segmentOn(todayIsoDay(now)).year]),
          seasonYearsFor: new Set(loadAgeUnknown().map((entry) => entry.teamId)),
        }
      : {}),
  });
  const claimed = new Map(
    job.kind === "list" ? job.entries.map((entry) => [entry.teamId, entry]) : []
  );
  // In the order asked, so a replay files the same answers the same way.
  const outcomes: GcImportOutcome[] = [];
  const rows: number[] = [];
  const unaged = new Map<string, number>();
  // Retain a bounded prefix so retry order stays identical to the original selection.
  const retained = new Map<string, GcTeamSchedule>();
  let retainedBytes = 0;
  let cacheFull = false;
  for await (const schedule of schedules()) {
    const teamId = schedule.profile.id;
    const outcome = importer.add(withListed(schedule, claimed.get(teamId), orgAges.get(teamId)));
    if (outcome.skip === "no-age") {
      unaged.set(teamId, outcomes.length);
      if (retryUnaged && !cacheFull) {
        const bytes = JSON.stringify(schedule).length * 2;
        if (retained.size < 2000 && retainedBytes + bytes <= 32 * 1024 * 1024) {
          retained.set(teamId, structuredClone(schedule));
          retainedBytes += bytes;
        } else cacheFull = true;
      }
    }
    outcomes.push(outcome);
    rows.push(schedule.rowIds?.length ?? schedule.games.length);
  }
  // Reconsider clubs skipped before their opponents arrived. The source stays on disk;
  // only these clubs are filed again, without refetching or running a tidy between them.
  for (let pass = 0; retryUnaged && unaged.size > 0 && pass < 3; pass++) {
    const before = unaged.size;
    const uncached = new Set([...unaged.keys()].filter((id) => !retained.has(id)));
    let processed = 0;
    await onAgeProgress?.(pass + 1, 0, before);
    const reconsider = (schedule: GcTeamSchedule) => {
      const at = unaged.get(schedule.profile.id);
      if (at === undefined) return;
      const outcome = importer.add(
        withListed(schedule, claimed.get(schedule.profile.id), orgAges.get(schedule.profile.id))
      );
      outcomes[at] = outcome;
      if (outcome.skip !== "no-age") {
        unaged.delete(schedule.profile.id);
        retained.delete(schedule.profile.id);
      }
      processed++;
    };
    for (const schedule of retained.values()) reconsider(schedule);
    if (uncached.size > 0) {
      await onAgeProgress?.(pass + 1, processed, before);
      for await (const schedule of schedules(uncached)) {
        if (uncached.has(schedule.profile.id)) reconsider(schedule);
      }
    }
    await onAgeProgress?.(pass + 1, processed, before);
    if (unaged.size === before) break;
  }
  await onTidy?.();
  const spared = sparedByTidy(importer.state, seasons);
  const tidy = tidyPool(importer.state, watchTidy, loadKeptApart(), refused, spared);
  saveTidyStamp(poolSignature(tidy.state));
  const filed = tidyChangedAnything(tidy) ? tidy.state : importer.state;
  const kept = persistPool(filed, undefined);
  if (!kept.saved) throw new Error("The pull's pool could not be written to the store in memory.");
  const lists = settleRunLists(outcomes, now.toISOString(), invalidIds);
  if (lists.invented.length > 0) saveDroppedClubs(forgetClubs(loadDroppedClubs(), lists.invented));
  // On the pool as tidied, so a club the tidy folded or settled is judged as it now stands.
  const deleted = sweeps(job) ? sweep(filed, now, sparedByTidy(filed, seasons)) : undefined;
  // Marked only when every team due was asked about: a run stopped half way has not refreshed them.
  if (mark && complete) saveRefreshLog(withRefreshed(loadRefreshLog(), mark, now));
  if (!(await flushPoolWrites())) throw new Error("The store in memory refused the pull's pool.");
  await onOutcomes?.(outcomes);
  return { outcomes, rows, ...(deleted ? { deleted } : {}) };
};

/**
 * A restartable source is streamed afresh only if a concurrent save requires a rebase. `expected`
 * is the copy, and the start of its Team Rankings, that the teams were chosen from
 * (`selectImportTeams`): an import that finds another, a copy made afresh or a Team Rankings
 * started again while it downloaded, files nothing.
 */
export const finishStagedImport = async (
  job: Extract<CloudPullJob, { kind: "list" }>,
  source: ImportScheduleSource,
  expected: CopyEpoch,
  counts: Pick<CloudPullResult, "asked" | "answered" | "failed">,
  deps: Omit<CloudPullDeps, "fetchTeams"> & {
    beforeTidy?: () => Promise<void>;
    watchTidy?: TidyWatcher;
    onOutcomes?: (outcomes: readonly GcImportOutcome[]) => Promise<void>;
    onAgeProgress?: (pass: number, done: number, total: number) => Promise<void>;
    /** Ids GameChanger said are not team ids, to remember for good (`rememberRefused`). */
    invalidIds?: readonly string[];
  }
): Promise<CloudPullResult> => {
  deps.onStage?.({ stage: "loading" });
  const copy = await loadPoolFrom(deps.store, deps.signal);
  const result: CloudPullResult = {
    ...counts,
    end: "finished",
    filed: 0,
    gamesAdded: 0,
    gamesUpdated: 0,
    changed: [],
    replays: 0,
  };
  if (!copy) return { ...result, end: "no-copy" };
  if (!sameEpoch(copy.manifest, expected)) return { ...result, end: "copy-replaced" };
  if (copyTooNew(copy.manifest)) return { ...result, end: "newer-copy" };
  return fileAndSave(result, copy, { ...deps, startedOn: expected }, (now, league) =>
    fileScheduleSource(
      job,
      source,
      null,
      true,
      now,
      league,
      deps.beforeTidy,
      deps.watchTidy,
      true,
      deps.onOutcomes,
      deps.onAgeProgress,
      deps.invalidIds
    )
  );
};

/** What the run wrote that the copy does not already say, as changes to it. */
const changesSince = async (
  copy: LoadedCopy,
  touched: ReadonlySet<string>,
  at: number
): Promise<Change[]> => {
  const changes: Change[] = [];
  for (const key of [...touched].sort()) {
    if (outOfReach(key)) throw new Error(`A pull wrote ${key}, which a pull never writes.`);
    const value = await readCloudPoolValue(key);
    const said = copy.said.get(key);
    if (value === null || value === undefined) {
      if (said !== undefined) changes.push({ key, value: null, at });
      continue;
    }
    if (said === (await contentHash(value))) continue;
    changes.push({ key, value, at });
  }
  return changes;
};

/**
 * Pulls `job`'s teams into the cloud copy. See the module's comment for the whole of it; the one
 * thing a caller must add is ending its process's store (`resetTeamRankingsStore`) afterwards.
 */
export const runCloudPull = async (
  job: CloudPullJob,
  deps: CloudPullDeps
): Promise<CloudPullResult> => {
  const result: CloudPullResult = {
    end: "finished",
    asked: 0,
    answered: 0,
    failed: 0,
    filed: 0,
    gamesAdded: 0,
    gamesUpdated: 0,
    changed: [],
    replays: 0,
  };
  deps.onStage?.({ stage: "loading" });
  const copy = await loadPoolFrom(deps.store, deps.signal);
  // Stopped before a team was asked about: nothing to file, so nothing to save.
  if (deps.signal?.aborted) return { ...result, end: "stopped" };
  if (!copy) return { ...result, end: "no-copy" };
  // A leg of a job whose first leg read another start of Team Rankings: its teams, worked out or
  // sent for the pool as it was, are not asked about for the pool as it is.
  if (deps.startedOn && !sameEpoch(copy.manifest, deps.startedOn)) {
    return { ...result, end: "copy-replaced" };
  }
  if (copyTooNew(copy.manifest)) return { ...result, end: "newer-copy" };

  // A walked refresh's teams were worked out at its start, and are not worked out again here.
  const walk = job.kind === "rota" ? job.walk : undefined;
  const due = job.kind === "rota" && !walk ? storedRota(deps.now(), job.force) : null;
  const mark: Marking | null = walk
    ? walk.markOn
      ? { ageLevels: walk.ageLevels, on: walk.markOn }
      : null
    : due
      ? { ageLevels: due.ageLevels, on: null }
      : null;
  const dropped = loadDroppedClubs();
  const pulledAt = walk ? lastPulled(loadScoutTeams()) : null;
  const since = walk ? walk.workedAt.getTime() : Infinity;
  /*
   * The teams waiting on an age that are due an ask go with the rota's on a catch-up day (every
   * day, on the daily cadence). The nightly left them out, so nothing but the Import tab's "Ask
   * again" ever asked about them again, and a rule moved for them (`withRulesMoved`) reached none
   * of them by itself.
   */
  const wanted = (
    walk
      ? [...walk.teamIds]
      : due
        ? [...due.teamIds, ...due.agelessIds]
        : job.kind === "list"
          ? listIds(job)
          : []
  )
    .filter((teamId, at, all) => all.indexOf(teamId) === at)
    .filter((teamId) => !isDeletedClub(dropped, teamId))
    .filter((teamId) => !((pulledAt?.get(teamId) ?? -Infinity) > since));
  const limit = job.kind === "rota" ? job.limit : undefined;
  const ids = limit === undefined ? wanted : wanted.slice(0, Math.max(0, limit));
  result.asked = ids.length;
  if (ids.length === 0) {
    // A list with nothing to pull, a paste or a catch-up, writes nothing, the sweep included.
    if (!sweeps(job)) return { ...result, end: "nothing-due", manifest: copy.manifest };
    /*
     * A refresh with nothing to pull still sweeps for clubs plainly made up, through the same tries
     * and commit as a pull's filing, so a club marked by nothing new is still marked, and a mark a
     * guard now lifts is lifted, on a night with nothing due. A walk's share is never empty as
     * worked out, so one with nothing left to ask was done already, by a try of this leg whose save
     * landed or by pulls since; it is finished, not a refresh that found nothing due.
     */
    return fileAndSave(
      { ...result, end: walk ? "finished" : "nothing-due" },
      copy,
      deps,
      sweepOnly
    );
  }

  let gaveUp = false;
  let failed = 0;
  deps.onStage?.({ stage: "fetching", done: 0, total: ids.length, failed: 0 });
  const answers = await deps.fetchTeams(ids, {
    concurrency: PULL_CONCURRENCY,
    maxConcurrency: PULL_MAX_CONCURRENCY,
    ...(deps.signal ? { signal: deps.signal } : {}),
    onRefused: () => {
      gaveUp = true;
    },
    onProgress: ({ done, total, result: answer }) => {
      if (!answer.ok) failed += 1;
      deps.onStage?.({ stage: "fetching", done, total, failed });
    },
  });
  result.answered = [...answers.values()].filter((answer) => answer.ok).length;
  result.failed = answers.size - result.answered;
  const stopped = deps.signal?.aborted === true;
  const complete =
    !gaveUp &&
    !stopped &&
    ids.length === wanted.length &&
    ids.every((teamId) => answers.has(teamId));
  result.end = gaveUp ? "gave-up" : stopped ? "stopped" : "finished";
  // Stopped with no answer to keep: the filing would tidy the whole pool for nothing, minutes of
  // it on the function, while the person who pressed Stop watches "stopping".
  if (stopped && result.answered === 0) {
    return { ...result, changed: [], version: copy.manifest.version, manifest: copy.manifest };
  }
  return fileAndSave(result, copy, deps, (now, league) =>
    fileAnswers(job, ids, answers, mark, complete, now, league)
  );
};

/**
 * Files what the run has (`file`) into the copy the store holds and commits the values it changed,
 * trying again on the copy as it then is where another device saved meanwhile.
 */
const fileAndSave = async (
  result: CloudPullResult,
  read: LoadedCopy,
  deps: Omit<CloudPullDeps, "fetchTeams">,
  file: (now: Date, league: LeagueRead) => Promise<Filed>
): Promise<CloudPullResult> => {
  let copy = read;
  /*
   * Which copy, and which start of its Team Rankings, the answers are for. A retry files them again
   * onto whatever the copy has become, which is right when another device saved to it and wrong
   * when it was deleted and started again, or its Team Rankings started again, brought back or
   * restored (`CloudManifest.epoch`): that is somebody's choice to begin afresh, and filing last
   * night's answers into it would undo the choice. The copy keeps its id through a start of Team
   * Rankings, so the id alone let a nightly that read the pool before the owner started again
   * fill the emptied copy with every team it had asked about.
   */
  const startedOn = deps.startedOn ?? epochOf(copy.manifest);
  for (let attempt = 0; attempt < MAX_TRIES; attempt += 1) {
    if (attempt > 0) {
      const again = await loadPoolFrom(deps.store);
      if (!again) return { ...result, end: "no-copy" };
      copy = again;
      if (!sameEpoch(copy.manifest, startedOn)) {
        return { ...result, end: "copy-replaced", changed: [] };
      }
      if (copyTooNew(copy.manifest)) return { ...result, end: "newer-copy" };
      result.replays = attempt;
    }
    deps.onStage?.({ stage: "filing" });
    // The pool as this try files onto it, by year: what a capped save is weighed against.
    const before = deps.cap
      ? poolYears({ ageGroups: loadAgeGroups(), teams: loadScoutTeams(), games: loadScoutGames() })
      : null;
    const touched = new Set<string>();
    onCloudPoolWrite((key) => touched.add(key));
    let filed: Filed;
    // League as the boards read it for the copy this try files onto, asked only by a filing.
    const onCopy = copy.manifest;
    const league: LeagueRead = () =>
      leagueSeasonsOf(deps.store, onCopy, deps.leagueDocs ?? NO_LEAGUE_DOCS);
    try {
      filed = await file(deps.now(), league);
    } finally {
      onCloudPoolWrite(null);
    }
    if (filed.deleted && filed.deleted.clubs.length > 0) {
      result.deleted = { clubs: filed.deleted.clubs.length, games: filed.deleted.games.length };
    }
    result.filed = filed.outcomes.filter((outcome) => !outcome.skip).length;
    result.gamesAdded = filed.outcomes.reduce((sum, outcome) => sum + outcome.gamesAdded, 0);
    result.gamesUpdated = filed.outcomes.reduce((sum, outcome) => sum + outcome.gamesUpdated, 0);
    const read = filed.outcomes.flatMap((outcome, at) =>
      outcome.skip ? [] : [{ outcome, rows: filed.rows?.[at] ?? 0 }]
    );
    result.ingest = ingestReading(
      read.map((one) => one.outcome),
      read.map((one) => one.rows)
    );

    const now = deps.now();
    const changes = await changesSince(copy, touched, now.getTime());
    if (changes.length === 0) {
      return { ...result, changed: [], version: copy.manifest.version, manifest: copy.manifest };
    }
    if (before) {
      const held = pastTheLine(
        blastRadius(
          before,
          {
            games: new Set(loadScoutGames().map((game) => game.id)),
            clubs: new Set(loadScoutTeams().map((team) => team.id)),
          },
          new Set(filed.deleted?.games)
        )
      );
      if (held.length > 0) return { ...result, end: "held", changed: [], held };
    }
    deps.onStage?.({ stage: "saving", attempt: attempt + 1 });
    const commit = await commitChanges({
      store: deps.store,
      base: copy.manifest,
      changes,
      ...(deps.keep ? { keepReplaced: changes.map((change) => change.key) } : {}),
      device: deps.device,
      now: now.toISOString(),
    });
    if (commit.ok) {
      return {
        ...result,
        changed: changes.map((change) => change.key),
        version: commit.manifest.version,
        manifest: commit.manifest,
      };
    }
  }
  return { ...result, end: "copy-kept-changing", changed: [] };
};
