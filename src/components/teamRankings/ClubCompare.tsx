import {
  SIMILAR_BAND,
  type ClubComparison,
  type ClubResult,
  type ClubSide,
  type Record3,
} from "../../lib/clubCompare";
import { formatIsoDayShort } from "../../lib/date";

/** "W 8–3", "L 1–2", "T 4–4": a result as the club it belongs to would say it. */
const scoreLine = (result: ClubResult): string =>
  `${result.margin > 0 ? "W" : result.margin < 0 ? "L" : "T"} ${result.runsFor}–${result.runsAgainst}`;

const rankTag = (rank: number | undefined) => (rank === undefined ? "unranked" : `#${rank}`);

const oneDecimal = (value: number) => value.toFixed(1);
const signed = (value: number) =>
  `${value > 0 ? "+" : value < 0 ? "−" : ""}${oneDecimal(Math.abs(value))}`;
const recordOf = (record: Record3) =>
  record.wins + record.losses + record.ties === 0
    ? "—"
    : `${record.wins}-${record.losses}${record.ties ? `-${record.ties}` : ""}`;

/** Each side's line for one row of the profile, or a dash where it has nothing to say. */
const PROFILE_ROWS: Array<{ label: string; title?: string; of: (side: ClubSide) => string }> = [
  {
    label: "Runs a game",
    title: "Scored – allowed, over the games counted",
    of: (side) =>
      side.profile
        ? `${oneDecimal(side.profile.runsFor)} – ${oneDecimal(side.profile.runsAgainst)}`
        : "—",
  },
  {
    label: "Average margin",
    of: (side) => (side.profile ? signed(side.profile.margin) : "—"),
  },
  {
    label: "Vs stronger",
    title: `Opponents rated more than ${SIMILAR_BAND} runs above the club`,
    of: (side) => (side.split ? recordOf(side.split.stronger) : "—"),
  },
  {
    label: "Vs similar",
    title: `Opponents rated within ${SIMILAR_BAND} runs of the club`,
    of: (side) => (side.split ? recordOf(side.split.similar) : "—"),
  },
  {
    label: "Vs weaker",
    title: `Opponents rated more than ${SIMILAR_BAND} runs below the club`,
    of: (side) => (side.split ? recordOf(side.split.weaker) : "—"),
  },
  { label: "Form", title: "The last five, newest first", of: (side) => side.form || "—" },
];

/** The common-opponent edge in words: who did better against the clubs both played, by how much. */
const edgeWords = (edge: number, aName: string, bName: string, clubs: number) => {
  const against = `against the ${clubs === 1 ? "club" : `${clubs} clubs`} both have played`;
  if (Math.abs(edge) < 0.05) return `Level ${against}.`;
  const [better, worse] = edge > 0 ? [aName, bName] : [bName, aName];
  return `${better} did ${oneDecimal(Math.abs(edge))} runs a game better than ${worse} ${against}.`;
};

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
          Profile
        </h4>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm" aria-label="Profiles">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <th className="py-1 pr-3">
                  <span className="sr-only">What</span>
                </th>
                <th className="py-1 pr-3">{aName}</th>
                <th className="py-1">{bName}</th>
              </tr>
            </thead>
            <tbody>
              {PROFILE_ROWS.map((row) => (
                <tr key={row.label}>
                  <th
                    scope="row"
                    className="py-1 pr-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400"
                    {...(row.title ? { title: row.title } : {})}
                  >
                    {row.label}
                  </th>
                  <td className="py-1 pr-3 tabular-nums">{row.of(comparison.a)}</td>
                  <td className="py-1 tabular-nums">{row.of(comparison.b)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Common opponents
        </h4>
        {comparison.commonEdge !== null && (
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {edgeWords(comparison.commonEdge, aName, bName, common.length)}
          </p>
        )}
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
