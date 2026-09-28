import type { ScoutRankingRow, UpcomingMatchup } from "./teamRankings";
import { movementOf, type Movement } from "./rankMovement";

/** Where one club stands on a board, and what it plays next: the card above the boards. */
export type MyTeamGlance = {
  teamId: string;
  teamName: string;
  /** Its place on this page's whole table, and how many are on it. */
  nationalRank: number;
  nationalOf: number;
  /** Its place among the clubs of its own state here, when it has one. */
  state?: string;
  stateRank?: number;
  stateOf?: number;
  record: string;
  rating: number;
  /** The first game still to play: dated ones first, soonest first, as the schedule lists them. */
  next?: UpcomingMatchup;
  /** Places climbed on this page since last week, once last week's board is known. */
  movement?: Movement;
};

/**
 * "Where are we ranked?", answered without paging through the table.
 *
 * The question gets asked at every field, and the page could only answer it by Show all and then
 * a hundred, then two hundred rows at a time: the boards above are the top 25 and the top 10, and
 * the team's own panel carries its record but not its place. Everything here is already on the
 * page — the rows are the table, the state is the club's, the next game is its upcoming schedule —
 * so this only reads them. Null when the club is not on this page's table: marked on another age,
 * or with nothing played in this half.
 */
export const myTeamGlance = (
  rankings: readonly ScoutRankingRow[],
  myTeamId: string | undefined,
  stateOf: (teamId: string) => string | undefined,
  upcoming: readonly UpcomingMatchup[],
  /** Every club's place a week ago (`ranksAsOf`), when it has been worked out. */
  lastWeek: Readonly<Record<string, number>> | null = null
): MyTeamGlance | null => {
  if (myTeamId === undefined) return null;
  const row = rankings.find((candidate) => candidate.teamId === myTeamId);
  if (!row) return null;
  const state = stateOf(myTeamId);
  let stateRank: number | undefined;
  let inState = 0;
  if (state) {
    rankings.forEach((candidate) => {
      if (stateOf(candidate.teamId) !== state) return;
      inState += 1;
      if (candidate.teamId === myTeamId) stateRank = inState;
    });
  }
  const next = upcoming[0];
  const nationalRank = row.overallRank ?? row.rank;
  const movement = movementOf(row.teamId, nationalRank, lastWeek);
  return {
    teamId: row.teamId,
    teamName: row.teamName,
    nationalRank,
    nationalOf: rankings.length,
    ...(state && stateRank !== undefined ? { state, stateRank, stateOf: inState } : {}),
    record: row.record,
    rating: row.rating,
    ...(next ? { next } : {}),
    ...(movement !== undefined ? { movement } : {}),
  };
};
