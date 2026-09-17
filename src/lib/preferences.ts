/**
 * The UI preferences that persist outside the league and Team Rankings data: colour theme, which
 * half of the app you were last in, and whether the written summaries fetch themselves. They live
 * here rather than inside their hooks so a whole-browser backup can read and restore them without
 * duplicating the storage keys.
 */
export type Theme = "light" | "dark";
export type AppMode = "league" | "rankings";

/**
 * Whether a written summary goes and gets itself, or waits to be asked for.
 *
 * `ask` is the default, and it is the default because the summaries are not free. Each one is a
 * call to somebody's language-model quota, and they were being made on their own: the request is
 * rebuilt whenever its content changes, so switching age group or picking a different team in
 * Team Rankings sent another. A few minutes of clicking around cost a few dozen write-ups nobody
 * had asked to read.
 */
export type SummaryMode = "ask" | "auto";

const THEME_KEY = "nkb_theme_v1";
const APP_MODE_KEY = "lf_app_mode_v1";
const SUMMARY_MODE_KEY = "lf_summary_mode_v1";

const safeGet = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const safeSet = (key: string, value: string): boolean => {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
};

export const isTheme = (value: unknown): value is Theme => value === "light" || value === "dark";
export const isAppMode = (value: unknown): value is AppMode =>
  value === "league" || value === "rankings";

export const readTheme = (): Theme | null => {
  const raw = safeGet(THEME_KEY);
  return isTheme(raw) ? raw : null;
};
export const writeTheme = (theme: Theme): boolean => safeSet(THEME_KEY, theme);

export const readAppMode = (): AppMode | null => {
  const raw = safeGet(APP_MODE_KEY);
  return isAppMode(raw) ? raw : null;
};
export const writeAppMode = (mode: AppMode): boolean => safeSet(APP_MODE_KEY, mode);

export const isSummaryMode = (value: unknown): value is SummaryMode =>
  value === "ask" || value === "auto";

/** Unset reads as `ask`: a summary nobody chose to fetch is a summary nobody chose to pay for. */
export const readSummaryMode = (): SummaryMode => {
  const raw = safeGet(SUMMARY_MODE_KEY);
  return isSummaryMode(raw) ? raw : "ask";
};
export const writeSummaryMode = (mode: SummaryMode): boolean => safeSet(SUMMARY_MODE_KEY, mode);
