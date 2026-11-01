export type CsvImportIssueKind = "missing-team" | "unknown-team" | "duplicate-id";

export type CsvImportIssue = {
  kind: CsvImportIssueKind;
  rowNumber: number;
  detail?: string;
};

const ISSUE_LABELS: Record<CsvImportIssueKind, string> = {
  "missing-team": "missing Away/Home team",
  "unknown-team": "team name mismatch",
  "duplicate-id": "duplicate Game ID",
};

// The rows' own numbers are printed as the file numbers them; how many more there are is a count.
const formatRows = (rows: number[], limit: number) => {
  const visible = rows.slice(0, limit).join(", ");
  const hidden = rows.length - limit;
  return hidden > 0 ? `${visible}, +${hidden.toLocaleString()} more` : visible;
};

export const summarizeCsvImportIssues = (issues: CsvImportIssue[], rowLimit = 5) => {
  const byKind = new Map<CsvImportIssueKind, CsvImportIssue[]>();
  issues.forEach((issue) => {
    byKind.set(issue.kind, [...(byKind.get(issue.kind) ?? []), issue]);
  });

  return [...byKind.entries()].map(([kind, grouped]) => {
    const rows = grouped.map((issue) => issue.rowNumber).sort((a, b) => a - b);
    const details = [...new Set(grouped.map((issue) => issue.detail).filter(Boolean))];
    // Said as a person says it: "1 row skipped", "1,500 rows skipped", where it said "row(s)".
    const one = grouped.length === 1;
    return `${grouped.length.toLocaleString()} ${one ? "row" : "rows"} skipped: ${ISSUE_LABELS[kind]} (${one ? "row" : "rows"} ${formatRows(
      rows,
      rowLimit
    )})${details.length ? ` — ${details.slice(0, 2).join("; ")}` : ""}`;
  });
};
