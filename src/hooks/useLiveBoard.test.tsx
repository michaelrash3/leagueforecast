import { beforeEach, describe, expect, it } from "vitest";
import { LEAGUE_PART } from "../lib/cloud/cloudPlan";
import { loadCloudState, markCloudDirty, saveCloudState } from "../lib/cloud/cloudState";
import { writeLiveLeague } from "../lib/preferences";
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
    expect(browserLiveSources().owed()).toEqual([]);
    writeLiveLeague(false);
    expect(browserLiveSources().owed()).toEqual([LEAGUE_PART]);
  });
});
