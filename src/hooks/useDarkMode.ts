import { useEffect, useState } from "react";
import { readTheme, writeTheme, type Theme } from "../lib/preferences";

const systemPrefersDark = () =>
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-color-scheme: dark)").matches;

export function useDarkMode() {
  const [theme, setTheme] = useState<Theme>(
    () => readTheme() ?? (systemPrefersDark() ? "dark" : "light")
  );

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    writeTheme(theme);
  }, [theme]);

  const toggle = () => setTheme((current) => (current === "dark" ? "light" : "dark"));

  return { theme, setTheme, toggle };
}
