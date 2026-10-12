import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PULL_WORKER_TIMEOUT_MS,
  waitForPullWorker,
  type PullWorkerPort,
} from "../pullWorkerLifetime";

const worker = () => {
  let message!: (answer: string) => void;
  let error!: (error: Error & { code?: string }) => void;
  let exit!: (code: number) => void;
  const stop = vi.fn(async () => 0);
  const port: PullWorkerPort<string> = {
    onMessage: (listener) => {
      message = listener;
    },
    onError: (listener) => {
      error = listener;
    },
    onExit: (listener) => {
      exit = listener;
    },
    stop,
  };
  return {
    port,
    stop,
    message: (answer: string) => message(answer),
    error: (said: Error) => error(said),
    exit: (code: number) => exit(code),
  };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("a pull worker's lifetime", () => {
  it("stops a stalled worker five minutes before the task deadline", async () => {
    const w = worker();
    const answer = waitForPullWorker(w.port);
    const rejected = expect(answer).rejects.toThrow("25-minute worker limit");
    await vi.advanceTimersByTimeAsync(PULL_WORKER_TIMEOUT_MS - 1);
    expect(w.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(w.stop).toHaveBeenCalledOnce();
  });

  it("waits for termination before returning a successful answer", async () => {
    const w = worker();
    let release!: (value: number) => void;
    w.stop.mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          release = resolve;
        })
    );
    const answer = waitForPullWorker(w.port);
    const returned = vi.fn();
    void answer.then(returned);
    w.message("filed");
    await Promise.resolve();
    expect(returned).not.toHaveBeenCalled();
    release(0);
    await expect(answer).resolves.toBe("filed");
    expect(w.stop).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for termination before a timed-out request can retry", async () => {
    const w = worker();
    let release!: (value: number) => void;
    w.stop.mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          release = resolve;
        })
    );
    const answer = waitForPullWorker(w.port);
    const returned = vi.fn();
    void answer.catch(returned);
    const rejected = expect(answer).rejects.toThrow("worker limit");
    await vi.advanceTimersByTimeAsync(PULL_WORKER_TIMEOUT_MS);
    expect(returned).not.toHaveBeenCalled();
    release(0);
    await rejected;
  });

  it("keeps the timeout error when an answer or exit arrives during termination", async () => {
    const w = worker();
    const answer = waitForPullWorker(w.port);
    const rejected = expect(answer).rejects.toThrow("worker limit");
    await vi.advanceTimersByTimeAsync(PULL_WORKER_TIMEOUT_MS);
    w.message("late answer");
    w.exit(1);
    await rejected;
    expect(w.stop).toHaveBeenCalledOnce();
  });

  it("reports memory exhaustion and terminates the worker", async () => {
    const w = worker();
    const answer = waitForPullWorker(w.port);
    w.error(Object.assign(new Error("worker died"), { code: "ERR_WORKER_OUT_OF_MEMORY" }));
    await expect(answer).rejects.toThrow("ran out of memory");
    expect(w.stop).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports an unexpected exit without waiting for the deadline", async () => {
    const w = worker();
    const answer = waitForPullWorker(w.port);
    w.exit(1);
    await expect(answer).rejects.toThrow("exit 1");
    expect(w.stop).toHaveBeenCalledOnce();
  });

  it("preserves a worker error", async () => {
    const w = worker();
    const answer = waitForPullWorker(w.port);
    const error = new Error("permission denied");
    w.error(error);
    await expect(answer).rejects.toBe(error);
  });

  it("does not return success if termination fails", async () => {
    const w = worker();
    w.stop.mockRejectedValue(new Error("termination failed"));
    const answer = waitForPullWorker(w.port);
    w.message("filed");
    await expect(answer).rejects.toThrow("termination failed");
  });
});
