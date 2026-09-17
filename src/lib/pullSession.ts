/**
 * The one pull that may be running, held outside React.
 *
 * A pull outlives its panel on purpose: closing the panel hides it and the loop carries on. But
 * the panel's own state dies with it — the abort controller, the importer, the working copy of the
 * pool are all component refs — so a reopened panel that started a second run would build a second
 * importer seeded from the last save. Both write whole-pool snapshots, so the later one silently
 * overwrites the earlier's teams, and the cursor has already recorded those teams as settled, so a
 * resume skips them for good. Two clicks reached that: Close, reopen, "Carry on".
 *
 * So the question "is a pull already running" has to be answerable somewhere the panel cannot take
 * with it. A run claims this slot when it starts and gives it up when it ends; a second claim is
 * refused rather than queued, because the second run is never what anybody wanted.
 */
export type PullSession = {
  /** Aborting this stops the run it belongs to. */
  readonly controller: AbortController;
  /** When it claimed the slot, so a panel that reopens can say how long it has been going. */
  readonly startedAt: string;
};

let live: PullSession | null = null;
const listeners = new Set<() => void>();

const announce = (): void => {
  listeners.forEach((listener) => listener());
};

/** Whether a pull is running anywhere, including behind a closed panel. */
export const isPullLive = (): boolean => live !== null;

/** The live run, for a panel that has just opened onto one already in progress. */
export const livePull = (): PullSession | null => live;

/**
 * Claims the slot for a new run, or returns null because one is already going.
 *
 * Null is a refusal and not a failure: the caller should say so and leave the running pull alone.
 */
export const beginPull = (startedAt: string): PullSession | null => {
  if (live) return null;
  live = { controller: new AbortController(), startedAt };
  announce();
  return live;
};

/**
 * Gives the slot up. A session that is no longer the live one cannot end it — that would let a
 * finishing straggler clear a run that started after it.
 */
export const endPull = (session: PullSession): void => {
  if (live !== session) return;
  live = null;
  announce();
};

/** Stops whatever is running, from anywhere — the panel that started it may be long gone. */
export const stopLivePull = (): void => {
  live?.controller.abort();
};

/** For `useSyncExternalStore`: fires whenever a run starts or ends. */
export const watchPull = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Test-only: drops any live run so one case cannot leak into the next. */
export const resetPullSession = (): void => {
  live = null;
  listeners.clear();
};
