import { describe, expect, it } from "vitest";
import type { Area } from "../../cloud/cloudPlan";
import type { CloudStatus } from "../../cloud/cloudSession";
import { leagueLiveWanted, memberSignedIn } from "../leagueWanted";

/*
 * When League Standings is kept live on a device (1.6e): its switch on, a member signed in, and
 * either the cloud's League documents met here before, or, for its first meeting, this device in
 * step with the copy, so the seasons it first sends up are the copy's.
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

  it("is never with the switch off, nor for anyone but a member", () => {
    expect(leagueLiveWanted({ on: false, status: saved(), met: true })).toBe(false);
    expect(leagueLiveWanted({ on: true, status: { kind: "none" }, met: true })).toBe(false);
  });

  it("is live whatever the copy is doing once met here", () => {
    for (const status of [
      saved(["league"]),
      { kind: "working", account: ME, label: "Saving…" },
      { kind: "error", account: ME, message: "Offline." },
    ] as CloudStatus[])
      expect(leagueLiveWanted({ on: true, status, met: true })).toBe(true);
  });

  it("meets the cloud for the first time only in step with the copy", () => {
    expect(leagueLiveWanted({ on: true, status: saved(), met: false })).toBe(true);
    // A pool newer elsewhere says nothing of League.
    expect(leagueLiveWanted({ on: true, status: saved(["pool"]), met: false })).toBe(true);
    for (const status of [
      saved(["league"]),
      { kind: "working", account: ME, label: "Taking the cloud's changes…" },
      { kind: "error", account: ME, message: "Offline." },
      { kind: "gone", account: ME },
    ] as CloudStatus[])
      expect(leagueLiveWanted({ on: true, status, met: false })).toBe(false);
  });
});
