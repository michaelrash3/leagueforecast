import { beforeEach, describe, expect, it } from "vitest";
import { defaultLevelIn, readDefaultAge, writeDefaultAge } from "../lib/preferences";
import type { AgeGroup } from "../lib/teamRankings";
import { defaultPageFor } from "./useRankingsPages";

/*
 * The age group Team Rankings opens on when the URL names none, kept as a class that grows up a
 * level a year: the user's rule was "If I have 9u as my default in 2027, I will want 10u as my
 * default in 2028".
 */

const page = (ageLevel: number, year: number): AgeGroup => ({
  id: `ag_${ageLevel}u_${year}`,
  name: `${ageLevel}U ${year}`,
  ageLevel,
  year,
  seasonIds: [],
});

/** A day in squad year 2027 (August 2026 to July 2027), and one in 2028. */
const IN_2027 = "2026-10-02";
const IN_2028 = "2027-10-02";

describe("defaultLevelIn", () => {
  it("moves the picked level up a year at a time, and back down for earlier years", () => {
    const pick = { level: 9, year: 2027 };
    expect(defaultLevelIn(pick, 2027)).toBe(9);
    expect(defaultLevelIn(pick, 2028)).toBe(10);
    expect(defaultLevelIn(pick, 2029)).toBe(11);
    expect(defaultLevelIn(pick, 2026)).toBe(8);
  });
});

describe("defaultPageFor", () => {
  const pick = { level: 9, year: 2027 };

  it("opens the class's page in the squad year being played", () => {
    const groups = [page(12, 2027), page(9, 2027), page(10, 2028), page(9, 2028)];
    expect(defaultPageFor(groups, pick, IN_2027)).toBe("ag_9u_2027");
    expect(defaultPageFor(groups, pick, IN_2028)).toBe("ag_10u_2028");
  });

  it("is 11U two seasons on", () => {
    expect(defaultPageFor([page(9, 2029), page(11, 2029)], pick, "2028-10-02")).toBe("ag_11u_2029");
  });

  it("falls back to the latest year that has the class's page", () => {
    // The 2028 season is under way and nobody has pulled its pages yet.
    expect(defaultPageFor([page(9, 2027), page(8, 2026)], pick, IN_2028)).toBe("ag_9u_2027");
    expect(defaultPageFor([page(8, 2026), page(12, 2027)], pick, IN_2028)).toBe("ag_8u_2026");
  });

  it("opens nothing without a default, or with no page for its class", () => {
    expect(defaultPageFor([page(9, 2027)], null, IN_2027)).toBeUndefined();
    expect(defaultPageFor([page(12, 2027), page(9, 2028)], pick, IN_2027)).toBeUndefined();
  });

  it("never takes a page with no year for the class's", () => {
    const undated: AgeGroup = { id: "travel", name: "Travel squad", ageLevel: 9, seasonIds: [] };
    expect(defaultPageFor([undated], pick, IN_2027)).toBeUndefined();
  });
});

describe("the stored default age", () => {
  beforeEach(() => localStorage.clear());

  it("reads back what was written, and nothing once cleared", () => {
    expect(readDefaultAge()).toBeNull();
    writeDefaultAge({ level: 9, year: 2027 });
    expect(readDefaultAge()).toEqual({ level: 9, year: 2027 });
    writeDefaultAge(null);
    expect(readDefaultAge()).toBeNull();
  });

  it("ignores what is not a default age", () => {
    for (const junk of [
      "not json",
      "[9, 2027]",
      '{"level": "9", "year": 2027}',
      '{"level": 9.5, "year": 2027}',
      '{"level": 0, "year": 2027}',
      '{"level": 9}',
      "null",
    ]) {
      localStorage.setItem("lf_rankings_default_age_v1", junk);
      expect(readDefaultAge()).toBeNull();
    }
  });
});
