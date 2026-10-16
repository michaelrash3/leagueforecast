import type { GcTeamListEntry } from "../gameChangerApi";
import type { CloudStore } from "./cloudEngine";
import { epochOf } from "./cloudManifest";
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
  MAX_LIST_TEAMS,
  coercePullJob,
  jobPath,
  jobPiecePath,
  lastHeardFrom,
  legsFor,
  packJobList,
  tooManyTeams,
  unpackJobList,
  type PullJob,
  type PullJobRota,
  type PullJobStatus,
  type PullJobTally,
} from "./pullJobs";
import { nightlyPulling, REFRESH_QUIET_MS, type GateDocs } from "./refreshGate";

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
   * Writes `patch` over a job only while it is still as `seen` was read: in the same status,
   * untouched since (its `updatedAt` the same), and not asked to stop since. Whether it did; false
   * is a leg, another ask, or the person's Stop that got there first, which a start ending the job
   * must not undo. Stop is read on its own because a device's Stop writes `stopAsked` alone, as the
   * rules let it (`firestore.rules`), and leaves the stamp as it was.
   */
  updateIfUnchanged: (jobId: string, seen: PullJob, patch: Partial<PullJob>) => Promise<boolean>;
};

/** Whether a job read again is as `seen` was: same status, same stamp, and no stop asked since. */
export const unchangedSince = (seen: PullJob, now: PullJob): boolean =>
  now.status === seen.status &&
  now.updatedAt === seen.updatedAt &&
  now.stopAsked === seen.stopAsked;

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
    if (!at || !now || !unchangedSince(seen, now)) return false;
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
    "The cloud's Team Rankings was started again, restored or brought back to an earlier version while this pull ran, so nothing more it fetched was filed. Send the list again to pull it into Team Rankings as it is now.",
};

/** Why a refresh cannot run, where it differs from a list's: there is no list to send again. */
const REFRESH_NOT_RUNNABLE: Partial<Record<CloudPullResult["end"], string>> = {
  ...NOT_RUNNABLE,
  "copy-replaced":
    "The cloud's Team Rankings was started again, restored or brought back to an earlier version while this refresh ran, so nothing more it fetched was filed. Press Refresh now again to refresh Team Rankings as it is now.",
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
      on: worked.on,
      end: "nothing-due",
      error: null,
      updatedAt: stamp(),
    });
    return { kind: "nothing" };
  }
  // The copy the teams were worked out from, which every leg's pull is held to, this one's too.
  await jobs.update(jobId, { list: packed.list, legs, rota, on: worked.on, updatedAt: stamp() });
  return { kind: "walk", job: { ...job, list: packed.list, legs, rota, on: worked.on }, entries };
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
      // or never started in the hour (`startPullJob`), is not undone by a leg that then runs on,
      // and a Stop pressed meanwhile is honoured before anything is asked of GameChanger.
      if (!(await jobs.updateIfUnchanged(jobId, job, running))) {
        const now = await jobs.read(jobId);
        if (
          !now ||
          now.status === "done" ||
          now.status === "failed" ||
          now.status === "cancelled"
        ) {
          return "over";
        }
        if (now.stopAsked) {
          await jobs.update(jobId, { status: "cancelled", stage: "waiting", updatedAt: stamp() });
          return "cancelled";
        }
        // Moved for some other reason: tried again by Cloud Tasks, reading it afresh.
        throw new TryLegAgain("The pull changed while its leg was starting.");
      }
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
        // Held to the copy the job's first leg read: a start of Team Rankings between legs ends it.
        ...(walking.on ? { startedOn: walking.on } : {}),
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
    // A list's first leg keeps the copy it read for the legs after it (`PullJob.on`), as a
    // refresh's keeps the one its teams were worked out from; a saved run's manifest is that copy.
    const on = !walking.on && result.manifest ? { on: epochOf(result.manifest) } : {};
    if (result.end === "stopped") {
      await jobs.update(jobId, {
        status: "cancelled",
        stage: "waiting",
        legsDone,
        tally,
        end: result.end,
        version,
        error: null,
        ...on,
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
      ...on,
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
  | "unavailable"
  /**
   * The first leg could not be queued and the job could not be marked so either, so whether the
   * queueing took after all is unknown: said to the device as an answer that proves nothing
   * (`callStartPull`), which keeps watching the job and asks about it again.
   */
  | "unknown";

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
  // A list longer than one pull takes, sent by a tab from before the page refused one: ended, so it
  // is not asked about again, and refused in words the device shows.
  if (job.list.teams > MAX_LIST_TEAMS) {
    const message = tooManyTeams(job.list.teams);
    await end({ status: "failed", error: message });
    return { ok: false, refusal: "invalid-argument", message };
  }
  let queued: void | "already";
  try {
    queued = await deps.enqueue({ jobId, leg: 0 });
  } catch (error) {
    const message = `The cloud could not queue this pull: ${causeOf(error)}`;
    // A leg of a task an earlier ask queued started it meanwhile: it runs, and nothing is refused.
    const ended = await end({ status: "failed", error: message });
    if (ended === false) return { ok: true, status: job.status };
    // Unmarked, the job is still queued and may yet run: a refusal would have the device forget it.
    if (ended === null) return { ok: false, refusal: "unknown", message };
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

/**
 * How long a staged import may go unheard from before `reapPullJob` takes it for dead, if nothing
 * holds its lease either. Its supervisor beats every ten seconds, gives up its own execution after
 * seventy without renewing the lease (`importJob.ts`), and a Cloud Run retry waits out a dead
 * one's ninety-second lease before it claims it (`IMPORT_LEASE_MS`): five minutes is past all of
 * that, and is when the page starts calling the import silent (`PULL_STALE_MS`).
 */
export const IMPORT_SILENT_MS = 5 * 60_000;

/**
 * How long a job of the older runner, a list's legs or Refresh now's, may go unwritten while it
 * says it is running before it is taken for dead. As long as the refresh gate gives a quiet
 * refresh (`REFRESH_QUIET_MS`), and for its reason: a leg is three half-hour tries at most, and a
 * job between legs waits only behind other pulls' legs, so two hours is past any that is alive.
 */
export const LEGS_SILENT_MS = REFRESH_QUIET_MS;

/** What a staged import ended as dead says: its downloads are kept, and Resume carries on. */
export const IMPORT_WENT_SILENT =
  "The importer stopped without saying why: no heartbeat for five minutes, and nothing holds its lease. Its downloads are kept; Resume continues from the saved checkpoints.";

/** What an import ended as dead after a stop was asked says, as its supervisor's own stop does. */
export const STOPPED_WENT_SILENT = "Stopped. Downloads are kept; resume this import when ready.";

/** What a job of the older runner ended as dead says. */
export const LEGS_WENT_SILENT =
  "Nothing of this ran for two hours, so it was ended. What it filed before then is kept.";

/**
 * Ends the job `jobId` names when its worker has died without a word, so no device shows it
 * running for good: on 12 October 2026 a list's job said "running, loading; part 9 of 18; stop
 * asked" for days, with nothing left that would ever run or end it, its Stop doing nothing and
 * Refresh now held off behind it. Run by `startPull` before anything else it does with a job, so a
 * device's ask (Dismiss, Stop, Resume, or the start of a list sent again) is what ends it.
 *
 * A staged import is dead once nothing has been heard from it in `IMPORT_SILENT_MS` and nothing
 * holds its execution lease: a supervisor still renewing the lease is alive, however late its
 * heartbeat. A job of the older runner, once nothing has written it in `LEGS_SILENT_MS`. Only a job
 * that says it is running: a queued one is the start's to end (`startPullJob`), and one resumed is
 * queued until Cloud Run starts it. Ended as failed, or cancelled where a stop was asked, and only
 * while it is still as read, so a worker that wrote meanwhile keeps it. The status it was ended
 * with, or null where it was left alone.
 */
export const reapPullJob = async (
  jobId: string,
  deps: {
    jobs: Pick<JobDocs, "read" | "updateIfUnchanged">;
    /** Until when an execution holds a staged import's lease, in milliseconds (`importLeaseUntil`). */
    leaseUntil: (jobId: string) => Promise<number>;
    now: () => Date;
  }
): Promise<PullJobStatus | null> => {
  if (!JOB_ID.test(jobId)) return null;
  const job = await deps.jobs.read(jobId);
  if (!job || job.status !== "running") return null;
  const nowMs = deps.now().getTime();
  const silentMs = nowMs - lastHeardFrom(job);
  const staged = job.pipeline === "staged-v1" && !job.rota;
  if (!(silentMs >= (staged ? IMPORT_SILENT_MS : LEGS_SILENT_MS))) return null;
  if (staged && (await deps.leaseUntil(jobId)) > nowMs) return null;
  const status = job.stopAsked ? "cancelled" : "failed";
  const error = !staged
    ? LEGS_WENT_SILENT
    : job.stopAsked
      ? STOPPED_WENT_SILENT
      : IMPORT_WENT_SILENT;
  const ended = await deps.jobs.updateIfUnchanged(jobId, job, {
    status,
    stage: "waiting",
    error,
    updatedAt: deps.now().toISOString(),
  });
  return ended ? status : null;
};

/** How recent a heartbeat says a staged import's supervisor is still at work. */
const ALIVE_MS = 120_000;

export type ResumeAnswer =
  | { ok: true; status: PullJobStatus }
  | { ok: false; refusal: "invalid-argument" | "unavailable"; message: string };

/**
 * Resume on a list's job (`startPull` with `resume`): a failed or stopped import queued again and
 * its staged importer launched, carrying on from its saved checkpoints; one of the older runner
 * moved onto the staged importer, keeping what its legs filed (`priorTally`); and a staged import
 * still marked running but silent launched again, whose execution lease admits one worker. One
 * whose supervisor beat inside the last two minutes is left running. Refresh now is not a list's,
 * and a list longer than one pull takes (`MAX_LIST_TEAMS`) is not resumed either.
 */
export const resumePullJob = async (
  jobId: unknown,
  deps: {
    jobs: Pick<JobDocs, "read" | "updateIfUnchanged">;
    /** Starts the staged importer's Cloud Run job for `jobId` (`launchImport`). */
    launch: (jobId: string) => Promise<void>;
    now: () => Date;
  }
): Promise<ResumeAnswer> => {
  if (typeof jobId !== "string" || !JOB_ID.test(jobId))
    return { ok: false, refusal: "invalid-argument", message: "Invalid import id." };
  const job = await deps.jobs.read(jobId);
  if (!job || job.rota)
    return { ok: false, refusal: "invalid-argument", message: "This import cannot be resumed." };
  if (job.status === "done") return { ok: true, status: "done" };
  if (job.list.teams > MAX_LIST_TEAMS)
    return { ok: false, refusal: "invalid-argument", message: tooManyTeams(job.list.teams) };
  const nowMs = deps.now().getTime();
  if (
    job.pipeline &&
    job.status === "running" &&
    job.heartbeatAt &&
    nowMs - Date.parse(job.heartbeatAt) < ALIVE_MS
  )
    return { ok: true, status: "running" };
  const over = job.status === "failed" || job.status === "cancelled";
  if (over) {
    const queued = await deps.jobs.updateIfUnchanged(jobId, job, {
      status: "queued",
      ...(!job.pipeline ? { pipeline: "staged-v1" as const, priorTally: job.tally } : {}),
      stopAsked: false,
      stage: "waiting",
      error: null,
      updatedAt: deps.now().toISOString(),
    });
    if (!queued)
      return { ok: false, refusal: "unavailable", message: "Retrying the resume request." };
  }
  if (!job.pipeline && !over)
    return {
      ok: false,
      refusal: "invalid-argument",
      message: "Stop the earlier import before resuming it with the faster importer.",
    };
  // The execution lease admits one worker; repeated or unanswered starts are safe.
  await deps.launch(jobId);
  return { ok: true, status: "queued" };
};

/** What a start of Team Rankings found pulling into the copy, and asked to stop. */
export type StoppedPulls = {
  /** Pulls a device left for the cloud, imports and Refresh now among them, asked to stop now. */
  pulls: number;
  /** Whether the nightly says it is pulling (`nightlyPulling`), which nothing here can stop. */
  nightly: boolean;
};

/**
 * Every pull a device left for the cloud that is queued or running, asked to stop, as its Stop
 * button asks (`stopAsked` and nothing else, the stamp left as it was): run by the edit function
 * once a start of Team Rankings is saved (`startsAgain`), so a pull that was under way neither goes
 * on asking GameChanger for a pool that is gone nor races the start silently. Nothing it fetched is
 * filed into the copy in any case, since every leg and import is held to the start of Team
 * Rankings it read (`CloudManifest.epoch`); the stop ends it where it is rather than after its
 * downloads, and the start says how many it stopped, and whether the nightly, which cannot be
 * stopped from here, is pulling. A job already asked to stop is not asked again, nor counted.
 */
export const stopPullsUnderWay = async (deps: {
  /** Every job's document (`pullJobs/`), as stored. */
  list: () => Promise<Array<{ id: string; fields: Record<string, unknown> }>>;
  jobs: Pick<JobDocs, "update">;
  gate: Pick<GateDocs, "readAt">;
  now: () => Date;
}): Promise<StoppedPulls> => {
  let pulls = 0;
  for (const { id, fields } of await deps.list()) {
    const job = coercePullJob(fields);
    if (!JOB_ID.test(id) || !job || job.stopAsked) continue;
    if (job.status !== "queued" && job.status !== "running") continue;
    await deps.jobs.update(id, { stopAsked: true });
    pulls += 1;
  }
  return { pulls, nightly: await nightlyPulling(deps.gate, deps.now()) };
};
