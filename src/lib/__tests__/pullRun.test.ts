import { describe, expect, it } from "vitest";
import {
  heldSnapshot,
  holdingNow,
  holdingPages,
  holdingWholePool,
  sectionOf,
  type RunPhase,
} from "../pullRun";
import type { GcImportState } from "../gameChangerImport";
import type { PullSession } from "../pullSession";

const pool = (): GcImportState => ({
  ageGroups: [{ id: "ag_10u_2027", name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] }],
  teams: [{ id: "S-A", name: "Aces" }],
  games: [],
});

/**
 * The pool a run holds and the label saying what it is were two refs, set in different places, and
 * the code that reads them says exactly what happens when they disagree: a page-scoped hold saved
 * as the whole pool deletes every page it is not holding, and the whole pool saved as a page hold
 * writes a pool the run was never given. They are one value now, and these are the rules that
 * makes true.
 */
describe("what the run is holding", () => {
  it("labels the whole pool as the whole pool", () => {
    // Undefined, not a kind: every save outside a run is this, and so is an unsectioned run.
    expect(holdingWholePool(pool()).holding).toBeUndefined();
  });

  it("labels a section that owns pages as owning exactly those", () => {
    const held = holdingPages(pool(), ["ag_10u_2027", "ag_11u_2027"]);
    expect(held.holding).toEqual({ kind: "pages", ageGroupIds: ["ag_10u_2027", "ag_11u_2027"] });
  });

  it("labels a section that owns no page as additions, not as pages of none", () => {
    /*
     * The section of ids nobody has pulled before. It never read a page, so it cannot say what one
     * ought to contain — and `{kind: "pages", ageGroupIds: []}` would say "these pages are now
     * empty", which on the real storage path empties them.
     */
    expect(holdingPages(pool(), []).holding).toEqual({ kind: "additions" });
  });

  it("carries the label unchanged as the fold moves the pool on", () => {
    const before = holdingPages(pool(), ["ag_10u_2027"]);
    const after = holdingNow(before, { ...pool(), teams: [{ id: "S-B", name: "Bears" }] });

    expect(after.holding).toBe(before.holding);
    expect(after.state.teams[0]?.id).toBe("S-B");
  });

  it("hands a save a copy that stops changing, with its label attached", () => {
    const live = pool();
    const held = holdingPages(live, ["ag_10u_2027"]);
    const snapshot = heldSnapshot(held);

    // The fold goes on mutating its own arrays after a save returns.
    live.teams.push({ id: "S-LATE", name: "Arrived after the save" });

    expect(snapshot.teams).toHaveLength(1);
    expect(snapshot.teams).not.toBe(live.teams);
  });
});

describe("where a run is", () => {
  const session = { kind: "pull" } as unknown as PullSession;

  it("has no section number unless it is actually running", () => {
    // A section mark outside a run draws a run that is not happening.
    expect(sectionOf({ kind: "picking" })).toBeNull();
    expect(sectionOf({ kind: "review", endReason: "finished" })).toBeNull();

    /*
     * And a stray one left behind, which the union forbids and a cast is the only way to build —
     * so this is what a refactor that widened the phase, or a value crossing from untyped code,
     * would look like. Reading the section without asking the phase first would draw a run that
     * has finished.
     */
    const stale = {
      kind: "review",
      endReason: "finished",
      section: { index: 2, of: 6, label: "11U" },
    } as unknown as RunPhase;
    expect(sectionOf(stale)).toBeNull();
  });

  it("carries the section it is on while it runs", () => {
    const phase: RunPhase = {
      kind: "pulling",
      session,
      section: { index: 2, of: 6, label: "11U 2027" },
    };
    expect(sectionOf(phase)).toEqual({ index: 2, of: 6, label: "11U 2027" });
  });

  it("carries how it ended, once it has", () => {
    // Rather than in a `let` inside a loop that has already returned.
    const phase: RunPhase = { kind: "review", endReason: "stopped" };
    expect(phase.kind === "review" && phase.endReason).toBe("stopped");
  });
});
