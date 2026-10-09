import { createElement, lazy, type ComponentType } from "react";
import type { ActiveShareView as ActiveView } from "../../lib/types";

/**
 * League Standings' views, each loaded on demand (2.1). The first download used to carry every
 * view whichever one was opened; now it carries the app's state and calculations, and a view's
 * own markup arrives when it is first shown, or a little before (`prefetchView`).
 *
 * A view already loaded is drawn at once, with no placeholder in between, so going back to a tab
 * never flickers; one still loading suspends, and the page's boundary shows a placeholder. A load
 * that fails is forgotten (`reset`), so trying again fetches afresh rather than repeating the
 * failure React's own `lazy` keeps for good.
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
  const View = (props: P) => (loaded ? createElement(loaded, props) : createElement(Lazy, props));
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

export const dashboardView = viewChunk(
  () => import("./DashboardView").then((module) => module.DashboardView),
  "DashboardView"
);
export const powerView = viewChunk(
  () => import("./PowerRatingsView").then((module) => module.PowerRatingsView),
  "PowerRatingsView"
);
export const standingsView = viewChunk(
  () => import("./StandingsView").then((module) => module.StandingsView),
  "StandingsView"
);
export const statsView = viewChunk(
  () => import("./TeamStatsView").then((module) => module.TeamStatsView),
  "TeamStatsView"
);
export const forecastView = viewChunk(
  () => import("./ModelView").then((module) => module.ModelView),
  "ModelView"
);
/** The Forecast tab's playoff machine, which the app builds and hands the tab already drawn. */
export const playoffMachineView = viewChunk(
  () => import("./PlayoffMachine").then((module) => module.PlayoffMachine),
  "PlayoffMachine"
);
export const scheduleView = viewChunk(
  () => import("./GamesView").then((module) => module.GamesView),
  "GamesView"
);
export const qualityView = viewChunk(
  () => import("./DataQualityView").then((module) => module.DataQualityView),
  "DataQualityView"
);
export const settingsView = viewChunk(
  () => import("./SettingsView").then((module) => module.SettingsView),
  "SettingsView"
);
export const seasonManagerView = viewChunk(
  () => import("./SeasonManager").then((module) => module.SeasonManager),
  "SeasonManager"
);
export const scoutLinkView = viewChunk(
  () => import("../ScoutLinkPanel").then((module) => module.ScoutLinkPanel),
  "ScoutLinkPanel"
);
export const teamDrawerView = viewChunk(
  () => import("./TeamDrawer").then((module) => module.TeamDrawer),
  "TeamDrawer"
);

/** What loading a chunk asks of it, whatever its view draws. */
type Loadable = Pick<ViewChunk<object>, "prefetch" | "reset">;

/** What each tab draws, every chunk it needs to show at all. */
const CHUNKS_OF: Record<ActiveView, readonly Loadable[]> = {
  dashboard: [dashboardView],
  power: [powerView],
  standings: [standingsView],
  teamStats: [statsView],
  model: [forecastView, playoffMachineView],
  games: [scheduleView],
  quality: [qualityView],
  settings: [seasonManagerView, scoutLinkView, settingsView],
};

/** Starts loading a tab's chunks: on a hover or focus of its tab, and for the likely next tab. */
export const prefetchView = (view: ActiveView): Promise<void> =>
  Promise.all(CHUNKS_OF[view].map((chunk) => chunk.prefetch())).then(() => undefined);

/** Forgets a tab's failed loads, so its boundary's Try again fetches afresh. */
export const resetView = (view: ActiveView): void => {
  CHUNKS_OF[view].forEach((chunk) => chunk.reset());
};

/**
 * The tab most often opened after this one, loaded once this one is drawn and the browser is idle:
 * the schedule after the dashboard, where a score is entered, and the forecast after the
 * standings. Only these, rather than every view, so a phone on one bar fetches what it is likely
 * to show and nothing more.
 */
export const LIKELY_NEXT: Partial<Record<ActiveView, ActiveView>> = {
  dashboard: "games",
  standings: "model",
};

/** Every view's chunks, loaded: for a test that wants the views drawn at once. */
export const prefetchAllViews = (): Promise<void> =>
  Promise.all(Object.values(CHUNKS_OF).flatMap((chunks) => chunks.map((chunk) => chunk.prefetch())))
    .then(() => teamDrawerView.prefetch())
    .then(() => undefined);
