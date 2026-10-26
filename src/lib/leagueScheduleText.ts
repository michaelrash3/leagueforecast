/**
 * Reads a league's schedule pasted off its website, a spreadsheet or a CSV into games between two
 * named sides, away and home, for a League Standings season that has none yet.
 *
 * `scheduleText.ts` reads the same kinds of paste for Team Rankings, where which side hosted
 * changes nothing and is thrown away; a league's standings keep it, so this reader keeps it, and
 * borrows that module's pieces (the cell splitter, the header reader, the month words) rather than
 * copying them. Like it, this is forgiving about layout and strict about content: a line it cannot
 * read is handed back as skipped, verbatim, rather than guessed at.
 *
 * Everything happens on the device. Nothing is asked of a server and nothing is stored here; the
 * games go into the season only once a person has looked them over (`LeagueSchedulePaste`).
 */
import { todayIsoDay } from "./date";
import {
  cellAt,
  clampScheduleName,
  monthOf,
  MONTH_YEAR,
  parseScheduleDate,
  readHeader,
  SCHEDULE_TEXT_MAX_GAMES,
  splitCells,
  STATUS_SUFFIX,
} from "./scheduleText";
import { squadYearFromName } from "./seasonNames";
import { isPlaceholderName, segmentOn } from "./teamRankings";

/** One game read off the paste, from the league's side: both teams named, away and home. */
export type LeaguePasteRow = {
  /** The day as League Standings writes it, "M/D"; empty when the paste gave none. */
  date: string;
  away: string;
  home: string;
  /** The final score, when the paste gave one: both sides or neither. */
  awayRuns?: number;
  homeRuns?: number;
  /** Which side was home is a guess: a table with no header, read as away and then home. */
  guessed?: true;
};

export type LeagueSchedule = {
  rows: LeaguePasteRow[];
  /** Lines that held something but could not be read, as pasted, so the panel can show them. */
  skipped: string[];
};

/**
 * The key a pasted name is told apart by: case, spacing and punctuation aside, with every word
 * kept, a bracketed coach's name and an age label included. `teamNameKey` drops both, which suits
 * matching a GameChanger opponent to its club, but one league can have "Heat (Ealey)" and "Heat
 * (Smith)", or "Wolves 9U" and "Wolves 10U", as two of its teams, and a paste names them so.
 */
export const pasteNameKey = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[\u2018\u2019`]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .trim();

/**
 * The squad year a paste's dates are placed in when it writes no year of its own: the one the
 * season is filed under in Team Rankings, then the one its name says ("Fall 2026" is 2027), then
 * the one being played today. Never a fixed year, which would put a new season's games in an old
 * one's.
 */
export const pasteSquadYear = (
  linked: number | undefined,
  seasonLabel: string,
  today: string = todayIsoDay()
): number => linked ?? squadYearFromName(seasonLabel) ?? segmentOn(today).year;

const MONTH_WORD =
  "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const WEEKDAY_WORD =
  "(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|weds|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\\.?";
/**
 * What a written day looks like: `2027-04-12`, `4/12`, `4-12-27`, `Apr 12`, `April 12th, 2027`,
 * `12 April`. Only real month words count, so "Marlins 10" is a team, not March 10th.
 */
const DAY_SHAPE = `(?:\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}[/-]\\d{1,2}(?:[/-]\\d{2,4})?|${MONTH_WORD}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH_WORD}(?:,?\\s+\\d{4})?)`;
const WEEKDAY_FIRST = `(?:${WEEKDAY_WORD},?\\s+)?`;
const LEADING_DAY = new RegExp(`^${WEEKDAY_FIRST}(${DAY_SHAPE})(?=$|[\\s,])`, "i");
const ONLY_DAY = new RegExp(`^${WEEKDAY_FIRST}(${DAY_SHAPE})$`, "i");
/** What follows the hour of a start time written without its minutes: "9 AM", "1 p.m.". */
const MERIDIEM = "(?:am|pm|a\\.m\\.|p\\.m\\.)(?=$|[\\s,])";
/**
 * A bare day of the month, "12" or "Sat 12th", which is a day only under a month's heading. Not an
 * hour: "9 AM Comets @ Rockets" under a day's heading starts at nine, on the heading's day.
 */
const LEADING_BARE_DAY = new RegExp(
  `^${WEEKDAY_FIRST}(\\d{1,2})(?:st|nd|rd|th)?(?=$|[\\s,])(?!\\s*${MERIDIEM})`,
  "i"
);
const ONLY_BARE_DAY = new RegExp(`^${WEEKDAY_FIRST}(\\d{1,2})(?:st|nd|rd|th)?$`, "i");
const ONLY_MONTH = new RegExp(`^${MONTH_WORD}$`, "i");
const ONLY_WEEKDAY = new RegExp(`^${WEEKDAY_WORD},?$`, "i");
/** A line naming a season, "Spring 2027 Schedule" or "2026-27", rather than prose with a year in. */
const NAMES_A_SEASON = /\b(?:fall|autumn|spring|summer)\b|\b(?:19|20)\d{2}\s*[-–/]\s*\d{2}\b/i;

/**
 * A start time, which says nothing about who played: `9:00 AM`, `9am`, `18:30`, beside spaces or
 * the commas of a line read whole.
 */
const TIME =
  /(?:^|[\s,])\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)(?=[\s,]|$)|(?:^|[\s,])\d{1,2}:\d{2}(?=[\s,]|$)/gi;
const ONLY_TIME = /^\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)$|^\d{1,2}:\d{2}$/i;
/**
 * Where it is played, at the end of a line: `Field 3`, `- Fld 2`, `@ Diamond B`. A bracketed end,
 * "(Blue)", is left alone, since it is as often part of a team's name as a place.
 */
const FIELD = /(?:\s*[-–,|]\s*|\s+)(?:(?:@|at)\s+)?(?:field|fld|diamond)\s*#?\s*[a-z0-9]{1,3}$/i;
const ONLY_FIELD = /^(?:field|fld|diamond)\s*#?\s*[a-z0-9]{1,3}$/i;
/** What sites print between a day, a time and a game: spaces, commas, dashes, bars and dots. */
const SEPARATORS = /[\s,·•|–—-]+/g;
/**
 * A game that will not be played as written, which is no fixture to add: cancelled, rained out,
 * postponed (its make-up game is listed on its own day) or suspended. Anywhere on the line, as a
 * word, since sites print it before the game as often as after; no team is called any of these.
 */
const NOT_PLAYED =
  /(?:^|[^\p{L}])(?:cancell?ed|rain(?:ed)?[\s-]?out|ppd|postponed|suspended)(?![\p{L}])/iu;
/** A status cell that changes nothing about the game: it was played, or is final. */
const ONLY_STATUS = /^(?:final|f\/\d+|complete|completed|forfeit(?:ed)?)$/i;
/**
 * A cell that says when, where or how a game went and never who played it: a start time, a
 * weekday, a field or a status. Both row readers pass these over (`readCells`, `readBareRow`), one
 * list rather than two: the reader of a table with no header passed over only times and weekdays,
 * and read "Field 1" before the teams as a team (found by Codex on #456).
 */
const isAsideCell = (value: string): boolean =>
  ONLY_TIME.test(value) ||
  ONLY_WEEKDAY.test(value) ||
  ONLY_FIELD.test(value) ||
  ONLY_STATUS.test(value);
/** A final score at the end of a line, in the order the two sides were written. */
const TRAILING_SCORE = /\s(\d{1,2})\s*[-–—]\s*(\d{1,2})$/;
/** The same shape at the end of a name, as an age span is written: "Falcons 9-10". */
const ENDS_LIKE_A_SCORE = /\s\d{1,2}\s*[-–—]\s*\d{1,2}$/;
const SCORE_CELL = /^(\d{1,2})\s*[-–—]\s*(\d{1,2})$/;
/**
 * What stands between the two sides of a line: "@" or "at" puts the host second, "vs" or "v" puts
 * it first, the order league sites print each in.
 */
const MARKER = /\s*@\s*|\s+(?:at|vs\.?|v\.?|versus)\s+/gi;
/** The same, to ask whether a cell holds one without the global flag's place kept between asks. */
const HAS_MARKER = new RegExp(MARKER.source, "i");

type Context = { year?: number; month?: number };

/** A leap year, so a bare "2/29" reads as a day before the year it lands in is known. */
const ANY_LEAP_YEAR = 2000;

/**
 * The ISO day a written date names, placed in the paste's own year where it wrote one (on the date
 * or in a heading) and otherwise in the squad year, where August to December is the year before.
 * Null for a date no calendar has, "Apr 31" or a "2/29" off a leap year, which is never rolled on
 * to the next month; the caller skips the line rather than guess its day.
 */
const dayOf = (written: string, context: Context, squadYear: number): string | null => {
  const ownYear = /\d{4}/.test(written) || /^\d{1,2}[/-]\d{1,2}[/-]\d{2}$/.test(written);
  if (ownYear || context.year !== undefined) {
    return parseScheduleDate(written, context) ?? null;
  }
  const placed = parseScheduleDate(written, { ...context, year: ANY_LEAP_YEAR });
  if (!placed) return null;
  const month = Number(placed.slice(5, 7));
  const year = month >= 8 ? squadYear - 1 : squadYear;
  return parseScheduleDate(`${year}-${placed.slice(5)}`) ?? null;
};

/** "2027-04-12" as League Standings writes it, "4/12". */
const asLeagueDate = (iso: string): string => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8))}`;

/** A day read off the front of a line or a cell: what it named, and what was left after it. */
type DayRead = { day: string | null; rest: string } | undefined;

const readLeadingDay = (text: string, context: Context, squadYear: number): DayRead => {
  const written = LEADING_DAY.exec(text);
  if (written) {
    return {
      day: dayOf(written[1] ?? "", context, squadYear),
      rest: text.slice(written[0].length),
    };
  }
  if (context.month === undefined) return undefined;
  const bare = LEADING_BARE_DAY.exec(text);
  if (!bare) return undefined;
  return { day: dayOf(bare[1] ?? "", context, squadYear), rest: text.slice(bare[0].length) };
};

/**
 * A context that reads only days written out in full, never a bare day of the month: for a cell
 * that might as well be a game's number or a score.
 */
const writtenOnly = (context: Context): Context =>
  context.year === undefined ? {} : { year: context.year };

/** The whole of `text` read as a day, or undefined when it is anything more or less than one. */
const readOnlyDay = (
  text: string,
  context: Context,
  squadYear: number
): string | null | undefined => {
  const value = text.trim();
  const written = ONLY_DAY.exec(value);
  if (written) return dayOf(written[1] ?? "", context, squadYear);
  if (context.month === undefined) return undefined;
  const bare = ONLY_BARE_DAY.exec(value);
  return bare ? dayOf(bare[1] ?? "", context, squadYear) : undefined;
};

/**
 * A line or a cell that names a day and nothing else of a game: only a day, or a day with only a
 * start time, a field or the separators between them, as a site heads each day's games ("Sat 4/12
 * 9:00 AM", "Sat, Apr 12 · 9:00 AM") and a spreadsheet writes a date and time in one cell
 * ("9/12/2026 9:00 AM"). Undefined for anything more.
 */
const readDayOnly = (
  text: string,
  context: Context,
  squadYear: number
): string | null | undefined => {
  const value = text.replace(/\t/g, " ").trim();
  const only = readOnlyDay(value, context, squadYear);
  if (only !== undefined) return only;
  const leading = readLeadingDay(value, context, squadYear);
  if (!leading) return undefined;
  const left = leading.rest.replace(TIME, " ").replace(FIELD, "").replace(SEPARATORS, "");
  return left === "" ? leading.day : undefined;
};

type Game = { day: string; away: string; home: string; runs?: [number, number]; guessed?: true };

/**
 * A line's cells, with a day it starts on kept whole where the day is written with a comma in it:
 * "April 10, 2027 Falcons @ Wolves" and "Sat, Apr 17, 2027,9:00 AM,Comets @ Rockets" start on one
 * day each. Split at every comma, the first was a day without its year and a game for a team called
 * "2027 Falcons", and a table row put "2027" in its Away column (found by Codex on #456).
 */
const cellsOf = (line: string, delimiter: string): string[] => {
  const leading = delimiter === "," ? LEADING_DAY.exec(line) : null;
  if (!leading?.[0].includes(",")) return splitCells(line, delimiter);
  const rest = line.slice(leading[0].length).replace(/^\s*,/, "");
  return [leading[0], ...(rest.trim() === "" ? [] : splitCells(rest, delimiter))];
};

/**
 * Two sides that make a league game: both named, neither a placeholder ("TBD", "Winner of Game
 * 3"), and not one team twice. Told apart as the paste names them (`pasteNameKey`), so "Heat
 * (Ealey)" against "Heat (Smith)" is a game.
 */
const sidesOk = (away: string, home: string): boolean =>
  away !== "" &&
  home !== "" &&
  !isPlaceholderName(away) &&
  !isPlaceholderName(home) &&
  pasteNameKey(away) !== pasteNameKey(home);

/**
 * One line of prose: `Sat 4/12 9:00 AM Falcons @ Wolves Field 3`, `Comets vs Rockets 6-5 Final`.
 * Undefined when the line holds no game at all (no marker between two sides); "skip" when it holds
 * one that cannot be read, two markers or a day no calendar has.
 */
const readLine = (
  line: string,
  context: Context,
  carried: string | null,
  squadYear: number
): Game | "skip" | undefined => {
  let rest = line
    .replace(/\t+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  let runs: [number, number] | undefined;
  let scoreWritten = "";
  // What trails the sides, in whatever order a site prints it: where, a status word, the score.
  for (let pass = 0; pass < 3; pass += 1) {
    rest = rest.replace(FIELD, "").replace(STATUS_SUFFIX, "").trim();
    const score = runs ? null : TRAILING_SCORE.exec(rest);
    if (score) {
      runs = [Number(score[1]), Number(score[2])];
      scoreWritten = score[0];
      rest = rest.slice(0, score.index).trim();
    }
  }

  let day: string | null = carried;
  const leading = readLeadingDay(rest, context, squadYear);
  if (leading) {
    day = leading.day;
    rest = leading.rest;
  }
  rest = rest
    .replace(TIME, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,·•|–—-]+|[\s,·•|–—-]+$/g, "");

  const markers = [...rest.matchAll(MARKER)];
  if (markers.length === 0) return undefined;
  const marker = markers[0];
  if (markers.length > 1 || !marker) return "skip";
  if (day === null) return "skip";
  const first = clampScheduleName(rest.slice(0, marker.index));
  let second = clampScheduleName(rest.slice((marker.index ?? 0) + marker[0].length));
  // Both sides ending alike, "Falcons 9-10 @ Wolves 9-10", is an age span written on each name,
  // not a final score on the second: it goes back on the name it came off. Not where the second
  // still ends in its own span, "Falcons 9-10 @ Wolves 9-10 6-5", whose last pair is the score
  // (found by Codex on #456).
  if (runs && ENDS_LIKE_A_SCORE.test(first) && !ENDS_LIKE_A_SCORE.test(second)) {
    second = clampScheduleName(second + scoreWritten);
    runs = undefined;
  }
  const hostSecond = /@|at/i.test(marker[0]);
  const [away, home] = hostSecond ? [first, second] : [second, first];
  if (!sidesOk(away, home)) return "skip";
  return {
    day,
    away,
    home,
    ...(runs ? { runs: hostSecond ? runs : [runs[1], runs[0]] } : {}),
  };
};

type Header = NonNullable<ReturnType<typeof readHeader>>;

/** A row of a table with a header naming the home and away columns. */
const readHeadedRow = (
  cells: string[],
  header: Extract<Header, { kind: "matchup" }>,
  context: Context,
  carried: string | null,
  squadYear: number
): Game | "skip" => {
  const home = clampScheduleName(cellAt(cells, header.teamA));
  const away = clampScheduleName(cellAt(cells, header.teamB));
  if (!sidesOk(away, home)) return "skip";
  const written = cellAt(cells, header.date).trim();
  // The date cell, or one with the start time in it too; failing that, another cell written wholly
  // as a day, since a header reading "Day, Date" names the weekday's column first. Not a cell
  // shaped like a score, "6-5", which a result column holds and a calendar would take for June 5.
  const taken = new Set([header.date, header.teamA, header.teamB, header.scoreA, header.scoreB]);
  let found = written === "" ? undefined : readDayOnly(written, context, squadYear);
  for (let at = 0; found === undefined && at < cells.length; at += 1) {
    const cell = (cells[at] ?? "").trim();
    if (!taken.has(at) && !SCORE_CELL.test(cell)) {
      found = readDayOnly(cell, writtenOnly(context), squadYear);
    }
  }
  // A date cell that says nothing a calendar reads ("TBD") leaves the game undated, and an empty
  // one takes the day of the heading above it; one shaped like a day that no calendar has is
  // skipped, as on a line. Asked of undefined alone: `??` took that day's null for an empty cell,
  // and "4/31/2027" came in as an undated game, scored or not (found by Codex on #456).
  const read = found === undefined ? (written === "" ? carried : "") : found;
  if (read === null) return "skip";
  const homeRuns = cellAt(cells, header.scoreA).trim();
  const awayRuns = cellAt(cells, header.scoreB).trim();
  const scored = /^\d{1,2}$/.test(homeRuns) && /^\d{1,2}$/.test(awayRuns);
  return {
    day: read,
    away,
    home,
    ...(scored ? { runs: [Number(awayRuns), Number(homeRuns)] } : {}),
  };
};

/**
 * A row whose cells each say what they are, one a game written "A @ B" and another wholly a day, a
 * start time, a weekday, a field, a score or a status, as a spreadsheet or a calendar export lays a
 * schedule out: "4/10/2027,9:00 AM,Falcons @ Wolves,Field 1", "Falcons @ Wolves,4/10/2027,9:00
 * AM,Riverside Park". The game is read from its own cell, with the day and the score from theirs,
 * and any other cell (a place, a game's number) is left out, where read as one line it would have
 * run into a team's name. Undefined for a row not laid out so, which is read as one line: "9/12
 * Comets, Blue @ Wolves" has no cell that is only a day or a time, and its comma is in a name.
 */
const readCells = (
  cells: string[],
  context: Context,
  carried: string | null,
  squadYear: number
): Game | "skip" | undefined => {
  let day: string | null | undefined;
  // A bare day of the month before the game, under a month's heading: "12" in "12,9:00 AM,Falcons
  // @ Wolves,6,5". Kept apart from a day written out, which wins over it, since a number there can
  // as well be the game's own; and out of the runs either way, which a third number threw away
  // (found by Codex on #456).
  let bareDay: string | null | undefined;
  let laidOut = false;
  const games: string[] = [];
  const scores: string[] = [];
  const numbers: string[] = [];
  for (const cell of cells) {
    const value = cell.trim();
    if (!value) continue;
    if (isAsideCell(value)) {
      laidOut = true;
    } else if (HAS_MARKER.test(value)) {
      games.push(value);
    } else if (SCORE_CELL.test(value) && games.length > 0) {
      // After the game, "6-5" is its score; before it, "4-12" is as likely its day, read below.
      scores.push(value);
      laidOut = true;
    } else if (/^\d{1,2}$/.test(value)) {
      const asBareDay =
        games.length === 0 && bareDay === undefined
          ? readOnlyDay(value, context, squadYear)
          : undefined;
      if (asBareDay === undefined) numbers.push(value);
      else {
        bareDay = asBareDay;
        laidOut = true;
      }
    } else {
      const asDay = day === undefined ? readDayOnly(value, context, squadYear) : undefined;
      if (asDay !== undefined) {
        day = asDay;
        laidOut = true;
      }
    }
  }
  const [game] = games;
  if (!laidOut || game === undefined) return undefined;
  // Asked of undefined alone: a written day no calendar has (null) skips the row, where `??=` took a
  // bare day, or the heading's, in its place (found by Codex on #456).
  if (day === undefined) day = bareDay;
  if (games.length > 1 || day === null) return "skip";
  // A score from its own cell, or two cells of runs, is read as if written after the game, in the
  // order the sides were.
  const [score] = scores;
  const [first, second] = numbers;
  const runs =
    score ?? (numbers.length === 2 && first && second ? `${first}-${second}` : undefined);
  return readLine(runs ? `${game} ${runs}` : game, context, day ?? carried, squadYear) ?? "skip";
};

/**
 * A row of a table with no header: its day, its two names in the order written, read as away and
 * then home and marked as a guess, and a score as one "6-5" cell or two cells of runs. A row with no
 * day is not taken, since a header this reader does not know reads exactly like one.
 */
const readBareRow = (cells: string[], context: Context, squadYear: number): Game | "skip" => {
  let day: string | null | undefined;
  let runs: [number, number] | undefined;
  const names: string[] = [];
  const numbers: number[] = [];
  cells.forEach((cell) => {
    const value = cell.trim();
    if (!value || isAsideCell(value)) return;
    const asDay = day === undefined ? readOnlyDay(value, context, squadYear) : undefined;
    if (asDay !== undefined) {
      day = asDay;
      return;
    }
    const pair = SCORE_CELL.exec(value);
    if (pair) runs ??= [Number(pair[1]), Number(pair[2])];
    else if (/^\d{1,2}$/.test(value)) numbers.push(Number(value));
    else names.push(value);
  });
  // Its own day, never a heading's above it: under "April 10", a header this reader does not know
  // ("Game,Start,Side A,Side B") was a game between "Game" and "Start" (found by Codex on #456).
  const when = day;
  if (when === undefined || when === null) return "skip";
  const [first, second] = numbers;
  if (!runs && numbers.length === 2 && first !== undefined && second !== undefined) {
    runs = [first, second];
  }
  const away = clampScheduleName(names[0]);
  const home = clampScheduleName(names[1]);
  if (!sidesOk(away, home)) return "skip";
  return { day: when, away, home, ...(runs ? { runs } : {}), guessed: true };
};

/**
 * A 0–0 against a game still to come is a schedule's placeholder, not a result, as
 * `parseScheduleText` reads it: the score comes off and the game stays. One dated before today
 * keeps it, a claim about a game that happened.
 */
const asRow = (game: Game, today: string): LeaguePasteRow => {
  const placeholder =
    game.runs !== undefined &&
    game.runs[0] === 0 &&
    game.runs[1] === 0 &&
    (game.day === "" || game.day >= today);
  return {
    date: game.day === "" ? "" : asLeagueDate(game.day),
    away: game.away,
    home: game.home,
    ...(game.runs && !placeholder ? { awayRuns: game.runs[0], homeRuns: game.runs[1] } : {}),
    ...(game.guessed ? { guessed: true as const } : {}),
  };
};

/**
 * Reads whatever was pasted, a line at a time:
 *
 * - A heading dates what follows it: `April 2027`, a bare `2027`, a bare `April`, or a line that is
 *   only a day, `Saturday, April 12`, or a day and a start time, `Sat 4/12 9:00 AM`, which every
 *   game under it is played on until the next.
 * - A table whose header names a Home and an Away (or Visitor) column is read by those columns,
 *   with a Date column and the two sides' scores where it has them.
 * - A line naming two sides around one marker is a game: "A @ B" and "A at B" have A away, "A vs
 *   B" has A home. Its day comes off the front, a start time and a field from wherever they are,
 *   and a final score off the end, in the order the sides were written.
 * - A row laid out in cells, a game written "A @ B" in one and its day, time or field in others,
 *   is read cell by cell, and a cell that is none of these (a place) is left out.
 * - A table with no header is read by position, away then home, and marked as a guess.
 * - A game cancelled, rained out, postponed or suspended is left out, as no fixture to add.
 * - A line naming a season, `Spring 2027 Schedule`, places the undated days after it in that
 *   season's year.
 *
 * `squadYear` places a day the paste gives no year for (`pasteSquadYear`); `today` is only ever
 * passed by a test.
 */
export const parseLeagueSchedule = (
  text: string,
  squadYear: number,
  today: string = todayIsoDay()
): LeagueSchedule => {
  const delimiter = text.includes("\t") ? "\t" : ",";
  const context: Context = {};
  let year = squadYear;
  // The day the last day-only line named: null when it named one no calendar has, so the games
  // under it are skipped rather than put on the day before.
  let carried: string | null = "";
  let header: Header | null = null;
  const rows: LeaguePasteRow[] = [];
  const skipped: string[] = [];

  text.split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line) return;
    if (rows.length >= SCHEDULE_TEXT_MAX_GAMES) {
      skipped.push(line);
      return;
    }

    const monthYear = MONTH_YEAR.exec(line);
    const headedMonth = monthYear ? monthOf(monthYear[1] ?? "") : undefined;
    if (monthYear && headedMonth !== undefined) {
      context.month = headedMonth;
      context.year = Number(monthYear[2]);
      return;
    }
    if (/^(?:19|20)\d{2}$/.test(line)) {
      context.year = Number(line);
      return;
    }
    if (ONLY_MONTH.test(line)) {
      context.month = monthOf(line.replace(".", ""));
      return;
    }
    const onlyDay = readDayOnly(line, context, year);
    if (onlyDay !== undefined) {
      carried = onlyDay;
      if (onlyDay === null) skipped.push(line);
      return;
    }
    if (NOT_PLAYED.test(line)) {
      skipped.push(line);
      return;
    }

    const take = (game: Game | "skip" | undefined) => {
      if (game === undefined || game === "skip") skipped.push(line);
      else rows.push(asRow(game, today));
    };

    const cells = cellsOf(line, delimiter);
    if (cells.length >= 2) {
      // A header may come again partway down, where a site prints one per week; it is never a game.
      const heading = readHeader(cells);
      if (heading) {
        header = heading;
        return;
      }
      if (header?.kind === "matchup") {
        take(readHeadedRow(cells, header, context, carried, year));
        return;
      }
      // One team's schedule ("Date, Opponent, Us, Them") names only one side of each game, which
      // is no league game, so its rows are left out rather than read by position. A header with no
      // Opponent ("Date, Team 1, Team 2") names both sides without saying which hosted, and its
      // rows are read by position like a table with none.
      if (header?.kind === "schedule" && header.opponent !== undefined) {
        skipped.push(line);
        return;
      }
      const laidOut = readCells(cells, context, carried, year);
      if (laidOut !== undefined) {
        take(laidOut);
        return;
      }
      const asLine = readLine(line, context, carried, year);
      take(asLine === undefined ? readBareRow(cells, context, year) : asLine);
      return;
    }

    const game = readLine(line, context, carried, year);
    if (game !== undefined) {
      take(game);
      return;
    }
    // Not a game: a title may still say which season the days below it are in.
    const titled = NAMES_A_SEASON.test(line) ? squadYearFromName(line) : undefined;
    if (titled !== undefined) year = titled;
    else skipped.push(line);
  });

  return { rows, skipped };
};
