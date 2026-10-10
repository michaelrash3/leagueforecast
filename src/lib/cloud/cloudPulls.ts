import type { GcTeamListEntry } from "../gameChangerApi";
import { MIN_PULL_GAP_HOURS } from "../gameChangerSchedule";
import type { Called, RefreshStart } from "../live/editClient";
import { randomId } from "./cloudManifest";
import type { PullJobStore } from "./firebaseCloud";
import { newPullJob, packJobList, type PullJob } from "./pullJobs";

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

/** A pull this device sent. `told` once the user has heard how it ended. */
export type SentPull = { jobId: string; sentAt: string; teams: number; told: boolean };

/** Kept at most: the pulls still being told about, and a few after. */
const KEEP = 20;

const isSentPull = (raw: unknown): raw is SentPull => {
  if (typeof raw !== "object" || raw === null) return false;
  const { jobId, sentAt, teams, told } = raw as Record<string, unknown>;
  return (
    typeof jobId === "string" &&
    typeof sentAt === "string" &&
    typeof teams === "number" &&
    typeof told === "boolean"
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
  start: (jobId: string) => Promise<Called<{ status: string }>>;
  /**
   * Asks the cloud for "Refresh now" (`callStartRefresh`): the server makes the job, or hands back
   * the one under way. None on a sender that cannot, which offers no button. Only the device's name
   * is sent: every refresh keeps New York's day, whoever presses (`REFRESH_ZONE`).
   */
  startRefresh?: (ask: { device: string }) => Promise<Called<RefreshStart>>;
};

export type SendOutcome = { ok: true; jobId: string } | { ok: false; message: string };

/**
 * Sends `entries` to be pulled in the cloud: the list's pieces and the job, then a call to
 * `startPull`, which queues its first leg. A pull whose start went unanswered may have started
 * all the same, so it is remembered and watched like one that did; one refused is not.
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
  sender: PullSender
): Promise<SendOutcome> => {
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
  const started = await sender.start(jobId);
  if (!started.ok && started.why !== "unanswered") {
    return { ok: false, message: `The cloud would not start the pull: ${started.message}` };
  }
  saveSentPulls([...loadSentPulls(), { jobId, sentAt: now, teams: entries.length, told: false }]);
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
export const readSentPulls = async (jobs: Pick<PullJobStore, "read">): Promise<WatchedPull[]> => {
  const sent = loadSentPulls();
  const watched: WatchedPull[] = [];
  const gone = new Set<string>();
  for (const pull of sent.filter((entry) => !entry.told)) {
    const job = await jobs.read(pull.jobId).catch(() => undefined);
    if (job) watched.push({ sent: pull, job });
    else if (job === null) gone.add(pull.jobId);
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
const legAndStage = (job: PullJob): string => {
  const leg = job.legs > 1 ? `part ${job.legsDone + 1} of ${job.legs}, ` : "";
  const stage =
    job.stage === "fetching"
      ? `asking GameChanger, ${job.progress.done.toLocaleString()} of ${job.progress.total.toLocaleString()}`
      : job.stage === "loading"
        ? "reading the copy"
        : job.stage === "filing"
          ? "filing"
          : job.stage === "saving"
            ? "saving"
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
  const unanswered = failed > 0 ? `; ${failed.toLocaleString()} did not answer` : "";
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

/** One line on how far a running pull has got. */
export const describeProgress = (pull: WatchedPull): string => {
  if (isRefresh(pull)) return describeRefreshProgress(pull);
  const { job, sent } = pull;
  const teams = sent.teams.toLocaleString();
  if (job.status === "queued") return `Pulling ${teams} teams in the cloud: waiting to start.`;
  if (job.stopAsked) return `Pulling ${teams} teams in the cloud: stopping.`;
  return `Pulling ${teams} teams in the cloud: ${legAndStage(job)}.`;
};
