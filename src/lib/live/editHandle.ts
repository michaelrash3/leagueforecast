import type { PoolCommand } from "./commands";
import type { EditRefusal, EditRun } from "./editRun";
import type { PoolEnsure } from "./poolCache";
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
 * trigger queues a rebuild of the edit function's saves within a quarter of a minute
 * (`REBUILD_WINDOW_S.live`), on the rebuilds' own instance, under their ledger and switch.
 */

/** What a device asks: a command, and the copy it was made on. */
export type EditAsk = { command: PoolCommand; copy?: string };

/** What warming the pool came to: the copy read and how, or why it could not be. */
export type WarmResult =
  | { ok: true; cold: boolean; fetched: number; loadMs: number }
  | { ok: false; reason: Extract<PoolEnsure, { ok: false }>["reason"] };

/** The worker the edits run in, which keeps the pool from request to request. */
export type EditWorker = {
  edit: (ask: EditAsk) => Promise<EditRun>;
  warm: () => Promise<WarmResult>;
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

/** The deps both requests share. */
type Deps = {
  ledger: LedgerStore;
  /** New York's day. */
  today: () => string;
  clock: () => number;
  /** The instance's memory in GiB and its vCPUs, which its time is billed by. */
  size: { gib: number; cpu: number };
  /** Seconds the instance spent starting before this request, the first time; nothing after. */
  startupS: () => number;
};

/**
 * What `began` until now cost, charged to the ledger as an edit's compute; a charge that cannot be
 * written is said in the line rather than failing the request, whose work is done.
 */
const charge = async (
  { ledger, today, clock, size, startupS }: Deps,
  began: number,
  line: Record<string, string | number | boolean>
): Promise<void> => {
  const used = runCost((clock() - began) / 1000 + startupS(), size);
  line.gibs = used.gibs;
  try {
    await updateLedger(ledger, (current) => ({
      next: chargeEdit(current, today(), used),
      answer: null,
    }));
  } catch (error) {
    line.chargeError = error instanceof Error ? error.message : String(error);
  }
};

export const handleEdit = async ({
  ask,
  worker,
  ...deps
}: Deps & { ask: EditAsk; worker: Pick<EditWorker, "edit"> }): Promise<{
  reply: EditReply;
  line: Record<string, string | number | boolean>;
}> => {
  const began = deps.clock();
  let edited: EditRun | null = null;
  let thrown: unknown = null;
  try {
    edited = await worker.edit(ask);
  } catch (error) {
    thrown = error;
  }
  const line: Record<string, string | number | boolean> = { kind: ask.command.kind };
  await charge(deps, began, line);
  if (!edited) throw thrown;
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
 * since a cold start is the one costly thing it does.
 */
export const handleWarm = async ({
  worker,
  ...deps
}: Deps & { worker: Pick<EditWorker, "warm"> }): Promise<{
  warmed: WarmResult;
  line: Record<string, string | number | boolean>;
}> => {
  const began = deps.clock();
  let warmed: WarmResult | null = null;
  let thrown: unknown = null;
  try {
    warmed = await worker.warm();
  } catch (error) {
    thrown = error;
  }
  const line: Record<string, string | number | boolean> = { kind: "warm" };
  await charge(deps, began, line);
  if (!warmed) throw thrown;
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
