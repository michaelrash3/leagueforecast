import { useMemo, useState } from "react";
import {
  defaultFillSelection,
  type LeagueFillAction,
  type LeagueFillPlan,
  type LeagueFillRow,
} from "../lib/leagueScoreFill";
import { formatGameDate } from "../lib/date";
import { displayName } from "../lib/format";
import { button, card, pill } from "../styles/tokens";

type LeagueScoreFillPanelProps = {
  plan: LeagueFillPlan;
  /** The season being filled, named the way the header names it. */
  seasonLabel: string;
  onApply: (matchupIds: string[]) => void;
  onClose: () => void;
};

const ACTION_TONE: Record<LeagueFillAction, "emerald" | "blue" | "amber" | "neutral" | "red"> = {
  fill: "emerald",
  suggested: "blue",
  overwrite: "amber",
  unchanged: "neutral",
  ambiguous: "red",
};

const ACTION_LABEL: Record<LeagueFillAction, string> = {
  fill: "Fill",
  suggested: "Check name",
  overwrite: "Disagrees",
  unchanged: "Already in",
  ambiguous: "Can't tell",
};

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * Review before the league's own scores are written from the Team Rankings pool.
 *
 * A wrong score here is worse than a missing one: it becomes a standings table nobody can tell is
 * wrong. So every row is shown with what would happen to it, only the plainly empty games are
 * ticked to begin with, and a score that disagrees with one already entered has to be chosen
 * deliberately.
 */
export function LeagueScoreFillPanel({
  plan,
  seasonLabel,
  onApply,
  onClose,
}: LeagueScoreFillPanelProps) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(defaultFillSelection(plan)));

  const counts = useMemo(() => {
    const totals: Record<LeagueFillAction, number> = {
      fill: 0,
      suggested: 0,
      overwrite: 0,
      unchanged: 0,
      ambiguous: 0,
    };
    plan.rows.forEach((row) => {
      totals[row.action] += 1;
    });
    return totals;
  }, [plan.rows]);

  const toggle = (matchupId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(matchupId)) next.delete(matchupId);
      else next.add(matchupId);
      return next;
    });

  const selectable = (row: LeagueFillRow) => row.action !== "ambiguous";

  return (
    <div className={`${card} p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">
          Fill scores from Team Rankings
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="text-xs font-bold text-slate-500 hover:underline dark:text-slate-400"
        >
          Close
        </button>
      </div>

      {!plan.seasonLinked ? (
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          No age group claims <strong>{seasonLabel}</strong> yet, so there is nothing to read
          results from. In Team Rankings, edit the age group this season belongs to and tick this
          season in its list — the same link that already carries this schedule the other way.
        </p>
      ) : plan.rows.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Nothing to fill in yet.{" "}
          {plan.unmatched > 0
            ? `${plural(plan.unmatched, "game")} on this schedule ${plan.unmatched === 1 ? "has" : "have"} no result in the pool.`
            : ""}{" "}
          A GameChanger pull for the teams in this league is what puts results here.
        </p>
      ) : (
        <>
          <p className="mt-1 text-xs text-slate-500">
            Runs only — which is all the standings, the records and every projection are built from.
            Hits and strikeouts are never guessed, and a game that already has a score keeps it
            unless you say otherwise. A row marked <strong>Check name</strong> is a club the two
            halves spell differently; tick it once you have read the name, or correct the name in
            Team Rankings and it will match on its own from then on.
          </p>

          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="py-2">Fill</th>
                  <th>Date</th>
                  <th>Game</th>
                  <th>Score</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((row) => {
                  const canPick = selectable(row);
                  return (
                    <tr
                      key={row.matchupId}
                      className="border-t border-slate-100 align-top dark:border-slate-800"
                    >
                      <td className="py-2">
                        <input
                          type="checkbox"
                          checked={canPick && selected.has(row.matchupId)}
                          disabled={!canPick}
                          aria-label={`Fill ${displayName(row.awayName)} at ${displayName(row.homeName)}`}
                          onChange={() => toggle(row.matchupId)}
                        />
                      </td>
                      <td className="py-2 whitespace-nowrap text-slate-500">
                        {formatGameDate(row.date)}
                      </td>
                      <td className="py-2">
                        <span className="font-bold text-slate-950 dark:text-white">
                          {displayName(row.awayName)}
                        </span>
                        <span className="text-slate-500"> at </span>
                        <span className="font-bold text-slate-950 dark:text-white">
                          {displayName(row.homeName)}
                        </span>
                        {(row.poolAwayName || row.poolHomeName) && (
                          <span className="block text-[11px] text-slate-500">
                            In the pool:{" "}
                            {[row.poolAwayName ?? row.awayName, row.poolHomeName ?? row.homeName]
                              .map(displayName)
                              .join(" at ")}
                          </span>
                        )}
                        {row.event && (
                          <span className="ml-2 text-xs text-slate-500">{row.event}</span>
                        )}
                        {row.detail && (
                          <span className="block text-[11px] font-semibold text-amber-700 dark:text-amber-500">
                            {row.detail}
                          </span>
                        )}
                      </td>
                      <td className="py-2 whitespace-nowrap font-black text-slate-950 dark:text-white">
                        {row.action === "ambiguous" ? "—" : `${row.awayRuns}–${row.homeRuns}`}
                      </td>
                      <td className="py-2">
                        <span className={pill(ACTION_TONE[row.action])}>
                          {ACTION_LABEL[row.action]}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-xs text-slate-500">
            {counts.fill} to fill · {counts.suggested} to check · {counts.unchanged} already in ·{" "}
            {counts.overwrite} disagree · {counts.ambiguous} cannot be told apart
            {plan.unmatched > 0 ? ` · ${plan.unmatched} with no result yet` : ""}
            {plan.unusedResults > 0
              ? ` · ${plural(plan.unusedResults, "pool result")} not on this schedule`
              : ""}
            .
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onApply([...selected])}
              disabled={selected.size === 0}
              className={button.primary}
            >
              Fill {plural(selected.size, "game")}
            </button>
            <button type="button" onClick={onClose} className={button.ghost}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
