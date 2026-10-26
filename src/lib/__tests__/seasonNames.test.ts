import { describe, expect, it } from "vitest";
import { seasonNameStem, squadYearFromName } from "../seasonNames";

describe("squadYearFromName", () => {
  it.each([
    // A fall is the first half of the next squad year; a spring or summer is its own year's.
    ["Fall 2026", 2027],
    ["fall 2026", 2027],
    ["Autumn 2026", 2027],
    ["2026 Fall", 2027],
    ["2026-fall", 2027],
    ["Spring 2027", 2027],
    ["2027 Spring", 2027],
    ["Summer 2026", 2026],
    // A span names the squad year it ends in, however it is written.
    ["2026-27", 2027],
    ["NKB 9U 2026-2027", 2027],
    ["Winter 2026/27", 2027],
    ["Fall/Spring 2026–27", 2027],
    // A year alone is read as its own; an age beside it is never a year.
    ["NKB 2026", 2026],
    ["9U Fall 2026", 2027],
    ["12U 2027 Spring League", 2027],
    // The season word beside the last year decides, or else the only one the name has.
    ["Fall 2026 / Spring 2027", 2027],
    // A dash between two halves is not "beside": the Fall is 2026's, and 2027 is a spring.
    ["2026 Fall - 2027 Spring", 2027],
    ["2026 Fall / 2027 Spring", 2027],
    ["Fall Ball 2026", 2027],
    ["Spring and Summer 2027", 2027],
    // Not a span: the second number is not the next year, so the first is read alone.
    ["2026-28 Spring", 2026],
  ])("reads %s as squad year %s", (name, year) => {
    expect(squadYearFromName(name)).toBe(year);
  });

  it.each([
    ["No year here"],
    ["9U Rockets"],
    [""],
    // A winter's label names either year it straddles, so it says nothing on its own.
    ["Winter 2026"],
    ["2027 winter league"],
  ])("gives nothing for %s", (name) => {
    expect(squadYearFromName(name)).toBeUndefined();
  });
});

describe("seasonNameStem", () => {
  it.each([
    // The year goes, before or after the season word, and the case stays as written.
    ["Fall 2026", "Fall"],
    ["Fall 2027", "Fall"],
    ["2026 Spring", "Spring"],
    ["fall 2026", "fall"],
    ["10U Fall Ball 2026", "10U Fall Ball"],
    // A real span goes whole, however it is written.
    ["NKB 9U 2026-27", "NKB 9U"],
    ["Wolves 2026-2027", "Wolves"],
    ["Winter 2026/27", "Winter"],
    ["Fall/Spring 2026–27", "Fall/Spring"],
    // What stood between the year and the rest goes with it; what stands between words stays.
    ["NKB 9U - 2026", "NKB 9U"],
    ["2026 - NKB 9U", "NKB 9U"],
    ["NKB 9U (2026)", "NKB 9U"],
    ["Fall-2026", "Fall"],
    ["2026-fall", "fall"],
    ["Fall 2026, NKB", "Fall, NKB"],
    ["Fall 2026 / Spring 2027", "Fall / Spring"],
    ["2026 Fall - 2027 Spring", "Fall - Spring"],
    ["NKB 9U - 2026 - Fall", "NKB 9U - Fall"],
    ["  Fall   2026  ", "Fall"],
    // A short year beside a season word, or after an apostrophe.
    ["Spring 26", "Spring"],
    ["Spring '26", "Spring"],
    ["Spring ’26", "Spring"],
    ["NKB '26 Fall", "NKB Fall"],
    // Not a year: an age, a division number, a number in a name, or no year at all.
    ["9U Spring", "9U Spring"],
    ["Division 12 Spring", "Division 12 Spring"],
    ["Season 1", "Season 1"],
    ["12U Rockets", "12U Rockets"],
    // A range of more than a year is still years; a number after a dash that is no later year
    // is not, so the year alone goes.
    ["2026-28 Spring", "Spring"],
    ["Spring 2026 - 12 teams", "Spring - 12 teams"],
    // A name that is only a year has no stem.
    ["2026", ""],
    ["2026-27", ""],
    ["", ""],
  ])("reads %j as %j", (name, stem) => {
    expect(seasonNameStem(name)).toBe(stem);
  });
});
