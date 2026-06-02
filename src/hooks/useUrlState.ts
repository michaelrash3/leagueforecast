import { useEffect, useState } from "react";
import {
  readSharedFromHash,
  readShareUiStateFromHash,
  type SharedSnapshot,
  type ShareUiState,
} from "../lib/share";

/**
 * Reads a shared snapshot from `location.hash` once on mount. Returns the
 * snapshot (or null) and a `clear()` helper that removes the hash without
 * a navigation.
 */
export function useUrlSnapshot() {
  const [snapshot, setSnapshot] = useState<SharedSnapshot | null>(() =>
    typeof window === "undefined" ? null : readSharedFromHash(window.location.hash)
  );
  const [uiState, setUiState] = useState<ShareUiState>(() =>
    typeof window === "undefined" ? {} : readShareUiStateFromHash(window.location.hash)
  );

  const clear = () => {
    if (typeof window === "undefined") return;
    history.replaceState(null, "", window.location.pathname + window.location.search);
    setSnapshot(null);
    setUiState({});
  };

  useEffect(() => {
    const handler = () => {
      setSnapshot(readSharedFromHash(window.location.hash));
      setUiState(readShareUiStateFromHash(window.location.hash));
    };
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  return { snapshot, uiState, clear };
}
