import { useEffect, useState } from "react";

export function useBreakpoint(query: string, fallback = false) {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return fallback;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    const handler = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [query]);

  return matches;
}

export const useIsDesktop = () => useBreakpoint("(min-width: 768px)", true);
