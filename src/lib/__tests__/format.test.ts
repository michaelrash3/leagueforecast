import { describe, expect, it } from "vitest";
import { buildTeamFormats, displayName, recordText, teamAbbr } from "../format";

describe("displayName", () => {
  it("strips noise tokens", () => {
    expect(displayName("NKB Stallions 8U")).toBe("Stallions");
    expect(displayName("Union Trash Pandas")).toBe("Trash Pandas");
  });
  it("normalizes Dirt Dobbers", () => {
    expect(displayName("Dirt Dobbers 8u")).toBe("Dirt Dobbers");
    expect(displayName("dobbers")).toBe("Dirt Dobbers");
  });
  it("falls back to the original when everything strips out", () => {
    expect(displayName("8u")).toBe("8u");
  });
});

describe("teamAbbr", () => {
  it("uses initials when multiple words", () => {
    expect(teamAbbr("Trash Pandas")).toBe("TP");
    expect(teamAbbr("Dirt Dobbers")).toBe("DD");
  });
  it("uses prefix when single word", () => {
    expect(teamAbbr("Stallions")).toBe("STA");
  });
});

describe("recordText", () => {
  it("hides ties when zero", () => {
    expect(recordText({ w: 5, l: 2, t: 0 })).toBe("5-2");
  });
  it("appends ties when present", () => {
    expect(recordText({ w: 5, l: 2, t: 1 })).toBe("5-2-1");
  });
});

describe("buildTeamFormats", () => {
  it("returns a Map keyed by id with display, abbr, record", () => {
    const map = buildTeamFormats([{ id: "A", name: "NKB Stallions", w: 3, l: 1, t: 0 }]);
    expect(map.get("A")).toEqual({ display: "Stallions", abbr: "STA", record: "3-1" });
  });
});
