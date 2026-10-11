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
  /**
   * Writes `patch` over a job only while it is still as `seen` was read, in the same status and
   * untouched since (its `updatedAt` the same): whether it did. False is a leg, or another ask,
   * that wrote to it first, whose write a start ending the job must not undo.
   */
  updateIfUnchanged: (jobId: string, seen: PullJob, patch: Partial<PullJob>) => Promise<boolean>;
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
  // Read with its update time, and written whole only at that time: a leg's write in between
  // makes the write refused rather than overwritten.
  updateIfUnchanged: async (jobId, seen, patch) => {
    const at = await docs.readAt(jobPath(jobId));
    const now = at ? coercePullJob(at.fields) : null;
    if (!at || !now || now.status !== seen.status || now.updatedAt !== seen.updatedAt) return false;
    return docs.replace(jobPath(jobId), { ...at.fields, ...patch }, at.token);
  },
});

/** What a task carries: the job, and the leg of it to run. */
export type LegTask = { jobId: string; leg: number };

export type LegDeps = {
  jobs: JobDocs;
  store: CloudStore;
  fetchTeams: CloudPullDeps["fetchTeams"];
  now: () => Date;
  /**
   * Queues a leg as a task named for its job and leg, so a leg queued twice is queued once: the
   * second answers "already", as one whose name a task had lately does (`enqueueLeg`).
   */
  enqueue: (task: LegTask) => Promise<void | "already">;
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
  chargeLegs?: (jobId: string, legs: number) => Promise<boolean>;
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

/** Why a refresh cannot run, where it differs from a list's: there is no list to send again. */
const REFRESH_NOT_RUNNABLE: Partial<Record<CloudPullResult["end"], string>> = {
  ...NOT_RUNNABLE,
  "copy-replaced":
    "The cloud copy was deleted and started again while this refresh ran, so nothing it fetched was filed into the new one. Press Refresh now again to refresh the new one.",
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
  // One moment for the day the teams are worked out on and the day the job keeps (`rota.at`),
  // which the last leg logs the levels under: read twice, a leg that loaded the copy across New
  // York's midnight logged Friday's levels as Saturday's, leaving Saturday's nightly none due.
  const workedAt = now();
  const worked = await workOutRefresh(deps.store, workedAt);
  if (!worked.ok) return { kind: "failed", error: NOT_RUNNABLE[worked.end] ?? worked.end };
  const entries: GcTeamListEntry[] = worked.teamIds.map((teamId) => ({ teamId }));
  const packed = await packJobList(entries);
  for (const [index, piece] of packed.pieces.entries()) await jobs.putPiece(jobId, index, piece);
  const legs = legsFor(entries.length, job.legTeams);
  if (legs > 1 && deps.chargeLegs && !(await deps.chargeLegs(jobId, legs - 1))) {
    return { kind: "failed", error: tooManyLegs(legs) };
  }
  const rota: PullJobRota = {
    at: workedAt.toISOString(),
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
    const running: Partial<PullJob> = {
      status: "running",
      stage: "loading",
      progress: { done: 0, total: share.length, failed: 0 },
      updatedAt: stamp(),
    };
    if (walking === job) {
      // Only while the job is still as this leg read it: a start that ended it meanwhile, stopped
      // or never started in the hour (`startPullJob`), is not undone by a leg that then runs on.
      if (!(await jobs.updateIfUnchanged(jobId, job, running))) return "over";
    } else {
      // Worked out just now, and written as running by this leg itself (`workOutRota`).
      await jobs.update(jobId, running);
    }

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
              workedAt: new Date(workedAt),
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
        // A refresh keeps what it replaces as an earlier version, as the nightly does, so Bring
        // back undoes a bad one; a pasted list's pull keeps nothing, as it never has.
        ...(pull.kind === "rota" ? { keep: true } : {}),
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

    const notRunnable = (pull.kind === "rota" ? REFRESH_NOT_RUNNABLE : NOT_RUNNABLE)[result.end];
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
  | "not-found"
  /** The job could not be read, or its first leg could not be queued: `message` says why. */
  | "unavailable";

/**
 * How long a list job may sit queued, its first leg's task already made and nothing having touched
 * the job, before a start ends it. Legs run one at a time, and a leg takes minutes (the nightly's
 * 69,733 teams took 308 s on 10 October 2026), so a job waiting its turn behind one or two others
 * has started long before an hour. One that has not was never reached: the queue is paused, say,
 * or Cloud Run refused every delivery, which leaves no trace a leg could write and a task name that
 * cannot be queued again. A job ended behind a leg failing its full three half-hour tries is the
 * cost, and is sent again.
 */
export const NEVER_STARTED_MS = 60 * 60 * 1000;

/** What a job never reached by a leg in `NEVER_STARTED_MS` ends with, for the person who sent it. */
export const NEVER_STARTED =
  'The cloud had this pull queued for an hour and never started it, so it was ended. Send it again; if it happens again, the cloud\'s pull account needs its one-time setup run again (README, "Pulls in the cloud: the one-time setup").';

/** The words a failed read or queueing is ended with: the cloud's own, cut to a line's length. */
const causeOf = (error: unknown): string => {
  const said = error instanceof Error ? error.message : String(error);
  return said.length > 400 ? `${said.slice(0, 400)}…` : said;
};

/**
 * Queues the first leg of the job `jobId` names, for `startPull`: the device has written the job
 * and its list and asks for it to run. A job already under way is left to run; asking twice is
 * asking once, since the first leg's task is named for the job (`enqueueLeg`). A job that calls
 * itself a refresh is not a device's to start: the rules let a member write any job, and one
 * dressed as "Refresh now" would otherwise run past the gate and the day's budget that only the
 * server's own start of one goes through (`startRefresh`).
 *
 * A start that cannot queue the leg ends the job with the cloud's own words for why and refuses,
 * `unavailable`, with them: before, it threw, the device took the answer for one that may have
 * started, and the job sat "waiting to start" with nothing left that would ever run or end it. The
 * device asks again for a job still queued and untouched (`dueForAsking`), so a job sent while
 * this was so is ended, or started, by the next ask. Two more ends come from asking again: a job
 * the person stopped before any leg ran is cancelled here, since only a running leg reads the stop;
 * and one whose task was already made but that no leg has touched in `NEVER_STARTED_MS` is ended
 * (`NEVER_STARTED`), since its task is gone or never delivered and its name cannot be queued again.
 * A job whose start never queued anything is queued afresh by the ask, and runs, or fails here with
 * the cloud's words.
 */
export const startPullJob = async (
  jobId: unknown,
  deps: Pick<LegDeps, "enqueue"> & {
    jobs: Pick<JobDocs, "read" | "updateIfUnchanged">;
    now: () => Date;
  },
  /**
   * How long the device that sent the job has waited for it, by its own clock from its own sending
   * (`SentPull.sentAt`), on an ask after the first. The device's clock and not this server's,
   * since the job's `createdAt` is the device's too: a phone some hours slow would otherwise have a
   * job it sent this minute ended as one that waited hours. Left out on the first ask, which ends
   * nothing.
   */
  waitedMs?: number
): Promise<
  { ok: true; status: PullJob["status"] } | { ok: false; refusal: StartRefusal; message?: string }
> => {
  if (typeof jobId !== "string" || !JOB_ID.test(jobId)) {
    return { ok: false, refusal: "invalid-argument" };
  }
  let job: PullJob | null;
  try {
    job = await deps.jobs.read(jobId);
  } catch (error) {
    return {
      ok: false,
      refusal: "unavailable",
      message: `The cloud could not read this pull: ${causeOf(error)}`,
    };
  }
  if (!job) return { ok: false, refusal: "not-found" };
  if (job.rota) return { ok: false, refusal: "invalid-argument" };
  if (job.status !== "queued") return { ok: true, status: job.status };
  const seen = job;
  /*
   * Only while the job is still as read: a leg its task started meanwhile has written to it, and a
   * start must not undo that and tell the person to send again a pull already under way. True when
   * it was ended, false when something got there first, null when the write itself failed, which
   * leaves the job to the next ask.
   */
  const end = (patch: Partial<PullJob>): Promise<boolean | null> =>
    deps.jobs
      .updateIfUnchanged(jobId, seen, {
        stage: "waiting",
        updatedAt: deps.now().toISOString(),
        ...patch,
      })
      .catch(() => null);
  if (job.stopAsked) {
    return (await end({ status: "cancelled" })) === true
      ? { ok: true, status: "cancelled" }
      : { ok: true, status: job.status };
  }
  let queued: void | "already";
  try {
    queued = await deps.enqueue({ jobId, leg: 0 });
  } catch (error) {
    const message = `The cloud could not queue this pull: ${causeOf(error)}`;
    // A leg of a task an earlier ask queued started it meanwhile: it runs, and nothing is refused.
    if ((await end({ status: "failed", error: message })) === false) {
      return { ok: true, status: job.status };
    }
    return { ok: false, refusal: "unavailable", message };
  }
  // Queued afresh, it runs now; only a task already made that no leg has touched in the hour ends.
  const untouched = job.updatedAt === job.createdAt;
  if (
    queued === "already" &&
    untouched &&
    waitedMs !== undefined &&
    waitedMs > NEVER_STARTED_MS &&
    (await end({ status: "failed", error: NEVER_STARTED })) === true
  ) {
    return { ok: true, status: "failed" };
  }
  return { ok: true, status: job.status };
};
