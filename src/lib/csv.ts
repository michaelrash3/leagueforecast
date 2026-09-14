const FORMULA_INJECTION_RE = /^[=+\-@]/;
const BOM = "﻿";

export const stripBom = (text: string) =>
  text.startsWith(BOM) ? text.slice(1) : text;

export const parseCSVLine = (line: string) => {
  const normalized = line.replace(/\r$/, "");
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    const next = normalized[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"' && (inQuotes || current.length === 0)) {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(stripImportPrefix(current.trim()));
      current = "";
    } else {
      current += char;
    }
  }

  values.push(stripImportPrefix(current.trim()));
  return values;
};

// Excel formula-injection guard: when a cell starts with '=', '+', '-', '@',
// some spreadsheet apps execute it. On export prefix with a single quote;
// on import strip that prefix.
const stripImportPrefix = (value: string) =>
  value.startsWith("'") && FORMULA_INJECTION_RE.test(value.slice(1))
    ? value.slice(1)
    : value;

const guardForExport = (value: string) =>
  FORMULA_INJECTION_RE.test(value) ? `'${value}` : value;

export const normalizeHeader = (header: string) =>
  header.trim().toLowerCase().replace(/\s+/g, " ");

export const csvEscape = (value: string | number) => {
  const text = guardForExport(String(value ?? ""));
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

// ---------- Sectioned CSV ----------
//
// A backup CSV carries more than one table: the schedule, plus the Team Rankings pool. Each table
// is introduced by a `# Section: <name>` line, which is a single-cell row in a spreadsheet and a
// line no header or data row of ours can be mistaken for. A file with no markers at all is one
// unnamed block — that is every CSV this app exported before sections existed, and it still reads
// as the schedule.

const SECTION_MARKER_RE = /^#\s*section\s*:\s*(.+)$/i;

/**
 * Section names a backup CSV can carry. The schedule keeps the leading, historically unmarked
 * slot, so a CSV exported before sections existed still reads as one.
 */
export const CSV_SECTIONS = {
  schedule: "Schedule",
  ageGroups: "Team Rankings Age Groups",
  teams: "Team Rankings Teams",
  games: "Team Rankings Games",
} as const;

export const csvSectionMarker = (name: string) => `# Section: ${name}`;

/**
 * Split a sectioned CSV into its blocks, keyed by normalized section name. Content before the
 * first marker is filed under `leadingSection`, so an unsectioned file resolves to that one name.
 */
export const splitCsvSections = (raw: string, leadingSection: string): Map<string, string> => {
  const sections = new Map<string, string>();
  let name = normalizeHeader(leadingSection);
  let lines: string[] = [];

  const flush = () => {
    const body = lines.join("\n").trim();
    if (body) sections.set(name, body);
    lines = [];
  };

  stripBom(raw)
    .split(/\r?\n/)
    .forEach((line) => {
      const marker = SECTION_MARKER_RE.exec(line.trim());
      if (!marker) {
        lines.push(line);
        return;
      }
      flush();
      name = normalizeHeader(marker[1] ?? "");
    });
  flush();

  return sections;
};

/** Read one section's rows, with a header-name accessor. `null` when the section is absent. */
export const readCsvSection = (sections: Map<string, string>, name: string) => {
  const body = sections.get(normalizeHeader(name));
  if (!body) return null;
  const lines = body.split(/\r?\n/).filter((line) => line.trim());
  const headers = parseCSVLine(lines[0] ?? "").map(normalizeHeader);
  return {
    rows: lines.slice(1).map(parseCSVLine),
    cell: (row: string[], column: string) => {
      const at = headers.indexOf(normalizeHeader(column));
      return at >= 0 ? (row[at]?.trim() ?? "") : "";
    },
  };
};

/** Join a header row and its data rows into a section block, marker included. */
export const csvSection = (name: string, headers: string[], rows: string[]) =>
  [csvSectionMarker(name), headers.join(","), ...rows].join("\n");
