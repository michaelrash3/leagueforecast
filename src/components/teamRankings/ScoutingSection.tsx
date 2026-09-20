import { Fragment, useMemo } from "react";
import {
  RATING_CAP,
  SCOUT_REPORT_NATIONAL_TOP,
  SCOUT_REPORT_STATE_TOP,
  type MatchupPreview,
  type MatchupTier,
  type ScoutingReport,
  type ScoutRankingRow,
  type UpcomingMatchup,
} from "../../lib/teamRankings";
import { holdsFrom, type WhatIfCurve, type WhatIfDeclined } from "../../lib/scoutWhatIf";
import type { WhatIfState } from "../../hooks/useRankingsWorker";
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
  /** The fixture whose what-if is open, if any. */
  whatIfGameId: string | null;
  whatIf: WhatIfState;
  onToggleWhatIf: (gameId: string) => void;
  /** Why this fixture cannot be asked about, or null when it can. */
  whatIfDeclineFor: (gameId: string) => WhatIfDeclined | null;
};

/** "52 places better", "1 place worse", "no change". Direction in words, never in colour. */
const placesMoved = (from: number, to: number): string => {
  if (from === to) return "no change";
  const places = Math.abs(from - to);
  return `${places} ${places === 1 ? "place" : "places"} ${to < from ? "better" : "worse"}`;
};

/** "1 run", "2 runs", and the top rung which stands for every bigger win. */
const runsLabel = (margin: number): string => {
  const runs = Math.abs(margin);
  if (runs === RATING_CAP) return `${runs} runs or more`;
  return `${runs} ${runs === 1 ? "run" : "runs"}`;
};

/**
 * The one sentence worth leading with: what it would take to come out of this no worse off.
 *
 * Phrased off the curve rather than off the projection, because they are not the same question.
 * The projection says who is expected to win; this says what winning has to look like for the
 * table not to move against you, and the extra game's own evidence shifts that by a couple of
 * tenths of a run.
 */
const breakEven = (curve: WhatIfCurve, standing: number): string => {
  const hold = holdsFrom(curve, standing);
  const best = curve.points[curve.points.length - 1];
  if (hold === null) {
    return best
      ? `No result here can lift you. Even a ${RATING_CAP}-run win leaves you at #${best.rank}, so this game can only cost places.`
      : "There is nothing to say about this one.";
  }
  if (hold === 1) return `Any win holds #${standing} or better, and any loss costs you places.`;
  return `Win by ${hold} or more and you hold #${standing} or better. Win by less and you still slip — the table already expects you to beat them.`;
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
  whatIfGameId,
  whatIf,
  onToggleWhatIf,
  whatIfDeclineFor,
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
          <table className="min-w-full text-sm" aria-label="Next up">
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
                <Fragment key={row.gameId}>
                  <tr className="border-t border-slate-100 dark:border-slate-800">
                    <td className="whitespace-nowrap py-3 font-semibold text-slate-700 dark:text-slate-200">
                      {formatDay(row.date)}
                      {row.event && (
                        <span className="block text-xs font-normal text-slate-500">
                          {row.event}
                        </span>
                      )}
                    </td>
                    <td className="font-bold text-slate-950 dark:text-white">
                      {row.opponentName}
                      {placeOf(row.opponentId) && (
                        <span className="block text-xs font-normal text-slate-500">
                          {placeOf(row.opponentId)}
                        </span>
                      )}
                      {/*
                      Under the opponent rather than in a column of its own. This table already has
                      six, and a seventh would push it into the sideways scroll inside a card that
                      the rankings table went to some trouble to get rid of.
                    */}
                      <WhatIfTrigger
                        gameId={row.gameId}
                        opponentName={row.opponentName}
                        decline={whatIfDeclineFor(row.gameId)}
                        open={whatIfGameId === row.gameId}
                        onToggle={onToggleWhatIf}
                      />
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
                  {whatIfGameId === row.gameId && reportRow && (
                    <tr className="bg-slate-50 dark:bg-slate-900/40">
                      <td colSpan={6} className="px-1 py-3" id={`what-if-${row.gameId}`}>
                        <WhatIfPanel
                          state={whatIf}
                          gameId={row.gameId}
                          standing={reportRow}
                          opponentName={row.opponentName}
                          projectedMargin={row.projectedMargin}
                          unconnected={row.unconnected === true}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
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

/**
 * Why a fixture cannot be asked about, in a sentence — or nothing at all.
 *
 * Only the two a reader can do something about get words. The rest cannot be reached from a row
 * this table would list as upcoming, or are already said plainly in the row itself: a club nobody
 * has rated yet reads "Not rated here yet" across the four columns, and repeating it underneath
 * the name would be the same news twice.
 */
const declineNote = (decline: WhatIfDeclined): string | null => {
  if (decline === "other-half")
    return "In the other half of the season, so it cannot change this table.";
  if (decline === "no-date")
    return "No date, so it belongs to the year but to neither half of it. Ask on the whole-year board.";
  return null;
};

/** The way into the answer, under the opponent's name. */
function WhatIfTrigger({
  gameId,
  opponentName,
  decline,
  open,
  onToggle,
}: {
  gameId: string;
  opponentName: string;
  decline: WhatIfDeclined | null;
  open: boolean;
  onToggle: (gameId: string) => void;
}) {
  if (decline !== null) {
    const note = declineNote(decline);
    return note ? (
      <span className="mt-1 block text-xs font-normal text-slate-500">{note}</span>
    ) : null;
  }
  return (
    <button
      type="button"
      onClick={() => onToggle(gameId)}
      aria-expanded={open}
      aria-controls={`what-if-${gameId}`}
      className="mt-1 block text-xs font-semibold text-slate-500 underline hover:text-slate-950 dark:hover:text-white"
    >
      {open ? "Hide" : "What if?"}
      <span className="sr-only">
        {" "}
        what a win or a loss against {opponentName} would do to the ranking
      </span>
    </button>
  );
}

/**
 * Where every margin would leave the club, once the whole table has been fitted again with the
 * result in it.
 *
 * A margin table rather than two buttons, because the margin is the larger half of the answer: the
 * gap between winning by one and winning by eight moves a club further than the gap between
 * winning and losing at the margin the projection expects. Two buttons would hide that.
 *
 * Nothing here is coloured by outcome. Winning is not always good news and losing is not always
 * bad — a narrow loss to a much stronger club can lift a thinly played side, because the table
 * rates who you played and one more game is one more thing the rating stands on. A green "win"
 * column above a rank that fell would teach the reader the feature is broken.
 */
function WhatIfPanel({
  state,
  gameId,
  standing,
  opponentName,
  projectedMargin,
  unconnected,
}: {
  state: WhatIfState;
  gameId: string;
  standing: ScoutRankingRow;
  opponentName: string;
  projectedMargin: number | undefined;
  unconnected: boolean;
}) {
  const mine = state.status !== "idle" && state.ask.gameId === gameId;
  if (!mine || state.status === "working") {
    return (
      <p className="text-sm text-slate-500" role="status" aria-live="polite">
        Working it out — the whole table is fitted again, twice.
      </p>
    );
  }
  if (state.status === "failed") {
    return (
      <p className="text-sm text-slate-500" role="status" aria-live="polite">
        That could not be worked out. Nothing here changed — the table above is still what the pool
        says today.
      </p>
    );
  }

  const { curve } = state;
  const wins = curve.points.filter((point) => point.margin > 0);
  const losses = curve.points.filter((point) => point.margin < 0);
  const headline = breakEven(curve, standing.rank);
  // The rung the projection points at, so the reader can see which line is the expected one.
  const expected =
    projectedMargin === undefined
      ? null
      : Math.min(RATING_CAP, Math.max(1, Math.round(Math.abs(projectedMargin))));

  return (
    <div className="space-y-2">
      <p
        className="text-sm font-bold text-slate-950 dark:text-white"
        role="status"
        aria-live="polite"
      >
        {headline}
      </p>
      <p className="text-xs text-slate-500">
        Now #{standing.rank} of {curve.rankedCount.toLocaleString()}, at{" "}
        {standing.rating.toFixed(1)}.
      </p>
      <div className="overflow-x-auto">
        <table
          className="min-w-full text-sm"
          aria-label={`What a win or a loss against ${opponentName} would do`}
        >
          <thead>
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="py-1">By</th>
              <th>If we win ({curve.winRecord})</th>
              <th>If we lose ({curve.lossRecord})</th>
            </tr>
          </thead>
          <tbody>
            {wins.map((win, index) => {
              const loss = losses[losses.length - 1 - index];
              const runs = win.margin;
              return (
                <tr key={runs} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="whitespace-nowrap py-2 font-semibold text-slate-700 dark:text-slate-200">
                    {runsLabel(runs)}
                    {expected === runs && (
                      <span className="ml-1 text-xs font-normal text-slate-500">projected</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap">
                    #{win.rank}{" "}
                    <span className="text-xs text-slate-500">
                      {placesMoved(standing.rank, win.rank)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap">
                    {loss ? (
                      <>
                        #{loss.rank}{" "}
                        <span className="text-xs text-slate-500">
                          {placesMoved(standing.rank, loss.rank)}
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        {RATING_CAP} runs is as much as one game can carry, so the last row is every bigger win at
        once: a {RATING_CAP + 1}-1 and a 20-0 move the table by exactly the same amount. A narrow
        loss to a stronger club can still lift you — the table rates who you played, not only who
        you beat, and one more game is one more thing your rating stands on.
      </p>
      <p className="text-xs text-slate-500">
        Every rating is worked out again from scratch with this one result added, so a few other
        clubs shift places too. Nobody else&apos;s next game is played here. It is fitted as if the
        game were played today, because recent games count for more and a result dated weeks ahead
        would outweigh the season you have actually had.
      </p>
      {unconnected && (
        <p className="text-xs font-bold text-amber-700 dark:text-amber-400">
          Nothing in the games pulled so far links these two clubs, so where this would leave you
          rests on a comparison the pool has not actually made.
        </p>
      )}
    </div>
  );
}
