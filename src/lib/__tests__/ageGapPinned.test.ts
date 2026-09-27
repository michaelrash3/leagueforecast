import { describe, expect, it } from "vitest";
import { buildOpponentAdjustedRatings, type RatingGame } from "../powerRating";

/*
 * A small pool across two levels, rated with the default options, to the digit.
 *
 * Three 9Us and three 10Us, a round of same-level games at each level and five games across, two
 * of them a 9U playing up and winning. Pinned so any change to what a year of age is worth, or to
 * how it is reached, shows here as the numbers it moves.
 */
const games: RatingGame[] = [
  { home: "A9", away: "B9", homeMargin: 4, neutral: true },
  { home: "B9", away: "C9", homeMargin: 1, neutral: true },
  { home: "C9", away: "A9", homeMargin: -6, neutral: true },
  { home: "X10", away: "Y10", homeMargin: 2, neutral: true },
  { home: "Y10", away: "Z10", homeMargin: 5, neutral: true },
  { home: "Z10", away: "X10", homeMargin: -3, neutral: true },
  { home: "X10", away: "A9", homeMargin: -1, neutral: true, ageGap: 1 },
  { home: "Y10", away: "A9", homeMargin: -2, neutral: true, ageGap: 1 },
  { home: "X10", away: "B9", homeMargin: 3, neutral: true, ageGap: 1 },
  { home: "Z10", away: "C9", homeMargin: 7, neutral: true, ageGap: 1 },
  { home: "Y10", away: "C9", homeMargin: 5, neutral: true, ageGap: 1 },
];
const ids = ["A9", "B9", "C9", "X10", "Y10", "Z10"];

describe("a small cross-age pool, pinned", () => {
  it("rates each club and a year of age as it did", () => {
    const out = buildOpponentAdjustedRatings(ids, games);
    const round = (value: number) => Number(value.toFixed(6));
    expect(round(out.ageGapRuns)).toMatchInlineSnapshot(`2.061558`);
    expect(Object.fromEntries(ids.map((id) => [id, round(out.ratings.get(id)!)])))
      .toMatchInlineSnapshot(`
      {
        "A9": 2.7806,
        "B9": -0.612854,
        "C9": -2.413979,
        "X10": 0.813979,
        "Y10": 0.383037,
        "Z10": -0.950783,
      }
    `);
    expect(Object.fromEntries(ids.map((id) => [id, round(out.strengthOfSchedule.get(id)!)])))
      .toMatchInlineSnapshot(`
      {
        "A9": 0.573325,
        "B9": 1.080719,
        "C9": 1.430779,
        "X10": -0.630779,
        "Y10": -0.973325,
        "Z10": -1.092841,
      }
    `);
  });
});
