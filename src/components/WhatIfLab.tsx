import { useEffect, useId, useMemo, useState } from "react";
import {
  applyScenarioOverlay,
  countForcedGames,
  overlayHash,
  scenarioOdds,
  scenarioOddsInputs,
  type ScenarioOverlay,
} from "../lib/scenario";
import { formatGameDate, parseDateValue } from "../lib/date";
import { displayName } from "../lib/format";
import { simulationSeed, predictGame } from "../lib/sim";
import { SIM_ITERATIONS, type Matchup, type Settings, type Team, type TeamBase } from "../lib/types";

type Props = {
  liveTeams: Team[];
  remainingGames: Matchup[];
  matchups: Matchup[];
  logs: Record<string, import("../lib/types").GameLog>;
  teamBaseById: Map<string, TeamBase>;
  liveById: Map<string, Team>;
  goldCutoff: number;
  settings: Settings;
};

export function WhatIfLab({
  liveTeams,
  remainingGames,
  matchups,
  logs,
  teamBaseById,
  liveById,
  goldCutoff,
  settings,
}: Props) {
  const [overlay, setOverlay] = useState<ScenarioOverlay>({});
  const headingId = useId();

  // Reset overlay choices that no longer correspond to a remaining game
  useEffect(() => {
    setOverlay((prev) => {
      const allowed = new Set(remainingGames.map((g) => g.id));
      const next: ScenarioOverlay = {};
      Object.entries(prev).forEach(([id, choice]) => {
        if (allowed.has(id)) next[id] = choice;
      });
      return next;
    });
  }, [remainingGames]);

  const sortedGames = useMemo(
    () => [...remainingGames].sort((a, b) => parseDateValue(a.date) - parseDateValue(b.date)),
    [remainingGames]
  );

  const projected = useMemo(
    () => applyScenarioOverlay(liveTeams, remainingGames, overlay, settings),
    [liveTeams, remainingGames, overlay, settings]
  );

  const odds = useMemo(() => {
    const seed = simulationSeed(matchups, logs, `whatif-${goldCutoff}-${overlayHash(overlay)}`);
    return scenarioOdds(liveTeams, remainingGames, overlay, SIM_ITERATIONS, seed, goldCutoff, settings);
  }, [liveTeams, remainingGames, overlay, matchups, logs, goldCutoff, settings]);

  const baseline = useMemo(
    () => applyScenarioOverlay(liveTeams, remainingGames, {}, settings),
    [liveTeams, remainingGames, settings]
  );
  const baselineById = useMemo(() => {
    const map = new Map<string, number>();
    baseline.forEach((team) => map.set(team.id, team.rank));
    return map;
  }, [baseline]);

  const baselineOdds = useMemo(() => {
    const seed = simulationSeed(matchups, logs, `whatif-base-${goldCutoff}`);
    return scenarioOdds(liveTeams, remainingGames, {}, SIM_ITERATIONS, seed, goldCutoff, settings);
  }, [liveTeams, remainingGames, matchups, logs, goldCutoff, settings]);

  const forcedCount = countForcedGames(overlay);
  const { stillRemaining } = scenarioOddsInputs(liveTeams, remainingGames, overlay, settings);

  return (
    <section className="space-y-6" aria-labelledby={headingId}>
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h2
              id={headingId}
              className="text-2xl font-black tracking-tight text-slate-950 dark:text-slate-100"
            >
              What-If Lab
            </h2>
            <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
              Flip predicted winners and watch the standings + Gold odds shift in real time.
              Untouched games keep the model&apos;s prediction.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {forcedCount} forced · {stillRemaining.length} sampled
            </span>
            <button
              type="button"
              onClick={() => setOverlay({})}
              disabled={forcedCount === 0}
              className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-black text-slate-700 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200"
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="border-b border-slate-200 px-5 py-3 dark:border-slate-700">
            <h3 className="text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Remaining Games
            </h3>
          </div>
          {sortedGames.length === 0 ? (
            <div className="p-8 text-center text-sm font-bold text-slate-500 dark:text-slate-400">
              No remaining games to play with — the season is complete.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {sortedGames.map((game) => {
                const choice = overlay[game.id] ?? "model";
                const away = teamBaseById.get(game.away);
                const home = teamBaseById.get(game.home);
                const prediction = predictGame(game, liveTeams, settings, liveById);
                const modelWinner = prediction.winnerId;
                const modelPct = Math.round(
                  modelWinner === game.away
                    ? prediction.awayWinPct * 100
                    : (1 - prediction.awayWinPct) * 100
                );
                const setChoice = (next: "away" | "home" | "model") => {
                  setOverlay((prev) => {
                    const copy = { ...prev };
                    if (next === "model") delete copy[game.id];
                    else copy[game.id] = next;
                    return copy;
                  });
                };
                const isAway = choice === "away";
                const isHome = choice === "home";
                const isModel = choice === "model";
                return (
                  <li key={game.id} className="grid grid-cols-[80px_1fr_auto] items-center gap-3 px-4 py-3">
                    <span className="text-[11px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {formatGameDate(game.date)}
                    </span>
                    <div>
                      <div className="text-sm font-black text-slate-950 dark:text-slate-100">
                        {displayName(away?.name || game.away)} at {displayName(home?.name || game.home)}
                      </div>
                      <div className="mt-0.5 text-[11px] font-bold text-slate-500 dark:text-slate-400">
                        Model: {displayName(
                          teamBaseById.get(modelWinner)?.name || modelWinner
                        )}{" "}
                        ({modelPct}%)
                      </div>
                    </div>
                    <div
                      role="radiogroup"
                      aria-label={`Forced winner for ${displayName(away?.name || game.away)} vs ${displayName(home?.name || game.home)}`}
                      className="flex gap-1 rounded-xl bg-slate-100 p-1 text-[11px] font-black dark:bg-slate-800"
                    >
                      <button
                        type="button"
                        role="radio"
                        aria-checked={isAway}
                        onClick={() => setChoice("away")}
                        className={`rounded-lg px-2 py-1 ${
                          isAway
                            ? "bg-emerald-600 text-white"
                            : "text-slate-600 hover:text-slate-950 dark:text-slate-300"
                        }`}
                      >
                        {displayName(away?.name || game.away).slice(0, 8)}
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={isModel}
                        onClick={() => setChoice("model")}
                        className={`rounded-lg px-2 py-1 ${
                          isModel
                            ? "bg-slate-950 text-white dark:bg-white dark:text-slate-950"
                            : "text-slate-600 hover:text-slate-950 dark:text-slate-300"
                        }`}
                        title="Use the model's prediction (sampled in Monte Carlo)"
                      >
                        Model
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={isHome}
                        onClick={() => setChoice("home")}
                        className={`rounded-lg px-2 py-1 ${
                          isHome
                            ? "bg-emerald-600 text-white"
                            : "text-slate-600 hover:text-slate-950 dark:text-slate-300"
                        }`}
                      >
                        {displayName(home?.name || game.home).slice(0, 8)}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-700">
            <h3 className="text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Scenario Standings
            </h3>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              Top {goldCutoff}
            </span>
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {projected.map((team, index) => {
              const baselineRank = baselineById.get(team.id) ?? team.rank;
              const movement = baselineRank - team.rank; // positive = improved vs current model
              const baseOdds = baselineOdds[team.id] ?? 0;
              const scenarioPct = odds[team.id] ?? 0;
              const deltaOdds = Math.round(scenarioPct - baseOdds);
              const inside = team.rank <= goldCutoff;
              return (
                <li
                  key={team.id}
                  className={`grid grid-cols-[40px_1fr_auto_auto] items-center gap-3 px-4 py-2 ${
                    index === goldCutoff - 1 ? "border-b-2 border-red-300 dark:border-red-600" : ""
                  }`}
                >
                  <span
                    className={`text-sm font-black ${
                      inside ? "text-slate-950 dark:text-slate-100" : "text-slate-500 dark:text-slate-400"
                    }`}
                  >
                    #{team.rank}
                  </span>
                  <span className="truncate text-sm font-bold text-slate-700 dark:text-slate-200">
                    {displayName(team.name)}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
                      movement > 0
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"
                        : movement < 0
                          ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
                          : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                    }`}
                    aria-label={
                      movement === 0
                        ? "No change vs baseline"
                        : `${movement > 0 ? "Up" : "Down"} ${Math.abs(movement)} vs baseline`
                    }
                  >
                    {movement > 0 ? `▲${movement}` : movement < 0 ? `▼${Math.abs(movement)}` : "—"}
                  </span>
                  <span className="w-20 text-right text-xs font-black text-slate-700 dark:text-slate-200">
                    {Math.round(scenarioPct)}%
                    <span
                      className={`ml-1 text-[10px] ${
                        deltaOdds > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : deltaOdds < 0
                            ? "text-red-600 dark:text-red-400"
                            : "text-slate-400"
                      }`}
                    >
                      {deltaOdds > 0 ? `+${deltaOdds}` : deltaOdds < 0 ? deltaOdds : ""}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-slate-200 px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:border-slate-700 dark:text-slate-500">
            ▲ / ▼ show movement vs default model · % delta vs default Gold odds
          </div>
        </div>
      </div>
    </section>
  );
}
