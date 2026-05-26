export function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="p-4">
      <div className="text-[11px] font-black uppercase tracking-wide text-slate-300">{label}</div>
      <div className="mt-1 truncate text-xl font-black tracking-tight">{value}</div>
    </div>
  );
}

export function DrawerMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="text-[10px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 text-lg font-black text-slate-950 dark:text-slate-100">{value}</div>
    </div>
  );
}
