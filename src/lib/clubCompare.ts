import { scoreSeenBy, type ScoutGame, type ScoutRankingRow } from "./teamRankings";

/** One game from one club's side: who, when, the score as its own schedule gave it. */
export type ClubResult = {
  gameId: string;
  date: string;
  opponentId: string;
  opponentName: string;
  /** The opponent's place on this board, when it has one. */
  opponentRank?: number;
  runsFor: number;
  runsAgainst: number;
  /** Runs for less runs against: a win above zero. */
  margin: number;
};

export type ClubSide = {
  teamId: string;
  /** Wins, against the best-ranked opponents first. */
  bestWins: ClubResult[];
  /** Losses, to the worst-ranked opponents first; an unranked opponent is the worst of all. */
  worstLosses: ClubResult[];
  /** The latest results, newest first. */
  lastFive: ClubResult[];
};

export type CommonOpponent = {
  opponentId: string;
  opponentName: string;
  opponentRank?: number;
  a: ClubResult[];
  b: ClubResult[];
};

export type ClubComparison = {
  /** Their games against each other, from the first club's side, newest first. */
  headToHead: ClubResult[];
  /** Clubs both have played, best-ranked first, each with both clubs' results against it. */
  common: CommonOpponent[];
  a: ClubSide;
  b: ClubSide;
};

/** How many of each list a side shows. */
export const COMPARE_LIST = 3;
export const COMPARE_RECENT = 5;

const byDateDesc = (x: ClubResult, y: ClubResult) =>
  y.date.localeCompare(x.date) || x.gameId.localeCompare(y.gameId);
const rankOr = (rank: number | undefined, fallback: number) => rank ?? fallback;

/**
 * Two clubs side by side, the way a coach scouts one: what happened when they met, what each did
 * against the clubs both have played ("we beat the Bears by 5, they beat them by 1"), each one's
 * best wins and worst losses by the rank of who they were against, and how each has been going.
 *
 * The projection between them is one number with nothing behind it on the page; this is the
 * evidence it is made of. Read from the games the board counts, in the window it counts them in
 * (`counts`), and each score as that club's own schedule gave it (`scoreSeenBy`), so the two sides
 * can disagree about one game exactly as the clubs' records do.
 */
export const compareClubs = (
  aId: string,
  bId: string,
  games: readonly ScoutGame[],
  rows: readonly ScoutRankingRow[],
  nameOf: (teamId: string) => string,
  counts: (game: ScoutGame) => boolean
): ClubComparison => {
  const rankOf = new Map(rows.map((row) => [row.teamId, row.overallRank ?? row.rank]));
  const resultsOf = (teamId: string): ClubResult[] =>
    games.flatMap((game) => {
      if (game.teamAId !== teamId && game.teamBId !== teamId) return [];
      if (!counts(game)) return [];
      const seen = scoreSeenBy(game, teamId);
      if (!seen) return [];
      const opponentId = game.teamAId === teamId ? game.teamBId : game.teamAId;
      const opponentRank = rankOf.get(opponentId);
      return [
        {
          gameId: game.id,
          date: game.date ?? "",
          opponentId,
          opponentName: nameOf(opponentId),
          ...(opponentRank === undefined ? {} : { opponentRank }),
          runsFor: seen.own,
          runsAgainst: seen.opponent,
          margin: seen.own - seen.opponent,
        },
      ];
    });

  const side = (teamId: string, results: ClubResult[]): ClubSide => ({
    teamId,
    bestWins: results
      .filter((result) => result.margin > 0)
      .sort(
        (x, y) =>
          rankOr(x.opponentRank, Infinity) - rankOr(y.opponentRank, Infinity) || byDateDesc(x, y)
      )
      .slice(0, COMPARE_LIST),
    worstLosses: results
      .filter((result) => result.margin < 0)
      .sort(
        (x, y) =>
          rankOr(y.opponentRank, Infinity) - rankOr(x.opponentRank, Infinity) || byDateDesc(x, y)
      )
      .slice(0, COMPARE_LIST),
    lastFive: [...results].sort(byDateDesc).slice(0, COMPARE_RECENT),
  });

  const a = resultsOf(aId);
  const b = resultsOf(bId);
  const bOpponents = new Map<string, ClubResult[]>();
  b.forEach((result) => {
    if (result.opponentId === aId) return;
    bOpponents.set(result.opponentId, [...(bOpponents.get(result.opponentId) ?? []), result]);
  });
  const aOpponents = new Map<string, ClubResult[]>();
  a.forEach((result) => {
    if (result.opponentId === bId || !bOpponents.has(result.opponentId)) return;
    aOpponents.set(result.opponentId, [...(aOpponents.get(result.opponentId) ?? []), result]);
  });
  const common = [...aOpponents.entries()]
    .map(([opponentId, theirs]): CommonOpponent => {
      const opponentRank = rankOf.get(opponentId);
      return {
        opponentId,
        opponentName: nameOf(opponentId),
        ...(opponentRank === undefined ? {} : { opponentRank }),
        a: theirs.sort(byDateDesc),
        b: (bOpponents.get(opponentId) ?? []).sort(byDateDesc),
      };
    })
    .sort(
      (x, y) =>
        rankOr(x.opponentRank, Infinity) - rankOr(y.opponentRank, Infinity) ||
        x.opponentName.localeCompare(y.opponentName)
    );

  return {
    headToHead: a.filter((result) => result.opponentId === bId).sort(byDateDesc),
    common,
    a: side(aId, a),
    b: side(bId, b),
  };
};
