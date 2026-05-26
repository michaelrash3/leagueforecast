import { useEffect, useState } from "react";
import { normalizeDateInput } from "../lib/date";

export function GameDateInput({
  value,
  onCommit,
  ariaLabel,
}: {
  value: string;
  onCommit: (value: string) => void;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(value || "");

  useEffect(() => {
    setDraft(value || "");
  }, [value]);

  const commit = () => {
    const normalized = normalizeDateInput(draft);
    onCommit(normalized);
    setDraft(normalized);
  };

  return (
    <input
      type="text"
      inputMode="text"
      placeholder="5/1"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      className="w-28 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-bold text-slate-950 outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white dark:focus:ring-slate-700"
      aria-label={ariaLabel ?? "Game date in M/D format"}
    />
  );
}
