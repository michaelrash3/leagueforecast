import type { GcTeamListEntry } from "../gameChangerApi";
import { MIN_PULL_GAP_HOURS } from "../gameChangerSchedule";
import type { Called, RefreshStart } from "../live/editClient";
import { randomId } from "./cloudManifest";
import type { PullJobStore } from "./firebaseCloud";
import {
  MAX_LIST_TEAMS,
  lastHeardFrom,
  newPullJob,
  packJobList,
  tooManyTeams,
  type PullJob,
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
 * A pull this device sent. `told` once the user has heard how it ended. `askedAt` is when this
 * device last asked the cloud to start it again (`askAgain`), left out until it first does.
 */
export type SentPull = {
  jobId: string;
  sentAt: string;
  teams: number;
  told: boolean;
  askedAt?: string;
};

/** Kept at most: the pulls still being told about, and a few after. */
const KEEP = 20;
const UPLOADS_KEY = "league_forecast_import_uploads_v1";

const isSentPull = (raw: unknown): raw is SentPull => {
  if (typeof raw !== "object" || raw === null) return false;
  const { jobId, sentAt, teams, told, askedAt } = raw as Record<string, unknown>;
  return (
    typeof jobId === "string" &&
    typeof sentAt === "string" &&
    typeof teams === "number" &&
    typeof told === "boolean" &&
    (askedAt === undefined || typeof askedAt === "string")
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
 * Sends `entries` to be pulled in the cloud: the list's pieces and the job, then a call to
 * `startPull`, which queues its first leg. A start that went unanswered is asked once more at
 * once, since asking twice is asking once; one still unanswered may have started all the same, so
 * it is remembered and watched like one that did, and asked about again while it waits
 * (`dueForAsking`). One refused is not remembered, and the refusal is said.
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
  // Refused here before anything is uploaded; `startPull` refuses one from an older page too.
  if (entries.length > MAX_LIST_TEAMS) return { ok: false, message: tooManyTeams(entries.length) };
  const ready = await sender.ready?.();
  if (ready && !ready.ok) return { ok: false, message: ready.message };
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
    const known = await sender.jobs.read(previous.jobId).catch(() => undefined);
    if (known !== null && !(refresh && known?.status === "done")) {
      saveSentPulls([
        ...loadSentPulls().filter((p) => p.jobId !== previous.jobId),
        {
          jobId: previous.jobId,
          sentAt: known?.createdAt ?? now,
          teams: entries.length,
          told: false,
        },
      ]);
      onStored?.();
      let started: Called<{ status: string }> | undefined;
      if (!known || known.status === "queued") started = await sender.start(previous.jobId);
      else if ((known.status === "failed" || known.status === "cancelled") && sender.resume)
        started = await sender.resume(previous.jobId);
      if (started && !started.ok) return { ok: false, message: started.message, watching: true };
      return { ok: true, jobId: previous.jobId };
    }
  }
  const jobId = randomId();
  const packed = await packJobList(entries);
  try {
    await sender.jobs.put(
      jobId,
      newPullJob({ list: packed.list, seasonYears, timeZone, device, now, refresh }),
      packed.pieces
    );
  } catch {
    return { ok: false, message: "The pull could not be sent to the cloud. Try again." };
  }
  const remember = () =>
    saveSentPulls([
      ...loadSentPulls().filter((p) => p.jobId !== jobId),
      { jobId, sentAt: now, teams: entries.length, told: false },
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
      saveSentPulls(loadSentPulls().filter((p) => p.jobId !== jobId));
      try {
        localStorage.setItem(UPLOADS_KEY, JSON.stringify(uploads));
      } catch {
        /* optional */
      }
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

/**
 * Whether this device should ask the cloud again to start a list it sent: still queued, with no leg
 * having written to it (one that has is being tried by Cloud Tasks itself), and not asked in the
 * last `ASK_AGAIN_MS`. A stopped one is asked too, since only a running leg reads the stop and the
 * ask is what cancels one that never started. "Refresh now" is the server's own to start.
 */
export const dueForAsking = ({ job, sent }: WatchedPull, nowMs: number): boolean => {
  if (isRefresh({ job, sent }) || job.status !== "queued") return false;
  if (!job.stopAsked && job.updatedAt !== job.createdAt) return false;
  const last = Date.parse(sent.askedAt ?? sent.sentAt);
  return !Number.isFinite(last) || nowMs - last >= ASK_AGAIN_MS;
};

/**
 * Asks the cloud again to start a list this device sent, saying how long it has waited by this
 * device's own clock, and keeps when it asked. The cloud queues it afresh if its first start never
 * did, says why if it cannot, cancels it if it was stopped, and ends it if its task was made and
 * nothing started it within the hour (`startPullJob`); the job, read again, says which.
 */
export const askAgain = async (
  { sent }: WatchedPull,
  sender: Pick<PullSender, "start">,
  now: Date
): Promise<Called<{ status: string }>> => {
  saveSentPulls(
    loadSentPulls().map((entry) =>
      entry.jobId === sent.jobId ? { ...entry, askedAt: now.toISOString() } : entry
    )
  );
  const sentAt = Date.parse(sent.sentAt);
  return sender.start(
    sent.jobId,
    Number.isFinite(sentAt) ? Math.max(0, now.getTime() - sentAt) : undefined
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

/** One line on how a pull ended. */
export const describeEnd = (pull: WatchedPull): string => {
  if (isRefresh(pull)) return describeRefreshEnd(pull);
  const { job, sent } = pull;
  const teams = sent.teams.toLocaleString();
  const { filed, gamesAdded, gamesUpdated, failed } = job.tally;
  const games = `${gamesAdded.toLocaleString()} games added and ${gamesUpdated.toLocaleString()} updated`;
  const unanswered =
    failed > 0
      ? job.pipeline === "staged-v1"
        ? `; ${failed.toLocaleString()} skipped because their downloads failed`
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
 * One line on how far a running pull has got. A stop asked is said before anything else, a pull
 * stopped before it started included, and one stopped while it files says it is saving the teams
 * it pulled first; one just queued is starting, and one waiting longer says how long since it was
 * sent, and what its last try said, if a leg failed before it could start.
 */
export const describeProgress = (pull: WatchedPull, nowMs: number = Date.now()): string => {
  if (isRefresh(pull)) return describeRefreshProgress(pull);
  const { job, sent } = pull;
  const teams = sent.teams.toLocaleString();
  if (job.stopAsked) {
    const kept = job.progress.done - job.progress.failed;
    return (job.stage === "filing" || job.stage === "saving") && kept > 0
      ? `Pulling ${teams} teams in the cloud: stopping, saving the ${kept.toLocaleString()} teams it pulled first.`
      : `Pulling ${teams} teams in the cloud: stopping.`;
  }
  if (job.status === "queued") {
    const since = nowMs - Date.parse(sent.sentAt);
    const starting = !job.error && Number.isFinite(since) && since < STARTING_MS;
    const waiting = `Pulling ${teams} teams in the cloud: ${starting ? "starting" : "waiting to start"}, sent ${agoFrom(sent.sentAt, nowMs)}.`;
    return job.error ? `${waiting} Its last try said: ${job.error}` : waiting;
  }
  return `Pulling ${teams} teams in the cloud: ${legAndStage(job, nowMs)}.`;
};
