import { useSyncExternalStore } from "react";
import { onTabReadOnly, tabReadOnly } from "../lib/tabTurn";

/** Whether this tab is read-only for another tab's turn (`tabTurn.ts`), as it changes. */
export const useTabReadOnly = (): boolean =>
  useSyncExternalStore(onTabReadOnly, tabReadOnly, () => false);
