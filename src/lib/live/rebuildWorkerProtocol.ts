import { shouldRecycle, type RebuildResult } from "./rebuild";

/**
 * What crosses between the rebuild function's main thread and the worker it builds the boards in,
 * and how the main thread keeps that worker. Pure, so it is tested without a worker:
 * `functions/src/rebuildWorker.ts` only wires `answerRebuild` to the message port, and
 * `functions/src/index.ts` hands `rebuildRunner` a way to start one.
 *
 * The worker holds the pool (`createPoolCache`) from run to run while the ledger says warm, so a
 * rebuild after a small save fetches only the pieces that moved. That pool is the worker's own
 * module store, and nothing there may empty the store but the pool itself: emptied under it, the
 * pool still names the copy it loaded, and the next run on an unchanged copy builds from nothing
 * and publishes boards of no one (seen in a test of exactly that, which took every board view
 * out of `live/meta`). So a pool that is to go goes with its worker, which is ended, never
 * cleared.
 */

/** The function's instance, as the ledger prices a run of it (`RUN_CEILING`). */
export const REBUILD_SIZE = { gib: 8, cpu: 2 } as const;

/** The function's timeout, which with its start-up makes a run's span (`RUN_SPAN_S`). */
export const REBUILD_TIMEOUT_S = 300;

/**
 * The start-up a run's span allows beside the timeout (`RUN_SPAN_S`), and the most of an instance's
 * start-up charged to its first run (`startupCharge`).
 */
export const REBUILD_STARTUP_S = 20;

/**
 * How long the queue waits on a dispatched rebuild before taking it for failed and trying it again.
 * The function answers first: at its timeout the request is ended and the queue counts that try
 * failed then, while the run may still be going on the instance. What keeps a second try off a run
 * still going is the worker's limit (`REBUILD_LIMIT_S`), which ends the run inside the timeout, and
 * the ledger's busy window (`RUN_SPAN_S`). This deadline matters only for an answer lost on its
 * way, and is set past the timeout so that it never cuts a run short.
 */
export const REBUILD_DISPATCH_S = 600;

/**
 * How long a run may take in its worker before the main thread ends the worker and settles the run
 * as one that threw: inside the timeout by enough for the settle to be written.
 */
export const REBUILD_LIMIT_S = 270;

/**
 * How long into a run a second pass may still start, when the New York day turned under the first
 * (`runRebuild`'s deadline). One pass on the real pool is a load of a few seconds and a build of
 * about seven; this leaves a slow pass time to finish inside `REBUILD_LIMIT_S`.
 */
export const REBUILD_PASS_S = 150;

/**
 * The most the worker's heap may hold, in MiB: above where `shouldRecycle` starts a fresh worker,
 * so a heap that grows is recycled rather than run out of memory, and below the instance's 8 GiB
 * with the rest of the process beside it. A warm pool and a build peaked at 2.4 GB. A process
 * started with its own `--max-old-space-size` has that limit stand over a worker's (measured on
 * Node 22: a worker capped at 64 MB was given the flag's 8,192), so each run reports the limit its
 * worker ran under (`heapLimitMb`), and the first runs show which holds.
 */
export const REBUILD_WORKER_HEAP_MB = 5_120;

/** A run, or a ping that answers without reading anything (the smoke test's). */
export type RebuildRequest =
  { kind: "run"; id: number; dry: boolean; deadline: number } | { kind: "ping"; id: number };

/**
 * The worker's own heap and the process's resident size, in MiB, as `shouldRecycle` reads them, and
 * the most the worker's heap may grow to.
 */
export type WorkerMemory = { heapUsedMb: number; rssMb: number; heapLimitMb: number };

export type RebuildAnswer =
  | { kind: "ran"; id: number; result: RebuildResult; memory: WorkerMemory }
  | { kind: "failed"; id: number; error: string; memory: WorkerMemory }
  | { kind: "pong"; id: number };

/**
 * Bytes as `process.memoryUsage()` gives them, with the heap's limit as `v8.getHeapStatistics()`
 * gives it, in the MiB `shouldRecycle` reads.
 */
export const memoryOf = ({
  heapUsed,
  rss,
  heapLimit,
}: {
  heapUsed: number;
  rss: number;
  heapLimit: number;
}): WorkerMemory => ({
  heapUsedMb: heapUsed / 2 ** 20,
  rssMb: rss / 2 ** 20,
  heapLimitMb: heapLimit / 2 ** 20,
});

/**
 * What an instance's start-up costs its first run: the time its code took to load (`loadedS`, the
 * process's age once the module has loaded), at most the start-up a run's span allows, and nothing
 * after. Not the process's age at the first task: an instance a deploy started may sit idle for
 * many minutes first, which is not billed, and would otherwise be charged to the ledger.
 */
export const startupCharge = (loadedS: number): (() => number) => {
  let left = Math.min(Math.max(0, loadedS), REBUILD_STARTUP_S);
  return () => {
    const charged = left;
    left = 0;
    return charged;
  };
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * The worker's side of one request: the run, and the worker's memory read in the worker as it
 * ends, since the main thread's heap is not the worker's.
 */
export const answerRebuild = async (
  request: RebuildRequest,
  {
    run,
    memory,
  }: {
    run: (asked: { dry: boolean; deadline: number }) => Promise<RebuildResult>;
    memory: () => WorkerMemory;
  }
): Promise<RebuildAnswer> => {
  if (request.kind === "ping") return { kind: "pong", id: request.id };
  try {
    const result = await run({ dry: request.dry, deadline: request.deadline });
    return { kind: "ran", id: request.id, result, memory: memory() };
  } catch (error) {
    return { kind: "failed", id: request.id, error: messageOf(error), memory: memory() };
  }
};

/** What the main thread needs of a worker; Node's `Worker` gives all of it. */
export type RebuildPort = {
  post: (request: RebuildRequest) => void;
  /** Hears each answer, an error the worker died of, and the worker's end. */
  listen: (listeners: {
    answer: (answer: RebuildAnswer) => void;
    error: (error: Error & { code?: string }) => void;
    exit: (code: number) => void;
  }) => void;
  terminate: () => Promise<void>;
};

type Outcome = { kind: "answer"; answer: RebuildAnswer } | { kind: "died"; error: string };

type Held = {
  port: RebuildPort;
  runs: number;
  dead: boolean;
  /** The run waiting on this worker, if one is. */
  waiting: ((outcome: Outcome) => void) | null;
};

/**
 * The main thread's side: one worker kept from run to run while the ledger says warm, started
 * afresh for every run while it says not. A worker is ended, and the next run starts another, when
 * the ledger turns warm off, when its run threw or it died, when it ran past `limitS`, and when
 * `shouldRecycle` says its heap or the process has grown too far or it has run enough. Runs go
 * one at a time, as the function takes one task at a time; an answer to any request but the one
 * waiting is not taken for it.
 */
export const rebuildRunner = ({
  spawn,
  clock = Date.now,
  passS = REBUILD_PASS_S,
  limitS = REBUILD_LIMIT_S,
  setTimer = (done, ms) => {
    const timer = setTimeout(done, ms);
    return () => clearTimeout(timer);
  },
}: {
  spawn: () => RebuildPort;
  clock?: () => number;
  passS?: number;
  limitS?: number;
  /** Calls `done` after `ms`, and hands back what cancels it. */
  setTimer?: (done: () => void, ms: number) => () => void;
}): {
  run: (asked: { dry: boolean; warm: boolean }) => Promise<RebuildResult>;
  stop: () => Promise<void>;
} => {
  let held: Held | null = null;
  let nextId = 1;
  let line: Promise<unknown> = Promise.resolve();

  const start = (): Held => {
    const worker: Held = { port: spawn(), runs: 0, dead: false, waiting: null };
    const tell = (outcome: Outcome) => worker.waiting?.(outcome);
    worker.port.listen({
      answer: (answer) => tell({ kind: "answer", answer }),
      error: (error) => {
        worker.dead = true;
        tell({
          kind: "died",
          error:
            error.code === "ERR_WORKER_OUT_OF_MEMORY"
              ? "The rebuild ran out of memory in its worker."
              : messageOf(error),
        });
      },
      exit: (code) => {
        worker.dead = true;
        tell({
          kind: "died",
          error: `The rebuild's worker stopped (exit ${code}) without an answer.`,
        });
      },
    });
    return worker;
  };

  const end = async (worker: Held): Promise<void> => {
    if (held === worker) held = null;
    worker.dead = true;
    worker.waiting = null;
    await worker.port.terminate();
  };

  const once = async ({ dry, warm }: { dry: boolean; warm: boolean }): Promise<RebuildResult> => {
    // Not warm: every run has a worker, and a pool, of its own.
    if (held && (held.dead || !warm)) await end(held);
    const worker = held ?? start();
    held = worker;
    const id = nextId;
    nextId += 1;
    const outcome = await new Promise<Outcome>((resolve) => {
      const cancel = setTimer(
        () => resolve({ kind: "died", error: `The rebuild ran past ${limitS} s in its worker.` }),
        limitS * 1000
      );
      worker.waiting = (heard) => {
        if (heard.kind === "answer" && heard.answer.id !== id) return;
        cancel();
        worker.waiting = null;
        resolve(heard);
      };
      worker.port.post({ kind: "run", id, dry, deadline: clock() + passS * 1000 });
    });
    if (outcome.kind === "died") {
      await end(worker);
      throw new Error(outcome.error);
    }
    const { answer } = outcome;
    if (answer.kind !== "ran") {
      await end(worker);
      throw new Error(
        answer.kind === "failed" ? answer.error : "The rebuild's worker answered a ping."
      );
    }
    worker.runs += 1;
    if (!warm || shouldRecycle(answer.memory, worker.runs)) await end(worker);
    return {
      ...answer.result,
      heapUsedMb: Math.round(answer.memory.heapUsedMb),
      rssMb: Math.round(answer.memory.rssMb),
      heapLimitMb: Math.round(answer.memory.heapLimitMb),
    };
  };

  return {
    run: (asked) => {
      const ran = line.then(() => once(asked));
      line = ran.catch(() => undefined);
      return ran;
    },
    stop: async () => {
      if (held) await end(held);
    },
  };
};
