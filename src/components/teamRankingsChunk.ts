/**
 * Team Rankings' code, loaded on demand: by the app when the page opens, and by the live board
 * (`LiveTeamRankings`) ahead of its handover, so the page is there when the board hands over.
 */
export const loadTeamRankingsView = () => import("./TeamRankingsView");
