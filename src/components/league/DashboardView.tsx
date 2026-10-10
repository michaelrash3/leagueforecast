/**
 * The league's front page: where the season stands, what the model makes of the next games, and
 * what it is still missing to say more.
 */
import type { ComponentProps, ReactNode } from "react";
import { formatGameDate } from "../../lib/date";
import { displayName } from "../../lib/format";
import type { buildPredictionEngine, LeaguePrediction } from "../../lib/predictionEngine";
import type { backtestPredictions } from "../../lib/backtest";
import type { ActiveShareView, Matchup, Team } from "../../lib/types";
import { SEVERITY_LABEL, severityCounts, type Finding } from "../../lib/leagueFindings";
import { DigestPanel } from "./DigestPanel";
import { EmptyPanel } from "./EmptyPanel";
import { PowerRatingsView } from "./PowerRatingsView";
import { button as buttonClasses } from "../../styles/tokens";

function teamNameFor(map: Map<string, Team>, id: string) {
  return map.get(id)?.name ?? id;
}

function PredictionCard({
  prediction,
  teamsById,
  matchups,
}: {
  prediction: LeaguePrediction;
  teamsById: Map<string, Team>;
  matchups: Matchup[];
}) {
  const game = matchups.find((item) => item.id === prediction.gameId);
  const a = teamNameFor(teamsById, prediction.teamAId);
  const b = teamNameFor(teamsById, prediction.teamBId);
  const winner = prediction.predictedWinnerId
    ? teamNameFor(teamsById, prediction.predictedWinnerId)
    : "Pending data";
  const aPct = Math.round(prediction.winProbability.teamA * 100);
  const bPct = Math.round(prediction.winProbability.teamB * 100);
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs ring-1 ring-slate-950/5 dark:border-slate-800 dark:bg-slate-950/70">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
            Upcoming prediction
          </p>
          <h3 className="mt-2 text-xl font-black tracking-tight text-slate-950 dark:text-white">
            {a} vs {b}
          </h3>
          <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
            {game?.date ? formatGameDate(game.date) : "Date TBD"}
          </p>
        </div>
        <span className="rounded-full bg-slate-950 px-3 py-1 text-xs font-semibold uppercase text-white dark:bg-white dark:text-slate-950">
          {prediction.confidence.tier}
        </span>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Projected Winner
          </p>
          <p className="mt-1 text-lg font-black">
            {winner}
            {prediction.projectedMargin !== null ? ` by ${prediction.projectedMargin}` : ""}
          </p>
        </div>
        <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Win Probability
          </p>
          <p className="mt-1 flex flex-col gap-0.5 text-sm font-black">
            <span className="flex justify-between gap-2">
              <span className="min-w-0 font-semibold wrap-break-word">{displayName(a)}</span>
              {aPct}%
            </span>
            <span className="flex justify-between gap-2">
              <span className="min-w-0 font-semibold wrap-break-word">{displayName(b)}</span>
              {bPct}%
            </span>
          </p>
        </div>
        <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Expected Score
          </p>
          <p className="mt-1 text-lg font-black">
            {prediction.expectedScore
              ? `${prediction.expectedScore.teamA}-${prediction.expectedScore.teamB}`
              : "Needs scores"}
          </p>
        </div>
      </div>
      <div className="mt-4 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Model Read
        </p>
        <p className="mt-2 text-sm font-semibold leading-6 text-slate-700 dark:text-slate-300">
          {prediction.keyFactors[0] ?? "Add completed scores to unlock a model read."}
        </p>
      </div>
      {prediction.riskFactors.length > 0 && (
        <p className="mt-3 text-sm font-bold text-amber-700 dark:text-amber-300">
          Risk: {prediction.riskFactors[0]}
        </p>
      )}
    </article>
  );
}

export function DashboardView({
  engine,
  backtestResult,
  teamsById,
  matchups,
  setActiveView,
  findings,
  ourTeam,
  digest,
}: {
  engine: ReturnType<typeof buildPredictionEngine>;
  backtestResult: ReturnType<typeof backtestPredictions>;
  teamsById: Map<string, Team>;
  matchups: Matchup[];
  setActiveView: (view: ActiveShareView) => void;
  /** The season's data-quality findings not put aside, counted here and listed on their own tab. */
  findings: readonly Finding[];
  /** The team this browser follows, which leads the page (`OurTeamCard`). */
  ourTeam?: ReactNode;
  /** What changed since this device last looked (2.6), above everything else while there is any. */
  digest?: ComponentProps<typeof DigestPanel>;
}) {
  const avgConfidence = engine.predictions.length
    ? Math.round(
        engine.predictions.reduce((sum, p) => sum + p.confidence.score, 0) /
          engine.predictions.length
      )
    : 0;
  return (
    <div className="space-y-6">
      {digest && <DigestPanel {...digest} />}
      {ourTeam}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Games forecasted", String(engine.predictions.length)],
          ["Avg confidence", avgConfidence ? `${avgConfidence}%` : "—"],
          ["Top-rated team", engine.powerRatings[0]?.teamName ?? "—"],
          [
            "Prediction accuracy",
            backtestResult.winnerAccuracy == null
              ? "Tracking ready"
              : `${Math.round(backtestResult.winnerAccuracy * 100)}%`,
          ],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {label}
            </p>
            <p className="mt-2 text-2xl font-black">{value}</p>
          </div>
        ))}
      </section>
      <section className="grid gap-6 lg:grid-cols-[1.25fr_.75fr]">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-black">Upcoming Game Predictions</h2>
            <button className={buttonClasses.ghost} onClick={() => setActiveView("games")}>
              Open Schedule
            </button>
          </div>
          {engine.predictions.slice(0, 3).map((p) => (
            <PredictionCard
              key={p.gameId}
              prediction={p}
              teamsById={teamsById}
              matchups={matchups}
            />
          ))}
          {engine.predictions.length === 0 && (
            <EmptyPanel
              title="No predictions yet"
              body="Add completed scores and upcoming games to generate forecasts."
            />
          )}
        </div>
        <DataQualityPanel
          engine={engine}
          findings={findings}
          onOpen={() => setActiveView("quality")}
        />
      </section>
      <PowerRatingsView engine={engine} compact />
    </div>
  );
}

/**
 * The season's data quality, in brief (2.3): the forecast's own grade of how much it has to go
 * on, how many findings there are of each severity, whether any of them makes the forecast less
 * to be trusted, and the way to the Data Quality tab, where each is listed with what to do.
 */
function DataQualityPanel({
  engine,
  findings,
  onOpen,
}: {
  engine: ReturnType<typeof buildPredictionEngine>;
  findings: readonly Finding[];
  onOpen: () => void;
}) {
  const counts = severityCounts(findings);
  const forecastAffected = findings.some(
    (finding) => finding.affectsForecast && finding.severity !== "info"
  );
  return (
    <aside className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Data Quality
      </p>
      <h3 className="mt-2 text-2xl font-black">{engine.dataQuality.tier}</h3>
      {findings.length === 0 ? (
        <p className="mt-3 text-sm font-semibold text-slate-500 dark:text-slate-400">
          Nothing to flag in the season&rsquo;s games, teams or settings.
        </p>
      ) : (
        <ul className="mt-3 space-y-1 text-sm font-semibold text-slate-600 dark:text-slate-300">
          {(["attention", "review", "info"] as const)
            .filter((severity) => counts[severity] > 0)
            .map((severity) => (
              <li key={severity}>
                {counts[severity]} {SEVERITY_LABEL[severity].toLowerCase()}
              </li>
            ))}
        </ul>
      )}
      {forecastAffected && (
        <p className="mt-3 text-sm font-bold text-red-700 dark:text-red-300">
          The forecast is less reliable until these are put right.
        </p>
      )}
      <button type="button" onClick={onOpen} className={`${buttonClasses.ghost} mt-4 w-full`}>
        {findings.length ? "Review data quality" : "Open Data Quality"}
      </button>
    </aside>
  );
}
