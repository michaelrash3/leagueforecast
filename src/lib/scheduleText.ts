/**
 * Reads games out of pasted text — a CSV exported from a spreadsheet, or schedule lines copied off
 * a league site.
 *
 * Everything happens on the device: no key, no network call, nothing to run out. Deliberately
 * forgiving about layout and strict about content — a line it can't read is reported as skipped
 * rather than guessed at, since a wrong score is worse than a missing one, and a wrong score feeds
 * straight into the ratings where nobody would notice it.
 */

/** Runs in a youth game; anything past this is a misread, not a blowout. */
const MAX_SCORE = 99;
const MAX_NAME_LENGTH = 80;

const clampText = (value: unknown, max: number): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

const clampScheduleName = (value: unknown): string => clampText(value, MAX_NAME_LENGTH);

/** A score is only kept when it is a whole, non-negative, plausible number of runs. */
const clampScheduleScore = (value: unknown): number | undefined => {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  const rounded = Math.round(numeric);
  if (rounded < 0 || rounded > MAX_SCORE) return undefined;
  return rounded;
};

/** An ISO `YYYY-MM-DD` day, or nothing. */
const clampScheduleDate = (value: unknown): string | undefined => {
  const date = clampText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
};

/**
 * One game, from nobody's point of view in particular.
 *
 * A schedule names one team and its opponents; a game list names both sides. `teamA` absent means
 * the source only gave an opponent, so the importer supplies "whose schedule this is" — that is the
 * only difference between the two, and the review table renders them the same way.
 */
export type ParsedGameRow = {
  date?: string;
  /** Home side when the source distinguished one. Absent = the subject team. */
  teamA?: string;
  teamB: string;
  scoreA?: number;
  scoreB?: number;
};

export type ParsedScheduleText = {
  subjectTeam?: string;
  games: ParsedGameRow[];
  /** Lines that held something but could not be read, verbatim, so the UI can show what it lost. */
  skipped: string[];
};

/**
 * A pasted game list is a whole league's season, not one team's schedule, so this cap is far above
 * the screenshot one — a screenshot holds a month, a CSV holds a year.
 */
export const SCHEDULE_TEXT_MAX_GAMES = 1000;

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const WEEKDAY = /^(?:mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)[a-z]*\.?$/i;

/** `August 2026`, `Aug 2026` — a section header that dates the bare day numbers under it. */
const MONTH_YEAR = /^([a-z]{3,9})\.?\s+(\d{4})$/i;

const monthOf = (word: string): number | undefined =>
  MONTHS[word.slice(0, 4).toLowerCase()] ?? MONTHS[word.slice(0, 3).toLowerCase()];

const iso = (year: number, month: number, day: number): string | undefined => {
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  // Bounds alone would accept February 31st, which then looks like a real date everywhere
  // downstream. Round-tripping through the calendar rejects it, leap years included.
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return undefined;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

type DateContext = { year?: number; month?: number };

/**
 * Reads a date in whatever shape it arrived. A year is never invented: `8/22` with no year context
 * yields no date at all, which the rest of the app already handles, rather than a wrong one.
 */
export const parseScheduleDate = (raw: string, context: DateContext = {}): string | undefined => {
  const value = raw
    .trim()
    .replace(/,/g, " ")
    .replace(/\s{2,}/g, " ");
  if (!value) return undefined;

  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (isoMatch) return iso(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));

  // 8/22/2026, 8-22-26, 8/22
  const numeric = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?$/.exec(value);
  if (numeric) {
    const month = Number(numeric[1]);
    const day = Number(numeric[2]);
    const rawYear = numeric[3];
    const year = rawYear
      ? rawYear.length === 2
        ? 2000 + Number(rawYear)
        : Number(rawYear)
      : context.year;
    return year === undefined ? undefined : iso(year, month, day);
  }

  // Aug 22 2026, August 22, 22 Aug 2026
  const words = value.split(" ").filter(Boolean);
  let month: number | undefined;
  let day: number | undefined;
  let year: number | undefined;
  words.forEach((word) => {
    if (WEEKDAY.test(word) && monthOf(word) === undefined) return;
    const named = /^[a-z]{3,9}\.?$/i.test(word) ? monthOf(word.replace(".", "")) : undefined;
    if (named !== undefined && month === undefined) {
      month = named;
      return;
    }
    if (/^\d{4}$/.test(word)) {
      year = Number(word);
      return;
    }
    if (/^\d{1,2}(?:st|nd|rd|th)?$/i.test(word) && day === undefined) {
      day = Number(word.replace(/\D/g, ""));
    }
  });

  month = month ?? context.month;
  year = year ?? context.year;
  if (day === undefined || month === undefined || year === undefined) return undefined;
  return iso(year, month, day);
};

/** `W 6-5`, `L 3-10`, `6–5`, `6 - 5`. The first number is always the subject team's. */
export const parseScorePair = (
  raw: string
): { teamScore: number; opponentScore: number } | undefined => {
  const match = /^(?:[wlt]\s*)?(\d{1,3})\s*[-–—:]\s*(\d{1,3})$/i.exec(raw.trim());
  if (!match) return undefined;
  return { teamScore: Number(match[1]), opponentScore: Number(match[2]) };
};

const HOME_WORDS = new Set(["vs", "vs.", "v", "v.", "home", "h", "true", "yes"]);
const AWAY_WORDS = new Set(["@", "at", "away", "a", "false", "no"]);

const parseHomeAway = (raw: string): boolean | undefined => {
  const value = raw.trim().toLowerCase();
  if (HOME_WORDS.has(value)) return true;
  if (AWAY_WORDS.has(value)) return false;
  return undefined;
};

/** Splits `vs. Velocirabbits` into the marker and the name; the marker is optional. */
const splitOpponent = (raw: string): { opponent: string; isHome?: boolean } => {
  const value = raw.trim();
  const marker = /^(vs\.?|v\.?|@|at)\s+(.*)$/i.exec(value);
  if (!marker) return { opponent: value };
  return {
    opponent: (marker[2] ?? "").trim(),
    isHome: !/^(@|at)$/i.test(marker[1] ?? ""),
  };
};

/** A minimal CSV cell reader: enough for quoted names with commas, which is why quotes exist. */
const splitCells = (line: string, delimiter: string): string[] => {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else quoted = false;
      } else current += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) {
      cells.push(current.trim());
      current = "";
    } else current += char;
  }
  cells.push(current.trim());
  return cells;
};

const headerKey = (cell: string) => cell.toLowerCase().replace(/[^a-z]/g, "");

/**
 * Two layouts show up in the wild, and they need different columns:
 *
 * - **Matchup** — a whole league's results, both sides named per row:
 *   `Date, Home Team, Home Team Score, Away Team, Away Team Score`. Nothing is relative to anyone.
 * - **Schedule** — one team's season, only the other side named per row:
 *   `Date, Opponent, Us, Them`. Every score is from that team's point of view, so the importer has
 *   to be told who that team is.
 */
const MATCHUP_HEADERS = {
  date: ["date", "gamedate", "day", "when", "played"],
  teamA: ["hometeam", "home", "hometeamname", "host"],
  scoreA: ["hometeamscore", "homescore", "homeruns", "homepoints", "hometeamruns"],
  teamB: ["awayteam", "away", "visitor", "visitors", "visitingteam", "awayteamname"],
  scoreB: ["awayteamscore", "awayscore", "awayruns", "awaypoints", "visitorscore", "awayteamruns"],
} as const;

const SCHEDULE_HEADERS = {
  date: ["date", "gamedate", "day", "when", "played"],
  opponent: ["opponent", "opp", "versus", "vsteam", "opponentteam", "opponentname"],
  homeAway: ["homeaway", "ha", "location", "site", "venue", "home", "hostoraway"],
  teamScore: ["ourscore", "teamscore", "myscore", "us", "runsfor", "rf", "we", "scorefor", "score"],
  opponentScore: [
    "oppscore",
    "opponentscore",
    "theirscore",
    "them",
    "runsagainst",
    "ra",
    "against",
    "scoreagainst",
  ],
  result: ["result", "finalscore", "final", "wl"],
  subject: ["team", "myteam", "ourteam", "subject"],
} as const;

type MatchupMap = Partial<Record<keyof typeof MATCHUP_HEADERS, number>>;
type ScheduleMap = Partial<Record<keyof typeof SCHEDULE_HEADERS, number>>;
type ColumnMap = ({ kind: "matchup" } & MatchupMap) | ({ kind: "schedule" } & ScheduleMap);

const matchColumns = <T extends Record<string, readonly string[]>>(
  cells: string[],
  fields: T
): { map: Partial<Record<keyof T, number>>; matched: number } => {
  const map: Partial<Record<keyof T, number>> = {};
  let matched = 0;
  cells.forEach((cell, index) => {
    const key = headerKey(cell);
    if (!key) return;
    (Object.keys(fields) as (keyof T)[]).forEach((field) => {
      if (map[field] !== undefined) return;
      if (fields[field as string]?.includes(key)) {
        map[field] = index;
        matched += 1;
      }
    });
  });
  return { map, matched };
};

const readHeader = (cells: string[]): ColumnMap | null => {
  // Matchup wins when both sides are named: "Home Team"/"Away Team" is unambiguous, while a lone
  // "Home" column in a schedule means home-or-away.
  const matchup = matchColumns(cells, MATCHUP_HEADERS);
  if (matchup.map.teamA !== undefined && matchup.map.teamB !== undefined) {
    return { kind: "matchup", ...matchup.map };
  }
  const schedule = matchColumns(cells, SCHEDULE_HEADERS);
  // One stray match (a team literally named "Result") shouldn't turn a data row into a header.
  return schedule.matched >= 2 ? { kind: "schedule", ...schedule.map } : null;
};

/** No header row: assume the order a person would naturally write. */
const positionalMap = (cells: string[]): ColumnMap => {
  if (cells.length >= 4) {
    return { kind: "schedule", date: 0, opponent: 1, teamScore: 2, opponentScore: 3 };
  }
  if (cells.length === 3) {
    return parseScorePair(cells[2] ?? "")
      ? { kind: "schedule", date: 0, opponent: 1, result: 2 }
      : { kind: "schedule", opponent: 0, teamScore: 1, opponentScore: 2 };
  }
  return { kind: "schedule", date: 0, opponent: 1 };
};

const cellAt = (cells: string[], index: number | undefined): string =>
  index === undefined ? "" : (cells[index] ?? "");

/** Both sides named outright: nothing is relative, so there is nothing to resolve. */
const matchupFromCells = (
  cells: string[],
  map: { kind: "matchup" } & MatchupMap,
  context: DateContext
): ParsedGameRow | null => {
  const teamA = cellAt(cells, map.teamA).trim();
  const teamB = cellAt(cells, map.teamB).trim();
  if (!teamA || !teamB) return null;

  const date = parseScheduleDate(cellAt(cells, map.date), context);
  const rawA = cellAt(cells, map.scoreA).trim();
  const rawB = cellAt(cells, map.scoreB).trim();
  const played = rawA !== "" && rawB !== "";

  return {
    teamA,
    teamB,
    ...(date ? { date } : {}),
    ...(played ? { scoreA: Number(rawA), scoreB: Number(rawB) } : {}),
  };
};

const rowFromCells = (
  cells: string[],
  map: { kind: "schedule" } & ScheduleMap,
  context: DateContext
): ParsedGameRow | null => {
  const opponentRaw = cellAt(cells, map.opponent);
  if (!opponentRaw.trim()) return null;

  const { opponent, isHome: markerHome } = splitOpponent(opponentRaw);
  if (!opponent) return null;

  const date = parseScheduleDate(cellAt(cells, map.date), context);
  const homeAway = parseHomeAway(cellAt(cells, map.homeAway));

  // Scores can arrive as two columns or as one "6-5" cell; a lone score column holding "6-5" is
  // the combined form, which is how most sites print it.
  let teamScore: number | undefined;
  let opponentScore: number | undefined;
  const combined = parseScorePair(cellAt(cells, map.result));
  const fromScoreCell =
    map.opponentScore === undefined ? parseScorePair(cellAt(cells, map.teamScore)) : undefined;
  if (combined) {
    ({ teamScore, opponentScore } = combined);
  } else if (fromScoreCell) {
    ({ teamScore, opponentScore } = fromScoreCell);
  } else {
    const a = cellAt(cells, map.teamScore).trim();
    const b = cellAt(cells, map.opponentScore).trim();
    if (a !== "" && b !== "") {
      teamScore = Number(a);
      opponentScore = Number(b);
    }
  }

  // `homeAway`/`markerHome` are read so the marker can be stripped off the name, but they are not
  // carried further: ratings here are neutral-site, so which side hosted changes nothing.
  void homeAway;
  void markerHome;

  return {
    teamB: opponent,
    ...(date ? { date } : {}),
    ...(teamScore !== undefined && opponentScore !== undefined
      ? { scoreA: teamScore, scoreB: opponentScore }
      : {}),
  };
};

/** Trailing status words these sites print after a result: `W 6-5 Final`, `L 3-10 F/6`. */
const STATUS_SUFFIX = /\s+(?:final|f\/\d+|complete|completed|forfeit(?:ed)?|postponed)\s*$/i;

/**
 * True when a row read as a table clearly swallowed prose it should not have: its opponent still
 * holds a `vs.`/`@` marker or a whole score. That is what a comma inside a schedule line does —
 * `August 22, 2026 vs. X W 6-5` splits into two "cells" that are not cells at all.
 */
const looksUnparsed = (row: ParsedGameRow): boolean =>
  /(?:^|\s)(?:vs\.?|@|at)\s/i.test(row.teamB) || /\d{1,3}\s*[-–—]\s*\d{1,3}/.test(row.teamB);

/** `SAT 22 vs. Velocirabbits 9U W 6-5` and friends — one game per line, no delimiters. */
const rowFromLine = (line: string, context: DateContext): ParsedGameRow | null => {
  let rest = line.trim();

  // Status markers come off first: with "W 6-5 Final" still intact the score regex cannot reach
  // the numbers, and the whole result would end up inside the opponent's name. Looped because
  // "F/6 Final" stacks two of them.
  for (let i = 0; i < 3 && STATUS_SUFFIX.test(rest); i += 1) {
    rest = rest.replace(STATUS_SUFFIX, "").trim();
  }

  // Then the result off the end: it is the only part with a fixed shape.
  let scores: { teamScore: number; opponentScore: number } | undefined;
  const trailing = /\s(?:[wlt]\s*)?(\d{1,3}\s*[-–—]\s*\d{1,3})\s*$/i.exec(rest);
  if (trailing) {
    scores = parseScorePair(trailing[1] ?? "");
    if (scores) rest = rest.slice(0, trailing.index).trim();
  }

  // Then the date off the front, however it is written.
  let date: string | undefined;
  const leading =
    /^(?:(?:mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)[a-z]*\.?,?\s+)?(\d{4}-\d{1,2}-\d{1,2}|[a-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{1,2}(?:st|nd|rd|th)?)\s+(.*)$/i.exec(
      rest
    );
  if (leading) {
    const candidate = parseScheduleDate(leading[1] ?? "", context);
    // Only consume the token if it really read as a date — "9U Rockets" must not lose its "9".
    if (candidate) {
      date = candidate;
      rest = (leading[2] ?? "").trim();
    }
  }

  rest = rest.replace(/^\d{1,2}:\d{2}\s*(?:am|pm)?\s*/i, "").trim();
  const { opponent, isHome } = splitOpponent(rest);
  if (!opponent) return null;

  // A game row carries at least one of: a date, a score, or a vs/@ marker. Without any of those
  // the line is prose, and calling it an opponent would import a sentence as a team.
  if (date === undefined && scores === undefined && isHome === undefined) return null;

  return {
    teamB: opponent,
    ...(date ? { date } : {}),
    ...(scores ? { scoreA: scores.teamScore, scoreB: scores.opponentScore } : {}),
  };
};

/**
 * The last gate before anything is shown. Drops rather than guesses: a row missing a team goes,
 * a half-read score becomes "not played yet" rather than a phantom result, and an unreadable date
 * becomes no date. Mirrors `sanitizeScheduleImageResponse` so both importers accept the same rows.
 */
const sanitizeRows = (rows: ParsedGameRow[]): ParsedGameRow[] =>
  rows
    .slice(0, SCHEDULE_TEXT_MAX_GAMES)
    .map((row): ParsedGameRow | null => {
      const teamB = clampScheduleName(row.teamB);
      if (!teamB) return null;
      const teamA = row.teamA === undefined ? undefined : clampScheduleName(row.teamA);
      if (row.teamA !== undefined && !teamA) return null;

      const scoreA = clampScheduleScore(row.scoreA);
      const scoreB = clampScheduleScore(row.scoreB);
      const played = scoreA !== undefined && scoreB !== undefined;
      const date = clampScheduleDate(row.date);

      return {
        teamB,
        ...(teamA ? { teamA } : {}),
        ...(date ? { date } : {}),
        ...(played ? { scoreA, scoreB } : {}),
      };
    })
    .filter((row): row is ParsedGameRow => row !== null);

/**
 * Reads whatever was pasted. Each line is judged on its own, so a month header can sit in the
 * middle of a CSV and a stray blank line costs nothing.
 */
export const parseScheduleText = (text: string): ParsedScheduleText => {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const delimiter = text.includes("\t") ? "\t" : ",";

  const context: DateContext = {};
  const games: ParsedGameRow[] = [];
  const skipped: string[] = [];
  const subjects = new Set<string>();
  let map: ColumnMap | null = null;

  lines.forEach((line) => {
    if (!line) return;

    const monthYear = MONTH_YEAR.exec(line);
    const month = monthYear ? monthOf(monthYear[1] ?? "") : undefined;
    if (monthYear && month !== undefined) {
      context.month = month;
      context.year = Number(monthYear[2]);
      return;
    }
    if (/^\d{4}$/.test(line)) {
      context.year = Number(line);
      return;
    }

    const cells = splitCells(line, delimiter);
    if (cells.length >= 2) {
      if (!map) {
        const header = readHeader(cells);
        if (header) {
          map = header;
          return;
        }
        map = positionalMap(cells);
      }
      const columns: ColumnMap = map;
      let row =
        columns.kind === "schedule"
          ? rowFromCells(cells, columns, context)
          : matchupFromCells(cells, columns, context);

      if (columns.kind === "schedule" && row && columns.subject !== undefined) {
        // A Team column names *this row's* team. Without copying it onto the row, a multi-team
        // export would reach the review table with no team at all and every game would be
        // credited to whichever single name was typed into "whose schedule is this?".
        const subject = cellAt(cells, columns.subject).trim();
        if (subject) {
          subjects.add(subject);
          row = { ...row, teamA: subject };
        }
      }

      // A comma inside a schedule line ("August 22, 2026 vs. X W 6-5") splits into things that
      // look like cells but aren't; the giveaway is an opponent that still holds a marker or a
      // score. Re-read those as a line rather than importing the prose as a team name.
      if (row && looksUnparsed(row)) {
        const asLine = rowFromLine(line, context);
        if (asLine) {
          games.push(asLine);
          return;
        }
        skipped.push(line);
        return;
      }

      if (row) games.push(row);
      else skipped.push(line);
      return;
    }

    const row = rowFromLine(line, context);
    if (row) games.push(row);
    else skipped.push(line);
  });

  // A "team" column is only a subject if every row agrees; mixed values mean it names both sides.
  const named = subjects.size === 1 ? clampScheduleName([...subjects][0]) : "";
  return {
    ...(named ? { subjectTeam: named } : {}),
    games: sanitizeRows(games),
    skipped,
  };
};
