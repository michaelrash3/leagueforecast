import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { usePoolTidy } from "./usePoolTidy";
import { ageGroup, game, seasonDate, team } from "../test/teamRankingsHarness";
import type { GcImportState } from "../lib/gameChangerImport";
import { beginPull, beginTidy, isPoolBusy, resetPullSession } from "../lib/pullSession";

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
    expect(looked.health.games).toBe(2);
  });
});
