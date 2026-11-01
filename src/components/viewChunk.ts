import { createElement, lazy, useState, type ComponentType } from "react";

/**
 * A view loaded on demand: League Standings' views (2.1, `league/leagueViews.ts`) and Team
 * Rankings' sections (`teamRankings/sections.ts`), each a chunk of its own whose markup arrives
 * when it is first shown, or a little before (`prefetch`).
 *
 * A view already loaded is drawn at once, with no placeholder in between, so going back to a tab
 * never flickers; one still loading suspends, and the page's boundary shows a placeholder. A load
 * that fails is forgotten (`reset`), so trying again fetches afresh rather than repeating the
 * failure React's own `lazy` keeps for good. Each chunk's boundary must call it: the tabs' through
 * `resetView` and `resetSection`, the drawers' and the explanation's through their own. A browser
 * may keep the failed download as well, for the rest of the visit (Chromium 141 answers the same
 * chunk with the same failure and sends no request), which only a reload clears, so every boundary
 * offers one.
 */
export type ViewChunk<P extends object> = {
  View: ComponentType<P>;
  /** Starts the load, if it has not started, without waiting on it or failing on it. */
  prefetch: () => Promise<void>;
  /** Forgets a failed load, so the next render loads afresh. */
  reset: () => void;
};

export const viewChunk = <P extends object>(
  load: () => Promise<ComponentType<P>>,
  name: string
): ViewChunk<P> => {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;
  const start = (): Promise<ComponentType<P>> =>
    (pending ??= load().then(
      (component) => (loaded = component),
      (error: unknown) => {
        pending = null;
        throw error;
      }
    ));
  const lazyOne = () => lazy(() => start().then((component) => ({ default: component })));
  let Lazy = lazyOne();
  /*
   * Whichever of the two a view is first drawn through, it keeps for as long as it is on screen.
   * The loader and the loaded view are two kinds of element to React, so one drawn through the
   * loader and then, once loaded, directly is taken away and drawn afresh, losing whatever was
   * picked inside it. That happened whenever the load landed while React was waiting on it in a
   * background render: React then picks up at the loader and does not ask the view again.
   */
  const View = (props: P) => {
    const [Drawn] = useState<ComponentType<P>>(() => loaded ?? Lazy);
    return createElement(Drawn, props);
  };
  View.displayName = name;
  return {
    View,
    prefetch: () =>
      start().then(
        () => undefined,
        () => undefined
      ),
    reset: () => {
      pending = null;
      Lazy = lazyOne();
    },
  };
};
