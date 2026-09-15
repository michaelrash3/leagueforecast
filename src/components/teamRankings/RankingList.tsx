import type { ScoutRankingRow } from "../../lib/teamRankings";
import { pill } from "../../styles/tokens";

/**
 * A rating is a margin either side of an average team, so the sign is always shown — "+3.1" and
 * "-3.1" are opposite claims and a bare "3.1" reads as neither.
 */
export const formatRating = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;

/** A ranked list: place, team, its state when that adds something, record and rating. */
export function RankingList({
  rows,
  onOpen,
  stateOf,
  showState = false,
}: {
  rows: ScoutRankingRow[];
  onOpen: (teamId: string) => void;
  stateOf: (teamId: string) => string | undefined;
  showState?: boolean;
}) {
  return (
    <ol className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
      {rows.map((row, index) => (
        <li
          key={row.teamId}
          className={`flex items-center justify-between gap-3 px-2 py-2.5 text-sm ${
            row.isMine ? "rounded-lg bg-blue-50 dark:bg-blue-950/40" : ""
          }`}
        >
          <span className="flex min-w-0 items-center gap-3">
            {/* The place in *this* list; a state top ten is not the national ranking renumbered. */}
            <span className={pill(index === 0 ? "amber" : "neutral")}>#{index + 1}</span>
            <button
              type="button"
              onClick={() => onOpen(row.teamId)}
              className="truncate text-left font-bold text-slate-950 hover:underline dark:text-white"
            >
              {row.teamName}
              {row.isMine ? " ★" : ""}
            </button>
            {showState && stateOf(row.teamId) && (
              <span className="shrink-0 text-xs text-slate-500">{stateOf(row.teamId)}</span>
            )}
          </span>
          <span className="shrink-0 text-slate-500">
            {row.record} · {formatRating(row.rating)}
          </span>
        </li>
      ))}
    </ol>
  );
}
