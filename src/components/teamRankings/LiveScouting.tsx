import { useEffect, useMemo } from "react";
import { ScoutingSection } from "./ScoutingSection";
import { TournamentPanel } from "./TournamentPanel";
import { useClubCard } from "../../hooks/useClubCard";
import type { LiveViewSource } from "../../hooks/useLiveBoard";
import { useLeagueSummary } from "../../hooks/useLeagueSummary";
import type { WhatIfState } from "../../hooks/useRankingsWorker";
import { compareClubs } from "../../lib/clubCompare";
import {
  boardWhatIfDeclines,
  gamesOfTwo,
  poolGamesOfCard,
  teamsOfCard,
} from "../../lib/live/scoutingFromCards";
import {
  buildScoutingReport,
  buildUpcomingSchedule,
  countedInWindow,
  EMPTY_SCOUTING_REPORT,
  rankingPoolGroupIds,
  type AgeGroup,
  type ScoutRankingRow,
  type SeasonSegment,
} from "../../lib/teamRankings";
import type { BoardClub } from "../../lib/teamRankings/boardDisplay";
import { buildTeamRankExplanationRequest } from "../../lib/teamRankingsSummaryClient";
import { card as cardStyle } from "../../styles/tokens";

const NOT_ASKED: WhatIfState = { status: "idle" };

/**
 * The Scouting tab on the cloud's board: the report, the upcoming games and the comparison, worked
 * out as Team Rankings works them out, off the board's rows and the club cards a server publishes
 * (`scoutingFromCards.ts`) rather than off the year's pool: the scouted club's card, and the
 * card of the club set beside it. A what-if refits the year, which the board cannot, so asking one
 * hands the page to Team Rankings on this device's copy on the same club (`onWhatIf`), and so does
 * a card that cannot be read (`onCannot`); one is offered only where the page would offer it, as
 * far as the board can tell (`boardWhatIfDeclines`). The clubs it is on (the one scouted, the one
 * set beside it, the opponents asked for) are the board's to keep (`onReportTeam`,
 * `onCompareChange`, `onPickedOpponentIdsChange`), so they outlast a half or page read again and
 * Team Rankings opens on them whenever it hands over.
 *
 * Loaded only when the tab is opened, with the tab's own code.
 */
export default function LiveScouting({
  source,
  year,
  pageId,
  groupName,
  ageGroups,
  segment,
  routeSegment,
  rows,
  clubs,
  placeOf,
  today,
  reportTeamId,
  onReportTeam,
  compareId,
  onCompareChange,
  pickedOpponentIds,
  onPickedOpponentIdsChange,
  onWhatIf,
  onCannot,
}: {
  source: LiveViewSource;
  year: number | undefined;
  pageId: string;
  groupName: string;
  ageGroups: AgeGroup[];
  /** The half the board on screen is for. */
  segment: SeasonSegment | undefined;
  /** The half the URL names, which the page asks what-ifs by. */
  routeSegment: SeasonSegment | undefined;
  /** The board's rows, starred as the page stars them. */
  rows: ScoutRankingRow[];
  /** The board's clubs, as its state boards read them (`clubsOfBoard`). */
  clubs: BoardClub[];
  placeOf: (teamId: string) => string | undefined;
  today: string;
  reportTeamId: string;
  onReportTeam: (teamId: string) => void;
  compareId: string;
  onCompareChange: (teamId: string) => void;
  pickedOpponentIds: string[];
  onPickedOpponentIdsChange: (teamIds: string[]) => void;
  onWhatIf: () => void;
  onCannot: () => void;
}) {
  const reportForId =
    reportTeamId || rows.find((row) => row.isMine)?.teamId || rows[0]?.teamId || "";
  const reportRow = rows.find((row) => row.teamId === reportForId) ?? null;
  const report = useMemo(
    () =>
      reportForId
        ? buildScoutingReport(reportForId, rows, clubs, { pickedIds: pickedOpponentIds })
        : EMPTY_SCOUTING_REPORT,
    [reportForId, rows, clubs, pickedOpponentIds]
  );
  const reportRows = useMemo(
    () => [...report.national, ...report.state, ...report.picked],
    [report]
  );

  // The scouted club's card, and the card of the club set beside it.
  const scouted = useClubCard(source, year, reportForId || null);
  const compared = useClubCard(
    source,
    year,
    compareId && compareId !== reportForId ? compareId : null
  );
  const failed = scouted.failed || compared.failed;
  useEffect(() => {
    if (failed) onCannot();
  }, [failed, onCannot]);

  // The games the page's board is fitted over, as Team Rankings hands Scouting them.
  const poolIds = useMemo(
    () => new Set(rankingPoolGroupIds(pageId, ageGroups)),
    [pageId, ageGroups]
  );
  const scoutedGames = useMemo(
    () => (scouted.card ? poolGamesOfCard(scouted.card, poolIds) : []),
    [scouted.card, poolIds]
  );
  const upcomingRows = useMemo(
    () =>
      scouted.card && reportForId
        ? buildUpcomingSchedule(reportForId, rows, scoutedGames, teamsOfCard(scouted.card), today)
        : [],
    [scouted.card, scoutedGames, reportForId, rows, today]
  );
  const declines = useMemo(() => {
    const byId = new Map(scoutedGames.map((game) => [game.id, game]));
    const fixtures = upcomingRows.flatMap((row) => byId.get(row.gameId) ?? []);
    const rated = new Set(rows.map((row) => row.teamId));
    return boardWhatIfDeclines(fixtures, reportForId, rated, ageGroups, routeSegment);
  }, [scoutedGames, upcomingRows, rows, reportForId, ageGroups, routeSegment]);
  const comparison = useMemo(() => {
    if (!scouted.card || !compared.card) return null;
    const names = new Map(
      [...teamsOfCard(scouted.card), ...teamsOfCard(compared.card)].map((team) => [
        team.id,
        team.name,
      ])
    );
    return compareClubs(
      reportForId,
      compareId,
      gamesOfTwo(scoutedGames, reportForId, poolGamesOfCard(compared.card, poolIds), compareId),
      rows,
      (teamId) => names.get(teamId) ?? "Unknown team",
      (game) => countedInWindow(game, ageGroups, segment)
    );
  }, [
    scouted.card,
    compared.card,
    scoutedGames,
    reportForId,
    compareId,
    poolIds,
    rows,
    ageGroups,
    segment,
  ]);

  const explanationRequest = useMemo(() => {
    if (!reportRow || reportRow.games === 0) return null;
    return buildTeamRankExplanationRequest(
      reportRow,
      rows.length,
      reportRows,
      groupName || "this age group"
    );
  }, [reportRow, rows.length, reportRows, groupName]);
  const explanation = useLeagueSummary(explanationRequest);

  return (
    <>
      {reportForId && !scouted.card ? (
        <div className={`${cardStyle} p-5`} role="status" aria-live="polite">
          <p className="text-sm font-bold text-slate-600 dark:text-slate-300">
            Reading the cloud&apos;s report…
          </p>
        </div>
      ) : (
        <ScoutingSection
          rankings={rows}
          reportForId={reportForId}
          onReportTeamChange={onReportTeam}
          reportRow={reportRow}
          report={report}
          onPickOpponent={(id) =>
            onPickedOpponentIdsChange(
              pickedOpponentIds.includes(id) ? pickedOpponentIds : [...pickedOpponentIds, id]
            )
          }
          onDropOpponent={(id) =>
            onPickedOpponentIdsChange(pickedOpponentIds.filter((entry) => entry !== id))
          }
          upcomingRows={upcomingRows}
          explanation={explanation}
          placeOf={placeOf}
          whatIfGameId={null}
          whatIf={NOT_ASKED}
          onToggleWhatIf={onWhatIf}
          whatIfDeclineFor={(gameId) => declines.get(gameId) ?? null}
          compareId={compareId}
          onCompareChange={onCompareChange}
          comparison={comparison}
        />
      )}
      {/* Kept while a newly scouted club's card is read, as the page keeps it, keyed by page. */}
      {rows.length > 0 && (
        <TournamentPanel
          key={pageId}
          ageGroupId={pageId}
          rankings={rows}
          reportForId={reportForId}
          upcomingRows={upcomingRows}
          placeOf={placeOf}
        />
      )}
    </>
  );
}
