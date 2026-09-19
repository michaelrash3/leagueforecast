import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusTrap } from "./useFocusTrap";

export type ConfirmState = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

export type Confirmation = {
  /** The dialog to render, or null when nothing is being asked. */
  state: ConfirmState | null;
  /** Attach to the dialog element; focus is trapped inside it while it is open. */
  dialogRef: React.RefObject<HTMLElement | null>;
  /** Opens the dialog and resolves once the person answers. */
  request: (options: ConfirmState) => Promise<boolean>;
  /** Answers the open dialog. */
  resolve: (confirmed: boolean) => void;
};

/**
 * A confirmation dialog whose promise is always settled.
 *
 * There is one dialog and one pending answer, so the resolver lives in a ref rather than in state
 * — the person answering must not depend on a re-render having happened. The hazard that follows
 * from a single slot is that taking it twice strands the first caller: an `await
 * requestConfirmation(...)` whose resolver is overwritten never settles, so the code after it
 * never runs and everything it holds is retained for the life of the page. Two paths can do that
 * — a second dialog opened while one is pending, and an unmount while one is pending — and both
 * settle the stranded caller as declined here. Declined rather than confirmed because every
 * caller guards with `if (!confirmed) return;`: a dialog that was never answered must not be read
 * as a yes to deleting a season.
 */
export function useConfirmation(): Confirmation {
  const [state, setState] = useState<ConfirmState | null>(null);
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const dialogRef = useRef<HTMLElement>(null);

  const request = useCallback(
    (options: ConfirmState) =>
      new Promise<boolean>((resolve) => {
        // Settle whoever held the slot before taking it, or their await never returns.
        resolverRef.current?.(false);
        resolverRef.current = resolve;
        setState(options);
      }),
    []
  );

  const resolve = useCallback((confirmed: boolean) => {
    resolverRef.current?.(confirmed);
    resolverRef.current = null;
    setState(null);
  }, []);

  // An unmount with a dialog open is the other way to strand a caller.
  useEffect(
    () => () => {
      resolverRef.current?.(false);
      resolverRef.current = null;
    },
    []
  );

  useFocusTrap(!!state, dialogRef as React.RefObject<HTMLElement>);

  useEffect(() => {
    if (!state) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") resolve(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, resolve]);

  return { state, dialogRef, request, resolve };
}
