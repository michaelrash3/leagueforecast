/**
 * The version of a pull's log (`pullTracker.ts`), apart from the tracker that writes it: the pool's
 * store checks it as it reads a kept log back (`loadPullLog`), and loads at start, while only a
 * pull runs the tracker. `pullTracker.ts` re-exports it.
 */

/** Bumped when a column's meaning changes, so an old file cannot be read as a new one. */
export const PULL_TRACKER_VERSION = 1;
