/**
 * One leaderboard per metric, each team's rank next to its per-game number, with the league
 * average drawn in as a line the table is read against.
 */
import type { StatRankingMetric, StatRankings } from "../../lib/teamStats";
import { displayName } from "../../lib/format";
import React from "react";

export function StatRankingsPanel({ rankings }: { rankings: StatRankings }) {
  const averageSeparator = (metric: StatRankingMetric) => (
    <li
      key={`${metric.key}-league-average`}
      aria-label={`League average for ${metric.label}`}
      className="flex items-center gap-3 bg-slate-200/80 px-4 py-2 text-slate-700 dark:bg-slate-700/80 dark:text-slate-200"
    >
      <div className="h-px flex-1 bg-slate-400/70 dark:bg-slate-500/80" />
      <div className="flex shrink-0 items-center gap-2 rounded-full bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-wide shadow-xs ring-1 ring-slate-300 dark:bg-slate-900 dark:ring-slate-600">
        <span>League Avg</span>
        <span className="tabular-nums">{metric.average?.toFixed(1)}</span>
      </div>
      <div className="h-px flex-1 bg-slate-400/70 dark:bg-slate-500/80" />
    </li>
  );

  const averageInsertIndex = (metric: StatRankingMetric) => {
    if (metric.average === null) return -1;

    const nullIndex = metric.entries.findIndex((entry) => entry.value === null);
    const fallbackIndex = nullIndex === -1 ? metric.entries.length : nullIndex;
    const worseIndex = metric.entries.findIndex((entry) => {
      if (entry.value === null || metric.average === null) return false;
      return metric.direction === "asc"
        ? entry.value > metric.average
        : entry.value < metric.average;
    });

    return worseIndex === -1 ? fallbackIndex : worseIndex;
  };

  return (
    <section className="bg-white p-5 dark:bg-slate-900">
      <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Team Stats
          </div>
          <h2 className="text-xl font-black tracking-tight text-slate-950 dark:text-slate-100">
            Per-Game Rankings
          </h2>
        </div>
        <div className="text-xs font-bold text-slate-500 dark:text-slate-400">
          Based on {rankings.sampleGames} completed games
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
        {rankings.metrics.map((metric) => (
          <div
            key={metric.key}
            className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50 shadow-xs dark:border-slate-700 dark:bg-slate-800/60"
          >
            <div className="border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
              <h3 className="text-sm font-bold tracking-tight text-slate-950 dark:text-slate-100">
                {metric.label}
              </h3>
            </div>
            {metric.entries.length > 0 ? (
              <ol className="divide-y divide-slate-200 dark:divide-slate-700">
                {metric.entries.map((entry, index) => (
                  <React.Fragment key={`${metric.key}-${entry.teamId}`}>
                    {averageInsertIndex(metric) === index ? averageSeparator(metric) : null}
                    <li className="flex items-center gap-3 px-4 py-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-950 text-xs font-semibold text-white dark:bg-white dark:text-slate-950">
                        {entry.rank}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-bold text-slate-950 dark:text-slate-100">
                          {displayName(entry.teamName)}
                        </div>
                        <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                          {entry.games} games
                        </div>
                      </div>
                      <div className="text-lg font-black tabular-nums text-slate-950 dark:text-slate-100">
                        {entry.value === null ? "—" : entry.value.toFixed(1)}
                      </div>
                    </li>
                  </React.Fragment>
                ))}
                {averageInsertIndex(metric) === metric.entries.length
                  ? averageSeparator(metric)
                  : null}
              </ol>
            ) : (
              <div className="px-4 py-6 text-center text-sm font-bold text-slate-500 dark:text-slate-400">
                No teams added yet.
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
