import { describe, expect, it } from "vitest";
import {
  normalizeDateInput,
  parseDateValue,
  formatGameDate,
  shiftIsoDay,
  sundayEndingWeekKey,
} from "../date";
import { inTimeZone } from "../../test/timeZone";

describe("normalizeDateInput", () => {
  it("normalizes M/D form", () => {
    expect(normalizeDateInput("5/1")).toBe("5/1");
    expect(normalizeDateInput("05/01")).toBe("5/1");
    expect(normalizeDateInput("12/31")).toBe("12/31");
  });

  it("clamps out-of-range values", () => {
    expect(normalizeDateInput("13/1")).toBe("12/1");
    expect(normalizeDateInput("5/40")).toBe("5/31");
  });

  it("parses ISO dates", () => {
    expect(normalizeDateInput("2026-05-01")).toBe("5/1");
  });

  it("accepts alpha-month tokens", () => {
    expect(normalizeDateInput("May 1")).toBe("5/1");
    expect(normalizeDateInput("Jun 15")).toBe("6/15");
  });

  it("rejects bare numbers and noise", () => {
    expect(normalizeDateInput("5")).toBe("");
    expect(normalizeDateInput("hello")).toBe("");
    expect(normalizeDateInput("")).toBe("");
  });

  it("formatGameDate falls back to placeholder", () => {
    expect(formatGameDate("")).toBe("No Date");
    expect(formatGameDate("5/1")).toBe("5/1");
  });

  it("parseDateValue is finite for valid dates and infinite for blanks", () => {
    expect(Number.isFinite(parseDateValue("5/1"))).toBe(true);
    expect(parseDateValue("")).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("a day the month does not have", () => {
  /*
   * The day used to be clamped to 31 whatever the month, so "2/31" came back as written and then
   * rolled over wherever it was parsed: a mistyped February game quietly moved to March 3, and a
   * "9/31" landed in October. Clamping to the month keeps a typo in the month it was typed in.
   */
  it("keeps the game in the month it was typed in", () => {
    expect(normalizeDateInput("2/31")).toBe("2/29");
    expect(normalizeDateInput("4/31")).toBe("4/30");
    expect(normalizeDateInput("6/31")).toBe("6/30");
    expect(normalizeDateInput("9/31")).toBe("9/30");
    expect(normalizeDateInput("11/31")).toBe("11/30");
  });

  it("leaves a day the month does have alone", () => {
    expect(normalizeDateInput("1/31")).toBe("1/31");
    expect(normalizeDateInput("2/29")).toBe("2/29");
    expect(normalizeDateInput("4/30")).toBe("4/30");
  });

  it("still clamps the month itself", () => {
    expect(normalizeDateInput("13/1")).toBe("12/1");
    expect(normalizeDateInput("0/5")).toBe("1/5");
  });

  it("keeps a named month's game in that month too, where the date parser rolled it over", () => {
    // "Apr 31" came back as 5/1 and "Feb 30" as 3/2, so an old CSV's typo moved a game a month.
    expect(normalizeDateInput("Apr 31")).toBe("4/30");
    expect(normalizeDateInput("Sat, Apr 31")).toBe("4/30");
    expect(normalizeDateInput("Feb 30")).toBe("2/29");
    expect(normalizeDateInput("Feb 29")).toBe("2/29");
    expect(normalizeDateInput("Sept 31")).toBe("9/30");
    expect(normalizeDateInput("Apr 30")).toBe("4/30");
  });

  it("keeps an ISO date's game in its month, on that year's calendar", () => {
    expect(normalizeDateInput("2027-04-31")).toBe("4/30");
    expect(normalizeDateInput("2027-02-29")).toBe("2/28");
    expect(normalizeDateInput("2028-02-29")).toBe("2/29");
    expect(normalizeDateInput("2027-13-01")).toBe("");
    expect(normalizeDateInput("2027-04-00")).toBe("");
  });
});

describe("shiftIsoDay", () => {
  it("counts whole calendar days either way, across months, years and a leap day", () => {
    expect(shiftIsoDay("2026-09-29", 7)).toBe("2026-10-06");
    expect(shiftIsoDay("2026-09-29", -7)).toBe("2026-09-22");
    expect(shiftIsoDay("2026-12-28", 7)).toBe("2027-01-04");
    expect(shiftIsoDay("2028-02-26", 7)).toBe("2028-03-04");
    expect(shiftIsoDay("2028-03-04", -7)).toBe("2028-02-26");
  });

  it("is not moved by a change of clocks", () => {
    // 1 November 2026 is the autumn change in the United States: a local-time sum loses an hour
    // there, and a day once the hour is taken from midnight.
    expect(shiftIsoDay("2026-10-29", 7)).toBe("2026-11-05");
    expect(shiftIsoDay("2027-03-10", -7)).toBe("2027-03-03");
  });

  it("hands back a value that is not a day as it came", () => {
    expect(shiftIsoDay("", 7)).toBe("");
    expect(shiftIsoDay("9/13", 7)).toBe("9/13");
  });
});

describe("shiftIsoDay in any time zone", () => {
  it("names the same day east of UTC, where local midnight is the day before in UTC", () => {
    inTimeZone("Europe/Berlin", () => {
      expect(shiftIsoDay("2026-09-29", 7)).toBe("2026-10-06");
      expect(shiftIsoDay("2026-09-29", -7)).toBe("2026-09-22");
    });
  });

  it("names the same day west of UTC, across the autumn change of clocks", () => {
    inTimeZone("America/New_York", () => {
      expect(shiftIsoDay("2026-10-29", 7)).toBe("2026-11-05");
      expect(shiftIsoDay("2026-11-05", -7)).toBe("2026-10-29");
    });
  });
});

describe("a season's weeks and its month words", () => {
  /*
   * "Per Week" grouping worked the weekday out in 2026 whatever the season, so a week running from
   * December into January was two weeks; and a month word alone, "may", was read as May 1.
   */
  it("puts a week across New Year in one, on the season's own calendar", () => {
    expect(sundayEndingWeekKey("12/30", 11)).toBe("1/3");
    expect(sundayEndingWeekKey("1/2", 11)).toBe("1/3");
    // A season inside one calendar year is as it was.
    expect(sundayEndingWeekKey("5/1")).toBe(sundayEndingWeekKey("5/1", 1));
  });

  it("reads a month word with no day as no date", () => {
    expect(normalizeDateInput("may")).toBe("");
    expect(normalizeDateInput("May")).toBe("");
    expect(normalizeDateInput("May 1")).toBe("5/1");
  });
});
