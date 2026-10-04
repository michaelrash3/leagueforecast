import { describe, expect, it, vi } from "vitest";
import type { EditRun } from "../editRun";
import {
  answerEdit,
  EDIT_LIMIT_S,
  EDIT_SIZE,
  EDIT_TIMEOUT_S,
  editRunner,
  type EditPort,
  type EditRequest,
  type EditWorkerAnswer,
} from "../editWorkerProtocol";
import { RECYCLE_AT, type RebuildResult } from "../rebuild";
import {
  REBUILD_LIMIT_S,
  REBUILD_WORKER_HEAP_MB,
  type WorkerMemory,
} from "../rebuildWorkerProtocol";

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
const PUBLISHED: RebuildResult = { end: "published", retryable: false, tries: 1, wrote: true };
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
    if (request.kind === "publish") {
      return { kind: "published", id: request.id, result: PUBLISHED, memory };
    }
    if (request.kind === "warm") {
      const result = { ok: true as const, cold: true, fetched: 9, loadMs: 5 };
      return { kind: "warmed", id: request.id, result, memory };
    }
    return { kind: "pong", id: request.id };
  };

describe("the edit function's sizes", () => {
  it("leave an edit and a publish inside the timeout, and the worker inside the instance", () => {
    expect(EDIT_LIMIT_S + REBUILD_LIMIT_S).toBeLessThan(EDIT_TIMEOUT_S);
    expect(EDIT_TIMEOUT_S).toBeLessThanOrEqual(540);
    expect(RECYCLE_AT.rssMb).toBeLessThan(EDIT_SIZE.gib * 1024);
    expect(REBUILD_WORKER_HEAP_MB).toBeLessThan(EDIT_SIZE.gib * 1024);
  });
});

describe("the worker's answer", () => {
  it("is each request's result with the worker's memory, a request that threw, or a pong", async () => {
    const memory = () => SMALL;
    const edit = vi.fn(async () => EDITED);
    const publish = vi.fn(async () => PUBLISHED);
    const warm = vi.fn(async () => ({ ok: false as const, reason: "no-copy" as const }));
    const deps = { edit, publish, warm, memory };
    expect(await answerEdit({ kind: "edit", id: 1, ask: ASK }, deps)).toEqual({
      kind: "edited",
      id: 1,
      result: EDITED,
      memory: SMALL,
    });
    expect(edit).toHaveBeenCalledWith(ASK);
    expect(await answerEdit({ kind: "publish", id: 2, dry: true, deadline: 9 }, deps)).toEqual({
      kind: "published",
      id: 2,
      result: PUBLISHED,
      memory: SMALL,
    });
    expect(publish).toHaveBeenCalledWith({ dry: true, deadline: 9 });
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
  it("keeps one worker for the edits and the publishes after them", async () => {
    const workers = fakeWorkers(answering());
    const runner = editRunner({ spawn: workers.spawn, clock: () => 1_000 });
    expect(await runner.edit(ASK)).toEqual(EDITED);
    expect(await runner.publish({ dry: false })).toEqual({
      ...PUBLISHED,
      heapUsedMb: 900,
      rssMb: 1_801,
      heapLimitMb: 5_168,
    });
    expect(await runner.warm()).toEqual({ ok: true, cold: true, fetched: 9, loadMs: 5 });
    expect(workers.started).toEqual([1]);
    expect(workers.ended).toEqual([]);
    // The publish carries its pass deadline, from the clock.
    expect(workers.posted[1]).toMatchObject({ kind: "publish", dry: false });
    expect((workers.posted[1] as { deadline: number }).deadline).toBeGreaterThan(1_000);
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
    const second = runner.publish({ dry: true });
    for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
    // The publish waits on the edit, which the worker has not answered.
    expect(waiting.map((request) => request.kind)).toEqual(["edit"]);
    ports[0]?.(answering()(waiting[0]!));
    expect(await first).toEqual(EDITED);
    for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
    expect(waiting.map((request) => request.kind)).toEqual(["edit", "publish"]);
    ports[0]?.(answering()(waiting[1]!));
    expect(await second).toMatchObject({ end: "published" });
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
    await expect(runner.edit(ASK)).rejects.toThrow("boom");
    const late = runner.edit(ASK);
    await Promise.resolve();
    await Promise.resolve();
    timer.up?.();
    await expect(late).rejects.toThrow(`The edit ran past ${EDIT_LIMIT_S} s.`);
    expect(await runner.edit(ASK)).toEqual(EDITED);
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
    expect(await runner.edit(ASK)).toEqual(EDITED);
  });

  it("starts a fresh worker once the heap has grown past the recycle point", async () => {
    const big: WorkerMemory = { heapUsedMb: RECYCLE_AT.heapUsedMb + 1, rssMb: 100, heapLimitMb: 1 };
    const workers = fakeWorkers(answering(big));
    const runner = editRunner({ spawn: workers.spawn });
    await runner.edit(ASK);
    await runner.edit(ASK);
    expect(workers.started).toEqual([1, 2]);
    expect(workers.ended).toEqual([1, 2]);
  });

  it("says a worker that ran out of memory did", async () => {
    const workers = fakeWorkers(() => null);
    const runner = editRunner({ spawn: workers.spawn });
    const asked = runner.edit(ASK);
    await Promise.resolve();
    workers.ports[0]?.die(Object.assign(new Error("heap"), { code: "ERR_WORKER_OUT_OF_MEMORY" }));
    await expect(asked).rejects.toThrow("The edit ran out of memory in its worker.");
    expect(workers.ended).toEqual([1]);
  });
});
