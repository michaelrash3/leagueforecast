import { describe, expect, it } from "vitest";
import type { Breakdown, GameLine } from "../../gameBreakdown";
import { GAME_NOTES_KEY, gameClauses, gameNotesOf, ratingHeadline } from "../gameWords";

/*
 * What a club's panel says of each counted game (`gameWords`): every wording the panel can draw,
 * the header's parts rounded to add up on screen, "your" for the page's own club against "its" for
 * any other, and no hedging anywhere.
 */

const CAP = 12;

/** A plain counted game: a 6-run win, nothing about it to explain. */
const line = (more: Partial<GameLine> = {}): GameLine => ({
  playedLike: 8.13,
  moved: 0.31,
  scorePart: 0.22,
  recordPart: 0.09,
  counted: 6,
  shownMargin: 6,
  ageRuns: 0,
  levelsUp: 0,
  ...more,
});
const its = (more: Partial<GameLine> = {}) => gameClauses(line(more), { own: false, cap: CAP });
const your = (more: Partial<GameLine> = {}) => gameClauses(line(more), { own: true, cap: CAP });

describe("the line above a club's games", () => {
  it("splits the rating into its games and its record, fuller or thinner than most", () => {
    expect(
      ratingHeadline({ rating: 2.8, pointRating: 2.5 }, { span: "Fall 2026", own: true })
    ).toBe(
      "Fall 2026 rating +2.8: +2.5 from your games, +0.3 because your record is fuller than most."
    );
    expect(
      ratingHeadline({ rating: 2.1, pointRating: 2.5 }, { span: "Fall 2026", own: false })
    ).toBe(
      "Fall 2026 rating +2.1: +2.5 from its games, -0.4 because its record is thinner than most."
    );
    expect(
      ratingHeadline({ rating: -1.3, pointRating: -1.6 }, { span: "Season", own: false })
    ).toBe("Season rating -1.3: -1.6 from its games, +0.3 because its record is fuller than most.");
  });

  it("says all of it is from the club's games when the record's part rounds to nothing", () => {
    expect(
      ratingHeadline({ rating: 2.81, pointRating: 2.79 }, { span: "Fall 2026", own: false })
    ).toBe("Fall 2026 rating +2.8, all of it from its games.");
    expect(
      ratingHeadline({ rating: 0.02, pointRating: -0.03 }, { span: "Season", own: true })
    ).toBe("Season rating 0.0, all of it from your games.");
  });

  it("rounds the parts so they add up to the rating shown", () => {
    // 2.849 shows as +2.8 and 2.551 as +2.6: the record's part is shown as +0.2, which adds up on
    // screen, though the two differ by 0.298.
    expect(
      ratingHeadline({ rating: 2.849, pointRating: 2.551 }, { span: "Spring 2027", own: false })
    ).toBe(
      "Spring 2027 rating +2.8: +2.6 from its games, +0.2 because its record is fuller than most."
    );
    // A record part of 0.06 between two ratings that round alike adds nothing on screen.
    expect(
      ratingHeadline({ rating: 1.04, pointRating: 0.98 }, { span: "Spring 2027", own: false })
    ).toBe("Spring 2027 rating +1.0, all of it from its games.");
  });
});

describe("what each game did", () => {
  it("says what the club played like and what the game moved its rating", () => {
    expect(its()).toEqual(["Played like +8.1", "moved its rating +0.3"]);
    expect(your()).toEqual(["Played like +8.1", "moved your rating +0.3"]);
    expect(its({ playedLike: -3.46, moved: -0.24, scorePart: -0.3, recordPart: 0.06 })).toEqual([
      "Played like -3.5",
      "moved its rating -0.2",
    ]);
    expect(its({ playedLike: 0.04 })[0]).toBe("Played like 0.0");
  });

  it("says a move that rounds to nothing is less than a tenth", () => {
    expect(your({ moved: 0.049, scorePart: 0.01 })[1]).toBe("moved your rating less than 0.1");
    expect(its({ moved: -0.04, scorePart: -0.045 })[1]).toBe("moved its rating less than 0.1");
  });

  it("says both parts when the score's reads as a fall and the whole does not, adding up", () => {
    expect(your({ moved: 0.12, scorePart: -0.08, recordPart: 0.2 })[1]).toBe(
      "moved your rating +0.1 (score -0.1, one more game +0.2)"
    );
    // The record's part, 0.28, would round to +0.3 on its own; shown as what the whole leaves
    // once the score's is taken off, so the three add up on screen.
    expect(its({ moved: 0.14, scorePart: -0.14, recordPart: 0.28 })[1]).toBe(
      "moved its rating +0.1 (score -0.1, one more game +0.2)"
    );
    expect(its({ moved: 0.03, scorePart: -0.11, recordPart: 0.14 })[1]).toBe(
      "moved its rating less than 0.1 (score -0.1, one more game +0.1)"
    );
    // Not when the whole reads as a fall too, nor when the score's part rounds to nothing.
    expect(its({ moved: -0.14, scorePart: -0.3, recordPart: 0.16 })[1]).toBe(
      "moved its rating -0.1"
    );
    expect(its({ moved: 0.21, scorePart: -0.04, recordPart: 0.25 })[1]).toBe(
      "moved its rating +0.2"
    );
  });

  it("says a margin held to the most one game counts", () => {
    expect(its({ counted: 12, shownMargin: 14 })[2]).toBe(
      "counted as a 12-run win, the most one game counts"
    );
    expect(your({ counted: -12, shownMargin: -15 })[2]).toBe(
      "counted as a 12-run loss, the most one game counts"
    );
    // A 12-run win is counted as it is, with nothing to explain.
    expect(its({ counted: 12, shownMargin: 12 })).toHaveLength(2);
  });

  it("says a margin the two schedules' scores were averaged into", () => {
    expect(its({ counted: 1.5, shownMargin: 3 })[2]).toBe(
      "counted as a 1.5-run win, the two schedules' scores averaged"
    );
    expect(its({ counted: -0.5, shownMargin: 1 })[2]).toBe(
      "counted as a 0.5-run loss, the two schedules' scores averaged"
    );
    expect(its({ counted: 0, shownMargin: 2 })[2]).toBe(
      "counted as a tie, the two schedules' scores averaged"
    );
    // Averaged past the cap from a score inside it: the other schedule's score took it there.
    expect(its({ counted: 12, shownMargin: 11 })[2]).toBe(
      "counted as a 12-run win, the two schedules' scores averaged and held to the most one game counts"
    );
  });

  it("says the runs a game against another age level gave or took", () => {
    expect(its({ ageRuns: -2, levelsUp: 1 })[2]).toBe("2 runs added for playing a year up");
    expect(its({ ageRuns: 2, levelsUp: -1 })[2]).toBe("2 runs taken off for playing a year down");
    expect(its({ ageRuns: -4, levelsUp: 2 })[2]).toBe("4 runs added for playing two years up");
    // After the margin's clause, where both apply.
    expect(its({ ageRuns: 2, levelsUp: -1, counted: 12, shownMargin: 13 })).toEqual([
      "Played like +8.1",
      "moved its rating +0.3",
      "counted as a 12-run win, the most one game counts",
      "2 runs taken off for playing a year down",
    ]);
  });
});

describe("everything a panel is handed", () => {
  it("gives each game its clauses, the headline and the key", () => {
    const breakdown: Breakdown = {
      rating: 1.43,
      pointRating: 1.21,
      lines: new Map([
        ["0", line()],
        ["3", line({ counted: 12, shownMargin: 15 })],
      ]),
    };
    const notes = gameNotesOf(breakdown, { span: "Fall 2026", own: false, cap: CAP });
    expect(notes.headline).toBe(
      "Fall 2026 rating +1.4: +1.2 from its games, +0.2 because its record is fuller than most."
    );
    expect(notes.key).toBe(GAME_NOTES_KEY);
    expect([...notes.byGame]).toEqual([
      ["0", ["Played like +8.1", "moved its rating +0.3"]],
      [
        "3",
        [
          "Played like +8.1",
          "moved its rating +0.3",
          "counted as a 12-run win, the most one game counts",
        ],
      ],
    ]);
  });

  it("never hedges a figure", () => {
    const said = [
      GAME_NOTES_KEY,
      ratingHeadline({ rating: 2.8, pointRating: 2.5 }, { span: "Season", own: true }),
      ...your({ moved: 0.03, scorePart: -0.11 }),
      ...its({ counted: 12, shownMargin: 11, ageRuns: -2, levelsUp: 1 }),
      ...its({ counted: 1.5, shownMargin: 3 }),
    ].join(" ");
    expect(said).not.toMatch(/\b(about|roughly|estimated?|guess|approximately|around)\b/i);
  });
});
