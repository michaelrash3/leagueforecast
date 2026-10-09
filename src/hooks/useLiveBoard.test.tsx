import { beforeEach, describe, expect, it } from "vitest";
import { LEAGUE_PART } from "../lib/cloud/cloudPlan";
import { loadCloudState, markCloudDirty, saveCloudState } from "../lib/cloud/cloudState";
import { noteLeagueMet, writeLiveLeague } from "../lib/preferences";
import { browserLiveSources } from "./useLiveBoard";

/*
 * The live board's own sources, as the site reads them. What the board asks is owed before it
 * calls itself the copy's is what the copy is owed: League kept live goes to its own documents,
 * which the boards are built from, and counted owed it held every board as waiting on this device.
 */
describe("the browser's own sources for the live board", () => {
  beforeEach(() => {
    localStorage.clear();
    saveCloudState({ ...loadCloudState(), enabled: true, uid: "member-uid" });
  });

  it("owe the copy nothing for League kept live, and League again once it is not", () => {
    markCloudDirty(LEAGUE_PART);
    writeLiveLeague(true);
    noteLeagueMet("member-uid");
    expect(browserLiveSources().owed()).toEqual([]);
    writeLiveLeague(false);
    expect(browserLiveSources().owed()).toEqual([LEAGUE_PART]);
  });

  it("owe the copy no League with the switch on, before the first meeting as after it", () => {
    markCloudDirty(LEAGUE_PART);
    // On by default: a change made before the first meeting waits for the cloud's documents,
    // and is sent to no copy (1.6e review), so no board waits on it.
    expect(browserLiveSources().owed()).toEqual([]);
    noteLeagueMet("member-uid");
    expect(browserLiveSources().owed()).toEqual([]);
  });
});
