import { useEffect, useState } from "react";
import { readAppMode, writeAppMode, type AppMode } from "../lib/preferences";

export type { AppMode };

export function useAppMode() {
  const [appMode, setAppMode] = useState<AppMode>(() => readAppMode() ?? "league");

  useEffect(() => {
    writeAppMode(appMode);
  }, [appMode]);

  return { appMode, setAppMode };
}
