import { describe, expect, it } from "vitest";
import { squadYearFromName } from "../seasonNames";

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
