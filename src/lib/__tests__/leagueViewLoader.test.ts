import { describe, expect, it } from "vitest";
import { likelyLeagueViewAfter, loadLeagueView, resetLeagueViewLoad } from "../leagueViewLoader";

describe("league view prefetch policy", () => {
  it("warms only the measured likely next views", () => {
    expect(likelyLeagueViewAfter("dashboard")).toBe("games");
    expect(likelyLeagueViewAfter("standings")).toBe("model");
    expect(likelyLeagueViewAfter("games")).toBeNull();
    expect(likelyLeagueViewAfter("model")).toBeNull();
    expect(likelyLeagueViewAfter("settings")).toBeNull();
    expect(likelyLeagueViewAfter("dataQuality")).toBeNull();
  });
});

describe("league view load generations", () => {
  it("reuses one request until recovery explicitly starts a new generation", async () => {
    const first = loadLeagueView("dashboard");
    expect(loadLeagueView("dashboard")).toBe(first);
    await first;

    resetLeagueViewLoad("dashboard");
    const retry = loadLeagueView("dashboard");
    expect(retry).not.toBe(first);
    await retry;
  });
});
