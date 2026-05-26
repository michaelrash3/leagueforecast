import { clamp } from "./util";
import { DEFAULT_SEASON_YEAR } from "./types";

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
    const day = clamp(Number(mmdd[2]), 1, 31);
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

export const formatGameDate = (date: string) =>
  normalizeDateInput(date) || "No Date";

export const formatGameDateLong = (date: string) =>
  normalizeDateInput(date) || "Needs Date";

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
