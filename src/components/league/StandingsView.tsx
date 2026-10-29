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
import type { AiProvider, LeagueSummaryErrorReason } from "../../lib/leagueSummary";
import { buildTeamDataHref } from "../../lib/teamLink";
import { TIEBREAKER_LABELS, type LastImpact, type TeamWithProjection } from "../../lib/types";
import type { RankOptions } from "../../lib/sim";
import { tieBreaks, type TieBreak } from "../../lib/tieBreaks";
import { leagueStrength, nationalRankText, type LeagueClubRank } from "../../lib/leagueClubRanks";
import { AiStoryPanel } from "../AiStoryPanel";
import { HelpTip } from "../HelpTip";
import { PageHeader } from "../PageHeader";
import { ProjectionExplanation } from "../ProjectionExplanation";
import { Sparkline } from "../Sparkline";
import {
  raceBadgeClasses,
  raceRowToneClasses,
  raceSeedBadgeClasses,
  raceToneForTeam,
  raceToneLabels,
  raceToneOrder,
  raceToneWords,
} from "../../styles/raceTone";
import { focusRing, pill } from "../../styles/tokens";

/** A team's place nationally, as a line under its name, or nothing where none is known. */
/**
 * Where a team's club stands nationally, under its name, with a button to its scouting report in
 * Team Rankings. Kept out of the team's link (its own element, beside it), since a button cannot
 * sit inside a link.
 */
const DEFAULT_RANK_OPTIONS: RankOptions = { winPoints: 1, tiePoints: 0.5 };

/** The points a team has, as the table ranks on them: a half where ties count half. */
const pointsOf = (team: TeamWithProjection, options: RankOptions): number =>
  team.w * (options.winPoints ?? 1) + team.t * (options.tiePoints ?? 0.5);
const pointsText = (points: number): string =>
  Number.isInteger(points) ? String(points) : points.toFixed(1);

/** What broke a tie on points, in words: the rule, the model's rating, or nothing. */
const brokenBy = (by: TieBreak["by"]): string =>
  by === "rating"
    ? "on the model's rating"
    : by === "id"
      ? "in a fixed order, as nothing told them apart"
      : `on ${TIEBREAKER_LABELS[by].toLowerCase()}`;

const nationalLine = (
  rank: LeagueClubRank | undefined,
  teamName: string,
  onScout: ((rank: LeagueClubRank) => void) | undefined
) =>
  rank ? (
    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
      <span>{nationalRankText(rank)}</span>
      {onScout && (
        <button
          type="button"
          onClick={() => onScout(rank)}
          className={`rounded font-bold text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-500 dark:text-blue-300 dark:decoration-blue-700 dark:hover:text-blue-200 ${focusRing}`}
          aria-label={`Scout ${teamName} in Team Rankings`}
        >
          Scout
        </button>
      )}
    </span>
  ) : null;

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
  nationalRank,
  onScout,
  rankOptions = DEFAULT_RANK_OPTIONS,
}: {
  /** How the table is ranked: the points a win and a tie earn, and the tiebreakers in order. */
  rankOptions?: RankOptions;
  /**
   * Where a team's club stood on Team Rankings when that board was last up (`leagueClubRankFor`),
   * said beside every team as the "Our team" card says it of its own; absent where none is known.
   */
  nationalRank?: (teamId: string) => LeagueClubRank | undefined;
  /** Opens Team Rankings' scouting report on a team's club (`scoutRoute`). */
  onScout?: (rank: LeagueClubRank) => void;
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
  storySource: AiProvider | "local";
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
  // Each team level on points with the one above it, and what put it behind: the table ranks on
  // points and then the league's tiebreakers, and said neither.
  const ties = React.useMemo(
    () =>
      tieBreaks(
        [...dashboardRows].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)),
        rankOptions
      ),
    [dashboardRows, rankOptions]
  );
  const nameOf = (id: string) => dashboardRows.find((team) => team.id === id)?.name ?? id;
  // The ± was printed under every team's Gold %; said once, for the widest of them, it is the same
  // promise without eight copies of it.
  const widestMargin = dashboardRows.reduce<TeamWithProjection | null>(
    (widest, team) =>
      widest === null || (team.goldPctMargin ?? 0) > (widest.goldPctMargin ?? 0) ? team : widest,
    null
  );
  // The league's strength, by where its teams' clubs stand on Team Rankings (`leagueStrength`).
  const strength = nationalRank
    ? leagueStrength(dashboardRows.map((team) => nationalRank(team.id)))
    : null;
  return (
    <div className="grid grid-cols-1 gap-6">
      <section>
        <PageHeader
          title="Standings"
          help={
            <HelpTip title="Reading the table">
              {hasCutLine && (
                <>
                  <strong>Gold %</strong> is the simulated chance of finishing in the top{" "}
                  {goldCutoff} (the Gold Bracket), from thousands of season simulations.{" "}
                </>
              )}
              <strong>SOS</strong> is strength of schedule — a lower rank means tougher opponents.{" "}
              <strong>Diff</strong> is run differential (runs scored minus runs allowed).
            </HelpTip>
          }
          lead={<>Updated through {latestCompletedDate}.</>}
        />
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xs dark:border-slate-700 dark:bg-slate-900">
        {lastImpact && (
          <div className="border-b border-slate-200 bg-blue-50 px-5 py-4 dark:border-slate-700 dark:bg-slate-800/50">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-400">
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
                    className="rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white shadow-xs hover:bg-blue-500"
                  >
                    Copy Story
                  </button>
                )}
                {lastImpact.recapItems.length > 0 && (
                  <button
                    type="button"
                    onClick={copyRecap}
                    className="rounded-full bg-slate-950 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white shadow-xs hover:bg-slate-800 dark:bg-white dark:text-slate-950"
                  >
                    Copy Recap
                  </button>
                )}
                <button
                  type="button"
                  onClick={dismissImpact}
                  className="rounded-full bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500 shadow-xs ring-1 ring-blue-100 hover:text-slate-950 dark:bg-slate-900 dark:text-slate-400 dark:ring-slate-700"
                >
                  Dismiss
                </button>
              </div>
            </div>
            {lastImpact.scores.length > 0 && (
              <div className="mb-3 rounded-lg bg-white p-3 shadow-xs ring-1 ring-blue-100 dark:bg-slate-900 dark:ring-slate-700">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
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
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
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
            <div className="flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-wide">
              {raceToneOrder.map((tone) => (
                <span key={tone} className={`rounded-full px-3 py-1 ${raceBadgeClasses[tone]}`}>
                  {raceToneWords[tone]}
                </span>
              ))}
            </div>
          </div>
        )}

        {strength && (
          <p className="border-b border-slate-200 px-5 py-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
            <span className="font-bold">League strength: </span>
            {strength.ranked} of {strength.of} teams on Team Rankings · the median team in the{" "}
            <strong>top {strength.medianTop}%</strong> nationally
            {strength.state && (
              <>
                {" · "}
                {strength.state.teams === strength.ranked
                  ? "on average"
                  : `${strength.state.teams} of them on average`}{" "}
                in the <strong>top {strength.state.averageTop}%</strong> of {strength.state.name}
                &apos;s clubs
              </>
            )}
          </p>
        )}

        {dashboardRows.length === 0 ? (
          <div className="p-8 text-center text-sm font-bold text-slate-500 dark:text-slate-400">
            No final results yet. Mark a game Final in the Schedule tab to populate standings.
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left tabular-nums">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                  <tr>
                    <th className="px-5 py-3">Seed</th>
                    <th className="px-5 py-3">Team</th>
                    <th className="px-4 py-3 text-center">Record</th>
                    <th className="px-4 py-3 text-center">Pts</th>
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
                              colSpan={9}
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
                            {nationalLine(nationalRank?.(team.id), displayName(team.name), onScout)}
                          </td>
                          <td className="px-4 py-4 text-center font-black text-slate-800 dark:text-slate-100">
                            {recordText(team)}
                          </td>
                          <td className="px-4 py-4 text-center font-black text-slate-800 dark:text-slate-100">
                            {pointsText(pointsOf(team, rankOptions))}
                          </td>
                          <td
                            className={`px-4 py-4 text-center font-black ${
                              team.runDiff > 0
                                ? "text-emerald-700 dark:text-emerald-400"
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
                                <span className={pill("neutral")}>{formatGoldPct(team)}</span>
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
            {ties.length > 0 && (
              <p className="px-5 pb-4 pt-2 text-xs font-bold text-slate-500 dark:text-slate-400">
                Level on points:{" "}
                {ties
                  .map(
                    (tie) =>
                      `${displayName(nameOf(tie.teamId))} placed behind ${displayName(nameOf(tie.aboveId))} ${brokenBy(tie.by)}`
                  )
                  .join("; ")}
                .
              </p>
            )}

            {/* Mobile cards */}
            <ul className="divide-y divide-slate-100 md:hidden dark:divide-slate-800">
              {dashboardRows.map((team, index) => {
                const isLastInside = hasCutLine && index + 1 === goldCutoff;
                const raceTone = raceToneForTeam(team, goldCutoff);
                const clubRank = nationalRank?.(team.id);
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
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-black shadow-xs ${raceSeedBadgeClasses[raceTone]}`}
                        >
                          {teamAbbr(team.name)}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-bold wrap-break-word text-blue-700 underline decoration-blue-300 underline-offset-4 dark:text-blue-300 dark:decoration-blue-700">
                            {displayName(team.name)}
                          </span>
                          <span className="mt-0.5 block text-xs font-bold text-slate-500 dark:text-slate-400">
                            {recordText(team)} · {pointsText(pointsOf(team, rankOptions))}{" "}
                            {pointsOf(team, rankOptions) === 1 ? "pt" : "pts"} ·{" "}
                            <span
                              className={
                                team.runDiff > 0
                                  ? "text-emerald-700 dark:text-emerald-400"
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
                          <span className={pill("neutral")}>{formatGoldPct(team)}</span>
                          <span
                            aria-label={`Playoff status: ${statusLabel(team)}`}
                            className={`rounded-full px-2 py-0.5 text-xs font-black ${statusClass(team)}`}
                          >
                            {statusLabel(team)}
                          </span>
                        </div>
                      )}
                    </div>
                    {clubRank && (
                      <div className="-mt-2 px-4 pb-3">
                        {nationalLine(clubRank, displayName(team.name), onScout)}
                      </div>
                    )}
                    {isLastInside && (
                      <div
                        role="separator"
                        aria-label={`Gold cut line: top ${goldCutoff} teams qualify`}
                        className="bg-slate-950 px-4 py-1.5 text-center text-xs font-semibold uppercase tracking-[0.22em] text-red-400 dark:bg-black"
                      >
                        Gold Cut Line
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {hasCutLine && widestMargin && (
              <p className="border-t border-slate-200 px-5 py-3 text-xs font-semibold text-slate-500 dark:border-slate-700 dark:text-slate-400">
                Gold % comes from playing out the rest of the season many times over; each is good
                to within {formatGoldMargin(widestMargin)}.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
