import { describe, expect, it } from "vitest";
import { normalizeDateInput, parseDateValue, formatGameDate } from "../date";

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
});
