import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coerceLedger } from "../rebuildLedger";
import { REBUILD_JOB_CONTROL } from "../rebuildJobControl";
declare const process: { uptime: () => number; exitCode?: number };

const runtime = vi.hoisted(() => ({
  values: new Map<string, Record<string, unknown>>(),
  versions: new Map<string, number>(),
  runs: 0,
  killed: 0,
  duration: 310000,
  fail: false,
  newSave: false,
  enqueue: vi.fn(async () => {}),
}));
vi.mock("../../../../functions/src/pullAccess", () => ({
  restAccess: () => ({}),
  enqueueRebuild: runtime.enqueue,
}));
vi.mock("../../cloud/firestoreRest", () => ({
  firestoreRestDocuments: () => ({
    readAt: async (path: string) =>
      runtime.values.has(path)
        ? {
            fields: structuredClone(runtime.values.get(path)!),
            token: String(runtime.versions.get(path) ?? 0),
          }
        : null,
    replace: async (path: string, fields: Record<string, unknown>, token: string | null) => {
      if (token !== (runtime.values.has(path) ? String(runtime.versions.get(path) ?? 0) : null))
        return false;
      runtime.values.set(path, structuredClone(fields));
      runtime.versions.set(path, (runtime.versions.get(path) ?? 0) + 1);
      return true;
    },
  }),
}));
vi.mock("node:worker_threads", () => ({
  Worker: class {
    listeners = new Map<string, Set<(value: unknown) => void>>();
    on(kind: string, fn: (value: unknown) => void) {
      const set = this.listeners.get(kind) ?? new Set();
      set.add(fn);
      this.listeners.set(kind, set);
    }
    once(kind: string, fn: (value: unknown) => void) {
      this.on(kind, fn);
    }
    off(kind: string, fn: (value: unknown) => void) {
      this.listeners.get(kind)?.delete(fn);
    }
    emit(kind: string, value: unknown) {
      for (const fn of this.listeners.get(kind) ?? []) fn(value);
    }
    postMessage(request: { id: number }) {
      runtime.runs++;
      const run = runtime.runs;
      setTimeout(() => {
        if (runtime.newSave && run === 1) {
          const current = runtime.values.get("ops/rebuildJob")!;
          runtime.values.set("ops/rebuildJob", {
            ...current,
            generation: Number(current.generation) + 1,
          });
          runtime.versions.set("ops/rebuildJob", (runtime.versions.get("ops/rebuildJob") ?? 0) + 1);
        }
        this.emit(
          "message",
          runtime.fail
            ? { kind: "failed", id: request.id, error: "Worker ran out of memory" }
            : {
                kind: "ran",
                id: request.id,
                result: { end: "published", retryable: false, tries: 1 },
              }
        );
      }, runtime.duration);
    }
    async terminate() {
      runtime.killed++;
      this.emit("exit", 0);
    }
  },
}));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-13T17:00:00Z"));
  vi.spyOn(process, "uptime").mockReturnValue(2);
  vi.spyOn(console, "log").mockImplementation(() => {});
  runtime.values.clear();
  runtime.versions.clear();
  runtime.enqueue.mockClear();
  runtime.runs = 0;
  runtime.killed = 0;
  runtime.duration = 310000;
  runtime.fail = false;
  runtime.newSave = false;
  runtime.values.set(REBUILD_JOB_CONTROL, {
    format: 1,
    generation: 1,
    owner: "launching",
    until: Date.now() + 90000,
    state: "queued",
    task: { copy: "copy", kind: "edit", window: 1, savedAt: new Date().toISOString() },
  });
  runtime.values.set("ops/rebuild", {
    on: true,
    mode: "live",
    day: "2026-10-13",
    month: "2026-10",
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  process.exitCode = 0;
});

// Keep Node's runtime entry out of the browser typecheck; it is checked with its Node types too.
const start = () => import("../../../../functions/src/" + "rebuildJob.ts");

describe("the ranking job supervisor", () => {
  it("finishes a rebuild longer than the old 270-second limit while keeping its lease alive", async () => {
    const running = start();
    await vi.waitFor(() => expect(runtime.runs).toBe(1));
    await vi.advanceTimersByTimeAsync(311000);
    await running;
    expect(runtime.values.get(REBUILD_JOB_CONTROL)).toMatchObject({ state: "done", owner: null });
    expect(coerceLedger(runtime.values.get("ops/rebuild"))).toMatchObject({
      open: null,
      failures: 0,
      engine: "job-v1",
    });
    expect(runtime.enqueue).not.toHaveBeenCalled();
  });
  it("includes a save arriving during a rebuild before releasing the job", async () => {
    runtime.newSave = true;
    const running = start();
    await vi.waitFor(() => expect(runtime.runs).toBe(1));
    await vi.advanceTimersByTimeAsync(621000);
    await running;
    expect(runtime.runs).toBe(2);
    expect(runtime.values.get(REBUILD_JOB_CONTROL)).toMatchObject({ state: "done", generation: 2 });
    expect(coerceLedger(runtime.values.get("ops/rebuild"))!.dayGiBs).toBeLessThan(10000);
  });
  it("retains budget-limited work and queues it automatically without counting a failure", async () => {
    runtime.duration = 2000000;
    const running = start();
    await vi.waitFor(() => expect(runtime.runs).toBe(1));
    await vi.advanceTimersByTimeAsync(1250000);
    await running;
    expect(runtime.values.get(REBUILD_JOB_CONTROL)).toMatchObject({
      state: "deferred",
      deferredUntil: "2026-10-14T04:01:00.000Z",
    });
    expect(coerceLedger(runtime.values.get("ops/rebuild"))).toMatchObject({
      open: null,
      failures: 0,
    });
    expect(runtime.enqueue).toHaveBeenCalledTimes(1);
    expect(runtime.killed).toBeGreaterThan(0);
  });
  it("counts a real worker error and asks Cloud Run to retry from checkpoints", async () => {
    runtime.duration = 1000;
    runtime.fail = true;
    const running = start();
    await vi.waitFor(() => expect(runtime.runs).toBe(1));
    await vi.advanceTimersByTimeAsync(2000);
    await running;
    expect(coerceLedger(runtime.values.get("ops/rebuild"))).toMatchObject({
      open: null,
      failures: 1,
    });
    expect(process.exitCode).toBe(1);
    expect(coerceLedger(runtime.values.get("ops/rebuild"))!.dayGiBs).toBe(480);
  });
  it("stops cleanly when switched off, without an execution retry or a false failure", async () => {
    const running = start();
    await vi.waitFor(() => expect(runtime.runs).toBe(1));
    runtime.values.set("ops/rebuild", { ...runtime.values.get("ops/rebuild"), on: false });
    await vi.advanceTimersByTimeAsync(11000);
    await running;
    expect(process.exitCode ?? 0).toBe(0);
    expect(coerceLedger(runtime.values.get("ops/rebuild"))).toMatchObject({
      failures: 0,
      open: null,
    });
  });
  it("finishes under the new day's rankings when midnight falls during the first build", async () => {
    vi.setSystemTime(new Date("2026-10-14T03:58:00Z"));
    const running = start();
    await vi.waitFor(() => expect(runtime.runs).toBe(1));
    await vi.advanceTimersByTimeAsync(621000);
    await running;
    expect(runtime.runs).toBe(2);
    expect(runtime.values.get(REBUILD_JOB_CONTROL)).toMatchObject({ state: "done" });
  });
});
