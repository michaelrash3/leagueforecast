import type { EditAsk, QueryAsk, WarmResult } from "./editHandle";
import type { EditRun, QueryRun } from "./editRun";
import { shouldRecycle } from "./rebuild";
import type { WorkerMemory } from "./rebuildWorkerProtocol";

/**
 * What crosses between the edit function's main thread and the worker that holds the pool, and how
 * the main thread keeps that worker. Pure, so it is tested without a worker:
 * `functions/src/editWorker.ts` only wires `answerEdit` to the message port, and
 * `functions/src/index.ts` hands `editRunner` a way to start one.
 *
 * The worker keeps every part of the pool a command reads warm from request to request
 * (`createEditPool`), so an edit after the first fetches only what other saves moved. As the rebuild's
 * worker, nothing there empties the store but the pool itself, and a pool that is to go goes with
 * its worker.
 */

/**
 * The function's instance, as a run's cost is reckoned (`runCost`): half the rebuild's, since the
 * edits build no boards. On the 29 September 2026 pool, a process that brought the pool up cold and
 * made and undid one edit of each of eight kinds held at most 1.1 GB, where building every board
 * then took it to 2.6 GB and, build after build, 3.8 GB (`npm run live:bench -- --copy`, 4
 * October).
 */
export const EDIT_SIZE = { gib: 4, cpu: 2 } as const;

/**
 * The most the edit worker's heap may hold, in MiB: five times the most the edits above left it
 * holding (466 MB), for a pool that grows through the season, and below the instance's 4 GiB with
 * the main thread and the worker's buffers beside it.
 */
export const EDIT_WORKER_HEAP_MB = 2_560;

/**
 * When the edit worker is started afresh, as `RECYCLE_AT` says for the rebuild's: below its heap's
 * cap and the instance's memory, so a worker that grows is let go between edits rather than running
 * out in the middle of one.
 */
export const EDIT_RECYCLE_AT = { heapUsedMb: 2_048, rssMb: 3_072, runs: 200 } as const;

/** The function's timeout, after which the platform answers a caller still waiting. */
export const EDIT_TIMEOUT_S = 540;

/** How many calls the one instance takes at once, each waiting its turn for the worker. */
export const EDIT_CONCURRENCY = 8;

/**
 * How long a call may wait for its turn and run, in all: inside the timeout by enough for the
 * answer and the charge after it, so the platform never answers a caller whose edit is still to be
 * made. A call whose time is up before its turn is turned away unstarted, and a run is cut short at
 * it.
 */
export const EDIT_CALL_S = EDIT_TIMEOUT_S - 20;

/**
 * How long an edit may take in the worker before the main thread ends the worker and says so. On
 * the 29 September 2026 pool a cold start read every part in 1.4 s and the costliest edit, a merge,
 * took 4.5 s to apply and commit (`npm run live:bench`, 4 October), both in memory; Firestore adds
 * a round trip a read and the upload of the parts changed. A minute leaves a slow store a wide
 * berth, and keeps a full line, every call in it run to the limit, inside a call's time.
 */
export const EDIT_LIMIT_S = 60;

export type EditRequest =
  | { kind: "edit"; id: number; ask: EditAsk }
  | { kind: "query"; id: number; ask: QueryAsk }
  | { kind: "warm"; id: number }
  | { kind: "ping"; id: number };

export type EditWorkerAnswer =
  | { kind: "edited"; id: number; result: EditRun; memory: WorkerMemory }
  | { kind: "queried"; id: number; result: QueryRun; memory: WorkerMemory }
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
    query,
    warm,
    memory,
  }: {
    edit: (ask: EditAsk) => Promise<EditRun>;
    query: (ask: QueryAsk) => Promise<QueryRun>;
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
      case "query":
        return { kind: "queried", id, result: await query(request.ask), memory: memory() };
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

/** How a call stands in line: its caller's going (the request closed) turns it away unstarted. */
export type TurnAsk = { signal?: AbortSignal };

/**
 * What a call's turn came to: run, with how long it held the worker, which is what its compute is
 * reckoned by; or turned away before the worker had it, its caller gone or its time up.
 */
export type Turned<T> =
  | { ran: true; result: T; busyMs: number; memory: WorkerMemory }
  | { ran: false; why: "gone" | "late" };

/**
 * A turn that ended without its answer. `lost`: the worker died, ran past the time it had, or
 * answered out of turn, so an edit it was making may or may not be in the copy. Otherwise the worker
 * said the request threw, which an edit does only short of any save it cannot account for
 * (`runEdit`).
 */
export class TurnFailed extends Error {
  readonly busyMs: number;
  readonly lost: boolean;

  constructor(message: string, busyMs: number, lost: boolean) {
    super(message);
    this.name = "TurnFailed";
    this.busyMs = busyMs;
    this.lost = lost;
  }
}

type Outcome = { kind: "answer"; answer: EditWorkerAnswer } | { kind: "died"; error: string };

type Held = {
  port: EditPort;
  runs: number;
  dead: boolean;
  waiting: ((outcome: Outcome) => void) | null;
};

/** Requests without their id, which the runner gives each. */
type Asked = { kind: "edit"; ask: EditAsk } | { kind: "query"; ask: QueryAsk } | { kind: "warm" };

/** What each request is called in what the runner says of it. */
const ASKED_AS: Record<Asked["kind"], string> = {
  edit: "an edit",
  query: "a question",
  warm: "a warm-up",
};

/** The answer each request is due: any other, said by a worker that heard it, is out of turn. */
const ANSWERED_AS = { edit: "edited", query: "queried", warm: "warmed" } as const;

/**
 * The main thread's side: one worker, kept from request to request, and requests sent to it one at
 * a time in the order they came, since the function takes several at once and the pool is one. A
 * worker is ended, and the next request starts another (whose pool starts cold), when it died, ran
 * past its limit, answered that a request threw (which may have left its store part-written) or
 * answered anything but what the request was due, and when `shouldRecycle` says, at `EDIT_RECYCLE_AT`, that its heap or the process has grown too
 * far or it has run enough.
 *
 * Each call has `callS` from when it came: one whose caller has gone, or whose time is up, before
 * its turn is never sent, and a run has the least of its limit and the time its call has left.
 */
export const editRunner = ({
  spawn,
  limitS = EDIT_LIMIT_S,
  callS = EDIT_CALL_S,
  clock = () => performance.now(),
  setTimer = (done, ms) => {
    const timer = setTimeout(done, ms);
    return () => clearTimeout(timer);
  },
}: {
  spawn: () => EditPort;
  limitS?: number;
  callS?: number;
  /** A clock in ms for the turns' times and deadlines, which never steps back. */
  clock?: () => number;
  setTimer?: (done: () => void, ms: number) => () => void;
}): {
  edit: (ask: EditAsk, turn?: TurnAsk) => Promise<Turned<EditRun>>;
  query: (ask: QueryAsk, turn?: TurnAsk) => Promise<Turned<QueryRun>>;
  warm: (turn?: TurnAsk) => Promise<Turned<WarmResult>>;
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

  /**
   * One request, answered by the worker within `limitMs`, with how long the worker had it: the
   * worker ended, and the request failed, when it died, ran out of time, or threw.
   */
  const send = async (
    asked: Asked,
    limitMs: number
  ): Promise<{ answer: EditWorkerAnswer; busyMs: number }> => {
    if (held?.dead) await end(held);
    const worker = held ?? start();
    held = worker;
    const id = nextId;
    nextId += 1;
    const began = clock();
    const outcome = await new Promise<Outcome>((resolve) => {
      const cancel = setTimer(
        () =>
          resolve({
            kind: "died",
            error: `The ${asked.kind} ran past the ${Math.round(limitMs / 1000)} s it had.`,
          }),
        limitMs
      );
      worker.waiting = (heard) => {
        if (heard.kind === "answer" && heard.answer.id !== id) return;
        cancel();
        worker.waiting = null;
        resolve(heard);
      };
      worker.port.post({ ...asked, id });
    });
    const busyMs = clock() - began;
    if (outcome.kind === "died") {
      await end(worker);
      throw new TurnFailed(outcome.error, busyMs, true);
    }
    const { answer } = outcome;
    if (answer.kind !== ANSWERED_AS[asked.kind]) {
      await end(worker);
      throw answer.kind === "failed"
        ? new TurnFailed(answer.error, busyMs, false)
        : new TurnFailed(
            `The edit's worker answered ${answer.kind} to ${ASKED_AS[asked.kind]}.`,
            busyMs,
            true
          );
    }
    worker.runs += 1;
    if (shouldRecycle(answer.memory, worker.runs, EDIT_RECYCLE_AT)) await end(worker);
    return { answer, busyMs };
  };

  const inTurn = <T>(work: () => Promise<T>): Promise<T> => {
    const ran = line.then(work);
    line = ran.catch(() => undefined);
    return ran;
  };

  /** A call: its time starts now, and its turn comes when every call before it has had theirs. */
  const call = <T>(
    asked: Asked,
    { signal }: TurnAsk,
    read: (answer: EditWorkerAnswer) => T | null
  ): Promise<Turned<T>> => {
    const deadline = clock() + callS * 1000;
    return inTurn(async (): Promise<Turned<T>> => {
      if (signal?.aborted) return { ran: false, why: "gone" };
      const left = deadline - clock();
      if (left <= 0) return { ran: false, why: "late" };
      const { answer, busyMs } = await send(asked, Math.min(limitS * 1000, left));
      // `send` hands back only the answer the request is due, which `read` takes.
      const result = read(answer);
      if (result === null || answer.kind === "pong") {
        throw new TurnFailed(`The edit's worker answered ${answer.kind}.`, busyMs, true);
      }
      return { ran: true, result, busyMs, memory: answer.memory };
    });
  };

  return {
    edit: (ask, turn = {}) =>
      call({ kind: "edit", ask }, turn, (answer) =>
        answer.kind === "edited" ? answer.result : null
      ),
    query: (ask, turn = {}) =>
      call({ kind: "query", ask }, turn, (answer) =>
        answer.kind === "queried" ? answer.result : null
      ),
    warm: (turn = {}) =>
      call({ kind: "warm" }, turn, (answer) => (answer.kind === "warmed" ? answer.result : null)),
    stop: async () => {
      if (held) await end(held);
    },
  };
};
