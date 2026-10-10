import { describe, expect, it } from "vitest";
import { forecastWords, formatRating } from "../matchupForecast";
import { predictMatchup } from "../teamRankings";

/** The words for a margin, with the chance the curve gives it at 12U. */
const at = (margin: number) =>
  forecastWords("Aces", "Bears", {
    projectedMargin: margin,
    winProb: predictMatchup(margin, 0).winProbA,
  });

describe("forecastWords", () => {
  it("names the scouted club the winner when it is ahead", () => {
    expect(at(2.34)).toEqual({
      even: false,
      headline: "Aces should beat Bears by 2.3 runs",
      chances: "Win chance: Aces 64%, Bears 36%",
    });
  });

  it("names the other club the winner when it is ahead, with its own chance first", () => {
    expect(at(-2.34)).toEqual({
      even: false,
      headline: "Bears should beat Aces by 2.3 runs",
      chances: "Win chance: Bears 64%, Aces 36%",
    });
  });

  it("says one run in the singular, and the clamp as what it stands for", () => {
    expect(at(1.04).headline).toBe("Aces should beat Bears by 1.0 run");
    expect(at(14).headline).toBe("Aces should beat Bears by 14 or more runs");
    expect(at(-14).headline).toBe("Bears should beat Aces by 14 or more runs");
  });

  it("names no winner on a margin too small to move either chance off 50%", () => {
    // 0.07 of a run prints as 0.1 but leaves both chances at 50%: "should beat by 0.1 runs" at
    // 50-50 would be a winner picked by a rounding error.
    for (const margin of [0, 0.04, -0.04, 0.07, -0.07]) {
      expect(at(margin)).toEqual({
        even: true,
        headline: "Too close to call: dead even",
        chances: "Win chance: Aces 50%, Bears 50%",
      });
    }
    expect(at(0.09)).toEqual({
      even: false,
      headline: "Aces should beat Bears by 0.1 runs",
      chances: "Win chance: Aces 51%, Bears 49%",
    });
  });

  it("prints the two chances to add up to 100", () => {
    // 0.645 and 0.355 round to 65 and 36 apart; the second is printed as what is left.
    const words = forecastWords("Aces", "Bears", { projectedMargin: 2.4, winProb: 0.645 });
    const [, first, second] = words.chances.match(/Aces (\d+)%, Bears (\d+)%/) ?? [];
    expect(Number(first) + Number(second)).toBe(100);
  });
});

describe("forecastWords from either bench", () => {
  it("says the same thing whichever club is picked first, on a half percent too", () => {
    // 64.5% read from one side and 35.5% from the other used to print 65-35 and 64-36, and 50.5%
    // named a winner where its mirror, 49.5%, called it dead even.
    for (const [margin, winProb] of [
      [2.4, 0.645],
      [0.06, 0.505],
      [1.5, 0.625],
      [0.2, 0.515],
      [2.34, 0.6373],
    ] as const) {
      const fromAces = forecastWords("Aces", "Bears", { projectedMargin: margin, winProb });
      const fromBears = forecastWords("Bears", "Aces", {
        projectedMargin: -margin,
        winProb: 1 - winProb,
      });
      expect(fromBears.headline).toBe(fromAces.headline);
      expect(fromBears.chances).toBe(fromAces.chances);
      expect(fromAces.even).toBe(false);
    }
  });
});

describe("formatRating", () => {
  it("signs a rating to a tenth and never prints a negative zero", () => {
    expect(formatRating(2.14)).toBe("+2.1");
    expect(formatRating(-0.44)).toBe("-0.4");
    expect(formatRating(-0.03)).toBe("0.0");
    expect(formatRating(0.03)).toBe("0.0");
  });
});
