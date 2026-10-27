import {
  fitScoutYearFor,
  opponentWeb,
  rowsOfYearFit,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
  type SeasonSegment,
} from "./teamRankings";

/*
 * Why a club's standing line moves (research, which nothing in the app reads): the owner's report
 * of 27 October 2026, "my team is ass and the graph keeps going up". The line reads a club's place
 * over the size of its board (`StandingLine`), and a board lists every club whose web of games
 * falls short of the line after every club whose web reaches it (`opponentWeb.ts`). The line is a
 * tenth of the typical web, which grows all season (1 on 1 September, 58 on 26 October), so the
 * clubs listed last grow with it, and every club above them reads a better share of the board
 * without playing any better. This says, for one club on each day asked, both readings beside the
 * club's rating, so which one moves the line can be seen.
 */
export type RankLineDay = {
  asOf: string;
  /** The club's place and the board's size, as the standing line reads them. */
  rank?: number;
  of: number;
  /** The board's clubs whose web falls short of the line, listed after every other. */
  listedLast: number;
  /** The club's place among the clubs whose web reaches the line, where its own does. */
  provenRank?: number;
  proven: number;
  /** The club's place by rating alone among every club of the board, and its rating. */
  ratingRank?: number;
  rating?: number;
};

/** A share of a board as the card says it: the top so many percent, 1 to 100. */
export const topOf = (rank: number, of: number): number =>
  Math.min(100, Math.max(1, Math.ceil((100 * rank) / of)));

export const rankLineCheck = (
  pageId: string,
  teamId: string,
  teams: ScoutTeam[],
  games: ScoutGame[],
  ageGroups: AgeGroup[],
  segment: SeasonSegment | undefined,
  days: readonly string[]
): RankLineDay[] =>
  days.flatMap((asOf): RankLineDay[] => {
    const fit = fitScoutYearFor(pageId, teams, games, ageGroups, segment, asOf);
    if (!fit) return [];
    const web = opponentWeb(fit.rated.map(({ game }) => [game.teamAId, game.teamBId] as const));
    const rows = rowsOfYearFit(fit, pageId, undefined, ageGroups, web);
    if (rows.length === 0) return [];
    const proven = rows.filter((row) => web.reachesLine(row.teamId));
    const at = rows.findIndex((row) => row.teamId === teamId);
    const provenAt = proven.findIndex((row) => row.teamId === teamId);
    const own = at < 0 ? undefined : rows[at]!;
    const byRating = [...rows].sort((a, b) => b.rating - a.rating);
    const ratingAt = byRating.findIndex((row) => row.teamId === teamId);
    return [
      {
        asOf,
        of: rows.length,
        listedLast: rows.length - proven.length,
        proven: proven.length,
        ...(own ? { rank: own.rank, rating: own.rating } : {}),
        ...(provenAt < 0 ? {} : { provenRank: provenAt + 1 }),
        ...(ratingAt < 0 ? {} : { ratingRank: ratingAt + 1 }),
      },
    ];
  });
