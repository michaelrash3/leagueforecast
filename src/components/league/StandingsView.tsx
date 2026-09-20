/**
 * The table people actually come for: where everyone stands, where the model thinks they finish,
 * and what the last result changed.
 *
 * Lifted out of App.tsx unchanged. It reads only its props; what kept it there was a handful of
 * helpers that lived in App — the race tones, the sparkline, the shape of an impact — which have
 * moved somewhere both can reach.
 */
import React from "react";
import { displayName, recordText, teamAbbr, winPct } from "../../lib/format";
import type { LeagueSummaryErrorReason } from "../../lib/leagueSummary";
import { buildTeamDataHref } from "../../lib/teamLink";
import type { LastImpact, TeamWithProjection } from "../../lib/types";
import { AiStoryPanel } from "../AiStoryPanel";
import { HelpTip } from "../HelpTip";
import { ProjectionExplanation } from "../ProjectionExplanation";
import { Sparkline } from "../Sparkline";
import {
  raceRowToneClasses,
  raceSeedBadgeClasses,
  raceToneForTeam,
  raceToneLabels,
} from "../../styles/raceTone";
import { focusRing, pill } from "../../styles/tokens";

export function StandingsView({
  goldCutoff,
  latestCompletedDate,
  lastImpact,
  dismissImpact,
  copyRecap,
  copyStory,
  dashboardRows,
  hasCutLine,
  storyText,
  storySource,
  storyModel,
  storyLoading,
  storyUnavailableReason,
  storyErrorMessage,
  retryStory,
  storyWaiting,
  askStory,
  currentSosRanks,
  statusClass,
  statusLabel,
  formatGoldPct,
  formatGoldMargin,
  onSelectTeam,
}: {
  goldCutoff: number;
  latestCompletedDate: string;
  lastImpact: LastImpact | null;
  dismissImpact: () => void;
  copyRecap: () => void;
  copyStory: () => void;
  dashboardRows: TeamWithProjection[];
  /** False when the league has no cut line, so Gold odds and status are meaningless. */
  hasCutLine: boolean;
  /** Gemini story when one arrived, otherwise the deterministic one. */
  storyText: string;
  storySource: "gemini" | "local";
  storyModel: string;
  storyLoading: boolean;
  storyUnavailableReason: LeagueSummaryErrorReason | null;
  storyErrorMessage: string;
  retryStory: () => void;
  storyWaiting: boolean;
  askStory: () => void;
  currentSosRanks: Record<string, number>;
  statusClass: (t: TeamWithProjection) => string;
  statusLabel: (t: TeamWithProjection) => string;
  formatGoldPct: (t: TeamWithProjection) => string;
  formatGoldMargin: (t: TeamWithProjection) => string;
  onSelectTeam: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-6">
      <section>
        <h2 className="text-2xl font-black tracking-tight text-slate-950 dark:text-slate-100">
          Standings
          <HelpTip title="Reading the table">
            {hasCutLine && (
              <>
                <strong>Gold %</strong> is the simulated chance of finishing in the top {goldCutoff}{" "}
                (the Gold Bracket), from thousands of season simulations.{" "}
              </>
            )}
            <strong>SOS</strong> is strength of schedule — a lower rank means tougher opponents.{" "}
            <strong>Diff</strong> is run differential (runs scored minus runs allowed).
          </HelpTip>
        </h2>
        <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
          Updated through {latestCompletedDate}.
        </p>
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xs dark:border-slate-700 dark:bg-slate-900">
        {lastImpact && (
          <div className="border-b border-slate-200 bg-blue-50 px-5 py-4 dark:border-slate-700 dark:bg-slate-800/50">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-400">
                  Impact Since Last Update
                </div>
                <div className="text-sm font-bold text-slate-950 dark:text-slate-100">
                  {lastImpact.title}
                </div>
              </div>
              <div className="flex gap-2">
                {lastImpact.recapItems.length > 0 && (
                  <button
                    type="button"
                    onClick={copyStory}
                    className="rounded-full bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white shadow-xs hover:bg-blue-500"
                  >
                    Copy Story
                  </button>
                )}
                {lastImpact.recapItems.length > 0 && (
                  <button
                    type="button"
                    onClick={copyRecap}
                    className="rounded-full bg-slate-950 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white shadow-xs hover:bg-slate-800 dark:bg-white dark:text-slate-950"
                  >
                    Copy Recap
                  </button>
                )}
                <button
                  type="button"
                  onClick={dismissImpact}
                  className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 shadow-xs ring-1 ring-blue-100 hover:text-slate-950 dark:bg-slate-900 dark:text-slate-400 dark:ring-slate-700"
                >
                  Dismiss
                </button>
              </div>
            </div>
            {lastImpact.scores.length > 0 && (
              <div className="mb-3 rounded-lg bg-white p-3 shadow-xs ring-1 ring-blue-100 dark:bg-slate-900 dark:ring-slate-700">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Final Scores
                </div>
                <div className="flex flex-wrap gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
                  {lastImpact.scores.map((score) => (
                    <span
                      key={score}
                      className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800 dark:text-slate-200"
                    >
                      {score}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {lastImpact.recapItems.length > 0 ? (
              <>
                <AiStoryPanel
                  title="League Story"
                  text={storyText}
                  source={storySource}
                  model={storyModel}
                  loading={storyLoading}
                  unavailableReason={storyUnavailableReason}
                  errorMessage={storyErrorMessage}
                  onRetry={retryStory}
                  waiting={storyWaiting}
                  onAsk={askStory}
                />
                <ul className="space-y-2 text-xs font-semibold text-blue-800 dark:text-blue-300">
                  {lastImpact.recapItems.map((item) => (
                    <li
                      key={item.text}
                      className="rounded-lg bg-white px-3 py-2 shadow-xs ring-1 ring-blue-100 dark:bg-slate-900 dark:ring-slate-700"
                    >
                      <span>{item.text}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="flex flex-wrap gap-2 text-xs font-semibold text-blue-700 dark:text-blue-300">
                {lastImpact.messages.map((change) => (
                  <span
                    key={change}
                    className="rounded-full bg-white px-3 py-1 shadow-xs ring-1 ring-blue-100 dark:bg-slate-900 dark:ring-slate-700"
                  >
                    {change}
                  </span>
                ))}
              </div>
            )}
            {lastImpact.projectionExplanations && lastImpact.projectionExplanations.length > 0 && (
              <div className="mt-3 rounded-lg bg-white p-3 shadow-xs ring-1 ring-blue-100 dark:bg-slate-900 dark:ring-slate-700">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Why projections moved
                </div>
                <div className="space-y-2">
                  {lastImpact.projectionExplanations.slice(0, 5).map((entry) => (
                    <div key={entry.teamId}>
                      <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                        {entry.teamName}
                      </div>
                      <ProjectionExplanation explanations={entry.items} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {hasCutLine && (
          <div className="border-b border-slate-200 bg-white/80 px-5 py-3 dark:border-slate-700 dark:bg-slate-900/70">
            <div className="flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-wide">
              <span className="rounded-full bg-slate-950 px-3 py-1 text-white dark:bg-white dark:text-slate-950">
                Clinched
              </span>
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                Safe
              </span>
              <span className="rounded-full bg-blue-100 px-3 py-1 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
                Inside Cut
              </span>
              <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                Bubble
              </span>
              <span className="rounded-full bg-orange-100 px-3 py-1 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300">
                Chasing
              </span>
              <span className="rounded-full bg-red-100 px-3 py-1 text-red-700 dark:bg-red-950/50 dark:text-red-300">
                Out
              </span>
            </div>
          </div>
        )}

        {dashboardRows.length === 0 ? (
          <div className="p-8 text-center text-sm font-bold text-slate-500 dark:text-slate-400">
            No final results yet. Mark a game Final in the Schedule tab to populate standings.
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left">
                <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                  <tr>
                    <th className="px-5 py-3">Seed</th>
                    <th className="px-5 py-3">Team</th>
                    <th className="px-4 py-3 text-center">Record</th>
                    <th className="px-4 py-3 text-center">Diff</th>
                    <th className="px-4 py-3 text-center">SOS</th>
                    {hasCutLine && (
                      <>
                        <th className="px-4 py-3 text-center">Gold %</th>
                        <th className="px-4 py-3 text-center">Playoff Status</th>
                        <th className="px-4 py-3 text-center" title="Gold % trend.">
                          Trend (Gold %)
                        </th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {dashboardRows.map((team, index) => {
                    const raceTone = raceToneForTeam(team, goldCutoff);
                    return (
                      <React.Fragment key={team.id}>
                        {hasCutLine && index === goldCutoff && (
                          <tr
                            key="cut-line"
                            // eslint-disable-next-line jsx-a11y/no-interactive-element-to-noninteractive-role
                            role="separator"
                            aria-label={`Gold cut line: top ${goldCutoff} teams qualify`}
                          >
                            <td
                              colSpan={8}
                              className="bg-slate-950 px-5 py-2 text-center text-xs font-semibold uppercase tracking-[0.22em] text-red-400 dark:bg-black"
                            >
                              Gold Cut Line
                            </td>
                          </tr>
                        )}
                        <tr
                          className={`text-slate-800 ring-1 ring-inset transition hover:brightness-[0.98] dark:text-slate-100 dark:hover:brightness-110 ${raceRowToneClasses[raceTone]}`}
                        >
                          <td className="px-5 py-4 font-black">
                            <span
                              className={`rounded-full px-3 py-1 text-xs ${raceSeedBadgeClasses[raceTone]}`}
                              title={raceToneLabels[raceTone]}
                            >
                              #{team.rank}
                              <span className="sr-only"> · {raceToneLabels[raceTone]}</span>
                            </span>
                          </td>
                          <td className="px-5 py-4">
                            <a
                              href={buildTeamDataHref(team.id)}
                              onClick={(event) => {
                                event.preventDefault();
                                onSelectTeam(team.id);
                              }}
                              className={`-m-1 flex items-center gap-3 rounded-lg p-1 text-left ${focusRing}`}
                              aria-label={`View stats for ${displayName(team.name)}`}
                            >
                              <span
                                className={`flex h-9 w-9 items-center justify-center rounded-lg text-xs font-black shadow-xs ${raceSeedBadgeClasses[raceTone]}`}
                              >
                                {teamAbbr(team.name)}
                              </span>
                              <span
                                className="font-black tracking-tight text-blue-700 underline decoration-blue-300 underline-offset-4 hover:text-blue-500 dark:text-blue-300 dark:decoration-blue-700 dark:hover:text-blue-200"
                                title={team.name}
                              >
                                {displayName(team.name)}
                              </span>
                            </a>
                          </td>
                          <td className="px-4 py-4 text-center font-black text-slate-800 dark:text-slate-100">
                            {recordText(team)}
                          </td>
                          <td
                            className={`px-4 py-4 text-center font-black ${
                              team.runDiff > 0
                                ? "text-emerald-600 dark:text-emerald-400"
                                : team.runDiff < 0
                                  ? "text-red-600 dark:text-red-400"
                                  : "text-slate-500 dark:text-slate-400"
                            }`}
                          >
                            {team.runDiff > 0 ? "+" : ""}
                            {team.runDiff}
                          </td>
                          <td className="px-4 py-4 text-center">
                            <span
                              title={`Current SOS: ${team.sos.toFixed(2)}. Rank is based on opponents already played.`}
                              className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                            >
                              #{currentSosRanks[team.id] || "—"}
                            </span>
                          </td>
                          {hasCutLine && (
                            <>
                              <td className="px-4 py-4 text-center">
                                <span
                                  className={
                                    team.goldPct >= 75
                                      ? pill("emerald")
                                      : team.goldPct >= 40
                                        ? pill("blue")
                                        : pill("neutral")
                                  }
                                >
                                  {formatGoldPct(team)}
                                </span>
                                <div className="mt-1 text-[10px] font-bold text-slate-500 dark:text-slate-400">
                                  {formatGoldMargin(team)} sim. error
                                </div>
                              </td>
                              <td className="px-4 py-4 text-center">
                                <span
                                  title={
                                    team.goldStatus === "Eliminated"
                                      ? `${displayName(team.name)} can finish no higher than ${winPct(team.maxPct)}, and ${team.blockersAhead} team${team.blockersAhead === 1 ? "" : "s"} cannot finish below that however the rest of the season goes.`
                                      : team.goldStatus === "Clinched"
                                        ? `${displayName(team.name)} have mathematically secured a Top ${goldCutoff} spot even if they lose out.`
                                        : `${displayName(team.name)} are still mathematically live for the Top ${goldCutoff}.`
                                  }
                                  aria-label={`Playoff status: ${statusLabel(team)}`}
                                  className={`rounded-full px-3 py-1 text-xs font-black ${statusClass(team)}`}
                                >
                                  {statusLabel(team)}
                                </span>
                              </td>
                              <td className="px-4 py-4 text-center">
                                <Sparkline values={team.goldTrend} />
                              </td>
                            </>
                          )}
                        </tr>
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="hidden px-5 pb-4 text-[11px] font-bold text-slate-500 md:block dark:text-slate-400"></div>

            {/* Mobile cards */}
            <ul className="divide-y divide-slate-100 md:hidden dark:divide-slate-800">
              {dashboardRows.map((team, index) => {
                const isLastInside = hasCutLine && index + 1 === goldCutoff;
                const raceTone = raceToneForTeam(team, goldCutoff);
                return (
                  <li key={team.id} className={`ring-1 ring-inset ${raceRowToneClasses[raceTone]}`}>
                    <div className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
                      <a
                        href={buildTeamDataHref(team.id)}
                        onClick={(event) => {
                          event.preventDefault();
                          onSelectTeam(team.id);
                        }}
                        className={`flex min-w-0 items-center gap-3 rounded-lg text-left ${focusRing}`}
                        aria-label={`View stats for ${displayName(team.name)}`}
                      >
                        <span
                          className={`rounded-full px-2 py-1 text-right text-xs font-black ${raceSeedBadgeClasses[raceTone]}`}
                          title={raceToneLabels[raceTone]}
                        >
                          #{team.rank}
                          <span className="sr-only"> · {raceToneLabels[raceTone]}</span>
                        </span>
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[10px] font-black shadow-xs ${raceSeedBadgeClasses[raceTone]}`}
                        >
                          {teamAbbr(team.name)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-bold text-blue-700 underline decoration-blue-300 underline-offset-4 dark:text-blue-300 dark:decoration-blue-700">
                            {displayName(team.name)}
                          </span>
                          <span className="mt-0.5 block text-[11px] font-bold text-slate-500 dark:text-slate-400">
                            {recordText(team)} ·{" "}
                            <span
                              className={
                                team.runDiff > 0
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : team.runDiff < 0
                                    ? "text-red-600 dark:text-red-400"
                                    : ""
                              }
                            >
                              {team.runDiff > 0 ? "+" : ""}
                              {team.runDiff}
                            </span>{" "}
                            · SOS #{currentSosRanks[team.id] || "—"}
                          </span>
                        </span>
                      </a>
                      {hasCutLine && (
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <span
                            className={
                              team.goldPct >= 75
                                ? pill("emerald")
                                : team.goldPct >= 40
                                  ? pill("blue")
                                  : pill("neutral")
                            }
                          >
                            {formatGoldPct(team)}
                          </span>
                          <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
                            {formatGoldMargin(team)}
                          </span>
                          <span
                            aria-label={`Playoff status: ${statusLabel(team)}`}
                            className={`rounded-full px-2 py-0.5 text-[10px] font-black ${statusClass(team)}`}
                          >
                            {statusLabel(team)}
                          </span>
                        </div>
                      )}
                    </div>
                    {isLastInside && (
                      <div
                        role="separator"
                        aria-label={`Gold cut line: top ${goldCutoff} teams qualify`}
                        className="bg-slate-950 px-4 py-1.5 text-center text-[10px] font-semibold uppercase tracking-[0.22em] text-red-400 dark:bg-black"
                      >
                        Gold Cut Line
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
