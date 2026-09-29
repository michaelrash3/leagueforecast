import { withRulesMoved } from "../ageUnknown";
import { todayIsoDay } from "../date";
import { forgetClubs, isDeletedClub } from "../deletedGames";
import { withListed, type GcTeamListEntry, type GcTeamResponse } from "../gameChangerApi";
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
  type GcImportOutcome,
} from "../gameChangerImport";
import {
  dueRefresh,
  idsPlayingAround,
  markRefreshed,
  type DueRefresh,
} from "../gameChangerSchedule";
import { orgAgesByTeam, withOrgAges } from "../orgMembership";
import { persistPool } from "../poolPersist";
import { settleRunLists } from "../pullLists";
import { segmentOn } from "../teamRankings/seasons";
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
  loadOrgMembership,
  loadRefreshCadence,
  loadRefreshLog,
  loadScoutGames,
  loadScoutTeams,
  loadTidyStamp,
  loadTooYoungClubs,
  onCloudPoolWrite,
  readCloudPoolValue,
  resetTeamRankingsStore,
  saveDroppedClubs,
  saveRefreshLog,
  saveTidyStamp,
  type PoolStoreIo,
} from "../teamRankingsStorage";
import { commitChanges, fetchValues, type Change, type CloudStore } from "./cloudEngine";
import { DATA_SCHEMA, type CloudManifest } from "./cloudManifest";
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
 * League Standings and archived seasons are neither read nor written: a pull touches neither.
 *
 * Nothing here reaches the network except through `store` and `fetchTeams`, so every rule is tried
 * against stand-ins (`cloudRunner.test.ts`). A Node process that runs it ends it with
 * `resetTeamRankingsStore`, which closes the channel the store opens to other tabs.
 */

/** What to pull. */
export type CloudPullJob =
  /**
   * The teams the Refresh button would pull today, worked out from the copy's own settings. With a
   * `limit`, only the first that many, for a trial run; the day is then not logged as refreshed.
   */
  | { kind: "rota"; force?: boolean; limit?: number }
  /** A pasted list, as the device that sent it filtered it, filed in these squad years only. */
  | { kind: "list"; entries: readonly GcTeamListEntry[]; seasonYears: readonly number[] };

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
};

export type CloudPullStage =
  | { stage: "loading" }
  | { stage: "fetching"; done: number; total: number; failed: number }
  | { stage: "filing" }
  | { stage: "saving"; attempt: number };

export type CloudPullEnd =
  /** Every team asked about was answered, one way or another, and the copy saved. */
  | "finished"
  /** Stopped before every team was asked about; what was fetched is saved. */
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
  | "copy-kept-changing";

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
};

/** Tries at saving onto a copy that keeps moving before giving up on it. */
const MAX_TRIES = 3;

/** The store in memory, empty until the cloud's values are laid in. */
export const memoryIo = (): PoolStoreIo => {
  const values = new Map<string, unknown>();
  return {
    keys: async () => [...values.keys()],
    get: async (key) => values.get(key),
    set: async (key, value) => {
      values.set(key, value);
      return true;
    },
    remove: async (key) => {
      values.delete(key);
    },
    readLocal: () => null,
    clearLocal: () => undefined,
  };
};

/** A key a pull never reads from the copy, never writes, and must never send. */
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
 * app's loaders (`loadScoutTeams`, `loadRefreshLog`, …) read the copy. Null when there is no copy.
 * Throws on a piece missing or damaged, and on a pool key this build does not keep.
 */
export const loadPoolFrom = async (store: CloudStore): Promise<LoadedCopy | null> => {
  const manifest = await store.readManifest();
  if (!manifest) return null;
  const parts = manifest.parts.filter((part) => !outOfReach(part.key));
  const fetched = await fetchValues({ store, parts });
  if (!fetched.ok) throw new Error("A piece of the cloud copy's pool is missing or damaged.");
  resetTeamRankingsStore();
  await initTeamRankingsStore(memoryIo());
  if (!(await applyCloudPoolValues(fetched.values))) {
    throw new Error("The cloud copy holds a pool key this build does not keep.");
  }
  const said = new Map<string, string>();
  for (const [key, value] of fetched.values) said.set(key, await contentHash(value));
  return {
    manifest,
    keys: parts.length,
    bytes: parts.reduce((sum, part) => sum + part.bytes, 0),
    said,
  };
};

/**
 * The teams the Refresh button would pull at `now`, from the settings the pool store holds: the
 * season being played, the cadence, the day log, the waiting list and the ages named for it, the
 * thrown-out clubs, and the teams with a game today, which are never held back.
 */
export const storedRota = (now: Date, force = false): DueRefresh => {
  const today = todayIsoDay(now);
  const ageless = loadAgeUnknown();
  const membership = loadOrgMembership();
  return dueRefresh(now, loadRefreshLog(), loadAgeGroups(), loadScoutTeams(), {
    seasonYear: segmentOn(today).year,
    ageless,
    cadence: loadRefreshCadence(),
    namedAges: withRulesMoved(
      withOrgAges(loadNamedAges(), orgAgesByTeam(membership), membership.savedAt),
      ageless
    ),
    refused: loadDroppedClubs(),
    force,
    playing: idsPlayingAround(loadScoutGames(), today),
  });
};

/** Whether a copy is not this build's to change: saved by a newer build, or tidied by newer rules. */
const tooNew = (manifest: CloudManifest): boolean =>
  manifest.schema > DATA_SCHEMA || stampFromNewerRules(loadTidyStamp());

type Filed = { outcomes: GcImportOutcome[] };

/**
 * Files `answers` into the pool the store holds, tidies it, and writes it back with what the run
 * learned, as a pull in the browser ends: the tidy stamped so no device tidies it again, the
 * lists, the invented clubs thrown out, and the day logged where a rota finished.
 */
const fileAnswers = async (
  job: CloudPullJob,
  ids: readonly string[],
  answers: ReadonlyMap<string, GcTeamResponse>,
  due: DueRefresh | null,
  complete: boolean,
  now: Date
): Promise<Filed> => {
  const pool = { ageGroups: loadAgeGroups(), teams: loadScoutTeams(), games: loadScoutGames() };
  const orgAges = orgAgesByTeam(loadOrgMembership());
  const importer = createGcImporter(pool, {
    deleted: loadDeletedGames(),
    droppedClubs: loadDroppedClubs(),
    tooYoung: loadTooYoungClubs(),
    namedAges: loadNamedAges(),
    // The run's own day, which is the user's where the process runs in their time zone.
    today: todayIsoDay(now),
    ...(job.kind === "list" && job.seasonYears.length > 0
      ? { seasonYears: new Set(job.seasonYears) }
      : {}),
  });
  const claimed = new Map(
    job.kind === "list" ? job.entries.map((entry) => [entry.teamId, entry]) : []
  );
  // In the order asked, so a replay files the same answers the same way.
  const outcomes: GcImportOutcome[] = [];
  ids.forEach((teamId) => {
    const answer = answers.get(teamId);
    if (!answer?.ok) return;
    outcomes.push(
      importer.add(withListed(answer.schedule, claimed.get(teamId), orgAges.get(teamId)))
    );
  });
  const tidy = tidyPool(importer.state, undefined, loadKeptApart());
  saveTidyStamp(poolSignature(tidy.state));
  const kept = persistPool(tidyChangedAnything(tidy) ? tidy.state : importer.state, undefined);
  if (!kept.saved) throw new Error("The pull's pool could not be written to the store in memory.");
  const lists = settleRunLists(outcomes, now.toISOString());
  if (lists.invented.length > 0) saveDroppedClubs(forgetClubs(loadDroppedClubs(), lists.invented));
  // Marked only when every team due was asked about: a run stopped half way has not refreshed them.
  if (due && complete) saveRefreshLog(markRefreshed(loadRefreshLog(), due.ageLevels, now));
  if (!(await flushPoolWrites())) throw new Error("The store in memory refused the pull's pool.");
  return { outcomes };
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
  let copy = await loadPoolFrom(deps.store);
  if (!copy) return { ...result, end: "no-copy" };
  if (tooNew(copy.manifest)) return { ...result, end: "newer-copy" };

  const due = job.kind === "rota" ? storedRota(deps.now(), job.force) : null;
  const dropped = loadDroppedClubs();
  const wanted = (due ? due.teamIds : job.kind === "list" ? job.entries.map((e) => e.teamId) : [])
    .filter((teamId, at, all) => all.indexOf(teamId) === at)
    .filter((teamId) => !isDeletedClub(dropped, teamId));
  const limit = job.kind === "rota" ? job.limit : undefined;
  const ids = limit === undefined ? wanted : wanted.slice(0, Math.max(0, limit));
  result.asked = ids.length;
  if (ids.length === 0) return { ...result, end: "nothing-due" };

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

  for (let attempt = 0; attempt < MAX_TRIES; attempt += 1) {
    if (attempt > 0) {
      copy = await loadPoolFrom(deps.store);
      if (!copy) return { ...result, end: "no-copy" };
      if (tooNew(copy.manifest)) return { ...result, end: "newer-copy" };
      result.replays = attempt;
    }
    deps.onStage?.({ stage: "filing" });
    const touched = new Set<string>();
    onCloudPoolWrite((key) => touched.add(key));
    let filed: Filed;
    try {
      filed = await fileAnswers(job, ids, answers, due, complete, deps.now());
    } finally {
      onCloudPoolWrite(null);
    }
    result.filed = filed.outcomes.filter((outcome) => !outcome.skip).length;
    result.gamesAdded = filed.outcomes.reduce((sum, outcome) => sum + outcome.gamesAdded, 0);
    result.gamesUpdated = filed.outcomes.reduce((sum, outcome) => sum + outcome.gamesUpdated, 0);

    const now = deps.now();
    const changes = await changesSince(copy, touched, now.getTime());
    if (changes.length === 0) return { ...result, changed: [], version: copy.manifest.version };
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
      };
    }
  }
  return { ...result, end: "copy-kept-changing", changed: [] };
};
