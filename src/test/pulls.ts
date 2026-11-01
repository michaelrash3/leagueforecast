import { beginPull, type PullSession } from "../lib/pullSession";
import { createPullTracker } from "../lib/pullTracker";

/**
 * Claims the pool for a pull as the Import panel does, with the tracker that keeps the pull's log:
 * the slot takes it with the claim (`beginPull`), so a test that only wants the pool held hands one
 * over too.
 */
export const beginTrackedPull = (startedAt: string): PullSession | null =>
  beginPull(startedAt, createPullTracker(startedAt));
