import { describe, expect, it } from "vitest";
import type { CloudStatus } from "../cloudSession";
import { pullBlockedBy } from "../pullGate";

/*
 * Whether the import panel lets a pull start: the proxy is for the accounts on the cloud copy's
 * list, so a browser that already knows it is not one says so before a run, rather than after.
 */
const ME = { uid: "u1", email: "coach@example.com" };

describe("whether this browser can pull from GameChanger", () => {
  it("cannot with nobody signed in, and says to sign in", () => {
    for (const status of [{ kind: "none" }, { kind: "signed-out" }] as const) {
      expect(pullBlockedBy(status)).toMatch(/Sign in with one from the cloud button/);
    }
  });

  it("cannot with an account the copy refused, and names it", () => {
    expect(pullBlockedBy({ kind: "not-owner", account: ME })).toMatch(
      /^coach@example\.com is not on the cloud copy's list/
    );
    expect(pullBlockedBy({ kind: "not-owner", account: { uid: "u2", email: null } })).toMatch(
      /^This Google account is not on/
    );
  });

  it("leaves everything else to the proxy's own answer", () => {
    const statuses: CloudStatus[] = [
      { kind: "off" },
      { kind: "connecting" },
      { kind: "saved", account: ME, owed: false, newer: [] },
      { kind: "working", account: ME, label: "Saving…" },
      { kind: "error", account: ME, message: "Could not reach the cloud." },
      { kind: "error", account: null, message: "Could not reach the cloud." },
      { kind: "update", account: ME },
      { kind: "gone", account: ME },
    ];
    for (const status of statuses) expect(pullBlockedBy(status)).toBeNull();
  });
});
