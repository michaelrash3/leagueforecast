import type { EditAsk, WarmResult } from "./editHandle";
import type { EditRun } from "./editRun";
import { shouldRecycle } from "./rebuild";
import type { WorkerMemory } from "./rebuildWorkerProtocol";

/**
 * What crosses between the edit function's main thread and the worker that holds the pool, and how
 * the main thread keeps that worker. Pure, so it is tested without a worker:
 * `functions/src/editWorker.ts` only wires `answerEdit` to the message port, and
 * `functions/src/index.ts` hands `editRunner` a way to start one.
 *
 * The worker keeps every part of the pool warm from request to request (`createPoolCache` with
 * `everyPart`), so an edit after the first fetches only what other saves moved. As the rebuild's
 * worker, nothing there empties the store but the pool itself, and a pool that is to go goes with
 * its worker.
 */

/** The function's instance, as a run's cost is reckoned (`runCost`). */
export const EDIT_SIZE = { gib: 8, cpu: 2 } as const;

/** The function's timeout: room for a cold edit behind a few queued ahead of it. */
export const EDIT_TIMEOUT_S = 540;

/**
 * How long an edit may take in the worker before the main thread ends the worker and says so. On
 * the 29 September 2026 pool a cold start read every part in 1.3 s and the costliest edit, a merge,
 * took 4.7 s to apply and commit (`npm run live:bench`, 4 October), both in memory; Firestore adds
 * a round trip a read and the upload of the parts changed, so this leaves a slow store a wide berth.
 */
export const EDIT_LIMIT_S = 120;

export type EditRequest =
  | { kind: "edit"; id: number; ask: EditAsk }
  | { kind: "warm"; id: number }
  | { kind: "ping"; id: number };

export type EditWorkerAnswer =
  | { kind: "edited"; id: number; result: EditRun; memory: WorkerMemory }
  | { kind: "warmed"; id: number; result: WarmResult; memory: WorkerMemory }
  | { kind: "failed"; id: number; error: string; memory: WorkerMemory }
  | { kind: "pong"; id: number };

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** The worker's side of one request, with its memory read in the worker as it ends. */
export const answerEdit = async (
  request: EditRequest,
  {
    edit,
    warm,
    memory,
  }: {
    edit: (ask: EditAsk) => Promise<EditRun>;
    warm: () => Promise<WarmResult>;
    memory: () => WorkerMemory;
  }
): Promise<EditWorkerAnswer> => {
  const { id } = request;
  try {
    switch (request.kind) {
      case "ping":
        return { kind: "pong", id };
      case "edit":
        return { kind: "edited", id, result: await edit(request.ask), memory: memory() };
      case "warm":
        return { kind: "warmed", id, result: await warm(), memory: memory() };
    }
  } catch (error) {
    return { kind: "failed", id, error: messageOf(error), memory: memory() };
  }
};

/** What the main thread needs of a worker; Node's `Worker` gives all of it. */
export type EditPort = {
  post: (request: EditRequest) => void;
  /** Hears each answer, an error the worker died of, and the worker's end. */
  listen: (listeners: {
    answer: (answer: EditWorkerAnswer) => void;
    error: (error: Error & { code?: string }) => void;
    exit: (code: number) => void;
  }) => void;
  terminate: () => Promise<void>;
};

type Outcome = { kind: "answer"; answer: EditWorkerAnswer } | { kind: "died"; error: string };

type Held = {
  port: EditPort;
  runs: number;
  dead: boolean;
  waiting: ((outcome: Outcome) => void) | null;
};

/** Requests without their id, which the runner gives each. */
type Asked = { kind: "edit"; ask: EditAsk } | { kind: "warm" };

/**
 * The main thread's side: one worker, kept from request to request, and requests sent to it one at
 * a time in the order they came, since the function takes several at once and the pool is one. A
 * worker is ended, and the next request starts another (whose pool starts cold), when it died, ran
 * past its limit, or answered that a request threw (which may have left its store part-written),
 * and when `shouldRecycle` says its heap or the process has grown too far or it has run enough.
 */
export const editRunner = ({
  spawn,
  limitS = EDIT_LIMIT_S,
  setTimer = (done, ms) => {
    const timer = setTimeout(done, ms);
    return () => clearTimeout(timer);
  },
}: {
  spawn: () => EditPort;
  limitS?: number;
  setTimer?: (done: () => void, ms: number) => () => void;
}): {
  edit: (ask: EditAsk) => Promise<EditRun>;
  warm: () => Promise<WarmResult>;
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
              ? "The edit ran out of memory in its worker."
              : messageOf(error),
        });
      },
      exit: (code) => {
        worker.dead = true;
        tell({
          kind: "died",
          error: `The edit's worker stopped (exit ${code}) without an answer.`,
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

  /** One request, answered by the worker: ended and thrown when it died or the request threw. */
  const send = async (asked: Asked): Promise<EditWorkerAnswer> => {
    if (held?.dead) await end(held);
    const worker = held ?? start();
    held = worker;
    const id = nextId;
    nextId += 1;
    const outcome = await new Promise<Outcome>((resolve) => {
      const cancel = setTimer(
        () => resolve({ kind: "died", error: `The ${asked.kind} ran past ${limitS} s.` }),
        limitS * 1000
      );
      worker.waiting = (heard) => {
        if (heard.kind === "answer" && heard.answer.id !== id) return;
        cancel();
        worker.waiting = null;
        resolve(heard);
      };
      worker.port.post({ ...asked, id });
    });
    if (outcome.kind === "died") {
      await end(worker);
      throw new Error(outcome.error);
    }
    const { answer } = outcome;
    if (answer.kind === "failed" || answer.kind === "pong") {
      await end(worker);
      throw new Error(
        answer.kind === "failed" ? answer.error : "The edit's worker answered a ping."
      );
    }
    worker.runs += 1;
    if (shouldRecycle(answer.memory, worker.runs)) await end(worker);
    return answer;
  };

  const inTurn = <T>(work: () => Promise<T>): Promise<T> => {
    const ran = line.then(work);
    line = ran.catch(() => undefined);
    return ran;
  };

  const wrong = (answer: EditWorkerAnswer, wanted: string) =>
    new Error(`The edit's worker answered ${answer.kind} to ${wanted}.`);

  return {
    edit: (ask) =>
      inTurn(async () => {
        const answer = await send({ kind: "edit", ask });
        if (answer.kind !== "edited") throw wrong(answer, "an edit");
        return answer.result;
      }),
    warm: () =>
      inTurn(async () => {
        const answer = await send({ kind: "warm" });
        if (answer.kind !== "warmed") throw wrong(answer, "a warm-up");
        return answer.result;
      }),
    stop: async () => {
      if (held) await end(held);
    },
  };
};
