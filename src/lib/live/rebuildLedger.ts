import type { FirestoreRestDocuments } from "../cloud/firestoreRest";
import { isRecord } from "../validate";

/**
 * What the rebuilds may spend, and have spent, kept in one document (`ops/rebuild`) that no client
 * can read or write: the switch the owner turns them on and off with, the caps on what they spend
 * a day and a month, and the totals that count against them. The free tier is the budget, and the
 * $1 billing stop only a backstop behind this, so one bad day cannot spend a month's allowance.
 *
 * Every rebuild reserves the most a run can cost before it starts (`reserveRun`) and puts what it
 * cost in its place when it ends (`settleRun`). A run that never ends (killed for memory, timed
 * out, its instance lost) leaves its reservation charged and is counted as a failure by the next
 * reserve; failures in a row pause the rebuilds for the rest of the day. All of it is pure, so it
 * is tested; the document is read and written through `updateLedger`.
 */

/** A run's cost in GiB-seconds of memory and vCPU-seconds, as Cloud Run bills a function's time. */
export type RunCost = { gibs: number; vcpuS: number };

/** How long a run can last at most: a rebuild's 300 s timeout and 20 s of start-up. */
export const RUN_SPAN_S = 320;

/**
 * What a run may cost at most: its whole span at 8 GiB and two vCPUs. Charged whole when a run is
 * reserved, so the caps hold even for a run that never settles.
 */
export const RUN_CEILING: RunCost = { gibs: RUN_SPAN_S * 8, vcpuS: RUN_SPAN_S * 2 };

export type LedgerCaps = {
  /** GiB-seconds a New York day. */
  dayGiBs: number;
  /** GiB-seconds and vCPU-seconds a New York month. */
  monthGiBs: number;
  monthVcpuS: number;
  /** Failures in a row that pause the rebuilds until the next day. */
  failures: number;
};

/**
 * The caps where the document sets none. The month's are a third of Cloud Run's free 360,000
 * GiB-seconds and a sixth of its 180,000 vCPU-seconds, which the pulls and the proxy share; a day's
 * is a twelfth of the month's, so a month's spend takes at least twelve days of the worst kind.
 */
export const DEFAULT_CAPS: LedgerCaps = {
  dayGiBs: 10_000,
  monthGiBs: 120_000,
  monthVcpuS: 30_000,
  failures: 3,
};

/** The most any cap may be, whatever the document says: a typo cannot lift the guard. */
export const HARD_CAPS: LedgerCaps = {
  dayGiBs: 40_000,
  monthGiBs: 250_000,
  monthVcpuS: 125_000,
  failures: 10,
};

export type Ledger = {
  /** Whether rebuilds run at all. */
  on: boolean;
  /** `dry` builds everything and publishes nothing, which is how they first ship. */
  mode: "dry" | "live";
  /** Whether one worker is kept from run to run, or one started afresh for each. */
  warm: boolean;
  caps: LedgerCaps;
  /** The New York day `dayGiBs` counts, and the month (YYYY-MM) the month's totals count. */
  day: string;
  dayGiBs: number;
  month: string;
  monthGiBs: number;
  monthVcpuS: number;
  /** Failures since the last run that did not fail. */
  failures: number;
  /** The day the failures paused the rebuilds, which they stay paused for. */
  pausedDay: string | null;
  /**
   * The run reserved and not yet settled: when, on which day, what it was charged, and the queued
   * task it runs (the same on each of that task's tries; "" where it was not said).
   */
  open: { at: string; day: string; cost: RunCost; task: string } | null;
};

/** Where the ledger is kept: a path no rule opens, so only a server's key reads or writes it. */
export const REBUILD_LEDGER_PATH = "ops/rebuild";

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const isCost = (value: unknown): value is RunCost =>
  isRecord(value) && isCount(value.gibs) && isCount(value.vcpuS);

/**
 * The caps as set, each held to `HARD_CAPS`; a cap the document leaves out is the default. The
 * failures that pause are at least one, or the first run would find the rebuilds paused.
 */
const capsOf = (raw: unknown): LedgerCaps | null => {
  if (raw === undefined) return { ...DEFAULT_CAPS };
  if (!isRecord(raw)) return null;
  const caps = { ...DEFAULT_CAPS };
  for (const name of Object.keys(DEFAULT_CAPS) as (keyof LedgerCaps)[]) {
    const value = raw[name];
    if (value === undefined) continue;
    if (!isCount(value)) return null;
    caps[name] = Math.min(value, HARD_CAPS[name]);
  }
  caps.failures = Math.max(1, Math.floor(caps.failures));
  return caps;
};

/**
 * The ledger the document holds, or null where there is none or it is not one: read as off, so a
 * document nobody can read stops the rebuilds rather than letting them run unmetered. The owner
 * makes it in the console with only the switch (`{ on, mode, warm }`), and a field left out is
 * its default, the totals nothing spent; a field set to anything but what it holds is a ledger
 * this build cannot read.
 */
export const coerceLedger = (raw: unknown): Ledger | null => {
  if (!isRecord(raw) || typeof raw.on !== "boolean") return null;
  // Only a field left out is its default: one set to null is set, and to nothing a ledger holds.
  const given = <T>(value: unknown, fallback: T): unknown =>
    value === undefined ? fallback : value;
  const mode = given(raw.mode, "dry");
  if (mode !== "dry" && mode !== "live") return null;
  const warm = given(raw.warm, true);
  if (typeof warm !== "boolean") return null;
  const caps = capsOf(raw.caps);
  if (!caps) return null;
  const day = given(raw.day, "");
  const month = given(raw.month, "");
  if (typeof day !== "string" || typeof month !== "string") return null;
  const dayGiBs = given(raw.dayGiBs, 0);
  const monthGiBs = given(raw.monthGiBs, 0);
  const monthVcpuS = given(raw.monthVcpuS, 0);
  const failures = given(raw.failures, 0);
  if (!isCount(dayGiBs) || !isCount(monthGiBs) || !isCount(monthVcpuS)) return null;
  if (!isCount(failures) || !Number.isInteger(failures)) return null;
  const pausedDay = given(raw.pausedDay, null);
  if (pausedDay !== null && typeof pausedDay !== "string") return null;
  const held = given(raw.open, null);
  let open: Ledger["open"] = null;
  if (held !== null) {
    if (!isRecord(held) || typeof held.at !== "string" || typeof held.day !== "string") return null;
    if (!isCost(held.cost)) return null;
    const task = given(held.task, "");
    if (typeof task !== "string") return null;
    open = {
      at: held.at,
      day: held.day,
      cost: { gibs: held.cost.gibs, vcpuS: held.cost.vcpuS },
      task,
    };
  }
  return {
    on: raw.on,
    mode,
    warm,
    caps,
    day,
    dayGiBs,
    month,
    monthGiBs,
    monthVcpuS,
    failures,
    pausedDay,
    open,
  };
};

/** The ledger's fields as written, in one order, so two ledgers compare by their text. */
const fieldsOf = (ledger: Ledger): Record<string, unknown> => ({
  on: ledger.on,
  mode: ledger.mode,
  warm: ledger.warm,
  caps: {
    dayGiBs: ledger.caps.dayGiBs,
    monthGiBs: ledger.caps.monthGiBs,
    monthVcpuS: ledger.caps.monthVcpuS,
    failures: ledger.caps.failures,
  },
  day: ledger.day,
  dayGiBs: ledger.dayGiBs,
  month: ledger.month,
  monthGiBs: ledger.monthGiBs,
  monthVcpuS: ledger.monthVcpuS,
  failures: ledger.failures,
  pausedDay: ledger.pausedDay,
  open: ledger.open && {
    at: ledger.open.at,
    day: ledger.open.day,
    cost: { gibs: ledger.open.cost.gibs, vcpuS: ledger.open.cost.vcpuS },
    task: ledger.open.task,
  },
});

const monthOf = (day: string): string => day.slice(0, 7);

/** A failure counted, and the rebuilds paused for `today` once there are enough in a row. */
const failed = (ledger: Ledger, today: string): Ledger => {
  const failures = ledger.failures + 1;
  return {
    ...ledger,
    failures,
    pausedDay: failures >= ledger.caps.failures ? today : ledger.pausedDay,
  };
};

export type ReserveRefusal = "off" | "busy" | "failing" | "day-cap" | "month-cap";

/**
 * How far ahead of this clock another instance's may run, and its run still read as reserved
 * before this one: a minute, far more than two of Google's servers disagree by.
 */
const CLOCK_SKEW_MS = 60_000;

/**
 * Whether a run of queued `task` may start on `today` (New York's day) at `now`, and the ledger
 * with its ceiling charged and the run open. A refusal hands back the ledger to write where
 * reading it moved it on (a new day or month, or a run left open counted as failed), or null where
 * nothing is written.
 *
 * In order: off; another task's run reserved less than a run's span ago may still be going, so
 * this one is `busy` and that run is neither counted nor cleared (counting it would count a
 * failure that has not happened, and drop the settle it is still to make); a new day empties the
 * day's total and lifts a pause from an earlier day, and a new month empties the month's; a run
 * still open after that, or one of this same task (its earlier try, which the queue retries only
 * once it has ended), never settled, and counts as a failure with its ceiling left charged; a
 * pause for today refuses; then the caps, each with this run's ceiling.
 */
export const reserveRun = (
  ledger: Ledger | null,
  today: string,
  now: string,
  { ceiling = RUN_CEILING, task = "" }: { ceiling?: RunCost; task?: string } = {}
): { ok: true; next: Ledger } | { ok: false; why: ReserveRefusal; next: Ledger | null } => {
  if (!ledger || !ledger.on) return { ok: false, why: "off", next: null };
  const open = ledger.open;
  if (open && !(task !== "" && open.task === task)) {
    const age = Date.parse(now) - Date.parse(open.at);
    if (age > -CLOCK_SKEW_MS && age < RUN_SPAN_S * 1000) {
      return { ok: false, why: "busy", next: null };
    }
  }
  let next: Ledger = { ...ledger };
  if (next.day !== today) next = { ...next, day: today, dayGiBs: 0 };
  if (next.pausedDay !== null && next.pausedDay !== today) {
    next = { ...next, pausedDay: null, failures: 0 };
  }
  if (next.month !== monthOf(today)) {
    next = { ...next, month: monthOf(today), monthGiBs: 0, monthVcpuS: 0 };
  }
  if (next.open) next = { ...failed(next, today), open: null };
  if (next.pausedDay === today) return { ok: false, why: "failing", next };
  if (next.dayGiBs + ceiling.gibs > next.caps.dayGiBs) return { ok: false, why: "day-cap", next };
  if (
    next.monthGiBs + ceiling.gibs > next.caps.monthGiBs ||
    next.monthVcpuS + ceiling.vcpuS > next.caps.monthVcpuS
  ) {
    return { ok: false, why: "month-cap", next };
  }
  return {
    ok: true,
    next: {
      ...next,
      dayGiBs: next.dayGiBs + ceiling.gibs,
      monthGiBs: next.monthGiBs + ceiling.gibs,
      monthVcpuS: next.monthVcpuS + ceiling.vcpuS,
      open: { at: now, day: today, cost: { ...ceiling }, task },
    },
  };
};

/** What `seconds` of an instance of `gib` GiB and `cpu` vCPUs costs, rounded up to a whole unit. */
export const runCost = (seconds: number, size: { gib: number; cpu: number }): RunCost => ({
  gibs: Math.ceil(Math.max(0, seconds) * size.gib),
  vcpuS: Math.ceil(Math.max(0, seconds) * size.cpu),
});

/**
 * The ledger once the run reserved at `at` has ended: what it `used` in place of its ceiling, and
 * a failure counted or the failures cleared. Null where that run is no longer the open one, since
 * a later reserve has counted it as never settled (its ceiling stays charged) or the owner has
 * cleared it; nothing is then written.
 */
export const settleRun = (
  ledger: Ledger | null,
  run: { at: string; used: RunCost; failed: boolean; today: string }
): Ledger | null => {
  const open = ledger?.open;
  if (!ledger || !open || open.at !== run.at) return null;
  const swap = (total: number, charged: number, used: number) =>
    Math.max(0, total - charged) + used;
  let next: Ledger = { ...ledger, open: null };
  if (next.day === open.day) {
    next = { ...next, dayGiBs: swap(next.dayGiBs, open.cost.gibs, run.used.gibs) };
  }
  if (next.month === monthOf(open.day)) {
    next = {
      ...next,
      monthGiBs: swap(next.monthGiBs, open.cost.gibs, run.used.gibs),
      monthVcpuS: swap(next.monthVcpuS, open.cost.vcpuS, run.used.vcpuS),
    };
  }
  return run.failed ? failed(next, run.today) : { ...next, failures: 0 };
};

/** The ledger's document: its fields as read, and the token that writes it only if unchanged. */
export type LedgerStore = {
  read: () => Promise<{ raw: unknown; token: string | null }>;
  /** Writes `next` whole if the document is still at `token` (absent where null). */
  replace: (token: string | null, next: Ledger) => Promise<boolean>;
};

/** The ledger at `ops/rebuild` through Firestore's REST API. */
export const restLedgerStore = (
  docs: Pick<FirestoreRestDocuments, "readAt" | "replace">,
  path = REBUILD_LEDGER_PATH
): LedgerStore => ({
  read: async () => {
    const found = await docs.readAt(path);
    return found ? { raw: found.fields, token: found.token } : { raw: null, token: null };
  },
  replace: (token, next) => docs.replace(path, fieldsOf(next), token),
});

/**
 * Reads the ledger, and writes back what `step` makes of it only if nothing has written it since:
 * a second run reserving at the same moment, or the owner turning the switch, is read again and
 * `step` asked again, up to `tries` times, so two cannot both spend the same headroom. A step that
 * leaves the ledger as it was, or hands back none, writes nothing. A read or a write that throws
 * (Firestore busy for a moment) is tried again too, and only the last try's error is thrown: a
 * write that landed though its answer was lost is then read back, and `step` finds it there.
 */
export const updateLedger = async <T>(
  store: LedgerStore,
  step: (ledger: Ledger | null) => { next: Ledger | null; answer: T },
  tries = 3
): Promise<{ answer: T; wrote: boolean } | { contended: true }> => {
  let failure: { error: unknown } | null = null;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      const { raw, token } = await store.read();
      const ledger = coerceLedger(raw);
      const { next, answer } = step(ledger);
      if (!next) return { answer, wrote: false };
      if (ledger && JSON.stringify(fieldsOf(ledger)) === JSON.stringify(fieldsOf(next))) {
        return { answer, wrote: false };
      }
      if (await store.replace(token, next)) return { answer, wrote: true };
      failure = null;
    } catch (error) {
      failure = { error };
    }
  }
  if (failure) throw failure.error;
  return { contended: true };
};
