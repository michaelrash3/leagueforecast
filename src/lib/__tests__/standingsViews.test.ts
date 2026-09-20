import { describe, expect, it } from "vitest";
import {
  BUBBLE_ABOVE,
  BUBBLE_BELOW,
  headToHeadCell,
  sosRanks,
  teamsOnBubble,
} from "../standingsViews";

/**
 * Three rules the standings views read off the table. All three were closures inside the
 * component, none of them guarded, and two of them carry numbers — how wide the bubble is, which
 * way an empty record falls — that this project's own rule says to pin before anybody moves them.
 */
const record = (wins: number, losses: number, ties = 0) => ({ wins, losses, ties });

describe("one cell of the head-to-head matrix", () => {
  it("calls a team against itself what it is", () => {
    expect(headToHeadCell(record(3, 1), "A", "A")).toBe("self");
  });

  it("reads the season, not the last game", () => {
    expect(headToHeadCell(record(2, 1), "A", "B")).toBe("win");
    expect(headToHeadCell(record(1, 2), "A", "B")).toBe("loss");
    expect(headToHeadCell(record(2, 2), "A", "B")).toBe("tie");
  });

  it("counts a drawn game as level, not as nothing", () => {
    expect(headToHeadCell(record(0, 0, 1), "A", "B")).toBe("tie");
  });

  it("calls an empty record nothing, rather than a tie", () => {
    /*
     * Two different things draw the same and must: two clubs that have not met, and a record that
     * exists but is empty. The second happens — a record is made when a game is booked and can be
     * left at 0-0-0 by a game later removed — and reading it as a tie would claim a game that was
     * played and finished level.
     */
    expect(headToHeadCell(undefined, "A", "B")).toBe("none");
    expect(headToHeadCell(record(0, 0, 0), "A", "B")).toBe("none");
  });
});

describe("ranking by strength of schedule", () => {
  it("puts the hardest schedule first, counting from one", () => {
    const ranks = sosRanks([
      { id: "A", sos: 0.2 },
      { id: "B", sos: 1.4 },
      { id: "C", sos: -0.6 },
    ]);
    expect(ranks).toEqual({ B: 1, A: 2, C: 3 });
  });

  it("gives two equal schedules two different places, in the order given", () => {
    // "You have played the Nth hardest schedule" is a sentence two teams cannot both be third in.
    const ranks = sosRanks([
      { id: "A", sos: 1 },
      { id: "B", sos: 1 },
    ]);
    expect([ranks.A, ranks.B].sort()).toEqual([1, 2]);
  });

  it("does not reorder the array it was handed", () => {
    const teams = [
      { id: "A", sos: 0 },
      { id: "B", sos: 5 },
    ];
    sosRanks(teams);
    expect(teams.map((team) => team.id)).toEqual(["A", "B"]);
  });
});

describe("who is on the bubble", () => {
  const seeded = (...ranks: number[]) => ranks.map((projectedRank) => ({ projectedRank }));

  it("reaches two seeds inside the line and three outside it", () => {
    // Wider below than above, deliberately: a team two seeds inside is nearly safe and mostly
    // wants to know it; a team three seeds outside is the one still playing for it.
    expect(BUBBLE_ABOVE).toBe(2);
    expect(BUBBLE_BELOW).toBe(3);
    const rows = seeded(1, 2, 3, 4, 5, 6, 7, 8, 9);
    expect(teamsOnBubble(rows, 4).map((team) => team.projectedRank)).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it("leaves out a team with no projected seed at all", () => {
    const rows = [{ projectedRank: 4 }, {}];
    expect(teamsOnBubble(rows, 4)).toHaveLength(1);
  });

  it("means the same thing in a small league as a large one", () => {
    // Seeds rather than games, so a six-team league and a sixteen read alike.
    expect(teamsOnBubble(seeded(1, 2, 3, 4, 5, 6), 2).map((t) => t.projectedRank)).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });
});
