/**
 * One number in the header strip. On a wide screen it is a card of its own, with a coloured
 * hairline above it so the row reads as a set. On a phone (`line`) it is a line of the strip's one
 * card, its name on the left and its figure on the right, 100px for the three: as cards two to a
 * row they took 176px of a 360px phone's first screen, their names on two lines, and left the third
 * on a row by itself.
 */
export function HeaderStatCard({
  label,
  value,
  accent,
  line = false,
}: {
  label: string;
  value: string;
  accent: string;
  line?: boolean;
}) {
  if (line) {
    return (
      <div className="flex items-baseline justify-between gap-3 px-3 py-1.5">
        <div className="shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {label}
        </div>
        <div className="min-w-0 text-right text-base wrap-break-word font-black leading-tight tracking-tight text-slate-950 dark:text-white">
          {value}
        </div>
      </div>
    );
  }
  return (
    <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-800 dark:bg-slate-950">
      <div className={`absolute inset-x-0 top-0 h-0.5 bg-linear-to-r ${accent} opacity-90`} />
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="mt-0.5 text-lg wrap-break-word font-black leading-tight tracking-tight text-slate-950 dark:text-white">
        {value}
      </div>
    </div>
  );
}
