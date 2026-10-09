import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  leagueMetAs,
  noteLeagueMet,
  readLiveLeague,
  subscribeLiveLeague,
  writeLiveLeague,
} from "../preferences";
import { leagueMetHere, loadCloudState, saveCloudState } from "../cloud/cloudState";
import { forgetAppKeys } from "../resetApp";

/*
 * This device's switch for keeping League Standings live: on unless turned off (1.6e), heard by
 * whoever is listening, and gone with the rest of the app's keys, which puts it back on; and the
 * account it has met the cloud's League documents as, which the copy's carrying League waits on.
 */

beforeEach(() => window.localStorage.clear());

describe("the switch for League kept live", () => {
  it("is on until turned off, and off until turned on again", () => {
    expect(readLiveLeague()).toBe(true);
    writeLiveLeague(false);
    expect(readLiveLeague()).toBe(false);
    expect(window.localStorage.getItem("lf_live_league_v1")).toBe("off");
    writeLiveLeague(true);
    expect(readLiveLeague()).toBe(true);
  });

  it("is off only for its own word for off", () => {
    window.localStorage.setItem("lf_live_league_v1", "false");
    expect(readLiveLeague()).toBe(true);
  });

  it("is forgotten with the rest of the app's keys, and on again", () => {
    writeLiveLeague(false);
    forgetAppKeys(window.localStorage);
    expect(readLiveLeague()).toBe(true);
  });
});

describe("the cloud's League documents met here", () => {
  it("is no account until noted, then the account noted, and its noting is heard", () => {
    const heard = vi.fn();
    const stop = subscribeLiveLeague(heard);
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
