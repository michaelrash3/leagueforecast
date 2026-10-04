import type { PoolCommand } from "./commands";
import type { EditRefusal, EditRun } from "./editRun";
import type { PoolEnsure } from "./poolCache";
import { isRebuildFailure, type RebuildEnd, type RebuildResult } from "./rebuild";
import {
  chargeEdit,
  reserveRun,
  runCost,
  settleRun,
  updateLedger,
  type LedgerStore,
  type ReserveRefusal,
} from "./rebuildLedger";

/**
 * One request to the edit function, on its main thread, kept here, pure, so it is tested: the
 * function hands it the worker that holds the pool (`editWorkerProtocol.ts`) and the ledger.
 *
 * The edit runs first, whatever the ledger says: it is a member's change to the copy, and the
 * copy is the truth. Its compute is charged to the day's and month's totals the rebuilds are capped
 * by (`chargeEdit`). Then, if it changed the copy, the boards are published from the same warm pool
 * as a rebuild would publish them, under a reservation of a run like a rebuild's, so the switch, the
 * pause and the caps hold, and only one run at a time writes them. A publish the ledger refuses is
 * left to the rebuild the save itself asked for, which checks a server's save ten minutes on
 * (`REBUILD_SETTLE_S`), or to the night.
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
  publish: (asked: { dry: boolean }) => Promise<RebuildResult>;
  warm: () => Promise<WarmResult>;
};

/**
 * What became of the boards after an edit.
 * - `none`: the edit moved nothing, so there was nothing to publish.
 * - a rebuild's end (`published`, `current`, …): the publish ran, dry or live as the switch says.
 * - a reservation's refusal (`off`, `busy`, `failing`, the caps) or `contended`: it did not run.
 * - `unreachable`: the ledger could not be read or written to reserve it, so it did not run.
 * - `threw`: it ran and threw.
 */
export type EditPublish =
  "none" | RebuildEnd | ReserveRefusal | "contended" | "unreachable" | "threw";

/** What the device is told. */
export type EditReply =
  | {
      ok: true;
      copy: string;
      version: number;
      inverse: PoolCommand;
      changed: string[];
      publish: EditPublish;
      /** Whether that publish wrote the members' boards: a live one that wrote. */
      published: boolean;
      ms: { load: number; apply: number; commit: number; publish: number };
    }
  | { ok: false; why: EditRefusal };

export const handleEdit = async ({
  ask,
  ledger,
  worker,
  today,
  now,
  clock,
  size,
  startupS,
  runId = crypto.randomUUID(),
}: {
  ask: EditAsk;
  ledger: LedgerStore;
  worker: EditWorker;
  /** New York's day. */
  today: () => string;
  now: () => string;
  clock: () => number;
  /** The instance's memory in GiB and its vCPUs, which its time is billed by. */
  size: { gib: number; cpu: number };
  /** Seconds the instance spent starting before this request, the first time; nothing after. */
  startupS: () => number;
  /** This request, which tells its own reservation from another's. */
  runId?: string;
}): Promise<{ reply: EditReply; line: Record<string, string | number | boolean> }> => {
  const began = clock();
  let edited: EditRun | null = null;
  let thrown: unknown = null;
  try {
    edited = await worker.edit(ask);
  } catch (error) {
    thrown = error;
  }
  const editUsed = runCost((clock() - began) / 1000 + startupS(), size);
  const line: Record<string, string | number | boolean> = {
    kind: ask.command.kind,
    gibs: editUsed.gibs,
  };
  try {
    await updateLedger(ledger, (current) => ({
      next: chargeEdit(current, today(), editUsed),
      answer: null,
    }));
  } catch (error) {
    line.chargeError = error instanceof Error ? error.message : String(error);
  }
  if (!edited) throw thrown;
  if (!edited.ok) {
    return {
      reply: { ok: false, why: edited.why },
      line: { ...line, end: edited.why, tries: edited.tries },
    };
  }

  const { copy, version, inverse, changed, tries, cold, fetched, loadMs, applyMs, commitMs } =
    edited;
  Object.assign(line, { end: "edited", copy, version, changed: changed.length, tries, cold });
  Object.assign(line, { fetched, loadMs, applyMs, commitMs });
  const done = (publish: EditPublish, published: boolean, publishMs: number) => ({
    reply: {
      ok: true as const,
      copy,
      version,
      inverse,
      changed,
      publish,
      published,
      ms: { load: loadMs, apply: applyMs, commit: commitMs, publish: publishMs },
    },
    line: { ...line, publish, published, publishMs },
  });
  if (changed.length === 0) return done("none", false, 0);

  // The edit is in the copy by now, so nothing from here on may fail the request.
  const at = now();
  let reserved: Awaited<ReturnType<typeof updateLedger<ReturnType<typeof reserveRun>>>>;
  try {
    reserved = await updateLedger(ledger, (current) => {
      const answer = reserveRun(current, today(), at, {
        task: `edit:${copy}:${version}`,
        by: runId,
      });
      return { next: answer.next, answer };
    });
  } catch (error) {
    line.reserveError = error instanceof Error ? error.message : String(error);
    return done("unreachable", false, 0);
  }
  if ("contended" in reserved) return done("contended", false, 0);
  if (!reserved.answer.ok) return done(reserved.answer.why, false, 0);
  const { mode } = reserved.answer.next;
  line.mode = mode;

  const publishing = clock();
  let result: RebuildResult | null = null;
  try {
    result = await worker.publish({ dry: mode === "dry" });
  } catch (error) {
    line.publishError = error instanceof Error ? error.message : String(error);
  }
  const publishMs = clock() - publishing;
  const failed = result === null || isRebuildFailure(result.end);
  try {
    await updateLedger(ledger, (current) => ({
      next: settleRun(current, {
        at,
        by: runId,
        used: runCost(publishMs / 1000, size),
        failed,
        today: today(),
      }),
      answer: null,
    }));
  } catch (error) {
    line.settleError = error instanceof Error ? error.message : String(error);
  }
  const published = mode === "live" && result?.end === "published" && result.wrote === true;
  return done(result?.end ?? "threw", published, publishMs);
};

/**
 * A request to bring the pool up ahead of an edit, sent as an edit screen opens: the copy read into
 * the worker's pool, warm or afresh, and the time it took charged as an edit's is (`chargeEdit`),
 * since a cold start is the one costly thing it does.
 */
export const handleWarm = async ({
  ledger,
  worker,
  today,
  clock,
  size,
  startupS,
}: {
  ledger: LedgerStore;
  worker: Pick<EditWorker, "warm">;
  today: () => string;
  clock: () => number;
  size: { gib: number; cpu: number };
  startupS: () => number;
}): Promise<{ warmed: WarmResult; line: Record<string, string | number | boolean> }> => {
  const began = clock();
  let warmed: WarmResult | null = null;
  let thrown: unknown = null;
  try {
    warmed = await worker.warm();
  } catch (error) {
    thrown = error;
  }
  const used = runCost((clock() - began) / 1000 + startupS(), size);
  const line: Record<string, string | number | boolean> = { kind: "warm", gibs: used.gibs };
  try {
    await updateLedger(ledger, (current) => ({
      next: chargeEdit(current, today(), used),
      answer: null,
    }));
  } catch (error) {
    line.chargeError = error instanceof Error ? error.message : String(error);
  }
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
