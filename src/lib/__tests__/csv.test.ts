import { describe, expect, it } from "vitest";
import { csvEscape, parseCSVLine, stripBom } from "../csv";

describe("parseCSVLine", () => {
  it("splits simple values", () => {
    expect(parseCSVLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("respects quoted commas", () => {
    expect(parseCSVLine('"a,b",c,"d ""e"" f"')).toEqual(["a,b", "c", 'd "e" f']);
  });

  it("strips formula-injection prefix on import", () => {
    expect(parseCSVLine("'=SUM(A1),'+payload,'@cmd")).toEqual(["=SUM(A1)", "+payload", "@cmd"]);
  });
});

describe("csvEscape", () => {
  it("escapes commas, quotes, CR, and LF", () => {
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("line1\r\nline2")).toBe('"line1\r\nline2"');
  });

  it("guards formula-injection on export", () => {
    expect(csvEscape("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvEscape("@evil")).toBe("'@evil");
  });

  it("passes safe values through", () => {
    expect(csvEscape("Stallions")).toBe("Stallions");
    expect(csvEscape(7)).toBe("7");
  });
});

describe("stripBom", () => {
  it("removes a leading BOM", () => {
    expect(stripBom("﻿hello")).toBe("hello");
    expect(stripBom("hello")).toBe("hello");
  });
});
