import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useEscape, useFocusTrap } from "../hooks/useFocusTrap";

export type Command = {
  id: string;
  label: string;
  hint?: string;
  group?: string;
  run: () => void;
};

const fuzzyScore = (query: string, target: string) => {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t.includes(q)) return 2;
  // simple subsequence match
  let i = 0;
  for (let j = 0; j < t.length && i < q.length; j += 1) {
    if (q[i] === t[j]) i += 1;
  }
  return i === q.length ? 1 : 0;
};

export function CommandPalette({
  open,
  commands,
  onClose,
}: {
  open: boolean;
  commands: Command[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(open, containerRef as React.RefObject<HTMLElement>);
  useEscape(open, onClose);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const scored = commands
      .map((cmd) => ({
        cmd,
        score: Math.max(fuzzyScore(query, cmd.label), fuzzyScore(query, cmd.hint ?? "")),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.map((s) => s.cmd);
  }, [commands, query]);

  if (!open) return null;

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((cur) => Math.min(cur + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((cur) => Math.max(cur - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const cmd = filtered[active];
      if (cmd) {
        cmd.run();
        onClose();
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-slate-950/40 p-3 pt-24"
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
        className="w-full max-w-xl overflow-hidden rounded-none bg-white shadow-2xl ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h2 id={titleId} className="sr-only">
            Command palette
          </h2>
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Type a team name or action…"
            aria-label="Command palette search"
            className="w-full bg-transparent text-base font-bold text-slate-950 outline-none placeholder:font-semibold placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
        </div>
        <ul
          role="listbox"
          aria-label="Commands"
          className="max-h-80 overflow-y-auto py-1"
        >
          {filtered.length === 0 && (
            <li className="px-4 py-6 text-center text-sm font-bold text-slate-500 dark:text-slate-400">
              No matches.
            </li>
          )}
          {filtered.map((cmd, index) => {
            const isActive = index === active;
            return (
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events
              <li
                key={cmd.id}
                role="option"
                aria-selected={isActive}
                className={`flex items-center justify-between gap-3 px-4 py-2 text-sm font-bold ${
                  isActive
                    ? "bg-slate-100 text-slate-950 dark:bg-slate-800 dark:text-slate-100"
                    : "text-slate-700 dark:text-slate-200"
                }`}
                onMouseEnter={() => setActive(index)}
                onClick={() => {
                  cmd.run();
                  onClose();
                }}
              >
                <span className="flex items-center gap-3">
                  {cmd.group && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      {cmd.group}
                    </span>
                  )}
                  <span>{cmd.label}</span>
                </span>
                {cmd.hint && (
                  <span className="text-xs font-semibold text-slate-400 dark:text-slate-500">
                    {cmd.hint}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <div className="border-t border-slate-200 px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:border-slate-700 dark:text-slate-500">
          ↑↓ navigate · Enter run · Esc close
        </div>
      </div>
    </div>
  );
}
