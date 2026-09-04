import { useCallback, useSyncExternalStore } from "react";

/**
 * Tracks a media query.
 *
 * `matchMedia` is an external store, so this reads it through
 * `useSyncExternalStore` rather than mirroring it into state and pushing updates
 * from an effect. That keeps the value correct on the very first paint and when
 * `query` itself changes — the mirrored version was briefly stale in both cases,
 * because the state only caught up one render later.
 */
export function useBreakpoint(query: string, fallback = false) {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onStoreChange);
      return () => mq.removeEventListener("change", onStoreChange);
    },
    [query]
  );

  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined" || !window.matchMedia) return fallback;
    return window.matchMedia(query).matches;
  }, [query, fallback]);

  // No window to measure, so the caller's stated default stands in.
  const getServerSnapshot = useCallback(() => fallback, [fallback]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export const useIsDesktop = () => useBreakpoint("(min-width: 768px)", true);
