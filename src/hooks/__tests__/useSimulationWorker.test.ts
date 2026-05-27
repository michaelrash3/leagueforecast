import { describe, expect, it, vi } from "vitest";

import { attachWorkerRequestListener } from "../useSimulationWorker";

class MockWorker {
  listeners = new Set<(event: MessageEvent<any>) => void>();

  addEventListener(_type: "message", listener: (event: MessageEvent<any>) => void) {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "message", listener: (event: MessageEvent<any>) => void) {
    this.listeners.delete(listener);
  }

  emit(data: any) {
    for (const listener of this.listeners) {
      listener({ data } as MessageEvent<any>);
    }
  }
}

describe("attachWorkerRequestListener", () => {
  it("removes superseded listeners during rapid request changes", () => {
    const worker = new MockWorker() as unknown as Worker;
    const latestIdRef = { current: 1 };
    const firstResolved = vi.fn();
    const secondResolved = vi.fn();

    const removeFirst = attachWorkerRequestListener(worker, 1, "odds", latestIdRef, firstResolved);
    expect((worker as unknown as MockWorker).listeners.size).toBe(1);

    latestIdRef.current = 2;
    removeFirst();
    expect((worker as unknown as MockWorker).listeners.size).toBe(0);

    const removeSecond = attachWorkerRequestListener(worker, 2, "odds", latestIdRef, secondResolved);
    expect((worker as unknown as MockWorker).listeners.size).toBe(1);

    (worker as unknown as MockWorker).emit({ kind: "odds", id: 1, odds: { x: 1 } });
    expect(firstResolved).not.toHaveBeenCalled();

    (worker as unknown as MockWorker).emit({ kind: "odds", id: 2, odds: { y: 2 } });
    expect(secondResolved).toHaveBeenCalledTimes(1);

    removeSecond();
    expect((worker as unknown as MockWorker).listeners.size).toBe(0);
  });

  it("routes trend and ignores stale ids", () => {
    const worker = new MockWorker() as unknown as Worker;
    const latestIdRef = { current: 2 };
    const resolved = vi.fn();

    const remove = attachWorkerRequestListener(worker, 2, "trend", latestIdRef, resolved);
    (worker as unknown as MockWorker).emit({ kind: "odds", id: 2, odds: {} });
    (worker as unknown as MockWorker).emit({ kind: "trend", id: 1, trend: {} });
    expect(resolved).not.toHaveBeenCalled();

    (worker as unknown as MockWorker).emit({ kind: "trend", id: 2, trend: { a: [1] } });
    expect(resolved).toHaveBeenCalledTimes(1);

    latestIdRef.current = 3;
    (worker as unknown as MockWorker).emit({ kind: "trend", id: 2, trend: { a: [2] } });
    expect(resolved).toHaveBeenCalledTimes(1);

    remove();
    expect((worker as unknown as MockWorker).listeners.size).toBe(0);
  });
});
