/**
 * The model's own view: how the forecast is doing, what it thinks of the games still to play, the
 * bracket, and the season's shape.
 *
 * Seven hundred lines that read nothing but their own props. Kept in App.tsx they sat between the
 * state that everything else reads and the handlers that write it, which is how the file got to
 * eight and a half thousand lines and why a bug in the plumbing was so easy to miss.
 */
import { lazy, Suspense } from "react";
import { backtestPredictions } from "../../lib/backtest";
import { buildBracketProjection } from "../../lib/bracket";
import { goldCutLineSnapshot, type ClinchingPathNote } from "../../lib/clinchingPaths";
import { formatGameDate } from "../../lib/date";
import { displayName } from "../../lib/format";
import type { LeagueSummaryErrorReason } from "../../lib/leagueSummary";
import { projectionConfidenceForTeam } from "../../lib/projectionConfidence";
import type { SeasonTimelineEntry } from "../../lib/seasonTimeline";
import type { BracketOddsResult } from "../../lib/sim";
import type {
  GameLog,
  Matchup,
  Prediction,
  Settings,
  SwingGame,
  Team,
  TeamBase,
  TeamWithProjection,
} from "../../lib/types";
import { buildTeamDataHref, projectedRunLine, upsetRiskLabel } from "../../lib/teamLink";
import { AiStoryPanel } from "../AiStoryPanel";
import { BracketPredictionPanel } from "../bracket/BracketPanel";
import { ClinchingPathsPanel } from "../ClinchingPathsPanel";
import { LoadingPanel } from "../LoadingPanel";
import { ModelHealthPanel } from "../ModelHealthPanel";
import { SeasonTimelinePanel } from "../SeasonTimelinePanel";
import { SeedOddsPanel } from "../SeedOddsPanel";
import { card, pill } from "../../styles/tokens";

/** Charts belong to this view alone, and most visits never reach it. */
const GoldOddsTrendChart = lazy(() =>
  import("../charts/GoldOddsTrendChart").then((module) => ({
    default: module.GoldOddsTrendChart,
  }))
);

export function ModelView(props: {
  goldCutoff: number;
  modelRows: TeamWithProjection[];
  bracketProjection: ReturnType<typeof buildBracketProjection>;
  silverBracketProjection: ReturnType<typeof buildBracketProjection>;
  updateBracketLog: (gameId: string, field: keyof GameLog, value: string | boolean) => void;
  toggleBracketFinal: (gameId: string) => void;
  clearBracketScores: (gameIds: string[], label: string) => void;
  seedRangeForTeam: (id: string) => { best: number; worst: number; baseline: number };
  gamesThatMatterMost: {
    game: Matchup;
    rank: number;
    label: string;
    reason: string;
    date: string;
  }[];
  bubbleMovementRows: {
    team: TeamWithProjection;
    tier: string;
    sos: { label: string; opponents: string };
    control: string;
  }[];
  scheduleDifficultyForTeam: (id: string) => { label: string; rating: number; opponents: string };
  formatGoldPct: (t: TeamWithProjection) => string;
  formatGoldMargin: (t: TeamWithProjection) => string;
  projectedCutLineTeams: TeamWithProjection[];
  nextTwoSwingGames: (id: string) => SwingGame[];
  gameForecasts: {
    game: Matchup;
    prediction: Prediction;
    awayName: string;
    homeName: string;
    winnerName: string;
    winnerPct: number;
    impact: ReturnType<Map<string, { impactLabel: "High" | "Medium" | "Low" }>["get"]>;
    sourceLabel: string;
  }[];
  byId: Map<string, Team>;
  gameStatusClasses: (s: string) => string;
  teams: TeamBase[];
  matchups: Matchup[];
  logs: Record<string, GameLog>;
  settings: Settings;
  cutoff: number;
  onSelectTeam: (id: string) => void;
  liveTeams: Team[];
  remainingGames: Matchup[];
  backtestResult: ReturnType<typeof backtestPredictions>;
  bracketOdds: BracketOddsResult;
  clinchingPaths: ClinchingPathNote[];
  cutLineSnapshot: ReturnType<typeof goldCutLineSnapshot>;
  timelineEntries: SeasonTimelineEntry[];
  /** False when the league has no cut line: no Gold odds, no bubble, no clinching. */
  hasCutLine: boolean;
  /** False when the league plays no bracket at all. */
  hasPostseason: boolean;
  /** Gemini write-up of the projection; empty when the AI story is unavailable. */
  forecastStoryText: string;
  forecastStoryModel: string;
  forecastStoryLoading: boolean;
  forecastStoryUnavailableReason: LeagueSummaryErrorReason | null;
  forecastStoryErrorMessage: string;
  retryForecastStory: () => void;
  forecastStoryWaiting: boolean;
  askForecastStory: () => void;
}) {
  const {
    goldCutoff,
    modelRows,
    bracketProjection,
    silverBracketProjection,
    updateBracketLog,
    toggleBracketFinal,
    clearBracketScores,
    seedRangeForTeam,
    gamesThatMatterMost,
    bubbleMovementRows,
    scheduleDifficultyForTeam,
    formatGoldPct,
    formatGoldMargin,
    projectedCutLineTeams,
    nextTwoSwingGames,
    gameForecasts,
    byId,
    gameStatusClasses,
    teams: _teams,
    matchups: _matchups,
    logs: _logs,
    settings: _settings,
    cutoff: _cutoff,
    onSelectTeam,
    liveTeams: _liveTeams,
    remainingGames: _remainingGames,
    backtestResult,
    bracketOdds,
    clinchingPaths,
    cutLineSnapshot,
    timelineEntries,
    hasCutLine,
    hasPostseason,
    forecastStoryWaiting,
    askForecastStory,
    forecastStoryText,
    forecastStoryModel,
    forecastStoryLoading,
    forecastStoryUnavailableReason,
    forecastStoryErrorMessage,
    retryForecastStory,
  } = props;

  // While loading, the panel header carries the status label on its own, so
  // there is no body text to repeat it.
  const forecastPanelText =
    forecastStoryText ||
    (forecastStoryLoading
      ? ""
      : forecastStoryUnavailableReason
        ? "The written forecast is unavailable. The projected table and game picks below are unaffected."
        : "");

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-2xl font-black tracking-tight text-slate-950 dark:text-slate-100">
          Forecast
        </h2>
        <div className="mt-3">
          <AiStoryPanel
            title="Forecast Write-up"
            text={forecastPanelText}
            source={forecastStoryText ? "gemini" : "local"}
            model={forecastStoryModel}
            loading={forecastStoryLoading}
            loadingLabel="Reading the projection…"
            unavailableReason={forecastStoryUnavailableReason}
            errorMessage={forecastStoryErrorMessage}
            onRetry={retryForecastStory}
            waiting={forecastStoryWaiting}
            onAsk={askForecastStory}
          />
        </div>
      </div>

      {hasCutLine && (
        <ClinchingPathsPanel
          paths={clinchingPaths}
          lastInName={cutLineSnapshot.lastInName}
          firstOutName={cutLineSnapshot.firstOutName}
          pointsGap={cutLineSnapshot.pointsGap}
          onSelectTeam={onSelectTeam}
        />
      )}

      {hasCutLine && modelRows.some((team) => team.goldTrend.length >= 2) && (
        <section className={`${card} p-5`} aria-label="Gold odds trend">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-100">
                Gold Odds Over Recent Games
              </h3>
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                Simulated Gold Bracket odds for the top teams after each of the latest results.
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              Top 5
            </span>
          </div>
          <Suspense fallback={<LoadingPanel area="the chart" />}>
            <GoldOddsTrendChart rows={modelRows} />
          </Suspense>
        </section>
      )}

      <section className={`${card} p-5`} aria-label="Schedule difficulty heatmap">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-100">
              Schedule Difficulty Heatmap
            </h3>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            Remaining slate
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {modelRows.map((team) => {
            const sos = scheduleDifficultyForTeam(team.id);
            const toneClass =
              sos.label === "Hard"
                ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-200"
                : sos.label === "Medium"
                  ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200"
                  : sos.label === "Complete"
                    ? "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                    : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-200";
            return (
              <button
                type="button"
                key={`sos-heat-${team.id}`}
                onClick={() => onSelectTeam(team.id)}
                className={`rounded-lg border p-4 text-left shadow-xs transition hover:-translate-y-0.5 hover:shadow-md ${toneClass}`}
                aria-label={`${displayName(team.name)} remaining schedule difficulty: ${sos.label}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-black">{displayName(team.name)}</span>
                  <span className="rounded-full bg-white/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-current dark:bg-black/20">
                    {sos.label}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 text-xs font-bold opacity-80">{sos.opponents}</p>
              </button>
            );
          })}
        </div>
      </section>

      {hasPostseason && (
        <BracketPredictionPanel
          title={hasCutLine ? "Gold Bracket Predictor" : "Bracket Predictor"}
          emptyMessage="Not enough teams for a bracket."
          championLabel="Projected Champion"
          projection={bracketProjection}
          onScoreChange={updateBracketLog}
          onToggleFinal={toggleBracketFinal}
          onClearScores={clearBracketScores}
        />
      )}

      {hasCutLine && (
        <BracketPredictionPanel
          title="Silver Bracket Predictor"
          emptyMessage="Not enough Silver teams."
          championLabel="Projected Silver Champion"
          projection={silverBracketProjection}
          onScoreChange={updateBracketLog}
          onToggleFinal={toggleBracketFinal}
          onClearScores={clearBracketScores}
        />
      )}

      {hasCutLine && (
        <SeedOddsPanel
          teams={modelRows.map((team) => ({ id: team.id, name: team.name }))}
          bracketOdds={bracketOdds}
          cutoff={goldCutoff}
          cardClassName={card}
        />
      )}

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xs dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <h3 className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-100">
            Projected Standings
          </h3>
        </div>
        {modelRows.length === 0 ? (
          <div className="p-8 text-center text-sm font-bold text-slate-500 dark:text-slate-400">
            No teams yet.
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left">
                <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                  <tr>
                    <th className="px-5 py-3">Team</th>
                    <th className="px-4 py-3 text-center">Current Seed</th>
                    <th className="px-4 py-3 text-center">Projected Seed</th>
                    <th className="px-4 py-3 text-center">Range</th>
                    <th className="px-4 py-3 text-center">Projected Record</th>
                    {hasCutLine && <th className="px-4 py-3 text-center">Gold Odds</th>}
                    <th className="px-4 py-3 text-center">Run Diff</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {modelRows.map((team) => {
                    const movement = (team.rank ?? 99) - team.projectedRank;
                    const range = seedRangeForTeam(team.id);
                    const confidence = projectionConfidenceForTeam(team);
                    const confidenceClass =
                      confidence.tone === "emerald"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                        : confidence.tone === "amber"
                          ? "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                          : "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300";
                    return (
                      <tr
                        key={`forecast-${team.id}`}
                        className="text-slate-800 hover:bg-slate-50/70 dark:text-slate-100 dark:hover:bg-slate-800/70"
                      >
                        <td className="px-5 py-4 font-black">
                          <a
                            href={buildTeamDataHref(team.id)}
                            onClick={(event) => {
                              event.preventDefault();
                              onSelectTeam(team.id);
                            }}
                            className="rounded-lg text-left text-blue-700 underline decoration-blue-300 underline-offset-4 hover:text-blue-500 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-white dark:text-blue-300 dark:decoration-blue-700 dark:hover:text-blue-200 dark:focus:ring-offset-slate-900"
                            aria-label={`View stats for ${displayName(team.name)}`}
                          >
                            {displayName(team.name)}
                          </a>
                        </td>
                        <td className="px-4 py-4 text-center font-black">#{team.rank}</td>
                        <td className="px-4 py-4 text-center font-black">
                          #{team.projectedRank}
                          <span
                            className={`ml-2 rounded-full px-2 py-1 text-[10px] font-black ${
                              movement > 0
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                                : movement < 0
                                  ? "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300"
                                  : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                            }`}
                          >
                            {movement > 0
                              ? `+${movement}`
                              : movement < 0
                                ? `-${Math.abs(movement)}`
                                : "0"}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-center font-black">
                          #{range.best}–#{range.worst}
                        </td>
                        <td className="px-4 py-4 text-center font-black">{team.projectedRecord}</td>
                        {hasCutLine && (
                          <td className="px-4 py-4 text-center font-black">
                            <div>{formatGoldPct(team)}</div>
                            <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
                              {formatGoldMargin(team)}
                            </div>
                            <span
                              className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-black ${confidenceClass}`}
                              title={confidence.detail}
                            >
                              {confidence.label}
                            </span>
                          </td>
                        )}
                        <td
                          className={`px-4 py-4 text-center font-black ${
                            team.projectedRunDiff > 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : team.projectedRunDiff < 0
                                ? "text-red-600 dark:text-red-400"
                                : "text-slate-500 dark:text-slate-400"
                          }`}
                        >
                          {team.projectedRunDiff > 0 ? "+" : ""}
                          {team.projectedRunDiff}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="hidden px-5 pb-4 text-[11px] font-bold text-slate-500 md:block dark:text-slate-400"></div>

            {/* Mobile cards */}
            <ul className="divide-y divide-slate-100 md:hidden dark:divide-slate-800">
              {modelRows.map((team) => {
                const movement = (team.rank ?? 99) - team.projectedRank;
                const range = seedRangeForTeam(team.id);
                const confidence = projectionConfidenceForTeam(team);
                return (
                  <li
                    key={`forecast-mobile-${team.id}`}
                    className="grid grid-cols-[40px_1fr_auto] items-center gap-3 px-4 py-3"
                  >
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                      #{team.rank}
                    </span>
                    <div className="min-w-0">
                      <a
                        href={buildTeamDataHref(team.id)}
                        onClick={(event) => {
                          event.preventDefault();
                          onSelectTeam(team.id);
                        }}
                        className="block truncate rounded-lg text-left text-sm font-bold text-blue-700 underline decoration-blue-300 underline-offset-4 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-white dark:text-blue-300 dark:decoration-blue-700 dark:focus:ring-offset-slate-900"
                        aria-label={`View stats for ${displayName(team.name)}`}
                      >
                        {displayName(team.name)}
                      </a>
                      <div className="mt-0.5 text-[11px] font-bold text-slate-500 dark:text-slate-400">
                        Proj #{team.projectedRank}{" "}
                        <span
                          className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-black ${
                            movement > 0
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                              : movement < 0
                                ? "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300"
                                : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                          }`}
                        >
                          {movement > 0
                            ? `+${movement}`
                            : movement < 0
                              ? `-${Math.abs(movement)}`
                              : "0"}
                        </span>{" "}
                        · #{range.best}–#{range.worst} · {team.projectedRecord}
                      </div>
                      <div className="mt-0.5 text-[11px] font-bold text-slate-500 dark:text-slate-400">
                        Diff{" "}
                        <span
                          className={
                            team.projectedRunDiff > 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : team.projectedRunDiff < 0
                                ? "text-red-600 dark:text-red-400"
                                : ""
                          }
                        >
                          {team.projectedRunDiff > 0 ? "+" : ""}
                          {team.projectedRunDiff}
                        </span>
                      </div>
                    </div>
                    <span className="text-right text-sm font-bold text-slate-950 dark:text-slate-100">
                      {formatGoldPct(team)}
                      <span className="block text-[10px] font-bold text-slate-500 dark:text-slate-400">
                        {formatGoldMargin(team)}
                      </span>
                      <span className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                        {confidence.label}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      <section className={`${card} p-5 dark:border-slate-700 dark:bg-slate-900`}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-100">
            Games That Matter Most
          </h3>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            Next up
          </span>
        </div>
        {gamesThatMatterMost.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-800/40 p-6 text-center text-sm font-bold text-slate-500 dark:text-slate-400">
            No remaining games.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {gamesThatMatterMost.map((item) => (
              <div
                key={`matter-${item.game.id}`}
                className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      #{item.rank} · {item.date}
                    </div>
                    <div className="mt-1 font-black text-slate-950 dark:text-slate-100">
                      {item.label}
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-black ${gameStatusClasses(item.reason)}`}
                  >
                    {item.reason}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {hasCutLine && bubbleMovementRows.length > 0 && (
        <section className={`${card} p-5`}>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-100">
              Bubble Watch
            </h3>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              Around Top {goldCutoff}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {bubbleMovementRows.map(({ team, tier, sos }) => {
              const range = seedRangeForTeam(team.id);
              const confidence = projectionConfidenceForTeam(team);
              return (
                <div
                  key={`bubble-${team.id}`}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-black text-slate-950 dark:text-slate-100">
                        {displayName(team.name)}
                      </div>
                      <div className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">
                        Now #{team.rank} · Projected #{team.projectedRank} · Range #{range.best}–#
                        {range.worst}
                      </div>
                    </div>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-xs ring-1 ring-slate-200">
                      {tier}
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs font-semibold">
                    <div className="rounded-lg bg-white p-3 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
                      <div className="text-slate-500 dark:text-slate-400">Gold</div>
                      <div className="mt-1 text-slate-950 dark:text-slate-100">
                        {formatGoldPct(team)}
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400">
                        {formatGoldMargin(team)} · {confidence.label}
                      </div>
                    </div>
                    <div className="rounded-lg bg-white p-3 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
                      <div className="text-slate-500 dark:text-slate-400">SOS</div>
                      <div className="mt-1 text-slate-950 dark:text-slate-100">{sos.label}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {hasCutLine && projectedCutLineTeams.length > 0 && (
        <section className={`${card} p-5`}>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-100">
              Projected Cut Line Games
            </h3>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              Next Two
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {projectedCutLineTeams.slice(0, 6).map((team) => {
              const swings = nextTwoSwingGames(team.id);
              if (!swings.length) return null;
              return (
                <div
                  key={`model-swing-${team.id}`}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800"
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="font-black text-slate-950 dark:text-slate-100">
                      {displayName(team.name)}
                    </div>
                    <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                      #{team.rank} now · #{team.projectedRank} projected
                    </div>
                  </div>
                  <div className="space-y-2">
                    {swings.map((swing) => (
                      <div
                        key={swing.game.id}
                        className="rounded-lg bg-white p-3 text-sm shadow-xs ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-black text-slate-950 dark:text-slate-100">
                            {swing.teamIsAway ? "at" : "vs"} {swing.opponentName}
                          </span>
                          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                            {formatGameDate(swing.game.date)}
                          </span>
                        </div>
                        <div className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">
                          Model: {swing.modelPick} · {Math.round(swing.winPct * 100)}% team win
                          chance
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs font-bold">
                          <div className="rounded-lg bg-emerald-50 px-2 py-2 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                            Win: #{swing.winSeed}
                          </div>
                          <div className="rounded-lg bg-red-50 px-2 py-2 text-red-700 dark:bg-red-950/40 dark:text-red-300">
                            Loss: #{swing.lossSeed}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className={`${card} p-5`}>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-100">
            Game Projections
          </h3>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {gameForecasts.length} Projections
          </span>
        </div>
        {gameForecasts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-800/40 p-8 text-center font-bold text-slate-500">
            No remaining games to project.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {gameForecasts.map((item) => {
              const margin = Math.abs(item.prediction.awayScore - item.prediction.homeScore);
              const runLine = projectedRunLine(item.prediction, byId);
              const upsetRisk = upsetRiskLabel(item.winnerPct, margin);
              return (
                <article
                  key={`game-forecast-${item.game.id}`}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-4 shadow-xs dark:border-slate-700 dark:bg-slate-800"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        {item.game.date
                          ? `${item.sourceLabel} · ${formatGameDate(item.game.date)}`
                          : item.sourceLabel}
                      </div>
                      <div className="mt-1 text-base font-black tracking-tight text-slate-950 dark:text-slate-100">
                        {item.awayName} at {item.homeName}
                      </div>
                    </div>
                    <div className="rounded-lg bg-white px-3 py-2 text-right shadow-xs ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Pick
                      </div>
                      <div className="text-sm font-bold text-slate-950 dark:text-slate-100">
                        {item.winnerName}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs font-semibold">
                    <div className="rounded-lg bg-white p-3 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
                      <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Spread
                      </div>
                      <div className="mt-1 text-base text-slate-950 dark:text-slate-100">
                        {runLine}
                      </div>
                    </div>
                    <div className="rounded-lg bg-white p-3 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
                      <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Chance
                      </div>
                      <div className="mt-1 text-base text-slate-950 dark:text-slate-100">
                        {Math.round(item.winnerPct * 100)}%
                      </div>
                    </div>
                    <div className="rounded-lg bg-white p-3 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
                      <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Upset Risk
                      </div>
                      <div className="mt-1 text-base text-slate-950 dark:text-slate-100">
                        {upsetRisk}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <span
                      className={
                        item.prediction.confidence === "High"
                          ? pill("emerald")
                          : item.prediction.confidence === "Medium"
                            ? pill("blue")
                            : pill("neutral")
                      }
                    >
                      {item.prediction.confidence} Confidence
                    </span>
                    {margin <= 2 && <span className={pill("amber")}>Toss-Up</span>}
                    <span
                      className={
                        item.impact?.impactLabel === "High"
                          ? pill("red")
                          : item.impact?.impactLabel === "Medium"
                            ? pill("blue")
                            : pill("neutral")
                      }
                    >
                      Seed Impact: {item.impact?.impactLabel ?? "—"}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
      <SeasonTimelinePanel entries={timelineEntries} />

      <ModelHealthPanel backtestResult={backtestResult} cardClassName={card} />
    </section>
  );
}
