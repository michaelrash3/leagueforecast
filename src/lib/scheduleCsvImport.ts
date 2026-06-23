import { normalizeDateInput } from "./date";
import { displayName } from "./format";
import type { CsvImportIssue } from "./importReport";
import { createTeamId } from "./sim";
import type { GameLog, Matchup, TeamBase } from "./types";
import { normalizeHeader, parseCSVLine, stripBom } from "./csv";

export type ScheduleCsvImportResult = {
  teams: TeamBase[];
  matchups: Matchup[];
  logs: Record<string, GameLog>;
  issues: CsvImportIssue[];
};

const scoreMakesFinal = (awayRuns: string, homeRuns: string) => awayRuns !== "" && homeRuns !== "";

export const parseScheduleCsvImport = (raw: string): ScheduleCsvImportResult => {
  const text = stripBom(raw);
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("CSV has no rows");

  const headers = parseCSVLine(lines[0] ?? "").map(normalizeHeader);
  const index = (name: string) => headers.indexOf(normalizeHeader(name));

  const gameIdIndex = index("Game ID");
  const dateIndex = index("Date");
  const awayTeamIndex = index("Away Team");
  const inningsIndex = index("Innings");
  const awayRunsIndex = index("Away Runs");
  const awayHitsIndex = index("Away Hits");
  const firstIndex = (...names: string[]) => names.map(index).find((i) => i >= 0) ?? -1;
  const awayKIndex = index("Away K");
  const awayErrorsIndex = firstIndex("Away E", "Away Errors");
  const awayBbIndex = index("Away BB");
  const awayWalksAllowedIndex = firstIndex("Away BB Allowed");
  const homeTeamIndex = index("Home Team");
  const homeRunsIndex = index("Home Runs");
  const homeHitsIndex = index("Home Hits");
  const homeKIndex = index("Home K");
  const homeErrorsIndex = firstIndex("Home E", "Home Errors");
  const homeBbIndex = index("Home BB");
  const homeWalksAllowedIndex = firstIndex("Home BB Allowed");

  if (gameIdIndex < 0 || dateIndex < 0 || awayTeamIndex < 0 || homeTeamIndex < 0) {
    throw new Error("Missing required columns");
  }

  const rows = lines.slice(1).map(parseCSVLine);
  const names = new Set<string>();
  rows.forEach((row) => {
    if (row[awayTeamIndex]?.trim()) names.add(row[awayTeamIndex].trim());
    if (row[homeTeamIndex]?.trim()) names.add(row[homeTeamIndex].trim());
  });

  const existingIds = new Set<string>();
  const nameToId = new Map<string, string>();
  const teams = Array.from(names)
    .sort((a, b) => displayName(a).localeCompare(displayName(b)))
    .map((name) => {
      const id = createTeamId(displayName(name), existingIds);
      nameToId.set(name, id);
      return { id, name };
    });

  const matchups: Matchup[] = [];
  const logs: Record<string, GameLog> = {};
  const importSuffix = Math.random().toString(36).slice(2, 8);
  const issues: CsvImportIssue[] = [];
  const seenIds = new Set<string>();

  rows.forEach((row, rowIndex) => {
    const awayName = row[awayTeamIndex]?.trim();
    const homeName = row[homeTeamIndex]?.trim();
    const csvRowNumber = rowIndex + 2;
    if (!awayName || !homeName) {
      issues.push({ kind: "missing-team", rowNumber: csvRowNumber });
      return;
    }

    const away = nameToId.get(awayName);
    const home = nameToId.get(homeName);
    if (!away || !home) {
      issues.push({
        kind: "unknown-team",
        rowNumber: csvRowNumber,
        detail: [awayName, homeName].filter((name) => !nameToId.has(name)).join(" vs "),
      });
      return;
    }

    const id = row[gameIdIndex]?.trim() || `game_${Date.now()}_${importSuffix}_${rowIndex}`;
    if (seenIds.has(id)) {
      issues.push({ kind: "duplicate-id", rowNumber: csvRowNumber, detail: id });
      return;
    }
    seenIds.add(id);

    const awayRuns = awayRunsIndex >= 0 ? (row[awayRunsIndex]?.trim() ?? "") : "";
    const homeRuns = homeRunsIndex >= 0 ? (row[homeRunsIndex]?.trim() ?? "") : "";
    const hasFinalScore = scoreMakesFinal(awayRuns, homeRuns);
    const awayK = awayKIndex >= 0 ? (row[awayKIndex]?.trim() ?? "") : "";
    const homeK = homeKIndex >= 0 ? (row[homeKIndex]?.trim() ?? "") : "";
    const awayErrors = awayErrorsIndex >= 0 ? (row[awayErrorsIndex]?.trim() ?? "") : "";
    const homeErrors = homeErrorsIndex >= 0 ? (row[homeErrorsIndex]?.trim() ?? "") : "";
    const awayBb = awayBbIndex >= 0 ? (row[awayBbIndex]?.trim() ?? "") : "";
    const homeBb = homeBbIndex >= 0 ? (row[homeBbIndex]?.trim() ?? "") : "";
    const explicitAwayWalksAllowed =
      awayWalksAllowedIndex >= 0 ? (row[awayWalksAllowedIndex]?.trim() ?? "") : "";
    const explicitHomeWalksAllowed =
      homeWalksAllowedIndex >= 0 ? (row[homeWalksAllowedIndex]?.trim() ?? "") : "";
    const awayWalksAllowed = explicitAwayWalksAllowed || homeBb;
    const homeWalksAllowed = explicitHomeWalksAllowed || awayBb;

    matchups.push({
      id,
      date: normalizeDateInput(row[dateIndex]?.trim() || ""),
      away,
      home,
    });

    logs[id] = {
      innings: inningsIndex >= 0 ? row[inningsIndex]?.trim() || "6" : "6",
      awayRuns,
      awayHits: awayHitsIndex >= 0 ? (row[awayHitsIndex]?.trim() ?? "") : "",
      awayK: hasFinalScore ? awayK || "0" : awayK,
      homeRuns,
      homeHits: homeHitsIndex >= 0 ? (row[homeHitsIndex]?.trim() ?? "") : "",
      homeK: hasFinalScore ? homeK || "0" : homeK,
      awayErrors,
      homeErrors,
      awayWalksAllowed,
      homeWalksAllowed,
      isFinal: hasFinalScore,
    };
  });

  // Drop orphan logs not tied to a matchup.
  const matchupIds = new Set(matchups.map((matchup) => matchup.id));
  Object.keys(logs).forEach((id) => {
    if (!matchupIds.has(id)) delete logs[id];
  });

  return { teams, matchups, logs, issues };
};
