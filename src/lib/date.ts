import { clamp } from "./util";
import { DEFAULT_SEASON_YEAR } from "./types";

/** The longest each month gets. February takes 29: the year is unknown here and a leap day is real. */
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export const toMMDD = (date: Date) => `${date.getMonth() + 1}/${date.getDate()}`;

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

  // ISO from older builds or browser date inputs.
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const date = new Date(`${trimmed}T12:00:00`);
    return Number.isFinite(date.getTime()) ? toMMDD(date) : "";
  }

  // Old CSV format: "May 1", "May 01", etc. Require a 3+ char alpha month token
  // so bare numbers like "5" don't silently parse to Jan 1.
  if (MONTH_TOKEN_RE.test(trimmed)) {
    const withSeasonYear = Date.parse(`${trimmed} ${DEFAULT_SEASON_YEAR}`);
    if (Number.isFinite(withSeasonYear)) return toMMDD(new Date(withSeasonYear));
    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) return toMMDD(new Date(parsed));
  }

  return "";
};

export const parseDateValue = (date: string) => {
  const normalized = normalizeDateInput(date);
  if (!normalized) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(`${normalized}/${DEFAULT_SEASON_YEAR}`);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
};

export const formatGameDate = (date: string) => normalizeDateInput(date) || "No Date";

export const formatGameDateLong = (date: string) => normalizeDateInput(date) || "Needs Date";

export const sundayEndingWeekKey = (date: string) => {
  const normalized = normalizeDateInput(date);
  if (!normalized) return "";
  const parsed = new Date(`${normalized}/${DEFAULT_SEASON_YEAR}`);
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
