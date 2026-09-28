import type { MyTeamGlance } from "../../lib/myTeamGlance";
import { formatIsoDayShort } from "../../lib/date";
import { formatRating } from "./RankingList";
import { card } from "../../styles/tokens";

type MyTeamCardProps = {
  glance: MyTeamGlance;
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
export function MyTeamCard({ glance, segmentName, onOpenTeam }: MyTeamCardProps) {
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
