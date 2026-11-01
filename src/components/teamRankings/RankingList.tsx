import { useId } from "react";
import type { ScoutRankingRow } from "../../lib/teamRankings";
import type { Movement } from "../../lib/rankMovement";
import { formatBoardRating } from "../../lib/boardRating";
import { focusRing, pill } from "../../styles/tokens";

/** A rating as the board's rows print it (`formatBoardRating`), its sign always shown. */
export const formatRating = formatBoardRating;

/**
 * "▲3", "▼5" or "new": how far a club has moved since last week, as a reader says it. Nothing for a
 * club that has not moved, which is most of a board in a quiet week. The arrow is an image named in
 * words, since a label on a plain span is one a screen reader passes over, and it read the triangle.
 */
export function MovementMark({ movement }: { movement: Movement | undefined }) {
  if (movement === undefined || movement === 0) return null;
  if (movement === "new") {
    return (
      <span
        className="text-xs font-semibold text-slate-600 dark:text-slate-400"
        title="Not ranked a week ago"
      >
        new
      </span>
    );
  }
  const up = movement > 0;
  return (
    <span
      role="img"
      className={`text-xs font-bold ${up ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}`}
      aria-label={`${up ? "up" : "down"} ${Math.abs(movement)} since last week`}
      title={`${up ? "Up" : "Down"} ${Math.abs(movement)} since last week`}
    >
      {up ? "▲" : "▼"}
      {Math.abs(movement)}
    </span>
  );
}

/**
 * A ranked list: place, team with its town under the name, record and rating.
 *
 * Each row is one button, the whole of it opening the club: only the name did, a line 20 px tall
 * on a phone, and the rest of the row did nothing when tapped. Nothing else in a row can be
 * pressed, so the one control holds the row's every word, and the keyboard reaches each row once.
 * It is named by the club, as the name it was, and described by the rest of the row (the place,
 * the town, the move and the figures), so a screen reader says the club first.
 * The town and the figures are slate-600 where they were 500: on the blue of your own club's row
 * that measured 4.38:1, under the 4.5:1 small text needs.
 */
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
  const listId = useId();
  return (
    <ol className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
      {rows.map((row, index) => {
        const id = (part: string) => `${listId}-${index}-${part}`;
        const place = placeOf(row.teamId);
        return (
          <li key={row.teamId}>
            <button
              type="button"
              onClick={() => onOpen(row.teamId)}
              aria-labelledby={id("name")}
              aria-describedby={[id("place"), ...(place ? [id("town")] : []), id("figures")].join(
                " "
              )}
              className={`group flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-900 ${focusRing} ${
                row.isMine ? "bg-blue-50 dark:bg-blue-950/40" : ""
              }`}
            >
              <span className="flex min-w-0 items-center gap-3">
                {/* The place in *this* list; a state top ten is not the national ranking renumbered. */}
                <span id={id("place")} className={pill(index === 0 ? "amber" : "neutral")}>
                  #{index + 1}
                </span>
                {/* The town sits under the name, not beside it: beside, a phone truncates the name. */}
                <span className="flex min-w-0 flex-col">
                  <span
                    id={id("name")}
                    className="font-bold wrap-break-word text-slate-950 group-hover:underline dark:text-white"
                  >
                    {row.teamName}
                    {row.isMine ? " ★" : ""}
                  </span>
                  {place && (
                    <span
                      id={id("town")}
                      className="truncate text-xs text-slate-600 dark:text-slate-400"
                    >
                      {place}
                    </span>
                  )}
                </span>
              </span>
              <span
                id={id("figures")}
                className="flex shrink-0 items-center gap-2 text-slate-600 dark:text-slate-400"
              >
                {movementOf && <MovementMark movement={movementOf(row)} />}
                {/* Laid out by the gap, but a word apart when the row is read out. */}{" "}
                <span>
                  {row.record} · {formatRating(row.rating)}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
