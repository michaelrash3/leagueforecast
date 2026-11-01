import type { ActiveShareView as ActiveView } from "../../lib/types";
import { viewChunk, type ViewChunk } from "../viewChunk";

export { viewChunk, type ViewChunk } from "../viewChunk";

/*
 * League Standings' views, each loaded on demand (2.1). The first download used to carry every
 * view whichever one was opened; now it carries the app's state and calculations, and a view's
 * own markup arrives when it is first shown, or a little before (`prefetchView`). How a view is
 * loaded, drawn and loaded again after a failure is `viewChunk`'s, which Team Rankings' sections
 * are loaded through too (`teamRankings/sections.ts`).
 */

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
/**
 * The start screen of a season with no teams yet. Seen once per new season and never by someone
 * returning to one, so it is fetched when shown rather than kept in the first download, which had
 * no room left for the schedule paste (`bundleBudget.mjs`). It is drawn inside the views' boundary,
 * whose Try again resets it along with the tab's own chunks (`App.tsx`).
 */
export const emptyStateView = viewChunk(
  () => import("./EmptyState").then((module) => module.EmptyState),
  "EmptyState"
);
/**
 * A league site's schedule pasted in and looked over, opened from the empty season's start screen
 * or the Schedule tab's "No games yet". Drawn inside the views' boundary too, whose Try again resets
 * it with the rest (`App.tsx`): loaded through React's own `lazy`, a download that failed once kept
 * failing until the page was reloaded (found by Codex on #456).
 */
export const schedulePasteView = viewChunk(
  () => import("./LeagueSchedulePaste").then((module) => module.default),
  "LeagueSchedulePaste"
);
/** Two teams side by side, opened only from a team's panel (2.7): fetched then, not with the page. */
export const compareDrawerView = viewChunk(
  () => import("../CompareDrawer").then((module) => module.CompareDrawer),
  "CompareDrawer"
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
    .then(() => Promise.all([teamDrawerView.prefetch(), compareDrawerView.prefetch()]))
    .then(() => undefined);
