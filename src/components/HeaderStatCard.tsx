/**
 * One number in the header strip, with a coloured hairline above it so the row reads as a set.
 */
export function HeaderStatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-800 dark:bg-slate-950">
      <div className={`absolute inset-x-0 top-0 h-0.5 bg-linear-to-r ${accent} opacity-90`} />
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="mt-0.5 truncate text-lg font-black leading-tight tracking-tight text-slate-950 dark:text-white">
        {value}
      </div>
    </div>
  );
}
