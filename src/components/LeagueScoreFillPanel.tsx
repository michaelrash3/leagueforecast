import { useMemo, useState } from "react";
import {
  defaultFillSelection,
  movedGames,
  type FillAdditions,
  type LeagueFillAction,
  type LeagueFillPlan,
  type LeagueFillRow,
  type RecordedRuns,
} from "../lib/leagueScoreFill";
import type { Matchup } from "../lib/types";
import { formatGameDate } from "../lib/date";
import { displayName } from "../lib/format";
import { button, card, pill } from "../styles/tokens";

type LeagueScoreFillPanelProps = {
  plan: LeagueFillPlan;
  /** The season being filled, named the way the header names it. */
  seasonLabel: string;
  /**
   * The rows to fill, those of them to fill with the other club's version of the score, and the
   * games between the league's clubs to add to the schedule.
   */
  onApply: (matchupIds: string[], otherVersion: string[], additions?: FillAdditions) => void;
  onClose: () => void;
  /** The schedule and its scores, for the games played on another day than scheduled. */
  schedule?: readonly Matchup[];
  logs?: Readonly<Record<string, RecordedRuns>>;
};

const ACTION_TONE: Record<LeagueFillAction, "emerald" | "blue" | "amber" | "neutral" | "red"> = {
  fill: "emerald",
  suggested: "blue",
  slot: "blue",
  disputed: "amber",
  overwrite: "amber",
  unchanged: "neutral",
  ambiguous: "red",
};

const ACTION_LABEL: Record<LeagueFillAction, string> = {
  fill: "Fill",
  suggested: "Check name",
  slot: "Check opponent",
  disputed: "Check score",
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
  schedule,
  logs,
}: LeagueScoreFillPanelProps) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(defaultFillSelection(plan)));
  /** Rows to fill with the other club's version of the score, where the two schedules differ. */
  const [otherVersion, setOtherVersion] = useState<Set<string>>(() => new Set());

  const missing = plan.missing ?? [];
  // A missing game that is the schedule's own, played on another day: moved, not added (on the
  // device, from the answer already here).
  // A game ticked to fill is no make-up, so ticking a looser match takes its move away.
  const moved = useMemo(
    () =>
      new Map(
        movedGames(plan, schedule ?? [], logs ?? {}, selected).map((move) => [
          move.scoutGameId,
          move,
        ])
      ),
    [plan, schedule, logs, selected]
  );
  // Games between the league's clubs to add: every one but a likely tournament meeting, to begin.
  const [adding, setAdding] = useState<Set<string>>(
    () => new Set(missing.filter((game) => !game.tournament).map((game) => game.scoutGameId))
  );
  const [turned, setTurned] = useState<Set<string>>(() => new Set());
  const flip = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const counts = useMemo(() => {
    const totals: Record<LeagueFillAction, number> = {
      fill: 0,
      suggested: 0,
      slot: 0,
      disputed: 0,
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

  const chooseVersion = (matchupId: string, other: boolean) =>
    setOtherVersion((prev) => {
      const next = new Set(prev);
      if (other) next.add(matchupId);
      else next.delete(matchupId);
      return next;
    });

  const missingSection =
    missing.length > 0 ? (
      <div className="mt-4">
        <h3 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Games between the league&rsquo;s clubs not on this schedule
        </h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Played between two of the clubs this season&rsquo;s teams are linked to, on a day this
          schedule has them meet nowhere. Ticked ones are added with their score, final. A game that
          looks like a tournament&rsquo;s is left unticked, and GameChanger&rsquo;s schedules do not
          say who was at home, so swap any that are the other way round.
        </p>
        <ul aria-label="Games not on this schedule" className="mt-2 grid gap-1">
          {missing.map((game) => {
            const swap = turned.has(game.scoutGameId);
            const [away, home] = swap
              ? [game.homeName, game.awayName]
              : [game.awayName, game.homeName];
            const [awayRuns, homeRuns] = swap
              ? [game.homeRuns, game.awayRuns]
              : [game.awayRuns, game.homeRuns];
            const label = `${displayName(away)} at ${displayName(home)}, ${game.date}`;
            const move = moved.get(game.scoutGameId);
            return (
              <li key={game.scoutGameId} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <input
                  type="checkbox"
                  checked={adding.has(game.scoutGameId)}
                  onChange={() => setAdding((prev) => flip(prev, game.scoutGameId))}
                  aria-label={`Add ${label}`}
                />
                <span className="font-bold tabular-nums">{game.date}</span>
                <span>
                  {displayName(away)} {awayRuns}, {displayName(home)} {homeRuns}
                </span>
                {move ? (
                  <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                    Moved {move.from} → {move.to}: the schedule&rsquo;s game, moved and filled
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setTurned((prev) => flip(prev, game.scoutGameId))}
                    aria-label={`Swap home and away for ${label}`}
                    className="text-xs font-bold text-blue-700 underline dark:text-blue-300"
                  >
                    Swap
                  </button>
                )}
                {game.tournament && (
                  <span className="basis-full text-xs text-slate-500 dark:text-slate-400">
                    {game.tournament}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    ) : null;
  const additions = (): FillAdditions => {
    const move = missing
      .map((game) => game.scoutGameId)
      .filter((id) => adding.has(id) && moved.has(id));
    return {
      add: missing.map((game) => game.scoutGameId).filter((id) => adding.has(id)),
      swap: missing
        .map((game) => game.scoutGameId)
        .filter((id) => adding.has(id) && turned.has(id)),
      ...(move.length > 0 ? { move } : {}),
    };
  };
  const applyLabel =
    adding.size === 0
      ? `Fill ${plural(selected.size, "game")}`
      : selected.size === 0
        ? `Add ${plural(adding.size, "game")}`
        : `Fill ${plural(selected.size, "game")} and add ${adding.size}`;

  return (
    <div className={`${card} p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
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
        <>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Nothing to fill in yet.{" "}
            {plan.unmatched > 0
              ? `${plural(plan.unmatched, "game")} on this schedule ${plan.unmatched === 1 ? "has" : "have"} no result in the pool.`
              : ""}{" "}
            A GameChanger pull for the teams in this league is what puts results here.
          </p>
          {missingSection}
          {missing.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onApply([], [], additions())}
                disabled={adding.size === 0}
                className={button.primary}
              >
                {applyLabel}
              </button>
              <button type="button" onClick={onClose} className={button.ghost}>
                Cancel
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Runs only — which is all the standings, the records and every projection are built from.
            Hits and strikeouts are never guessed, and a game that already has a score keeps it
            unless you say otherwise. A row marked <strong>Check name</strong> is a club the two
            halves spell differently; tick it once you have read the name, or correct the name in
            Team Rankings and it will match on its own from then on. <strong>Check opponent</strong>{" "}
            is a club&rsquo;s own game against a slot such as “TBD”, on the day of its only league
            game; <strong>Check score</strong> is a game the two clubs&rsquo; own schedules give
            different winners. Where the two schedules differ, pick whose score to fill.
          </p>

          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
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
                      <td className="py-2 whitespace-nowrap text-slate-500 dark:text-slate-400">
                        {formatGameDate(row.date)}
                      </td>
                      <td className="py-2">
                        <span className="font-bold text-slate-950 dark:text-white">
                          {displayName(row.awayName)}
                        </span>
                        <span className="text-slate-500 dark:text-slate-400"> at </span>
                        <span className="font-bold text-slate-950 dark:text-white">
                          {displayName(row.homeName)}
                        </span>
                        {(row.poolAwayName || row.poolHomeName) && (
                          <span className="block text-xs text-slate-500 dark:text-slate-400">
                            In the pool:{" "}
                            {[row.poolAwayName ?? row.awayName, row.poolHomeName ?? row.homeName]
                              .map(displayName)
                              .join(" at ")}
                          </span>
                        )}
                        {row.event && (
                          <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                            {row.event}
                          </span>
                        )}
                        {row.detail && (
                          <span className="block text-xs font-semibold text-amber-700 dark:text-amber-500">
                            {row.detail}
                          </span>
                        )}
                      </td>
                      <td className="py-2 whitespace-nowrap font-black text-slate-950 dark:text-white">
                        {row.action === "ambiguous" ? (
                          "—"
                        ) : row.alternative && canPick && row.action !== "unchanged" ? (
                          <fieldset>
                            <legend className="sr-only">
                              Whose score for {displayName(row.awayName)} at{" "}
                              {displayName(row.homeName)}
                            </legend>
                            {[
                              { other: false, runs: row, by: row.reportedBy ?? "" },
                              {
                                other: true,
                                runs: row.alternative,
                                by: row.alternative.reportedBy,
                              },
                            ].map((version) => (
                              <label key={String(version.other)} className="block">
                                <input
                                  type="radio"
                                  name={`version-${row.matchupId}`}
                                  checked={otherVersion.has(row.matchupId) === version.other}
                                  onChange={() => chooseVersion(row.matchupId, version.other)}
                                />{" "}
                                {version.runs.awayRuns}–{version.runs.homeRuns}{" "}
                                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                                  {displayName(version.by)}
                                </span>
                              </label>
                            ))}
                          </fieldset>
                        ) : (
                          `${row.awayRuns}–${row.homeRuns}`
                        )}
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

          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            {counts.fill} to fill · {counts.suggested + counts.slot} to check · {counts.disputed}{" "}
            the clubs dispute · {counts.unchanged} already in · {counts.overwrite} disagree ·{" "}
            {counts.ambiguous} cannot be told apart
            {plan.unmatched > 0 ? ` · ${plan.unmatched} with no result yet` : ""}
            {plan.unusedResults > 0
              ? ` · ${plural(plan.unusedResults, "pool result")} not on this schedule`
              : ""}
            .
          </p>

          {missingSection}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                onApply(
                  [...selected],
                  [...otherVersion].filter((matchupId) => selected.has(matchupId)),
                  ...(adding.size > 0 ? [additions()] : [])
                )
              }
              disabled={selected.size === 0 && adding.size === 0}
              className={button.primary}
            >
              {applyLabel}
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
