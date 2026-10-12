import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether the viewport is at least Tailwind's `sm` — the width the tables are laid out for.
 *
 * A table and a stacked card list can both be in the document with CSS hiding one, and for a card
 * of six rows that is the simplest thing that works. It is the wrong answer for the rankings
 * table, which is bounded to a first page precisely because rendering a nationwide page was "more
 * memory than the pool behind it": rendering every visible row twice puts half of that straight
 * back, and on the slower of two machines it was enough to push a test past its timeout.
 *
 * So the breakpoint is read rather than styled around, and one shape is rendered. `640px` is
 * Tailwind's `sm` and has to stay in step with the `sm:` classes beside it; it is written here
 * because a media query string cannot be read out of a class name.
 */
const WIDE = "(min-width: 640px)";

export const useWideViewport = (): boolean => {
  const subscribe = useCallback((notify: () => void) => {
    const query = window.matchMedia?.(WIDE);
    if (!query) return () => {};
    query.addEventListener("change", notify);
    return () => query.removeEventListener("change", notify);
  }, []);

  /*
   * Wide when there is nothing to ask — an old browser, or jsdom, where `matchMedia` is simply
   * absent. The table is what every caller had before this existed, so a browser that cannot
   * answer keeps it rather than being handed the phone layout by accident.
   */
  const read = useCallback(() => window.matchMedia?.(WIDE).matches ?? true, []);

  return useSyncExternalStore(subscribe, read, () => true);
};

const NARROW = "(max-width: 639px)";

/**
 * Whether the viewport is below `sm`, a phone held upright, where the app's tab rows become a bar
 * along the bottom of the screen with More for the rest (2.4).
 *
 * Asked as a question of its own rather than as `!useWideViewport()`, so that a `matchMedia` that
 * answers no to everything (jsdom's stub in the app's tests) or none at all keeps the tab row every
 * caller had before the bar, not the bar. In a browser the two queries split at the same width.
 */
export const useNarrowViewport = (): boolean => {
  const subscribe = useCallback((notify: () => void) => {
    const query = window.matchMedia?.(NARROW);
    if (!query) return () => {};
    query.addEventListener("change", notify);
    return () => query.removeEventListener("change", notify);
  }, []);
  const read = useCallback(() => window.matchMedia?.(NARROW).matches ?? false, []);
  return useSyncExternalStore(subscribe, read, () => false);
};
