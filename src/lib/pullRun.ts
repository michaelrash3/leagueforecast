import type { GcImportState } from "./gameChangerImport";
import type { PullSession } from "./pullSession";
import type { PullEndReason } from "./pullTracker";
import type { PoolHolding } from "./teamRankingsStorage";

/**
 * What a GameChanger pull is, while it is one.
 *
 * The run's lifecycle used to live in eight places at once — a `stage`, five refs, a `let` inside
 * the loop and two flags derived from the module-level slot — and nothing tied them together. Most
 * of the combinations that produces are not states a pull can actually be in, and two of the bugs
 * fixed before this one were exactly that: a working pool seeded at mount and never re-synced, and
 * a section's games saved under a label that belonged to a different pool.
 *
 * So the pieces that are one fact are one value here, and the phases a run passes through are a
 * union rather than a string beside a pile of refs. The held pool stays in a ref and is
 * mutated per team, because a render per team on a pull of forty thousand is the thing that made
 * this page unusable in the first place; the phase is React state, because it is what the panel
 * draws.
 */

/**
 * The pool the run is working on, and what that pool *is*.
 *
 * One value because they are one fact, and because the code that reads them says what happens when
 * they disagree: a page-scoped hold saved as the whole pool deletes every page it is not holding,
 * and the whole pool saved as a page-scoped hold writes a pool the run was never given. They were
 * two refs, set in different places, and keeping them in step was something a reader had to
 * verify by hand.
 *
 * `holding` undefined means the whole pool, which is what an unsectioned run holds and what every
 * save outside a run is.
 */
export type HeldPool = {
  readonly state: GcImportState;
  readonly holding: PoolHolding | undefined;
};

/** The whole pool, as an unsectioned run holds it and as every save outside a run does. */
export const holdingWholePool = (state: GcImportState): HeldPool => ({
  state,
  holding: undefined,
});

/**
 * One section's hold: these pages in full, and this section's games only.
 *
 * A section that owns pages is authoritative for them and replaces them. A section of ids nobody
 * has pulled before owns none — it never read a page, so it cannot say what one ought to contain —
 * and can only add, which is what `additions` means.
 */
export const holdingPages = (state: GcImportState, ageGroupIds: readonly string[]): HeldPool => ({
  state,
  holding: ageGroupIds.length > 0 ? { kind: "pages", ageGroupIds } : { kind: "additions" },
});

/** The same hold over a pool the fold has moved on to. The label travels with it, unchanged. */
export const holdingNow = (held: HeldPool, state: GcImportState): HeldPool => ({
  ...held,
  state,
});

/**
 * The copy a save is given.
 *
 * Shallow, and here rather than at the call site so that it cannot be taken without its label. The
 * fold goes on mutating its own arrays after a save returns, and what the store keeps has to stop
 * changing underneath it — three copies per save rather than per team, which is why the save
 * interval is what it is.
 */
export const heldSnapshot = (held: HeldPool): GcImportState => ({
  ageGroups: held.state.ageGroups.slice(),
  teams: held.state.teams.slice(),
  games: held.state.games.slice(),
});

/** Which section of how many is going, for the bar to say so. */
export type SectionMark = { readonly index: number; readonly of: number; readonly label: string };

/**
 * Where a run is.
 *
 * A union rather than a string, so the things that only make sense in one phase live in that
 * phase: a section number cannot be set while nothing is running, and a finished run carries how
 * it ended rather than leaving it in a `let` that outlived the loop.
 */
export type RunPhase =
  | { readonly kind: "picking" }
  /** Fetching. `session` is the slot this run holds; nothing else may write the pool until it ends. */
  | {
      readonly kind: "pulling";
      readonly session: PullSession;
      readonly section: SectionMark | null;
    }
  | { readonly kind: "review"; readonly endReason: PullEndReason };

/** The section a run is on, or null — including when it is not running at all. */
export const sectionOf = (phase: RunPhase): SectionMark | null =>
  phase.kind === "pulling" ? phase.section : null;
