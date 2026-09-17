import { useMemo } from "react";
import {
  SCOUT_REPORT_NATIONAL_TOP,
  SCOUT_REPORT_STATE_TOP,
  type MatchupPreview,
  type MatchupTier,
  type ScoutingReport,
  type ScoutRankingRow,
  type UpcomingMatchup,
} from "../../lib/teamRankings";
import type { LeagueSummaryState } from "../../hooks/useLeagueSummary";
import { AiStoryPanel } from "../AiStoryPanel";
import { TeamSearchSelect } from "../TeamSearchSelect";
import { card, pill } from "../../styles/tokens";

const tierTone = (tier: MatchupTier) =>
  tier === "Favored" ? "emerald" : tier === "Underdog" ? "red" : "neutral";

/**
 * Says a projection is not one, because nothing in the pool joins the two clubs.
 *
 * Worded as what it is rather than as a fact about the clubs, which is the distinction that took
 * two goes to get right. On a part-pulled pool this is usually the pull's fault, not the schedule's:
 * two clubs that really did share an opponent look unconnected while that opponent is only a name
 * on somebody's list. So the label points at the games we have, and the fix it implies is pulling
 * the rest rather than distrusting either club.
 *
 * The numbers stay beside it. They are the only answer the model has, and hiding them would be no
 * more honest than showing them silently — what a reader needs is to know that these two ratings
 * were worked out against different sets of opponents, so their difference is not a prediction.
 */
function NoSharedOpponents() {
  return (
    <span
      className="ml-2 whitespace-nowrap text-xs font-bold text-amber-700 dark:text-amber-400"
      title="Nothing in the games pulled so far links these two — not even through opponents of opponents — so their ratings were worked out against different sets of teams and this projection is a guess. Usually it means the club that connects them has not been pulled yet; Setup lists which clubs those are."
    >
      no shared opponents yet
    </span>
  );
}

const formatPct = (value: number) => `${Math.round(value * 100)}%`;

const formatMargin = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;

/** "Sat, Sep 20" from "2026-09-20". Parsed as UTC so the day cannot slip a timezone backwards. */
const formatDay = (date: string) => {
  if (!date) return "No date";
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
};

type ScoutingSectionProps = {
  rankings: ScoutRankingRow[];
  reportForId: string;
  onReportTeamChange: (teamId: string) => void;
  reportRow: ScoutRankingRow | null;
  report: ScoutingReport;
  /** Adds a team to the report by name, for one that neither list reaches. */
  onPickOpponent: (teamId: string) => void;
  onDropOpponent: (teamId: string) => void;
  /** The games still to be played on this team's schedule, soonest first. */
  upcomingRows: UpcomingMatchup[];
  explanation: LeagueSummaryState;
  /** "Prosper, TX" for a pulled club; nothing for a stand-in. */
  placeOf: (teamId: string) => string | undefined;
};

/**
 * One team's next games, then that team against every other, with the AI panel explaining where
 * its rank comes from.
 *
 * It sits in a section of its own rather than under the tables it is built from: it answers a
 * different question — how would *this* team do — and reaching it used to mean scrolling past a
 * table of every ranked team in the country.
 */
export function ScoutingSection({
  rankings,
  reportForId,
  onReportTeamChange,
  reportRow,
  report,
  onPickOpponent,
  onDropOpponent,
  upcomingRows,
  explanation,
  placeOf,
}: ScoutingSectionProps) {
  /**
   * The place rides along as the detail line: a nationwide pool holds several clubs of the same
   * name, and the name alone cannot tell you which one you meant.
   */
  const teamOptions = useMemo(
    () =>
      rankings.map((row) => ({
        id: row.teamId,
        label: row.teamName,
        ...(placeOf(row.teamId) ? { detail: placeOf(row.teamId) as string } : {}),
      })),
    [rankings, placeOf]
  );

  /** The same options, minus the team the report is about — it cannot be its own opponent. */
  const opponentOptions = useMemo(
    () => teamOptions.filter((option) => option.id !== reportForId),
    [teamOptions, reportForId]
  );

  return (
    <div className={`${card} p-5`}>
      <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">Scouting report</h2>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label
          className="text-xs font-semibold uppercase tracking-wide text-slate-500"
          htmlFor="scout-report-team"
        >
          How would
        </label>
        {/*
          A dropdown, until this page held a nationwide pool. Picking one club out of several
          thousand by scrolling is not picking, so this is the same search box the merge picker
          uses: type a name and the list narrows to it.
        */}
        <TeamSearchSelect
          id="scout-report-team"
          value={reportForId}
          onChange={onReportTeamChange}
          options={teamOptions}
          placeholder="Search for a team"
          className="min-w-56 max-w-xs"
        />
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">fare?</span>
      </div>
      {reportRow && (
        <div className="mt-3">
          <AiStoryPanel
            title="Why this ranking"
            text={explanation.status === "ready" ? explanation.summary : ""}
            source={explanation.status === "ready" ? "gemini" : "local"}
            model={explanation.model}
            loading={explanation.status === "loading"}
            loadingLabel="Writing rank explanation…"
            unavailableReason={explanation.reason}
            errorMessage={explanation.message}
            onRetry={explanation.retry}
            waiting={explanation.waiting}
            onAsk={explanation.ask}
          />
        </div>
      )}
      <h3 className="mt-6 text-xs font-black uppercase tracking-wide text-slate-500">
        Next up — games still to play
      </h3>
      {upcomingRows.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">
          No unplayed games on this team&apos;s schedule. A GameChanger pull brings future fixtures
          in with no score, so they appear here as soon as the schedule has them.
        </p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="py-2">Date</th>
                <th>Opponent</th>
                <th>Opponent rank</th>
                <th>Projected margin</th>
                <th>Win probability</th>
                <th>Outlook</th>
              </tr>
            </thead>
            <tbody>
              {upcomingRows.map((row) => (
                <tr key={row.gameId} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="whitespace-nowrap py-3 font-semibold text-slate-700 dark:text-slate-200">
                    {formatDay(row.date)}
                    {row.event && (
                      <span className="block text-xs font-normal text-slate-500">{row.event}</span>
                    )}
                  </td>
                  <td className="font-bold text-slate-950 dark:text-white">
                    {row.opponentName}
                    {placeOf(row.opponentId) && (
                      <span className="block text-xs font-normal text-slate-500">
                        {placeOf(row.opponentId)}
                      </span>
                    )}
                  </td>
                  {/* An opponent nobody has pulled has no rating, and a made-up one would be
                      worse than none: the row says so and stops there. */}
                  {row.tier === undefined ? (
                    <td className="text-slate-500" colSpan={4}>
                      Not rated here yet
                    </td>
                  ) : (
                    <>
                      <td>#{row.opponentRank}</td>
                      <td>
                        {formatMargin(row.projectedMargin ?? 0)}
                        {row.unconnected && <NoSharedOpponents />}
                      </td>
                      <td>{formatPct(row.winProb ?? 0)}</td>
                      <td>
                        <span className={pill(tierTone(row.tier))}>{row.tier}</span>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <MatchupTable
        heading={`Against the top ${SCOUT_REPORT_NATIONAL_TOP}`}
        note="The best in this age group's pool, wherever they play."
        rows={report.national}
        placeOf={placeOf}
        empty="Add at least two teams to this age group to see scouting projections."
      />

      {report.stateName && (
        <MatchupTable
          heading={`Against the top ${SCOUT_REPORT_STATE_TOP} in ${report.stateName}`}
          note="Ranked within the state, which is the number a state table would show."
          rows={report.state}
          placeOf={placeOf}
          empty={`Nobody else on this page has a ${report.stateName} address yet.`}
        />
      )}

      {/*
        The two lists above are the questions worth asking without being asked — how do we sit
        against the best, and against the ones we might actually draw. This is everyone else. It
        used to be a row per ranked team, which on a nationwide pool is thousands in rank order:
        a list nobody reads and nobody can find a particular club in. A name is faster.
      */}
      <h3 className="mt-6 text-xs font-black uppercase tracking-wide text-slate-500">
        Against anyone else
      </h3>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label
          className="text-xs font-semibold uppercase tracking-wide text-slate-500"
          htmlFor="scout-report-opponent"
        >
          Check a team
        </label>
        <TeamSearchSelect
          id="scout-report-opponent"
          value=""
          onChange={onPickOpponent}
          options={opponentOptions}
          placeholder="Search for an opponent"
          className="min-w-56 max-w-xs"
        />
        <span className="text-xs text-slate-500">
          {report.opponentCount === 0
            ? "Nobody else is ranked on this page yet."
            : `${report.opponentCount.toLocaleString()} ranked ${
                report.opponentCount === 1 ? "team" : "teams"
              } to choose from.`}
        </span>
      </div>
      {report.picked.length > 0 && (
        <MatchupTable
          label="Teams you added"
          rows={report.picked}
          placeOf={placeOf}
          onDrop={onDropOpponent}
          empty=""
        />
      )}
    </div>
  );
}

/**
 * One block of "how would we do against these", with its own heading.
 *
 * The rank column shows whatever rank the rows arrived with — national in the national list, place
 * within the state in the state one — because a state list numbered #4, #87, #212 reads as though
 * nine teams had gone missing.
 */
function MatchupTable({
  heading,
  label,
  note,
  rows,
  placeOf,
  onDrop,
  empty,
}: {
  heading?: string;
  /** The table's own name, for when there is no heading above it to borrow. */
  label?: string;
  note?: string;
  rows: MatchupPreview[];
  placeOf: (teamId: string) => string | undefined;
  /** Given for the searched-for rows, which are the only ones a person can take back off. */
  onDrop?: (teamId: string) => void;
  empty: string;
}) {
  return (
    <>
      {heading && (
        <h3 className="mt-6 text-xs font-black uppercase tracking-wide text-slate-500">
          {heading}
        </h3>
      )}
      {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full text-sm" aria-label={label ?? heading}>
          <thead>
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="py-2">Opponent</th>
              <th>Opponent rank</th>
              <th>Projected margin</th>
              <th>Win probability</th>
              <th>Outlook</th>
              {onDrop && <th className="sr-only">Remove</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((preview) => (
              <tr
                key={preview.opponentId}
                className="border-t border-slate-100 dark:border-slate-800"
              >
                <td className="py-3 font-bold text-slate-950 dark:text-white">
                  {preview.opponentName}
                  {placeOf(preview.opponentId) && (
                    <span className="block text-xs font-normal text-slate-500">
                      {placeOf(preview.opponentId)}
                    </span>
                  )}
                </td>
                <td>#{preview.opponentRank}</td>
                <td>
                  {formatMargin(preview.projectedMargin)}
                  {preview.unconnected && <NoSharedOpponents />}
                </td>
                <td>{formatPct(preview.winProb)}</td>
                <td>
                  <span className={pill(tierTone(preview.tier))}>{preview.tier}</span>
                </td>
                {onDrop && (
                  <td>
                    <button
                      type="button"
                      onClick={() => onDrop(preview.opponentId)}
                      aria-label={`Remove ${preview.opponentName} from the report`}
                      className="text-xs font-semibold text-slate-500 underline hover:text-slate-950 dark:hover:text-white"
                    >
                      Remove
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && empty && (
          <p className="py-6 text-center text-sm text-slate-500">{empty}</p>
        )}
      </div>
    </>
  );
}
