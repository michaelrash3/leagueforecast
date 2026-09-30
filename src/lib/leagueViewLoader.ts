import type { ActiveShareView } from "./types";

type LeagueViewModule = object;
type LeagueViewImporter = () => Promise<LeagueViewModule>;

/**
 * Kept outside App so navigation can warm exactly one likely destination without rendering it.
 * The same promise is reused by React.lazy and prefetch, so a hover can never issue a duplicate
 * chunk request while an idle prefetch is already in flight.
 */
const importers: Record<ActiveShareView, LeagueViewImporter> = {
  dashboard: () => import("../components/league/DashboardView"),
  power: () => import("../components/league/PowerRatingsView"),
  games: () => import("../components/league/GamesView"),
  standings: () => import("../components/league/StandingsView"),
  teamStats: () => import("../components/league/TeamStatsView"),
  model: () => import("../components/league/ModelView"),
  dataQuality: () => import("../components/league/DataQualityView"),
  settings: () => import("../components/league/SettingsView"),
};

const pending = new Map<ActiveShareView, Promise<LeagueViewModule>>();

export const loadLeagueView = (view: ActiveShareView): Promise<LeagueViewModule> => {
  const existing = pending.get(view);
  if (existing) return existing;

  const request = importers[view]().catch((error: unknown) => {
    // React.lazy caches its rejection, but the loader must not: a new lazy generation created by
    // the recovery action needs to be able to issue a fresh request after connectivity returns.
    if (pending.get(view) === request) pending.delete(view);
    throw error;
  });
  pending.set(view, request);
  return request;
};

/** Forget a fulfilled or rejected generation before constructing a fresh React.lazy wrapper. */
export const resetLeagueViewLoad = (view: ActiveShareView): void => {
  pending.delete(view);
};

export const likelyLeagueViewAfter = (view: ActiveShareView): ActiveShareView | null => {
  if (view === "dashboard") return "games";
  if (view === "standings") return "model";
  return null;
};

export const prefetchLeagueView = (view: ActiveShareView): void => {
  void loadLeagueView(view).catch(() => undefined);
};
