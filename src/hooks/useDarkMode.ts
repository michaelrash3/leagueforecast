import { useEffect, useState } from "react";

const STORAGE_KEY = "nkb_theme_v1";

type Theme = "light" | "dark";

const safeGet = (): Theme | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === "light" || raw === "dark" ? raw : null;
  } catch {
    return null;
  }
};

const safeSet = (theme: Theme) => {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
};

const systemPrefersDark = () =>
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-color-scheme: dark)").matches;

export function useDarkMode() {
  const [theme, setTheme] = useState<Theme>(() => safeGet() ?? (systemPrefersDark() ? "dark" : "light"));

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    safeSet(theme);
  }, [theme]);

  const toggle = () => setTheme((current) => (current === "dark" ? "light" : "dark"));

  return { theme, setTheme, toggle };
}
