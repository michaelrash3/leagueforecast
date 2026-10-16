import type { GcTeamListEntry } from "../gameChangerApi";
import { MIN_PULL_GAP_HOURS } from "../gameChangerSchedule";
import type { Called, RefreshStart } from "../live/editClient";
import { randomId } from "./cloudManifest";
import type { PullJobStore } from "./firebaseCloud";
import {
  MAX_LIST_TEAMS,
  lastHeardFrom,
  NO_TALLY,
  listParts,
  newPullJob,
  packJobList,
  skipsApart,
  type PullJob,
  type PullJobTally,
} from "./pullJobs";
import { hashValue } from "./cloudPack";

/**
 * A pull sent to be run in the cloud, from the device's side (README, "Pulls in the cloud"): the
 * list's pieces and the job written to `pullJobs/`, then `startPull` asked to run it, and how it
 * went heard on this device whether or not the tab stayed open. A member's device holds no pool,
 * so this is how the live page pulls a pasted list and the catch-ups (1.8).
 *
 * The cloud's side is `pullJobRunner.ts`; the documents both read are `pullJobs.ts`. This keeps, on
 * the device only, the pulls it has sent and not yet told the user about, so a tab opened after one
 * finished still says so, once.
 */

export const SENT_PULLS_KEY = "league_forecast_cloud_pulls_v1";

/**
 * A pull this device sent: one job, a whole list or one part of a list sent in parts, each part
 * remembered on its own and shown with the rest of its list (`listsOf`). `told` once the user has
 * heard how it ended. `askedAt` is when this device last asked the cloud to start it again
 * (`askAgain`), left out until it first does. `dueAt`, on a part after the first, is when this
 * device first asked for it once the part before it was done: its wait is counted from then, not
 * from the sending, since it waited for the parts before it and not for the cloud.
 */
export type SentPull = {
  jobId: string;
  sentAt: string;
  teams: number;
  told: boolean;
  askedAt?: string;
  dueAt?: string;
};

/**
 * Kept at most: the pulls still being told about, and some after. Room for a list of many parts,
 * each of which is a pull of its own here, beside the latest twenty jobs every device reads
 * (`recent`), so a part told about is not forgotten while those still name it.
 */
const KEEP = 60;
const UPLOADS_KEY = "league_forecast_import_uploads_v1";

const isSentPull = (raw: unknown): raw is SentPull => {
  if (typeof raw !== "object" || raw === null) return false;
  const { jobId, sentAt, teams, told, askedAt, dueAt } = raw as Record<string, unknown>;
  return (
    typeof jobId === "string" &&
    typeof sentAt === "string" &&
    typeof teams === "number" &&
    typeof told === "boolean" &&
    (askedAt === undefined || typeof askedAt === "string") &&
    (dueAt === undefined || typeof dueAt === "string")
  );
};

export const loadSentPulls = (): SentPull[] => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SENT_PULLS_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter(isSentPull) : [];
  } catch {
    return [];
  }
};

const saveSentPulls = (pulls: readonly SentPull[]): void => {
  try {
    localStorage.setItem(SENT_PULLS_KEY, JSON.stringify(pulls.slice(-KEEP)));
  } catch {
    // Without it a finished pull is told about in the tab that sent it only.
  }
};

/** What sending a pull needs of the cloud: where the jobs go, and the call that starts one. */
export type PullSender = {
  jobs: PullJobStore;
  ready?: () => Promise<Called<{ status: string }>>;
  /**
   * Asks `startPull` to queue the job's first leg (`callStartPull`); `waitedMs`, on an ask after
   * the first, is how long this device has waited for it by its own clock.
   */
  start: (jobId: string, waitedMs?: number) => Promise<Called<{ status: string }>>;
  resume?: (jobId: string) => Promise<Called<{ status: string }>>;
  /**
   * Asks the cloud for "Refresh now" (`callStartRefresh`): the server makes the job, or hands back
   * the one under way. None on a sender that cannot, which offers no button. Only the device's name
   * is sent: every refresh keeps New York's day, whoever presses (`REFRESH_ZONE`).
   */
  startRefresh?: (ask: { device: string }) => Promise<Called<RefreshStart>>;
};

/**
 * How a send went: started, or refused with why. A refusal after a start that went unanswered says
 * `watching`, since that first start may have queued the pull all the same: the job is kept and
 * watched, so it is never lost from sight and sent twice.
 */
export type SendOutcome =
  { ok: true; jobId: string } | { ok: false; message: string; watching?: true };

/**
 * Asks the cloud to cancel parts of a list that never started: each asked to stop, then asked
 * about, which cancels a queued one stopped before it ran (`startPullJob`). As far as the cloud can
 * be reached now; a part left asked to stop is cancelled by the next device that asks about it
 * (`dueForAsking`), and none is ever started once asked to stop (`startNextPart`).
 */
export const cancelParts = async (
  jobIds: readonly string[],
  sender: Pick<PullSender, "jobs" | "start">
): Promise<void> => {
  for (const jobId of jobIds) {
    try {
      await sender.jobs.askStop(jobId);
      await sender.start(jobId);
    } catch {
      // Left asked to stop, or queued with no part before it done: either way it never runs.
    }
  }
};

/**
 * A list this device sent before, sent again: found by the fingerprint its first sending left,
 * and acted on as it stands rather than sent twice. A list sent in parts is read along its
 * `next`s from its first part, as far as its parts can be read now, and its first part not done is
 * what is acted on, as a list sent whole is: started if queued, resumed if it failed or was
 * stopped, left alone while under way. Every part read is remembered, to be watched as the one list
 * it is. Null where it is sent afresh instead: a part gone from the cloud, a catch-up already done,
 * which asks its teams again, a part ended because Team Rankings was started again since, or a
 * list sent whole that is longer than one job takes, which only a page from before lists were
 * split could have sent, and which the cloud will not resume.
 */
const sendAgain = async (
  jobId: string,
  {
    parts,
    refresh,
    now,
  }: { parts: readonly (readonly GcTeamListEntry[])[]; refresh: boolean; now: string },
  sender: PullSender,
  onStored?: () => void
): Promise<SendOutcome | null> => {
  const first = await sender.jobs.read(jobId).catch(() => undefined);
  if (first === null) return null;
  if (first && !first.chain && first.list.teams > MAX_LIST_TEAMS) return null;
  const known: { jobId: string; job: PullJob | undefined }[] = [{ jobId, job: first }];
  let at = first;
  while (at?.chain?.next && known.length < at.chain.parts) {
    const partId = at.chain.next;
    const read = await sender.jobs.read(partId).catch(() => undefined);
    if (read === null) return null;
    known.push({ jobId: partId, job: read });
    at = read;
  }
  const current = known.find(({ job }) => job?.status !== "done");
  if (!current && refresh) return null;
  // Ended because Team Rankings was started again since: resumed, it would only end so again, and
  // what its parts before it filed went with the old one. Sent again, it is pulled into the new.
  if (current?.job?.end === "copy-replaced") return null;
  const ids = new Set(known.map((part) => part.jobId));
  saveSentPulls([
    ...loadSentPulls().filter((p) => !ids.has(p.jobId)),
    ...known.map(({ jobId: partId, job }, index) => ({
      jobId: partId,
      sentAt: job?.createdAt ?? now,
      teams: parts[index]?.length ?? job?.list.teams ?? 0,
      told: false,
    })),
  ]);
  onStored?.();
  if (!current) return { ok: true, jobId };
  const status = current.job?.status;
  let started: Called<{ status: string }> | undefined;
  if (status === undefined || status === "queued") started = await sender.start(current.jobId);
  else if ((status === "failed" || status === "cancelled") && sender.resume)
    started = await sender.resume(current.jobId);
  if (started && !started.ok) return { ok: false, message: started.message, watching: true };
  return { ok: true, jobId };
};

/**
 * Sends `entries` to be pulled in the cloud: the list's pieces and the job, then a call to
 * `startPull`, which queues its first leg. A start that went unanswered is asked once more at
 * once, since asking twice is asking once; one still unanswered may have started all the same, so
 * it is remembered and watched like one that did, and asked about again while it waits
 * (`dueForAsking`). One refused is not remembered, and the refusal is said.
 *
 * A list longer than one job takes (`MAX_LIST_TEAMS`) is cut, in its own order, into parts of at
 * most that many (`listParts`), each a job of its own linked to the next (`PullJob.chain`), and
 * only the first is started: the cloud starts each of the rest once the part before it is done
 * (`startNextPart`). The whole list is fingerprinted, so sending it again finds the parts sent
 * before rather than sending a second set (`sendAgain`).
 */
export const sendPull = async (
  {
    entries,
    seasonYears,
    refresh = false,
    device,
    timeZone,
    now,
  }: {
    entries: readonly GcTeamListEntry[];
    seasonYears: readonly number[];
    /** Every team pulled again, already in the pool or not (`PullJob.refresh`). */
    refresh?: boolean;
    device: string;
    timeZone: string;
    now: string;
  },
  sender: PullSender,
  onStored?: () => void
): Promise<SendOutcome> => {
  const ready = await sender.ready?.();
  if (ready && !ready.ok) return { ok: false, message: ready.message };
  const parts = listParts(entries);
  const fingerprint = await hashValue({
    entries: [...entries].sort((a, b) => a.teamId.localeCompare(b.teamId, "en")),
    seasonYears: [...seasonYears].sort(),
    refresh,
  });
  let uploads: { fingerprint: string; jobId: string }[] = [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(UPLOADS_KEY) ?? "[]");
    if (Array.isArray(parsed))
      uploads = parsed.filter(
        (row) => row && typeof row.fingerprint === "string" && typeof row.jobId === "string"
      );
  } catch {
    /* A browser without persistent storage still sends safely. */
  }
  const previous = uploads.find((row) => row.fingerprint === fingerprint);
  if (previous) {
    const again = await sendAgain(previous.jobId, { parts, refresh, now }, sender, onStored);
    if (again) return again;
  }
  // The first part's id names the whole list, on every part and in the fingerprint's record.
  const jobId = randomId();
  const sending = parts.map((part, index) => ({ jobId: index === 0 ? jobId : randomId(), part }));
  const written: string[] = [];
  try {
    // Last to first, so each part's `next` names a job already there, and the first part, the one
    // started, is there only once every part after it is.
    for (const [index, { jobId: partId, part }] of [...sending.entries()].reverse()) {
      const packed = await packJobList(part);
      const next = sending[index + 1]?.jobId;
      const chain =
        sending.length > 1
          ? {
              id: jobId,
              part: index + 1,
              parts: sending.length,
              teams: entries.length,
              ...(next ? { next } : {}),
            }
          : undefined;
      await sender.jobs.put(
        partId,
        newPullJob({
          list: packed.list,
          seasonYears,
          timeZone,
          device,
          now,
          refresh,
          ...(chain ? { chain } : {}),
        }),
        packed.pieces
      );
      written.push(partId);
    }
  } catch {
    // Parts written before one failed have no first part to start them: cancelled, not left.
    await cancelParts(written, sender);
    return { ok: false, message: "The pull could not be sent to the cloud. Try again." };
  }
  const sent = new Set(sending.map((part) => part.jobId));
  const remember = () =>
    saveSentPulls([
      ...loadSentPulls().filter((p) => !sent.has(p.jobId)),
      ...sending.map(({ jobId: partId, part }) => ({
        jobId: partId,
        sentAt: now,
        teams: part.length,
        told: false,
      })),
    ]);
  remember();
  try {
    localStorage.setItem(
      UPLOADS_KEY,
      JSON.stringify(
        [...uploads.filter((row) => row.fingerprint !== fingerprint), { fingerprint, jobId }].slice(
          -KEEP
        )
      )
    );
  } catch {
    /* optional */
  }
  onStored?.();
  let started = await sender.start(jobId);
  const unclear = !started.ok && started.why === "unanswered";
  if (unclear) started = await sender.start(jobId);
  if (!started.ok && started.why !== "unanswered") {
    const message = `The cloud would not start the pull: ${started.message}`;
    if (!unclear) {
      saveSentPulls(loadSentPulls().filter((p) => !sent.has(p.jobId)));
      try {
        localStorage.setItem(UPLOADS_KEY, JSON.stringify(uploads));
      } catch {
        /* optional */
      }
      // Forgotten here, the parts after a first part that will not run would wait for good.
      await cancelParts(
        sending.slice(1).map((part) => part.jobId),
        sender
      );
      return { ok: false, message };
    }
    remember();
    return { ok: false, message, watching: true };
  }
  remember();
  return { ok: true, jobId };
};

export type RefreshOutcome =
  { ok: true; jobId: string; already: boolean } | { ok: false; message: string };

/** Said where the cloud did not answer a press, which may have started a refresh all the same. */
export const REFRESH_UNANSWERED =
  "No answer came from the cloud, so the refresh may or may not have started. Press again in a minute: one that started is shown, not started twice.";

/**
 * Asks the cloud for "Refresh now" (README, "Refresh now in the cloud") and remembers the job it
 * answers with, a new one or the one already under way, to be watched as a pasted list's is.
 * `teams` is the count the card offered, said until the cloud has worked out its own. A press the
 * cloud did not answer is not remembered, since there is no job to watch: pressing again finds
 * the one it started, if it did.
 */
export const sendRefresh = async (
  { teams, device, now }: { teams: number; device: string; now: string },
  sender: PullSender
): Promise<RefreshOutcome> => {
  if (!sender.startRefresh) {
    return { ok: false, message: "This version of the app cannot ask the cloud for a refresh." };
  }
  const started = await sender.startRefresh({ device });
  if (!started.ok) {
    return {
      ok: false,
      message:
        started.why === "unanswered"
          ? REFRESH_UNANSWERED
          : `The cloud would not start the refresh: ${started.message}`,
    };
  }
  const { jobId, already } = started.value;
  const sent = loadSentPulls();
  if (!sent.some((pull) => pull.jobId === jobId && !pull.told)) {
    saveSentPulls([
      ...sent.filter((pull) => pull.jobId !== jobId),
      { jobId, sentAt: now, teams, told: false },
    ]);
  }
  return { ok: true, jobId, already };
};

/** Whether a job has ended, one way or another. */
export const isOver = (job: PullJob): boolean =>
  job.status === "done" || job.status === "failed" || job.status === "cancelled";

/** A sent pull, and how its job stands. */
export type WatchedPull = { sent: SentPull; job: PullJob };

/**
 * How each pull this device sent and has not told about stands: read once each. A job gone from
 * the cloud is forgotten here too; one that could not be read now is read again next time.
 */
export const readSentPulls = async (
  jobs: Pick<PullJobStore, "read" | "recent">,
  onUnread?: (pull: SentPull) => void
): Promise<WatchedPull[]> => {
  let sent = loadSentPulls();
  const recent = await jobs.recent?.().catch(() => []);
  const known = new Set(sent.map((p) => p.jobId));
  for (const { jobId, job } of recent ?? []) {
    if (!known.has(jobId))
      sent.push({ jobId, sentAt: job.createdAt, teams: job.list.teams, told: false });
  }
  saveSentPulls(sent);
  sent = loadSentPulls();
  const recentById = new Map(recent?.map((p) => [p.jobId, p.job]));
  const watched: WatchedPull[] = [];
  const gone = new Set<string>();
  for (const pull of sent.filter((entry) => !entry.told)) {
    const job = recentById.get(pull.jobId) ?? (await jobs.read(pull.jobId).catch(() => undefined));
    if (job) watched.push({ sent: pull, job });
    else if (job === null) gone.add(pull.jobId);
    else onUnread?.(pull);
  }
  if (gone.size > 0) saveSentPulls(sent.filter((entry) => !gone.has(entry.jobId)));
  return watched;
};

/** Marks a pull told about, so no tab tells of it again. */
export const markTold = (jobId: string): void => {
  saveSentPulls(
    loadSentPulls().map((entry) => (entry.jobId === jobId ? { ...entry, told: true } : entry))
  );
};

/**
 * How long a pull still waiting to start goes between this device's asks of the cloud. Asking is
 * cheap and changes nothing for a job already queued, and a minute's wait on a press is what the
 * person sees before a start that failed somewhere this device could not hear says why.
 */
export const ASK_AGAIN_MS = 60_000;

/** Whether a job is a part of a list sent in parts after its first, which the cloud starts. */
const laterPart = (job: PullJob): boolean => (job.chain?.part ?? 1) > 1;

/**
 * The part before `pull` in its list, among `all`, where this device has it: the part whose `next`
 * it is.
 */
export const earlierPart = (
  pull: WatchedPull,
  all: readonly WatchedPull[]
): WatchedPull | undefined =>
  laterPart(pull.job)
    ? all.find(
        ({ job }) => job.chain?.next === pull.sent.jobId && job.chain.id === pull.job.chain?.id
      )
    : undefined;

/**
 * Whether `pull` is a later part of a list waiting for a part before it that has not finished: it
 * is not on its way of itself, and holds nothing off. While that part runs, that part is on its
 * way; once it fails or is stopped, nothing of the list is until Resume.
 */
export const waitsOnEarlierPart = (pull: WatchedPull, all: readonly WatchedPull[]): boolean => {
  if (!laterPart(pull.job) || pull.job.status !== "queued") return false;
  const before = earlierPart(pull, all);
  return before !== undefined && before.job.status !== "done";
};

/**
 * The parts of `pull`'s list after it that have not ended, among `all`: what Stop and Dismiss on
 * a list end along with the part under way, so neither leaves the rest of the list to run on.
 */
export const partsAfter = (pull: WatchedPull, all: readonly WatchedPull[]): WatchedPull[] => {
  const chain = pull.job.chain;
  if (!chain) return [];
  return all.filter(
    ({ job }) => job.chain?.id === chain.id && job.chain.part > chain.part && !isOver(job)
  );
};

/** Every part of `pull`'s list among `all`, itself included: what is told about as one. */
export const partsOfList = (pull: WatchedPull, all: readonly WatchedPull[]): WatchedPull[] => {
  const id = pull.job.chain?.id;
  return id === undefined ? [pull] : all.filter(({ job }) => job.chain?.id === id);
};

/**
 * Whether this device should ask the cloud again to start a list it sent: still queued, with no leg
 * having written to it (one that has is being tried by Cloud Tasks itself), and not asked in the
 * last `ASK_AGAIN_MS`. A stopped one is asked too, since only a running leg reads the stop and the
 * ask is what cancels one that never started. "Refresh now" is the server's own to start.
 *
 * A later part of a list sent in parts is the cloud's to start once the part before it is done
 * (`startNextPart`), so it is asked about only from then: at once, the first time, which asks
 * nothing new of a part the cloud has just queued and starts one it never did, and each minute
 * after while nothing has touched it. Never while the part before it, read from `all`, is not
 * known done, which would run two parts of one list at once.
 */
export const dueForAsking = (
  pull: WatchedPull,
  nowMs: number,
  all: readonly WatchedPull[] = []
): boolean => {
  const { job, sent } = pull;
  if (isRefresh(pull) || job.status !== "queued") return false;
  if (!job.stopAsked && job.updatedAt !== job.createdAt) return false;
  if (laterPart(job) && !job.stopAsked) {
    if (earlierPart(pull, all)?.job.status !== "done") return false;
    if (sent.askedAt === undefined) return true;
  }
  const last = Date.parse(sent.askedAt ?? sent.sentAt);
  return !Number.isFinite(last) || nowMs - last >= ASK_AGAIN_MS;
};

/**
 * Asks the cloud again to start a list this device sent, saying how long it has waited by this
 * device's own clock, and keeps when it asked. The cloud queues it afresh if its first start never
 * did, says why if it cannot, cancels it if it was stopped, and ends it if its task was made and
 * nothing started it within the hour (`startPullJob`); the job, read again, says which. A later
 * part of a list waits from when its turn came, the first time this device asked for it (`dueAt`):
 * that first ask says no wait at all, so a part that waited hours for the parts before it is never
 * ended as one the cloud left waiting.
 */
export const askAgain = async (
  { sent, job }: WatchedPull,
  sender: Pick<PullSender, "start">,
  now: Date
): Promise<Called<{ status: string }>> => {
  const later = laterPart(job);
  const stored = loadSentPulls().find((entry) => entry.jobId === sent.jobId);
  const dueAt = stored?.dueAt ?? sent.dueAt;
  saveSentPulls(
    loadSentPulls().map((entry) =>
      entry.jobId === sent.jobId
        ? {
            ...entry,
            askedAt: now.toISOString(),
            ...(later ? { dueAt: dueAt ?? now.toISOString() } : {}),
          }
        : entry
    )
  );
  const since = Date.parse((later ? dueAt : sent.sentAt) ?? "");
  return sender.start(
    sent.jobId,
    Number.isFinite(since) ? Math.max(0, now.getTime() - since) : undefined
  );
};

/** Whether a watched pull is "Refresh now" rather than a list this device sent. */
export const isRefresh = ({ job }: WatchedPull): boolean => job.rota !== undefined;

/**
 * The teams a refresh pulls: the cloud's own count once its first leg has worked them out, the
 * card's until then.
 */
const refreshTeams = ({ job, sent }: WatchedPull): string =>
  (job.rota?.at ? job.list.teams : sent.teams).toLocaleString();

/** One line on how "Refresh now" ended. */
const describeRefreshEnd = (pull: WatchedPull): string => {
  const { job } = pull;
  const teams = refreshTeams(pull);
  const { filed, gamesAdded, gamesUpdated, failed } = job.tally;
  const games = `${gamesAdded.toLocaleString()} games added and ${gamesUpdated.toLocaleString()} updated`;
  const unanswered = failed > 0 ? `; ${failed.toLocaleString()} did not answer` : "";
  if (job.status === "failed") {
    return `The refresh in the cloud failed${job.error ? `: ${job.error}` : "."}`;
  }
  if (job.status === "cancelled") {
    return `The refresh in the cloud was stopped: ${filed.toLocaleString()} of ${teams} teams filed, ${games}${unanswered}.`;
  }
  if (job.end === "nothing-due") {
    const held = job.rota?.heldBack ?? 0;
    return `The refresh in the cloud had no team to pull${
      held > 0
        ? `: the ${held.toLocaleString()} due were all pulled in the last ${MIN_PULL_GAP_HOURS} hours and play nothing yesterday, today or tomorrow`
        : ""
    }.`;
  }
  if (job.end === "gave-up") {
    return `GameChanger stopped answering the refresh in the cloud: ${filed.toLocaleString()} of ${teams} teams filed, ${games}. The nightly asks again for the rest.`;
  }
  return `The refresh in the cloud is done: ${filed.toLocaleString()} of ${teams} teams filed, ${games}${unanswered}.`;
};

/** One line on how far "Refresh now" has got. */
const describeRefreshProgress = (pull: WatchedPull): string => {
  const { job } = pull;
  if (job.status === "queued") return "Refreshing in the cloud: waiting to start.";
  if (job.stopAsked) return "Refreshing in the cloud: stopping.";
  if (!job.rota?.at) return "Refreshing in the cloud: working out today's teams.";
  return `Refreshing ${refreshTeams(pull)} teams in the cloud: ${legAndStage(job)}.`;
};

/** The part of a running job's line that says which part it is on and what it is doing. */
const legAndStage = (job: PullJob, nowMs = Date.now()): string => {
  if (job.pipeline === "staged-v1") {
    if (job.stage === "checking") return "checking which teams need importing";
    if (job.stage === "loading") return "loading the cloud copy for final processing";
    if (job.stage === "filing")
      return `${job.detail || "matching opponents and assigning ages"}, ${job.progress.done.toLocaleString()} of ${job.progress.total.toLocaleString()} downloaded teams processed`;
    if (job.stage === "tidying") return job.detail || "running the final tidy";
    if (job.stage === "saving") return "saving the finished import";
    if (job.error) return `retrying from the saved checkpoint: ${job.error}`;
    if (job.stage === "fetching") {
      const hold = Date.parse(job.download?.holdUntil ?? "") - nowMs;
      if (hold > 0)
        return `waiting on GameChanger; next requests in ${Math.ceil(hold / 1000).toLocaleString()} seconds`;
      if (job.detail) return job.detail;
      const downloaded = Math.max(0, job.progress.done - job.progress.failed);
      const remaining = Math.max(0, job.progress.total - job.progress.done);
      return `download batch ${Math.min(job.legsDone + 1, job.legs)} of ${job.legs}, ${downloaded.toLocaleString()} downloaded, ${job.progress.failed.toLocaleString()} skipped, ${remaining.toLocaleString()} remaining in this batch`;
    }
  }
  const leg = job.legs > 1 ? `part ${Math.min(job.legsDone + 1, job.legs)} of ${job.legs}, ` : "";
  const stage =
    job.stage === "fetching"
      ? `asking GameChanger, ${job.progress.done.toLocaleString()} of ${job.progress.total.toLocaleString()}`
      : job.stage === "loading"
        ? "reading the copy"
        : job.stage === "filing"
          ? "filing"
          : job.stage === "saving"
            ? "saving"
            : job.error
              ? `waiting to retry (${job.error})`
              : "between parts";
  return `${leg}${stage}`;
};

/** What an end line says of the downloads skipped for now (`skipsApart`). */
const PASSING_END = " (GameChanger throttled, timed out or dropped them; a later paste asks again)";

/** One line on how a pull ended. */
export const describeEnd = (pull: WatchedPull): string => {
  if (isRefresh(pull)) return describeRefreshEnd(pull);
  const { job, sent } = pull;
  const teams = sent.teams.toLocaleString();
  const { filed, gamesAdded, gamesUpdated, failed } = job.tally;
  const games = `${gamesAdded.toLocaleString()} games added and ${gamesUpdated.toLocaleString()} updated`;
  const apart = skipsApart(job, PASSING_END);
  const unanswered =
    failed > 0
      ? job.pipeline === "staged-v1"
        ? `; ${failed.toLocaleString()} skipped because their downloads failed${apart}`
        : `; ${failed.toLocaleString()} did not answer`
      : "";
  if (job.status === "failed") {
    return `The pull of ${teams} teams in the cloud failed${job.error ? `: ${job.error}` : "."}`;
  }
  if (job.status === "cancelled") {
    return `The pull in the cloud was stopped: ${filed.toLocaleString()} of ${teams} teams filed, ${games}${unanswered}.`;
  }
  if (job.end === "gave-up") {
    return `GameChanger stopped answering the pull in the cloud: ${filed.toLocaleString()} of ${teams} teams filed, ${games}. Pull the rest later.`;
  }
  return `The pull in the cloud is done: ${filed.toLocaleString()} of ${teams} teams filed, ${games}${unanswered}.`;
};

/** How long ago `since` was at `nowMs`, in the words a line uses: "just now", "12 minutes ago". */
export const agoFrom = (since: string, nowMs: number): string => {
  const then = Date.parse(since);
  if (!Number.isFinite(then)) return "a while ago";
  const minutes = Math.floor(Math.max(0, nowMs - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
};

/**
 * How long a pull the cloud has queued is "starting" rather than "waiting to start": a leg starts
 * within seconds of being queued while fewer than `runPull`'s three run, and the 9,270-team pull
 * asked again on 11 October 2026 began the same second it was queued. One still queued after this
 * is waiting behind other pulls, or its start failed somewhere the device has yet to hear.
 */
export const STARTING_MS = 2 * 60_000;

/** Warn about absent progress without claiming that a worker has definitely stopped. */
export const PULL_STALE_MS = 5 * 60_000;

/**
 * Whether a pull the cloud says is running has gone silent: nothing heard from its worker in
 * `PULL_STALE_MS` (`lastHeardFrom`). A staged import beats every ten seconds, so five minutes of
 * nothing is a dead or restarting worker; a leg of the older runner writes only with news, and is
 * ended by the cloud only after two hours (`reapPullJob`). Such a line offers Dismiss, which asks
 * the cloud about the job and so ends it there if it is dead, and Refresh now no longer waits on
 * it. A pull still waiting to start has Stop and the device's own asks (`dueForAsking`) instead.
 */
export const goneSilent = (job: PullJob, nowMs: number): boolean =>
  job.status === "running" && nowMs - lastHeardFrom(job) >= PULL_STALE_MS;

/**
 * Whether a list's pull can be resumed from the page: failed or stopped, or a staged import gone
 * silent, which Resume launches again from its saved checkpoints (`resumePullJob`). Never Refresh
 * now, which is pressed again instead, and never a list longer than one pull takes.
 */
export const resumable = (job: PullJob, nowMs: number): boolean =>
  !job.rota &&
  job.list.teams <= MAX_LIST_TEAMS &&
  (job.status === "failed" ||
    job.status === "cancelled" ||
    (job.pipeline === "staged-v1" && goneSilent(job, nowMs)));

/** Whole-import download counts and measured rate, separate from the current batch. */
export const describeImportMetrics = (job: PullJob, nowMs = Date.now()): string | null => {
  if (!job.download) return null;
  const { done, total, perMinute, holdUntil } = job.download;
  const percent = total > 0 ? Math.floor((done * 100) / total) : 100;
  const holding = Date.parse(holdUntil ?? "") > nowMs;
  const speed = holding
    ? "paused for GameChanger"
    : perMinute > 0
      ? `${Math.round(perMinute).toLocaleString()} teams/min measured`
      : "measuring speed";
  const started = Date.parse(job.stageStartedAt ?? "");
  const seconds = Math.floor(Math.max(0, nowMs - started) / 1000);
  const age = Number.isFinite(seconds)
    ? ` Current stage: ${seconds < 60 ? `${seconds} sec` : `${Math.floor(seconds / 60)} min ${seconds % 60} sec`}.`
    : "";
  return `Download progress: ${done.toLocaleString()} of ${total.toLocaleString()} teams (${percent}%). ${speed}.${age}`;
};

/** The server's timestamp, independent of whether the browser's latest status read succeeded. */
export const describePullUpdate = (
  job: PullJob,
  nowMs: number = Date.now()
): { stale: boolean; message: string } => {
  const updated = Date.parse(job.updatedAt);
  if (job.pipeline === "staged-v1" && job.heartbeatAt && !isOver(job)) {
    const alive = nowMs - Date.parse(job.heartbeatAt) < 120_000;
    const advancing = nowMs - Date.parse(job.progressAt ?? job.updatedAt) < PULL_STALE_MS;
    const holding = Date.parse(job.download?.holdUntil ?? "") > nowMs;
    const gone = nowMs - Date.parse(job.heartbeatAt) >= PULL_STALE_MS;
    return {
      stale: !alive || (!advancing && !holding),
      message: `Worker heartbeat ${agoFrom(job.heartbeatAt, nowMs)}. Last progress ${agoFrom(job.progressAt ?? job.updatedAt, nowMs)}.${alive ? (holding ? " The worker is responding and waiting on GameChanger." : advancing ? " The worker is responding." : " The worker is connected, but progress has not advanced recently.") : gone ? " No heartbeat for five minutes: the importer has probably stopped. Resume carries on from its saved downloads." : " No recent heartbeat; checking whether the worker is restarting."}`,
    };
  }
  if (!Number.isFinite(updated)) {
    return { stale: false, message: "The last server update time is unavailable." };
  }
  const stale = !isOver(job) && nowMs - updated >= PULL_STALE_MS;
  return {
    stale,
    message: `Last server update ${agoFrom(job.updatedAt, nowMs)}.${stale ? " No recent progress; this pull may be stalled." : ""}`,
  };
};

/**
 * How far a list's job has got, in the words after "Pulling N teams in the cloud: " or after the
 * name of the part of a list it is. A stop asked is said before anything else, a pull stopped
 * before it started included, and one stopped while it files says it is saving the teams it pulled
 * first; one just queued is starting, and one waiting longer says how long since it was sent, or,
 * for a later part of a list, since its turn came (`dueAt`), and what its last try said, if a leg
 * failed before it could start.
 */
const progressOf = (pull: WatchedPull, nowMs: number): string => {
  const { job, sent } = pull;
  if (job.stopAsked) {
    const kept = job.progress.done - job.progress.failed;
    return (job.stage === "filing" || job.stage === "saving") && kept > 0
      ? `stopping, saving the ${kept.toLocaleString()} teams it pulled first.`
      : "stopping.";
  }
  if (job.status === "queued") {
    const later = laterPart(job);
    // A later part's turn came when this device first asked for it, or when the cloud queued it,
    // which touches it (`startNextPart`); its sending, hours before, says nothing of its wait.
    const touched = job.updatedAt !== job.createdAt ? job.updatedAt : undefined;
    const since = later ? (sent.dueAt ?? touched) : sent.sentAt;
    const waited = since === undefined ? 0 : nowMs - Date.parse(since);
    const starting = !job.error && Number.isFinite(waited) && waited < STARTING_MS;
    const when =
      since === undefined ? "" : `, ${later ? "its turn came" : "sent"} ${agoFrom(since, nowMs)}`;
    const waiting = `${starting ? "starting" : "waiting to start"}${when}.`;
    return job.error ? `${waiting} Its last try said: ${job.error}` : waiting;
  }
  return `${legAndStage(job, nowMs)}.`;
};

/** One line on how far a running pull has got (`progressOf`). */
export const describeProgress = (pull: WatchedPull, nowMs: number = Date.now()): string => {
  if (isRefresh(pull)) return describeRefreshProgress(pull);
  return `Pulling ${pull.sent.teams.toLocaleString()} teams in the cloud: ${progressOf(pull, nowMs)}`;
};

/**
 * The pulls this device watches as the lists they are: a list sent whole on its own, and the parts
 * of a list sent in parts together, in part order, named by the list's first part
 * (`PullJob.chain`). In the order each list is first met, so a list keeps its place.
 */
export const listsOf = (pulls: readonly WatchedPull[]): WatchedPull[][] => {
  const lists = new Map<string, WatchedPull[]>();
  for (const pull of pulls) {
    const key = pull.job.chain?.id ?? pull.sent.jobId;
    lists.set(key, [...(lists.get(key) ?? []), pull]);
  }
  return [...lists.values()].map((parts) =>
    [...parts].sort((a, b) => (a.job.chain?.part ?? 1) - (b.job.chain?.part ?? 1))
  );
};

/**
 * The part a list's line is about, whose buttons it carries: the first not done, or the last once
 * every part this device has is done. A list sent whole is its one job.
 */
export const currentPart = (parts: readonly WatchedPull[]): WatchedPull | undefined =>
  parts.find(({ job }) => job.status !== "done") ?? parts[parts.length - 1];

/**
 * Whether a list's line says how it ended rather than how far it has got: its current part failed
 * or was stopped, which halts the list until Resume, or is done and the list's last. A part done
 * whose next part this device has not read yet leaves the list under way.
 */
export const listOver = (parts: readonly WatchedPull[]): boolean => {
  const current = currentPart(parts);
  if (!current || !isOver(current.job)) return false;
  const chain = current.job.chain;
  return current.job.status !== "done" || !chain || chain.part >= chain.parts;
};

/** Parts `from` to `to` of a list in a line's words: "part 3", "parts 2 and 3", "parts 2 to 9". */
const partsWord = (from: number, to: number): string =>
  from === to
    ? `part ${from}`
    : to === from + 1
      ? `parts ${from} and ${to}`
      : `parts ${from} to ${to}`;

const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** `text` ending as a sentence does, for the cloud's own words set before a sentence of ours. */
const sentence = (text: string): string => {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

/**
 * One line on how far a list has got: a list sent whole as `describeProgress` says it, and a list
 * sent in parts as the one list it is: the whole list's teams, the part under way in
 * `progressOf`'s words, then the parts done before it and those waiting their turn after it, or,
 * once a stop is asked, that will not run.
 */
export const describeListProgress = (
  parts: readonly WatchedPull[],
  nowMs: number = Date.now()
): string => {
  const current = currentPart(parts);
  if (!current) return "";
  const chain = current.job.chain;
  if (!chain) return describeProgress(current, nowMs);
  const { parts: count } = chain;
  const waiting = current.job.status === "done";
  // Under way, or, past a part done whose next this device has not read yet, next to run.
  const part = waiting ? chain.part + 1 : chain.part;
  const from = waiting ? part : part + 1;
  const clauses = [
    part > 1 ? `${partsWord(1, part - 1)} ${part === 2 ? "is" : "are"} done` : "",
    from > count
      ? ""
      : current.job.stopAsked
        ? `${partsWord(from, count)} will not run`
        : `${partsWord(from, count)} ${from === count ? "waits its" : "wait their"} turn`,
  ].filter(Boolean);
  return [
    `Pulling ${chain.teams.toLocaleString()} teams in the cloud as ${count} parts, one after another.`,
    waiting
      ? ""
      : `Part ${part} of ${count} (${current.sent.teams.toLocaleString()} ${current.sent.teams === 1 ? "team" : "teams"}): ${progressOf(current, nowMs)}`,
    clauses.length > 0 ? `${capital(clauses.join("; "))}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
};

/** What every part of a list did, added up. */
const addedUp = (parts: readonly WatchedPull[]): PullJobTally => {
  const sum = { ...NO_TALLY };
  for (const { job } of parts) {
    for (const key of Object.keys(sum) as (keyof PullJobTally)[]) sum[key] += job.tally[key];
  }
  return sum;
};

/**
 * One line on how a list ended: a list sent whole as `describeEnd` says it, and a list sent in
 * parts as the one list it is: done, with what its parts filed added up; or halted at the part that
 * failed or was stopped, from which Resume carries the list on.
 */
export const describeListEnd = (parts: readonly WatchedPull[]): string => {
  const current = currentPart(parts);
  if (!current) return "";
  const chain = current.job.chain;
  if (!chain) return describeEnd(current);
  const { job } = current;
  const teams = chain.teams.toLocaleString();
  const at = `part ${chain.part} of ${chain.parts}`;
  const resume = `Resume carries the list on from part ${chain.part}.`;
  const tally = addedUp(parts);
  const games = `${tally.gamesAdded.toLocaleString()} games added and ${tally.gamesUpdated.toLocaleString()} updated`;
  const filed = `${tally.filed.toLocaleString()} of ${teams} teams filed`;
  if (job.status === "failed") {
    return `The pull of ${teams} teams in the cloud stopped at ${at}, which failed${job.error ? `: ${sentence(job.error)}` : "."} ${resume}`;
  }
  if (job.status === "cancelled") {
    return `The pull of ${teams} teams in the cloud was stopped at ${at}: ${filed}, ${games}. ${resume}`;
  }
  const skipped = parts.every((part) => part.job.skipped)
    ? {
        skipped: {
          transient: parts.reduce((n, part) => n + (part.job.skipped?.transient ?? 0), 0),
          permanent: parts.reduce((n, part) => n + (part.job.skipped?.permanent ?? 0), 0),
        },
      }
    : {};
  const unanswered =
    tally.failed > 0
      ? job.pipeline === "staged-v1"
        ? `; ${tally.failed.toLocaleString()} skipped because their downloads failed${skipsApart({ tally, ...skipped }, PASSING_END)}`
        : `; ${tally.failed.toLocaleString()} did not answer`
      : "";
  return `The pull of ${teams} teams in the cloud is done, in ${chain.parts} parts: ${filed}, ${games}${unanswered}.`;
};

/**
 * What the card says of a paste longer than one job takes, before it is sent: that it runs as
 * parts, and how many (`listParts`). Empty for a list that fits in one.
 */
export const describeSplit = (teams: number): string => {
  if (teams <= MAX_LIST_TEAMS) return "";
  const parts = Math.ceil(teams / MAX_LIST_TEAMS);
  return `This list will run in the cloud as ${parts} parts of up to ${MAX_LIST_TEAMS.toLocaleString()} teams, one after another.`;
};
