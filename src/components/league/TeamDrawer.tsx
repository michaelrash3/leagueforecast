/**
 * Everything about one team, opened over the table: its record and rate stats, its home/away
 * splits, how it has been playing lately, and what the model expects from the rest of its season.
 */
import React, { useEffect, useId, useRef, useState } from "react";
import { HelpTip } from "../HelpTip";
import { ProjectionExplanation } from "../ProjectionExplanation";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { formatGameDate } from "../../lib/date";
import { displayName, recordText } from "../../lib/format";
import {
  perGame,
  type LeagueAverageStats,
  type TeamSplitLine,
  type TeamSplitSummary,
} from "../../lib/teamStats";
import type { TeamTrendMetric, TeamTrendSummary } from "../../lib/teamTrend";
import type { PitchMode, SwingGame, TeamWithProjection } from "../../lib/types";
function DrawerMetric({ label, value }: { label: React.ReactNode; value: string | number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-700 dark:bg-slate-900">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="mt-1 text-lg font-black text-slate-950 dark:text-slate-100">{value}</div>
    </div>
  );
}

function SplitStatsTable({
  title,
  lines,
  side,
  pitchMode,
  trackErrors,
  runsOnly,
}: {
  title: string;
  lines: TeamSplitLine[];
  side: "offense" | "defense";
  pitchMode: PitchMode;
  trackErrors: boolean;
  runsOnly: boolean;
}) {
  // A runs-only league records neither hits nor the mode column, so the split
  // is runs per game and nothing else. One real column beats three empty ones.
  const showHitsColumn = !runsOnly;
  // The kid-pitch defensive column is E/G, which is empty when errors are not scored.
  const showModeColumn =
    !runsOnly && !(pitchMode === "player" && side === "defense" && !trackErrors);

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xs dark:border-slate-700 dark:bg-slate-900">
      <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
        <h4 className="text-sm font-bold tracking-tight text-slate-950 dark:text-slate-100">
          {title}
        </h4>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-4 py-2">Split</th>
              <th className="px-3 py-2 text-center">G</th>
              <th className="px-3 py-2 text-center">R/G</th>
              {showHitsColumn && <th className="px-3 py-2 text-center">H/G</th>}
              {showModeColumn && (
                <th className="px-3 py-2 text-center">
                  {pitchMode === "player" ? (side === "offense" ? "BB/G" : "E/G") : "K/G"}
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-800 dark:divide-slate-800 dark:text-slate-100">
            {lines.map((line) => (
              <tr key={`${title}-${line.label}`}>
                <td className="px-4 py-3 font-black">{line.label}</td>
                <td className="px-3 py-3 text-center font-bold">{line.games}</td>
                <td className="px-3 py-3 text-center font-bold">
                  {perGame(line[side].runs, line.games)}
                </td>
                {showHitsColumn && (
                  <td className="px-3 py-3 text-center font-bold">
                    {perGame(line[side].hits, line.games)}
                  </td>
                )}
                {showModeColumn && (
                  <td className="px-3 py-3 text-center font-bold">
                    {pitchMode === "player"
                      ? perGame(
                          side === "offense" ? line.offense.walks : line.defense.errors,
                          line.games
                        )
                      : perGame(line[side].strikeouts, line.games)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TeamStatTrendSparkline({
  values,
  lowerIsBetter,
}: {
  values: number[];
  lowerIsBetter: boolean;
}) {
  if (!values.length) return <span className="text-slate-500">—</span>;

  const width = 130;
  const height = 34;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(max - min, 1);
  const seed = values[0] ?? 0;
  const data = values.length === 1 ? [seed, seed] : values;
  const points = data
    .map((value, index) => {
      const x = (index / Math.max(data.length - 1, 1)) * width;
      const y = height - ((value - min) / spread) * height;
      return `${x},${y}`;
    })
    .join(" ");
  const first = data[0] ?? 0;
  const last = data[data.length - 1] ?? 0;
  const improved = lowerIsBetter ? last < first : last > first;
  const tone = improved
    ? "stroke-emerald-500"
    : last === first
      ? "stroke-slate-500"
      : "stroke-amber-500";

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
      role="img"
      aria-label={`Trend from ${first.toFixed(1)} to ${last.toFixed(1)}.`}
    >
      <title>{`Game-by-game trend: ${first.toFixed(1)} to ${last.toFixed(1)}.`}</title>
      <polyline
        points={points}
        fill="none"
        className={tone}
        strokeWidth="2.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={width}
        cy={height - ((last - min) / spread) * height}
        r="3.5"
        className={tone.replace("stroke", "fill")}
      />
    </svg>
  );
}

function TeamTrendPanel({ trend }: { trend: TeamTrendSummary }) {
  const formatDelta = (metric: TeamTrendMetric) => {
    if (metric.delta === null) return "—";
    const value = Math.abs(metric.delta).toFixed(1);
    if (Math.abs(metric.delta) < 0.05) return "even";
    const better = metric.direction === "higher" ? metric.delta > 0 : metric.delta < 0;
    return `${better ? "+" : "−"}${value} ${better ? "better" : "worse"}`;
  };

  const statusClass = (status: TeamTrendMetric["status"]) =>
    status === "Hot"
      ? "bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:ring-emerald-800"
      : status === "Cold"
        ? "bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:ring-amber-800"
        : "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700";

  return (
    <section className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-slate-950 text-white shadow-xs dark:border-slate-700">
      <div className="relative isolate p-4">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.25),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.22),transparent_42%)]" />
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-amber-200">
              Current Form
            </div>
            <h3 className="text-xl font-black tracking-tight">{trend.headline}</h3>
          </div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-300">
            Last {trend.recentWindow || 0} vs season
          </div>
        </div>
      </div>

      <div className="grid gap-3 bg-white p-3 text-slate-950 dark:bg-slate-900 dark:text-slate-100">
        {trend.metrics.map((metric) => (
          <article
            key={metric.key}
            className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-bold tracking-tight">{metric.label}</div>
                <div className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">
                  Season {metric.season?.toFixed(1) ?? "—"} {metric.shortLabel} · Recent{" "}
                  {metric.recent?.toFixed(1) ?? "—"}
                </div>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ring-1 ${statusClass(
                  metric.status
                )}`}
              >
                {metric.status}
              </span>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <TeamStatTrendSparkline
                values={metric.values}
                lowerIsBetter={metric.direction === "lower"}
              />
              <div className="text-right text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {formatDelta(metric)}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

// ---------- TeamDrawer (a11y modal) ----------

/**
 * Corrects a team's name in place. Only the label changes: a team's id is fixed at creation and is
 * what every game, score and standing hangs off, so a typo can be fixed at any point in a season
 * without disturbing a single result.
 */
function TeamNameEditor({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputId = useId();

  // Follow the name from outside while closed, so reopening never shows a stale draft.
  const [lastName, setLastName] = useState(name);
  if (lastName !== name) {
    setLastName(name);
    setDraft(name);
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="mt-1 text-xs font-bold text-blue-600 hover:underline dark:text-blue-400"
      >
        Rename
      </button>
    );
  }

  const commit = () => {
    const next = draft.trim();
    if (next && next !== name) onRename(next);
    setEditing(false);
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={inputId}>
        Team name
      </label>
      <input
        id={inputId}
        type="text"
        value={draft}
        autoFocus
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") {
            setDraft(name);
            setEditing(false);
          }
        }}
        className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold dark:border-slate-600 dark:bg-slate-800"
      />
      <button
        type="button"
        onClick={commit}
        className="text-xs font-bold text-emerald-600 hover:underline dark:text-emerald-400"
      >
        Save
      </button>
      <button
        type="button"
        onClick={() => {
          setDraft(name);
          setEditing(false);
        }}
        className="text-xs font-bold text-slate-500 hover:underline dark:text-slate-400"
      >
        Cancel
      </button>
    </div>
  );
}

export function TeamDrawer({
  team,
  range,
  bubble,
  currentSosRank,
  sos,
  swings,
  clinchScenarios,
  titleRace,
  goldPctLabel,
  cutoff,
  onClose,
  magicForGold,
  eliminationNumber,
  splitSummary,
  trendSummary,
  onCompare,
  leagueAverageStats,
  pitchMode,
  trackErrors,
  runsOnly,
  hasCutLine,
  projectionExplanations,
  onRename,
}: {
  team: TeamWithProjection;
  range: { best: number; worst: number; baseline: number };
  bubble: string;
  currentSosRank: number | null;
  sos: { label: string; rating: number; opponents: string };
  swings: SwingGame[];
  clinchScenarios: string[];
  titleRace: string;
  goldPctLabel: string;
  cutoff: number;
  onClose: () => void;
  /** Correcting a name here changes the label only — the team's id, games and scores are its own. */
  onRename: (name: string) => void;
  magicForGold: import("../../lib/magic").MagicResult;
  eliminationNumber: import("../../lib/magic").MagicResult;
  splitSummary: TeamSplitSummary;
  trendSummary: TeamTrendSummary;
  onCompare: () => void;
  leagueAverageStats: LeagueAverageStats;
  pitchMode: PitchMode;
  trackErrors: boolean;
  runsOnly: boolean;
  hasCutLine: boolean;
  projectionExplanations: string[];
}) {
  const ref = useRef<HTMLElement>(null);
  const titleId = useId();
  useFocusTrap(true, ref as React.RefObject<HTMLElement>);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/40 p-3"
      onClick={onClose}
      role="presentation"
    >
      {/* Stop click + keydown propagation so the backdrop's onClose doesn't fire from inside the dialog. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <aside
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="h-full w-full max-w-md overflow-y-auto rounded-lg bg-white p-6 shadow-2xl outline-hidden dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Team Detail
            </div>
            <h2
              id={titleId}
              className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-slate-100"
            >
              {displayName(team.name)}
            </h2>
            <TeamNameEditor name={team.name} onRename={onRename} />
            <div className="mt-2 text-sm font-bold text-slate-500 dark:text-slate-400">
              Current #{team.rank} · Projected #{team.projectedRank}
              {hasCutLine ? ` · Top ${cutoff} Gold Bracket` : ""}
            </div>
            {projectionExplanations.length > 0 && (
              <div className="mt-3 rounded-lg border-l-2 border-blue-400 bg-blue-50 py-1 pl-3 pr-2 dark:border-blue-500 dark:bg-blue-950/30">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-300">
                  Since the last update
                </div>
                <ProjectionExplanation explanations={projectionExplanations} />
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={onCompare}
              className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950"
            >
              Compare
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Close
            </button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <DrawerMetric label="Record" value={recordText(team)} />
          {hasCutLine && <DrawerMetric label="Gold %" value={goldPctLabel} />}
          <DrawerMetric label="Range" value={`#${range.best}–#${range.worst}`} />
          {hasCutLine && <DrawerMetric label="Bubble" value={bubble} />}
          <DrawerMetric label="Runs/Game" value={team.rsg.toFixed(1)} />
          {/* Everything below runs is only ever entered under the full box score. */}
          {!runsOnly && (
            <>
              <DrawerMetric label="Hits/Game" value={team.hpg.toFixed(1)} />
              {pitchMode === "player" ? (
                <>
                  {trackErrors && (
                    <DrawerMetric
                      label="Errors/Game"
                      value={(team.errorsPerGame ?? 0).toFixed(1)}
                    />
                  )}
                  <DrawerMetric
                    label="BB/Game"
                    value={(team.walksReceivedPerGame ?? 0).toFixed(1)}
                  />
                </>
              ) : (
                <>
                  <DrawerMetric label="K/Game" value={team.kpg.toFixed(1)} />
                  <DrawerMetric label="Opp K/Game" value={team.oppKpg.toFixed(1)} />
                </>
              )}
            </>
          )}
          <DrawerMetric
            label="Lg Avg R/G"
            value={perGame(leagueAverageStats.runs, leagueAverageStats.teamGames)}
          />
          {!runsOnly && (
            <DrawerMetric
              label="Lg Avg H/G"
              value={perGame(leagueAverageStats.hits, leagueAverageStats.teamGames)}
            />
          )}
          {!runsOnly && (pitchMode !== "player" || trackErrors) && (
            <DrawerMetric
              label={pitchMode === "player" ? "Lg Avg E/G" : "Lg Avg K/G"}
              value={
                pitchMode === "player"
                  ? perGame(leagueAverageStats.errors, leagueAverageStats.teamGames)
                  : perGame(leagueAverageStats.strikeouts, leagueAverageStats.teamGames)
              }
            />
          )}
          <DrawerMetric label="Current SOS" value={currentSosRank ? `#${currentSosRank}` : "—"} />
          <DrawerMetric label="Remaining SOS" value={sos.label} />
          {titleRace && <DrawerMetric label="Title Race" value={titleRace} />}
        </div>

        <TeamTrendPanel trend={trendSummary} />

        <section className="mt-6 space-y-3">
          <div>
            <h3 className="font-black tracking-tight text-slate-950 dark:text-slate-100">
              Team Stats Splits
            </h3>
          </div>
          <SplitStatsTable
            title="Offensive Splits"
            side="offense"
            trackErrors={trackErrors}
            runsOnly={runsOnly}
            lines={[splitSummary.all, splitSummary.home, splitSummary.away]}
            pitchMode={pitchMode}
          />
          <SplitStatsTable
            title="Defensive Splits"
            side="defense"
            trackErrors={trackErrors}
            runsOnly={runsOnly}
            lines={[splitSummary.all, splitSummary.home, splitSummary.away]}
            pitchMode={pitchMode}
          />
        </section>

        {hasCutLine && (
          <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-700 dark:bg-slate-900">
            <h3 className="font-black tracking-tight text-slate-950 dark:text-slate-100">
              Magic Numbers
              <HelpTip title="Magic & Elimination Numbers">
                <strong>Magic number (M)</strong> is the combined total of wins by this team plus
                losses by rivals that guarantees a Gold Bracket spot.{" "}
                <strong>Elimination number (E)</strong> is the combined total of losses and rival
                wins that would end its Gold chances. Reaching either clinches or eliminates
                regardless of other results.
              </HelpTip>
            </h3>
            <ul className="mt-2 space-y-2 text-sm font-bold text-slate-700 dark:text-slate-200">
              <li>
                <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  M (Gold clinch)
                </span>
                <div className="text-sm font-bold leading-snug">{magicForGold.description}</div>
              </li>
              <li>
                <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  E (Gold elimination)
                </span>
                <div className="text-sm font-bold leading-snug">
                  {eliminationNumber.description}
                </div>
              </li>
            </ul>
          </section>
        )}

        {hasCutLine && (
          <section className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
            <h3 className="font-black tracking-tight text-slate-950 dark:text-slate-100">
              Clinch Scenarios
            </h3>
            <div className="mt-3 space-y-2">
              {clinchScenarios.map((scenario) => (
                <div
                  key={scenario}
                  className="rounded-lg bg-white p-3 text-sm font-bold leading-6 text-slate-600 shadow-xs ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700"
                >
                  {scenario}
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="mt-6">
          <h3 className="font-black tracking-tight text-slate-950 dark:text-slate-100">
            Next Two Games
          </h3>
          <div className="mt-3 space-y-3">
            {swings.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-800/40 p-5 text-sm font-bold text-slate-500 dark:text-slate-400">
                No remaining games for this team.
              </div>
            ) : (
              swings.map((swing) => (
                <div
                  key={swing.game.id}
                  className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-700 dark:bg-slate-900"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-black text-slate-950 dark:text-slate-100">
                      {swing.teamIsAway ? "at" : "vs"} {swing.opponentName}
                    </div>
                    <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                      {formatGameDate(swing.game.date)}
                    </div>
                  </div>
                  <div className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">
                    Model: {swing.modelPick} · {Math.round(swing.winPct * 100)}% team win chance
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-semibold">
                    <div className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                      Win: #{swing.winSeed}
                    </div>
                    <div className="rounded-lg bg-red-50 px-3 py-2 text-red-700 dark:bg-red-950/40 dark:text-red-300">
                      Loss: #{swing.lossSeed}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </aside>
    </div>
  );
}
