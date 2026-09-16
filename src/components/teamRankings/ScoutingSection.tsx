import type {
  MatchupPreview,
  MatchupTier,
  ScoutRankingRow,
  UpcomingMatchup,
} from "../../lib/teamRankings";
import type { LeagueSummaryState } from "../../hooks/useLeagueSummary";
import { AiStoryPanel } from "../AiStoryPanel";
import { card, pill } from "../../styles/tokens";

const tierTone = (tier: MatchupTier) =>
  tier === "Favored" ? "emerald" : tier === "Underdog" ? "red" : "neutral";

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
  reportRows: MatchupPreview[];
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
  reportRows,
  upcomingRows,
  explanation,
  placeOf,
}: ScoutingSectionProps) {
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
        <select
          id="scout-report-team"
          value={reportForId}
          onChange={(event) => onReportTeamChange(event.target.value)}
          className="inline-flex rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
        >
          {rankings.map((row) => (
            <option key={row.teamId} value={row.teamId}>
              {row.teamName}
              {placeOf(row.teamId) ? ` — ${placeOf(row.teamId)}` : ""}
            </option>
          ))}
        </select>
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
                      <td>{formatMargin(row.projectedMargin ?? 0)}</td>
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
      <h3 className="mt-6 text-xs font-black uppercase tracking-wide text-slate-500">
        Against every ranked team
      </h3>
      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="py-2">Opponent</th>
              <th>Opponent rank</th>
              <th>Projected margin</th>
              <th>Win probability</th>
              <th>Outlook</th>
            </tr>
          </thead>
          <tbody>
            {reportRows.map((preview) => (
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
                <td>{formatMargin(preview.projectedMargin)}</td>
                <td>{formatPct(preview.winProb)}</td>
                <td>
                  <span className={pill(tierTone(preview.tier))}>{preview.tier}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {reportRows.length === 0 && (
          <p className="py-6 text-center text-sm text-slate-500">
            Add at least two teams to this age group to see scouting projections.
          </p>
        )}
      </div>
    </div>
  );
}
