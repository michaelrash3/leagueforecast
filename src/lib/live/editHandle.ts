import type { PoolCommand } from "./commands";
import type { EditRefusal, EditRun, QueryRefusal, QueryRun } from "./editRun";
import { TurnFailed, type TurnAsk, type Turned } from "./editWorkerProtocol";
import type { PoolEnsure } from "./poolCache";
import type { PoolQuery, QueryAnswer } from "./queries";
import { chargeEdit, runCost, updateLedger, type LedgerStore } from "./rebuildLedger";

/**
 * One request to the edit function, on its main thread, kept here, pure, so it is tested: the
 * function hands it the worker that holds the pool (`editWorkerProtocol.ts`) and the ledger.
 *
 * The edit runs whatever the ledger says: it is a member's change to the copy, and the copy is the
 * truth. Its compute is charged to the day's and month's totals the rebuilds are capped by
 * (`chargeEdit`), and the device is answered as soon as the save has landed. The boards are not
 * built here: every board of the real pool takes about half a minute (26 to 31 s on the 29
 * September 2026 pool, `npm run live:bench`), which a member would otherwise wait on, and which
 * would hold every edit queued behind it in the one worker. The save itself asks for them: the
 * trigger queues the rebuild of an edit function's save at once, run within a quarter of a minute
 * and never sooner than a minute after the last rebuild ended (`REBUILD_WINDOW_S.live`,
 * `LIVE_SPACING_S`), on the rebuilds' own instance, under their ledger and switch.
 */

/** What a device asks: a command, and the copy it was made on. */
export type EditAsk = { command: PoolCommand; copy?: string };

/** A question a device asks (`queries.ts`), and the copy it is about. */
export type QueryAsk = { query: PoolQuery; copy?: string };

/** What warming the pool came to: the copy read and how, or why it could not be. */
export type WarmResult =
  | { ok: true; cold: boolean; fetched: number; loadMs: number }
  | { ok: false; reason: Extract<PoolEnsure, { ok: false }>["reason"] };

/** The worker the edits run in, which keeps the pool from request to request. */
export type EditWorker = {
  edit: (ask: EditAsk, turn?: TurnAsk) => Promise<Turned<EditRun>>;
  query: (ask: QueryAsk, turn?: TurnAsk) => Promise<Turned<QueryRun>>;
  warm: (turn?: TurnAsk) => Promise<Turned<WarmResult>>;
};

/** What the device is told: the edit made, with what takes it back, or why it was not. */
export type EditReply =
  | {
      ok: true;
      copy: string;
      version: number;
      inverse: PoolCommand;
      changed: string[];
      ms: { load: number; apply: number; commit: number };
    }
  | { ok: false; why: EditRefusal };

/** What the device is told of a question: the answer, of which copy and version, or why none. */
export type QueryReply =
  | { ok: true; copy: string; version: number; answer: QueryAnswer }
  | { ok: false; why: QueryRefusal };

type Line = Record<string, string | number | boolean>;

/**
 * The instance's charges, one at a time in the order they came, so that two are never read off the
 * same ledger and the second written over the first.
 */
export type ChargeQueue = <T>(work: () => Promise<T>) => Promise<T>;

export const chargeQueue = (): ChargeQueue => {
  let line: Promise<unknown> = Promise.resolve();
  return (work) => {
    const ran = line.then(work);
    line = ran.catch(() => undefined);
    return ran;
  };
};

/**
 * How long an answer waits on its charge: the ledger is two round trips, and one that does not
 * answer is said in the line and left to finish behind the answer, which was never its to hold.
 */
export const CHARGE_WAIT_MS = 5_000;

/** The deps both requests share. */
type Deps = {
  ledger: LedgerStore;
  /** New York's day. */
  today: () => string;
  /** The instance's memory in GiB and its vCPUs, which its time is billed by. */
  size: { gib: number; cpu: number };
  /** Seconds the instance spent starting before this request, the first time; nothing after. */
  startupS: () => number;
  /** The instance's own queue of charges (`chargeQueue`). */
  charges: ChargeQueue;
  /** Resolves after `ms`: how long an answer waits on its charge (`CHARGE_WAIT_MS`). */
  wait?: (ms: number) => Promise<void>;
  /** The request's own end, the caller gone: a call not yet in the worker is then never sent. */
  signal?: AbortSignal;
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * `busyMs` of the worker, and the instance's start-up the first time, charged to the ledger as an
 * edit's compute. A call is charged for its own turn in the worker, not its wait in line: the
 * instance is billed once for the time its calls overlap, and the turns are what fill it. A charge
 * that cannot be written, or that the ledger is slow to take, is said in the line rather than
 * holding or failing the answer, whose work is done.
 */
const charge = async (
  { ledger, today, size, startupS, charges, wait = sleep }: Deps,
  busyMs: number,
  line: Line
): Promise<void> => {
  const used = runCost(busyMs / 1000 + startupS(), size);
  line.gibs = used.gibs;
  const charged = charges(async () => {
    const done = await updateLedger(ledger, (current) => ({
      next: chargeEdit(current, today(), used),
      answer: null,
    }));
    if ("contended" in done) throw new Error("Other writers had the ledger on every try.");
  }).then(
    () => null,
    (error: unknown) => messageOf(error)
  );
  const outcome = await Promise.race([
    charged,
    wait(CHARGE_WAIT_MS).then(() => "The ledger was slow; the charge was left to finish."),
  ]);
  if (outcome !== null) line.chargeError = outcome;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** What the device is told when no edit was made: the request was turned away before its turn. */
export const NOT_MADE = {
  gone: "The edit was not made: the call ended before its turn came.",
  late: "The edit was not made: the server was too busy to reach it in time. Try again in a minute.",
  threw: "The edit was not made: the server failed before saving it. Try again in a minute.",
} as const;

/**
 * What a request came to: the reply for the device, or that no edit was made, which the function
 * answers as an error (`aborted`) the device reads as not made; and the line it logs.
 */
export type EditHandled = { line: Line } & ({ reply: EditReply } | { notMade: string });

export const handleEdit = async ({
  ask,
  worker,
  ...deps
}: Deps & { ask: EditAsk; worker: Pick<EditWorker, "edit"> }): Promise<EditHandled> => {
  const line: Line = { kind: ask.command.kind };
  let turned: Turned<EditRun>;
  try {
    turned = await worker.edit(ask, deps.signal ? { signal: deps.signal } : {});
  } catch (error) {
    // A worker lost with the edit in its hands may have saved it; one that said the edit threw
    // stopped short of any save it could not account for, and anything else failed before the
    // worker had it.
    const failed = error instanceof TurnFailed ? error : null;
    await charge(deps, failed?.busyMs ?? 0, line);
    line.error = messageOf(error);
    if (failed?.lost)
      return { reply: { ok: false, why: "unsure" }, line: { ...line, end: "unsure" } };
    return { notMade: NOT_MADE.threw, line: { ...line, end: "threw" } };
  }
  await charge(deps, turned.ran ? turned.busyMs : 0, line);
  if (!turned.ran) return { notMade: NOT_MADE[turned.why], line: { ...line, end: turned.why } };
  const { result: edited, memory } = turned;
  Object.assign(line, {
    heapUsedMb: Math.round(memory.heapUsedMb),
    rssMb: Math.round(memory.rssMb),
    heapLimitMb: Math.round(memory.heapLimitMb),
  });
  if (!edited.ok) {
    return {
      reply: { ok: false, why: edited.why },
      line: { ...line, end: edited.why, tries: edited.tries },
    };
  }
  const { copy, version, inverse, changed, tries, cold, fetched, loadMs, applyMs, commitMs } =
    edited;
  return {
    reply: {
      ok: true,
      copy,
      version,
      inverse,
      changed,
      ms: { load: loadMs, apply: applyMs, commit: commitMs },
    },
    line: {
      ...line,
      end: "edited",
      copy,
      version,
      changed: changed.length,
      tries,
      cold,
      fetched,
      loadMs,
      applyMs,
      commitMs,
    },
  };
};

/**
 * A request to bring the pool up ahead of an edit, sent as an edit screen opens: the copy read into
 * the worker's pool, warm or afresh, and the time it took charged as an edit's is (`chargeEdit`),
 * since a cold start is the one costly thing it does. Null where it was turned away before its
 * turn, or the worker failed it: nothing rides on a warm-up, which the next edit does anyway.
 */
export const handleWarm = async ({
  worker,
  ...deps
}: Deps & { worker: Pick<EditWorker, "warm"> }): Promise<{
  warmed: WarmResult | null;
  line: Line;
}> => {
  const line: Line = { kind: "warm" };
  let turned: Turned<WarmResult>;
  try {
    turned = await worker.warm(deps.signal ? { signal: deps.signal } : {});
  } catch (error) {
    await charge(deps, error instanceof TurnFailed ? error.busyMs : 0, line);
    return { warmed: null, line: { ...line, end: "threw", error: messageOf(error) } };
  }
  await charge(deps, turned.ran ? turned.busyMs : 0, line);
  if (!turned.ran) return { warmed: null, line: { ...line, end: turned.why } };
  const warmed = turned.result;
  return {
    warmed,
    line: warmed.ok
      ? {
          ...line,
          end: "warmed",
          cold: warmed.cold,
          fetched: warmed.fetched,
          loadMs: warmed.loadMs,
        }
      : { ...line, end: warmed.reason },
  };
};

/** What the device is told when a question went unanswered: nothing was changed either way. */
export const NOT_ANSWERED =
  "The question could not be answered just now, and nothing was changed. Try again in a minute.";

/**
 * A question (`runQuery`), answered by the worker that keeps the pool, in its turn with the edits,
 * and charged as an edit is: it brings the pool up as one does. It changes nothing, so a turn that
 * failed, or never came, is only a question to ask again (`notAnswered`).
 */
export const handleQuery = async ({
  ask,
  worker,
  ...deps
}: Deps & { ask: QueryAsk; worker: Pick<EditWorker, "query"> }): Promise<
  { line: Line } & ({ reply: QueryReply } | { notAnswered: string })
> => {
  const line: Line = { kind: ask.query.kind };
  let turned: Turned<QueryRun>;
  try {
    turned = await worker.query(ask, deps.signal ? { signal: deps.signal } : {});
  } catch (error) {
    await charge(deps, error instanceof TurnFailed ? error.busyMs : 0, line);
    return { notAnswered: NOT_ANSWERED, line: { ...line, end: "threw", error: messageOf(error) } };
  }
  await charge(deps, turned.ran ? turned.busyMs : 0, line);
  if (!turned.ran) return { notAnswered: NOT_ANSWERED, line: { ...line, end: turned.why } };
  const { result: asked, memory } = turned;
  Object.assign(line, {
    heapUsedMb: Math.round(memory.heapUsedMb),
    rssMb: Math.round(memory.rssMb),
    heapLimitMb: Math.round(memory.heapLimitMb),
  });
  if (!asked.ok) return { reply: { ok: false, why: asked.why }, line: { ...line, end: asked.why } };
  const { copy, version, answer, cold, fetched, loadMs, answerMs } = asked;
  return {
    reply: { ok: true, copy, version, answer },
    line: { ...line, end: "answered", copy, version, cold, fetched, loadMs, answerMs },
  };
};
