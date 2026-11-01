import type { RankingsSection } from "../lib/rankingsRoute";

/**
 * Team Rankings' code, loaded on demand: by the app when the page opens, and by the live board
 * (`LiveTeamRankings`) ahead of its handover, so the page is there when the board hands over.
 */
export const loadTeamRankingsView = () => import("./TeamRankingsView");

/**
 * The live board's preload: the page's code, and given a section, that section's own, which the
 * page otherwise fetches only as the section is first drawn (`teamRankings/sections.ts`). Asked
 * of the page's own module, so the sections' loaders stay in its file rather than one of their own.
 */
export const preloadTeamRankings = (section?: RankingsSection): Promise<void> =>
  loadTeamRankingsView().then((page) => (section ? page.prefetchSection(section) : undefined));
