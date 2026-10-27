import { describe, expect, it } from "vitest";
import { rankLineCheck, topOf } from "../rankLineCheck";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../teamRankings";

/*
 * A club's standing line read two ways: its share of the whole board, and its share of the clubs
 * whose web of games reaches the line. Clubs listed last for a short web fill the bottom of the
 * board as the season goes on, and lift every club above them on the first reading alone.
 * Placeholder names throughout.
 */
const PAGE = "ag_10u_2027";
const GROUPS: AgeGroup[] = [
  { id: PAGE, name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] },
];
const club = (id: string): ScoutTeam => ({
  id,
  name: `Club ${id}`,
  state: "KY",
  gcTeams: [{ teamId: `gc-${id}`, name: `Club ${id}`, ageGroupId: PAGE, ageLevel: 10 }],
});

let made = 0;
const game = (a: string, b: string, date: string, runs: [number, number]): ScoutGame => ({
  id: `g${(made += 1)}`,
  ageGroupId: PAGE,
  teamAId: a,
  teamBId: b,
  date,
  teamAScore: runs[0],
  teamBScore: runs[1],
  source: { kind: "gamechanger", teamId: `gc-${a}`, gameId: `x${made}` },
});

// Thirty clubs who all play each other on the first weekend of September: a web of 29 each.
const LEAGUE = Array.from({ length: 30 }, (_, at) => `L${String(at).padStart(2, "0")}`);
const league = LEAGUE.flatMap((a, i) =>
  LEAGUE.slice(i + 1).map((b, j) => game(a, b, "2026-09-05", [6 + ((j + 1) % 3), 3]))
);
// Pairs that only ever played each other, a month on: a web of one club, short of a line of 2.9
// (a tenth of the typical 29).
const PAIRS = Array.from({ length: 6 }, (_, at) => [`P${at}a`, `P${at}b`] as const);
const pairs = PAIRS.map(([a, b]) => game(a, b, "2026-10-03", [12, 0]));
const TEAMS = [...LEAGUE, ...PAIRS.flat()].map(club);

describe("a club's standing line, read two ways", () => {
  it("lifts a club's share of the board as clubs listed last fill its bottom, and not its share of the rest", () => {
    const [before, after] = rankLineCheck(
      PAGE,
      "L06",
      TEAMS,
      [...league, ...pairs],
      GROUPS,
      "fall",
      ["2026-09-12", "2026-10-10"]
    );
    expect(before).toMatchObject({ of: 30, listedLast: 0, proven: 30 });
    expect(after).toMatchObject({ of: 42, listedLast: 12, proven: 30 });
    // The same place among the clubs that reach the line, and the same place on the board...
    expect(after!.provenRank).toBe(before!.provenRank);
    expect(after!.rank).toBe(before!.rank);
    // ...over a bigger board: a better share, without a game played.
    expect(topOf(after!.rank!, after!.of)).toBeLessThan(topOf(before!.rank!, before!.of));
    expect(topOf(after!.provenRank!, after!.proven)).toBe(
      topOf(before!.provenRank!, before!.proven)
    );
  });

  it("lists a club with a short web after every other, whatever its rating says", () => {
    const [after] = rankLineCheck(PAGE, "P0a", TEAMS, [...league, ...pairs], GROUPS, "fall", [
      "2026-10-10",
    ]);
    expect(after!.rank).toBeGreaterThan(30);
    expect(after!.ratingRank).toBeLessThan(after!.rank!);
    expect(after).not.toHaveProperty("provenRank");
  });

  it("says nothing of a day with no board, and reads the share as the card does", () => {
    expect(rankLineCheck(PAGE, "L06", TEAMS, league, GROUPS, "fall", ["2026-08-01"])).toEqual([]);
    expect([topOf(1, 7126), topOf(2737, 7126), topOf(12, 12)]).toEqual([1, 39, 100]);
  });
});
