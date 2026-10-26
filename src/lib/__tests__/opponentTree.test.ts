import { describe, expect, it } from "vitest";
import { opponentTree, REACH_CAP, reachPercentiles } from "../../../scripts/opponentTree";

/* How far a club's web of games reaches (`scripts/opponentTree.ts`), the owner's question. */

const game = (a: string, b: string) => ({ teamAId: a, teamBId: b });

describe("the opponent tree", () => {
  // A closed league of four, one of which played a club that played two more.
  const games = [
    game("L1", "L2"),
    game("L1", "L3"),
    game("L2", "L3"),
    game("L3", "L4"),
    game("L1", "L2"),
    game("L4", "X"),
    game("X", "Y"),
    game("X", "Z"),
  ];
  const reach = opponentTree(games);

  it("counts the distinct clubs within each distance, the club itself left out", () => {
    expect([1, 2, 3, 4].map((hops) => reach("L1", hops))).toEqual([2, 3, 4, 6]);
    expect([1, 2, 3].map((hops) => reach("X", hops))).toEqual([3, 4, 6]);
    expect(reach("nobody", 3)).toBe(0);
  });

  it("stops counting at the cap", () => {
    const star = Array.from({ length: REACH_CAP + 50 }, (_, at) => game("hub", `c${at}`));
    expect(opponentTree(star)("hub", 1)).toBe(REACH_CAP);
  });

  it("reads percentiles by nearest rank", () => {
    expect(reachPercentiles([5, 1, 4, 2, 3, 10, 9, 8, 7, 6])).toEqual({ p10: 1, p25: 3, p50: 5 });
    expect(reachPercentiles([])).toBeUndefined();
  });
});
