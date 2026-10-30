import type { MyTeamMoves } from "../../lib/myTeamLook";
import { Ago, CountUp, Move } from "../SinceParts";
import { formatRating } from "./RankingList";

/** A place then and now, the number running to now, with the move's arrow. */
function Place({ before, now, where }: { before: number; now: number; where: string }) {
  return (
    <>
      <span className="sr-only">
        #{before} {where} then, #{now} now
      </span>
      <span aria-hidden="true">
        <strong>
          #{before.toLocaleString()} → #<CountUp from={before} to={now} />
        </strong>{" "}
        {where} <Move by={before - now} better={now < before} />
      </span>
    </>
  );
}

/** What moved for the club since the last visit, at the top of the My Team card, until put away. */
export function MyTeamSinceLine({
  moves,
  onDismiss,
}: {
  moves: MyTeamMoves;
  onDismiss: () => void;
}) {
  const ratingBy = Math.round((moves.rating.now - moves.rating.before) * 10) / 10;
  return (
    <div
      role="region"
      aria-label="Since you last looked"
      className="mt-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-800"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-black uppercase tracking-wide text-slate-950 dark:text-white">
          Since you last looked{" "}
          <span className="font-semibold normal-case tracking-normal text-slate-600 dark:text-slate-300">
            · <Ago since={moves.since} />
          </span>
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        >
          Got it
        </button>
      </div>
      <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
        <Place before={moves.national.before} now={moves.national.now} where="nationally" />
        {moves.state && (
          <>
            {" · "}
            <Place
              before={moves.state.before}
              now={moves.state.now}
              where={`in ${moves.state.name}`}
            />
          </>
        )}
        {moves.record.before !== moves.record.now && (
          <>
            {" · "}
            {moves.record.before} → <strong>{moves.record.now}</strong>
          </>
        )}
        {" · rating "}
        {formatRating(moves.rating.before)} → <strong>{formatRating(moves.rating.now)}</strong>{" "}
        <Move by={ratingBy} better={ratingBy > 0} />
      </p>
    </div>
  );
}
