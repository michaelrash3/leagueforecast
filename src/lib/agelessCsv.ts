/**
 * The teams waiting on an age, as a file.
 *
 * Thirty-six thousand rows is not a queue anybody works ten at a time, and the review card cannot
 * become a spreadsheet. So the list comes out as one: sortable, filterable, and readable on a
 * bigger screen than the one it was collected on.
 *
 * It is also the only way this list leaves the browser at a workable size. It rides in the
 * whole-browser backup, but that file carries every season and every game beside it and runs to
 * hundreds of megabytes on a nationwide pool — too big to move, and mostly things nobody looking
 * at this question needs. These rows are a few megabytes.
 *
 * The columns are chosen so the file round-trips. `Team ID`, `Team Name` and `GameChanger URL` hit
 * the aliases `parseGcTeamList` already matches, so a worked file can be pasted straight back into
 * the import box; `Answer` is the empty column somebody fills in; and everything after that is the
 * evidence behind the row, which is what makes a decision possible without opening the page.
 *
 * One column name is load-bearing. The observed age field is called **`Age Field`** and must never
 * be called `Age Group`, because `AGE_HEADERS` matches `age group|age|age level|division` — so
 * that name would make a re-import read GameChanger's own unreadable label as the reader's answer,
 * putting two ages in one file with the wrong one winning.
 */

import { csvEscape, normalizeHeader, parseCSVLine, stripBom } from "./csv";
import { formatGcSeason, gcTeamPageUrl, parseGcSeasonLabel } from "./gameChangerApi";
import { looksInvented, whyNoAge, type AgelessEvidence } from "./agelessEvidence";
import { MIN_OPPONENT_AGE_EVIDENCE } from "./gameChangerImport";
import type { AgeUnknownList, AgeUnknownTeam } from "./ageUnknown";

export const AGELESS_CSV_HEADERS = [
  "Team ID",
  "Team Name",
  "GameChanger URL",
  "Answer",
  "Why",
  "Age Field",
  "Sanctioning Body",
  "City",
  "State",
  "Season",
  "Games",
  "Scored",
  "Ahead Of Today",
  "Shutout Blowouts",
  "Opponents",
  "Opponents Naming An Age",
  "Opponent Ages",
  "Played",
  "Record",
  "Players",
  "Looks Invented",
  "Tries",
  "First Seen",
  "Last Tried",
] as const;

/** "2×9U 1×10U", the tally as one cell. */
const tallyCell = (evidence: AgelessEvidence | undefined): string =>
  (evidence?.tally ?? []).map(([level, count]) => `${count}×${level}U`).join(" ");

const recordCell = (evidence: AgelessEvidence | undefined): string =>
  evidence?.record ? `${evidence.record.win}-${evidence.record.loss}-${evidence.record.tie}` : "";

const rowCells = (row: AgeUnknownTeam): (string | number)[] => {
  const evidence = row.evidence;
  return [
    row.teamId,
    row.name ?? "",
    gcTeamPageUrl(row.teamId),
    // The column the reader fills in. Empty on the way out, on purpose.
    "",
    evidence ? whyNoAge(evidence, MIN_OPPONENT_AGE_EVIDENCE) : "Nothing was kept about this one.",
    evidence?.ageLabel ?? "",
    (evidence?.ngb ?? []).join("; "),
    evidence?.city ?? "",
    evidence?.state ?? "",
    evidence?.season ? formatGcSeason(evidence.season) : "",
    evidence?.games ?? 0,
    evidence?.scored ?? 0,
    evidence?.aheadOfToday ?? 0,
    evidence?.shutoutBlowouts ?? 0,
    evidence?.opponents ?? 0,
    evidence?.namedAnAge ?? 0,
    tallyCell(evidence),
    (evidence?.sampleOpponents ?? []).join("; "),
    recordCell(evidence),
    evidence?.playerCount ?? "",
    evidence ? looksInvented(evidence).toFixed(2) : "",
    row.tries,
    row.firstSeen,
    row.lastTried,
  ];
};

/**
 * The whole list as CSV text.
 *
 * Built in pieces by the caller where the list is large — see `agelessCsvParts` — because at
 * thirty-six thousand rows the joined string is several megabytes and exists alongside the rows it
 * was built from at the moment of the join.
 */
export const agelessCsv = (rows: AgeUnknownList): string => agelessCsvParts(rows).join("");

/** The same file, a chunk at a time, for a Blob to assemble without one giant string. */
export const agelessCsvParts = (rows: AgeUnknownList): string[] => {
  const parts = [`${AGELESS_CSV_HEADERS.join(",")}\n`];
  rows.forEach((row) => {
    parts.push(`${rowCells(row).map(csvEscape).join(",")}\n`);
  });
  return parts;
};

/** "gamechanger-waiting-on-an-age-2026-09-22.csv" */
export const agelessCsvFilename = (day: string): string =>
  `gamechanger-waiting-on-an-age-${day}.csv`;

const cell = (cells: string[], at: number): string => (at >= 0 ? (cells[at] ?? "").trim() : "");

const asCount = (raw: string): number => {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
};

/** "2×9U 1×10U" back into a tally, commonest first as the writer left it. */
const readTally = (raw: string): [number, number][] =>
  raw
    .split(/\s+/)
    .flatMap((part) => {
      const match = /^(\d+)[x×](\d{1,2})U$/i.exec(part.trim());
      if (!match) return [];
      const count = Number(match[1]);
      const level = Number(match[2]);
      return count > 0 && level > 0 ? [[level, count] as [number, number]] : [];
    })
    .slice(0, 8);

/**
 * The file read back as rows, for the sweep and for anything else that wants the list without the
 * two-hundred-megabyte backup around it.
 *
 * Lenient in the way every reader here is: a column that is missing is a field that is absent, and
 * a row with no id is skipped rather than failing the file. The evidence comes back as far as the
 * columns carry it, which is everything the triage rules read.
 */
export const parseAgelessCsv = (text: string): AgeUnknownList => {
  if (typeof text !== "string") return [];
  const lines = stripBom(text).split(/\r?\n/);
  const header = lines.find((line) => line.trim().length > 0);
  if (!header) return [];
  const headers = parseCSVLine(header).map(normalizeHeader);
  const at = (name: string): number => headers.indexOf(normalizeHeader(name));

  const columns = {
    id: at("Team ID"),
    name: at("Team Name"),
    why: at("Why"),
    ageLabel: at("Age Field"),
    ngb: at("Sanctioning Body"),
    city: at("City"),
    state: at("State"),
    season: at("Season"),
    games: at("Games"),
    scored: at("Scored"),
    ahead: at("Ahead Of Today"),
    blowouts: at("Shutout Blowouts"),
    opponents: at("Opponents"),
    naming: at("Opponents Naming An Age"),
    tally: at("Opponent Ages"),
    played: at("Played"),
    players: at("Players"),
    tries: at("Tries"),
    firstSeen: at("First Seen"),
    lastTried: at("Last Tried"),
  };
  if (columns.id < 0) return [];

  const rows: AgeUnknownTeam[] = [];
  let headerSkipped = false;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (!headerSkipped) {
      headerSkipped = true;
      continue;
    }
    const cells = parseCSVLine(line);
    const teamId = cell(cells, columns.id);
    if (!teamId) continue;

    const played = cell(cells, columns.played)
      .split(";")
      .map((one) => one.trim())
      .filter(Boolean);
    // Semicolons, not spaces: "little league" and "babe ruth" are one body each.
    const ngb = cell(cells, columns.ngb)
      .split(";")
      .map((one) => one.trim().toLowerCase())
      .filter(Boolean);
    const season = parseGcSeasonLabel(cell(cells, columns.season));
    const evidence: AgelessEvidence = {
      ...(cell(cells, columns.ageLabel) ? { ageLabel: cell(cells, columns.ageLabel) } : {}),
      ...(cell(cells, columns.city) ? { city: cell(cells, columns.city) } : {}),
      ...(cell(cells, columns.state) ? { state: cell(cells, columns.state) } : {}),
      ...(cell(cells, columns.players)
        ? { playerCount: asCount(cell(cells, columns.players)) }
        : {}),
      ...(ngb.length > 0 ? { ngb } : {}),
      ...(season ? { season } : {}),
      games: asCount(cell(cells, columns.games)),
      scored: asCount(cell(cells, columns.scored)),
      aheadOfToday: asCount(cell(cells, columns.ahead)),
      shutoutBlowouts: asCount(cell(cells, columns.blowouts)),
      opponents: asCount(cell(cells, columns.opponents)),
      namedAnAge: asCount(cell(cells, columns.naming)),
      tally: readTally(cell(cells, columns.tally)),
      ...(played.length > 0 ? { sampleOpponents: played } : {}),
    };
    rows.push({
      teamId,
      ...(cell(cells, columns.name) ? { name: cell(cells, columns.name) } : {}),
      firstSeen: cell(cells, columns.firstSeen),
      lastTried: cell(cells, columns.lastTried),
      tries: asCount(cell(cells, columns.tries)),
      evidence,
    });
  }
  return rows;
};
