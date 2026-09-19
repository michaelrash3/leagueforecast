import { TIDY_STEPS, type TidyStepName } from "../../lib/gameChangerImport";
import type { TidyProgress } from "../../hooks/usePoolTidy";

/**
 * What the tidy is doing, while it does it.
 *
 * The tidy is the longest thing this app does — nine passes' worth of walking every game, the
 * better part of half a minute on a nationwide pool — and it showed a spinner and a sentence. On a
 * pool that takes that long, a spinner and a sentence are indistinguishable from a hang, which is
 * how a tidy came to be interrupted by a reload often enough to leave eleven thousand results
 * filed against "TBD" while the code to settle them worked perfectly.
 *
 * What is worth drawing is the shape of the run rather than a percentage, which the tidy cannot
 * honestly give: it repeats until a pass finds nothing, so nobody knows how many passes there will
 * be until the last one. What it can say is what each pass found, and that is the interesting part
 * — each pass finds less than the one before, because a stand-in settled in pass one is the row
 * that lets another settle in pass two. Watching that fall to nothing is watching it finish.
 */

/** Short enough for a column head, with the full name on hover and for a screen reader. */
const STEP_LABEL: Record<TidyStepName, { short: string; full: string }> = {
  notBaseball: { short: "Not ball", full: "Teams that are not playing baseball, removed" },
  releveled: { short: "Level", full: "Age level worked out from the team's name" },
  pruned: { short: "Prune", full: "Games dated outside the squad year they are filed under" },
  named: { short: "Name", full: "Stand-ins the other side's schedule could name" },
  reclaimed: { short: "Reclaim", full: "Games moved to the namesake whose schedule holds them" },
  refiled: { short: "Refile", full: "Stand-in rows filed onto the club that turned out to be it" },
  folded: { short: "Fold", full: "Clubs holding several GameChanger ids, folded into one" },
  paired: { short: "Pair", full: "A squad and the same squad's next season, joined" },
  collapsed: { short: "Collapse", full: "Rows that describe one game, made one game" },
};

const count = (value: number) => value.toLocaleString();

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

type TidyProgressViewProps = {
  steps: TidyProgress[];
  /** Whether the tidy is still going, which is what the difference between live and done is. */
  running: boolean;
};

export function TidyProgressView({ steps, running }: TidyProgressViewProps) {
  if (steps.length === 0) {
    return running ? <p className="mt-3 text-xs text-slate-500">Starting the first pass…</p> : null;
  }

  const passes = [...new Set(steps.map((step) => step.pass))].sort((a, b) => a - b);
  const byKey = new Map(steps.map((step) => [`${step.pass}|${step.step}`, step]));
  const last = steps[steps.length - 1]!;

  /*
   * The scale every cell is shaded against. The first pass does nearly all of the work, so shading
   * against the largest number in the run is what makes the later passes read as the trickle they
   * are rather than as a second helping of the same size.
   */
  const most = Math.max(...steps.map((step) => step.found), 1);
  const weight = (found: number) => {
    if (found === 0) return 0;
    // Square-rooted, because a pass of 4,000 beside a pass of 5 would otherwise draw the 5 as
    // nothing at all, and a 5 that the next pass turns into 0 is exactly what finishing looks like.
    return Math.max(0.12, Math.sqrt(found / most));
  };

  const perStep = (name: TidyStepName) =>
    steps.filter((step) => step.step === name).reduce((sum, step) => sum + step.found, 0);
  const total = steps.reduce((sum, step) => sum + step.found, 0);

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-xs font-black uppercase tracking-wide text-slate-500">
          {running
            ? `Pass ${last.pass}, ${STEP_LABEL[last.step].short.toLowerCase()}`
            : "What the tidy did"}
        </p>
        <p className="text-xs text-slate-500 tabular-nums">
          {count(total)} changed in {seconds(last.ms)} · {count(last.games)} games,{" "}
          {count(last.teams)} teams
        </p>
      </div>

      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[34rem] border-separate border-spacing-0.5 text-xs">
          <caption className="sr-only">
            What each pass of the tidy found, by step. Each pass finds less than the one before; the
            tidy stops when a pass finds nothing.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="px-1 text-left font-bold text-slate-500">
                Pass
              </th>
              {TIDY_STEPS.map((name) => (
                <th
                  key={name}
                  scope="col"
                  title={STEP_LABEL[name].full}
                  className="px-1 text-center font-bold text-slate-500"
                >
                  {STEP_LABEL[name].short}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {passes.map((pass) => (
              <tr key={pass}>
                <th
                  scope="row"
                  className="px-1 text-left font-bold text-slate-700 tabular-nums dark:text-slate-200"
                >
                  {pass}
                </th>
                {TIDY_STEPS.map((name) => {
                  const cell = byKey.get(`${pass}|${name}`);
                  const isNow = running && cell === last;
                  return (
                    <td key={name} className="p-0">
                      <div
                        className={`rounded px-1 py-1 text-center tabular-nums ${
                          isNow ? "ring-2 ring-slate-950 dark:ring-white" : ""
                        } ${
                          cell === undefined
                            ? "text-slate-300 dark:text-slate-700"
                            : cell.found === 0
                              ? "bg-slate-100 text-slate-400 dark:bg-slate-900 dark:text-slate-600"
                              : "bg-emerald-500 font-bold text-white"
                        }`}
                        style={
                          cell && cell.found > 0
                            ? { opacity: 0.35 + 0.65 * weight(cell.found) }
                            : undefined
                        }
                        aria-label={
                          cell === undefined
                            ? `Pass ${pass}, ${STEP_LABEL[name].short}: not reached`
                            : `Pass ${pass}, ${STEP_LABEL[name].full}: ${count(cell.found)}`
                        }
                      >
                        {cell === undefined ? "·" : count(cell.found)}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className="px-1 text-left font-bold text-slate-500">
                All
              </th>
              {TIDY_STEPS.map((name) => (
                <td
                  key={name}
                  className="px-1 py-1 text-center font-bold text-slate-700 tabular-nums dark:text-slate-200"
                >
                  {count(perStep(name))}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="mt-2 text-xs text-slate-500">
        {running
          ? "Each pass finds less than the one before — a stand-in settled in one pass is the row that lets another settle in the next. It stops when a pass finds nothing."
          : `${passes.length} pass${passes.length === 1 ? "" : "es"}; the last found nothing, which is how it knew to stop.`}
      </p>
    </div>
  );
}
