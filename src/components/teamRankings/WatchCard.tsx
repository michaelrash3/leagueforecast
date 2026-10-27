import { formatRating } from "../../lib/matchupForecast";
import type { ScoutRankingRow } from "../../lib/teamRankings";
import type { Watched } from "../../lib/watchList";
import { card } from "../../styles/tokens";

/**
 * The clubs watched on this page (`watchList.ts`), at the top of its board: each one's place,
 * record and rating on the board on screen, a tap from its panel, and a way to stop watching it.
 * A club with no row on this board (the other half of the season) is named and says so.
 */
export function WatchCard({
  watched,
  rowOf,
  onOpenTeam,
  onStop,
}: {
  watched: readonly Watched[];
  rowOf: (teamId: string) => ScoutRankingRow | undefined;
  onOpenTeam: (teamId: string) => void;
  onStop: (club: Watched) => void;
}) {
  if (watched.length === 0) return null;
  return (
    <section className={`${card} p-5`} aria-labelledby="watch-card-title">
      <h2
        id="watch-card-title"
        className="text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400"
      >
        Watching
      </h2>
      <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
        {watched.map((club) => {
          const row = rowOf(club.id);
          return (
            <li key={club.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="flex min-w-0 items-baseline gap-2 text-sm">
                <span className="w-10 shrink-0 tabular-nums font-black text-slate-500 dark:text-slate-400">
                  {row ? `#${row.rank}` : "—"}
                </span>
                <button
                  type="button"
                  onClick={() => onOpenTeam(club.id)}
                  className="truncate font-bold text-slate-950 hover:underline dark:text-white"
                >
                  {row?.teamName ?? club.name}
                </button>
              </span>
              <span className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                {row ? (
                  <span className="tabular-nums">
                    {row.record} · {formatRating(row.rating)}
                  </span>
                ) : (
                  <span>Not on this board</span>
                )}
                <button
                  type="button"
                  onClick={() => onStop(club)}
                  aria-label={`Stop watching ${row?.teamName ?? club.name}`}
                  className="font-bold text-slate-500 hover:underline dark:text-slate-400"
                >
                  Stop
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
