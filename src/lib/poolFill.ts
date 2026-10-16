/**
 * Whether this device's own Team Rankings store has been read into memory yet: the pool and the
 * board it last showed (`main.tsx`). The pool is read during render, synchronously, from a cache
 * that read fills (`teamRankingsStorage.ts`), so it used to be read before anything mounted.
 *
 * A member's device opens on the cloud's published board and League Standings kept live, neither
 * of which reads this device's pool, and many such devices still hold one from before the board
 * was published, tens of megabytes read whole at every open while the page stayed blank. So for
 * one the read runs after the page instead (`bootOrder.ts`): once the board is drawn, since the
 * read unpacks the whole pool on the main thread the board is drawn on, or as soon as something
 * needs the pool, whichever comes first. What needs it waits for it here: Team Rankings on this
 * device's copy, which the board hands over to, a backup or export made from the device, an import
 * or restore written into it, the cloud settling it. Until then a read answers what `localStorage`
 * holds, which on a device whose pool moved into IndexedDB is nothing, and a write is refused
 * rather than left where the read that follows would never find it.
 *
 * No fill started is no fill to wait for: a visitor's is waited on before anything mounts, and
 * the servers, the workers and the tests open stores of their own.
 */

let filling: Promise<void> | null = null;
let filled = true;
/** Starts a read that is waiting for its turn, at once. */
let hurry: (() => void) | null = null;
const listeners = new Set<() => void>();

/**
 * Starts reading the device's store with `fill`, once, when `after` settles or something needs the
 * pool, whichever is first; resolves when done, and never rejects.
 */
export const startPoolFill = (
  fill: () => Promise<unknown>,
  after: Promise<unknown> = Promise.resolve()
): Promise<void> => {
  if (filling) return filling;
  filled = false;
  const turn = new Promise<void>((resolve) => {
    hurry = resolve;
  });
  void after.then(
    () => hurry?.(),
    () => hurry?.()
  );
  filling = turn.then(fill).then(
    () => undefined,
    () => undefined
  );
  void filling.then(() => {
    filled = true;
    hurry = null;
    listeners.forEach((listener) => {
      try {
        listener();
      } catch {
        /* one view that cannot cope must not stop the others hearing */
      }
    });
  });
  return filling;
};

/** Whether the device's store is in memory, or there was none to read. */
export const isPoolFilled = (): boolean => filled;

/** Resolves once the device's store is in memory, its read started now if it was waiting. */
export const poolFilled = (): Promise<void> => {
  hurry?.();
  return filled || !filling ? Promise.resolve() : filling;
};

/** Resolves once the device's store is in memory, its read left to start in its own time. */
export const poolFilledInTime = (): Promise<void> =>
  filled || !filling ? Promise.resolve() : filling;

/**
 * Runs `work` once the device's store is in memory, as `poolFilled`: at once, in the same turn,
 * where it already is, so a download a button starts keeps the browser's sense that it was asked.
 */
export const afterPoolFill = (work: () => void): void => {
  if (filled) work();
  else void poolFilled().then(work);
};

/** Calls `listener` once the store is in memory; for `useSyncExternalStore`. */
export const subscribePoolFilled = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Only for tests: forgets any fill, so the next one starts afresh. */
export const resetPoolFill = (): void => {
  filling = null;
  filled = true;
  hurry = null;
  listeners.clear();
};
