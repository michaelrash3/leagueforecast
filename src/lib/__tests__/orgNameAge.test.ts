import { describe, expect, it } from "vitest";
import { ageFromOrgName, ageFromLeagueNames } from "../gameChangerApi";

/**
 * The age an organization's own name states.
 *
 * Measured over 17,003 teams carrying an organization, 2,240 of which had both an org naming an
 * age and an age of their own to check it against. The org's age agreed 90.1% of the time.
 * Excluding event-sounding names took that to 94.1%, excluding spans to 93.9%, both to 95.1% —
 * and the errors are one-directional: of 221 disagreements, 197 had the organization *older*.
 * That is the play-up signature, and it is what the two refusals below are for.
 */
describe("an age from an organization's name", () => {
  it("reads a standing body that names one age", () => {
    expect(ageFromOrgName("TPABL 12U")).toBe(12);
    expect(ageFromOrgName("GLL 8u Fall 2026")).toBe(8);
    expect(ageFromOrgName("AABC 9U")).toBe(9);
    expect(ageFromOrgName("10U American Fall 2026")).toBe(10);
  });

  /*
   * A tournament's age is a ceiling its teams reached, not the age they are — the same
   * distinction `ageFromLeagueNames` draws, except a crawl types every organization the same way
   * so the name is all there is to go on. Real names, from the run that measured this.
   */
  it("refuses an event, whose age is a ceiling rather than an age", () => {
    [
      "(09/25/2026) 17/18u Super Fall Invitational POWERED BY VICTUS",
      "Pathway Utah Wood Bat Classic 18U",
      "(10/02/2026) 12U Grand Slam",
      "FS 4th Annual Mid-Atlantic Labor Day Classic 17-19u 2026",
      "2D Chisenhall Fall Opener 12U",
    ].forEach((name) =>
      expect({ name, age: ageFromOrgName(name) }).toEqual({ name, age: undefined })
    );
  });

  /*
   * Both ways clubs write a span. The optional U after the first number matters: without it
   * "13U-16U" reads as a plain 16U and files thirteen-year-olds three years old.
   */
  it("refuses a span, whose top is nobody's age in particular", () => {
    ["13U-16U COBRA Fall 2026", "Suburban Travel 13/14u", "Fall 17-19u Wood Bat"].forEach((name) =>
      expect({ name, age: ageFromOrgName(name) }).toEqual({ name, age: undefined })
    );
  });

  /*
   * And what still gets through, recorded rather than chased. "16U-LABOR-DAY-RMSB-2026" is an
   * event with no date in brackets and no word from the list, so it reads as a plain 16U. The
   * 95.1% agreement measured for this rule already counts names like it as misses; widening the
   * word list to catch them is guesswork against a corpus of one.
   */
  it("still reads an event whose name gives it away by neither route", () => {
    expect(ageFromOrgName("16U-LABOR-DAY-RMSB-2026")).toBe(16);
  });

  it("says nothing about an organization that names no age", () => {
    expect(ageFromOrgName("Cincy Legends Baseball")).toBeUndefined();
    expect(ageFromOrgName("")).toBeUndefined();
    expect(ageFromOrgName(undefined)).toBeUndefined();
  });

  /*
   * A league that names an age is the stronger statement and keeps its rung: you play your own
   * age in your league. The organization only answers where the league said nothing.
   */
  it("is weaker than a league association, which is read first", () => {
    expect(ageFromLeagueNames([{ name: "NKB 11u" }])).toBe(11);
    expect(ageFromLeagueNames([{ name: "NKB 11u" }]) ?? ageFromOrgName("TPABL 12U")).toBe(11);
    expect(ageFromLeagueNames(undefined) ?? ageFromOrgName("TPABL 12U")).toBe(12);
  });
});
