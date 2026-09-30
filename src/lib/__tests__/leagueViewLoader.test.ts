import { describe, expect, it } from "vitest";
import { likelyLeagueViewAfter } from "../leagueViewLoader";

describe("league view prefetch policy", () => {
  it("warms only the measured likely next views", () => {
    expect(likelyLeagueViewAfter("dashboard")).toBe("games");
    expect(likelyLeagueViewAfter("standings")).toBe("model");
    expect(likelyLeagueViewAfter("games")).toBeNull();
    expect(likelyLeagueViewAfter("model")).toBeNull();
    expect(likelyLeagueViewAfter("settings")).toBeNull();
  });
});
