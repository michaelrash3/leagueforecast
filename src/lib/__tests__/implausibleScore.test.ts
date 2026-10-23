import { describe, expect, it } from "vitest";
import {
  countsTowardRating,
  IMPLAUSIBLE_MARGIN,
  isImplausibleScore,
  RATING_CAP,
  type ScoutGame,
} from "../teamRankings";

/*
 * A win by forty runs or more is suspected of being made up, and counts toward nothing until the
 * user says it is real. The pool of 26 September held one won by 9,999.
 */
const TODAY = "2027-05-01";
const game = (a: number, b: number, over: Partial<ScoutGame> = {}): ScoutGame => ({
  id: "g",
  teamAId: "A",
  teamBId: "B",
  ageGroupId: "ag",
  teamAScore: a,
  teamBScore: b,
  date: "2027-04-12",
  ...over,
});

describe("a score suspected of being made up", () => {
  it("is a win by forty runs or more, either way round", () => {
    expect(IMPLAUSIBLE_MARGIN).toBe(40);
    expect(isImplausibleScore(game(40, 0))).toBe(true);
    expect(isImplausibleScore(game(0, 40))).toBe(true);
    expect(isImplausibleScore(game(0, 9999))).toBe(true);
    // The user's line of 21 October 2026: a 39-run win is a result, however lopsided.
    expect(isImplausibleScore(game(39, 0))).toBe(false);
    expect(isImplausibleScore(game(31, 0))).toBe(false);
    expect(isImplausibleScore(game(3, 2))).toBe(false);
    expect(isImplausibleScore(game(0, 0, { teamAScore: undefined, teamBScore: undefined }))).toBe(
      false
    );
  });

  it("sits past the rating cap, so a win by the cap still counts", () => {
    // The what-if's top rung is a win by the cap, and the method panel's example is a win by the
    // cap and twelve more; a line at or inside either would make them scores nobody believes.
    expect(IMPLAUSIBLE_MARGIN).toBeGreaterThan(RATING_CAP);
    expect(countsTowardRating(game(RATING_CAP, 0), TODAY)).toBe(true);
    expect(countsTowardRating(game(RATING_CAP + 12, 0), TODAY)).toBe(true);
  });

  it("is read as the rating reads a margin, both clubs' reports together", () => {
    // Side A's schedule says 50-0 and side B's 28-0: the rating reads 39, a result.
    expect(
      isImplausibleScore(game(50, 0, { reportedByB: { teamAScore: 28, teamBScore: 0 } }))
    ).toBe(false);
    expect(
      isImplausibleScore(game(50, 0, { reportedByB: { teamAScore: 30, teamBScore: 0 } }))
    ).toBe(true);
  });

  it("counts toward nothing until the user says it is real", () => {
    expect(countsTowardRating(game(9999, 0), TODAY)).toBe(false);
    expect(countsTowardRating(game(39, 0), TODAY)).toBe(true);
    expect(countsTowardRating(game(40, 0), TODAY)).toBe(false);
    expect(countsTowardRating(game(40, 0, { scoreConfirmed: 40 }), TODAY)).toBe(true);
    expect(isImplausibleScore(game(0, 45, { scoreConfirmed: -45 }))).toBe(false);
  });

  it("is suspect again once the score is not the one vouched for", () => {
    // A vouched-for 41-0 corrected or re-pulled as 9,999-0 is a score nobody has vouched for.
    expect(isImplausibleScore(game(9999, 0, { scoreConfirmed: 41 }))).toBe(true);
    expect(countsTowardRating(game(9999, 0, { scoreConfirmed: 41 }), TODAY)).toBe(false);
    // And the margin as the rating reads it, so side B's report moving it counts as a change.
    const vouched = game(50, 0, { reportedByB: { teamAScore: 31, teamBScore: 0 } });
    expect(isImplausibleScore({ ...vouched, scoreConfirmed: 40.5 })).toBe(false);
    expect(
      isImplausibleScore({
        ...vouched,
        scoreConfirmed: 40.5,
        reportedByB: { teamAScore: 33, teamBScore: 0 },
      })
    ).toBe(true);
  });
});
