import { describe, expect, it, vi } from "vitest";
import type { EditRun } from "../editRun";
import {
  answerEdit,
  EDIT_CALL_S,
  EDIT_CONCURRENCY,
  EDIT_LIMIT_S,
  EDIT_RECYCLE_AT,
  EDIT_SIZE,
  EDIT_TIMEOUT_S,
  EDIT_WORKER_HEAP_MB,
  editRunner,
  TurnFailed,
  type EditPort,
  type EditRequest,
  type EditWorkerAnswer,
  type Turned,
} from "../editWorkerProtocol";
import { RECYCLE_AT } from "../rebuild";
import type { WorkerMemory } from "../rebuildWorkerProtocol";

/*
 * The edit function's worker, without a worker (`editWorkerProtocol.ts`): what it answers, and how
 * the main thread queues requests to it, keeps it, recycles it, or ends it.
 */

const EDITED: EditRun = {
  ok: true,
  copy: "c1",
  version: 8,
  inverse: { kind: "none" },
  changed: ["k"],
  tries: 1,
  cold: false,
  fetched: 0,
  loadMs: 1,
  applyMs: 1,
  commitMs: 1,
};
const SMALL: WorkerMemory = { heapUsedMb: 900.4, rssMb: 1_800.6, heapLimitMb: 5_168.2 };
const ASK = { command: { kind: "team.state", teamId: "B", state: "KY" } } as const;

/** Workers answering each request as `answer` says, counting the workers started and ended. */
const fakeWorkers = (answer: (request: EditRequest, worker: number) => EditWorkerAnswer | null) => {
  const started: number[] = [];
  const ended: number[] = [];
  const posted: EditRequest[] = [];
  const ports: Array<{ die: (error: Error & { code?: string }) => void }> = [];
  const spawn = (): EditPort => {
    const worker = started.length + 1;
    started.push(worker);
    let listeners: Parameters<EditPort["listen"]>[0] | null = null;
    ports.push({ die: (error) => listeners?.error(error) });
    return {
      post: (request) => {
        posted.push(request);
        const heard = answer(request, worker);
        if (heard) queueMicrotask(() => listeners?.answer(heard));
      },
      listen: (given) => {
        listeners = given;
      },
      terminate: async () => {
        ended.push(worker);
      },
    };
  };
  return { spawn, started, ended, posted, ports };
};

/** A worker that answers every request well, with `memory`. */
const answering =
  (memory: WorkerMemory = SMALL) =>
  (request: EditRequest): EditWorkerAnswer => {
    if (request.kind === "edit") return { kind: "edited", id: request.id, result: EDITED, memory };
    if (request.kind === "warm") {
      const result = { ok: true as const, cold: true, fetched: 9, loadMs: 5 };
      return { kind: "warmed", id: request.id, result, memory };
    }
    return { kind: "pong", id: request.id };
  };

/** A turn's result, or why the call never had one. */
const resultOf = <T>(turned: Turned<T>): T | string => (turned.ran ? turned.result : turned.why);

describe("the edit function's sizes", () => {
  it("fit a full line of calls inside a call's time, that inside the timeout, and the worker inside the instance", () => {
    expect(EDIT_CONCURRENCY * EDIT_LIMIT_S).toBeLessThanOrEqual(EDIT_CALL_S);
    expect(EDIT_CALL_S).toBeLessThan(EDIT_TIMEOUT_S);
    expect(EDIT_TIMEOUT_S).toBeLessThanOrEqual(540);
    expect(EDIT_SIZE).toEqual({ gib: 4, cpu: 2 });
    expect(EDIT_RECYCLE_AT.heapUsedMb).toBeLessThan(EDIT_WORKER_HEAP_MB);
    expect(EDIT_RECYCLE_AT.rssMb).toBeLessThan(EDIT_SIZE.gib * 1024);
    expect(EDIT_WORKER_HEAP_MB).toBeLessThan(EDIT_SIZE.gib * 1024);
  });
});

describe("the worker's answer", () => {
  it("is each request's result with the worker's memory, a request that threw, or a pong", async () => {
    const memory = () => SMALL;
    const edit = vi.fn(async () => EDITED);
    const warm = vi.fn(async () => ({ ok: false as const, reason: "no-copy" as const }));
    const deps = { edit, warm, memory };
    expect(await answerEdit({ kind: "edit", id: 1, ask: ASK }, deps)).toEqual({
      kind: "edited",
      id: 1,
      result: EDITED,
      memory: SMALL,
    });
    expect(edit).toHaveBeenCalledWith(ASK);
    expect(await answerEdit({ kind: "warm", id: 3 }, deps)).toMatchObject({
      kind: "warmed",
      result: { ok: false, reason: "no-copy" },
    });
    expect(await answerEdit({ kind: "ping", id: 4 }, deps)).toEqual({ kind: "pong", id: 4 });
    const threw = async (): Promise<EditRun> => {
      throw new Error("Firestore answered HTTP 503.");
    };
    expect(await answerEdit({ kind: "edit", id: 5, ask: ASK }, { ...deps, edit: threw })).toEqual({
      kind: "failed",
      id: 5,
      error: "Firestore answered HTTP 503.",
      memory: SMALL,
    });
  });
});

describe("the main thread's worker", () => {
  it("keeps one worker for the edits and the warm-ups between them", async () => {
    const workers = fakeWorkers(answering());
    const runner = editRunner({ spawn: workers.spawn });
    expect(resultOf(await runner.warm())).toEqual({ ok: true, cold: true, fetched: 9, loadMs: 5 });
    expect(await runner.edit(ASK)).toEqual({
      ran: true,
      result: EDITED,
      busyMs: expect.any(Number),
      memory: SMALL,
    });
    expect(resultOf(await runner.edit(ASK))).toEqual(EDITED);
    expect(workers.started).toEqual([1]);
    expect(workers.ended).toEqual([]);
    expect(workers.posted.map((request) => request.kind)).toEqual(["warm", "edit", "edit"]);
  });

  it("sends requests one at a time, in the order they came", async () => {
    const waiting: EditRequest[] = [];
    const ports: Array<(answer: EditWorkerAnswer) => void> = [];
    const runner = editRunner({
      spawn: () => {
        let listeners: Parameters<EditPort["listen"]>[0] | null = null;
        ports.push((answer) => listeners?.answer(answer));
        return {
          post: (request) => waiting.push(request),
          listen: (given) => {
            listeners = given;
          },
          terminate: async () => undefined,
        };
      },
    });
    const first = runner.edit(ASK);
    const second = runner.warm();
    for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
    // The warm-up waits on the edit, which the worker has not answered.
    expect(waiting.map((request) => request.kind)).toEqual(["edit"]);
    ports[0]?.(answering()(waiting[0]!));
    expect(resultOf(await first)).toEqual(EDITED);
    for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
    expect(waiting.map((request) => request.kind)).toEqual(["edit", "warm"]);
    ports[0]?.(answering()(waiting[1]!));
    expect(resultOf(await second)).toMatchObject({ ok: true, cold: true });
  });

  it("ends a worker that died, ran past its limit, or answered that a request threw", async () => {
    const timer: { up: (() => void) | null } = { up: null };
    const workers = fakeWorkers((request, worker) => {
      if (worker === 1) return { kind: "failed", id: request.id, error: "boom", memory: SMALL };
      if (worker === 2) return null;
      return answering()(request);
    });
    const runner = editRunner({
      spawn: workers.spawn,
      setTimer: (done) => {
        timer.up = done;
        return () => undefined;
      },
    });
    // A request the worker said threw: not lost, since an edit throws short of any save.
    await expect(runner.edit(ASK)).rejects.toMatchObject({ message: "boom", lost: false });
    const late = runner.edit(ASK);
    await Promise.resolve();
    await Promise.resolve();
    timer.up?.();
    // One that ran out of time: lost, the edit perhaps made.
    await expect(late).rejects.toMatchObject({
      message: `The edit ran past the ${EDIT_LIMIT_S} s it had.`,
      lost: true,
    });
    await expect(late).rejects.toBeInstanceOf(TurnFailed);
    expect(resultOf(await runner.edit(ASK))).toEqual(EDITED);
    expect(workers.started).toEqual([1, 2, 3]);
    expect(workers.ended).toEqual([1, 2]);
    // A worker that died is ended too, and the next request has a fresh one.
    const dying = runner.edit(ASK);
    workers.ports[2]?.die(Object.assign(new Error("gone"), { code: "ERR_WORKER_OUT_OF_MEMORY" }));
    await dying.catch(() => undefined);
  });

  it("takes no late answer to an earlier request for the one waiting", async () => {
    const stale: EditRun = { ok: false, why: "missing", tries: 1 };
    const runner = editRunner({
      spawn: () => {
        let listeners: Parameters<EditPort["listen"]>[0] | null = null;
        return {
          post: (request) => {
            // An answer to a request that ran past its limit arrives first, then this one's.
            queueMicrotask(() => {
              listeners?.answer({
                kind: "edited",
                id: request.id + 100,
                result: stale,
                memory: SMALL,
              });
              listeners?.answer(answering()(request));
            });
          },
          listen: (given) => {
            listeners = given;
          },
          terminate: async () => undefined,
        };
      },
    });
    expect(resultOf(await runner.edit(ASK))).toEqual(EDITED);
  });

  it("starts a fresh worker once the heap or the process has grown past the edit function's own recycle point", async () => {
    // The process's, past the edit function's point and well short of the rebuild's.
    expect(EDIT_RECYCLE_AT.rssMb + 1).toBeLessThan(RECYCLE_AT.rssMb);
    const grown: WorkerMemory[] = [
      { heapUsedMb: EDIT_RECYCLE_AT.heapUsedMb + 1, rssMb: 100, heapLimitMb: 1 },
      { heapUsedMb: 100, rssMb: EDIT_RECYCLE_AT.rssMb + 1, heapLimitMb: 1 },
    ];
    for (const memory of grown) {
      const workers = fakeWorkers(answering(memory));
      const runner = editRunner({ spawn: workers.spawn });
      await runner.edit(ASK);
      await runner.edit(ASK);
      expect([memory, workers.started, workers.ended]).toEqual([memory, [1, 2], [1, 2]]);
    }
    const atThePoint: WorkerMemory = { ...EDIT_RECYCLE_AT, heapLimitMb: 1 };
    const workers = fakeWorkers(answering(atThePoint));
    const runner = editRunner({ spawn: workers.spawn });
    await runner.edit(ASK);
    await runner.edit(ASK);
    expect(workers.started).toEqual([1]);
    expect(workers.ended).toEqual([]);
  });

  it("says a worker that ran out of memory did", async () => {
    const workers = fakeWorkers(() => null);
    const runner = editRunner({ spawn: workers.spawn });
    const asked = runner.edit(ASK);
    await Promise.resolve();
    workers.ports[0]?.die(Object.assign(new Error("heap"), { code: "ERR_WORKER_OUT_OF_MEMORY" }));
    await expect(asked).rejects.toMatchObject({
      message: "The edit ran out of memory in its worker.",
      lost: true,
    });
    expect(workers.ended).toEqual([1]);
  });

  it("sends no call whose caller went while it waited in line", async () => {
    const waiting: EditRequest[] = [];
    const ports: Array<(answer: EditWorkerAnswer) => void> = [];
    const runner = editRunner({
      spawn: () => {
        let listeners: Parameters<EditPort["listen"]>[0] | null = null;
        ports.push((answer) => listeners?.answer(answer));
        return {
          post: (request) => waiting.push(request),
          listen: (given) => {
            listeners = given;
          },
          terminate: async () => undefined,
        };
      },
    });
    const caller = new AbortController();
    const first = runner.edit(ASK);
    const second = runner.edit(ASK, { signal: caller.signal });
    for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
    caller.abort();
    ports[0]?.(answering()(waiting[0]!));
    expect(resultOf(await first)).toEqual(EDITED);
    expect(await second).toEqual({ ran: false, why: "gone" });
    expect(waiting).toHaveLength(1);
  });

  it("sends no call after its time is up, and ends a run at the time its call has left", async () => {
    vi.useFakeTimers();
    try {
      // Each edit takes fifty seconds, inside the limit; twelve come at once.
      const posted: number[] = [];
      const spawn = (): EditPort => {
        let listeners: Parameters<EditPort["listen"]>[0] | null = null;
        return {
          post: (request) => {
            posted.push(Date.now());
            setTimeout(() => listeners?.answer(answering()(request)), 50_000);
          },
          listen: (given) => {
            listeners = given;
          },
          terminate: async () => undefined,
        };
      };
      const runner = editRunner({ spawn, clock: () => Date.now() });
      const t0 = Date.now();
      const calls = Array.from({ length: 12 }, () =>
        runner.edit(ASK).then(
          (turned) => ({ end: turned.ran ? "made" : turned.why, at: Date.now() - t0 }),
          (error: unknown) => ({
            end: error instanceof TurnFailed && error.lost ? "lost" : "threw",
            at: Date.now() - t0,
          })
        )
      );
      await vi.advanceTimersByTimeAsync(700_000);
      const ends = await Promise.all(calls);
      // Ten fit in a call's time; the eleventh is cut short at it, and the twelfth never sent.
      expect(ends.map(({ end }) => end)).toEqual([...Array(10).fill("made"), "lost", "late"]);
      expect(posted.every((at) => at - t0 < EDIT_CALL_S * 1000)).toBe(true);
      expect(ends.every(({ at }) => at <= EDIT_CALL_S * 1000)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
