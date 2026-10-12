import { FIREBASE_WEB_CONFIG } from "./cloudConfig.ts";
import { functionUrl } from "./functionsUrl.ts";

/** Vercel serves the static app; both browser APIs run on this Firebase project. */
export const GC_TEAM_FUNCTION_URL = functionUrl(FIREBASE_WEB_CONFIG.projectId, "gcTeam");
export const LEAGUE_SUMMARY_FUNCTION_URL = functionUrl(
  FIREBASE_WEB_CONFIG.projectId,
  "leagueSummary"
);
