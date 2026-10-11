import type { PullJob } from "./pullJobs";

/**
 * The lines `scripts/pullStatus.ts` prints of the pulls in the cloud (README, "Pulls in the cloud:
 * seeing where each one is"): each job as its document says, the queue its legs wait in and the
 * tasks waiting there, and what `startPull` and `runPull` logged. It runs where the log is public,
 * so a job's id is cut to its first six characters, which is enough to tell the jobs of a day
 * apart and too little to address one, and any address not a Google service account's is taken
 * out of whatever Google says: a refusal can name the account it refused.
 */

/** A pull's id anywhere in a text, cut short; addresses not of a service account, taken out. */
export const masked = (text: string): string =>
  text
    .replace(/\b([0-9a-f]{6})[0-9a-f]{26}\b/g, "$1…")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (address) =>
      address.endsWith(".gserviceaccount.com") ? address : "(an address)"
    );

/** At most `max` characters of `text`, masked. */
export const clipped = (text: string, max = 400): string => {
  const plain = masked(text.replace(/\s+/g, " ").trim());
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
};

/** How long before `nowMs` the time `iso` was, in minutes, or a word when it is not a time. */
export const minutesBefore = (iso: string | undefined, nowMs: number): string => {
  const then = iso === undefined ? Number.NaN : Date.parse(iso);
  if (!Number.isFinite(then)) return "never";
  const minutes = Math.round((nowMs - then) / 60_000);
  return minutes < 1 ? "just now" : `${minutes} min ago`;
};

const count = (value: number): string => value.toLocaleString("en-US");

/** One job: what it pulls, where it is, when it was made and last written, and why it failed. */
export const jobLine = (jobId: string, job: PullJob, nowMs: number): string => {
  const what = job.rota
    ? `Refresh now (${count(job.list.teams)} teams)`
    : `list of ${count(job.list.teams)} teams${job.refresh ? ", every one again" : ""}`;
  const where =
    job.status === "running" && job.stage === "fetching"
      ? `running, asking GameChanger: ${count(job.progress.done)} of ${count(job.progress.total)}, ${count(job.progress.failed)} unanswered`
      : job.status === "running"
        ? `running, ${job.stage}`
        : job.status;
  const parts = [
    `${masked(jobId)} ${what}: ${where}`,
    `part ${Math.min(job.legsDone + 1, job.legs)} of ${job.legs} (${job.legsDone} done)`,
    ...(job.stopAsked ? ["stop asked"] : []),
    `made ${job.createdAt} (${minutesBefore(job.createdAt, nowMs)})`,
    job.updatedAt === job.createdAt
      ? "never written since"
      : `last written ${job.updatedAt} (${minutesBefore(job.updatedAt, nowMs)})`,
    `${count(job.tally.filed)} filed, ${count(job.tally.gamesAdded)} games added`,
    ...(job.end ? [`last leg ended ${job.end}`] : []),
    ...(job.error ? [`error: ${clipped(job.error)}`] : []),
  ];
  return parts.join("; ");
};

/** A queue as Cloud Tasks describes it: the part of it read here. */
export type QueueInfo = {
  name?: string;
  state?: string;
  rateLimits?: { maxConcurrentDispatches?: number; maxDispatchesPerSecond?: number };
  retryConfig?: { maxAttempts?: number; minBackoff?: string; maxBackoff?: string };
  stats?: {
    tasksCount?: string;
    oldestEstimatedArrivalTime?: string;
    executedLastMinuteCount?: string;
    concurrentDispatchesCount?: string;
  };
};

/** A queue: whether it runs, how many at once, its tries, and what waits in it. */
export const queueLine = (queue: QueueInfo, nowMs: number): string => {
  const name = queue.name?.split("/").pop() ?? "(unnamed)";
  const stats = queue.stats;
  return [
    `Queue ${name}: ${queue.state ?? "state unknown"}`,
    `${queue.rateLimits?.maxConcurrentDispatches ?? "?"} at a time`,
    `${queue.retryConfig?.maxAttempts ?? "?"} tries, ${queue.retryConfig?.minBackoff ?? "?"} to ${queue.retryConfig?.maxBackoff ?? "?"} apart`,
    ...(stats
      ? [
          `${stats.tasksCount ?? "0"} tasks in it`,
          `${stats.concurrentDispatchesCount ?? "0"} running now`,
          `${stats.executedLastMinuteCount ?? "0"} run in the last minute`,
          ...(stats.oldestEstimatedArrivalTime
            ? [`oldest due ${minutesBefore(stats.oldestEstimatedArrivalTime, nowMs)}`]
            : []),
        ]
      : []),
  ].join("; ");
};

type Attempt = {
  dispatchTime?: string;
  responseTime?: string;
  responseStatus?: { code?: number; message?: string };
};

/** A task as Cloud Tasks describes it, with its attempts (`responseView=FULL`). */
export type TaskInfo = {
  name?: string;
  createTime?: string;
  scheduleTime?: string;
  dispatchCount?: number;
  responseCount?: number;
  firstAttempt?: Attempt;
  lastAttempt?: Attempt;
};

const attemptOf = (attempt: Attempt | undefined, nowMs: number): string => {
  if (!attempt?.dispatchTime) return "none";
  const answer = attempt.responseTime
    ? `answered ${minutesBefore(attempt.responseTime, nowMs)}${
        attempt.responseStatus
          ? ` with code ${attempt.responseStatus.code ?? 0}${attempt.responseStatus.message ? ` (${clipped(attempt.responseStatus.message, 200)})` : ""}`
          : ""
      }`
    : "no answer yet";
  return `sent ${minutesBefore(attempt.dispatchTime, nowMs)}, ${answer}`;
};

/** A task: whose leg it is, when it was made and is due, how often it was sent, and the last try. */
export const taskLine = (task: TaskInfo, nowMs: number): string =>
  [
    `Task ${masked(task.name?.split("/").pop() ?? "(unnamed)")}`,
    `made ${minutesBefore(task.createTime, nowMs)}`,
    `due ${minutesBefore(task.scheduleTime, nowMs)}`,
    `sent ${task.dispatchCount ?? 0} times, answered ${task.responseCount ?? 0}`,
    `last try: ${attemptOf(task.lastAttempt, nowMs)}`,
  ].join("; ");

/** A log entry as Cloud Logging lists it: the part of it read here. */
export type LogEntry = {
  timestamp?: string;
  severity?: string;
  logName?: string;
  resource?: { type?: string; labels?: Record<string, string> };
  textPayload?: string;
  jsonPayload?: Record<string, unknown>;
  httpRequest?: { status?: number; latency?: string; requestMethod?: string };
  /** An audit entry's: what was done to the function or queue, and how it ended. */
  protoPayload?: { methodName?: string; status?: { code?: number; message?: string } };
};

/**
 * One log entry: when, how bad, from which function, and what it said. A request's entry gives
 * only its method, answer and time taken, never who sent it or from where; an audit entry, only
 * what was done and how it ended, never by whom.
 */
export const logLine = (entry: LogEntry): string => {
  const from =
    entry.resource?.labels?.service_name ??
    entry.resource?.labels?.queue_id ??
    entry.resource?.type ??
    "?";
  const head = `${entry.timestamp ?? "?"} ${entry.severity ?? "DEFAULT"} ${from}`;
  if (entry.httpRequest) {
    const { requestMethod, status, latency } = entry.httpRequest;
    const said = entry.textPayload ? `: ${clipped(entry.textPayload, 300)}` : "";
    return `${head} request ${requestMethod ?? "?"} answered ${status ?? "?"} after ${latency ?? "?"}${said}`;
  }
  if (entry.textPayload !== undefined) return `${head}: ${clipped(entry.textPayload)}`;
  if (entry.jsonPayload) {
    const { message, ...rest } = entry.jsonPayload;
    const words = typeof message === "string" ? message : "";
    const more = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : "";
    return `${head}: ${clipped(`${words}${more}`)}`;
  }
  if (entry.protoPayload?.methodName) {
    const { methodName, status } = entry.protoPayload;
    const ended = status?.code
      ? `, refused with code ${status.code}${status.message ? ` (${clipped(status.message, 300)})` : ""}`
      : "";
    return `${head}: ${methodName}${ended}`;
  }
  return head;
};
