import { useEffect, useMemo, useState } from "react";
import { ScoutingSection } from "./ScoutingSection";
import { TournamentPanel } from "./TournamentPanel";
import { useClubCard } from "../../hooks/useClubCard";
import type { LiveViewSource } from "../../hooks/useLiveBoard";
import type { LiveEdits } from "../../hooks/useLiveEdits";
import { useLeagueSummary } from "../../hooks/useLeagueSummary";
import type { WhatIfAsk, WhatIfState } from "../../hooks/useRankingsWorker";
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
import type { WhatIfCurve } from "../../lib/scoutWhatIf";
import { buildTeamRankExplanationRequest } from "../../lib/teamRankingsSummaryClient";
import { card as cardStyle } from "../../styles/tokens";

const NOT_ASKED: WhatIfState = { status: "idle" };

/**
 * The Scouting tab on the cloud's board: the report, the upcoming games and the comparison, worked
 * out as Team Rankings works them out, off the board's rows and the club cards a server publishes
 * (`scoutingFromCards.ts`) rather than off the year's pool: the scouted club's card, and the
 * card of the club set beside it. A what-if refits the year, which the board cannot, so it is asked
 * of the server (`scouting.whatIf`, 1.5), which refits it as the boards are built, League
 * Standings' games in it, and answered as the page answers one, one fixture open at a time, held
 * against the board it was opened on. One is offered only where the page would offer it, as far as
 * the board can tell (`boardWhatIfDeclines`). A card that cannot be read hands the page to Team
 * Rankings on this device's copy (`onCannot`). The clubs it is on (the one scouted, the one
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
  edits,
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
  /**
   * The server's questions: a what-if is one. Asked whether or not edits are on: offline, or
   * before the cloud has answered, the question says why it was not asked, and the panel that it
   * could not be worked out, rather than working at it with nothing to wait for.
   */
  edits: Pick<LiveEdits, "ask">;
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

  /*
   * The fixture whose what-if is open, held against the board it was opened on as the page holds
   * it: a place in one club's, page's or half's table means nothing in another's.
   */
  const { ask: askServer } = edits;
  const [opened, setOpened] = useState<{ gameId: string; board: string } | null>(null);
  const whatIfBoard = `${reportForId}|${pageId}|${routeSegment ?? ""}`;
  const whatIfGameId = opened && opened.board === whatIfBoard ? opened.gameId : null;
  const whatIfAsk = useMemo(
    (): WhatIfAsk | null =>
      whatIfGameId && reportForId ? { forTeamId: reportForId, gameId: whatIfGameId, today } : null,
    [whatIfGameId, reportForId, today]
  );
  // The answer, kept against the ask it answers, so a stale one is never shown.
  const [answered, setAnswered] = useState<{ ask: WhatIfAsk; curve: WhatIfCurve | null } | null>(
    null
  );
  // The fixture as the scouted club's card holds it, which is how the server finds it.
  const fixture = whatIfAsk
    ? scouted.card?.games.find((game) => game.id === whatIfAsk.gameId)
    : undefined;
  useEffect(() => {
    if (!whatIfAsk || !fixture) return;
    let alive = true;
    void askServer({
      kind: "scouting.whatIf",
      page: pageId,
      segment: segment ?? null,
      forTeamId: whatIfAsk.forTeamId,
      game: fixture,
      today: whatIfAsk.today,
    }).then((answer) => {
      if (alive) setAnswered({ ask: whatIfAsk, curve: answer?.curve ?? null });
    });
    return () => {
      alive = false;
    };
  }, [whatIfAsk, fixture, askServer, pageId, segment]);
  const whatIf = useMemo((): WhatIfState => {
    if (!whatIfAsk) return NOT_ASKED;
    if (answered?.ask !== whatIfAsk) return { status: "working", ask: whatIfAsk };
    return answered.curve
      ? { status: "ready", ask: whatIfAsk, curve: answered.curve }
      : { status: "failed", ask: whatIfAsk };
  }, [whatIfAsk, answered]);
  const toggleWhatIf = (gameId: string) =>
    setOpened((was) =>
      was && was.board === whatIfBoard && was.gameId === gameId
        ? null
        : { gameId, board: whatIfBoard }
    );

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
          whatIfGameId={whatIfGameId}
          whatIf={whatIf}
          onToggleWhatIf={toggleWhatIf}
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
