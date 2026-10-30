import { clamp } from "./util";
import { DEFAULT_SEASON_YEAR } from "./types";

/** The longest each month gets. February takes 29: the year is unknown here and a leap day is real. */
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export const toMMDD = (date: Date) => `${date.getMonth() + 1}/${date.getDate()}`;

const MONTH_ABBREVIATIONS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

const MONTH_TOKEN_RE =
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\b/i;

export const normalizeDateInput = (value: string) => {
  const trimmed = value?.trim();
  if (!trimmed) return "";

  // Preferred app format: M/D.
  const mmdd = trimmed.match(/^(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?$/);
  if (mmdd) {
    const month = clamp(Number(mmdd[1]), 1, 12);
    /*
     * Clamped to the month rather than to 31, because a day this month does not have is a typo
     * and the alternative is worse than refusing it: "2/31" used to come back as written and then
     * roll over to March 3 wherever it was parsed, so a mistyped February game quietly moved to a
     * different month. February takes 29 here whatever the year, since the year is not known at
     * this point and a leap day is a real date.
     */
    const day = clamp(Number(mmdd[2]), 1, DAYS_IN_MONTH[month - 1] ?? 31);
    return `${month}/${day}`;
  }

  // ISO from older builds or browser date inputs. Read by hand, as the date parser rolls a day
  // the month lacks into the next month; here the year is known, so the day is kept to that
  // year's month and 2027-02-29 is the 28th.
  const isoDay = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (isoDay) {
    const year = Number(isoDay[1]);
    const month = Number(isoDay[2]);
    const day = Number(isoDay[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return "";
    const monthDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return `${month}/${Math.min(day, monthDays)}`;
  }

  // Old CSV format: "May 1", "May 01", etc. Require a 3+ char alpha month token
  // so bare numbers like "5" don't silently parse to Jan 1.
  const monthToken = MONTH_TOKEN_RE.exec(trimmed);
  // A month word with no day ("may") is no date: the parser read it as the month's first.
  if (monthToken && /\d/.test(trimmed)) {
    const withSeasonYear = Date.parse(`${trimmed} ${DEFAULT_SEASON_YEAR}`);
    const parsed = Number.isFinite(withSeasonYear) ? withSeasonYear : Date.parse(trimmed);
    if (Number.isFinite(parsed)) {
      const date = new Date(parsed);
      /*
       * The parser rolls a day the named month lacks into the next month, "Apr 31" to May 1;
       * that day is the named month's last instead, as "4/31" is above.
       */
      const named = MONTH_ABBREVIATIONS.indexOf((monthToken[1] ?? "").slice(0, 3).toLowerCase());
      if (named >= 0 && date.getMonth() !== named) return `${named + 1}/${DAYS_IN_MONTH[named]}`;
      return toMMDD(date);
    }
  }

  return "";
};

/**
 * The month a League Standings season's year turns in, read off its own "M/D" dates: the first
 * month after the longest run of months it plays nothing in, so a fall league that plays on into
 * January starts in its autumn and a summer league running into August starts in its June. A
 * season inside one calendar year starts at its own first month, which orders it exactly as the
 * calendar does. Where two runs tie there is nothing to say which ends the year, and the calendar's
 * order is kept; so it is with no dates, or games in every month.
 */
export const seasonStartMonth = (dates: Iterable<string | undefined>): number => {
  const played = new Set<number>();
  for (const date of dates) {
    const normalized = normalizeDateInput(date ?? "");
    if (normalized) played.add(Number(normalized.split("/")[0]));
  }
  if (played.size === 0 || played.size === 12) return 1;
  const months = [...played].sort((a, b) => a - b);
  let start = 1;
  let longest = -1;
  months.forEach((month, index) => {
    const next = months[(index + 1) % months.length] ?? month;
    // Months from this one to the next played, round the year: 12 when only one month is played.
    const gap = (next - month + 12) % 12 || 12;
    if (gap > longest || (gap === longest && next < start)) {
      longest = gap;
      start = next;
    }
  });
  return start;
};

/**
 * A League Standings date as a number to order by. The dates carry no year, so each is read in one
 * fixed year — except a month before `startMonth` (`seasonStartMonth`), which is read in the year
 * after it: a season that turns at New Year puts its January after its December rather than first.
 */
export const parseDateValue = (date: string, startMonth = 1) => {
  const normalized = normalizeDateInput(date);
  if (!normalized) return Number.POSITIVE_INFINITY;
  const month = Number(normalized.split("/")[0]);
  const year = month < startMonth ? DEFAULT_SEASON_YEAR + 1 : DEFAULT_SEASON_YEAR;
  const parsed = Date.parse(`${normalized}/${year}`);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
};

export const formatGameDate = (date: string) => normalizeDateInput(date) || "No Date";

export const formatGameDateLong = (date: string) => normalizeDateInput(date) || "Needs Date";

/**
 * The Sunday ending a game's week, "M/D". `startMonth` is the month the season's year turns in
 * (`seasonStartMonth`): a month before it is the next calendar year's, as `parseDateValue` reads
 * it. Worked out in one year whatever the season, a week from December into January was two.
 */
export const sundayEndingWeekKey = (date: string, startMonth = 1) => {
  const normalized = normalizeDateInput(date);
  if (!normalized) return "";
  const month = Number(normalized.split("/")[0]);
  const year = month < startMonth ? DEFAULT_SEASON_YEAR + 1 : DEFAULT_SEASON_YEAR;
  const parsed = new Date(`${normalized}/${year}`);
  if (!Number.isFinite(parsed.getTime())) return "";
  const day = parsed.getDay();
  const daysUntilSunday = (7 - day) % 7;
  const weekEnding = new Date(parsed);
  weekEnding.setDate(parsed.getDate() + daysUntilSunday);
  return toMMDD(weekEnding);
};

/**
 * Today as an ISO day ("2026-09-18") in the reader's own zone — the shape Team Rankings stores a
 * game's date in, so the two compare as strings.
 */
export const todayIsoDay = (now = new Date()): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;

/**
 * The ISO day `days` after `day` (before it, for a negative count), counted in whole calendar days.
 * Worked in UTC because an ISO day names a date, not an instant: a local-time sum slips a day
 * across a change of clocks.
 */
export const shiftIsoDay = (day: string, days: number): string => {
  const at = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(at)) return day;
  return new Date(at + days * 86_400_000).toISOString().slice(0, 10);
};

/** Whole days from an ISO instant or day to now, or null for a value that is not a time at all. */
export const daysSince = (iso: string | null | undefined, now = new Date()): number | null => {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.floor((now.getTime() - at) / 86_400_000));
};

/** "today", "yesterday", "12 days ago" or "never": the tail of a freshness line. */
export const agoLabel = (iso: string | null | undefined, now = new Date()): string => {
  const days = daysSince(iso, now);
  if (days === null) return "never";
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
};

/** "Sat, Sep 20" from "2026-09-20". Parsed as UTC so the day cannot slip a timezone backwards. */
export const formatIsoDayShort = (date: string): string => {
  if (!date) return "No date";
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
};

/**
 * Games in the order they are played: by day, then by start time, where GameChanger gave one
 * (`startTs`, an instant in UTC). A game with no start is listed after the day's timed games, since
 * it could be any time that day. Two games of one day otherwise kept their stored order, which put
 * a doubleheader's second game first as often as not.
 *
 * Kept here rather than in a file of their own: League's opening code sorts by start too, and a
 * module both it and Team Rankings import was built as a file of its own in the page's first
 * download, 0.4 KB gzipped where the same code measured 0.2 KB in this one (30 Oct 2026).
 */
type Timed = { date?: string; startTs?: string };

/** A start in milliseconds, or undefined where there is none or it does not read. */
const startMs = (startTs: string | undefined): number | undefined => {
  if (!startTs) return undefined;
  const ms = Date.parse(startTs);
  return Number.isFinite(ms) ? ms : undefined;
};

/** Untimed after timed, either way round; null when both are timed. */
const untimedLast = (x: number | undefined, y: number | undefined): number | null =>
  x === undefined || y === undefined ? (x === undefined ? 1 : 0) - (y === undefined ? 1 : 0) : null;

/** Two games of one day, the earlier start first. */
export const byStart = (a: Timed, b: Timed): number => {
  const x = startMs(a.startTs);
  const y = startMs(b.startTs);
  return untimedLast(x, y) ?? (x as number) - (y as number);
};

/** Earliest first: by day ("2026-09-20" sorts as text), then by start. */
export const byGameTime = (a: Timed, b: Timed): number =>
  (a.date ?? "").localeCompare(b.date ?? "") || byStart(a, b);

/** Newest first: the latest day first, and in it the latest start first, untimed games last. */
export const byGameTimeNewest = (a: Timed, b: Timed): number => {
  const day = (b.date ?? "").localeCompare(a.date ?? "");
  if (day !== 0) return day;
  const x = startMs(a.startTs);
  const y = startMs(b.startTs);
  return untimedLast(x, y) ?? (y as number) - (x as number);
};

/**
 * A start as whole minutes since 1970, the form the published lists carry it in (a game's minute
 * is all the order needs); undefined where there is none.
 */
export const startMinutes = (startTs: string | undefined): number | undefined => {
  const ms = startMs(startTs);
  return ms === undefined ? undefined : Math.round(ms / 60_000);
};

/** The start a published list's minutes stand for. */
export const startTsOfMinutes = (minutes: number): string =>
  new Date(minutes * 60_000).toISOString();

/** A start as the Schedule shows it, in this device's time: "10:30 AM"; "" where there is none. */
export const formatStartTime = (startTs: string | undefined): string => {
  const ms = startMs(startTs);
  return ms === undefined
    ? ""
    : new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
};

/** A day and, where known, its start: "5/3 · 10:30 AM". */
export const dayAndTime = (day: string, startTs: string | undefined): string => {
  const time = formatStartTime(startTs);
  return time ? `${day} · ${time}` : day;
};
