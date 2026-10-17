import { describe, expect, it } from "vitest";
import {
  CLOSED_START_HALF_GAMES,
  CLOSED_START_RUNS,
  COMMUNITY_RESOLUTION,
  outsideGamesOf,
  scheduleCommunities,
  startingLevel,
  startingLevels,
} from "../scheduleCommunities";
import {
  buildTeamRankings,
  fitScoutYear,
  rowsOfYearFit,
  scheduleComponents,
} from "../teamRankings";
import { gameBreakdown } from "../gameBreakdown";
import { boardFitOf } from "../live/views/board";
import { coerceBoardView } from "../live/views/boardShape";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../teamRankings/types";

type Pair = [string, string];

/** Every two of `names` meeting `rounds` times. */
const roundRobin = (names: readonly string[], rounds: number): Pair[] =>
  names.flatMap((a, i) =>
    names.slice(i + 1).flatMap((b) => Array.from({ length: rounds }, (): Pair => [a, b]))
  );

const communitiesOf = (ids: string[], pairs: Pair[], resolution?: number) =>
  scheduleCommunities(ids, pairs, scheduleComponents(ids, pairs), resolution);

/** Which ids share a community, as sets of ids in the order the communities are numbered. */
const groupsOf = (communities: ReturnType<typeof scheduleCommunities>): string[][] => {
  const groups: string[][] = [];
  communities.of.forEach((c, id) => (groups[c] ??= []).push(id));
  return groups;
};

/** A seeded pool of `groups` leagues of `size` clubs, most games inside a league. */
const leagues = (seed: number, groups: number, size: number, games: number) => {
  let state = seed;
  const next = () => (state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 2 ** 32;
  const ids = Array.from({ length: groups * size }, (_, i) => `c${i}`);
  const pairs: Pair[] = [];
  for (let g = 0; g < games; g += 1) {
    const a = Math.floor(next() * ids.length);
    const b =
      next() < 0.9
        ? Math.floor(a / size) * size + Math.floor(next() * size)
        : Math.floor(next() * ids.length);
    if (a !== b) pairs.push([ids[a]!, ids[b]!]);
  }
  return { ids, pairs, shuffle: () => shuffled(pairs, next) };
};

const shuffled = (pairs: Pair[], next: () => number): Pair[] => {
  const out = pairs.map(([a, b]): Pair => (next() < 0.5 ? [b, a] : [a, b]));
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
};

describe("the schedule's communities", () => {
  const A = ["A1", "A2", "A3", "A4"];
  const B = ["B1", "B2", "B3", "B4"];
  const I = ["I1", "I2", "I3", "I4", "I5", "I6"];
  // Two leagues joined by two games, the largest piece; and an island of two halves of its own.
  const main: Pair[] = [...roundRobin(A, 2), ...roundRobin(B, 2), ["A1", "B1"], ["A2", "B2"]];

  it("splits the largest piece into its leagues and counts each one's games outside it", () => {
    const communities = communitiesOf([...A, ...B], main, 1);
    expect(groupsOf(communities)).toEqual([A, B]);
    expect(communities.outside).toEqual([2, 2]);
    expect(outsideGamesOf(communities, "A3")).toBe(2);
  });

  it("keeps an island whole, however it would split on the largest piece", () => {
    // The island is two round robins joined by one game, which the largest piece's rule splits.
    const island: Pair[] = [...roundRobin(I.slice(0, 3), 2), ...roundRobin(I.slice(3), 2)];
    island.push(["I1", "I4"]);
    const ids = [...A, ...B, ...I];
    const asLargest = communitiesOf(I, island, 1);
    expect(groupsOf(asLargest)).toEqual([I.slice(0, 3), I.slice(3)]);
    const communities = communitiesOf(ids, [...main, ...island], 1);
    expect(groupsOf(communities)).toEqual([A, B, I]);
    expect(communities.outside).toEqual([2, 2, 0]);
  });

  it("reads its resolution against every game the schedule holds, the islands' too", () => {
    // As the back-test measured the starting levels: an island's games add to the total that a
    // community's games are weighed against, so they can join clubs on the largest piece. Alone,
    // the two leagues' games join no two clubs, and the piece is kept whole, as an island is.
    const alone = communitiesOf([...A, ...B], main, 4);
    const besideIsland = communitiesOf([...A, ...B, ...I], [...main, ...roundRobin(I, 1)], 4);
    expect(groupsOf(alone)).toEqual([[...A, ...B]]);
    expect(groupsOf(besideIsland)).toContainEqual(["A3", "A4"]);
  });

  it("are the same whatever order the games come in, and from either side", () => {
    const pool = leagues(7, 12, 25, 1500);
    const once = communitiesOf(pool.ids, pool.pairs);
    // The pool is one that has leagues to find at the resolution the boards use: neither one
    // community nor a club apiece.
    expect(groupsOf(once).length).toBeGreaterThan(5);
    expect(groupsOf(once).length).toBeLessThan(pool.ids.length / 2);
    for (let round = 0; round < 3; round += 1) {
      const again = communitiesOf(pool.ids, pool.shuffle());
      expect(again.of).toEqual(once.of);
      expect(again.outside).toEqual(once.outside);
    }
  });

  it("start every club alike whatever order the games come in, when two pieces tie for largest", () => {
    // Two pieces of eight clubs that never meet, each two leagues of four joined by one game, and
    // thirty pairs of clubs that play each other twenty times, which give the schedule games
    // enough for the resolution to find the leagues. Only the largest piece is split; the other
    // is kept whole, so which of the two is named largest decides whether its clubs start at
    // -1.45 (one game outside each league) or -1.6. The two pieces' ids are interleaved, so that
    // neither piece's root sorts first whatever club it is: broken by root, the tie followed the
    // games' order, and 19 of 40 of these shuffles named the other piece.
    const piece = (odd: number) => {
      const ids = Array.from({ length: 8 }, (_, i) => `c${2 * i + odd}`);
      const pairs = [...roundRobin(ids.slice(0, 4), 2), ...roundRobin(ids.slice(4), 2)];
      pairs.push([ids[0]!, ids[4]!]);
      return { ids, pairs };
    };
    const odd = piece(1);
    const even = piece(0);
    const fillers = Array.from({ length: 30 }, (_, i) => [`f${i}x`, `f${i}y`] as const);
    const ids = [...odd.ids, ...even.ids, ...fillers.flat()];
    const pairs: Pair[] = [
      ...odd.pairs,
      ...even.pairs,
      ...fillers.flatMap(([x, y]) => roundRobin([x, y], 20)),
    ];
    const once = startingLevels(communitiesOf(ids, pairs));
    // The piece holding the smallest id, c0, is the one split.
    expect(even.ids.map((id) => once.get(id))).toEqual(even.ids.map(() => startingLevel(1)));
    expect(odd.ids.map((id) => once.get(id))).toEqual(odd.ids.map(() => CLOSED_START_RUNS));
    let state = 5;
    const next = () => (state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 2 ** 32;
    for (let round = 0; round < 12; round += 1) {
      expect(startingLevels(communitiesOf(ids, shuffled(pairs, next)))).toEqual(once);
    }
  });

  it("are the same every time, numbered by first appearance in the order the nodes came", () => {
    const pool = leagues(11, 8, 30, 1200);
    const first = communitiesOf(pool.ids, pool.pairs);
    expect(communitiesOf(pool.ids, pool.pairs)).toEqual(first);
    let seen = -1;
    first.of.forEach((c) => {
      expect(c).toBeLessThanOrEqual(seen + 1);
      seen = Math.max(seen, c);
    });
    expect(COMMUNITY_RESOLUTION).toBe(20);
  });

  it("keeps the largest piece whole where the resolution finds no league in it, as an island is", () => {
    // Two closed leagues alike but for size, with too few games in the pool for resolution 20 to
    // join any two clubs. Left a club apiece, the larger league's clubs would each count their own
    // games as games outside their league and start at -0.76, while the smaller, an island, starts
    // whole at -1.6: 0.84 runs apart for nothing but which of the two is the larger.
    const big = Array.from({ length: 12 }, (_, i) => `A${i}`);
    const small = Array.from({ length: 11 }, (_, i) => `B${i}`);
    const pairs = [...roundRobin(big, 1), ...roundRobin(small, 1)];
    const communities = communitiesOf([...big, ...small], pairs);
    expect(groupsOf(communities)).toEqual([big, small]);
    expect(communities.outside).toEqual([0, 0]);
    expect(new Set(startingLevels(communities).values())).toEqual(new Set([CLOSED_START_RUNS]));
  });

  it("puts a club no game names in none, so it starts at average", () => {
    const communities = communitiesOf([...A, "idle"], roundRobin(A, 1));
    expect(communities.of.has("idle")).toBe(false);
    expect(outsideGamesOf(communities, "idle")).toBeUndefined();
    expect(startingLevels(communities).has("idle")).toBe(false);
  });
});

describe("where a league starts", () => {
  it("starts a league with no outside games at the full level, halved at ten, near average at hundreds", () => {
    expect(startingLevel(0)).toBe(CLOSED_START_RUNS);
    expect(startingLevel(CLOSED_START_HALF_GAMES)).toBe(CLOSED_START_RUNS / 2);
    expect(startingLevel(311)).toBeGreaterThan(-0.05);
    expect([CLOSED_START_RUNS, CLOSED_START_HALF_GAMES]).toEqual([-1.6, 10]);
  });

  it("gives every node of a community its community's level", () => {
    const ids = ["A1", "A2", "A3", "B1", "B2", "B3"];
    const pairs: Pair[] = [
      ...roundRobin(["A1", "A2", "A3"], 3),
      ...roundRobin(["B1", "B2", "B3"], 3),
      ["A1", "B1"],
    ];
    const levels = startingLevels(communitiesOf(ids, pairs, 1));
    expect([...levels.values()]).toEqual(ids.map(() => startingLevel(1)));
  });
});

describe("the starting level in the ranking paths", () => {
  const group: AgeGroup = { id: "g", name: "12U 2026", ageLevel: 12, year: 2026, seasonIds: [] };
  const clubs: ScoutTeam[] = [
    ...["M1", "M2", "M3", "M4", "M5"].map((id) => ({ id, name: `Main ${id}` })),
    ...["L1", "L2", "L3", "L4"].map((id) => ({ id, name: `Loop ${id}` })),
  ];
  let at = 0;
  const played = (a: string, b: string, aScore: number, bScore: number): ScoutGame => ({
    id: `g${(at += 1)}`,
    teamAId: a,
    teamBId: b,
    ageGroupId: group.id,
    date: "2026-05-01",
    teamAScore: aScore,
    teamBScore: bScore,
  });
  // Five clubs in the largest piece, with results; four in a loop of ties that plays nobody else.
  const games: ScoutGame[] = [
    ...roundRobin(["M1", "M2", "M3", "M4", "M5"], 1).map(([a, b], i) =>
      played(a, b, 3 + (i % 4), 2)
    ),
    ...roundRobin(["L1", "L2", "L3", "L4"], 3).map(([a, b]) => played(a, b, 4, 4)),
  ];
  const rated = games.map((game) => ({ game, ageGap: 0 }));

  it("starts a loop that plays nobody else 1.6 runs below average, and its ties keep it there", () => {
    const fit = fitScoutYear(2026, clubs, games, rated, [group]);
    const rows = rowsOfYearFit(fit, group.id, undefined, [group]);
    const loop = rows.filter((row) => row.teamId.startsWith("L"));
    expect(loop).toHaveLength(4);
    for (const row of loop) {
      expect(row.levelPrior).toBe(CLOSED_START_RUNS);
      expect(row.outsideGames).toBe(0);
      expect(row.pointRating).toBeCloseTo(CLOSED_START_RUNS, 12);
      expect(row.comparable).toBe(false);
      expect(row.record).toBe("0-0-9");
    }
    // The largest piece is held to the mean of its own clubs' starts, whatever the loop's are.
    const main = rows.filter((row) => row.teamId.startsWith("M"));
    const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
    expect(mean(main.map((row) => row.pointRating))).toBeCloseTo(
      mean(main.map((row) => row.levelPrior!)),
      12
    );
  });

  it("starts two closed leagues of a small pool alike, whichever is the larger", () => {
    // Clubs 0 of each league win every game by a run; the rest tie. Both leagues are closed, so
    // both start at the full level, say so on their rows, and average exactly that.
    const big = Array.from({ length: 12 }, (_, i) => `A${i}`);
    const small = Array.from({ length: 11 }, (_, i) => `B${i}`);
    const teams: ScoutTeam[] = [...big, ...small].map((id) => ({ id, name: `Club ${id}` }));
    const leagueGames = [...roundRobin(big, 1), ...roundRobin(small, 1)].map(([a, b]) =>
      played(a, b, a === big[0] || a === small[0] ? 3 : 2, 2)
    );
    const rows = buildTeamRankings(group.id, teams, leagueGames);
    const mean = (ids: string[]) =>
      ids.reduce((sum, id) => sum + rows.find((row) => row.teamId === id)!.pointRating, 0) /
      ids.length;
    for (const row of rows) {
      expect(row.levelPrior).toBe(CLOSED_START_RUNS);
      expect(row.outsideGames).toBe(0);
    }
    expect(mean(big)).toBeCloseTo(CLOSED_START_RUNS, 12);
    expect(mean(small)).toBeCloseTo(CLOSED_START_RUNS, 12);
  });

  it("agrees in the direct and cached-year ranking paths", () => {
    const pooled = buildTeamRankings(group.id, clubs, games, undefined, [group]);
    const direct = buildTeamRankings(group.id, clubs, games);
    expect(pooled).toHaveLength(clubs.length);
    for (const row of pooled) {
      const same = direct.find((other) => other.teamId === row.teamId)!;
      expect(row.levelPrior).toBe(same.levelPrior);
      expect(row.outsideGames).toBe(same.outsideGames);
      expect(row.pointRating).toBeCloseTo(same.pointRating, 12);
      expect(row.rating).toBeCloseTo(same.rating, 12);
    }
  });

  it("keeps game explanations available after the row is published and read back", () => {
    const fit = fitScoutYear(2026, clubs, games, rated, [group]);
    const rows = rowsOfYearFit(fit, group.id, undefined, [group]);
    const board = coerceBoardView(
      JSON.parse(
        JSON.stringify({
          rows: rows.map(({ isMine: _mine, ...row }) => row),
          fit: boardFitOf(fit, rows, "2026-05-31"),
        })
      )
    );
    expect(board).not.toBeNull();
    const breakdownOf = (teamId: string) =>
      gameBreakdown({
        teamId,
        games: games.filter((game) => game.teamAId === teamId || game.teamBId === teamId),
        pageId: group.id,
        ageGroups: [group],
        segment: undefined,
        board: board!,
      });
    const loop = breakdownOf("L1");
    expect(loop?.levelPrior).toBe(CLOSED_START_RUNS);
    expect(loop?.outsideGames).toBe(0);
    expect(loop?.lines.size).toBe(9);
    const club = breakdownOf("M1");
    expect(club?.levelPrior).toBe(startingLevel(club?.outsideGames ?? Number.NaN));
    expect(club?.lines.size).toBe(4);
  });
});
