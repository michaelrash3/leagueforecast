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

  it("owe the copy League, switch on, until this device has met the cloud's seasons", () => {
    markCloudDirty(LEAGUE_PART);
    // On by default, and the copy carries League here until the first meeting.
    expect(browserLiveSources().owed()).toEqual([LEAGUE_PART]);
    noteLeagueMet("member-uid");
    expect(browserLiveSources().owed()).toEqual([]);
  });
});
