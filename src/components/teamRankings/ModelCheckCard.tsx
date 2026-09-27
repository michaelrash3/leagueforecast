import { useState } from "react";
import {
  beatsTheBaseline,
  checkTheModel,
  MIN_PAIRED_GAMES,
  type ModelCheckAnswer,
  type ModelCheckImprovement,
} from "../../lib/scoutBacktest";
import { RATING_CAP } from "../../lib/teamRankings";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../../lib/teamRankings";
import { AGE_GAP_RUNS_PER_YEAR } from "../../lib/powerRating";
import { button, card, pill } from "../../styles/tokens";

type ModelCheckCardProps = {
  ageGroupId: string;
  groupName: string;
  teams: ScoutTeam[];
  games: ScoutGame[];
  ageGroups: AgeGroup[];
  /**
   * Runs the check off the page's thread (`useRankingsWorker`'s `checkModel`), resolving to null if
   * the pool changed before it was done. Without it the check is worked out on the page.
   */
  check?: () => Promise<ModelCheckAnswer | null>;
};

const runs = (value: number | null): string => (value === null ? "—" : `${value.toFixed(2)} runs`);

const percent = (value: number | null): string =>
  value === null ? "—" : `${Math.round(value * 100)}%`;

/** The sweep's open end is `Infinity`, which has to read as a sentence rather than as a number. */
const capName = (cap: number): string => (Number.isFinite(cap) ? `${cap} runs` : "No cap");

/** A cap as the subject of a sentence, where "No cap predicted…" would read as its opposite. */
const capSubject = (cap: number): string =>
  Number.isFinite(cap) ? `A cap of ${cap} runs` : "Leaving margins uncapped";

/** How much better, and how sure: the paired margin and its standard error, in words. */
const byHowMuch = (better: ModelCheckImprovement): string =>
  `${better.by.toFixed(3)} runs a game lower, give or take ${better.standardError.toFixed(3)}`;

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
  check,
}: ModelCheckCardProps) {
  /** The answer, and the page it was worked out for: one for 9U is not one for 10U. */
  const [answered, setAnswered] = useState<{ ageGroupId: string; answer: ModelCheckAnswer } | null>(
    null
  );
  const [working, setWorking] = useState(false);
  const [interrupted, setInterrupted] = useState(false);

  /*
   * Never in the click handler. The check is eleven fits of the page's year, and run there it froze
   * the tab for 18 s on the 18:40 pool and 89 s at a phone's speed. The press paints "Working it
   * out" first, and the fits run in the rankings worker when there is one.
   */
  const run = () => {
    const forGroup = ageGroupId;
    setWorking(true);
    setInterrupted(false);
    const answering: Promise<ModelCheckAnswer | null> = check
      ? check()
      : new Promise((resolve) =>
          window.setTimeout(() => resolve(checkTheModel(forGroup, teams, games, ageGroups)), 0)
        );
    void answering.then((answer) => {
      setWorking(false);
      if (answer) setAnswered({ ageGroupId: forGroup, answer });
      else setInterrupted(true);
    });
  };

  const shown = answered?.ageGroupId === ageGroupId ? answered.answer : null;
  const ran = shown !== null;
  const result = shown?.result ?? null;
  const gaps = shown?.gaps ?? null;
  const caps = shown?.caps ?? null;

  const beat = result ? beatsTheBaseline(result) : null;
  const bestGap = gaps?.[0];
  /** In the order they were tried, not best first, so the curve can be read down the column. */
  const capRows = caps ? [...caps].sort((a, b) => a.cap - b.cap) : null;
  /*
   * Named only when it wins clearly, paired game by game against the value in use: the lowest
   * average alone named a held age gap of 1.5 best on the 9U pool, 1.2 standard errors better than
   * the 2 in use, which is noise (`pairedImprovement`).
   */
  const betterGap = shown?.betterGap ?? null;
  const betterCap = shown?.betterCap ?? null;
  const boldCap = betterCap?.value ?? RATING_CAP;

  return (
    <div className={`${card} p-5`}>
      <h2 className="text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Does the model predict anything?
      </h2>
      <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">
        Fits the ratings on the earlier games in {groupName || "this age group"} and predicts the
        later ones, which the fit never saw. A rating that cannot beat calling every game even is
        not telling you anything.
      </p>

      <div className="mt-3">
        <button
          type="button"
          onClick={run}
          disabled={!ageGroupId || working}
          className={button.ghost}
        >
          {working ? "Working it out…" : ran ? "Run it again" : "Check the model"}
        </button>
        {interrupted && !working && (
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400" role="status">
            The pool changed while this ran, so its answer would be about games that are not there
            any more. Run it again.
          </p>
        )}
      </div>

      {ran && result && (
        <div className="mt-4 text-sm">
          {result.sampleSize === 0 ? (
            <p className="text-slate-500 dark:text-slate-400">
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
                <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Games predicted
                </dt>
                <dd className="font-bold">{result.sampleSize}</dd>

                <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Off by, on average
                </dt>
                <dd className="font-bold">{runs(result.meanAbsoluteError)}</dd>

                <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Calling every game even
                </dt>
                <dd className="font-bold">{runs(result.baselineError)}</dd>

                <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Winner called right
                </dt>
                <dd className="font-bold">{percent(result.winnerAccuracy)}</dd>
              </dl>

              <h3 className="mt-5 text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                What a year of age is worth here
              </h3>
              {result.crossAgeSamples === 0 ? (
                <p className="mt-1 text-slate-500 dark:text-slate-400">
                  Nothing in this pool crosses an age level, so it cannot say. The model holds a
                  year of age at the rule of thumb, {AGE_GAP_RUNS_PER_YEAR} runs.
                </p>
              ) : (
                <p className="mt-1 text-slate-700 dark:text-slate-200">
                  Held at <strong>{result.ageGapPrior} runs a year</strong>, the rule of thumb,
                  rather than fitted: nearly every club plays at one level, so the games cannot say
                  what a year is worth, and a fit read it low. The held-back set has{" "}
                  {result.crossAgeSamples} cross-age game
                  {result.crossAgeSamples === 1 ? "" : "s"}.
                  {!bestGap || bestGap.ratedError === null
                    ? " None of the held-back games was between two clubs rated before it, so the values held cannot be compared here."
                    : betterGap
                      ? ` Held at ${betterGap.value} instead, the ratings predicted the ${betterGap.samples} held-back games between two rated clubs better: ${byHowMuch(betterGap)}.`
                      : result.ratedSamples < MIN_PAIRED_GAMES
                        ? ` Only ${result.ratedSamples} held-back game${result.ratedSamples === 1 ? " was" : "s were"} between two rated clubs, too few to tell the values held apart.`
                        : ` No other value held predicted the ${result.ratedSamples} held-back games between two rated clubs better by more than chance.`}
                </p>
              )}
              <h3 className="mt-5 text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                What the run cap is costing
              </h3>
              <p className="mt-1 text-slate-500 dark:text-slate-400">
                The most one game may swing a rating. {RATING_CAP} is what it is set to, and unlike
                the League Standings cap — which is a rule of your league — nothing measured put it
                there. The last row caps nothing at all, which is the row that asks whether having a
                cap is earning anything rather than which cap is best.
              </p>
              <p className="mt-1 text-slate-500 dark:text-slate-400">
                Every row is fitted at its own cap and then scored against the same target: the
                margin as played, uncapped, so a row allowed to predict past {RATING_CAP} is not
                marked down for doing it. That makes these figures read higher than the{" "}
                <strong>Off by, on average</strong> above, which clips the target at {RATING_CAP} —
                compare the rows with each other, not with that one.
              </p>
              {capRows && capRows.length > 0 && capRows[0]!.sampleSize > 0 ? (
                <div className="mt-2 overflow-x-auto">
                  <table className="min-w-full text-sm" aria-label="Run cap sweep">
                    <thead>
                      <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        <th className="py-1">Cap</th>
                        <th>Off by</th>
                        <th>Called right</th>
                      </tr>
                    </thead>
                    <tbody>
                      {capRows.map((row) => (
                        <tr
                          key={row.cap}
                          className="border-t border-slate-100 dark:border-slate-800"
                        >
                          <td className="py-1 font-semibold">
                            {capName(row.cap)}{" "}
                            {row.cap === RATING_CAP && (
                              <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">
                                in use
                              </span>
                            )}
                          </td>
                          <td className={row.cap === boldCap ? "font-bold" : ""}>
                            {runs(row.meanAbsoluteError)}
                          </td>
                          <td>{percent(row.winnerAccuracy)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-slate-700 dark:text-slate-200">
                    {betterCap
                      ? `${capSubject(betterCap.value)} predicted these games better than the ${RATING_CAP} in use — ${runs(capRows.find((row) => row.cap === betterCap.value)?.meanAbsoluteError ?? null)} against ${runs(capRows.find((row) => row.cap === RATING_CAP)?.meanAbsoluteError ?? null)}, ${byHowMuch(betterCap)}.`
                      : capRows[0]!.sampleSize < MIN_PAIRED_GAMES
                        ? `Only ${capRows[0]!.sampleSize} held-back game${capRows[0]!.sampleSize === 1 ? "" : "s"}, too few to tell the caps apart, so the ${RATING_CAP} in use stands.`
                        : `No other cap predicted these games better than the ${RATING_CAP} in use by more than chance, so it stands.`}
                  </p>
                </div>
              ) : (
                <p className="mt-1 text-slate-500 dark:text-slate-400">
                  Not enough held-back games here to tell the caps apart.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
