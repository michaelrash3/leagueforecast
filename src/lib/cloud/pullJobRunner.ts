import type { GcTeamListEntry } from "../gameChangerApi";
import type { CloudStore } from "./cloudEngine";
import type { FirestoreRestDocuments } from "./firestoreRest";
import {
  runCloudPull,
  workOutRefresh,
  type CloudPullDeps,
  type CloudPullJob,
  type CloudPullResult,
} from "./cloudRunner";
import {
  JOB_ID,
  coercePullJob,
  jobPath,
  jobPiecePath,
  legsFor,
  packJobList,
  unpackJobList,
  type PullJob,
  type PullJobRota,
  type PullJobTally,
} from "./pullJobs";

/**
 * The Firebase function's side of a pull a device left for the cloud (`pullJobs.ts`): one leg at a
 * time, each a Cloud Tasks task of its own (`runPull` in `functions/src/index.ts`), and the call
 * that queues the first (`startPull`).
 *
 * A leg reads the job, pulls its share of the list into the copy with the same runner as the
 * nightly refresh (`runCloudPull`), adds what it did to the job's tally, and queues the next leg.
 * Every step can be sent twice: a task is named for its job and leg, so queueing it again queues
 * nothing; a leg the job already counts as done does not run again; and a leg that did run but
 * whose reply was lost has its successor queued by whichever copy of it comes next.
 *
 * Nothing here reaches Google but through `jobs`, `store` and `enqueue`, so every rule is tried
 * against stand-ins (`pullJobRunner.test.ts`).
 */

/** A job's documents: the job itself, and its list's pieces. */
export type JobDocs = {
  read: (jobId: string) => Promise<PullJob | null>;
  update: (jobId: string, patch: Partial<PullJob>) => Promise<void>;
  piece: (jobId: string, index: number) => Promise<Uint8Array | null>;
  /** Makes a job the server starts itself ("Refresh now"), only where there is none: whether it did. */
  create: (jobId: string, job: PullJob) => Promise<boolean>;
  /** Writes a piece of a list the server worked out, over whatever a try before it left. */
  putPiece: (jobId: string, index: number, data: Uint8Array) => Promise<void>;
};

/** A job's documents through Firestore's REST API. */
export const restJobDocs = (docs: FirestoreRestDocuments): JobDocs => ({
  read: async (jobId) => coercePullJob(await docs.read(jobPath(jobId))),
  update: (jobId, patch) => docs.update(jobPath(jobId), patch),
  piece: async (jobId, index) => {
    const data = (await docs.read(jobPiecePath(jobId, index)))?.data;
    return data instanceof Uint8Array ? data : null;
  },
  create: (jobId, job) => docs.replace(jobPath(jobId), job, null),
  putPiece: (jobId, index, data) => docs.set(jobPiecePath(jobId, index), { data }),
});

/** What a task carries: the job, and the leg of it to run. */
export type LegTask = { jobId: string; leg: number };

export type LegDeps = {
  jobs: JobDocs;
  store: CloudStore;
  fetchTeams: CloudPullDeps["fetchTeams"];
  now: () => Date;
  /** Queues a leg as a task named for its job and leg, so a leg queued twice is queued once. */
  enqueue: (task: LegTask) => Promise<void>;
  /** Makes `timeZone` the process's, for the importer's "today" and the day log. */
  inTimeZone: (timeZone: string) => void;
  /** Whether this is the task's last try: a failure now is the job's, not a leg to try again. */
  lastTry: boolean;
  /**
   * Charges legs of a "Refresh now" job past its first to the day's budget (`chargeRefreshLegs`),
   * once its first leg has worked out how many its teams take; the first was charged when the job
   * was started. Whether the day had them left: a refresh it had not is not run. None for a list,
   * which the budget does not cover.
   */
  chargeLegs?: (legs: number) => Promise<boolean>;
  /** How often to look for the device asking to stop, and to say how far the leg has got. */
  lookEveryMs?: number;
};

export type LegOutcome =
  /** No such job: deleted, or never written. */
  | "gone"
  /** The job had already ended. */
  | "over"
  /** This leg had already run; its successor, if there is one, is queued. */
  | "already-ran"
  /** The job's next leg is another; this task is not its turn. */
  | "out-of-turn"
  /** Stopped at the device's asking. */
  | "cancelled"
  /** The leg ran and the next is queued. */
  | "next-queued"
  /** The last leg ran, or GameChanger stopped answering: the job is over. */
  | "done"
  /** The job cannot run, and is marked failed. */
  | "failed";

/** Thrown for a leg worth trying again: Cloud Tasks sends it again after a wait. */
export class TryLegAgain extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TryLegAgain";
  }
}

const LOOK_EVERY_MS = 10_000;

const added = (tally: PullJobTally, result: CloudPullResult): PullJobTally => ({
  asked: tally.asked + result.asked,
  answered: tally.answered + result.answered,
  failed: tally.failed + result.failed,
  filed: tally.filed + result.filed,
  gamesAdded: tally.gamesAdded + result.gamesAdded,
  gamesUpdated: tally.gamesUpdated + result.gamesUpdated,
});

/** Why a leg cannot run, in words for the device that sent the job. */
const NOT_RUNNABLE: Partial<Record<CloudPullResult["end"], string>> = {
  "no-copy": "There is no cloud copy to pull into.",
  "newer-copy":
    "The cloud copy was saved by a newer version of the app than the one the cloud runs; the pull runs once the cloud has been updated.",
  "copy-replaced":
    "The cloud copy was deleted and started again while this pull ran, so nothing it fetched was filed into the new one. Send the list again to pull it there.",
};

/** Why a refresh of `legs` legs was not run: the day had fewer left than it takes. */
export const tooManyLegs = (legs: number): string =>
  `This refresh takes ${legs.toLocaleString()} parts in the cloud, more than Refresh now has left today, so nothing was pulled. The nightly refreshes again tonight.`;

type WorkedOutRota =
  | { kind: "walk"; job: PullJob; entries: GcTeamListEntry[] }
  | { kind: "nothing" }
  | { kind: "failed"; error: string };

/**
 * A "Refresh now" job's teams, worked out by its first leg from the copy as the card that offered
 * it counted them (`workOutRefresh`), and kept as the job's list: its pieces first, then the job, so
 * a job never names a list it does not have. Every leg after this one, and this one tried again,
 * walks the list kept here and never works it out again. The legs past the first are charged to
 * the day's budget here, the first having been charged when the job was started, and a refresh the
 * day has too few legs left for fails before it asks GameChanger anything. With no team to pull, the
 * job is done at once, and no level is logged, as the nightly logs none when nothing is due.
 */
const workOutRota = async (jobId: string, job: PullJob, deps: LegDeps): Promise<WorkedOutRota> => {
  const { jobs, now } = deps;
  const stamp = () => now().toISOString();
  await jobs.update(jobId, { status: "running", stage: "loading", updatedAt: stamp() });
  const worked = await workOutRefresh(deps.store, now());
  if (!worked.ok) return { kind: "failed", error: NOT_RUNNABLE[worked.end] ?? worked.end };
  const entries: GcTeamListEntry[] = worked.teamIds.map((teamId) => ({ teamId }));
  const packed = await packJobList(entries);
  for (const [index, piece] of packed.pieces.entries()) await jobs.putPiece(jobId, index, piece);
  const legs = legsFor(entries.length, job.legTeams);
  if (legs > 1 && deps.chargeLegs && !(await deps.chargeLegs(legs - 1))) {
    return { kind: "failed", error: tooManyLegs(legs) };
  }
  const rota: PullJobRota = {
    at: stamp(),
    ageLevels: worked.ageLevels,
    again: worked.again,
    heldBack: worked.heldBack,
  };
  if (entries.length === 0) {
    await jobs.update(jobId, {
      status: "done",
      stage: "waiting",
      list: packed.list,
      legs,
      legsDone: legs,
      rota,
      end: "nothing-due",
      error: null,
      updatedAt: stamp(),
    });
    return { kind: "nothing" };
  }
  await jobs.update(jobId, { list: packed.list, legs, rota, updatedAt: stamp() });
  return { kind: "walk", job: { ...job, list: packed.list, legs, rota }, entries };
};

/** Runs `task`'s leg of its job. Throws `TryLegAgain`, or anything else, for a leg to try again. */
export const runPullLeg = async (task: LegTask, deps: LegDeps): Promise<LegOutcome> => {
  const { jobs, now } = deps;
  const { jobId, leg } = task;
  if (!JOB_ID.test(jobId) || !Number.isSafeInteger(leg) || leg < 0) return "gone";
  const job = await jobs.read(jobId);
  if (!job) return "gone";
  if (job.status === "done" || job.status === "failed" || job.status === "cancelled") {
    return "over";
  }
  if (job.legsDone > leg) {
    // This leg ran, and its reply may have been lost before the next was queued.
    if (job.legsDone < job.legs) await deps.enqueue({ jobId, leg: job.legsDone });
    return "already-ran";
  }
  if (job.legsDone < leg || leg >= job.legs) return "out-of-turn";

  const stamp = () => now().toISOString();
  const fail = async (error: string): Promise<LegOutcome> => {
    await jobs.update(jobId, { status: "failed", stage: "waiting", error, updatedAt: stamp() });
    return "failed";
  };
  if (job.stopAsked) {
    await jobs.update(jobId, { status: "cancelled", stage: "waiting", updatedAt: stamp() });
    return "cancelled";
  }

  try {
    // Before a refresh's teams are worked out, too: its rota reads the day in the job's zone.
    deps.inTimeZone(job.timeZone);
    let walking = job;
    let entries: GcTeamListEntry[];
    if (job.rota && job.rota.at === null) {
      const worked = await workOutRota(jobId, job, deps);
      if (worked.kind === "failed") return await fail(worked.error);
      if (worked.kind === "nothing") return "done";
      walking = worked.job;
      entries = worked.entries;
    } else {
      try {
        entries = await unpackJobList(job.list, (index) => jobs.piece(jobId, index));
      } catch (error) {
        // A list that does not unpack now never will.
        return await fail(error instanceof Error ? error.message : String(error));
      }
    }
    const share = entries.slice(leg * job.legTeams, (leg + 1) * job.legTeams);
    await jobs.update(jobId, {
      status: "running",
      stage: "loading",
      progress: { done: 0, total: share.length, failed: 0 },
      updatedAt: stamp(),
    });

    // Every so often: has the device asked to stop, and how far has the leg got?
    const stop = new AbortController();
    let latest: Partial<PullJob> | null = null;
    let told: Promise<void> = Promise.resolve();
    const look = setInterval(() => {
      const say = latest;
      latest = null;
      told = told
        .then(async () => {
          if (say) await jobs.update(jobId, { ...say, updatedAt: stamp() });
          if ((await jobs.read(jobId))?.stopAsked) stop.abort();
        })
        // A look that fails is only a look: the leg goes on, and the next look tries again.
        .catch(() => undefined);
    }, deps.lookEveryMs ?? LOOK_EVERY_MS);

    // A refresh walks its share of the teams worked out at its start, and its last leg logs the
    // levels refreshed on the day they were worked out for; a list is pulled as the device sent it.
    const rota = walking.rota;
    const workedAt = rota?.at ?? null;
    const pull: CloudPullJob =
      rota && workedAt !== null
        ? {
            kind: "rota",
            walk: {
              teamIds: share.map((entry) => entry.teamId),
              ageLevels: rota.ageLevels,
              markOn: leg + 1 >= walking.legs ? new Date(workedAt) : null,
            },
          }
        : {
            kind: "list",
            entries: share,
            seasonYears: job.seasonYears,
            ...(job.refresh === true ? { refresh: true } : {}),
          };
    let result: CloudPullResult;
    try {
      result = await runCloudPull(pull, {
        store: deps.store,
        fetchTeams: deps.fetchTeams,
        now,
        device: "cloud-pull",
        signal: stop.signal,
        onStage: (stage) => {
          latest =
            stage.stage === "fetching"
              ? {
                  stage: "fetching",
                  progress: { done: stage.done, total: stage.total, failed: stage.failed },
                }
              : { stage: stage.stage };
        },
      });
    } finally {
      clearInterval(look);
      await told;
    }

    const notRunnable = NOT_RUNNABLE[result.end];
    if (notRunnable) return await fail(notRunnable);
    if (result.end === "copy-kept-changing") {
      throw new TryLegAgain(
        "Other devices kept saving to the cloud copy while this pull tried to."
      );
    }
    const tally = added(job.tally, result);
    const version = result.version ?? job.version;
    const legsDone = leg + 1;
    if (result.end === "stopped") {
      await jobs.update(jobId, {
        status: "cancelled",
        stage: "waiting",
        legsDone,
        tally,
        end: result.end,
        version,
        error: null,
        updatedAt: stamp(),
      });
      return "cancelled";
    }
    // GameChanger stopped answering: asking for the next leg's teams now would only fail more.
    const over = result.end === "gave-up" || legsDone >= walking.legs;
    await jobs.update(jobId, {
      status: over ? "done" : "running",
      stage: "waiting",
      legsDone,
      progress: { done: 0, total: 0, failed: 0 },
      tally,
      end: result.end,
      version,
      error: null,
      updatedAt: stamp(),
    });
    if (over) return "done";
    await deps.enqueue({ jobId, leg: legsDone });
    return "next-queued";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (deps.lastTry) return await fail(message);
    await jobs.update(jobId, { error: message, updatedAt: stamp() }).catch(() => undefined);
    throw error;
  }
};

export type StartRefusal =
  /** Not a job's id. */
  | "invalid-argument"
  /** No such job. */
  | "not-found";

/**
 * Queues the first leg of the job `jobId` names, for `startPull`: the device has written the job
 * and its list and asks for it to run. A job already under way is left to run; asking twice is
 * asking once. A job that calls itself a refresh is not a device's to start: the rules let a member
 * write any job, and one dressed as "Refresh now" would otherwise run past the gate and the day's
 * budget that only the server's own start of one goes through (`startRefresh`).
 */
export const startPullJob = async (
  jobId: unknown,
  deps: Pick<LegDeps, "enqueue"> & { jobs: Pick<JobDocs, "read"> }
): Promise<{ ok: true; status: PullJob["status"] } | { ok: false; refusal: StartRefusal }> => {
  if (typeof jobId !== "string" || !JOB_ID.test(jobId)) {
    return { ok: false, refusal: "invalid-argument" };
  }
  const job = await deps.jobs.read(jobId);
  if (!job) return { ok: false, refusal: "not-found" };
  if (job.rota) return { ok: false, refusal: "invalid-argument" };
  if (job.status === "queued") await deps.enqueue({ jobId, leg: 0 });
  return { ok: true, status: job.status };
};
