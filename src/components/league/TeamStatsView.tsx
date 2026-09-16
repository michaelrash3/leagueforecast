/**
 * The team-stats page: how the league averages read, the per-metric leaderboards, and the
 * head-to-head grid.
 *
 * The matrix is fetched only when this tab is opened — it is a whole chart component that most
 * visits never reach.
 */
import { lazy, Suspense } from "react";
import type { H2HCell } from "../charts/HeadToHeadMatrix";
import { LoadingPanel } from "../LoadingPanel";
import { StatRankingsPanel } from "./StatRankingsPanel";
import { perGame, type LeagueAverageStats, type StatRankings } from "../../lib/teamStats";
import type { PitchMode } from "../../lib/types";
import { card } from "../../styles/tokens";

const HeadToHeadMatrix = lazy(() =>
  import("../charts/HeadToHeadMatrix").then((module) => ({
    default: module.HeadToHeadMatrix,
  }))
);

export function TeamStatsView({
  leagueAverageStats,
  statRankings,
  pitchMode,
  trackErrors,
  runsOnly,
  matrixTeams,
  headToHeadCell,
}: {
  leagueAverageStats: LeagueAverageStats;
  statRankings: StatRankings;
  pitchMode: PitchMode;
  trackErrors: boolean;
  runsOnly: boolean;
  matrixTeams: { id: string; name: string }[];
  headToHeadCell: (rowId: string, colId: string) => H2HCell;
}) {
  return (
    <div className="grid grid-cols-1 gap-6">
      <section>
        <h2 className="text-2xl font-black tracking-tight text-slate-950 dark:text-slate-100">
          League Stats
        </h2>
        <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
          {runsOnly
            ? "Compare league-wide scoring, for and against."
            : "Compare league-wide scoring, hitting, pitching, and fielding rates."}
        </p>
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xs dark:border-slate-700 dark:bg-slate-900">
        <div className="grid grid-cols-2 gap-3 border-b border-slate-200 bg-slate-50 p-4 md:grid-cols-4 dark:border-slate-700 dark:bg-slate-800/40">
          <div className="rounded-lg bg-linear-to-br from-blue-500/12 via-white to-white p-4 shadow-xs ring-1 ring-blue-100 dark:from-blue-500/18 dark:via-slate-900 dark:to-slate-900 dark:ring-blue-900/50">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              League Avg Sample
            </div>
            <div className="mt-1 text-xl font-black text-slate-950 dark:text-slate-100">
              {leagueAverageStats.completedGames}
            </div>
            <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
              games played
            </div>
          </div>
          <div className="rounded-lg bg-linear-to-br from-emerald-500/12 via-white to-white p-4 shadow-xs ring-1 ring-emerald-100 dark:from-emerald-500/18 dark:via-slate-900 dark:to-slate-900 dark:ring-emerald-900/50">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              League Avg R/G
            </div>
            <div className="mt-1 text-xl font-black text-slate-950 dark:text-slate-100">
              {perGame(leagueAverageStats.runs, leagueAverageStats.teamGames)}
            </div>
          </div>
          {/* Hits, walks and errors are only ever entered under the full box score. */}
          {!runsOnly && (
            <div className="rounded-lg bg-linear-to-br from-amber-500/14 via-white to-white p-4 shadow-xs ring-1 ring-amber-100 dark:from-amber-500/18 dark:via-slate-900 dark:to-slate-900 dark:ring-amber-900/50">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                League Avg H/G
              </div>
              <div className="mt-1 text-xl font-black text-slate-950 dark:text-slate-100">
                {perGame(leagueAverageStats.hits, leagueAverageStats.teamGames)}
              </div>
            </div>
          )}
          {!runsOnly && pitchMode === "player" && (
            <div className="rounded-lg bg-linear-to-br from-violet-500/12 via-white to-white p-4 shadow-xs ring-1 ring-violet-100 dark:from-violet-500/18 dark:via-slate-900 dark:to-slate-900 dark:ring-violet-900/50">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                League Avg BB/G
              </div>
              <div className="mt-1 text-xl font-black text-slate-950 dark:text-slate-100">
                {perGame(leagueAverageStats.walks, leagueAverageStats.teamGames)}
              </div>
            </div>
          )}
          {!runsOnly && (pitchMode !== "player" || trackErrors) && (
            <div className="rounded-lg bg-linear-to-br from-red-500/12 via-white to-white p-4 shadow-xs ring-1 ring-red-100 dark:from-red-500/18 dark:via-slate-900 dark:to-slate-900 dark:ring-red-900/50">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {pitchMode === "player" ? "League Avg E/G" : "League Avg K/G"}
              </div>
              <div className="mt-1 text-xl font-black text-slate-950 dark:text-slate-100">
                {pitchMode === "player"
                  ? perGame(leagueAverageStats.errors, leagueAverageStats.teamGames)
                  : perGame(leagueAverageStats.strikeouts, leagueAverageStats.teamGames)}
              </div>
            </div>
          )}
        </div>

        <StatRankingsPanel rankings={statRankings} />
      </section>

      {matrixTeams.length >= 2 && (
        <section className={`${card} p-5`} aria-label="Head-to-head matrix">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-100">
                Head-to-Head Matrix
              </h3>
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                Each row shows how that team has fared against every opponent this season.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-wide">
              <span className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
                <span className="h-3 w-3 rounded-xs bg-emerald-500" /> Won series
              </span>
              <span className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
                <span className="h-3 w-3 rounded-xs bg-red-500" /> Lost series
              </span>
              <span className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
                <span className="h-3 w-3 rounded-xs bg-amber-400" /> Split
              </span>
              <span className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
                <span className="h-3 w-3 rounded-xs bg-slate-100 dark:bg-slate-800" /> Not played
              </span>
            </div>
          </div>
          <Suspense fallback={<LoadingPanel area="the matrix" />}>
            <HeadToHeadMatrix teams={matrixTeams} cellFor={headToHeadCell} />
          </Suspense>
        </section>
      )}
    </div>
  );
}
