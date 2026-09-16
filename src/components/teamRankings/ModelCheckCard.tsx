import { useState } from "react";
import {
  backtestScoutRatings,
  beatsTheBaseline,
  compareAgeGapPriors,
  type ScoutBacktestResult,
} from "../../lib/scoutBacktest";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../../lib/teamRankings";
import { AGE_GAP_RUNS_PER_YEAR } from "../../lib/powerRating";
import { button, card, pill } from "../../styles/tokens";

type ModelCheckCardProps = {
  ageGroupId: string;
  groupName: string;
  teams: ScoutTeam[];
  games: ScoutGame[];
  ageGroups: AgeGroup[];
};

const runs = (value: number | null): string => (value === null ? "—" : `${value.toFixed(2)} runs`);

const percent = (value: number | null): string =>
  value === null ? "—" : `${Math.round(value * 100)}%`;

/**
 * Whether the ratings on this page predict anything.
 *
 * A fit always describes the games it was fitted on; that is what fitting means and it says
 * nothing about whether the ratings are worth reading. This runs the only honest test — fit on the
 * earlier games, predict the later ones — on whatever is actually in the pool, and reports it
 * plainly, including when the answer is that the model is no better than calling every game even.
 *
 * Run on a press rather than on render. It refits the pool several times over and nobody opening
 * Setup to add an age group should pay for that.
 */
export function ModelCheckCard({
  ageGroupId,
  groupName,
  teams,
  games,
  ageGroups,
}: ModelCheckCardProps) {
  const [result, setResult] = useState<ScoutBacktestResult | null>(null);
  const [priors, setPriors] = useState<ScoutBacktestResult[] | null>(null);
  const [ran, setRan] = useState(false);

  const run = () => {
    setResult(backtestScoutRatings(ageGroupId, teams, games, ageGroups));
    setPriors(compareAgeGapPriors(ageGroupId, teams, games, ageGroups));
    setRan(true);
  };

  const beat = result ? beatsTheBaseline(result) : null;
  const bestPrior = priors?.[0];

  return (
    <div className={`${card} p-5`}>
      <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">
        Does the model predict anything?
      </h2>
      <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">
        Fits the ratings on the earlier games in {groupName || "this age group"} and predicts the
        later ones, which the fit never saw. A rating that cannot beat calling every game even is
        not telling you anything.
      </p>

      <div className="mt-3">
        <button type="button" onClick={run} disabled={!ageGroupId} className={button.ghost}>
          {ran ? "Run it again" : "Check the model"}
        </button>
      </div>

      {ran && result && (
        <div className="mt-4 text-sm">
          {result.sampleSize === 0 ? (
            <p className="text-slate-500">
              Not enough dated games here to hold any back. The check needs games with dates on both
              sides of a cut — a pull brings dates with it.
            </p>
          ) : (
            <>
              <p className="font-bold text-slate-950 dark:text-white">
                {beat ? (
                  <span className={pill("emerald")}>Better than a coin</span>
                ) : (
                  <span className={pill("amber")}>No better than calling it even</span>
                )}
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                <dt className="text-xs uppercase tracking-wide text-slate-500">Games predicted</dt>
                <dd className="font-bold">{result.sampleSize}</dd>

                <dt className="text-xs uppercase tracking-wide text-slate-500">
                  Off by, on average
                </dt>
                <dd className="font-bold">{runs(result.meanAbsoluteError)}</dd>

                <dt className="text-xs uppercase tracking-wide text-slate-500">
                  Calling every game even
                </dt>
                <dd className="font-bold">{runs(result.baselineError)}</dd>

                <dt className="text-xs uppercase tracking-wide text-slate-500">
                  Winner called right
                </dt>
                <dd className="font-bold">{percent(result.winnerAccuracy)}</dd>
              </dl>

              <h3 className="mt-5 text-xs font-black uppercase tracking-wide text-slate-500">
                What a year of age is worth here
              </h3>
              {result.crossAgeSamples === 0 ? (
                <p className="mt-1 text-slate-500">
                  Nothing in this pool crosses an age level, so it cannot say. The model is using
                  the rule of thumb, {AGE_GAP_RUNS_PER_YEAR} runs a year.
                </p>
              ) : (
                <p className="mt-1 text-slate-700 dark:text-slate-200">
                  Fitted at <strong>{result.fittedAgeGapRuns.toFixed(2)} runs a year</strong> from{" "}
                  {result.crossAgeSamples} cross-age game
                  {result.crossAgeSamples === 1 ? "" : "s"} in the held-back set, starting from the{" "}
                  {result.ageGapPrior}-run rule of thumb.
                  {bestPrior && bestPrior.ageGapPrior !== result.ageGapPrior
                    ? ` Starting from ${bestPrior.ageGapPrior} instead predicted these games best.`
                    : " No other starting point predicted them better."}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
