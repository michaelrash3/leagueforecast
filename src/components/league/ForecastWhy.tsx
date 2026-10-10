import { useId, useMemo, useState } from "react";
import { explainForecast, type Factor, type Side } from "../../lib/forecastExplanation";
import { marginSpanText, runSpanText } from "../../lib/forecastRangeText";
import type { Finding } from "../../lib/leagueFindings";
import type { LeaguePrediction } from "../../lib/predictionEngine";
import { textRole } from "../../styles/tokens";

const NO_FINDINGS: readonly Finding[] = [];

/**
 * Why a matchup's odds came out as they did (2.8, `forecastExplanation.ts`), opened from its card:
 * the strongest reason for each side first, the margin as the sum of its parts, every factor on
 * request, what could change it, and the numbers the page shows that are easily taken for one
 * another (win chance, the range a game lands in, confidence, Gold % and the record so far), each
 * said apart.
 */
export function ForecastWhy({
  prediction,
  nameOf,
  gameModelChance,
  findings = NO_FINDINGS,
  record,
}: {
  prediction: LeaguePrediction;
  nameOf: (id: string) => string;
  /** The per-game model's chance that team A wins, the Schedule's odds for the same game. */
  gameModelChance?: number;
  /** The season's data-quality findings, for the Team Rankings links guessed from a name (2.3). */
  findings?: readonly Finding[];
  /** The season's finished games replayed one at a time (`backtestPredictions`). */
  record?: { winnerAccuracy: number | null; sampleSize: number };
}) {
  const [every, setEvery] = useState(false);
  const everyId = useId();
  // The links guessed among clubs of one name, a finding of their own (`link-ambiguous`).
  const ambiguous = useMemo(
    () =>
      new Set(
        findings
          .filter((finding) => finding.code === "link-ambiguous")
          .flatMap((finding) =>
            finding.targets.flatMap((target) => (target.kind === "team" ? [target.id] : []))
          )
      ),
    [findings]
  );
  const accuracy =
    record && record.winnerAccuracy !== null && record.sampleSize > 0
      ? { called: Math.round(record.winnerAccuracy * record.sampleSize), games: record.sampleSize }
      : null;
  const explained = useMemo(
    () =>
      explainForecast(prediction, {
        nameOf,
        ...(gameModelChance !== undefined ? { gameModelChance } : {}),
        ambiguous,
      }),
    [prediction, nameOf, gameModelChance, ambiguous]
  );
  if (!explained) {
    return (
      <p className={textRole.meta}>
        The model needs finished games before it can say why: it has nothing to rate either side on
        yet.
      </p>
    );
  }
  const name: Record<Side, string> = {
    teamA: nameOf(prediction.teamAId),
    teamB: nameOf(prediction.teamBId),
  };
  const other = (side: Side): Side => (side === "teamA" ? "teamB" : "teamA");
  const order: Side[] = explained.favorite === "teamB" ? ["teamB", "teamA"] : ["teamA", "teamB"];
  const leader = explained.margin >= 0 ? "teamA" : "teamB";
  const parts = explained.factors.filter((factor) => factor.inMargin && factor.runs !== undefined);
  // Each part from the leading side's view: what it adds to their margin, or takes from it. The
  // cap leans neither way and only ever takes from the leader, so it reads as a minus too.
  const partLine = parts
    .map((factor) => {
      const value = (factor.runs ?? 0) * (factor.favors === leader ? 1 : -1);
      return `${factor.label.toLowerCase()} ${value < 0 ? "−" : "+"}${Math.abs(value).toFixed(1)}`;
    })
    .join(", ");
  const runsFor = (factor: Factor) =>
    factor.runs !== undefined ? ` (${factor.runs.toFixed(1)} runs)` : "";
  const favorite = explained.favorite;
  const percent = (value: number) => `${Math.round(value * 100)}%`;
  const confidence = prediction.confidence;
  const range = prediction.range;

  return (
    <div className="space-y-3 text-sm text-slate-700 dark:text-slate-300">
      <ul className="space-y-1">
        {order.map((side) => {
          const factor = explained.strongest[side];
          return (
            <li key={side}>
              <span className="font-bold text-slate-950 dark:text-slate-100">
                For {name[side]}:
              </span>{" "}
              {factor
                ? `${factor.label}${runsFor(factor)}. ${factor.text}`
                : "nothing in this forecast leans their way."}
            </li>
          );
        })}
      </ul>
      <p className={textRole.meta}>
        {Math.abs(explained.margin) < 0.05
          ? "Projected margin: none."
          : `Projected margin: ${name[leader]} by ${Math.abs(explained.margin).toFixed(1)} runs${partLine ? `, from ${partLine}` : ""}.`}
      </p>

      <button
        type="button"
        aria-expanded={every}
        aria-controls={everyId}
        onClick={() => setEvery((was) => !was)}
        className="text-sm font-bold text-slate-950 underline underline-offset-2 dark:text-slate-100"
      >
        {every ? "Fewer factors" : "Every factor"}
      </button>
      {every && (
        <div id={everyId} className="space-y-2">
          {(
            [
              ["In the margin", explained.factors.filter((factor) => factor.inMargin)],
              ["Beside it", explained.factors.filter((factor) => !factor.inMargin)],
            ] as const
          ).map(([title, factors]) => (
            <div key={title}>
              <h4 className={textRole.overline}>{title}</h4>
              <ul className="mt-1 space-y-1">
                {factors.map((factor) => (
                  <li key={factor.key}>
                    <span className="font-bold text-slate-950 dark:text-slate-100">
                      {factor.label}
                      {factor.favors ? `, for ${name[factor.favors]}` : ""}
                      {runsFor(factor)}:
                    </span>{" "}
                    {factor.text}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <div>
        <h4 className={textRole.overline}>What could change it</h4>
        {explained.sensitivities.length ? (
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {explained.sensitivities.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1">
            Nothing stands out: both sides have played enough, and recently enough, to go on.
          </p>
        )}
      </div>

      <div>
        <h4 className={textRole.overline}>
          {range ? "Five" : "Four"} numbers that are not the same
        </h4>
        <dl className="mt-1 space-y-1">
          <div>
            <dt className="inline font-bold text-slate-950 dark:text-slate-100">Win chance: </dt>
            <dd className="inline">
              {favorite
                ? `${percent(explained.chance[favorite])} for ${name[favorite]}, how often the model expects a side rated like ${name[favorite]} to beat one rated like ${name[other(favorite)]}.`
                : "even, as the model reads these two sides."}
              {explained.probabilityCapped
                ? " Held at 92%: no game at this level is a sure thing."
                : ""}
            </dd>
          </div>
          {range && (
            <div>
              <dt className="inline font-bold text-slate-950 dark:text-slate-100">Range: </dt>
              <dd className="inline">
                {`${marginSpanText(range.margin, name)}, where eight games in ten like this one end${
                  range.score
                    ? `, with ${name.teamA} scoring ${runSpanText(range.score.teamA)} and ${name.teamB} ${runSpanText(range.score.teamB)}`
                    : ""
                }. It is how far one game strays from its forecast, measured on about 97,000 youth games: the same width however sure the model is, and not a second chance of winning.`}
              </dd>
            </div>
          )}
          <div>
            <dt className="inline font-bold text-slate-950 dark:text-slate-100">Confidence: </dt>
            <dd className="inline">
              {confidence.tier} ({confidence.score} of 100), how much the model has to go on: games
              played, how far apart the ratings are, how steady the results. It is not a second
              chance of winning.
            </dd>
          </div>
          <div>
            <dt className="inline font-bold text-slate-950 dark:text-slate-100">Gold %: </dt>
            <dd className="inline">
              on Standings and Forecast, the chance of finishing above the cut line over the whole
              season, not of winning this game.
            </dd>
          </div>
          <div>
            <dt className="inline font-bold text-slate-950 dark:text-slate-100">
              Accuracy so far:{" "}
            </dt>
            <dd className="inline">
              {accuracy
                ? `of ${accuracy.games} finished ${accuracy.games === 1 ? "game" : "games"}, each called from the games before it, the favorite won ${accuracy.called} (${percent(accuracy.called / accuracy.games)}). A record of past games, not a promise about this one.`
                : "none yet: no finished game to look back on."}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
