import type { ScoutRankingRow } from "../../lib/teamRankings";
import type { Movement } from "../../lib/rankMovement";
import { pill } from "../../styles/tokens";

/**
 * A rating is a margin either side of an average team, so the sign is always shown — "+3.1" and
 * "-3.1" are opposite claims and a bare "3.1" reads as neither.
 */
export const formatRating = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;

/**
 * "▲3", "▼5" or "new": how far a club has moved since last week, as a reader says it. Nothing for a
 * club that has not moved, which is most of a board in a quiet week.
 */
export function MovementMark({ movement }: { movement: Movement | undefined }) {
  if (movement === undefined || movement === 0) return null;
  if (movement === "new") {
    return (
      <span
        className="text-xs font-semibold text-slate-500 dark:text-slate-400"
        title="Not ranked a week ago"
      >
        new
      </span>
    );
  }
  const up = movement > 0;
  return (
    <span
      className={`text-xs font-bold ${up ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}`}
      aria-label={`${up ? "up" : "down"} ${Math.abs(movement)} since last week`}
      title={`${up ? "Up" : "Down"} ${Math.abs(movement)} since last week`}
    >
      {up ? "▲" : "▼"}
      {Math.abs(movement)}
    </span>
  );
}

/** A ranked list: place, team with its town under the name, record and rating. */
export function RankingList({
  rows,
  onOpen,
  placeOf,
  movementOf,
}: {
  rows: ScoutRankingRow[];
  onOpen: (teamId: string) => void;
  /** "Prosper, TX" for a pulled club; nothing for a stand-in. */
  placeOf: (teamId: string) => string | undefined;
  /** How far each row has moved since last week, where the list's places are the page's own. */
  movementOf?: (row: ScoutRankingRow) => Movement | undefined;
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
            {/* The town sits under the name, not beside it: beside, a phone truncates the name. */}
            <span className="flex min-w-0 flex-col">
              <button
                type="button"
                onClick={() => onOpen(row.teamId)}
                className="text-left font-bold wrap-break-word text-slate-950 hover:underline dark:text-white"
              >
                {row.teamName}
                {row.isMine ? " ★" : ""}
              </button>
              {placeOf(row.teamId) && (
                <span className="truncate text-xs text-slate-500 dark:text-slate-400">
                  {placeOf(row.teamId)}
                </span>
              )}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2 text-slate-500 dark:text-slate-400">
            {movementOf && <MovementMark movement={movementOf(row)} />}
            <span>
              {row.record} · {formatRating(row.rating)}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
