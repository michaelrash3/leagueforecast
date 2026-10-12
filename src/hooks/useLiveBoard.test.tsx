import { beforeEach, describe, expect, it } from "vitest";
import { LEAGUE_PART } from "../lib/cloud/cloudPlan";
import { loadCloudState, markCloudDirty, saveCloudState } from "../lib/cloud/cloudState";
import { noteLeagueMet } from "../lib/preferences";
import { browserLiveSources } from "./useLiveBoard";

/*
 * The live board's own sources, as the site reads them. What the board asks is owed before it
 * calls itself the copy's is what the copy is owed: nothing, since no device writes it (1.6f), and
 * counted owed, a change made here held every board as waiting on this device.
 */
describe("the browser's own sources for the live board", () => {
  beforeEach(() => {
    localStorage.clear();
    saveCloudState({ ...loadCloudState(), enabled: true, uid: "member-uid" });
  });

  it("owe the copy nothing, before the first meeting as after it", () => {
    markCloudDirty(LEAGUE_PART);
    markCloudDirty("league_forecast_scout_teams_v1");
    // No device writes the copy (1.6f): a change made here is sent to no copy, so no board waits
    // on it.
    expect(browserLiveSources().owed()).toEqual([]);
    noteLeagueMet("member-uid");
    expect(browserLiveSources().owed()).toEqual([]);
  });
});
