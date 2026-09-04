import { describe, expect, it } from "vitest";
import { buildOpponentAdjustedRatings, type RatingGame } from "../powerRating";

const ids = ["A", "B", "C", "D"];

describe("buildOpponentAdjustedRatings", () => {
  it("ranks a dominant team highest and a bottom team lowest", () => {
    // A beats everyone by 5, D loses to everyone by 5; B and C in the middle.
    const games: RatingGame[] = [
      { home: "A", away: "B", homeMargin: 5 },
      { home: "A", away: "C", homeMargin: 5 },
      { home: "A", away: "D", homeMargin: 5 },
      { home: "B", away: "C", homeMargin: 2 },
      { home: "B", away: "D", homeMargin: 5 },
      { home: "C", away: "D", homeMargin: 5 },
    ];
    const result = buildOpponentAdjustedRatings(ids, games);
    expect(result.ratings.get("A")!).toBeGreaterThan(result.ratings.get("B")!);
    expect(result.ratings.get("B")!).toBeGreaterThan(result.ratings.get("D")!);
    expect(result.ratings.get("A")!).toBeGreaterThan(result.ratings.get("D")!);
  });

  it("caps blowouts so they do not dominate", () => {
    const modest: RatingGame[] = [{ home: "A", away: "B", homeMargin: 8 }];
    const blowout: RatingGame[] = [{ home: "A", away: "B", homeMargin: 40 }];
    const a = buildOpponentAdjustedRatings(["A", "B"], modest, { cap: 8 });
    const b = buildOpponentAdjustedRatings(["A", "B"], blowout, { cap: 8 });
    // A 40-run win is clamped to the same 8-run margin as an 8-run win.
    expect(a.ratings.get("A")!).toBeCloseTo(b.ratings.get("A")!, 6);
    expect(a.cap).toBe(8);
  });

  it("adjusts for opponent strength: same margins vs tougher schedule rate higher", () => {
    // X beats a strong opponent (S) by 3; Y beats a weak opponent (W) by 3.
    const games: RatingGame[] = [
      { home: "S", away: "W", homeMargin: 8 }, // S is clearly strong, W clearly weak
      { home: "S", away: "W", homeMargin: 8 },
      { home: "X", away: "S", homeMargin: 3 }, // X beats strong S
      { home: "Y", away: "W", homeMargin: 3 }, // Y beats weak W
    ];
    const result = buildOpponentAdjustedRatings(["S", "W", "X", "Y"], games);
    expect(result.ratings.get("X")!).toBeGreaterThan(result.ratings.get("Y")!);
    expect(result.strengthOfSchedule.get("X")!).toBeGreaterThan(
      result.strengthOfSchedule.get("Y")!
    );
  });

  it("regresses teams with no games to the league mean (0)", () => {
    const games: RatingGame[] = [{ home: "A", away: "B", homeMargin: 6 }];
    const result = buildOpponentAdjustedRatings(ids, games);
    expect(result.ratings.get("C")).toBe(0);
    expect(result.ratings.get("D")).toBe(0);
    expect(result.games.get("C")).toBe(0);
  });

  it("keeps the home-field term near zero when results are location-independent", () => {
    // The same team wins by the same margin regardless of venue → no home-field signal.
    const games: RatingGame[] = [
      { home: "A", away: "B", homeMargin: 4 }, // A wins by 4 at home
      { home: "B", away: "A", homeMargin: -4 }, // A wins by 4 on the road
      { home: "C", away: "D", homeMargin: 4 },
      { home: "D", away: "C", homeMargin: -4 },
    ];
    const result = buildOpponentAdjustedRatings(ids, games);
    expect(Math.abs(result.homeAdvantage)).toBeLessThan(1);
  });

  it("detects a real home-field advantage when the home team consistently wins", () => {
    const games: RatingGame[] = [
      { home: "A", away: "B", homeMargin: 4 },
      { home: "B", away: "A", homeMargin: 4 },
      { home: "C", away: "D", homeMargin: 4 },
      { home: "D", away: "C", homeMargin: 4 },
    ];
    const result = buildOpponentAdjustedRatings(ids, games);
    expect(result.homeAdvantage).toBeGreaterThan(1);
  });

  it("is deterministic", () => {
    const games: RatingGame[] = [
      { home: "A", away: "B", homeMargin: 3 },
      { home: "C", away: "D", homeMargin: 2 },
    ];
    const a = buildOpponentAdjustedRatings(ids, games);
    const b = buildOpponentAdjustedRatings(ids, games);
    expect([...a.ratings.entries()]).toEqual([...b.ratings.entries()]);
  });
});

describe("neutral-site games and the home-field estimate", () => {
  it("does not invent a home edge from games that had no home team", () => {
    // Every row entered with the stronger side first. If those counted toward home field, the
    // model would conclude that being listed first is worth runs.
    const games = [
      { home: "A", away: "B", homeMargin: 6, neutral: true },
      { home: "A", away: "C", homeMargin: 5, neutral: true },
      { home: "B", away: "C", homeMargin: 4, neutral: true },
    ];
    const out = buildOpponentAdjustedRatings(["A", "B", "C"], games);
    expect(out.homeAdvantage).toBe(0);
  });

  it("still finds one from real home games", () => {
    const games = [
      { home: "A", away: "B", homeMargin: 6 },
      { home: "B", away: "A", homeMargin: 2 },
      { home: "A", away: "C", homeMargin: 5 },
      { home: "C", away: "A", homeMargin: 1 },
    ];
    const out = buildOpponentAdjustedRatings(["A", "B", "C"], games);
    expect(out.homeAdvantage).toBeGreaterThan(0);
  });

  it("still rates teams from neutral games — only the home term is excluded", () => {
    const out = buildOpponentAdjustedRatings(
      ["A", "B"],
      [{ home: "A", away: "B", homeMargin: 8, neutral: true }]
    );
    expect(out.ratings.get("A") ?? 0).toBeGreaterThan(out.ratings.get("B") ?? 0);
  });

  it("keeps a real home edge out of the neutral rows' reach", () => {
    // Two league games with a genuine home edge, plus a lopsided neutral one entered A-first.
    // The neutral row must move the ratings without touching homeAdvantage's evidence.
    const leagueOnly = buildOpponentAdjustedRatings(
      ["A", "B"],
      [
        { home: "A", away: "B", homeMargin: 4 },
        { home: "B", away: "A", homeMargin: 4 },
      ]
    );
    const withNeutral = buildOpponentAdjustedRatings(
      ["A", "B"],
      [
        { home: "A", away: "B", homeMargin: 4 },
        { home: "B", away: "A", homeMargin: 4 },
        { home: "A", away: "B", homeMargin: 9, neutral: true },
      ]
    );
    expect(withNeutral.homeAdvantage).toBeCloseTo(leagueOnly.homeAdvantage, 6);
    expect(withNeutral.ratings.get("A") ?? 0).toBeGreaterThan(leagueOnly.ratings.get("A") ?? 0);
  });
});
