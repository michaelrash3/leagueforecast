import { useSyncExternalStore } from "react";
import type { TabTurn } from "../../lib/tabTurn";
import { button } from "../../styles/tokens";
import { StatePanel } from "../StatePanel";

const never = () => () => undefined;

/** Whether this tab is read-only for another tab's turn (`tabTurn.ts`), as it changes. */
export const useTabReadOnly = (turn: TabTurn | null): boolean =>
  useSyncExternalStore(
    turn ? turn.onChange : never,
    () => turn?.readOnly() ?? false,
    () => false
  );

/**
 * The line over League Standings in a tab another tab has the turn from: this tab is read-only, so
 * the two do not undo each other's changes, and "Use here" takes the turn, reloading with what the
 * other saved. Nothing at all in the tab that has it.
 */
export function TabTurnBanner({
  readOnly,
  onUseHere,
}: {
  readOnly: boolean;
  onUseHere: () => void;
}) {
  if (!readOnly) return null;
  return (
    <StatePanel
      kind="stale"
      className="mb-4"
      title="Open in another tab"
      actions={
        <button type="button" onClick={onUseHere} className={button.ghost}>
          Use here
        </button>
      }
    >
      League Standings is open in another tab of this browser, so this one is read-only: two tabs
      saving would undo each other&apos;s changes. Use here to edit in this tab instead; it reloads
      with what the other saved.
    </StatePanel>
  );
}
