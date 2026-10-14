/** A continuous ranking rebuild, outside the task function's five-minute HTTP window. */
import { randomUUID } from "node:crypto";
import process from "node:process";
import { Worker } from "node:worker_threads";
import { firestoreRestDocuments } from "../../src/lib/cloud/firestoreRest";
import { todayIsoDay } from "../../src/lib/date";
import { isRebuildFailure, type RebuildResult } from "../../src/lib/live/rebuild";
import { rebuildJobControl, REBUILD_JOB_LEASE_MS } from "../../src/lib/live/rebuildJobControl";
import {
  reserveRebuildJob,
  rebuildRetryAt,
  REBUILD_JOB_CLEANUP_S,
} from "../../src/lib/live/rebuildJobBudget";
import {
  coerceLedger,
  chargeEdit,
  restLedgerStore,
  runCost,
  settleRun,
  updateLedger,
  type ReserveRefusal,
} from "../../src/lib/live/rebuildLedger";
import { spacedTask, type RebuildTask } from "../../src/lib/live/rebuildPlan";
import {
  REBUILD_SIZE,
  REBUILD_STARTUP_S,
  REBUILD_WORKER_HEAP_MB,
  type RebuildAnswer,
} from "../../src/lib/live/rebuildWorkerProtocol";
import { enqueueRebuild, restAccess } from "./pullAccess";

process.env.TZ = "America/New_York";
const docs = firestoreRestDocuments(restAccess());
const ledger = restLedgerStore(docs);
const control = rebuildJobControl(docs);
const owner = randomUUID();
const meteringStarted = Date.now() - (process.uptime() + REBUILD_STARTUP_S) * 1000;
let charged = { gibs: 0, vcpuS: 0 };
const claimed = await control.claim(owner);
const log = (event: string, fields: Record<string, unknown> = {}) =>
  console.log(
    JSON.stringify({
      message: "rebuild",
      event,
      execution: process.env.CLOUD_RUN_EXECUTION,
      ...fields,
    })
  );

const unchargedCost = () => {
  const total = runCost(Math.max(60, (Date.now() - meteringStarted) / 1000), REBUILD_SIZE);
  return {
    total,
    used: {
      gibs: Math.max(0, total.gibs - charged.gibs),
      vcpuS: Math.max(0, total.vcpuS - charged.vcpuS),
    },
  };
};
const chargeOverhead = async () => {
  const { total, used } = unchargedCost();
  if (used.gibs === 0 && used.vcpuS === 0) return;
  await updateLedger(ledger, (current) => ({
    next: chargeEdit(current, todayIsoDay(), used),
    answer: null,
  }));
  charged = total;
};

if (!claimed) {
  log("rebuild-joined");
  await chargeOverhead();
} else {
  let worker: Worker | null = null;
  let beat: ReturnType<typeof setInterval> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastRenew = Date.now();
  let ticking = false;
  let budgetEnded = false;
  let lost = false;
  let switchedOff = false;
  let detail = "Checking ranking inputs";
  let wake: ((result: RebuildResult | Error) => void) | null = null;
  let reservation: { at: string; limiting: string } | null = null;
  let task: RebuildTask = claimed.task!;

  const defer = async (why: ReserveRefusal | "budget") => {
    const held = coerceLedger((await ledger.read()).raw);
    const due = rebuildRetryAt(why, todayIsoDay(), Date.now(), held);
    // Cloud Tasks accepts a schedule at most 30 days ahead. A month cap checks again after 29.
    const queued = new Date(Math.min(due.getTime(), Date.now() + 29 * 86400_000));
    await enqueueRebuild(await spacedTask(task, queued.getTime()));
    await control.defer(owner, queued, `Waiting for ${why}; queued for ${queued.toISOString()}`);
    log("rebuild-deferred", { why, until: queued.toISOString() });
  };
  const settle = async (failed: boolean | null) => {
    if (!reservation) return;
    if (timer) clearTimeout(timer);
    const held = reservation;
    // The one-minute minimum is charged once per execution, including its warm follow-up runs.
    const { total, used } = unchargedCost();
    const result = await updateLedger(ledger, (current) => ({
      next: settleRun(current, {
        at: held.at,
        by: owner,
        used,
        failed,
        today: todayIsoDay(),
        endedAt: new Date().toISOString(),
      }),
      answer: null,
    }));
    if (!("answer" in result) || !result.wrote)
      throw new Error("The rebuild's compute reservation could not be settled.");
    reservation = null;
    charged = total;
    log("rebuild-charged", { ...used, failed });
  };
  try {
    beat = setInterval(() => {
      if (Date.now() - lastRenew >= REBUILD_JOB_LEASE_MS - 20_000) {
        lost = true;
        void worker?.terminate();
        wake?.(new Error("The rebuild lost contact with its execution lease."));
        return;
      }
      if (ticking) return;
      ticking = true;
      void control
        .renew(owner, detail)
        .then(async (owned) => {
          if (!owned) {
            lost = true;
            void worker?.terminate();
            wake?.(new Error("Another execution owns the rebuild."));
            return;
          }
          lastRenew = Date.now();
          const held = coerceLedger((await ledger.read()).raw);
          if (!held?.on) {
            switchedOff = true;
            lost = true;
            void worker?.terminate();
            wake?.(new Error("The owner switched ranking rebuilds off."));
          }
        })
        .catch(() => undefined)
        .finally(() => {
          ticking = false;
        });
    }, 10_000);

    while (!lost) {
      const pending = await control.read();
      task = pending.task ?? task;
      const generation = pending.generation;
      const began = Date.now();
      const at = new Date(began).toISOString();
      const reserved = await updateLedger<ReturnType<typeof reserveRebuildJob>>(
        ledger,
        (current) => {
          if (current && current.open && current.open.by === owner && current.open.at === at)
            return {
              next: null,
              answer: {
                ok: true as const,
                next: current,
                spanS: current.open.cost.gibs / REBUILD_SIZE.gib,
                limiting:
                  current.monthGiBs + REBUILD_SIZE.gib > current.caps.monthGiBs ||
                  current.monthVcpuS + REBUILD_SIZE.cpu > current.caps.monthVcpuS
                    ? "month-cap"
                    : "day-cap",
              },
            };
          const answer = reserveRebuildJob(current, todayIsoDay(), at, owner);
          return { next: answer.next, answer };
        }
      );
      if (!("answer" in reserved)) throw new Error("The rebuild's budget kept changing.");
      if (!reserved.answer.ok) {
        if (reserved.answer.why === "off") await control.complete(owner, generation);
        else await defer(reserved.answer.why);
        break;
      }
      reservation = { at, limiting: reserved.answer.limiting };
      budgetEnded = false;
      const unpaidSeconds = Math.max(
        0,
        (Date.now() - meteringStarted) / 1000 - charged.gibs / REBUILD_SIZE.gib
      );
      const allowance = reserved.answer.spanS - unpaidSeconds - REBUILD_JOB_CLEANUP_S;
      timer = setTimeout(
        () => {
          budgetEnded = true;
          void worker?.terminate();
          wake?.(new Error("The reserved compute budget has been used."));
        },
        Math.max(0, allowance * 1000 - (Date.now() - began))
      );
      worker ??= new Worker(new URL("./rebuildWorker.js", import.meta.url), {
        workerData: { durable: true },
        resourceLimits: { maxOldGenerationSizeMb: REBUILD_WORKER_HEAP_MB },
      });
      const running = worker;
      const buildDay = todayIsoDay();
      const flags = coerceLedger((await ledger.read()).raw);
      const dry = flags?.mode === "dry";
      if (budgetEnded || lost) throw new Error("The rebuild stopped before its next step started.");
      log("rebuild-started", { generation, allowanceSeconds: Math.round(allowance), dry });
      const result = await new Promise<RebuildResult>((resolve, reject) => {
        wake = (result) => (result instanceof Error ? reject(result) : resolve(result));
        const message = (
          answer:
            | RebuildAnswer
            | { kind: "progress"; done: number; total: number; cached: boolean; half: string }
        ) => {
          if (answer.kind === "progress") {
            detail = `Building rankings: ${answer.done} of ${answer.total} year/season steps; ${answer.cached ? "reused" : "built"} ${answer.half}`;
            log("rebuild-progress", { ...answer });
          } else if (answer.kind === "ran") wake?.(answer.result);
          else if (answer.kind === "failed") wake?.(new Error(answer.error));
        };
        const error = (error: Error) => wake?.(error);
        const exit = (code: number) =>
          wake?.(new Error(`The ranking worker exited with code ${code}.`));
        running.on("message", message);
        running.once("error", error);
        running.once("exit", exit);
        running.postMessage({ kind: "run", id: generation, dry, deadline: Infinity });
        // Each run removes its listeners before a following run starts on the same warm pool.
        const original = wake;
        wake = (answer) => {
          running.off("message", message);
          running.off("error", error);
          running.off("exit", exit);
          wake = null;
          original?.(answer);
        };
      });
      log("rebuild-result", {
        ...result,
        kind: task.kind,
        savedAt: task.savedAt,
        mode: dry ? "dry" : "live",
        ...(result.end === "published" && result.wrote && !dry
          ? { publishedAt: new Date().toISOString() }
          : {}),
      });
      if (!flags?.warm) {
        await worker.terminate();
        worker = null;
      }
      if (result.end === "kept-moving" || result.end === "kept-changing") {
        // Concurrent saves are handled in this execution; they do not trip the failure pause.
        await settle(null);
        continue;
      }
      if (isRebuildFailure(result.end)) throw new Error(`The ranking rebuild ended ${result.end}.`);
      // Publish immediately, then use the paid startup minute to accept more saves on this pool.
      while (
        Date.now() - meteringStarted < 60_000 &&
        (await control.read()).generation === generation
      ) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(5000, 60_000 - (Date.now() - meteringStarted)))
        );
      }
      await settle(false);
      if (todayIsoDay() !== buildDay) continue;
      if (await control.complete(owner, generation)) break;
      detail = "Including saves received while rankings were being built";
    }
  } catch (error) {
    if (switchedOff) {
      await settle(null);
      await control.complete(owner, (await control.read()).generation);
      log("rebuild-off");
    } else if (budgetEnded) {
      const why = reservation?.limiting === "month-cap" ? "month-cap" : "day-cap";
      await settle(null);
      await defer(why);
    } else {
      await settle(lost ? null : true).catch((error) =>
        log("rebuild-settle-error", { error: String(error) })
      );
      log("rebuild-error", { error: String(error) });
      process.exitCode = 1;
    }
  } finally {
    if (timer) clearTimeout(timer);
    if (beat) clearInterval(beat);
    await worker?.terminate();
    await control.release(owner).catch(() => undefined);
    if (!reservation)
      await chargeOverhead().catch((error) =>
        log("rebuild-overhead-charge-error", { error: String(error) })
      );
  }
}
