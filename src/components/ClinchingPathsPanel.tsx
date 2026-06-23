import type { ClinchingPathNote } from "../lib/clinchingPaths";

export function ClinchingPathsPanel({
  paths,
  lastInName,
  firstOutName,
  pointsGap,
  onSelectTeam,
}: {
  paths: ClinchingPathNote[];
  lastInName: string;
  firstOutName: string;
  pointsGap: number | null;
  onSelectTeam: (id: string) => void;
}) {
  return (
    <section className="rounded-none border border-amber-200 bg-amber-50/70 p-5 shadow-sm dark:border-amber-900/60 dark:bg-amber-950/20">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-100">
            Gold Bracket Paths
          </h3>
        </div>
        <div className="rounded-none bg-white px-3 py-2 text-xs font-black text-slate-600 shadow-sm ring-1 ring-amber-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-amber-900/60">
          Last in: {lastInName} · First out: {firstOutName}
          {pointsGap !== null ? ` · Gap ${pointsGap}` : ""}
        </div>
      </div>

      {paths.length === 0 ? (
        <div className="rounded-none border border-dashed border-amber-300 bg-white/70 p-6 text-center text-sm font-bold text-slate-500 dark:border-amber-900 dark:bg-slate-900/50 dark:text-slate-400">
          No paths yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {paths.map((path) => (
            <article
              key={path.teamId}
              className="rounded-none bg-white p-4 shadow-sm ring-1 ring-amber-200 dark:bg-slate-900 dark:ring-amber-900/70"
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <button
                  type="button"
                  onClick={() => onSelectTeam(path.teamId)}
                  className="text-left font-black text-slate-950 underline-offset-4 hover:underline dark:text-slate-100"
                >
                  {path.teamName}
                </button>
                <div className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-black text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
                  #{path.seed} now · #{path.projectedSeed} proj · {path.goldPct}%
                </div>
              </div>
              <ul className="space-y-2">
                {path.notes.map((note) => (
                  <li
                    key={note}
                    className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-bold leading-6 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  >
                    {note}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
