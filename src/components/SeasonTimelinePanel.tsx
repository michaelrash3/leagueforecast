import type { SeasonTimelineEntry } from "../lib/seasonTimeline";

export function SeasonTimelinePanel({ entries }: { entries: SeasonTimelineEntry[] }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-100">
            Season Timeline
          </h3>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {entries.length} recent finals
        </span>
      </div>
      {entries.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm font-bold text-slate-500 dark:border-slate-600 dark:bg-slate-800/40 dark:text-slate-400">
          No final results yet.
        </div>
      ) : (
        <ol className="space-y-3">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-[11px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {entry.date}
                  </div>
                  <div className="mt-1 font-black text-slate-950 dark:text-slate-100">
                    {entry.label} · {entry.score}
                  </div>
                  <div className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">
                    Winner: {entry.winnerName}
                  </div>
                </div>
                <div className="rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-600 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700">
                  {entry.cutLineImpact}
                </div>
              </div>
              {entry.movement.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {entry.movement.map((item) => (
                    <span
                      key={item}
                      className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-600 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
