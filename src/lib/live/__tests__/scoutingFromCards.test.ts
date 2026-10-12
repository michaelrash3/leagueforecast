import { describe, expect, it } from "vitest";
import type { ScoutGame } from "../../teamRankings";
import { gamesOfTwo } from "../scoutingFromCards";

/*
 * Two clubs' games off their cards, each game once (`gamesOfTwo`): what `scoutingParity.test.ts`
 * reads through `compareClubs`, here on its own, with the case consistent cards never give.
 */

const game = (id: string, a: string, b: string): ScoutGame => ({
  id,
  teamAId: a,
  teamBId: b,
  ageGroupId: "ag_10u_2027",
});

describe("two clubs' games off their cards", () => {
  it("keeps each club's own order, and takes a meeting once, from the first club's card", () => {
    const a = [game("0", "A", "X"), game("1", "A", "B"), game("2", "Y", "A")];
    const b = [game("0", "B", "Z"), game("1", "A", "B"), game("2", "B", "W")];
    expect(
      gamesOfTwo(a, "A", b, "B").map((one) => `${one.id}:${one.teamAId}-${one.teamBId}`)
    ).toEqual(["a0:A-X", "b0:B-Z", "a1:A-B", "a2:Y-A", "b2:B-W"]);
  });

  it("never takes a meeting off the second club's card, even one the first club's lacks", () => {
    const a = [game("0", "A", "X")];
    const b = [game("0", "A", "B"), game("1", "B", "W")];
    expect(gamesOfTwo(a, "A", b, "B").map((one) => one.id)).toEqual(["a0", "b1"]);
  });
});
