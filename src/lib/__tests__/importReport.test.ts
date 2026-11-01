import { describe, expect, it } from "vitest";
import { summarizeCsvImportIssues, type CsvImportIssue } from "../importReport";

describe("summarizeCsvImportIssues", () => {
  it("groups skipped import rows by issue type", () => {
    const issues: CsvImportIssue[] = [
      { kind: "missing-team", rowNumber: 2 },
      { kind: "missing-team", rowNumber: 5 },
      { kind: "duplicate-id", rowNumber: 7, detail: "g1" },
    ];

    expect(summarizeCsvImportIssues(issues)).toEqual([
      "2 rows skipped: missing Away/Home team (rows 2, 5)",
      "1 row skipped: duplicate Game ID (row 7) — g1",
    ]);
  });

  it("limits long row lists", () => {
    const issues: CsvImportIssue[] = Array.from({ length: 6 }, (_, index) => ({
      kind: "unknown-team",
      rowNumber: index + 2,
    }));

    expect(summarizeCsvImportIssues(issues, 3)).toEqual([
      "6 rows skipped: team name mismatch (rows 2, 3, 4, +3 more)",
    ]);
  });

  it("says its counts as a person would, a comma in a thousand and more", () => {
    // It said "1 row(s) skipped" and "1500 row(s)"; the rows' own numbers are left as they are.
    const issues: CsvImportIssue[] = Array.from({ length: 1_500 }, (_, index) => ({
      kind: "unknown-team",
      rowNumber: index + 2,
    }));

    expect(summarizeCsvImportIssues(issues, 2)).toEqual([
      "1,500 rows skipped: team name mismatch (rows 2, 3, +1,498 more)",
    ]);
  });
});
