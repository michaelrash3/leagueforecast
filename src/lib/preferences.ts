/**
 * The two UI preferences that persist outside the league and Team Rankings data: colour theme and
 * which half of the app you were last in. They live here rather than inside their hooks so a
 * whole-browser backup can read and restore them without duplicating the storage keys.
 */
export type Theme = "light" | "dark";
export type AppMode = "league" | "rankings";

const THEME_KEY = "nkb_theme_v1";
const APP_MODE_KEY = "lf_app_mode_v1";

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
