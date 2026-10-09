import { describe, expect, it } from "vitest";
import type { Area } from "../../cloud/cloudPlan";
import type { CloudStatus } from "../../cloud/cloudSession";
import {
  leagueLiveWanted,
  memberSignedIn,
  SEASON_DELETE_OFFLINE,
  seasonDeleteRefused,
  seasonDeleteRoute,
} from "../leagueWanted";

/*
 * When League Standings is kept live on a device (1.6e, always for a member since 1.6f): a member
 * signed in, and either the cloud's League documents met here before, or, for its first meeting, this device in
 * step with the copy, so the seasons it first sends up are the copy's. And how a season is deleted
 * on it, which a member's device does only through the cloud (1.6e review).
 */

const ME = { uid: "member-uid", email: "member@example.com" };
const saved = (newer: Area[] = []): CloudStatus => ({
  kind: "saved",
  account: ME,
  owed: false,
  newer,
});

describe("League kept live on a device", () => {
  it("is a member signed in, whatever the copy is doing", () => {
    const yes: CloudStatus[] = [
      saved(),
      { kind: "working", account: ME, label: "Saving…" },
      { kind: "gone", account: ME },
      { kind: "update", account: ME },
      { kind: "error", account: ME, message: "Offline." },
    ];
    const no: CloudStatus[] = [
      { kind: "off" },
      { kind: "none" },
      { kind: "signed-out" },
      { kind: "connecting" },
      { kind: "not-owner", account: ME },
      { kind: "error", account: null, message: "No account." },
    ];
    expect(yes.map(memberSignedIn)).toEqual(yes.map(() => true));
    expect(no.map(memberSignedIn)).toEqual(no.map(() => false));
  });

  it("is never for anyone but a member", () => {
    expect(leagueLiveWanted({ status: { kind: "none" }, met: true, inStep: true })).toBe(false);
  });

  it("is live whatever the copy is doing once met here", () => {
    for (const status of [
      saved(["league"]),
      { kind: "working", account: ME, label: "Saving…" },
      { kind: "error", account: ME, message: "Offline." },
    ] as CloudStatus[])
      expect(leagueLiveWanted({ status, met: true, inStep: false })).toBe(true);
  });

  it("meets the cloud for the first time only in step with the copy", () => {
    expect(leagueLiveWanted({ status: saved(), met: false, inStep: true })).toBe(true);
    // A pool newer elsewhere says nothing of League.
    expect(leagueLiveWanted({ status: saved(["pool"]), met: false, inStep: true })).toBe(true);
    for (const status of [
      saved(["league"]),
      { kind: "working", account: ME, label: "Taking the cloud's changes…" },
      { kind: "error", account: ME, message: "Offline." },
      { kind: "gone", account: ME },
    ] as CloudStatus[])
      expect(leagueLiveWanted({ status, met: false, inStep: true })).toBe(false);
    // Saved is not in step: said by a boot that stopped waiting on a copy too slow to read, or
    // by a settlement that set aside a League arriving while one was edited here.
    expect(leagueLiveWanted({ status: saved(), met: false, inStep: false })).toBe(false);
  });
});

describe("a season deleted on a device", () => {
  it("is this device's own in a browser no member signed in to", () => {
    expect(seasonDeleteRoute({ live: false, memberDevice: false })).toBe("here");
  });

  it("goes from the cloud first with League kept live this moment", () => {
    expect(seasonDeleteRoute({ live: true, memberDevice: true })).toBe("cloud");
  });

  it("is refused on a member's device whose League is not live this moment", () => {
    // Offline, signed out, or still to meet the cloud's seasons: deleted here alone, the
    // season's document would bring it back at the next meeting.
    expect(seasonDeleteRoute({ live: false, memberDevice: true })).toBe("refuse");
  });

  it("says why it was refused: still meeting the cloud, or not connected to it", () => {
    expect(seasonDeleteRefused(saved())).toMatch(/still being brought in step/);
    expect(seasonDeleteRefused({ kind: "signed-out" })).toBe(SEASON_DELETE_OFFLINE);
    expect(seasonDeleteRefused({ kind: "connecting" })).toBe(SEASON_DELETE_OFFLINE);
  });
});
