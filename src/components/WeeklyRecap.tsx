import type { RecapItem } from "../lib/insights";

export function WeeklyRecapCard({
  title,
  scopeLabel,
  items,
  onCopy,
  onDismiss,
}: {
  title: string;
  scopeLabel: string;
  items: RecapItem[];
  onCopy: () => void;
  onDismiss: () => void;
}) {
  if (items.length === 0) return null;
  return (
    <section
      aria-label={scopeLabel}
      className="rounded-none border border-slate-200 bg-gradient-to-br from-white via-white to-slate-50 p-5 shadow-sm dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-slate-950"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-black uppercase tracking-wide text-blue-700 dark:text-blue-400">
            {scopeLabel}
          </div>
          <h2 className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-100">
            {title}
          </h2>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCopy}
            className="rounded-full bg-slate-950 px-3 py-1 text-[11px] font-black uppercase tracking-wide text-white shadow-sm hover:bg-slate-800 dark:bg-white dark:text-slate-950"
          >
            Copy
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-full bg-white px-3 py-1 text-[11px] font-black uppercase tracking-wide text-slate-500 shadow-sm ring-1 ring-slate-200 hover:text-slate-950 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700 dark:hover:text-white"
          >
            Dismiss
          </button>
        </div>
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <li
            key={item.text}
            className={`rounded-none px-3 py-2 text-sm font-bold ${
              item.kind === "clinched"
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                : item.kind === "eliminated"
                  ? "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300"
                  : item.kind === "crossed-cut-up"
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                    : item.kind === "crossed-cut-down"
                      ? "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                      : item.kind === "biggest-mover" || item.kind === "biggest-faller"
                        ? "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300"
                        : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
            }`}
          >
            {item.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
