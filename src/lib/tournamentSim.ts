import { hashSeed, makeRandom } from "./sim";
import { predictMatchup, type ScoutRankingRow } from "./teamRankings";

/** How an event is played: pools of round robin, then a single-elimination bracket for the top. */
export type TournamentFormat = { pools: number; advance: number };

/** One club's chances at the event, and where the draw put it. */
export type TournamentOdds = {
  teamId: string;
  teamName: string;
  rank: number;
  rating: number;
  /** Which pool, from 1, by the snake draw on rating. */
  pool: number;
  winPool: number;
  reachFinal: number;
  win: number;
  /**
   * True for a club whose rating was worked out against a different set of teams from most of the
   * field (`componentId`): nothing joins them, so its odds against the rest are a guess.
   */
  apart: boolean;
};

export type TournamentResult = {
  /** Every club, most likely winner first. */
  field: TournamentOdds[];
  /** How strong the field is: its average rating and national rank, and its best club's rank. */
  strength: { averageRating: number; averageRank: number; bestRank: number };
  format: TournamentFormat;
  iterations: number;
};

export const TOURNAMENT_ITERATIONS = 2000;

const powerOfTwoAtMost = (n: number): number => {
  let size = 1;
  while (size * 2 <= n) size *= 2;
  return size;
};

/**
 * A format the field can actually be played in: pools of at least two, and a bracket of two, four
 * or eight that is no bigger than the field.
 */
export const fitFormat = (format: TournamentFormat, size: number): TournamentFormat => ({
  pools: Math.max(1, Math.min(Math.round(format.pools), Math.floor(size / 2))),
  advance: Math.max(2, Math.min(8, powerOfTwoAtMost(Math.min(Math.round(format.advance), size)))),
});

/** Seeds 1..n in the order a standard bracket pairs them: 1 v n, then the halves, and so on. */
const bracketOrder = (size: number): number[] => {
  if (size <= 1) return [1];
  const previous = bracketOrder(size / 2);
  return previous.flatMap((seed) => [seed, size + 1 - seed]);
};

/**
 * The event played out many times over, on the board's ratings.
 *
 * The field is drawn into pools by rating, snaking so each pool gets one of the best and one of
 * the worst, as organisers do. Every pool plays a round robin; the clubs with the most pool wins
 * go through to a single-elimination bracket of `advance`, seeded on those wins, and each game is
 * won with the chance the scouting report gives it (`predictMatchup`). Ties on wins are settled by
 * a draw, because a tournament's run-differential rules are its own and a margin is not what the
 * odds are built on. Seeded from the field and the format, so the same event reads the same
 * numbers every time it is opened.
 */
export const simulateTournament = (
  rows: readonly ScoutRankingRow[],
  format: TournamentFormat,
  iterations: number = TOURNAMENT_ITERATIONS
): TournamentResult | null => {
  if (rows.length < 2) return null;
  const fitted = fitFormat(format, rows.length);
  const entries = [...rows].sort((a, b) => b.rating - a.rating || a.rank - b.rank);
  const poolOf = entries.map((_, at) => {
    const round = Math.floor(at / fitted.pools);
    const place = at % fitted.pools;
    return round % 2 === 0 ? place : fitted.pools - 1 - place;
  });
  const pools = Array.from({ length: fitted.pools }, (_, pool) =>
    entries.map((_, at) => at).filter((at) => poolOf[at] === pool)
  );
  const counts = entries.map(() => ({ winPool: 0, reachFinal: 0, win: 0 }));
  const random = makeRandom(
    hashSeed(`${entries.map((row) => row.teamId).join(",")}|${fitted.pools}|${fitted.advance}`)
  );
  const beats = (a: number, b: number): boolean => {
    const x = entries[a]!;
    const y = entries[b]!;
    return random() < predictMatchup(x.rating, y.rating, x.ageLevel ?? y.ageLevel).winProbA;
  };
  const order = bracketOrder(fitted.advance);

  for (let run = 0; run < iterations; run += 1) {
    const wins = entries.map(() => 0);
    const draw = entries.map(() => random());
    pools.forEach((members) => {
      for (let i = 0; i < members.length; i += 1) {
        for (let j = i + 1; j < members.length; j += 1) {
          const a = members[i]!;
          const b = members[j]!;
          if (beats(a, b)) wins[a]! += 1;
          else wins[b]! += 1;
        }
      }
      const top = [...members].sort((a, b) => wins[b]! - wins[a]! || draw[a]! - draw[b]!)[0];
      if (top !== undefined) counts[top]!.winPool += 1;
    });
    const seeded = entries
      .map((_, at) => at)
      .sort((a, b) => wins[b]! - wins[a]! || draw[a]! - draw[b]!)
      .slice(0, fitted.advance);
    let alive = order.map((seed) => seeded[seed - 1]!);
    while (alive.length > 1) {
      if (alive.length === 2) {
        counts[alive[0]!]!.reachFinal += 1;
        counts[alive[1]!]!.reachFinal += 1;
      }
      const next: number[] = [];
      for (let at = 0; at < alive.length; at += 2) {
        const a = alive[at]!;
        const b = alive[at + 1]!;
        next.push(beats(a, b) ? a : b);
      }
      alive = next;
    }
    if (alive[0] !== undefined) counts[alive[0]]!.win += 1;
  }

  const pieces = new Map<string, number>();
  entries.forEach((row) => pieces.set(row.componentId, (pieces.get(row.componentId) ?? 0) + 1));
  const mainPiece = [...pieces.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const field = entries
    .map((row, at): TournamentOdds => ({
      teamId: row.teamId,
      teamName: row.teamName,
      rank: row.overallRank ?? row.rank,
      rating: row.rating,
      pool: poolOf[at]! + 1,
      winPool: counts[at]!.winPool / iterations,
      reachFinal: counts[at]!.reachFinal / iterations,
      win: counts[at]!.win / iterations,
      apart: row.componentId !== mainPiece,
    }))
    .sort((a, b) => b.win - a.win || a.rank - b.rank);
  const ranks = field.map((row) => row.rank);
  return {
    field,
    strength: {
      averageRating: entries.reduce((sum, row) => sum + row.rating, 0) / entries.length,
      averageRank: ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length,
      bestRank: Math.min(...ranks),
    },
    format: fitted,
    iterations,
  };
};
