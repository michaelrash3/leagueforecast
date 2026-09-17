import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePoolTidy } from "./usePoolTidy";
import { ageGroup, game, seasonDate, team } from "../test/teamRankingsHarness";
import type { GcImportState } from "../lib/gameChangerImport";
import {
  beginPull,
  beginTidy,
  forceReleasePool,
  isPoolBusy,
  resetPullSession,
} from "../lib/pullSession";

afterEach(() => resetPullSession());

/**
 * One club's schedule names the opponent; the other posted the same game against a stand-in with
 * the mirrored score. The tidy settles that, so a run that did anything is one that found this.
 */
const withStandIn = (): GcImportState => ({
  ageGroups: [ageGroup(10, 2027)],
  teams: [
    team("S-HOME", "Home Club", { state: "KY" }),
    team("S-AWAY", "Away Club", { state: "KY" }),
    team("S-TBD", "TBD- 3:00 PM", { placeholder: true }),
  ],
  games: [
    game("named", "ag_10u_2027", "S-HOME", "S-AWAY", 6, 2, {
      date: seasonDate(2027),
      source: { kind: "gamechanger", teamId: "gcHOME", gameId: "n1" },
    }),
    game("slot", "ag_10u_2027", "S-AWAY", "S-TBD", 2, 6, {
      date: seasonDate(2027),
      source: { kind: "gamechanger", teamId: "gcAWAY", gameId: "s1" },
    }),
  ],
});

describe("tidying the pool", () => {
  it("does the work and says what it settled", async () => {
    const { result } = renderHook(() => usePoolTidy());
    const outcome = await result.current.tidy(withStandIn());
    expect(outcome?.tidy.named).toBe(1);
  });

  /*
   * The reason this claims a slot at all. A tidy reads the whole pool, works for the better part of
   * half a minute, and then saves all of it. On the main thread nothing else could start while it
   * ran; in a worker everything can — so a pull beginning halfway through would have its first few
   * hundred teams overwritten by a tidy that never saw them, with the cursor already counting them
   * settled and a resume skipping them for good.
   */
  it("refuses while a pull is running, rather than racing its saves", async () => {
    beginPull("2026-09-17T08:00:00.000Z");
    const { result } = renderHook(() => usePoolTidy());
    expect(await result.current.tidy(withStandIn())).toBeNull();
  });

  it("refuses while another tidy has the pool", async () => {
    beginTidy("2026-09-17T08:00:00.000Z");
    const { result } = renderHook(() => usePoolTidy());
    expect(await result.current.tidy(withStandIn())).toBeNull();
  });

  it("gives the slot back when it finishes, so the next job is not locked out", async () => {
    const { result } = renderHook(() => usePoolTidy());
    await result.current.tidy(withStandIn());
    expect(isPoolBusy()).toBe(false);
    expect(beginPull("2026-09-17T08:05:00.000Z")).not.toBeNull();
  });

  it("gives the slot back even when the pool is one it cannot read", async () => {
    // Anything thrown out of the tidy must not leave the pool claimed for the rest of the session.
    const { result } = renderHook(() => usePoolTidy());
    const broken = { ageGroups: [], teams: [], games: null } as unknown as GcImportState;
    await expect(result.current.tidy(broken)).rejects.toThrow();
    expect(isPoolBusy()).toBe(false);
  });

  it("does not claim the pool to look at it", async () => {
    // Inspecting reads and writes nothing, so it has no business blocking a pull.
    beginPull("2026-09-17T08:00:00.000Z");
    const { result } = renderHook(() => usePoolTidy());
    const looked = await result.current.inspect(withStandIn(), "");
    expect(looked?.health.games).toBe(2);
  });
});

/**
 * A worker that takes the job and never answers — which is what a real one looks like from the
 * moment it is terminated.
 */
class SilentWorker {
  addEventListener() {}
  removeEventListener() {}
  postMessage() {}
  terminate() {}
}

describe("a tidy whose panel goes away", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetPullSession();
  });

  /*
   * The bug this exists for. Terminating a worker fires neither `message` nor `error`, so the
   * promise waiting on one was never settled, so the `finally` that releases the pool never ran —
   * and every later pull was refused with "a pull is already running" while nothing was running at
   * all. It took a reload to clear, and a reload is not a thing to ask of somebody mid-season.
   */
  it("lets go of the pool instead of holding it for ever", async () => {
    vi.stubGlobal("Worker", SilentWorker);
    const { result, unmount } = renderHook(() => usePoolTidy());

    const pending = result.current.tidy(withStandIn());
    expect(isPoolBusy()).toBe(true);

    unmount();

    await expect(pending).resolves.toBeNull();
    expect(isPoolBusy()).toBe(false);
    // And the next pull is free to start, which is the whole point.
    expect(beginPull("2026-09-17T09:00:00.000Z")).not.toBeNull();
  });

  it("settles an inspection the same way, rather than leaving it hanging", async () => {
    vi.stubGlobal("Worker", SilentWorker);
    const { result, unmount } = renderHook(() => usePoolTidy());
    const pending = result.current.inspect(withStandIn(), "");
    unmount();
    await expect(pending).resolves.toBeNull();
  });
});

describe("taking the pool back", () => {
  afterEach(() => resetPullSession());

  it("frees it whatever holds it, so a stuck slot never needs a reload", () => {
    const held = beginTidy("2026-09-17T08:00:00.000Z")!;
    expect(isPoolBusy()).toBe(true);
    forceReleasePool();
    expect(isPoolBusy()).toBe(false);
    // Aborted on the way out, so a job that really was going stops rather than carrying on unseen.
    expect(held.controller.signal.aborted).toBe(true);
  });

  it("is harmless when nothing holds it", () => {
    expect(() => forceReleasePool()).not.toThrow();
    expect(isPoolBusy()).toBe(false);
  });
});
