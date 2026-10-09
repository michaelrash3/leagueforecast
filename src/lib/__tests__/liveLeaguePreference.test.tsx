import { beforeEach, describe, expect, it, vi } from "vitest";
import { leagueMetAs, noteLeagueMet, subscribeLeagueMet } from "../preferences";
import { leagueMetHere, loadCloudState, saveCloudState } from "../cloud/cloudState";
import { forgetAppKeys } from "../resetApp";

/*
 * The account this device has met the cloud's League documents as, which the copy's carrying
 * League waits on, heard by whoever is listening. A member's League is always kept live (1.6f).
 */

beforeEach(() => window.localStorage.clear());

describe("the cloud's League documents met here", () => {
  it("is no account until noted, then the account noted, and its noting is heard", () => {
    const heard = vi.fn();
    const stop = subscribeLeagueMet(heard);
    expect(leagueMetAs()).toBeNull();
    noteLeagueMet("member-uid");
    expect(leagueMetAs()).toBe("member-uid");
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
  });

  it("is forgotten with the rest of the app's keys", () => {
    noteLeagueMet("member-uid");
    forgetAppKeys(window.localStorage);
    expect(leagueMetAs()).toBeNull();
  });

  it("is met on this device, whichever account is signed in after", () => {
    expect(leagueMetHere()).toBe(false);
    saveCloudState({ ...loadCloudState(), enabled: true, uid: "member-uid" });
    expect(leagueMetHere()).toBe(false);
    noteLeagueMet("member-uid");
    expect(leagueMetHere()).toBe(true);
    // Every account on the list shares one cloud: another signing in here has met it too, and
    // the copy's older League is not taken in over the live seasons (1.6e review).
    saveCloudState({ ...loadCloudState(), uid: "another-uid" });
    expect(leagueMetHere()).toBe(true);
  });
});
