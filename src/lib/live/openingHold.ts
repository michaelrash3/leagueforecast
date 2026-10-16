/**
 * The phone to the board alone, as Team Rankings opens on the cloud's board: what the page does
 * besides drawing it waits until the board is drawn (or the page has said why it cannot be), or
 * until `OPENING_HOLD_MS` has passed, whichever comes first.
 *
 * A phone opening the page did everything at once. Beside the board's own meta and pieces it
 * fetched and parsed Team Rankings' own page code for a handover that seldom comes, read the
 * page's own club's card bucket, loaded the full Firestore SDK for the watch on the meta (130 KB
 * gzipped in the build of 16 October 2026), started League Standings' listener and its fetch of
 * every season, and asked the server about the open season for League's forecast: each of them
 * worth having a second later, and each taking the network and the main thread from the board in
 * the seconds the reader is waiting on it. League Standings on screen is held back by none of it:
 * each caller decides whether it waits, by asking which page is shown.
 *
 * Released once, for the page's life: the hold is for the first draw, and a board drawn since
 * opens with nothing held.
 */

/** The longest anything waits for the board's first draw. */
export const OPENING_HOLD_MS = 3_000;

let released = false;
let clock: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

/** The board is drawn, or the page has said why not: what waited goes ahead. */
export const releaseOpening = (): void => {
  if (released) return;
  released = true;
  if (clock !== null) clearTimeout(clock);
  clock = null;
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      /* one that cannot cope must not hold back the others */
    }
  });
  listeners.clear();
};

/** Whether what waits on the first draw may go ahead. */
export const openingReleased = (): boolean => released;

/**
 * Calls `listener` at the release; for `useSyncExternalStore`. The first to ask starts the clock,
 * so the hold is counted from the page's first draw rather than from the script's loading.
 */
export const subscribeOpening = (listener: () => void): (() => void) => {
  if (!released && clock === null) clock = setTimeout(releaseOpening, OPENING_HOLD_MS);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Resolves at the release, at once where it has come. */
export const afterOpening = (): Promise<void> =>
  released
    ? Promise.resolve()
    : new Promise((resolve) => {
        const stop = subscribeOpening(() => {
          stop();
          resolve();
        });
      });

/** Only for tests: holds again, with no clock running. */
export const resetOpeningHold = (): void => {
  released = false;
  if (clock !== null) clearTimeout(clock);
  clock = null;
  listeners.clear();
};
