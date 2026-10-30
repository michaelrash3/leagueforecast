/**
 * The league's front page: where the season stands, what the model makes of the next games, and
 * what it is still missing to say more.
 */
import { Suspense, useId, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import {
  byStart,
  dayAndTime,
  formatGameDate,
  parseDateValue,
  seasonStartMonth,
} from "../../lib/date";
import { displayName } from "../../lib/format";
import type { SeasonFinal } from "../../lib/seasonFinal";
import { confidenceTier, SMALL_SAMPLE_RISK } from "../../lib/confidenceTier";
import type { buildPredictionEngine, LeaguePrediction } from "../../lib/predictionEngine";
import type { backtestPredictions } from "../../lib/backtest";
import type { ActiveShareView, Matchup, Team } from "../../lib/types";
import { SEVERITY_LABEL, severityCounts, type Finding } from "../../lib/leagueFindings";
import { useNarrowViewport } from "../../hooks/useWideViewport";
import { ErrorBoundary } from "../ErrorBoundary";
import { DigestPanel } from "./DigestPanel";
import type { LookInput } from "./SinceLastLook";
import { EmptyPanel } from "./EmptyPanel";
import { viewChunk } from "./leagueViews";
import { PowerRatingsView } from "./PowerRatingsView";
import { button as buttonClasses, textRole } from "../../styles/tokens";
import { marginSpanText, runSpanText } from "../../lib/forecastRangeText";

/** Why a card's odds are what they are (2.8), fetched the first time a card's is opened. */
const forecastWhy = viewChunk(
  () => import("./ForecastWhy").then((module) => module.ForecastWhy),
  "ForecastWhy"
);
const ForecastWhy = forecastWhy.View;

/** The "Since you last looked" card, fetched as the Dashboard opens, beside it. */
const sinceLastLook = viewChunk(
  () => import("./SinceLastLook").then((module) => module.SinceLastLook),
  "SinceLastLook"
);
const SinceLastLook = sinceLastLook.View;

/** What a card's explanation reads beside the prediction itself, worked out once it is opened. */
type WhyContext = {
  nameOf: (id: string) => string;
  /** The per-game model's chance that the away side wins a game: the Schedule's odds. */
  gameOdds?: (game: Matchup) => number;
  findings: readonly Finding[];
  record: { winnerAccuracy: number | null; sampleSize: number };
  /** Whether the league has a cut line, and so a Gold % to explain. */
  hasCutLine: boolean;
};

function teamNameFor(map: Map<string, Team>, id: string) {
  return map.get(id)?.name ?? id;
}

/** An upcoming game on a phone, in one line: who plays, when, and the pick, pressed to open. */
function PredictionLine({
  prediction,
  teamsById,
  matchups,
  onOpen,
}: {
  prediction: LeaguePrediction;
  teamsById: Map<string, Team>;
  matchups: Matchup[];
  onOpen: () => void;
}) {
  const game = matchups.find((item) => item.id === prediction.gameId);
  const a = displayName(teamNameFor(teamsById, prediction.teamAId));
  const b = displayName(teamNameFor(teamsById, prediction.teamBId));
  const aPct = Math.round(prediction.winProbability.teamA * 100);
  const bPct = Math.round(prediction.winProbability.teamB * 100);
  const pick =
    aPct === bPct ? "Toss-up" : `Pick: ${aPct > bPct ? a : b} · ${Math.max(aPct, bPct)}%`;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-expanded={false}
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-left shadow-xs dark:border-slate-800 dark:bg-slate-900"
    >
      <span className="min-w-0">
        <span className="block text-sm font-black wrap-break-word">
          {a} vs {b}
        </span>
        <span className="block text-xs font-semibold text-slate-500 dark:text-slate-400">
          {game?.date ? dayAndTime(formatGameDate(game.date), game.startTs) : "Date TBD"} · {pick}
        </span>
      </span>
      <span aria-hidden="true" className="shrink-0 text-slate-600 dark:text-slate-300">
        ›
      </span>
    </button>
  );
}

function PredictionCard({
  prediction,
  teamsById,
  matchups,
  why: whyContext,
}: {
  prediction: LeaguePrediction;
  teamsById: Map<string, Team>;
  matchups: Matchup[];
  why: WhyContext;
}) {
  const [whyOpen, setWhyOpen] = useState(false);
  const whyId = useId();
  const game = matchups.find((item) => item.id === prediction.gameId);
  const a = teamNameFor(teamsById, prediction.teamAId);
  const b = teamNameFor(teamsById, prediction.teamBId);
  const winner = prediction.predictedWinnerId
    ? teamNameFor(teamsById, prediction.predictedWinnerId)
    : "Pending data";
  // How far the game can stray from the forecast (2.10), once the model has finals to go on.
  const range = prediction.range;
  const aPct = Math.round(prediction.winProbability.teamA * 100);
  const bPct = Math.round(prediction.winProbability.teamB * 100);
  const whyLabel =
    aPct === bPct
      ? "Why a toss-up?"
      : `Why ${displayName(aPct > bPct ? a : b)} at ${Math.max(aPct, bPct)}%?`;
  // Asked for only while the explanation is open: the per-game model is not free to run.
  const gameModelChance =
    whyOpen && game && whyContext.gameOdds ? whyContext.gameOdds(game) : undefined;
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
            {game?.date ? dayAndTime(formatGameDate(game.date), game.startTs) : "Date TBD"}
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
          {range && (
            <p className={`mt-1 ${textRole.meta}`}>
              Range:{" "}
              {marginSpanText(range.margin, { teamA: displayName(a), teamB: displayName(b) })}
            </p>
          )}
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
          {range?.score && (
            <p className={`mt-1 ${textRole.meta}`}>
              Range: {displayName(a)} {runSpanText(range.score.teamA)}, {displayName(b)}{" "}
              {runSpanText(range.score.teamB)}
            </p>
          )}
        </div>
      </div>
      <div className="mt-4 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Model Read
        </p>
        <p className="mt-2 text-sm font-semibold leading-6 text-slate-700 dark:text-slate-300">
          {prediction.keyFactors[0] ?? "Add completed scores to unlock a model read."}
        </p>
        {prediction.explanation && (
          <button
            type="button"
            aria-expanded={whyOpen}
            aria-controls={whyId}
            onClick={() => setWhyOpen((was) => !was)}
            className="mt-2 text-sm font-bold text-slate-950 underline underline-offset-2 dark:text-slate-100"
          >
            {whyLabel}
          </button>
        )}
        {whyOpen && (
          <div id={whyId} className="mt-3">
            <ErrorBoundary area="this explanation" onReset={forecastWhy.reset}>
              <Suspense
                fallback={
                  <p role="status" className="text-sm text-slate-600 dark:text-slate-300">
                    Loading the explanation…
                  </p>
                }
              >
                <ForecastWhy
                  prediction={prediction}
                  nameOf={whyContext.nameOf}
                  findings={whyContext.findings}
                  record={whyContext.record}
                  hasCutLine={whyContext.hasCutLine}
                  {...(gameModelChance !== undefined ? { gameModelChance } : {})}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}
      </div>
      {/* The game's own risk alone: every close card said the same close-game line, and every
          card led with the league's data warnings, which the Data Quality tab says once. */}
      {prediction.riskFactors.includes(SMALL_SAMPLE_RISK) && (
        <p className="mt-3 text-sm font-bold text-amber-700 dark:text-amber-300">
          Risk: {SMALL_SAMPLE_RISK}
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
  gameOdds,
  seasonFinal,
  hasCutLine = true,
  look,
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
  /**
   * The season as it stands, for the big "Since you last looked" card (`SinceLastLookCard`): the
   * followed team's place and Gold odds then and now, its results, the upset, who passed whom.
   * Unlike the digest, it counts what was entered here too. The forecasts come from `engine`.
   */
  look?: Omit<LookInput, "predictions">;
  /** The per-game model's chance that the away side wins a game, for a card's explanation. */
  gameOdds?: (game: Matchup) => number;
  /**
   * How the season ended, once it has (`seasonFinalOf`): shown where the next games would be,
   * since a finished season has none to predict.
   */
  seasonFinal?: SeasonFinal | null;
  /** Whether the league has a cut line: without one, a card's explanation has no Gold % to tell apart. */
  hasCutLine?: boolean;
}) {
  const why: WhyContext = {
    nameOf: (id) => displayName(teamNameFor(teamsById, id)),
    ...(gameOdds ? { gameOdds } : {}),
    findings,
    record: backtestResult,
    hasCutLine,
  };
  // On a phone each upcoming game is a line until it is opened: three full cards there were the
  // better part of three screens, with the power ratings below them all.
  const narrow = useNarrowViewport();
  const [openPrediction, setOpenPrediction] = useState<string | null>(null);
  // The games next to be played, in the order they are: by day, then start, undated ones last.
  // The forecast lists them as the schedule stores them, which need not be either.
  const gameById = new Map(matchups.map((game) => [game.id, game]));
  const seasonStart = seasonStartMonth(matchups.map((game) => game.date));
  const upcoming = [...engine.predictions].sort((x, y) => {
    const a = gameById.get(x.gameId);
    const b = gameById.get(y.gameId);
    if (!a || !b) return 0;
    const aUndated = !a.date.trim();
    const bUndated = !b.date.trim();
    if (aUndated !== bUndated) return aUndated ? 1 : -1;
    return (
      parseDateValue(a.date, seasonStart) - parseDateValue(b.date, seasonStart) || byStart(a, b)
    );
  });

  const lookPredictions = useMemo(
    () =>
      engine.predictions.map((call) => ({
        gameId: call.gameId,
        teamAId: call.teamAId,
        pA: call.winProbability.teamA,
      })),
    [engine.predictions]
  );
  const lookRows = useMemo(
    () => look?.rows.map((row) => ({ ...row, name: displayName(row.name) })),
    [look?.rows]
  );
  const [lookShown, setLookShown] = useState(false);
  const avgConfidence = engine.predictions.length
    ? Math.round(
        engine.predictions.reduce((sum, p) => sum + p.confidence.score, 0) /
          engine.predictions.length
      )
    : 0;
  return (
    <div className="space-y-6">
      {/* The big card first, and the list of what other devices changed while it is not up. Put
          away, it takes the list's news as seen too, so the list does not follow it. */}
      {look && lookRows && (
        <ErrorBoundary area="what changed since you last looked" onReset={sinceLastLook.reset}>
          <Suspense fallback={null}>
            <SinceLastLook
              look={{ ...look, rows: lookRows, predictions: lookPredictions }}
              onDismiss={() => digest?.onAcknowledge()}
              onShown={setLookShown}
            />
          </Suspense>
        </ErrorBoundary>
      )}
      {digest && !lookShown && <DigestPanel {...digest} />}
      {ourTeam}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {[
          ["Games forecasted", String(engine.predictions.length)],
          // A score of 100 and its tier, as the "Why" panel gives each game: as a percent beside
          // "Prediction accuracy" it read as a chance.
          [
            "Confidence",
            avgConfidence ? `${confidenceTier(avgConfidence)} (${avgConfidence} of 100)` : "—",
          ],
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
            className="min-w-0 rounded-lg border border-slate-200 bg-white p-3 shadow-xs sm:p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {label}
            </p>
            <p className="mt-1 text-lg font-black wrap-break-word sm:mt-2 sm:text-2xl">{value}</p>
          </div>
        ))}
      </section>
      {/* `items-start`: the side card ends where its content does, rather than being stretched into an
          empty white panel the height of the predictions beside it. */}
      <section className="grid gap-6 lg:grid-cols-[1.25fr_.75fr] lg:items-start">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-black">Upcoming Game Predictions</h2>
            <button className={buttonClasses.ghost} onClick={() => setActiveView("games")}>
              Open Schedule
            </button>
          </div>
          {upcoming
            .slice(0, 3)
            .map((p) =>
              narrow && openPrediction !== p.gameId ? (
                <PredictionLine
                  key={p.gameId}
                  prediction={p}
                  teamsById={teamsById}
                  matchups={matchups}
                  onOpen={() => setOpenPrediction(p.gameId)}
                />
              ) : (
                <PredictionCard
                  key={p.gameId}
                  prediction={p}
                  teamsById={teamsById}
                  matchups={matchups}
                  why={why}
                />
              )
            )}
          {engine.predictions.length === 0 &&
            (seasonFinal ? (
              <section
                aria-label="Season over"
                className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900"
              >
                <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Season over
                </p>
                <ul className="mt-2 space-y-1 text-sm font-semibold text-slate-800 dark:text-slate-100">
                  <li>Regular season: {seasonFinal.leader} finished first.</li>
                  {seasonFinal.champion && <li>Champion: {seasonFinal.champion}.</li>}
                  {seasonFinal.silverChampion && (
                    <li>Silver champion: {seasonFinal.silverChampion}.</li>
                  )}
                  {seasonFinal.ourTeam && <li>{seasonFinal.ourTeam}</li>}
                </ul>
              </section>
            ) : (
              <EmptyPanel
                title="No predictions yet"
                body="Add completed scores and upcoming games to generate forecasts."
              />
            ))}
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
