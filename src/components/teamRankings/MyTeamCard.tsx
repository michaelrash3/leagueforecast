import type { MyTeamGlance } from "../../lib/myTeamGlance";
import { formatIsoDayShort } from "../../lib/date";
import { formatRating, MovementMark } from "./RankingList";
import { card } from "../../styles/tokens";
import type { RankHistoryPoint } from "../../hooks/useRankingsWorker";

type MyTeamCardProps = {
  glance: MyTeamGlance;
  /** Its place week by week, oldest first, ending a week ago; today's is the glance's own. */
  history?: RankHistoryPoint[];
  /** Which half of the season the numbers are for, when the page has one. */
  segmentName?: string;
  onOpenTeam: (teamId: string) => void;
};

/**
 * The team marked as yours, where it stands and what it plays next, above the boards.
 *
 * The line a parent reads out at the field — "#412 of 15,629, #18 in Ohio, 12-4, Saturday against
 * the Bears at 58%" — without Show all and page after page of the table. The name opens the team's
 * panel, which has the rest.
 */
/** "Aug 30" for an ISO day, as the rest of the card says its dates. */
const shortDay = (day: string): string => formatIsoDayShort(day);

const LINE_WIDTH = 168;
const LINE_HEIGHT = 36;

/**
 * The club's place week by week, as a line: higher is better, so first place is the top edge. Only
 * weeks it had a place are drawn, and nothing at all until two of them are known, because one
 * point is not a line and a week the half had not begun is not a place.
 */
export function RankLine({ history, now }: { history: RankHistoryPoint[]; now: number }) {
  const points = [...history, { asOf: "", rank: now }].filter(
    (point): point is { asOf: string; rank: number } => point.rank !== null
  );
  if (points.length < 2) return null;
  const ranks = points.map((point) => point.rank);
  const best = Math.min(...ranks);
  const worst = Math.max(...ranks);
  const x = (at: number) => 4 + (at * (LINE_WIDTH - 8)) / (points.length - 1);
  const y = (rank: number) =>
    worst === best ? LINE_HEIGHT / 2 : 4 + ((rank - best) * (LINE_HEIGHT - 8)) / (worst - best);
  const first = points[0]!;
  const said = points
    .map((point) =>
      point.asOf ? `#${point.rank} on ${shortDay(point.asOf)}` : `#${point.rank} now`
    )
    .join(", ");
  return (
    <div className="mt-2 flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
      <svg
        role="img"
        aria-label={`Place by week: ${said}`}
        width={LINE_WIDTH}
        height={LINE_HEIGHT}
        viewBox={`0 0 ${LINE_WIDTH} ${LINE_HEIGHT}`}
        className="shrink-0 overflow-visible"
      >
        <polyline
          points={points.map((point, at) => `${x(at)},${y(point.rank)}`).join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
          className="text-blue-600 dark:text-blue-400"
        />
        {points.map((point, at) => (
          <circle
            key={point.asOf || "now"}
            cx={x(at)}
            cy={y(point.rank)}
            r={at === points.length - 1 ? 3 : 2}
            className="fill-blue-600 dark:fill-blue-400"
          />
        ))}
      </svg>
      <span>
        #{first.rank.toLocaleString()} on {shortDay(first.asOf)}, #{now.toLocaleString()} now
      </span>
    </div>
  );
}

export function MyTeamCard({ glance, segmentName, onOpenTeam, history }: MyTeamCardProps) {
  const { next } = glance;
  return (
    <section aria-label="My team" className={`${card} p-4`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={() => onOpenTeam(glance.teamId)}
          className="text-left text-lg font-black text-slate-950 hover:underline dark:text-white"
        >
          <span aria-hidden="true" className="mr-1 text-amber-500">
            ★
          </span>
          {glance.teamName}
        </button>
        {segmentName && (
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {segmentName}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
        <strong>
          #{glance.nationalRank.toLocaleString()} of {glance.nationalOf.toLocaleString()}
        </strong>{" "}
        nationally
        {glance.movement !== undefined && glance.movement !== 0 && (
          <>
            {" "}
            <MovementMark movement={glance.movement} />
          </>
        )}
        {glance.state && glance.stateRank !== undefined && glance.stateOf !== undefined && (
          <>
            {" · "}
            <strong>
              #{glance.stateRank.toLocaleString()} of {glance.stateOf.toLocaleString()}
            </strong>{" "}
            in {glance.state}
          </>
        )}
        {" · "}
        {glance.record} · {formatRating(glance.rating)}
      </p>
      {history && <RankLine history={history} now={glance.nationalRank} />}
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
        {next ? (
          <>
            Next: {next.date ? formatIsoDayShort(next.date) : "date to come"} vs{" "}
            <strong>{next.opponentName}</strong>
            {next.opponentRank !== undefined && ` (#${next.opponentRank.toLocaleString()})`}
            {next.winProb === undefined
              ? " — not rated yet"
              : next.unconnected
                ? ` — ${Math.round(next.winProb * 100)}% to win, a guess: no shared opponents yet`
                : ` — ${Math.round(next.winProb * 100)}% to win`}
          </>
        ) : (
          "No game on the schedule yet."
        )}
      </p>
    </section>
  );
}
