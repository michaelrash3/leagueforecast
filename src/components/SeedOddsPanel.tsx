import { useMemo } from "react";
import type { BracketOddsResult } from "../lib/sim";
import { likelySeeds } from "../lib/seedRange";
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
          Monte Carlo bracket over {bracketOdds.iterations} simulated seasons — the chance each team
          lands each seed, reaches the final, and wins the Gold Bracket.
        </p>
      </div>

      {championRows.length > 0 && (
        <div className="mb-6">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Title odds
          </div>
          <ul className="space-y-2">
            {championRows.map((row) => (
              <li key={row.team.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="basis-full text-sm font-bold wrap-break-word sm:w-28 sm:shrink-0 sm:basis-auto sm:truncate text-slate-800 dark:text-slate-200">
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
                <span className="w-20 shrink-0 text-right text-xs font-bold text-slate-500 dark:text-slate-400">
                  {pct(row.finals)} final
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Projected seeding
        </div>
        <div className="overflow-x-auto">
          <table className="border-separate border-spacing-1 text-xs font-semibold">
            <thead>
              <tr>
                <th className="p-1 text-left text-slate-500 dark:text-slate-400" aria-hidden />
                {seedColumns.map((seed) => (
                  <th
                    key={`seed-${seed}`}
                    className={`w-8 p-1 text-center ${
                      seed === cutoff
                        ? "text-red-700 dark:text-red-400"
                        : "text-slate-500 dark:text-slate-400"
                    }`}
                  >
                    {seed}
                  </th>
                ))}
                <th
                  className="p-1 pl-2 text-left text-slate-500 dark:text-slate-400"
                  title="The seeds it finishes in, eight simulated seasons in ten"
                >
                  Likely
                </th>
              </tr>
            </thead>
            <tbody>
              {teams.map((team) => {
                const distribution = bracketOdds.seedDistribution[team.id] ?? [];
                const likely = likelySeeds(distribution);
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
                      // Never past 80% blue, where a figure still reads at 4.5:1 or better: dark
                      // on the light card (7.3:1 at the strongest) and white on the dark one (5.0:1).
                      // Full blue left white figures at 3.7:1, and slate ones paler than that.
                      const opacity = Math.min(0.8, probability / 60);
                      return (
                        <td
                          key={`${team.id}-${seed}`}
                          className={`h-7 w-8 text-center align-middle ${
                            seed === cutoff
                              ? "ring-1 ring-inset ring-red-300 dark:ring-red-800"
                              : ""
                          }`}
                          style={{
                            backgroundColor:
                              probability > 0 ? `rgba(59, 130, 246, ${opacity})` : undefined,
                          }}
                          title={`${displayName(team.name)} — seed ${seed}: ${probability.toFixed(1)}%`}
                        >
                          <span className="text-slate-950 dark:text-white">
                            {probability >= 12 ? Math.round(probability) : ""}
                          </span>
                        </td>
                      );
                    })}
                    <td className="p-1 pl-2 whitespace-nowrap text-slate-700 dark:text-slate-200">
                      {likely === null
                        ? "—"
                        : likely.best === likely.worst
                          ? likely.best
                          : `${likely.best}–${likely.worst}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">
          Cells show the chance of each final seed. The red column marks the Gold cut line (top{" "}
          {cutoff}). Likely is the seeds each team finishes in eight simulated seasons in ten.
        </p>
      </div>
    </section>
  );
}
