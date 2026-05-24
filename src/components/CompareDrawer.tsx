import { useId, useMemo, useRef } from "react";

const compareSelectId = "compare-with-select";
import { useEscape, useFocusTrap } from "../hooks/useFocusTrap";
import { displayName, recordText } from "../lib/format";
import type { GameLog, Matchup, TeamWithProjection } from "../lib/types";
import { isFinal, parseNumber } from "../lib/util";

type Props = {
  left: TeamWithProjection;
  right: TeamWithProjection;
  allTeams: TeamWithProjection[];
  matchups: Matchup[];
  logs: Record<string, GameLog>;
  onClose: () => void;
  onPickRight: (id: string) => void;
};

type StatRow = { label: string; left: string; right: string; better?: "left" | "right" | "tie" };

const fmt = (n: number, digits = 1) =>
  Number.isFinite(n) ? n.toFixed(digits) : "—";

export function CompareDrawer({
  left,
  right,
  allTeams,
  matchups,
  logs,
  onClose,
  onPickRight,
}: Props) {
  const ref = useRef<HTMLElement>(null);
  const titleId = useId();
  useFocusTrap(true, ref as React.RefObject<HTMLElement>);
  useEscape(true, onClose);

  const headToHead = useMemo(() => {
    let leftW = 0;
    let rightW = 0;
    let ties = 0;
    const meetings: string[] = [];
    matchups.forEach((game) => {
      const log = logs[game.id];
      if (!log || !isFinal(log)) return;
      const involves =
        (game.away === left.id && game.home === right.id) ||
        (game.away === right.id && game.home === left.id);
      if (!involves) return;
      const awayRuns = parseNumber(log.awayRuns);
      const homeRuns = parseNumber(log.homeRuns);
      meetings.push(
        `${displayName(allTeams.find((t) => t.id === game.away)?.name || game.away)} ${awayRuns}, ${displayName(
          allTeams.find((t) => t.id === game.home)?.name || game.home
        )} ${homeRuns}`
      );
      if (awayRuns === homeRuns) {
        ties += 1;
      } else {
        const awayWon = awayRuns > homeRuns;
        if ((awayWon && game.away === left.id) || (!awayWon && game.home === left.id)) {
          leftW += 1;
        } else {
          rightW += 1;
        }
      }
    });
    return { leftW, rightW, ties, meetings };
  }, [matchups, logs, left.id, right.id, allTeams]);

  const commonOpponents = useMemo(() => {
    const leftOpps = new Set<string>();
    const rightOpps = new Set<string>();
    matchups.forEach((game) => {
      const log = logs[game.id];
      if (!log || !isFinal(log)) return;
      if (game.away === left.id) leftOpps.add(game.home);
      if (game.home === left.id) leftOpps.add(game.away);
      if (game.away === right.id) rightOpps.add(game.home);
      if (game.home === right.id) rightOpps.add(game.away);
    });
    const common = [...leftOpps].filter((id) => rightOpps.has(id));
    return common
      .map((id) => allTeams.find((t) => t.id === id)?.name || id)
      .map(displayName);
  }, [matchups, logs, left.id, right.id, allTeams]);

  const rows: StatRow[] = useMemo(() => {
    const compare = (l: number, r: number, higherBetter = true): "left" | "right" | "tie" => {
      if (l === r) return "tie";
      const leftBetter = higherBetter ? l > r : l < r;
      return leftBetter ? "left" : "right";
    };
    return [
      { label: "Record", left: recordText(left), right: recordText(right) },
      {
        label: "Win %",
        left: fmt(left.pct * 100, 0) + "%",
        right: fmt(right.pct * 100, 0) + "%",
        better: compare(left.pct, right.pct),
      },
      {
        label: "Run Diff",
        left: (left.runDiff > 0 ? "+" : "") + left.runDiff,
        right: (right.runDiff > 0 ? "+" : "") + right.runDiff,
        better: compare(left.runDiff, right.runDiff),
      },
      {
        label: "Runs/Game",
        left: fmt(left.rsg),
        right: fmt(right.rsg),
        better: compare(left.rsg, right.rsg),
      },
      {
        label: "Runs Allowed/Game",
        left: fmt(left.rag),
        right: fmt(right.rag),
        better: compare(left.rag, right.rag, false),
      },
      {
        label: "Hits/Game",
        left: fmt(left.hpg),
        right: fmt(right.hpg),
        better: compare(left.hpg, right.hpg),
      },
      {
        label: "K/Game (batting)",
        left: fmt(left.kpg),
        right: fmt(right.kpg),
        better: compare(left.kpg, right.kpg, false),
      },
      {
        label: "TPI",
        left: (left.tpi > 0 ? "+" : "") + fmt(left.tpi, 2),
        right: (right.tpi > 0 ? "+" : "") + fmt(right.tpi, 2),
        better: compare(left.tpi, right.tpi),
      },
      {
        label: "Gold Odds",
        left: `${Math.round(left.goldPct)}%`,
        right: `${Math.round(right.goldPct)}%`,
        better: compare(left.goldPct, right.goldPct),
      },
      {
        label: "Current Seed",
        left: `#${left.rank}`,
        right: `#${right.rank}`,
        better: compare(left.rank ?? 99, right.rank ?? 99, false),
      },
      {
        label: "Projected Seed",
        left: `#${left.projectedRank}`,
        right: `#${right.projectedRank}`,
        better: compare(left.projectedRank, right.projectedRank, false),
      },
    ];
  }, [left, right]);

  const tone = (which: "left" | "right" | "tie" | undefined, side: "left" | "right") => {
    if (which === "tie" || which === undefined) return "text-slate-700 dark:text-slate-200";
    return which === side
      ? "text-emerald-600 font-black dark:text-emerald-400"
      : "text-slate-500 dark:text-slate-400";
  };

  return (
    <div
      className="fixed inset-0 z-[55] flex justify-end bg-slate-950/40 p-3"
      role="presentation"
      onClick={onClose}
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events */}
      <aside
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="h-full w-full max-w-3xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl outline-none dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Compare
            </div>
            <h2
              id={titleId}
              className="mt-1 text-2xl font-black tracking-tight text-slate-950 dark:text-slate-100"
            >
              {displayName(left.name)} <span className="text-slate-400">vs</span> {displayName(right.name)}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-black text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            Close
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <label
            htmlFor={compareSelectId}
            className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400"
          >
            Compare with
          </label>
          <select
            id={compareSelectId}
            value={right.id}
            onChange={(event) => onPickRight(event.target.value)}
            className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm font-bold outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            aria-label="Compare with another team"
          >
            {allTeams
              .filter((team) => team.id !== left.id)
              .map((team) => (
                <option key={team.id} value={team.id}>
                  {displayName(team.name)}
                </option>
              ))}
          </select>
        </div>

        <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2">Metric</th>
                <th className="px-4 py-2 text-right">{displayName(left.name)}</th>
                <th className="px-4 py-2 text-right">{displayName(right.name)}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((row) => (
                <tr key={row.label}>
                  <td className="px-4 py-2 font-bold text-slate-600 dark:text-slate-300">
                    {row.label}
                  </td>
                  <td className={`px-4 py-2 text-right ${tone(row.better, "left")}`}>{row.left}</td>
                  <td className={`px-4 py-2 text-right ${tone(row.better, "right")}`}>{row.right}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
          <h3 className="font-black tracking-tight text-slate-950 dark:text-slate-100">
            Head-to-Head
          </h3>
          {headToHead.meetings.length === 0 ? (
            <p className="mt-2 text-sm font-bold text-slate-500 dark:text-slate-400">
              No meetings have been finalized yet.
            </p>
          ) : (
            <>
              <p className="mt-2 text-sm font-bold text-slate-700 dark:text-slate-200">
                {displayName(left.name)} {headToHead.leftW} · {displayName(right.name)}{" "}
                {headToHead.rightW}
                {headToHead.ties ? ` · ${headToHead.ties} tie${headToHead.ties === 1 ? "" : "s"}` : ""}
              </p>
              <ul className="mt-2 space-y-1 text-xs font-bold text-slate-600 dark:text-slate-300">
                {headToHead.meetings.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h3 className="font-black tracking-tight text-slate-950 dark:text-slate-100">
            Common Opponents Played
          </h3>
          <p className="mt-2 text-sm font-bold text-slate-700 dark:text-slate-200">
            {commonOpponents.length === 0
              ? "No shared opponents yet."
              : commonOpponents.join(", ")}
          </p>
        </section>
      </aside>
    </div>
  );
}
