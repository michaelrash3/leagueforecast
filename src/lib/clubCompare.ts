import { scoreSeenBy, type ScoutGame, type ScoutRankingRow } from "./teamRankings";
import { byGameTimeNewest } from "./gameTime";

/** One game from one club's side: who, when, the score as its own schedule gave it. */
export type ClubResult = {
  gameId: string;
  date: string;
  /** When it started, where GameChanger said: a day's games go in that order. */
  startTs?: string;
  opponentId: string;
  opponentName: string;
  /** The opponent's place on this board, when it has one. */
  opponentRank?: number;
  runsFor: number;
  runsAgainst: number;
  /** Runs for less runs against: a win above zero. */
  margin: number;
};

/** A record, as W-L-T counts. */
export type Record3 = { wins: number; losses: number; ties: number };

export type ClubSide = {
  teamId: string;
  /** Runs scored and allowed a game, and the margin, over the games counted; null with none. */
  profile: { games: number; runsFor: number; runsAgainst: number; margin: number } | null;
  /**
   * The record against opponents rated more than `SIMILAR_BAND` runs above the club, within it,
   * and more than it below; null where the club has no rating on the board to measure by.
   */
  split: { stronger: Record3; similar: Record3; weaker: Record3 } | null;
  /** The last five results' letters, newest first: "WWLWT". */
  form: string;
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
  /**
   * How much better the first club did than the second against the clubs both have played: each
   * common opponent's margin for the first less the second's (each an average where a club met it
   * twice), averaged over the opponents. Positive favours the first; null with none in common.
   */
  commonEdge: number | null;
  a: ClubSide;
  b: ClubSide;
};

/** How many of each list a side shows. */
export const COMPARE_LIST = 3;
export const COMPARE_RECENT = 5;
/**
 * How near an opponent's rating must be to the club's own to count as similar, in runs: about a
 * third of the odds curve's spread at 12U (`matchupOddsSpread`), where a matchup reads 60-40 or
 * closer. An opponent further above is stronger, further below weaker.
 */
export const SIMILAR_BAND = 1.5;

const letterOf = (result: ClubResult) => (result.margin > 0 ? "W" : result.margin < 0 ? "L" : "T");
const tally = (results: readonly ClubResult[]): Record3 => ({
  wins: results.filter((result) => result.margin > 0).length,
  losses: results.filter((result) => result.margin < 0).length,
  ties: results.filter((result) => result.margin === 0).length,
});
const mean = (values: readonly number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * Newest first, two results of one day in the order the games are given: the pool's, as a club's
 * panel lists them (`gamesForTeam`). It broke such a tie by game id, which put the same two games
 * in another order than the panel did, and an order nothing but the stored ids could give: Scouting
 * on the live board reads a club's games off its card, whose ids are only their places
 * (`scoutingFromCards.ts`), in the pool's order.
 */
const byDateDesc = (x: ClubResult, y: ClubResult) => byGameTimeNewest(x, y);
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
  const ratingOf = new Map(rows.map((row) => [row.teamId, row.rating]));
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
          ...(game.startTs ? { startTs: game.startTs } : {}),
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
    profile:
      results.length === 0
        ? null
        : {
            games: results.length,
            runsFor: mean(results.map((result) => result.runsFor)),
            runsAgainst: mean(results.map((result) => result.runsAgainst)),
            margin: mean(results.map((result) => result.margin)),
          },
    split: (() => {
      const own = ratingOf.get(teamId);
      if (own === undefined) return null;
      // An opponent the board has no rating for is in none of the three.
      const rated = results.filter((result) => ratingOf.has(result.opponentId));
      const gap = (result: ClubResult) => (ratingOf.get(result.opponentId) ?? own) - own;
      return {
        stronger: tally(rated.filter((result) => gap(result) > SIMILAR_BAND)),
        similar: tally(rated.filter((result) => Math.abs(gap(result)) <= SIMILAR_BAND)),
        weaker: tally(rated.filter((result) => gap(result) < -SIMILAR_BAND)),
      };
    })(),
    form: [...results].sort(byDateDesc).slice(0, COMPARE_RECENT).map(letterOf).join(""),
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
    commonEdge:
      common.length === 0
        ? null
        : mean(
            common.map(
              (opponent) =>
                mean(opponent.a.map((result) => result.margin)) -
                mean(opponent.b.map((result) => result.margin))
            )
          ),
    a: side(aId, a),
    b: side(bId, b),
  };
};
