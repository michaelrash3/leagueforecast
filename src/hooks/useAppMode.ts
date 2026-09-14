import { useEffect, useState } from "react";
import { readAppMode, writeAppMode, type AppMode } from "../lib/preferences";
import { parseRankingsRoute, rankingsSearch } from "../lib/rankingsRoute";

export type { AppMode };

/**
 * Which of the two modes the app is in.
 *
 * A `?view=` in the URL wins on arrival, so a link to a Team Rankings page opens on that page
 * instead of wherever this browser happened to be last. With no such parameter it is the stored
 * preference, as it has always been.
 *
 * The mode is written back into the URL as it changes, because Team Rankings puts its own page
 * there: leaving a stale `?view=rankings` behind after a switch to League Standings would send the
 * next reload back to a mode the user had just left. The age and year alongside it are kept, so
 * switching away and back returns to the same page. Replaced rather than pushed — the mode switch
 * is already a visible change, and Back should leave the app rather than toggle it.
 */
export function useAppMode() {
  const [appMode, setAppMode] = useState<AppMode>(
    () =>
      (typeof window === "undefined" ? null : parseRankingsRoute(window.location.search).mode) ??
      readAppMode() ??
      "league"
  );

  useEffect(() => {
    writeAppMode(appMode);
    if (typeof window === "undefined") return;
    const current = parseRankingsRoute(window.location.search);
    if (current.mode === appMode) return;
    const search = rankingsSearch(window.location.search, { ...current, mode: appMode });
    history.replaceState(null, "", `${window.location.pathname}${search}${window.location.hash}`);
  }, [appMode]);

  return { appMode, setAppMode };
}
