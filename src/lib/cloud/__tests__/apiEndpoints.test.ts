import { describe, expect, it } from "vitest";
import { GC_TEAM_FUNCTION_URL, LEAGUE_SUMMARY_FUNCTION_URL } from "../apiEndpoints";
import { FIREBASE_WEB_CONFIG } from "../cloudConfig";
import { functionUrl } from "../functionsUrl";
import { GC_TEAM_ENDPOINT } from "../../gameChangerApi";
import { gcProxyEndpoint } from "../../gameChangerClient";
import { LEAGUE_SUMMARY_ENDPOINT } from "../../leagueSummary";

describe("the static app's API defaults", () => {
  it("uses this project's Firebase functions with no build setting", () => {
    expect(GC_TEAM_FUNCTION_URL).toBe(functionUrl(FIREBASE_WEB_CONFIG.projectId, "gcTeam"));
    expect(LEAGUE_SUMMARY_FUNCTION_URL).toBe(
      functionUrl(FIREBASE_WEB_CONFIG.projectId, "leagueSummary")
    );
    expect(GC_TEAM_ENDPOINT).toBe(GC_TEAM_FUNCTION_URL);
    expect(gcProxyEndpoint(undefined)).toBe(GC_TEAM_FUNCTION_URL);
    expect(gcProxyEndpoint(" ")).toBe(GC_TEAM_FUNCTION_URL);
    expect(LEAGUE_SUMMARY_ENDPOINT).toBe(LEAGUE_SUMMARY_FUNCTION_URL);
  });
});
