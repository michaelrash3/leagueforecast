import type { ActiveShareView } from "./types";

/** The League view in the address bar, so a reload or an update comes back to the same tab. */
export const TAB_PARAM = "tab";

/*
 * A record rather than a list so that a view added to the union and forgotten here is a type error
 * rather than a tab the address bar cannot hold. The value is unused; the keys are the point.
 */
const TABS: Record<ActiveShareView, true> = {
  dashboard: true,
  power: true,
  standings: true,
  teamStats: true,
  games: true,
  model: true,
  quality: true,
  settings: true,
};

const isTab = (value: string): value is ActiveShareView =>
  Object.prototype.hasOwnProperty.call(TABS, value);

/** The tab a search string names, or null for none or for one this build does not know. */
export const tabFromSearch = (search: string): ActiveShareView | null => {
  const value = new URLSearchParams(search).get(TAB_PARAM);
  return value !== null && isTab(value) ? value : null;
};

/**
 * The search string with this tab in it. The Dashboard is where the app opens anyway, so it is
 * left out rather than written, and a plain address stays plain. Every other parameter is kept:
 * Team Rankings' page and a `?team=` link sit alongside it.
 */
export const searchWithTab = (search: string, tab: ActiveShareView): string => {
  const params = new URLSearchParams(search);
  if (tab === "dashboard") params.delete(TAB_PARAM);
  else params.set(TAB_PARAM, tab);
  const next = params.toString();
  return next ? `?${next}` : "";
};
