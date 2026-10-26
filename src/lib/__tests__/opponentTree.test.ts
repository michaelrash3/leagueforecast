import { describe, expect, it } from "vitest";
import {
  chainsFrom,
  opponentTree,
  REACH_CAP,
  reachPercentiles,
  typicalReach,
} from "../../../scripts/opponentTree";

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

  it("counts every distance in one walk, the same however it is asked", () => {
    const walked = opponentTree(games);
    // Five out first, then the nearer distances from what that walk remembered.
    expect(walked("L1", 5)).toBe(6);
    expect([1, 2, 3, 4].map((hops) => walked("L1", hops))).toEqual([2, 3, 4, 6]);
    expect(walked("L1", 0)).toBe(0);
    // A web with nowhere left to go stays put however far out it is asked.
    expect(walked("Y", 9)).toBe(6);
  });

  it("reads the typical club's web, the median over every club the games name", () => {
    const typical = typicalReach(games, opponentTree(games));
    // Within one: Y and Z 1, L1, L2 and L4 2, L3 and X 3; the fourth of seven is 2.
    expect(typical(1)).toBe(2);
    // Within two: L1, L2, Y and Z 3, L3 and X 4, L4 6.
    expect(typical(2)).toBe(3);
    expect(typicalReach([], opponentTree([]))(3)).toBe(0);
  });

  it("finds the shortest chain of games between two clubs, within a distance", () => {
    const chainTo = chainsFrom(games, "L1", 4);
    expect(chainTo("L1")).toEqual(["L1"]);
    expect(chainTo("L4")).toEqual(["L1", "L3", "L4"]);
    expect(chainTo("Z")).toEqual(["L1", "L3", "L4", "X", "Z"]);
    expect(chainTo("nobody")).toBeUndefined();
    // Four games out reaches Z; three does not.
    expect(chainsFrom(games, "L1", 3)("Z")).toBeUndefined();
    expect(chainsFrom(games, "L1", 3)("X")).toEqual(["L1", "L3", "L4", "X"]);
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
