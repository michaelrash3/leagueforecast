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
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
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
