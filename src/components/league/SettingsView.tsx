/**
 * Every knob the league half has: how a season is shaped, how the model reads it, and the ways data
 * comes in and goes out.
 */
import React, { useId } from "react";
import {
  TIEBREAKER_LABELS,
  type ModelAggression,
  type PitchMode,
  type PostseasonFormat,
  type RecapGrouping,
  type ScoreDetail,
  type Settings,
  type TiebreakerFactor,
} from "../../lib/types";
import { button as buttonClasses, card } from "../../styles/tokens";

/** The order the tiebreaker pickers offer, and the "none" they also allow. */
const TIEBREAKER_FACTORS: TiebreakerFactor[] = [
  "headToHead",
  "runDifferential",
  "runsAgainst",
  "runsFor",
];
type TiebreakerSelectValue = TiebreakerFactor | "none";

export function SettingsView({
  settings,
  setSettings,
  teamsCount,
  importCSV,
  importBackup,
  exportCSV,
  exportBackup,
  resetSeason,
  loadDemoSeason,
}: {
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  teamsCount: number;
  importCSV: (file: File) => void;
  importBackup: (file: File) => void;
  exportCSV: () => void;
  exportBackup: () => void;
  resetSeason: () => void;
  loadDemoSeason: () => void;
}) {
  const seasonId = useId();
  const cutoffId = useId();
  const postseasonId = useId();
  const trackErrorsId = useId();
  const winId = useId();
  const tieId = useId();
  const regularSeasonGamesId = useId();
  const scoreDetailId = useId();
  const maxRunDifferentialId = useId();
  const useScoutResultsId = useId();
  const pitchModeId = useId();
  const aggrId = useId();
  const recapId = useId();
  const tiebreakerId = useId();
  const updateTiebreaker = (index: number, value: TiebreakerSelectValue) => {
    setSettings((prev) => {
      const next: Array<TiebreakerFactor | undefined> = [...prev.tiebreakerOrder];
      next[index] = value === "none" ? undefined : value;
      return {
        ...prev,
        tiebreakerOrder: next.filter(
          (factor, factorIndex): factor is TiebreakerFactor =>
            factor !== undefined && next.indexOf(factor) === factorIndex
        ),
      };
    });
  };

  return (
    <section className="grid grid-cols-1 gap-6">
      <div className={`${card} p-6`}>
        <h2 className="text-2xl font-black tracking-tight text-slate-950 dark:text-slate-100">
          Settings
        </h2>
        <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
          <label htmlFor={seasonId} className="block">
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Season</span>
            <input
              id={seasonId}
              value={settings.seasonLabel}
              onChange={(event) =>
                setSettings((prev) => ({ ...prev, seasonLabel: event.target.value }))
              }
              placeholder="Spring 26"
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 font-bold text-slate-950 outline-hidden focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
            />
          </label>
          <label htmlFor={postseasonId} className="block">
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Postseason</span>
            <select
              id={postseasonId}
              value={settings.postseasonFormat}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  postseasonFormat: event.target.value as PostseasonFormat,
                }))
              }
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 font-bold text-slate-950 outline-hidden focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
            >
              <option value="cut">Cut line — top teams make the bracket</option>
              <option value="all">Bracket, no cut — every team qualifies</option>
              <option value="none">No postseason — regular season only</option>
            </select>
            <span className="mt-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">
              {settings.postseasonFormat === "cut"
                ? "Standings show Gold odds, playoff status and the cut line."
                : settings.postseasonFormat === "all"
                  ? "Everyone is seeded into the bracket, so there are no Gold odds or bubble."
                  : "Standings only. No bracket, Gold odds, clinching or magic numbers."}
            </span>
          </label>
          {settings.postseasonFormat === "cut" && (
            <label htmlFor={cutoffId} className="block">
              <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
                Gold Cutoff
              </span>
              <input
                id={cutoffId}
                type="number"
                min={1}
                max={Math.max(1, teamsCount)}
                value={settings.goldCutoff}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    goldCutoff: Number(event.target.value),
                  }))
                }
                className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 font-bold text-slate-950 outline-hidden focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
              />
            </label>
          )}
          <label htmlFor={winId} className="block">
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Win Points</span>
            <input
              id={winId}
              type="number"
              step="0.5"
              min={0}
              value={settings.winPoints}
              onChange={(event) =>
                setSettings((prev) => ({ ...prev, winPoints: Number(event.target.value) }))
              }
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 font-bold text-slate-950 outline-hidden focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
            />
          </label>
          <label htmlFor={tieId} className="block">
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Tie Points</span>
            <input
              id={tieId}
              type="number"
              step="0.5"
              min={0}
              value={settings.tiePoints}
              onChange={(event) =>
                setSettings((prev) => ({ ...prev, tiePoints: Number(event.target.value) }))
              }
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 font-bold text-slate-950 outline-hidden focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
            />
          </label>
          <label htmlFor={regularSeasonGamesId} className="block">
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
              Regular Season Games / Team
            </span>
            <input
              id={regularSeasonGamesId}
              type="number"
              min={0}
              value={settings.regularSeasonGamesPerTeam}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  regularSeasonGamesPerTeam: Number(event.target.value),
                }))
              }
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 font-bold text-slate-950 outline-hidden focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
            />
          </label>

          <label htmlFor={scoreDetailId} className="block">
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
              Score Detail
            </span>
            <select
              id={scoreDetailId}
              value={settings.scoreDetail}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  scoreDetail: event.target.value as ScoreDetail,
                }))
              }
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 font-bold text-slate-950 outline-hidden focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
            >
              <option value="runs">Runs only</option>
              <option value="full">Full box score</option>
            </select>
            <p className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">
              Runs alone drive the standings, records and every projection; the full box score
              (hits, strikeouts, errors, walks) only adds the per-game stat pages.
            </p>
          </label>

          <label htmlFor={useScoutResultsId} className="block">
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
              Team Rankings results
            </span>
            <select
              id={useScoutResultsId}
              value={settings.useScoutResults ? "on" : "off"}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  useScoutResults: event.target.value === "on",
                }))
              }
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 font-bold text-slate-950 outline-hidden focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
            >
              <option value="on">Count toward power ratings</option>
              <option value="off">League games only</option>
            </select>
            <p className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">
              Tournament games logged in Team Rankings, for an age group that includes this season,
              sharpen this league&apos;s <strong>opponent-adjusted power ratings</strong>, the
              matchup analysis built on them, and — through those ratings — the Forecast
              board&apos;s game picks and the simulated season. They help most where the schedule is
              thin: two teams who never played each other become comparable through an opponent they
              both faced elsewhere. Records, standings and strength of schedule are always
              league-only.
            </p>
            <p className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">
              Every forecast leans partly on the opponent-adjusted rating and partly on this
              league&apos;s own per-game runs, hits, walks and errors, weighted by how many games
              the rating rests on. On simulated seasons with known team strengths the rating
              deserved most of the weight: its spread matches real run margins, while the stats
              model&apos;s is about twice as wide. Switching this off leaves the rating in place but
              built from league games alone.
            </p>
          </label>

          <label htmlFor={maxRunDifferentialId} className="block">
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
              Max Run Differential
            </span>
            <select
              id={maxRunDifferentialId}
              value={settings.autoRunDiffCap ? "auto" : String(settings.maxRunDifferential)}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "auto") {
                  setSettings((prev) => ({ ...prev, autoRunDiffCap: true }));
                } else {
                  setSettings((prev) => ({
                    ...prev,
                    autoRunDiffCap: false,
                    maxRunDifferential: Number(value),
                  }));
                }
              }}
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 font-bold text-slate-950 outline-hidden focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
            >
              <option value="auto">Auto (by format)</option>
              {[8, 10].map((runs) => (
                <option key={runs} value={String(runs)}>
                  {runs} runs
                </option>
              ))}
              <option value="0">No cap</option>
            </select>
            <p className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">
              Standings, ratings, and projections cap each game&apos;s run-differential credit at
              this amount. <strong>Auto</strong> uses 8 runs for machine/coach pitch (per-inning run
              limit) and 12 for player pitch (9U+ has no run limit).
            </p>
          </label>

          <label htmlFor={pitchModeId} className="block">
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
              Pitch Format
            </span>
            <select
              id={pitchModeId}
              value={settings.pitchMode}
              onChange={(event) =>
                setSettings((prev) => ({ ...prev, pitchMode: event.target.value as PitchMode }))
              }
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 font-bold text-slate-950 outline-hidden focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
            >
              <option value="machine">Machine Pitch</option>
              <option value="coach">Coach Pitch</option>
              <option value="player">Kid Pitch</option>
            </select>
            <p className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">
              {settings.scoreDetail === "runs"
                ? "The format still sets the automatic run-differential cap and shapes the model, even though runs-only entry is the same box either way."
                : "Machine Pitch and Coach Pitch use R/H/K. Kid Pitch uses R/H/E/BB; BB means walks drawn by that team's hitters."}
            </p>
          </label>

          {/* Errors are a kid-pitch box-score column, so the choice only means
              something where both of those are true. */}
          {settings.scoreDetail === "full" && settings.pitchMode === "player" && (
            <label htmlFor={trackErrorsId} className="block">
              <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
                Score Errors
              </span>
              <select
                id={trackErrorsId}
                value={settings.trackErrors ? "yes" : "no"}
                onChange={(event) =>
                  setSettings((prev) => ({ ...prev, trackErrors: event.target.value === "yes" }))
                }
                className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 font-bold text-slate-950 outline-hidden focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
              >
                <option value="yes">Yes — track fielding errors</option>
                <option value="no">No — do not score errors</option>
              </select>
              <p className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">
                Turn this off if your league does not record errors. The E box disappears from score
                entry and E/G drops out of the stat pages; already-entered errors are kept.
              </p>
            </label>
          )}

          <label htmlFor={aggrId} className="block">
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
              Model Aggression
            </span>
            <select
              id={aggrId}
              value={settings.modelAggression}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  modelAggression: event.target.value as ModelAggression,
                }))
              }
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 font-bold text-slate-950 outline-hidden focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
            >
              <option value="Conservative">Conservative</option>
              <option value="Balanced">Balanced</option>
              <option value="Aggressive">Aggressive</option>
            </select>
          </label>
          <label htmlFor={recapId} className="block">
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
              Recap Grouping
            </span>
            <select
              id={recapId}
              value={settings.recapGrouping}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  recapGrouping: event.target.value as RecapGrouping,
                }))
              }
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 font-bold text-slate-950 outline-hidden focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
            >
              <option value="game">Per Game</option>
              <option value="date">Per Date</option>
              <option value="week">Per Week (ending Sunday)</option>
            </select>
          </label>
          <fieldset
            className="rounded-lg border border-slate-300 p-4 dark:border-slate-600 md:col-span-2"
            aria-labelledby={tiebreakerId}
          >
            <legend
              id={tiebreakerId}
              className="px-1 text-sm font-bold text-slate-700 dark:text-slate-200"
            >
              League Tiebreaker Order
            </legend>
            <p className="mt-3 text-sm font-semibold text-slate-600 dark:text-slate-300">
              Winning percentage is always applied first. Head-to-head is only applied to two-team
              ties.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
              {[0, 1, 2, 3].map((index) => (
                <label key={index} className="block">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Tie-break {index + 1}
                  </span>
                  <select
                    value={settings.tiebreakerOrder[index] ?? "none"}
                    onChange={(event) =>
                      updateTiebreaker(index, event.target.value as TiebreakerSelectValue)
                    }
                    className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 font-bold text-slate-950 outline-hidden focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
                    aria-label={`Tie-break ${index + 1}`}
                  >
                    <option value="none">None</option>
                    {TIEBREAKER_FACTORS.map((factor) => (
                      <option key={factor} value={factor}>
                        {TIEBREAKER_LABELS[factor]}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="mt-4 flex flex-col gap-2 border-t border-slate-200 pt-4 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                Match USSSA pool-play seeding: Win % → Head-to-head → Avg Runs Allowed → Avg Run
                Differential (capped at 8).
              </p>
              <button
                type="button"
                onClick={() =>
                  setSettings((prev) => ({
                    ...prev,
                    tiebreakerOrder: ["headToHead", "runsAgainst", "runDifferential"],
                    maxRunDifferential: 8,
                    autoRunDiffCap: false,
                    runDiffTiebreaker: true,
                  }))
                }
                className="shrink-0 rounded-lg bg-slate-950 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white shadow-xs hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
              >
                Use USSSA preset
              </button>
            </div>
          </fieldset>
        </div>

        <div className="mt-8 rounded-lg border border-slate-200 bg-slate-50 p-5">
          <h3 className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-100">
            Data
          </h3>
          <p className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">
            Backup JSON saves everything in this browser — every season, the Team Rankings pool, and
            your theme and mode. Export CSV covers this season&apos;s schedule plus Team Rankings.
            Import Backup JSON takes either that file or a Team Rankings backup on its own.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <label className="cursor-pointer rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white shadow-xs hover:bg-slate-800">
              Import CSV
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                aria-label="Import schedule CSV"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) importCSV(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            <label className="cursor-pointer rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 shadow-xs hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700">
              Import Backup JSON
              <input
                type="file"
                accept=".json,application/json"
                className="hidden"
                aria-label="Import backup JSON"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) importBackup(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            <button
              onClick={exportCSV}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 shadow-xs hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              Export CSV
            </button>
            <button
              onClick={exportBackup}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 shadow-xs hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              Backup JSON
            </button>
            <button
              onClick={loadDemoSeason}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 shadow-xs hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              Load Demo
            </button>
            <button onClick={resetSeason} className={buttonClasses.danger}>
              Reset Season
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
