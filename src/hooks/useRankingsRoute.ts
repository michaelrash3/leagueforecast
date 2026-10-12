import { useCallback, useEffect, useState } from "react";
import {
  parseRankingsRoute,
  rankingsSearch,
  sameRankingsRoute,
  type RankingsRoute,
} from "../lib/rankingsRoute";

const currentUrl = (): string =>
  `${window.location.pathname}${window.location.search}${window.location.hash}`;

/**
 * Binds the Team Rankings page — mode, age level and season year — to the query string, so every
 * page is a link somebody can send.
 *
 * Two ways to write it, because they mean different things to the back button. `push` is for a
 * page the user asked for by clicking a tab or changing the season: it leaves a history entry, so
 * Back returns to the page they came from. `replace` is for the app tidying the URL after the
 * fact — filling in the page it opened on, or correcting a link to an age group that no longer
 * exists — which should not be somewhere Back can land.
 *
 * The share feature keeps its snapshot in `location.hash`, which both of these carry through
 * untouched.
 */
export function useRankingsRoute() {
  const [route, setRoute] = useState<RankingsRoute>(() =>
    typeof window === "undefined" ? {} : parseRankingsRoute(window.location.search)
  );

  useEffect(() => {
    const handler = () => setRoute(parseRankingsRoute(window.location.search));
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  const write = useCallback((next: RankingsRoute, mode: "push" | "replace") => {
    if (typeof window === "undefined") return;
    const search = rankingsSearch(window.location.search, next);
    const url = `${window.location.pathname}${search}${window.location.hash}`;
    // Writing the same URL again would add a history entry that goes nowhere.
    if (url !== currentUrl()) {
      if (mode === "push") history.pushState(null, "", url);
      else history.replaceState(null, "", url);
    }
    // Compared rather than assigned, so a route that says the same thing does not re-render.
    setRoute((current) => (sameRankingsRoute(current, next) ? current : next));
  }, []);

  const push = useCallback((next: RankingsRoute) => write(next, "push"), [write]);
  const replace = useCallback((next: RankingsRoute) => write(next, "replace"), [write]);

  return { route, push, replace };
}
