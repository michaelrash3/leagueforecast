import type { LeaguePrediction } from "../lib/predictionEngine";

export function ForecastExplanation({ prediction }: { prediction: LeaguePrediction }) {
  const probability = Math.round(
    Math.max(prediction.winProbability.teamA, prediction.winProbability.teamB) * 100
  );
  const strongest = [...prediction.explanation.factors]
    .filter((factor) => factor.contribution !== 0)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  const positive = strongest.find((factor) => factor.contribution > 0);
  const negative = strongest.find((factor) => factor.contribution < 0);
  return (
    <details className="mt-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <summary className="cursor-pointer text-sm font-black">Why {probability}%?</summary>
      <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
        Win probability estimates the matchup result. Model confidence (
        {prediction.confidence.score}%) describes evidence strength; it is not another win
        probability.
      </p>
      <ul className="mt-2 space-y-2 text-xs">
        {[positive, negative].filter(Boolean).map((factor) => (
          <li key={factor!.key}>
            <strong>
              {factor!.contribution > 0 ? "+" : "−"} {factor!.label}:
            </strong>{" "}
            {factor!.detail}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs font-semibold">
        80% projected-margin range: {prediction.uncertainty.margin.low} to{" "}
        {prediction.uncertainty.margin.high} runs.
      </p>
      {prediction.explanation.sensitivity.length > 0 && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          Sensitivity: {prediction.explanation.sensitivity[0]}
        </p>
      )}
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        Historical calibration describes groups of forecasts and does not guarantee this result.
      </p>
    </details>
  );
}
