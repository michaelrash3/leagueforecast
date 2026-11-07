import { useCallback, useEffect, useMemo, useState } from "react";
import type { AllKnown } from "../lib/live/allKnown";
import { ratedClubsOf, whatIfDeclines } from "../lib/scoutWhatIf";
import type { AgeGroup, ScoutGame, UpcomingMatchup } from "../lib/teamRankings";
import type { SeasonSegment } from "../lib/teamRankings/seasons";
import type { WhatIfAsk } from "./useRankingsWorker";

/**
 * What if, on the scouting report: which of the report club's fixtures can be asked about, the one
 * whose answer is open (one at a time, and read as closed on any other board), and why a fixture
 * that cannot be asked about says no. The answer itself is worked out off the page, by the
 * rankings worker, which this asks once a fixture is open (`askWhatIf`).
 *
 * TeamRankingsView.tsx worked these out among its board's values. They moved here whole and are
 * called where they were, so the state, memos and the effect keep their place among the view's.
 */
export type WhatIfInputs = {
  ageGroups: AgeGroup[];
  allKnown: AllKnown;
  askWhatIf: (ask: WhatIfAsk | null) => void;
  poolGames: ScoutGame[];
  poolIds: string;
  reportForId: string;
  routeSegment: SeasonSegment | undefined;
  selectedAgeGroupId: string;
  today: string;
  upcomingRows: UpcomingMatchup[];
};

export function useWhatIf({
  ageGroups,
  allKnown,
  askWhatIf,
  poolGames,
  poolIds,
  reportForId,
  routeSegment,
  selectedAgeGroupId,
  today,
  upcomingRows,
}: WhatIfInputs) {
  /**
   * The fixture whose what-if is open, if any. One at a time: two would be two tables.
   *
   * Remembered against the board it was opened on, and read back as closed whenever that is not
   * the board on screen. A place in a table means nothing in a different one, so a panel opened
   * for one club, page or half of the year must not survive into another — and deriving that is
   * safer than clearing it, because there is no moment where the two disagree.
   */
  const [opened, setOpened] = useState<{ gameId: string; board: string } | null>(null);
  const whatIfBoard = `${reportForId}|${selectedAgeGroupId}|${routeSegment ?? ""}`;
  const whatIfGameId = opened && opened.board === whatIfBoard ? opened.gameId : null;

  /*
   * Which of these fixtures can be asked about at all, worked out once for the whole schedule.
   * The expensive part is choosing the games the fit would read, and that is the same choice for
   * every row, so asking per row would pay for it once a row instead of once a board.
   */
  const asksWhatIf = Boolean(reportForId) && upcomingRows.length > 0;
  /*
   * The half of that check that reads the whole year: which clubs the board counts a game for,
   * which an opponent is checked against. It is the same for every club and every page of a year,
   * so it follows the pool rather than the page, and a switch between pages no longer pays for it
   * (about 350 ms on the 18:40 pool). Only worked out while there is a fixture to ask about.
   */
  const ratedClubs = useMemo(() => {
    if (!asksWhatIf) return null;
    // Any page of the pool names the same pool; the list always holds at least the one on screen.
    const anyPageOfThePool = (JSON.parse(poolIds) as string[])[0] ?? "";
    return ratedClubsOf(
      anyPageOfThePool,
      allKnown.teams,
      poolGames,
      ageGroups,
      routeSegment,
      today
    );
  }, [asksWhatIf, poolIds, allKnown.teams, poolGames, ageGroups, routeSegment, today]);
  const poolGameById = useMemo(
    () => (asksWhatIf ? new Map(poolGames.map((game) => [game.id, game])) : null),
    [asksWhatIf, poolGames]
  );
  const whatIfDeclineMap = useMemo(() => {
    if (!reportForId || !ratedClubs || !poolGameById) return new Map<string, null>();
    const fixtures = upcomingRows
      .map((row) => poolGameById.get(row.gameId))
      .filter((game): game is (typeof poolGames)[number] => game !== undefined);
    return whatIfDeclines(
      fixtures,
      reportForId,
      selectedAgeGroupId,
      allKnown.teams,
      poolGames,
      ageGroups,
      routeSegment,
      today,
      ratedClubs
    );
  }, [
    reportForId,
    ratedClubs,
    poolGameById,
    upcomingRows,
    poolGames,
    selectedAgeGroupId,
    allKnown.teams,
    ageGroups,
    routeSegment,
    today,
  ]);
  const whatIfDeclineFor = useCallback(
    (gameId: string) => whatIfDeclineMap.get(gameId) ?? null,
    [whatIfDeclineMap]
  );

  useEffect(() => {
    askWhatIf(
      whatIfGameId && reportForId ? { forTeamId: reportForId, gameId: whatIfGameId, today } : null
    );
  }, [askWhatIf, whatIfGameId, reportForId, today]);

  return { setOpened, whatIfBoard, whatIfDeclineFor, whatIfGameId };
}
