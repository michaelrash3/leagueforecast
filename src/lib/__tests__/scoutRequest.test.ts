import { describe, expect, it } from "vitest";
import { askToScout, scoutAsked, scoutTaken } from "../scoutRequest";

describe("the club League Standings asked Team Rankings to scout", () => {
  it("is held until a page has it on screen, and then gone", () => {
    expect(scoutAsked()).toBeNull();
    askToScout("S-HIVE");
    // Read as a page's state starts, which React may do twice: still there the second time.
    expect(scoutAsked()).toBe("S-HIVE");
    expect(scoutAsked()).toBe("S-HIVE");
    scoutTaken();
    expect(scoutAsked()).toBeNull();
  });

  it("is the latest club asked for", () => {
    askToScout("S-HIVE");
    askToScout("S-OWLS");
    expect(scoutAsked()).toBe("S-OWLS");
    scoutTaken();
  });
});
