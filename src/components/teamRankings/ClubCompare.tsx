import type { ClubComparison, ClubResult, ClubSide } from "../../lib/clubCompare";
import { formatIsoDayShort } from "../../lib/date";

/** "W 8–3", "L 1–2", "T 4–4": a result as the club it belongs to would say it. */
const scoreLine = (result: ClubResult): string =>
  `${result.margin > 0 ? "W" : result.margin < 0 ? "L" : "T"} ${result.runsFor}–${result.runsAgainst}`;

const rankTag = (rank: number | undefined) => (rank === undefined ? "unranked" : `#${rank}`);

function ResultList({ results, empty }: { results: ClubResult[]; empty: string }) {
  if (results.length === 0) {
    return <p className="text-xs text-slate-500 dark:text-slate-400">{empty}</p>;
  }
  return (
    <ul className="space-y-0.5 text-sm">
      {results.map((result) => (
        <li key={result.gameId}>
          <span className="font-semibold">{scoreLine(result)}</span> vs {result.opponentName}{" "}
          <span className="text-xs text-slate-500 dark:text-slate-400">
            ({rankTag(result.opponentRank)}
            {result.date ? ` · ${formatIsoDayShort(result.date)}` : ""})
          </span>
        </li>
      ))}
    </ul>
  );
}

function SideColumn({ name, side }: { name: string; side: ClubSide }) {
  return (
    <div className="min-w-0 flex-1 space-y-2">
      <h4 className="font-black text-slate-950 dark:text-white">{name}</h4>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Best wins
        </p>
        <ResultList results={side.bestWins} empty="No wins yet." />
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Worst losses
        </p>
        <ResultList results={side.worstLosses} empty="No losses." />
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Last five
        </p>
        <ResultList results={side.lastFive} empty="Nothing played yet." />
      </div>
    </div>
  );
}

/**
 * Two clubs side by side (`compareClubs`): their meetings, the clubs both have played with each
 * one's score against them, and each one's best wins, worst losses and latest results. Names and
 * scores only.
 */
export function ClubCompare({
  comparison,
  aName,
  bName,
}: {
  comparison: ClubComparison;
  aName: string;
  bName: string;
}) {
  const { headToHead, common } = comparison;
  return (
    <section aria-label={`${aName} and ${bName} compared`} className="mt-3 space-y-4">
      <div>
        <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Head to head
        </h4>
        {headToHead.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            They have not met on this board.
          </p>
        ) : (
          <ul className="text-sm">
            {headToHead.map((result) => (
              <li key={result.gameId}>
                {aName} <span className="font-semibold">{scoreLine(result)}</span>
                {result.date ? ` · ${formatIsoDayShort(result.date)}` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Common opponents
        </h4>
        {common.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No club on this board has played both.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm" aria-label="Common opponents">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <th className="py-1 pr-3">Opponent</th>
                  <th className="py-1 pr-3">{aName}</th>
                  <th className="py-1">{bName}</th>
                </tr>
              </thead>
              <tbody>
                {common.map((opponent) => (
                  <tr key={opponent.opponentId}>
                    <td className="py-1 pr-3">
                      {opponent.opponentName}{" "}
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        ({rankTag(opponent.opponentRank)})
                      </span>
                    </td>
                    <td className="py-1 pr-3">{opponent.a.map(scoreLine).join(", ")}</td>
                    <td className="py-1">{opponent.b.map(scoreLine).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <SideColumn name={aName} side={comparison.a} />
        <SideColumn name={bName} side={comparison.b} />
      </div>
    </section>
  );
}
