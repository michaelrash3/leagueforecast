import { normalizeDateInput, todayIsoDay } from "./date";
import { dateInSquadYear } from "./teamRankings/seasons";
import { displayName } from "./format";
import type { CsvImportIssue } from "./importReport";
import { createTeamId } from "./sim";
import type { GameLog, Matchup, TeamBase } from "./types";
import { CSV_SECTIONS, normalizeHeader, parseCSVLine, splitCsvSections } from "./csv";

export type ScheduleCsvImportResult = {
  teams: TeamBase[];
  matchups: Matchup[];
  logs: Record<string, GameLog>;
  issues: CsvImportIssue[];
};

/**
 * Whether two run counts make a final.
 *
 * Both have to be there — and for a game dated today or later, at least one of them has to be a
 * run. Schedule exports write 0–0 against every game that has not been played yet, and read as a
 * final that is a tie nobody played: a game in both records, a half-point in the standings and a
 * result the model learns from. A game dated yesterday or earlier keeps a 0–0 as typed, because by
 * then it is a claim about a game that happened — a forfeit, say — rather than a placeholder. A
 * game with no date is not clearly in the past either, so it is read as still to come.
 */
/** An ISO day: a date that already says which day it is, whatever the season around it. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The day a schedule row is on, or undefined when nothing can say.
 *
 * A file that writes full dates has already answered it. A file that writes the app's own "M/D"
 * has not, and takes the year the season sits in to place it — `dateInSquadYear` is the same
 * placement Team Rankings uses, where a squad year runs August to July, so in 2027 a "9/12" is
 * 2026 and a "3/15" is 2027. With neither there is no day, and a caller has to say so rather than
 * pick one.
 */
const placeOnDay = (date: string, squadYear: number | undefined): string | undefined => {
  const trimmed = date.trim();
  if (ISO_DAY.test(trimmed)) return trimmed;
  if (squadYear === undefined) return undefined;
  const placed = dateInSquadYear(normalizeDateInput(trimmed), squadYear);
  return placed === undefined || placed === "" ? undefined : placed;
};

const scoreMakesFinal = (
  awayRuns: string,
  homeRuns: string,
  date: string,
  today: Date,
  squadYear: number | undefined
): boolean => {
  if (awayRuns === "" || homeRuns === "") return false;
  if (Number(awayRuns) > 0 || Number(homeRuns) > 0) return true;
  /*
   * A 0-0 is only a result once the day has been and gone, and saying which day a bare "M/D" is
   * takes the year the season sits in. `dateInSquadYear` is the same placement Team Rankings uses:
   * a squad year runs August to July, so in 2027 a "9/12" is 2026 and a "3/15" is 2027.
   *
   * Without one there is nothing to place it against. That used to be papered over by comparing
   * both sides inside one fixed year, which is really a month-and-day comparison — so setting up
   * a spring season in December marked every one of its games final as a nil-nil draw, because
   * March sorts before December. A game nobody has played is not a result, so with no year to
   * judge by this now says no.
   */
  const placed = placeOnDay(date, squadYear);
  return placed !== undefined && placed < todayIsoDay(today);
};

/** `today` is only ever passed by a test; the app reads the clock. */
export const parseScheduleCsvImport = (
  raw: string,
  today: Date = new Date(),
  /**
   * The squad year this schedule belongs to, as the age group claiming the season already records
   * it — "Fall 2026" is part of squad year 2027. It is what turns the file's bare "M/D" into a day
   * that can be compared to today. Absent when no age group claims the season yet, and then a
   * nil-nil row is never read as a result.
   */
  squadYear?: number
): ScheduleCsvImportResult => {
  // A backup CSV appends the Team Rankings pool after the schedule, so read only the schedule
  // section. An unsectioned file — every CSV exported before sections existed, and every hand-made
  // one — is all schedule, which is exactly what `splitCsvSections` files under the leading name.
  const text =
    splitCsvSections(raw, CSV_SECTIONS.schedule).get(normalizeHeader(CSV_SECTIONS.schedule)) ?? "";
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
    const hasFinalScore = scoreMakesFinal(
      awayRuns,
      homeRuns,
      row[dateIndex]?.trim() ?? "",
      today,
      squadYear
    );
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
