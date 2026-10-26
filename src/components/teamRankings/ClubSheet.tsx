import { useEffect, useRef, type ReactNode } from "react";
import { holdClubSheet } from "../../lib/clubSheetHistory";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A club's panel in a sheet over the page, on both Team Rankings screens: opened from the board,
 * the panel was drawn at the foot of the page and scrolled to, and the place on the board was lost
 * with it. The sheet keeps the board where it was underneath: Close, Esc, the shade beside it or
 * Back (`clubSheetHistory.ts`) puts the reader back on it, with focus on what opened the club.
 *
 * Focus goes to the sheet itself, which is there at once, rather than its first control: the live
 * board's panel arrives a moment later from its card. Tab stays inside the sheet, and the page
 * behind does not scroll while it is open.
 */
export function ClubSheet({
  label,
  onShut,
  onClose,
  children,
}: {
  label: string;
  /** Shuts the sheet where the page holds it: what Back does, the history having moved already. */
  onShut: () => void;
  /** Shuts it by its own controls, which also takes back the entry it added (`leftClubSheet`). */
  onClose: () => void;
  children: ReactNode;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const shut = useRef(onShut);
  const close = useRef(onClose);
  useEffect(() => {
    shut.current = onShut;
    close.current = onClose;
  });
  useEffect(() => holdClubSheet(() => shut.current()), []);
  /*
   * Esc and Tab, heard on the window: after React's own handlers, so an Esc a box inside used to
   * close its list, and said so (`preventDefault`), is left to the box.
   */
  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      const node = sheet.current;
      if (!node) return;
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        close.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = items[0];
      const last = items[items.length - 1];
      const at = document.activeElement;
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && (at === first || at === node || !node.contains(at))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (at === last || !node.contains(at))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", keyDown);
    return () => window.removeEventListener("keydown", keyDown);
  }, []);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sheet.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-slate-950/40" aria-hidden="true" onClick={onClose} />
      <div
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="relative h-full w-full max-w-2xl overflow-y-auto overscroll-contain bg-slate-100 p-2 shadow-2xl outline-none sm:p-3 dark:bg-slate-950"
      >
        {children}
      </div>
    </div>
  );
}
