import type { FirestoreRestDocuments } from "./firestoreRest";
import { JOB_ID, newRefreshJob, type PullJob, type PullJobStatus } from "./pullJobs";
import type { JobDocs, LegTask } from "./pullJobRunner";

/**
 * Who is refreshing the cloud copy now, and what "Refresh now" may still spend today (README,
 * "Refresh now in the cloud"), kept in one document, `ops/refresh`, which no rule opens: only a
 * server's key reads or writes it, as the rebuilds' ledger beside it is kept.
 *
 * - A refresh a member starts from the Import tab (`startRefresh`, behind `startPull`) is named
 *   here, and while it is under way a second press is handed the one running to watch rather than
 *   starting another.
 * - The nightly (`scripts/nightly.ts`) waits for one under way to end before it pulls, and names
 *   itself here while it pulls (`nightlyTakesTurn`), so a press meanwhile is told so. Neither could
 *   harm the copy beside the other: every save is made only onto the manifest as it was read (its
 *   update time is the commit's precondition), and a run that finds the copy moved files its
 *   answers again onto the save it missed. What the gate spares is GameChanger, asked about the
 *   same teams twice at once, which the gap between two pulls of a team (`MIN_PULL_GAP_HOURS`)
 *   cannot stop when neither run has saved yet.
 * - The day's legs: a refresh starts only while the day has a leg left, and every leg it runs is
 *   counted, the first when it starts and the rest once its first leg knows how many there are
 *   (`chargeRefreshLegs`), which runs them only where the day has them all left. A pasted list is
 *   not counted: its legs are the list's size, sent once.
 *
 * Every change is written only onto the document as it was read (`replace`'s precondition), so two
 * presses at once, or a press and the nightly, cannot both take it. Nothing here reaches Google but
 * through the documents handed in, so every rule is tried against stand-ins (`refreshGate.test.ts`).
 */

export const REFRESH_GATE_PATH = "ops/refresh";

/**
 * The legs "Refresh now" may start in a New York day. A leg runs on 8 GiB and two processors
 * (`runPull`); the README's reckoning of a three-minute leg is 1,440 GiB-seconds and 360
 * processor-seconds, so three a day for a whole month would be 129,600 GiB-seconds, a little over a
 * third of the 360,000 Google's free tier gives functions a month, which the rebuilds' own cap
 * leaves two thirds of for the pulls and the proxy. That is reckoned from the published tier and the
 * nightly's run time on GitHub, not measured on the function. The whole refresh was 15,793 teams on
 * 29 September 2026, one leg of 25,000, so three legs is three presses.
 */
export const REFRESH_LEGS_A_DAY = 3;

/**
 * How long a refresh may go unheard from before it is taken as dead. A running leg says how far it
 * has got every ten seconds; between legs, a job waits behind any other pull's legs in the queue,
 * each at most half an hour, so two hours is past any refresh that is still alive, and short of a
 * gate left shut for the day by one whose worker died before it could say it failed.
 */
export const REFRESH_QUIET_MS = 2 * 3_600_000;

/**
 * How long the nightly's word that it is pulling holds: the nightly's job has 90 minutes on GitHub
 * (`nightly.yml`), so a run that never gave its turn back has ended by then.
 */
export const NIGHTLY_HOLD_MS = 90 * 60_000;

/** The longest the nightly waits for a refresh under way, of its step's 85 minutes. */
export const NIGHTLY_WAIT_MS = 45 * 60_000;

/** How often the nightly looks again while it waits. */
export const NIGHTLY_LOOK_MS = 30_000;

/** Tries at writing the gate onto a document another writer keeps moving. */
const GATE_TRIES = 5;

export type RefreshGate = {
  /** The "Refresh now" job last started, or null before any. */
  jobId: string | null;
  /** When the nightly said it began pulling, until it says it is done; null otherwise. */
  nightlyAt: string | null;
  /** The New York day `legs` counts, as YYYY-MM-DD, and the legs "Refresh now" started on it. */
  day: string;
  legs: number;
};

const NO_GATE: RefreshGate = { jobId: null, nightlyAt: null, day: "", legs: 0 };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The gate as read, field by field: whatever of it reads, and the empty gate's value for what does
 * not. Only servers write it, so a field that does not read was edited by hand in the console, and
 * a gate that refused to read at all would keep "Refresh now" shut until somebody noticed.
 */
export const coerceRefreshGate = (raw: unknown): RefreshGate => {
  if (!isRecord(raw)) return { ...NO_GATE };
  const { jobId, nightlyAt, day, legs } = raw;
  return {
    jobId: typeof jobId === "string" && JOB_ID.test(jobId) ? jobId : null,
    nightlyAt:
      typeof nightlyAt === "string" && Number.isFinite(Date.parse(nightlyAt)) ? nightlyAt : null,
    day: typeof day === "string" && ISO_DAY.test(day) ? day : "",
    legs: typeof legs === "number" && Number.isSafeInteger(legs) && legs >= 0 ? legs : 0,
  };
};

/**
 * The zone a "Refresh now" job keeps its day in: New York's, whoever pressed and wherever they
 * are, because every other part of the refresh keeps it there. The card's count is worked out by
 * the edit function, which runs in it (`edit` in `functions/src/index.ts`); the nightly runs in it
 * (`nightly.yml`), and so do the day's budget and the refresh log the nightly reads. A job kept in
 * the pressing device's zone pulled another day's levels from the card's wherever the two days
 * differed: a member in Chicago pressing in the hour after New York's midnight was pulled the
 * previous day's levels, not the ones offered, and a device reporting UTC that pressed on a New
 * York evening logged every level as refreshed tomorrow, so that night's nightly found nothing due.
 */
export const REFRESH_ZONE = "America/New_York";

/**
 * The day the budget counts in: New York's, as the rebuilds' ledger counts its days, whatever zone
 * the server runs in (Google's is UTC, where a New York evening is already tomorrow).
 */
export const budgetDay = (now: Date): string => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: REFRESH_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((one) => one.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

/** Whether `job` is a refresh still under way: queued or running, and heard from lately. */
export const refreshUnderWay = (job: PullJob | null, now: Date): boolean =>
  job !== null &&
  job.rota !== undefined &&
  (job.status === "queued" || job.status === "running") &&
  now.getTime() - Date.parse(job.updatedAt) < REFRESH_QUIET_MS;

/** Whether the nightly said it is pulling, within the time a nightly can run. */
const nightlyUnderWay = (gate: RefreshGate, now: Date): boolean =>
  gate.nightlyAt !== null && now.getTime() - Date.parse(gate.nightlyAt) < NIGHTLY_HOLD_MS;

/**
 * What a member's device sends to ask for "Refresh now": which device it is, and nothing of its
 * day, which is New York's for every refresh (`REFRESH_ZONE`).
 */
export type RefreshAsk = { device: string };

/** A device's name as `cloudState.ts` makes one: letters, digits and a few marks, short. */
const DEVICE = /^[A-Za-z0-9_.-]{1,64}$/;

/**
 * A member's asking for "Refresh now", read exactly, as a list's job is read before a leg of it
 * runs (`coercePullJob`): a device's name, and nothing else. No list: the server works the teams
 * out itself, so a device cannot name any. No time zone either, since every refresh keeps New York's
 * day (`REFRESH_ZONE`), and a zone sent is refused with anything else extra.
 */
export const coerceRefreshAsk = (raw: unknown): RefreshAsk | null => {
  if (!isRecord(raw)) return null;
  const { device, ...rest } = raw;
  if (Object.keys(rest).length > 0 || typeof device !== "string" || !DEVICE.test(device)) {
    return null;
  }
  return { device };
};

/** The gate document through Firestore's REST API: read with its token, written only at it. */
export type GateDocs = Pick<FirestoreRestDocuments, "readAt" | "replace">;

const readGate = async (docs: GateDocs): Promise<{ gate: RefreshGate; token: string | null }> => {
  const held = await docs.readAt(REFRESH_GATE_PATH);
  return { gate: coerceRefreshGate(held?.fields ?? null), token: held?.token ?? null };
};

export const NIGHTLY_PULLING =
  "The nightly refresh is pulling in the cloud right now. What it brings shows here once it is done.";
export const LEGS_SPENT =
  "Refresh now has run as often today as the cloud allows in a day. The nightly refreshes again tonight.";
export const GATE_BUSY = "Another refresh was starting at the same moment. Try again in a minute.";
/** Said where the first leg could not be queued, so the refresh was never started. */
export const NOT_QUEUED =
  "The cloud could not queue the refresh just now, so it was not started. Try again in a minute.";
/** Said on a job made for a press that another press, or the nightly, beat to the gate. */
const BEATEN = "Another refresh, or the nightly, began at the same moment; this one never ran.";

export type RefreshStarted =
  | { ok: true; jobId: string; status: PullJobStatus; already: boolean }
  | {
      ok: false;
      refusal: "failed-precondition" | "resource-exhausted" | "aborted" | "unavailable";
      message: string;
    };

export type StartRefreshDeps = {
  gate: GateDocs;
  jobs: Pick<JobDocs, "read" | "create" | "update">;
  enqueue: (task: LegTask) => Promise<void>;
  now: () => Date;
  /** A new job's id (`randomId`, 128 bits, as a device names a list's job). */
  newId: () => string;
};

/**
 * Starts "Refresh now" for a member's asking (`startPull` with `{ refresh }`), or hands back the
 * one already under way, whose device then watches it as its own. Refused while the nightly is
 * pulling, and once the day's legs are spent.
 *
 * The job is made before the gate is taken, and queued only once it is: the nightly, finding the
 * gate names a job, must find that job there to wait for, and a job whose press lost the gate to
 * another is ended where it stands, never run. A first leg that cannot be queued ends the job too,
 * and gives the day its leg back: left queued with no task to run it, the job would pass for one
 * under way for two hours, keeping a nightly in that time waiting its longest for nothing.
 */
export const startRefresh = async (
  ask: RefreshAsk,
  deps: StartRefreshDeps
): Promise<RefreshStarted> => {
  for (let tries = 0; tries < GATE_TRIES; tries += 1) {
    const now = deps.now();
    const { gate, token } = await readGate(deps.gate);
    if (gate.jobId) {
      const job = await deps.jobs.read(gate.jobId);
      if (job && refreshUnderWay(job, now)) {
        // A job made and named whose first leg never got queued is queued now; one queued
        // already under its name is not queued again.
        if (job.status === "queued") await deps.enqueue({ jobId: gate.jobId, leg: 0 });
        return { ok: true, jobId: gate.jobId, status: job.status, already: true };
      }
    }
    if (nightlyUnderWay(gate, now)) {
      return { ok: false, refusal: "failed-precondition", message: NIGHTLY_PULLING };
    }
    const day = budgetDay(now);
    const spent = gate.day === day ? gate.legs : 0;
    if (spent >= REFRESH_LEGS_A_DAY) {
      return { ok: false, refusal: "resource-exhausted", message: LEGS_SPENT };
    }
    const jobId = deps.newId();
    const stamp = now.toISOString();
    const job = newRefreshJob({ timeZone: REFRESH_ZONE, device: ask.device, now: stamp });
    if (!(await deps.jobs.create(jobId, job))) continue;
    const taken = await deps.gate.replace(
      REFRESH_GATE_PATH,
      { ...gate, jobId, day, legs: spent + 1 },
      token
    );
    if (!taken) {
      await deps.jobs.update(jobId, {
        status: "failed",
        error: BEATEN,
        updatedAt: deps.now().toISOString(),
      });
      continue;
    }
    try {
      await deps.enqueue({ jobId, leg: 0 });
    } catch {
      await notQueued(jobId, day, deps);
      return { ok: false, refusal: "unavailable", message: NOT_QUEUED };
    }
    return { ok: true, jobId, status: "queued", already: false };
  }
  return { ok: false, refusal: "aborted", message: GATE_BUSY };
};

/**
 * A started refresh whose first leg could not be queued, undone as far as it can be: the job ended,
 * so nothing takes it for one under way, and the leg it was charged given back to `day` while the
 * gate still names it. Each part once, and best done: a job a failed queueing did queue all the same
 * finds itself ended and runs nothing, and a gate that moved on keeps what it was moved to.
 */
const notQueued = async (jobId: string, day: string, deps: StartRefreshDeps): Promise<void> => {
  await deps.jobs
    .update(jobId, { status: "failed", error: NOT_QUEUED, updatedAt: deps.now().toISOString() })
    .catch(() => undefined);
  try {
    const { gate, token } = await readGate(deps.gate);
    if (gate.jobId === jobId && gate.day === day && gate.legs > 0) {
      await deps.gate.replace(REFRESH_GATE_PATH, { ...gate, legs: gate.legs - 1 }, token);
    }
  } catch {
    // The leg stays charged: the cost of a gate that cannot be read is a press, not a run.
  }
};

/**
 * Charges `legs` more legs to the day `now` falls in: a refresh's legs past its first, once its
 * first leg has worked out how many its teams take. Whether it could: legs that would take the day
 * past `REFRESH_LEGS_A_DAY` are not charged, and the refresh does not run them, since the press was
 * let through on one leg left and the cap is the day's whole spend, not its first legs'. Written
 * onto the gate as read, and read again where another writer moved it meanwhile; a gate that keeps
 * moving throws, and the leg is tried again, which charges it again rather than not at all.
 */
export const chargeRefreshLegs = async (
  docs: GateDocs,
  legs: number,
  now: Date
): Promise<boolean> => {
  const day = budgetDay(now);
  for (let tries = 0; tries < GATE_TRIES; tries += 1) {
    const { gate, token } = await readGate(docs);
    const spent = gate.day === day ? gate.legs : 0;
    if (spent + legs > REFRESH_LEGS_A_DAY) return false;
    if (await docs.replace(REFRESH_GATE_PATH, { ...gate, day, legs: spent + legs }, token)) {
      return true;
    }
  }
  throw new Error("The refresh's legs could not be counted against the day's: try again.");
};

export type NightlyTurn = {
  /** When the nightly took its turn, as the gate holds it, or null where it could not write it. */
  at: string | null;
  /** How long it waited for a refresh under way. */
  waitedMs: number;
  /** Whether it went ahead with a refresh still running, having waited its longest. */
  stillRunning: boolean;
};

/**
 * The nightly's turn at the copy: it waits for a "Refresh now" under way to end, looking every
 * `lookMs`, for at most `waitMs`, then names itself in the gate while it pulls, so a press meanwhile
 * is told the nightly is pulling. A refresh still running after the longest wait is let be, and the
 * nightly goes ahead beside it, which costs GameChanger the same teams twice and the copy nothing;
 * the night is not lost for a refresh that hangs. A gate that cannot be written is gone ahead
 * without, for the same reason.
 */
export const nightlyTakesTurn = async ({
  gate: docs,
  readJob,
  now,
  sleep,
  waitMs = NIGHTLY_WAIT_MS,
  lookMs = NIGHTLY_LOOK_MS,
}: {
  gate: GateDocs;
  readJob: (jobId: string) => Promise<PullJob | null>;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  waitMs?: number;
  lookMs?: number;
}): Promise<NightlyTurn> => {
  const started = now().getTime();
  const waited = () => now().getTime() - started;
  for (let tries = 0; tries < GATE_TRIES;) {
    const at = now();
    const { gate, token } = await readGate(docs);
    const job = gate.jobId ? await readJob(gate.jobId) : null;
    const running = refreshUnderWay(job, at);
    if (running && waited() < waitMs) {
      await sleep(lookMs);
      continue;
    }
    const stamp = at.toISOString();
    if (await docs.replace(REFRESH_GATE_PATH, { ...gate, nightlyAt: stamp }, token)) {
      return { at: stamp, waitedMs: waited(), stillRunning: running };
    }
    tries += 1;
  }
  return { at: null, waitedMs: waited(), stillRunning: false };
};

/**
 * The nightly done with its turn: the gate open to "Refresh now" again, if it still holds this
 * nightly's word and not a later one's. Once, and best done: a gate left holding it opens by
 * itself once `NIGHTLY_HOLD_MS` has passed.
 */
export const nightlyEndsTurn = async (docs: GateDocs, at: string): Promise<void> => {
  const { gate, token } = await readGate(docs);
  if (gate.nightlyAt !== at) return;
  await docs.replace(REFRESH_GATE_PATH, { ...gate, nightlyAt: null }, token);
};
