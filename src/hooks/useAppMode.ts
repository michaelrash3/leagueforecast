import { useEffect, useState } from "react";

const STORAGE_KEY = "lf_app_mode_v1";

export type AppMode = "league" | "rankings";

const safeGet = (): AppMode | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === "league" || raw === "rankings" ? raw : null;
  } catch {
    return null;
  }
};

const safeSet = (mode: AppMode) => {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
};

export function useAppMode() {
  const [appMode, setAppMode] = useState<AppMode>(() => safeGet() ?? "league");

  useEffect(() => {
    safeSet(appMode);
  }, [appMode]);

  return { appMode, setAppMode };
}
