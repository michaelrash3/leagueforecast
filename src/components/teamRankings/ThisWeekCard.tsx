import type { WeekMove, WeekMovers } from "../../lib/thisWeek";
import { TOP_PLACES } from "../../lib/thisWeek";
import { card } from "../../styles/tokens";

/**
 * The board's week (`weekMovers`): who came into its top places, who fell out of them, and the
 * biggest climbs, each a name that opens the club's panel. Drawn with the board, from it alone.
 */
export function ThisWeekCard({
  movers,
  onOpenTeam,
}: {
  movers: WeekMovers;
  onOpenTeam: (teamId: string) => void;
}) {
  const { into, outOf, climbs } = movers;
  if (into.length === 0 && outOf.length === 0 && climbs.length === 0) return null;
  const place = (at: number | null) => (at === null ? "new" : `#${at}`);
  const line = (title: string, moves: WeekMove[], climb = false) =>
    moves.length === 0 ? null : (
      <p className="text-sm text-slate-700 dark:text-slate-200">
        <span className="font-bold">{title}: </span>
        {moves.map((move, at) => (
          <span key={move.teamId}>
            {at > 0 ? ", " : ""}
            <button
              type="button"
              className="font-semibold text-blue-700 hover:underline dark:text-blue-300"
              onClick={() => onOpenTeam(move.teamId)}
            >
              {move.name}
            </button>{" "}
            <span className="text-slate-500 dark:text-slate-400">
              {place(move.from)} → #{move.to}
              {climb && move.from !== null ? ` (up ${move.from - move.to})` : ""}
            </span>
          </span>
        ))}
      </p>
    );
  return (
    <section aria-label="This week" className={`${card} space-y-1.5 p-4`}>
      <h2 className="text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
        This week
      </h2>
      {line(`Into the top ${TOP_PLACES}`, into)}
      {line(`Out of the top ${TOP_PLACES}`, outOf)}
      {line("Biggest climbs", climbs, true)}
    </section>
  );
}
