import { describe, expect, it } from "vitest";
import {
  ageBandFromLabel,
  ageFitsBand,
  ageLevelOf,
  isAdultAgeLabel,
  isSchoolAgeLabel,
  parseGcAgeLevel,
  parseGcTeamList,
} from "../gameChangerApi";

/**
 * Every value GameChanger's age field was observed to hold, with its count, from the 36,194 teams
 * waiting on an age on 22 September 2026. The field was set on 36,182 of them — 99.97% — and held
 * exactly these eleven strings and nothing else, so this table is the whole vocabulary rather
 * than a sample of it.
 */
const OBSERVED = [
  ["Under 13", 27_485],
  ["Between 13 - 18", 3_967],
  ["Over 18", 2_049],
  ["college", 719],
  ["18O", 535],
  ["middle_13O", 419],
  ["middle_12U", 379],
  ["high_varsity", 313],
  ["high_freshman", 164],
  ["elementary", 104],
  ["high_junior_varsity", 48],
] as const;

describe("GameChanger's own age vocabulary", () => {
  /*
   * The finding that made these readers necessary, kept as a test so it cannot quietly come back:
   * every one of these was unreadable, which is why 36,194 teams whose own page said what they
   * were sat on a list being asked about weekly.
   */
  it("is not an age, and never becomes one", () => {
    OBSERVED.forEach(([label]) => {
      expect(parseGcAgeLevel(label)).toBeUndefined();
      expect(ageLevelOf(label, "Some Club", undefined)).toBeUndefined();
    });
  });

  it("reads the six school bands as a school team", () => {
    ["high_varsity", "high_junior_varsity", "high_freshman", "middle_13O", "elementary"].forEach(
      (label) => expect(isSchoolAgeLabel(label)).toBe(true)
    );
    // The values that were always read stay read.
    expect(isSchoolAgeLabel("Varsity")).toBe(true);
    expect(isSchoolAgeLabel("JV")).toBe(true);
  });

  /*
   * `middle_12U` names an age and is deliberately not read as one. A seventh-grade school side is
   * a school side; filing it at 12U would rank it against travel clubs it never plays.
   */
  it("reads middle_12U as a school team rather than as 12U", () => {
    expect(isSchoolAgeLabel("middle_12U")).toBe(true);
    expect(parseGcAgeLevel("middle_12U")).toBeUndefined();
    expect(ageLevelOf("middle_12U", "Some Club", undefined)).toBeUndefined();
  });

  it("reads the three adult bands as adults", () => {
    ["Over 18", "18O", "college"].forEach((label) => expect(isAdultAgeLabel(label)).toBe(true));
    ["Under 13", "Between 13 - 18", "high_varsity", "12U"].forEach((label) =>
      expect(isAdultAgeLabel(label)).toBe(false)
    );
  });

  it("keeps the two bands apart from both", () => {
    expect(ageBandFromLabel("Under 13")).toEqual({ high: 13 });
    expect(ageBandFromLabel("Between 13 - 18")).toEqual({ low: 13, high: 18 });
    ["Under 13", "Between 13 - 18"].forEach((label) => {
      expect(isSchoolAgeLabel(label)).toBe(false);
      expect(isAdultAgeLabel(label)).toBe(false);
    });
  });

  it("has a reading for every value observed, and they do not overlap", () => {
    OBSERVED.forEach(([label]) => {
      const readings = [
        isSchoolAgeLabel(label),
        isAdultAgeLabel(label),
        ageBandFromLabel(label) !== undefined,
      ].filter(Boolean);
      expect({ label, readings: readings.length }).toEqual({ label, readings: 1 });
    });
  });

  it("still reads an ordinary age label, and refuses the ones it always refused", () => {
    expect(parseGcAgeLevel("12U")).toBe(12);
    expect(parseGcAgeLevel("9")).toBe(9);
    ["Minors", "Majors", "AAA", "Rookie"].forEach((label) => {
      expect(parseGcAgeLevel(label)).toBeUndefined();
      expect(isSchoolAgeLabel(label)).toBe(false);
      expect(isAdultAgeLabel(label)).toBe(false);
    });
  });
});

/**
 * The band is a veto, not an age. It bounds what a derived age is allowed to be, which is the
 * only thing "Under 13" can honestly do.
 */
describe("an age against the band GameChanger states", () => {
  it("lets through anything the band does not contradict", () => {
    expect(ageFitsBand(10, "Under 13")).toBe(true);
    expect(ageFitsBand(14, "Between 13 - 18")).toBe(true);
    // No band, no opinion — which is most of what this app reads.
    expect(ageFitsBand(16, "Minors")).toBe(true);
    expect(ageFitsBand(16, undefined)).toBe(true);
  });

  it("refuses an age the band rules out", () => {
    expect(ageFitsBand(16, "Under 13")).toBe(false);
    expect(ageFitsBand(10, "Between 13 - 18")).toBe(false);
  });

  /*
   * The adult and school labels are not bands, and they admit no youth age at all: a side filed
   * `college` is not a ten-year-old team that happens to be labelled oddly. "SMSU Mustangs" is
   * Southwest Minnesota State, and the PONY rule was about to file it at 10U.
   */
  it("refuses every youth age for an adult or school label", () => {
    ["Over 18", "18O", "college", "high_varsity", "middle_12U", "elementary"].forEach((label) => {
      [8, 10, 13, 18].forEach((level) => expect(ageFitsBand(level, label)).toBe(false));
    });
  });

  /*
   * "Under 13" is read as a ceiling of 13, not 12, and loosely on purpose. Little League's
   * Intermediate division is ages 11 to 13 and this app files it at 13U, so a twelve-year-old in
   * that division is both "Under 13" and 13U and neither reading is wrong. Read strictly, the
   * band vetoes 178 Intermediate teams in this backlog that it has no business vetoing.
   */
  it("is loose at the boundary, because Intermediate is 11 to 13", () => {
    expect(ageFitsBand(13, "Under 13")).toBe(true);
    expect(ageFitsBand(14, "Under 13")).toBe(false);
  });
});

describe("a pasted list carrying the same vocabulary", () => {
  const list = (age: string) => `Team ID,Team Name,Age Group\ngcABCDEFGHIJKL,Some Club,${age}\n`;

  it("marks an adult or college row without spending a request on it", () => {
    ["Over 18", "18O", "college"].forEach((label) => {
      const entry = parseGcTeamList(list(label)).entries[0];
      expect({ label, notYouth: entry?.notYouth, age: entry?.ageLevel }).toEqual({
        label,
        notYouth: true,
        age: undefined,
      });
    });
  });

  it("marks a school row the same way it always marked a varsity one", () => {
    expect(parseGcTeamList(list("high_varsity")).entries[0]?.highSchool).toBe(true);
    expect(parseGcTeamList(list("middle_12U")).entries[0]?.highSchool).toBe(true);
  });

  it("leaves an ordinary club alone", () => {
    const entry = parseGcTeamList(list("12U")).entries[0];
    expect(entry?.ageLevel).toBe(12);
    expect(entry?.notYouth).toBeUndefined();
    expect(entry?.highSchool).toBeUndefined();
  });
});
