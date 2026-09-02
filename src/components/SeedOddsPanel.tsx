import { useMemo } from "react";
import type { BracketOddsResult } from "../lib/sim";
import { displayName, teamAbbr } from "../lib/format";

type SeedTeam = { id: string; name: string };

const pct = (value: number) => `${Math.round(value)}%`;

/**
 * Championship + seed-distribution odds from the Monte Carlo bracket sim. Unlike the single
 * deterministic bracket projection, this answers "how likely is each team to earn each seed and
 * win it all" across thousands of simulated seasons and brackets.
 */
export function SeedOddsPanel({
  teams,
  bracketOdds,
  cutoff,
  cardClassName,
}: {
  teams: SeedTeam[];
  bracketOdds: BracketOddsResult;
  cutoff: number;
  cardClassName: string;
}) {
  const championRows = useMemo(
    () =>
      teams
        .map((team) => ({
          team,
          champion: bracketOdds.championOdds[team.id] ?? 0,
          finals: bracketOdds.finalsOdds[team.id] ?? 0,
        }))
        .filter((row) => row.champion > 0 || row.finals > 0)
        .sort((a, b) => b.champion - a.champion || b.finals - a.finals)
        .slice(0, 8),
    [teams, bracketOdds]
  );

  const seedColumns = useMemo(() => teams.map((_, index) => index + 1), [teams]);

  if (bracketOdds.iterations === 0) return null;

  const topChampion = championRows[0]?.champion ?? 0;

  return (
    <section className={`${cardClassName} p-5`} aria-label="Championship and seed odds">
      <div className="mb-4">
        <h3 className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-100">
          Championship &amp; Seed Odds
        </h3>
        <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
          Monte Carlo bracket over {bracketOdds.iterations} simulated seasons — the chance each
          team lands each seed, reaches the final, and wins the Gold Bracket.
        </p>
      </div>

      {championRows.length > 0 && (
        <div className="mb-6">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Title odds
          </div>
          <ul className="space-y-2">
            {championRows.map((row) => (
              <li key={row.team.id} className="flex items-center gap-3">
                <span className="w-28 shrink-0 truncate text-sm font-bold text-slate-800 dark:text-slate-200">
                  {displayName(row.team.name)}
                </span>
                <div className="relative h-5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    className="h-full rounded-full bg-blue-500"
                    style={{
                      width: `${topChampion > 0 ? Math.max(2, (row.champion / topChampion) * 100) : 0}%`,
                    }}
                  />
                </div>
                <span className="w-12 shrink-0 text-right text-sm font-bold text-slate-900 dark:text-slate-100">
                  {pct(row.champion)}
                </span>
                <span className="w-20 shrink-0 text-right text-[11px] font-bold text-slate-500 dark:text-slate-400">
                  {pct(row.finals)} final
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Projected seeding
        </div>
        <div className="overflow-x-auto">
          <table className="border-separate border-spacing-1 text-[10px] font-semibold">
            <thead>
              <tr>
                <th className="p-1 text-left text-slate-500 dark:text-slate-400" aria-hidden />
                {seedColumns.map((seed) => (
                  <th
                    key={`seed-${seed}`}
                    className={`w-8 p-1 text-center ${
                      seed === cutoff
                        ? "text-red-500"
                        : "text-slate-500 dark:text-slate-400"
                    }`}
                  >
                    {seed}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {teams.map((team) => {
                const distribution = bracketOdds.seedDistribution[team.id] ?? [];
                return (
                  <tr key={team.id}>
                    <th
                      scope="row"
                      className="p-1 text-right font-black text-slate-600 dark:text-slate-300"
                      title={displayName(team.name)}
                    >
                      {teamAbbr(team.name)}
                    </th>
                    {seedColumns.map((seed) => {
                      const probability = distribution[seed - 1] ?? 0;
                      const opacity = Math.min(1, probability / 60);
                      return (
                        <td
                          key={`${team.id}-${seed}`}
                          className={`h-7 w-8 text-center align-middle ${
                            seed === cutoff ? "ring-1 ring-inset ring-red-300 dark:ring-red-800" : ""
                          }`}
                          style={{
                            backgroundColor:
                              probability > 0 ? `rgba(59, 130, 246, ${opacity})` : undefined,
                          }}
                          title={`${displayName(team.name)} — seed ${seed}: ${probability.toFixed(1)}%`}
                        >
                          <span
                            className={
                              opacity > 0.55
                                ? "text-white"
                                : "text-slate-600 dark:text-slate-300"
                            }
                          >
                            {probability >= 12 ? Math.round(probability) : ""}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] font-bold text-slate-400 dark:text-slate-500">
          Cells show the chance of each final seed. The red column marks the Gold cut line (top{" "}
          {cutoff}).
        </p>
      </div>
    </section>
  );
}
