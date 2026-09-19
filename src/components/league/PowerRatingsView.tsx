/**
 * Every team by opponent-adjusted rating, which is not the standings: a team that beat nobody in
 * particular can sit below one that lost to everybody good.
 */
import { HelpTip } from "../HelpTip";
import type { buildPredictionEngine } from "../../lib/predictionEngine";
import { EmptyPanel } from "./EmptyPanel";

/**
 * Recent form against a team's own season average. Most teams sit inside the
 * band most weeks, so the movers have to be the ones that catch the eye.
 */
function TrendCell({ trend }: { trend: "Up" | "Down" | "Stable" | "New" }) {
  if (trend === "Up") {
    return <span className="font-bold text-emerald-600 dark:text-emerald-400">↑ Up</span>;
  }
  if (trend === "Down") {
    return <span className="font-bold text-red-600 dark:text-red-400">↓ Down</span>;
  }
  return (
    <span className="text-slate-400 dark:text-slate-500">
      {trend === "New" ? "New" : "– Stable"}
    </span>
  );
}

// Format a run-denominated rating value with an explicit sign, e.g. "+2.3", "0.0", "-1.0".
const signedRuns = (value: number) => {
  const rounded = Number(value.toFixed(1));
  const safe = Object.is(rounded, -0) ? 0 : rounded;
  return `${safe > 0 ? "+" : ""}${safe.toFixed(1)}`;
};

export function PowerRatingsView({
  engine,
  compact = false,
}: {
  engine: ReturnType<typeof buildPredictionEngine>;
  compact?: boolean;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-black">
          Power Ratings
          <HelpTip title="How the rating works">
            <strong>Rating</strong> is an opponent-adjusted run margin (a Massey rating, the same
            idea as the NCAA&apos;s NET): it fits every team so rating difference ≈ expected run
            margin, using per-game-capped run differential regressed toward league average so short
            seasons stay stable. It reads in runs — <strong>+2.0</strong> means about two runs
            better than an average team. <strong>Run Diff/G</strong> is your own capped run
            differential per game; <strong>SOS</strong> ranks how tough a schedule you&apos;ve faced
            (#1 = toughest). Because it adjusts for opponents, this is <em>not</em> the standings —
            an undefeated team that beat weak opponents can rank below a strong-schedule team.
          </HelpTip>
        </h2>
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Opponent-adjusted
        </span>
      </div>
      {engine.powerRatings.length ? (
        <div className="mt-4">
          {/*
           * Seven columns is three too many for a phone. Sideways scrolling inside a card is the
           * thing a person at a ballfield is least likely to find, so below `sm` the same rows are
           * stacked instead: rank, team and rating on one line because that is the reading, and the
           * four supporting numbers labelled underneath. One source, two shapes, so a column added
           * to the table has to be added here too — which is the point, since a column nobody can
           * see on a phone is a column nobody has decided about.
           */}
          <ul className="space-y-2 sm:hidden">
            {engine.powerRatings.slice(0, compact ? 6 : undefined).map((r) => (
              <li
                key={r.teamId}
                className="rounded-lg border border-slate-200 p-3 dark:border-slate-800"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-black">
                    #{r.rank} {r.teamName}
                  </span>
                  <span className="shrink-0 text-sm font-black">{signedRuns(r.rating)}</span>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500 dark:text-slate-400">Record</dt>
                    <dd>{r.record}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500 dark:text-slate-400">Run Diff/G</dt>
                    <dd>{signedRuns(r.rawMargin)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500 dark:text-slate-400">SOS</dt>
                    <dd>{r.sosRank > 0 ? `#${r.sosRank}` : "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500 dark:text-slate-400">Trend</dt>
                    <dd>
                      <TrendCell trend={r.trend} />
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
          <table className="hidden min-w-full text-sm sm:table">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="py-2">Rank</th>
                <th>Team</th>
                <th>Rating</th>
                <th>Record</th>
                <th>Run Diff/G</th>
                <th>SOS</th>
                <th>Trend</th>
              </tr>
            </thead>
            <tbody>
              {engine.powerRatings.slice(0, compact ? 6 : undefined).map((r) => (
                <tr key={r.teamId} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-3 font-black">#{r.rank}</td>
                  <td className="font-black">{r.teamName}</td>
                  <td className="font-black">{signedRuns(r.rating)}</td>
                  <td>{r.record}</td>
                  <td>{signedRuns(r.rawMargin)}</td>
                  <td>{r.sosRank > 0 ? `#${r.sosRank}` : "—"}</td>
                  <td>
                    <TrendCell trend={r.trend} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!compact && (
            <p className="mt-3 text-xs font-semibold leading-5 text-slate-500 dark:text-slate-400">
              Opponent-adjusted, so it can differ from the standings on purpose — a team that beat a
              weak schedule can rank below a team that played tougher competition. SOS is a schedule
              rank (#1 = toughest faced).
            </p>
          )}
        </div>
      ) : (
        <EmptyPanel
          title="Power ratings unavailable"
          body="Power ratings will appear once teams have completed games."
        />
      )}
    </section>
  );
}
