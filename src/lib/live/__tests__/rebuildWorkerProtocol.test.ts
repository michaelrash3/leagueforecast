import { describe, expect, it, vi } from "vitest";
import { RECYCLE_AT, type RebuildResult } from "../rebuild";
import { RUN_CEILING, RUN_SPAN_S } from "../rebuildLedger";
import {
  answerRebuild,
  memoryOf,
  REBUILD_DISPATCH_S,
  REBUILD_LIMIT_S,
  REBUILD_PASS_S,
  REBUILD_SIZE,
  REBUILD_TIMEOUT_S,
  REBUILD_WORKER_HEAP_MB,
  rebuildRunner,
  type RebuildAnswer,
  type RebuildPort,
  type RebuildRequest,
  type WorkerMemory,
} from "../rebuildWorkerProtocol";

/*
 * The rebuild function's worker, without a worker (`rebuildWorkerProtocol.ts`): what it answers,
 * and when the main thread keeps it, recycles it, or ends it.
 */

const PUBLISHED: RebuildResult = { end: "published", retryable: false, tries: 1, wrote: true };
const SMALL: WorkerMemory = { heapUsedMb: 900, rssMb: 1_800 };

/** A worker that answers each run as `answer` says, counting the workers started and ended. */
const fakeWorkers = (
  answer: (
    request: Extract<RebuildRequest, { kind: "run" }>,
    worker: number
  ) => RebuildAnswer | null
) => {
  const started: number[] = [];
  const ended: number[] = [];
  const posted: RebuildRequest[] = [];
  const ports: Array<{
    die: (error: Error & { code?: string }) => void;
    exit: (code: number) => void;
    reply: (answer: RebuildAnswer) => void;
  }> = [];
  const spawn = (): RebuildPort => {
    const worker = started.length + 1;
    started.push(worker);
    let listeners: Parameters<RebuildPort["listen"]>[0] | null = null;
    ports.push({
      die: (error) => listeners?.error(error),
      exit: (code) => listeners?.exit(code),
      reply: (heard) => listeners?.answer(heard),
    });
    return {
      post: (request) => {
        posted.push(request);
        if (request.kind !== "run") return;
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

const ran = (id: number, memory: WorkerMemory = SMALL, result = PUBLISHED): RebuildAnswer => ({
  kind: "ran",
  id,
  result,
  memory,
});

describe("the rebuild function's sizes", () => {
  it("are the ones the ledger prices a run at, with time inside the timeout to settle", () => {
    expect(RUN_SPAN_S).toBe(REBUILD_TIMEOUT_S + 20);
    expect(RUN_CEILING).toEqual({
      gibs: RUN_SPAN_S * REBUILD_SIZE.gib,
      vcpuS: RUN_SPAN_S * REBUILD_SIZE.cpu,
    });
    expect(REBUILD_PASS_S).toBeLessThan(REBUILD_LIMIT_S);
    // The queue never takes a run still going for a failed one, and the queue allows the wait.
    expect(REBUILD_DISPATCH_S).toBeGreaterThan(REBUILD_TIMEOUT_S);
    expect(REBUILD_DISPATCH_S).toBeLessThanOrEqual(1_800);
    expect(REBUILD_LIMIT_S).toBeLessThan(REBUILD_TIMEOUT_S);
    // A heap that grows is recycled before it runs out, and the process stays inside the instance.
    expect(RECYCLE_AT.heapUsedMb).toBeLessThan(REBUILD_WORKER_HEAP_MB);
    expect(RECYCLE_AT.rssMb).toBeLessThan(REBUILD_SIZE.gib * 1024);
    expect(REBUILD_WORKER_HEAP_MB).toBeLessThan(REBUILD_SIZE.gib * 1024);
  });
});

describe("the worker's answer", () => {
  it("is the run's result with the worker's memory, a run that threw, or a ping's pong", async () => {
    const memory = () => memoryOf({ heapUsed: 3 * 2 ** 20, rss: 5 * 2 ** 20 });
    const run = vi.fn(async () => PUBLISHED);
    expect(
      await answerRebuild({ kind: "run", id: 7, dry: true, deadline: 99 }, { run, memory })
    ).toEqual({ kind: "ran", id: 7, result: PUBLISHED, memory: { heapUsedMb: 3, rssMb: 5 } });
    expect(run).toHaveBeenCalledWith({ dry: true, deadline: 99 });
    const threw = async (): Promise<RebuildResult> => {
      throw new Error("Firestore answered HTTP 503 reading copies/main.");
    };
    expect(
      await answerRebuild({ kind: "run", id: 8, dry: false, deadline: 0 }, { run: threw, memory })
    ).toEqual({
      kind: "failed",
      id: 8,
      error: "Firestore answered HTTP 503 reading copies/main.",
      memory: { heapUsedMb: 3, rssMb: 5 },
    });
    // A ping reads nothing, so the smoke test can ask one of a built worker with no network.
    const untouched = vi.fn(async () => PUBLISHED);
    expect(await answerRebuild({ kind: "ping", id: 9 }, { run: untouched, memory })).toEqual({
      kind: "pong",
      id: 9,
    });
    expect(untouched).not.toHaveBeenCalled();
  });
});

describe("the main thread's worker", () => {
  it("is kept from run to run while warm, and each run is given its deadline for a second pass", async () => {
    const workers = fakeWorkers((request) => ran(request.id));
    let now = 1_000;
    const runner = rebuildRunner({ spawn: workers.spawn, clock: () => now });
    expect(await runner.run({ dry: false, warm: true })).toEqual(PUBLISHED);
    now = 5_000;
    expect(await runner.run({ dry: true, warm: true })).toEqual(PUBLISHED);
    expect(workers.started).toEqual([1]);
    expect(workers.ended).toEqual([]);
    expect(workers.posted).toEqual([
      { kind: "run", id: 1, dry: false, deadline: 1_000 + REBUILD_PASS_S * 1000 },
      { kind: "run", id: 2, dry: true, deadline: 5_000 + REBUILD_PASS_S * 1000 },
    ]);
  });

  it("is started afresh for every run while not warm, and ended after it", async () => {
    const workers = fakeWorkers((request) => ran(request.id));
    const runner = rebuildRunner({ spawn: workers.spawn });
    await runner.run({ dry: false, warm: false });
    await runner.run({ dry: false, warm: false });
    expect(workers.started).toEqual([1, 2]);
    expect(workers.ended).toEqual([1, 2]);
    // A warm worker held when the switch turns warm off is ended before the run, not reused.
    const held = fakeWorkers((request) => ran(request.id));
    const turning = rebuildRunner({ spawn: held.spawn });
    await turning.run({ dry: false, warm: true });
    await turning.run({ dry: false, warm: false });
    expect(held.started).toEqual([1, 2]);
    expect(held.ended).toEqual([1, 2]);
  });

  it("is recycled once its heap, the process or its runs pass what a warm worker should reach", async () => {
    for (const memory of [
      { heapUsedMb: RECYCLE_AT.heapUsedMb + 1, rssMb: 1_800 },
      { heapUsedMb: 900, rssMb: RECYCLE_AT.rssMb + 1 },
    ]) {
      const workers = fakeWorkers((request) => ran(request.id, memory));
      const runner = rebuildRunner({ spawn: workers.spawn });
      await runner.run({ dry: false, warm: true });
      await runner.run({ dry: false, warm: true });
      expect(workers.started, JSON.stringify(memory)).toEqual([1, 2]);
    }
    const workers = fakeWorkers((request) => ran(request.id));
    const runner = rebuildRunner({ spawn: workers.spawn });
    for (let run = 0; run < RECYCLE_AT.runs + 1; run += 1) {
      await runner.run({ dry: false, warm: true });
    }
    expect(workers.started).toEqual([1, 2]);
    expect(workers.ended).toEqual([1]);
  });

  it("is ended when its run threw, and the next run starts another", async () => {
    let calls = 0;
    const workers = fakeWorkers((request) => {
      calls += 1;
      return calls === 1
        ? { kind: "failed", id: request.id, error: "copy unreachable", memory: SMALL }
        : ran(request.id);
    });
    const runner = rebuildRunner({ spawn: workers.spawn });
    await expect(runner.run({ dry: false, warm: true })).rejects.toThrow("copy unreachable");
    expect(workers.ended).toEqual([1]);
    expect(await runner.run({ dry: false, warm: true })).toEqual(PUBLISHED);
    expect(workers.started).toEqual([1, 2]);
  });

  it("is ended when it dies or exits mid-run, which the run throws", async () => {
    const workers = fakeWorkers(() => null);
    const runner = rebuildRunner({ spawn: workers.spawn });
    const dying = runner.run({ dry: false, warm: true });
    await Promise.resolve();
    workers.ports[0]!.die(Object.assign(new Error("heap"), { code: "ERR_WORKER_OUT_OF_MEMORY" }));
    await expect(dying).rejects.toThrow("The rebuild ran out of memory in its worker.");
    const exiting = runner.run({ dry: false, warm: true });
    await Promise.resolve();
    workers.ports[1]!.exit(1);
    await expect(exiting).rejects.toThrow("stopped (exit 1) without an answer");
    expect(workers.started).toEqual([1, 2]);
    expect(workers.ended).toEqual([1, 2]);
  });

  it("is ended when a run goes past its limit, and takes no answer meant for another run", async () => {
    let fire: (() => void) | null = null;
    const workers = fakeWorkers(() => null);
    const runner = rebuildRunner({
      spawn: workers.spawn,
      setTimer: (done) => {
        fire = done;
        return () => {
          fire = null;
        };
      },
    });
    const slow = runner.run({ dry: false, warm: true });
    await Promise.resolve();
    // An answer to some other request is not this run's.
    workers.ports[0]!.reply(ran(99));
    fire!();
    await expect(slow).rejects.toThrow(`ran past ${REBUILD_LIMIT_S} s`);
    expect(workers.ended).toEqual([1]);
    // The next run's own answer stops its timer.
    const answered = runner.run({ dry: false, warm: true });
    await Promise.resolve();
    workers.ports[1]!.reply(ran(2));
    expect(await answered).toEqual(PUBLISHED);
    expect(fire).toBeNull();
  });

  it("runs one at a time, a second waiting on the first", async () => {
    const order: string[] = [];
    const workers = fakeWorkers(() => null);
    const runner = rebuildRunner({ spawn: workers.spawn });
    const first = runner.run({ dry: false, warm: true }).then(() => order.push("first"));
    const second = runner.run({ dry: false, warm: true }).then(() => order.push("second"));
    await Promise.resolve();
    expect(workers.posted).toHaveLength(1);
    workers.ports[0]!.reply(ran(1));
    await first;
    await Promise.resolve();
    expect(workers.posted).toHaveLength(2);
    workers.ports[0]!.reply(ran(2));
    await second;
    expect(order).toEqual(["first", "second"]);
  });

  it("is ended by stop, and none is started until a run asks", async () => {
    const workers = fakeWorkers((request) => ran(request.id));
    const runner = rebuildRunner({ spawn: workers.spawn });
    await runner.stop();
    expect(workers.started).toEqual([]);
    await runner.run({ dry: false, warm: true });
    await runner.stop();
    expect(workers.ended).toEqual([1]);
  });
});
