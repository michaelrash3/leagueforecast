import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginPull,
  endPull,
  isPullLive,
  livePull,
  resetPullSession,
  stopLivePull,
  watchPull,
} from "../pullSession";

afterEach(() => resetPullSession());

describe("the one pull that may be running", () => {
  it("is nothing until a run claims it", () => {
    expect(isPullLive()).toBe(false);
    expect(livePull()).toBeNull();
  });

  it("refuses a second claim rather than queueing it", () => {
    /*
     * The second run is never what anybody wanted: both write whole-pool snapshots, so the later
     * one overwrites the earlier's teams, and the cursor has already marked those settled — a
     * resume would skip them for good.
     */
    const first = beginPull("2026-09-17T08:00:00.000Z");
    expect(first).not.toBeNull();
    expect(beginPull("2026-09-17T08:00:01.000Z")).toBeNull();
    expect(livePull()).toBe(first);
  });

  it("lets the next run start once the first gives the slot up", () => {
    const first = beginPull("2026-09-17T08:00:00.000Z")!;
    endPull(first);
    expect(isPullLive()).toBe(false);
    expect(beginPull("2026-09-17T08:05:00.000Z")).not.toBeNull();
  });

  it("will not let a finishing straggler end a run that started after it", () => {
    // Otherwise a slow tail from the old run clears the slot the new one is holding.
    const first = beginPull("2026-09-17T08:00:00.000Z")!;
    endPull(first);
    const second = beginPull("2026-09-17T08:05:00.000Z")!;
    endPull(first);
    expect(livePull()).toBe(second);
    expect(isPullLive()).toBe(true);
  });

  it("can be stopped by somebody who did not start it", () => {
    // The panel that began the run may be long closed by the time anyone wants it stopped.
    const session = beginPull("2026-09-17T08:00:00.000Z")!;
    expect(session.controller.signal.aborted).toBe(false);
    stopLivePull();
    expect(session.controller.signal.aborted).toBe(true);
  });

  it("stopping nothing is not an error", () => {
    expect(() => stopLivePull()).not.toThrow();
  });

  it("tells watchers when a run starts and when it ends", () => {
    const seen = vi.fn();
    const unwatch = watchPull(seen);
    const session = beginPull("2026-09-17T08:00:00.000Z")!;
    expect(seen).toHaveBeenCalledTimes(1);
    endPull(session);
    expect(seen).toHaveBeenCalledTimes(2);
    unwatch();
    beginPull("2026-09-17T08:05:00.000Z");
    expect(seen).toHaveBeenCalledTimes(2);
  });
});
