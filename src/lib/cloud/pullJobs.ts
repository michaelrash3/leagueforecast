import type { GcTeamListEntry } from "../gameChangerApi";
import { hashJson, packHashed, unpackChunks } from "./cloudPack";
import type { CloudPullEnd } from "./cloudRunner";

/**
 * A pull a device leaves for the cloud to run (README, "Pulls in the cloud"): a pasted list of
 * GameChanger teams, filed into the cloud copy by a Firebase function while the device that sent
 * it does whatever else it likes, or nothing at all.
 *
 * It lives in a collection of its own, outside the copy, which only servers write (1.6f): the rules
 * let a member make a job and its pieces, read them, and ask a job to stop, and nothing else.
 * - `pullJobs/{jobId}`: the job, a `PullJob`, which the device writes last and the function keeps
 *   up to date as it works, so the device reads how far it has got from the one document;
 * - `pullJobs/{jobId}/pieces/{n}`: the list, gzipped JSON in pieces, `{ data: Bytes }`,
 *   packed as the copy packs a value (`cloudPack.ts`) and checked against its fingerprint on the
 *   way back, so a list is never pulled half from one upload and half from another.
 *
 * A long list is pulled in legs of `LEG_TEAMS` teams, each a task of its own that loads the copy,
 * pulls its teams and saves, and queues the next: a task has at most half an hour, and the answers
 * for every team of a nationwide list at once would not fit the function's memory beside the pool.
 */

export const JOB_FORMAT = 1;

/**
 * Teams in one leg. A leg of the nightly refresh's size, 15,793 teams on 29 September 2026, took
 * 101 s on one of GitHub's servers from loading the copy to saving it, and held 3.5 GB at its end;
 * 25,000 keeps a leg within minutes and the function's memory with room to spare.
 */
export const LEG_TEAMS = 25_000;

export const jobPath = (jobId: string): string => `pullJobs/${jobId}`;
export const jobPiecePath = (jobId: string, index: number): string =>
  `${jobPath(jobId)}/pieces/${index}`;

/** A job's id: `randomId`'s 128 bits, which is also what keeps a task's name from being guessed. */
export const JOB_ID = /^[0-9a-f]{32}$/;

export type PullJobStatus =
  /** Written, and waiting for its first leg to start. */
  | "queued"
  /** A leg is running, or the next is queued. */
  | "running"
  /** Every leg ran; or GameChanger stopped answering, and what came is saved (`end`). */
  | "done"
  /** A leg could not run, and nothing will try it again (`error`). */
  | "failed"
  /** Stopped at the device's asking; what was fetched before it stopped is saved. */
  | "cancelled";

export type PullJobStage = "waiting" | "loading" | "fetching" | "filing" | "saving";

/** What every leg so far did, added up. */
export type PullJobTally = {
  asked: number;
  answered: number;
  failed: number;
  filed: number;
  gamesAdded: number;
  gamesUpdated: number;
};

/**
 * What a "Refresh now" job knows of its refresh. Its teams are worked out once, by its first leg,
 * and kept as the job's list, so every leg after walks the list worked out at the start: worked out
 * again leg by leg, a refresh of today's levels run again would find the teams the legs before it
 * had just pulled held back, and those playing today due again, leg after leg.
 */
export type PullJobRota = {
  /** When the first leg worked the teams out, or null until it has: the list is empty till then. */
  at: string | null;
  /** The levels the teams are for, which the last leg marks refreshed on the day of `at`. */
  ageLevels: number[];
  /** Whether today's levels had been refreshed already, so this is them again. */
  again: boolean;
  /** Teams of those levels held back for having been pulled lately with no game near today. */
  heldBack: number;
};

export type PullJob = {
  format: number;
  /** The list, as its pieces make it: the SHA-256 of its JSON, its teams, and its pieces. */
  list: { hash: string; teams: number; pieces: number };
  /** The squad years the device's pull files into (`GcImportOptions.seasonYears`); empty for any. */
  seasonYears: number[];
  /**
   * Every team on the list pulled again, already in the pool or not: a catch-up the page asks for
   * (the teams nobody could age, the rosters to check). Without it a list is a paste, and only its
   * teams the pool lacks are pulled (`cloudRunner.ts`, `listIds`).
   */
  refresh?: true;
  /**
   * "Refresh now" (README, "Refresh now in the cloud"): the day's refresh, made by the server
   * (`refreshGate.ts`) rather than written by a device, whose teams its first leg works out from
   * the copy (`refreshNow`) and the legs then walk. Absent from a list.
   */
  rota?: PullJobRota;
  /**
   * The zone "today" is in for the importer and the day log, since the function runs in Google's,
   * which is not the user's: a list's is the device's that sent it, and "Refresh now"'s is always
   * New York's (`REFRESH_ZONE`), the zone its card's count and the nightly keep.
   */
  timeZone: string;
  /** The device that sent it (`ManifestPart.by`'s kind of name). */
  device: string;
  createdAt: string;
  status: PullJobStatus;
  /**
   * Teams in each leg, and legs. Set when the job is made and kept with it, so a job's legs are the
   * same legs whichever build of the function runs each one.
   */
  legTeams: number;
  legs: number;
  /** Legs finished: the next to run is this one. */
  legsDone: number;
  /** Set by the device to stop the pull; the leg running files what it has fetched and saves it. */
  stopAsked: boolean;
  stage: PullJobStage;
  /** The leg running: teams asked so far, of how many, and how many went unanswered. */
  progress: { done: number; total: number; failed: number };
  tally: PullJobTally;
  /** How the last leg ended. */
  end: CloudPullEnd | null;
  /** Why the job failed, or why a leg is being tried again. */
  error: string | null;
  /** The copy's version after the last leg's save. */
  version: number | null;
  updatedAt: string;
};

export const NO_TALLY: PullJobTally = {
  asked: 0,
  answered: 0,
  failed: 0,
  filed: 0,
  gamesAdded: 0,
  gamesUpdated: 0,
};

export const legsFor = (teams: number, legTeams: number = LEG_TEAMS): number =>
  Math.max(1, Math.ceil(teams / legTeams));

/** A list packed for its pieces, and what the job says of it. */
export type PackedList = { list: PullJob["list"]; pieces: Uint8Array<ArrayBuffer>[] };

export const packJobList = async (entries: readonly GcTeamListEntry[]): Promise<PackedList> => {
  const hashed = await hashJson(entries);
  const pieces = await packHashed(hashed);
  return { list: { hash: hashed.hash, teams: entries.length, pieces: pieces.length }, pieces };
};

/**
 * The list back from its pieces, as `packJobList` packed it. Throws on a piece missing, on pieces
 * that do not make the list the job names, and on a list that is not a list of teams.
 */
export const unpackJobList = async (
  list: PullJob["list"],
  piece: (index: number) => Promise<Uint8Array | null>
): Promise<GcTeamListEntry[]> => {
  const pieces: Uint8Array[] = [];
  for (let index = 0; index < list.pieces; index += 1) {
    const found = await piece(index);
    if (!found) throw new Error(`Piece ${index + 1} of the pull's list is missing.`);
    pieces.push(found);
  }
  const entries = await unpackChunks(pieces, list.hash);
  if (
    !Array.isArray(entries) ||
    entries.length !== list.teams ||
    !entries.every(
      (entry: unknown) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as { teamId?: unknown }).teamId === "string"
    )
  ) {
    throw new Error("The pull's list is not a list of teams.");
  }
  return entries as GcTeamListEntry[];
};

/** A new job for `list`, as the device writes it once the list's pieces are up. */
export const newPullJob = ({
  list,
  seasonYears,
  timeZone,
  device,
  now,
  legTeams = LEG_TEAMS,
  refresh = false,
}: {
  list: PullJob["list"];
  seasonYears: readonly number[];
  timeZone: string;
  device: string;
  now: string;
  legTeams?: number;
  refresh?: boolean;
}): PullJob => ({
  format: JOB_FORMAT,
  list,
  seasonYears: [...seasonYears],
  ...(refresh ? { refresh: true as const } : {}),
  timeZone,
  device,
  createdAt: now,
  status: "queued",
  legTeams,
  legs: legsFor(list.teams, legTeams),
  legsDone: 0,
  stopAsked: false,
  stage: "waiting",
  progress: { done: 0, total: 0, failed: 0 },
  tally: { ...NO_TALLY },
  end: null,
  error: null,
  version: null,
  updatedAt: now,
});

/**
 * A new "Refresh now" job, as the server makes it on a member's asking (`startRefresh`): no list
 * yet, and one leg until the first works out how many the teams take.
 */
export const newRefreshJob = ({
  timeZone,
  device,
  now,
}: {
  timeZone: string;
  device: string;
  now: string;
}): PullJob => ({
  ...newPullJob({
    list: { hash: "", teams: 0, pieces: 0 },
    seasonYears: [],
    timeZone,
    device,
    now,
  }),
  rota: { at: null, ageLevels: [], again: false, heldBack: 0 },
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const whole = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const text = (value: unknown): value is string => typeof value === "string";

/** A job's refresh as read, or null for one that is not one; undefined where there is none. */
const rotaOf = (raw: unknown): PullJobRota | null | undefined => {
  if (raw === undefined) return undefined;
  if (
    !isRecord(raw) ||
    !(raw.at === null || text(raw.at)) ||
    !Array.isArray(raw.ageLevels) ||
    !raw.ageLevels.every(whole) ||
    typeof raw.again !== "boolean" ||
    !whole(raw.heldBack)
  ) {
    return null;
  }
  return { at: raw.at, ageLevels: raw.ageLevels, again: raw.again, heldBack: raw.heldBack };
};

const STATUSES = new Set<string>(["queued", "running", "done", "failed", "cancelled"]);
const STAGES = new Set<string>(["waiting", "loading", "fetching", "filing", "saving"]);

const tallyOf = (raw: unknown): PullJobTally | null => {
  if (!isRecord(raw)) return null;
  const tally = { ...NO_TALLY };
  for (const key of Object.keys(NO_TALLY) as (keyof PullJobTally)[]) {
    const count = raw[key];
    if (!whole(count)) return null;
    tally[key] = count;
  }
  return tally;
};

/**
 * A job as read from Firestore, or null for a document that is not one this build can run: a
 * newer format, or anything missing or of the wrong kind. Nothing half-read is ever pulled.
 */
export const coercePullJob = (raw: unknown): PullJob | null => {
  if (!isRecord(raw) || raw.format !== JOB_FORMAT) return null;
  const { list, progress } = raw;
  const tally = tallyOf(raw.tally);
  const rota = rotaOf(raw.rota);
  if (
    rota === null ||
    !isRecord(list) ||
    !text(list.hash) ||
    !whole(list.teams) ||
    !whole(list.pieces) ||
    !Array.isArray(raw.seasonYears) ||
    !raw.seasonYears.every(whole) ||
    !(raw.refresh === undefined || raw.refresh === true) ||
    !text(raw.timeZone) ||
    !text(raw.device) ||
    !text(raw.createdAt) ||
    !text(raw.status) ||
    !STATUSES.has(raw.status) ||
    !whole(raw.legTeams) ||
    raw.legTeams === 0 ||
    !whole(raw.legs) ||
    !whole(raw.legsDone) ||
    typeof raw.stopAsked !== "boolean" ||
    !text(raw.stage) ||
    !STAGES.has(raw.stage) ||
    !isRecord(progress) ||
    !whole(progress.done) ||
    !whole(progress.total) ||
    !whole(progress.failed) ||
    !tally ||
    !(raw.end === null || text(raw.end)) ||
    !(raw.error === null || text(raw.error)) ||
    !(raw.version === null || whole(raw.version)) ||
    !text(raw.updatedAt)
  ) {
    return null;
  }
  return {
    format: JOB_FORMAT,
    list: { hash: list.hash, teams: list.teams, pieces: list.pieces },
    seasonYears: raw.seasonYears,
    ...(raw.refresh === true ? { refresh: true as const } : {}),
    ...(rota ? { rota } : {}),
    timeZone: raw.timeZone,
    device: raw.device,
    createdAt: raw.createdAt,
    status: raw.status as PullJobStatus,
    legTeams: raw.legTeams,
    legs: raw.legs,
    legsDone: raw.legsDone,
    stopAsked: raw.stopAsked,
    stage: raw.stage as PullJobStage,
    progress: { done: progress.done, total: progress.total, failed: progress.failed },
    tally,
    end: raw.end as CloudPullEnd | null,
    error: raw.error,
    version: raw.version,
    updatedAt: raw.updatedAt,
  };
};
