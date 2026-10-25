import { describe, expect, it } from "vitest";
import { searchWithTab, tabFromSearch } from "../leagueTab";

describe("tabFromSearch", () => {
  it("reads a tab the app has", () => {
    expect(tabFromSearch("?tab=standings")).toBe("standings");
    expect(tabFromSearch("?view=rankings&tab=model")).toBe("model");
  });

  it("ignores a missing tab, an unknown one, and a name off the object's prototype", () => {
    expect(tabFromSearch("")).toBeNull();
    expect(tabFromSearch("?tab=bracket")).toBeNull();
    expect(tabFromSearch("?tab=toString")).toBeNull();
  });
});

describe("searchWithTab", () => {
  it("writes the tab and keeps every other parameter", () => {
    expect(searchWithTab("?team=t3", "games")).toBe("?team=t3&tab=games");
    expect(searchWithTab("?tab=games", "model")).toBe("?tab=model");
  });

  it("leaves the Dashboard out of the address", () => {
    expect(searchWithTab("?tab=games", "dashboard")).toBe("");
    expect(searchWithTab("?team=t3&tab=games", "dashboard")).toBe("?team=t3");
  });

  it("round-trips every tab", () => {
    for (const tab of ["power", "standings", "teamStats", "games", "model", "quality"] as const) {
      expect(tabFromSearch(searchWithTab("", tab))).toBe(tab);
    }
  });
});
