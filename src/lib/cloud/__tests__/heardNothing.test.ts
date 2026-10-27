import { describe, expect, it } from "vitest";
import { heardNothing } from "../cloudRunner";

/*
 * A night that asked GameChanger about its teams and heard back about none of them ended green:
 * nothing changed, so nothing was saved, and "Nothing in the copy changed" read as a quiet night.
 * Every team going unanswered is the proxy, GameChanger or the network down, and a red run is what
 * raises the nightly's alarm (`runAlarms.ts`).
 */
describe("a pull that heard nothing", () => {
  it("is one that asked about teams and had none answered", () => {
    expect(heardNothing({ asked: 1200, answered: 0 })).toBe(true);
  });

  it("is not one that had nothing to ask, or had any answer at all", () => {
    expect(heardNothing({ asked: 0, answered: 0 })).toBe(false);
    expect(heardNothing({ asked: 1200, answered: 1 })).toBe(false);
  });
});
