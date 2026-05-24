import { useId, useRef } from "react";
import { useEscape, useFocusTrap } from "../hooks/useFocusTrap";

export type ShortcutEntry = { combo: string; description: string; group?: string };

export function ShortcutsHelp({
  open,
  shortcuts,
  onClose,
}: {
  open: boolean;
  shortcuts: ShortcutEntry[];
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(open, containerRef as React.RefObject<HTMLElement>);
  useEscape(open, onClose);
  if (!open) return null;

  const grouped = shortcuts.reduce<Record<string, ShortcutEntry[]>>((acc, entry) => {
    const g = entry.group ?? "General";
    acc[g] = acc[g] ?? [];
    acc[g].push(entry);
    return acc;
  }, {});

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/40 p-3"
      role="presentation"
      onClick={onClose}
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events */}
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h2 id={titleId} className="text-lg font-black text-slate-950 dark:text-slate-100">
            Keyboard Shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-xs font-black uppercase tracking-wide text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            Close
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-4 py-3">
          {Object.entries(grouped).map(([group, entries]) => (
            <section key={group} className="mb-4">
              <h3 className="mb-2 text-[11px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {group}
              </h3>
              <ul className="space-y-1.5">
                {entries.map((entry) => (
                  <li
                    key={`${group}-${entry.combo}`}
                    className="flex items-center justify-between gap-3 text-sm font-bold text-slate-700 dark:text-slate-200"
                  >
                    <span>{entry.description}</span>
                    <kbd className="rounded border border-slate-300 bg-slate-50 px-2 py-0.5 font-mono text-xs text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
                      {entry.combo}
                    </kbd>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
