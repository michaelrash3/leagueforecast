import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSimulationOdds } from "./useSimulationWorker";
import type { Matchup, Settings, Team } from "../lib/types";
import { DEFAULT_SETTINGS } from "../lib/types";

/**
 * A worker that has failed once fails every run after it. The hook is supposed to let it go, the
 * way the rankings and tidy hooks do, so the next run starts a fresh one; when it did not, every
 * later simulation posted into the void and paid the inline fallback again. Nothing guarded that,
 * so nothing would have noticed it coming back.
 */

type Listener = (event: Event) => void;

class FakeWorker {
  static instances: FakeWorker[] = [];
  readonly posted: unknown[] = [];
  terminated = false;
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor() {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, fn: Listener) {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(fn);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, fn: Listener) {
    this.listeners.get(type)?.delete(fn);
  }

  postMessage(message: unknown) {
    this.posted.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  emit(type: string) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(new Event(type));
  }

  /** Requests the hook actually sent, as opposed to the cancel it sends on cleanup. */
  get runs() {
    return this.posted.filter(
      (message): message is { kind: string } =>
        typeof message === "object" && message !== null && "kind" in message
    ).length;
  }
}

const team = (id: string): Team =>
  ({
    id,
    name: id,
    w: 1,
    l: 1,
    t: 0,
    rf: 10,
    ra: 8,
    headToHead: {},
  }) as unknown as Team;

const inputFor = (seedText: string) => ({
  teams: [team("a"), team("b")],
  remaining: [] as Matchup[],
  iterations: 50,
  seedText,
  cutoff: 1,
  settings: DEFAULT_SETTINGS as Settings,
});

describe("useSimulationOdds worker lifecycle", () => {
  beforeEach(() => {
    FakeWorker.instances.length = 0;
    vi.stubGlobal("Worker", FakeWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not post to a worker that has already failed", async () => {
    const { result, rerender } = renderHook(
      (props: { seed: string }) => useSimulationOdds(inputFor(props.seed), 0),
      { initialProps: { seed: "one" } }
    );

    await waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    const first = FakeWorker.instances[0]!;
    await waitFor(() => expect(first.runs).toBeGreaterThan(0));
    const postsBeforeFailure = first.runs;

    // The worker dies the way a real one does, with an error event.
    act(() => first.emit("error"));
    await waitFor(() => expect(result.current.workerError).toBe("error"));

    // It was let go rather than kept for the next run.
    expect(first.terminated).toBe(true);

    // A new run must not reach the dead worker; it must build a new one.
    rerender({ seed: "two" });
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(2));
    expect(first.runs).toBe(postsBeforeFailure);
    expect(FakeWorker.instances[1]!.terminated).toBe(false);
  });

  it("lets the worker go when the request cannot be posted", async () => {
    const { result, rerender } = renderHook(
      (props: { seed: string }) => useSimulationOdds(inputFor(props.seed), 0),
      { initialProps: { seed: "one" } }
    );

    await waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    const first = FakeWorker.instances[0]!;
    // A request that will not structured-clone throws here, exactly as the browser does.
    vi.spyOn(first, "postMessage").mockImplementation(() => {
      throw new Error("could not be cloned");
    });

    rerender({ seed: "two" });
    await waitFor(() => expect(result.current.workerError).toBe("could not be cloned"));
    expect(first.terminated).toBe(true);

    rerender({ seed: "three" });
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(2));
  });
});
