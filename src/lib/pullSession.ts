/**
 * The one job that may be rewriting the whole pool, held outside React.
 *
 * Two things write the pool end to end: a pull, and a tidy. Both read it, work for a long time,
 * and save all of it — so whichever finishes second silently overwrites what the other had just
 * saved, and in the pull's case the cursor has already recorded those teams as settled, so a
 * resume skips them for good.
 *
 * A pull outlives its panel on purpose: closing the panel hides it and the loop carries on. But
 * the panel's own state dies with it — the abort controller, the importer, the working copy of the
 * pool are all component refs — so a reopened panel that started a second run would build a second
 * importer seeded from the last save. Two clicks reached that: Close, reopen, "Carry on".
 *
 * The tidy is the same hazard from the other side. It used to run on the main thread, where
 * nothing else could happen while it did; off in a worker the page stays usable, which means the
 * page can start a pull halfway through one.
 *
 * So the question "is something already writing the pool" has to be answerable somewhere no
 * component can take with it. A job claims this slot when it starts and gives it up when it ends;
 * a second claim is refused rather than queued, because the second job is never what anybody
 * wanted — it would only undo the first.
 */

import { createPullTracker, type PullRunLog, type PullTracker } from "./pullTracker";

/** What is holding the pool: a pull fetching schedules, or a tidy folding what is already here. */
export type PoolJobKind = "pull" | "tidy";

export type PullSession = {
  readonly kind: PoolJobKind;
  /** Aborting this stops the run it belongs to. Only a pull is interruptible; a tidy is one call. */
  readonly controller: AbortController;
  /** When it claimed the slot, so a panel that reopens can say how long it has been going. */
  readonly startedAt: string;
  /**
   * What this run is recording about itself. Held here for the same reason the controller is: the
   * panel that started the run may be closed long before it ends, and the record has to survive
   * that — otherwise the one thing the pull was instrumented for is lost with the component.
   */
  readonly tracker?: PullTracker;
};

let live: PullSession | null = null;
/**
 * The last pull's record, kept after the slot is given up.
 *
 * The tracker itself rather than a snapshot of it: the tidy and the summary happen after the run
 * releases the slot, and they belong in the same file as the fetching that preceded them.
 */
let lastTracker: PullTracker | null = null;
const listeners = new Set<() => void>();

const announce = (): void => {
  listeners.forEach((listener) => listener());
};

const claim = (kind: PoolJobKind, startedAt: string): PullSession | null => {
  if (live) return null;
  live = {
    kind,
    controller: new AbortController(),
    startedAt,
    // Only a pull has anything to record; a tidy is one call whose answer is its own report.
    ...(kind === "pull" ? { tracker: createPullTracker(startedAt) } : {}),
  };
  if (live.tracker) lastTracker = live.tracker;
  announce();
  return live;
};

/**
 * Gives the slot up. A job that is no longer the live one cannot end it — that would let a
 * finishing straggler clear a job that started after it.
 */
const release = (session: PullSession): void => {
  if (live !== session) return;
  live = null;
  announce();
};

/** Whether anything is writing the pool — a pull or a tidy. Nothing else should start. */
export const isPoolBusy = (): boolean => live !== null;

/**
 * Whether a *pull* is running anywhere, including behind a closed panel. Narrower than
 * `isPoolBusy` on purpose: the interface says "a pull is running" and means it.
 */
export const isPullLive = (): boolean => live?.kind === "pull";

/** The live job, for a panel that has just opened onto one already in progress. */
export const livePull = (): PullSession | null => live;

/**
 * Claims the slot for a new run, or returns null because something already has it.
 *
 * Null is a refusal and not a failure: the caller should say so and leave the running job alone.
 */
export const beginPull = (startedAt: string): PullSession | null => claim("pull", startedAt);

/**
 * The most recent pull's record, live or finished.
 *
 * Answerable after the run has ended and after the panel that ran it has closed, because that is
 * when somebody goes looking for the file.
 */
export const lastPullLog = (): PullRunLog | null => lastTracker?.log() ?? null;

/** The tracker a running pull is writing to, for anything that wants to add to it. */
export const livePullTracker = (): PullTracker | null => live?.tracker ?? null;

/** Gives the slot up at the end of a run. */
export const endPull = (session: PullSession): void => release(session);

/**
 * Claims the slot for a tidy, or returns null because a pull — or another tidy — has it.
 *
 * A refused tidy is not worth reporting anywhere: the pool is stamped as untidied, so the next
 * time the app opens on it, or the pull that is running now finishes, it gets tidied then.
 */
export const beginTidy = (startedAt: string): PullSession | null => claim("tidy", startedAt);

export const endTidy = (session: PullSession): void => release(session);

/** Stops whatever is running, from anywhere — the panel that started it may be long gone. */
export const stopLivePull = (): void => {
  live?.controller.abort();
};

/** For `useSyncExternalStore`: fires whenever a job starts or ends. */
export const watchPull = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Test-only: drops any live job so one case cannot leak into the next. */
export const resetPullSession = (): void => {
  live = null;
  lastTracker = null;
  listeners.clear();
};
