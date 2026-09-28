import { useId } from "react";
import type { OurTeamSummary } from "../../lib/ourTeam";
import { displayName } from "../../lib/format";
import { formatGameDate } from "../../lib/date";
import { button as buttonClasses, card } from "../../styles/tokens";

type OurTeamCardProps = {
  summary: OurTeamSummary | null;
  /** Every team in the league, to pick from. */
  teams: Array<{ id: string; name: string }>;
  onPick: (teamId: string | null) => void;
  /** Opens the Schedule on this team's games, for entering a score. */
  onEnterScore: (teamId: string) => void;
};

const ordinal = (n: number): string => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
};

const points = (change: number): string =>
  `${change >= 0 ? "+" : "−"}${Math.abs(change).toFixed(1)} pts`;

/**
 * The team this browser follows, first on the Dashboard.
 *
 * At the field the question is about one team — where are we, what are our chances, who is next —
 * and the Dashboard answered it for the league, with the rest a tap away in the team's drawer. The
 * pick is this browser's (`readOurTeam`), one per season, and never a setting that would travel.
 */
export function OurTeamCard({ summary, teams, onPick, onEnterScore }: OurTeamCardProps) {
  const pickerId = useId();
  const picker = (
    <select
      id={pickerId}
      value={summary?.teamId ?? ""}
      onChange={(event) => onPick(event.target.value || null)}
      className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm font-semibold dark:border-slate-700 dark:bg-slate-900"
    >
      <option value="">{summary ? "Nobody" : "Choose…"}</option>
      {teams.map((team) => (
        <option key={team.id} value={team.id}>
          {displayName(team.name)}
        </option>
      ))}
    </select>
  );

  if (!summary) {
    return (
      <section aria-label="Our team" className={`${card} p-4`}>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label htmlFor={pickerId} className="font-semibold text-slate-600 dark:text-slate-300">
            Follow a team here for its place, its odds and its next game at a glance:
          </label>
          {picker}
        </div>
      </section>
    );
  }

  const { next } = summary;
  return (
    <section aria-label="Our team" className={`${card} p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-black">{displayName(summary.name)}</h2>
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
          <label htmlFor={pickerId}>Our team</label>
          {picker}
        </div>
      </div>
      <p className="mt-2 text-base font-semibold text-slate-700 dark:text-slate-200">
        <strong>{ordinal(summary.place)}</strong> of {summary.of} · {summary.record}
        {summary.goldPct !== undefined && (
          <>
            {" · "}
            <strong>{Math.round(summary.goldPct)}% Gold</strong>
            {summary.goldChange !== undefined && Math.abs(summary.goldChange) >= 0.05 && (
              <span className="text-slate-500 dark:text-slate-400">
                {" "}
                ({points(summary.goldChange)} on the last result)
              </span>
            )}
          </>
        )}
      </p>
      {next ? (
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Next: {next.date ? formatGameDate(next.date) : "date to come"}{" "}
          {next.teamIsAway ? "at" : "vs"} <strong>{displayName(next.opponentName)}</strong> —{" "}
          {Math.round(next.winPct * 100)}% to win.
          {next.winSeed !== next.lossSeed &&
            ` A win leaves them ${ordinal(next.winSeed)}, a loss ${ordinal(next.lossSeed)}.`}
        </p>
      ) : (
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          No games left on their schedule.
        </p>
      )}
      {summary.magic && (
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{summary.magic}</p>
      )}
      <button
        type="button"
        className={`${buttonClasses.ghost} mt-3`}
        onClick={() => onEnterScore(summary.teamId)}
      >
        Enter a score
      </button>
    </section>
  );
}
