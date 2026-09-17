import { describe, expect, it } from "vitest";
import {
  buildTeamRankings,
  evidenceDiscount,
  EVIDENCE_STANDARD_ERRORS,
  ratingSpread,
  RATING_CAP,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
} from "../teamRankings";
import { buildOpponentAdjustedRatings } from "../powerRating";

/** A fit's worth of the two things the discount needs: how noisy the pool is and who played how much. */
const fit = (residualScale: number, games: Record<string, number>) => ({
  residualScale,
  games: new Map(Object.entries(games)),
});

describe("discounting a rating for how little is behind it", () => {
  it("is exactly a standard error, either side of an average amount of evidence", () => {
    const discount = evidenceDiscount(fit(4, { thin: 4, thick: 40 }));
    const middle = (ratingSpread(4, 4) + ratingSpread(40, 4)) / 2;

    expect(discount(8, 4)).toBeCloseTo(
      8 - EVIDENCE_STANDARD_ERRORS * (ratingSpread(4, 4) - middle),
      9
    );
    expect(discount(8, 40)).toBeCloseTo(
      8 - EVIDENCE_STANDARD_ERRORS * (ratingSpread(40, 4) - middle),
      9
    );
    // Four games is less than the pool's average, so it loses ground; forty is more, so it gains.
    expect(discount(8, 4)).toBeLessThan(8);
    expect(discount(8, 40)).toBeGreaterThan(8);
  });

  it("takes more off a thin record than a thick one", () => {
    const discount = evidenceDiscount(fit(4, { a: 4, b: 12, c: 40 }));
    expect(discount(8, 4)).toBeLessThan(discount(8, 12));
    expect(discount(8, 12)).toBeLessThan(discount(8, 40));
  });

  it("does nothing at all when every club has played the same amount", () => {
    // The point of centring. Equal evidence everywhere says nothing about who is better, so the
    // table is left exactly as the fit left it — to the last digit, which is what the fit's
    // per-component zero-sum property needs.
    const discount = evidenceDiscount(fit(4, { a: 12, b: 12, c: 12 }));
    expect(discount(6.25, 12)).toBe(6.25);
    expect(discount(-6.25, 12)).toBe(-6.25);
    expect(discount(0, 12)).toBe(0);
  });

  it("is one subtraction, so it never reorders two clubs with the same games", () => {
    const discount = evidenceDiscount(fit(4, { a: 3, b: 30 }));
    // Whatever the ratings, the same game count takes the same discount.
    expect(discount(5, 3) - discount(2, 3)).toBeCloseTo(3, 9);
    expect(discount(-1, 3) - discount(-4, 3)).toBeCloseTo(3, 9);
  });

  it("treats a bad thin record the same way as a good one", () => {
    const discount = evidenceDiscount(fit(4, { a: 3, b: 30 }));
    // Not toward zero from either side: that inverted the middle of a real table, because a club
    // just above average would be pushed below one just below it. One subtraction keeps the better
    // club better, and keeps the distance between them exactly as the fit had it.
    expect(discount(0.5, 3)).toBeGreaterThan(discount(-0.5, 3));
    expect(discount(0.5, 3) - discount(-0.5, 3)).toBeCloseTo(1, 9);
    // Both moved the same way and by the same amount, which is the part "toward zero" got wrong.
    expect(discount(0.5, 3) - 0.5).toBeCloseTo(discount(-0.5, 3) + 0.5, 9);
  });

  it("does nothing when the pool has no noise to speak of", () => {
    // A scale of zero means every game landed exactly where the ratings said. There is nothing to
    // be unsure about, so nothing moves however few games a club played.
    const discount = evidenceDiscount(fit(0, { a: 2, b: 60 }));
    expect(discount(7, 2)).toBe(7);
    expect(discount(-7, 60)).toBe(-7);
  });

  it("scales with the pool's own noise, not with a constant", () => {
    // Same records, two pools. One-run games support a rating that blowouts do not.
    const tight = evidenceDiscount(fit(1.5, { a: 6, b: 40 }));
    const loose = evidenceDiscount(fit(5, { a: 6, b: 40 }));
    expect(5 - tight(5, 6)).toBeLessThan(5 - loose(5, 6));
  });

  it("leaves a rating alone rather than returning nonsense for an empty fit", () => {
    const discount = evidenceDiscount(fit(4, {}));
    expect(discount(3, 0)).toBeCloseTo(3 - EVIDENCE_STANDARD_ERRORS * ratingSpread(0, 4), 9);
    expect(Number.isFinite(discount(3, 0))).toBe(true);
  });
});

/*
 * The case that started this. A pool where one club has gone 3-0 by wide margins and another has
 * ground out 11-1: the fit likes the 3-0 club better, because three straight blowouts is the best
 * evidence it has about that club, and the table used to say it was the best in the country.
 *
 * The real pool's 9U 2027 board said exactly this — `MTBA Dawgs Moore 4-0` first of 15,632, rating
 * 7.92, ahead of `Texas Kings Parker 11-1` at 7.66 — and the discount moved it to third.
 */
describe("a 3-0 club and an 11-1 club", () => {
  const pool: AgeGroup[] = [{ id: "u9", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] }];

  /**
   * Twenty ordinary clubs that beat each other about evenly, plus the two under test.
   *
   * The margins are spread the way real games are rather than scripted, and that matters: with
   * every middle game at a fixed margin the fit explains the pool almost exactly, the residual
   * scale comes out at half what a real pool shows, and the discount it implies is half the size.
   * A fixture that quiet would be testing the arithmetic against a pool that does not exist.
   */
  const built = () => {
    const teams: ScoutTeam[] = [
      { id: "T-THIN", name: "Thin 3-0" },
      { id: "T-THICK", name: "Thick 11-1" },
    ];
    const games: ScoutGame[] = [];
    let at = 0;
    const add = (a: string, b: string, sa: number, sb: number) => {
      games.push({
        id: `g${at++}`,
        ageGroupId: "u9",
        teamAId: a,
        teamBId: b,
        teamAScore: sa,
        teamBScore: sb,
        date: "2026-09-05",
      });
    };
    for (let i = 0; i < 20; i += 1) teams.push({ id: `T-${i}`, name: `Club ${i}` });
    const spread = [0, 1, -2, 4, -1, 7, -5, 2, -3, 6, 1, -4, 3, -6, 8, -1, 0, 5, -2, 3];
    let roll = 0;
    for (let i = 0; i < 20; i += 1) {
      for (let j = i + 1; j < 20; j += 1) {
        const margin = spread[roll++ % spread.length]!;
        add(`T-${i}`, `T-${j}`, 5 + Math.max(0, margin), 5 + Math.max(0, -margin));
      }
    }
    // Three wins by six, against three of the middle.
    for (let i = 0; i < 3; i += 1) add("T-THIN", `T-${i}`, 11, 5);
    // Eleven wins by five and a one-run loss, against twelve of the middle.
    for (let i = 0; i < 11; i += 1) add("T-THICK", `T-${i}`, 10, 5);
    add("T-THICK", "T-11", 5, 6);
    return { teams, games };
  };

  const ranked = () => {
    const { teams, games } = built();
    const rows = buildTeamRankings("u9", teams, games, undefined, pool);
    return {
      teams,
      games,
      rows,
      thin: rows.find((row) => row.teamId === "T-THIN")!,
      thick: rows.find((row) => row.teamId === "T-THICK")!,
    };
  };

  it("believes the 3-0 club more, on the evidence it has", () => {
    const { thin, thick } = ranked();
    // The fit's own estimate: the blowout artist looks better, and on three games that is what the
    // data says. Nothing here is wrong — it is a best guess, and the best one available.
    expect(thin.pointRating).toBeGreaterThan(thick.pointRating);
  });

  it("but ranks the 11-1 club first, because that is what is proved", () => {
    const { thin, thick } = ranked();
    expect(thick.rank).toBeLessThan(thin.rank);
    expect(thick.rating).toBeGreaterThan(thin.rating);
    // The record is untouched. The discount is about what a rating can support, never about
    // pretending a team played games it did not or did not play the ones it did.
    expect(thin.record).toBe("3-0");
    expect(thin.games).toBe(3);
    expect(thick.record).toBe("11-1");
    expect(thick.games).toBe(12);
  });

  it("shows the working: the shown rating is the best guess less one standard error", () => {
    const { teams, games, thin } = ranked();
    // Refit the same games directly, so the table's number is tied to the model's own output
    // rather than to a constant remembered from when this was written.
    const refit = buildOpponentAdjustedRatings(
      teams.map((team) => team.id),
      games.map((game) => ({
        home: game.teamAId,
        away: game.teamBId,
        homeMargin: game.teamAScore! - game.teamBScore!,
        neutral: true,
      })),
      { cap: RATING_CAP }
    );
    expect(thin.pointRating).toBeCloseTo(refit.ratings.get("T-THIN")!, 9);
    expect(thin.rating).toBeCloseTo(evidenceDiscount(refit)(thin.pointRating, 3), 9);
    // Three games against a pool that mostly plays twenty: a real discount, not a rounding.
    expect(thin.pointRating - thin.rating).toBeGreaterThan(0.5);
    // And the pool's noise is the size a real one's is, not the size a scripted fixture's would be.
    expect(refit.residualScale).toBeGreaterThan(3);
  });

  it("does not reorder clubs that have played the same amount", () => {
    const { rows } = ranked();
    const byCount = new Map<number, typeof rows>();
    rows.forEach((row) => byCount.set(row.games, [...(byCount.get(row.games) ?? []), row]));
    const groups = [...byCount.values()].filter((group) => group.length > 1);
    expect(groups.length).toBeGreaterThan(0);
    // Equal games means an equal discount, so within a group the shown order is exactly the fit's.
    groups.forEach((group) => {
      expect(group.map((row) => row.teamId)).toEqual(
        group
          .slice()
          .sort((a, b) => b.pointRating - a.pointRating)
          .map((row) => row.teamId)
      );
    });
  });
});
