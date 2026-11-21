import { describe, expect, it } from "vitest";
import {
  buildScoutingReport,
  buildTeamRankings,
  fitScoutYear,
  MATCHUP_MARGIN_CAP,
  MATCHUP_MARGIN_SHRINK,
  matchupErrorsOf,
  matchupMarginShare,
  matchupVarianceOf,
  matchupOddsSpread,
  matchupOddsWidth,
  predictMatchup,
  previewMatchup,
  ratingVarianceOver,
  type ScoutGame,
  type ScoutTeam,
} from "../teamRankings";

/*
 * The odds a matchup is given, by the age level it is played at.
 *
 * The curve was 2.8 runs wide at every level and, on games the ratings had not seen, overconfident:
 * favourites called at about 75% won 69 to 71% of the time. Its spread then rose with age, 2.95 at
 * 8U and 0.09 a year above it, fitted to ratings capped at 8. With `RATING_CAP` at 12 a rating
 * stretches further, and the spread refitted to it was 3.75 at 8U and 0.10 a year above it. On 27
 * October 2026 the model sweep found that a tenth too sure, and the curve a tenth wider forecast the
 * later games better: 4.125 at 8U and 0.11 a year — see `matchupOddsSpread` for what was measured.
 */
describe("the spread of the odds curve", () => {
  it("rises with age from 4.125 at 8U, 0.11 a year", () => {
    expect(matchupOddsSpread(8)).toBeCloseTo(4.125, 10);
    expect(matchupOddsSpread(9)).toBeCloseTo(4.235, 10);
    expect(matchupOddsSpread(12)).toBeCloseTo(4.565, 10);
    expect(matchupOddsSpread(18)).toBeCloseTo(5.225, 10);
    // A tenth wider than the curve it replaced, at every level.
    for (const level of [8, 9, 12, 18]) {
      expect(matchupOddsSpread(level)).toBeCloseTo(1.1 * (3.75 + 0.1 * (level - 8)), 10);
    }
  });

  it("reads a level it has nothing measured for as the nearer end, and none at all as 12U", () => {
    expect(matchupOddsSpread(6)).toBeCloseTo(matchupOddsSpread(8), 10);
    expect(matchupOddsSpread(21)).toBeCloseTo(matchupOddsSpread(18), 10);
    expect(matchupOddsSpread(undefined)).toBeCloseTo(matchupOddsSpread(12), 10);
  });

  it("gives a three-run favourite 67% at 9U and 64% at 17U", () => {
    // Against the curve fitted to ratings capped at 8, which gave the same favourite 72.9% at 9U
    // and 69.0% at 17U: a three-run gap between ratings capped at 12 says less about who wins. The
    // curve before the tenth gave it 68.6% and 65.6%.
    expect(1 / (1 + Math.exp(-3 / 3.04))).toBeCloseTo(0.7285, 4);
    expect(1 / (1 + Math.exp(-3 / 3.76))).toBeCloseTo(0.6895, 4);
    expect(1 / (1 + Math.exp(-3 / 3.85))).toBeCloseTo(0.6855, 4);
    expect(1 / (1 + Math.exp(-3 / 4.65))).toBeCloseTo(0.6559, 4);
    expect(predictMatchup(3, 0, 9).winProbA).toBeCloseTo(1 / (1 + Math.exp(-3 / 4.235)), 10);
    expect(predictMatchup(3, 0, 9).winProbA).toBeCloseTo(0.67, 4);
    expect(predictMatchup(3, 0, 17).winProbA).toBeCloseTo(1 / (1 + Math.exp(-3 / 5.115)), 10);
    expect(predictMatchup(3, 0, 17).winProbA).toBeCloseTo(0.6426, 4);
  });

  it("still never leaves 8 to 92%", () => {
    expect(predictMatchup(40, 0, 8).winProbA).toBeCloseTo(0.92, 10);
    expect(predictMatchup(0, 40, 18).winProbA).toBeCloseTo(0.08, 10);
  });
});

describe("the scouting report's odds", () => {
  const teams: ScoutTeam[] = [
    { id: "A", name: "Aces" },
    { id: "B", name: "Bears" },
    { id: "C", name: "Cubs" },
  ];
  const game = (id: string, a: string, b: string, sa: number, sb: number): ScoutGame => ({
    id,
    ageGroupId: "ag1",
    teamAId: a,
    teamBId: b,
    teamAScore: sa,
    teamBScore: sb,
  });
  const played = [
    game("g1", "A", "B", 9, 2),
    game("g2", "B", "C", 6, 3),
    game("g3", "A", "C", 8, 1),
  ];

  it("are read at the scouted team's own level", () => {
    const rows = buildTeamRankings("ag1", teams, played).map((row) => ({ ...row, ageLevel: 14 }));
    const report = buildScoutingReport("A", rows, teams);
    const forA = rows.find((row) => row.teamId === "A")!;
    const vsC = report.national.find((preview) => preview.opponentId === "C")!;
    const opponent = rows.find((row) => row.teamId === "C")!;
    const errors = matchupErrorsOf(forA, opponent);
    expect(errors).toBeDefined();
    expect(vsC.winProb).toBeCloseTo(
      predictMatchup(forA.rating, opponent.rating, 14, errors).winProbA,
      10
    );
    expect(vsC.winProb).not.toBeCloseTo(
      predictMatchup(forA.rating, opponent.rating, 8, errors).winProbA,
      4
    );
  });
});

/*
 * Each matchup's odds on a curve as wide as its two clubs' evidence (`matchupOddsWidth`): 0.6 of
 * the age's spread about two clubs known exactly, widened by 1.6 of the two ratings' variance. A
 * matchup whose rows carry no error, as a board built before rows carried one, reads the single
 * curve of the age, which every matchup read until 6 November 2026.
 */
describe("the odds curve as wide as a matchup's evidence", () => {
  it("gives every chance it gave before where a matchup has no errors, to the digit", () => {
    // Snapshotted before the curve read the clubs' errors.
    const before: Array<[number, number, number | undefined, number]> = [
      [-20, 0, 8, 0.08],
      [-20, 0, 10, 0.08],
      [-20, 0, 12, 0.08],
      [-20, 0, 14, 0.08],
      [-20, 0, 18, 0.08],
      [-20, 0, undefined, 0.08],
      [-6, 0, 8, 0.1893030016858981],
      [-6, 0, 10, 0.2008648826050941],
      [-6, 0, 12, 0.2117601254879653],
      [-6, 0, 14, 0.22202256564823594],
      [-6, 0, 18, 0.24079509601378024],
      [-6, 0, undefined, 0.2117601254879653],
      [-3, 0, 8, 0.32579349373069394],
      [-3, 0, 10, 0.33393324473398966],
      [-3, 0, 12, 0.34137468468385124],
      [-3, 0, 14, 0.3482003384880342],
      [-3, 0, 18, 0.3602768641827489],
      [-3, 0, undefined, 0.34137468468385124],
      [-1, 0, 8, 0.43968902105842184],
      [-1, 0, 10, 0.44271523668560314],
      [-1, 0, 12, 0.44545343771643026],
      [-1, 0, 14, 0.44794272643666905],
      [-1, 0, 18, 0.45229862649003133],
      [-1, 0, undefined, 0.44545343771643026],
      [0, 0, 8, 0.5],
      [0, 0, 10, 0.5],
      [0, 0, 12, 0.5],
      [0, 0, 14, 0.5],
      [0, 0, 18, 0.5],
      [0, 0, undefined, 0.5],
      [1.5, 0, 8, 0.589920409262554],
      [1.5, 0, 10, 0.5854590303198302],
      [1.5, 0, 12, 0.5814155509026201],
      [1.5, 0, 14, 0.5777343698166036],
      [1.5, 0, 18, 0.5712814468981965],
      [1.5, 0, undefined, 0.5814155509026201],
      [3, 0, 8, 0.674206506269306],
      [3, 0, 10, 0.6660667552660103],
      [3, 0, 12, 0.6586253153161488],
      [3, 0, 14, 0.6517996615119658],
      [3, 0, 18, 0.6397231358172512],
      [3, 0, undefined, 0.6586253153161488],
      [7, 0, 8, 0.8451385453887023],
      [7, 0, 10, 0.8335567229307141],
      [7, 0, 12, 0.822504157711893],
      [7, 0, 14, 0.8119765713495082],
      [7, 0, 18, 0.7924427270548832],
      [7, 0, undefined, 0.822504157711893],
      [13, 0, 8, 0.92],
      [13, 0, 10, 0.92],
      [13, 0, 12, 0.92],
      [13, 0, 14, 0.92],
      [13, 0, 18, 0.92],
      [13, 0, undefined, 0.92],
    ];
    for (const [a, b, level, chance] of before) {
      expect(predictMatchup(a, b, level).winProbA).toBe(chance);
      expect(predictMatchup(a, b, level, undefined).winProbA).toBe(chance);
    }
  });

  it("previews a matchup between rows with no error as it did before, to the digit", () => {
    // A pool of four, its previews snapshotted before rows carried an error, and again on 18
    // November 2026, when the ridge and the discount moved its ratings: the same rows with their
    // errors taken off, as a board built before them is read, preview on the single curve of the
    // age, to the digit.
    const teams: ScoutTeam[] = [
      { id: "A", name: "Aces" },
      { id: "B", name: "Bears" },
      { id: "C", name: "Cubs" },
      { id: "D", name: "Dukes" },
    ];
    const game = (id: string, a: string, b: string, sa: number, sb: number): ScoutGame => ({
      id,
      ageGroupId: "ag1",
      teamAId: a,
      teamBId: b,
      teamAScore: sa,
      teamBScore: sb,
    });
    const played = [
      game("g1", "A", "B", 9, 2),
      game("g2", "B", "C", 6, 3),
      game("g3", "A", "C", 8, 1),
      game("g4", "C", "D", 5, 4),
      game("g5", "A", "D", 7, 3),
      game("g6", "B", "D", 4, 4),
    ];
    const rows = buildTeamRankings("ag1", teams, played);
    const before: Array<[string, string, number]> = [
      ["A", "B", 0.7447776266367595],
      ["A", "D", 0.7539200853463033],
      ["A", "C", 0.7882398745120346],
      ["B", "A", 0.25522237336324044],
      ["B", "D", 0.5121674890077422],
      ["B", "C", 0.56055082131834],
      ["D", "A", 0.24607991465369677],
      ["D", "B", 0.48783251099225766],
      ["D", "C", 0.5485263397157364],
      ["C", "A", 0.21176012548796538],
      ["C", "B", 0.43944917868166],
      ["C", "D", 0.45147366028426356],
    ];
    const row = (id: string) => rows.find((one) => one.teamId === id)!;
    const without = (id: string) => {
      const { ratingError: _error, ...rest } = row(id);
      return rest;
    };
    for (const [a, b, chance] of before) {
      expect(previewMatchup(without(a), without(b)).winProb).toBe(chance);
      expect(chance).toBe(predictMatchup(row(a).rating, row(b).rating).winProbA);
      // Every row the pool builds now carries its club's error, and its preview reads the curve.
      expect(row(a).ratingError).toBeGreaterThan(0);
      expect(previewMatchup(row(a), row(b)).winProb).toBe(
        predictMatchup(row(a).rating, row(b).rating, undefined, matchupErrorsOf(row(a), row(b)))
          .winProbA
      );
    }
  });

  it("is 0.6 of the spread about two clubs known exactly, and widens with their errors", () => {
    // At 12U the single curve is 4.565 runs wide.
    const at12 = (error: number) => matchupOddsWidth(12, { a: error, b: error });
    expect(at12(0)).toBeCloseTo(0.6 * 4.565, 12);
    // On a weight of 2.4 since 18 November 2026 (2.881, 3.271, 4.506 and 5.244 on 1.6).
    expect(at12(0.5)).toBeCloseTo(2.95, 3);
    expect(at12(1)).toBeCloseTo(3.507, 3);
    expect(at12(2)).toBeCloseTo(5.167, 3);
    expect(at12(2.5)).toBeCloseTo(6.124, 3);
    expect(at12(1)).toBeCloseTo(Math.sqrt((0.6 * 4.565) ** 2 + 2.4 * 2), 12);
    // Narrower than the single curve about a proven pair, wider about a thin one.
    expect(at12(1)).toBeLessThan(matchupOddsSpread(12));
    expect(at12(2.5)).toBeGreaterThan(matchupOddsSpread(12));
  });

  it("reads the single curve of the age where either error is missing or not a number", () => {
    for (const level of [8, 12, 18, undefined]) {
      expect(matchupOddsWidth(level)).toBe(matchupOddsSpread(level));
      expect(matchupOddsWidth(level, { a: Number.NaN, b: 1 })).toBe(matchupOddsSpread(level));
      expect(matchupOddsWidth(level, { a: 1, b: Number.POSITIVE_INFINITY })).toBe(
        matchupOddsSpread(level)
      );
    }
    expect(matchupErrorsOf({ ratingError: 1 }, {})).toBeUndefined();
    expect(matchupErrorsOf({}, { ratingError: 1 })).toBeUndefined();
    expect(matchupErrorsOf({ ratingError: 1 }, { ratingError: 2 })).toEqual({ a: 1, b: 2 });
  });

  it("gives a three-run favourite more about a proven pair and less about a thin one, held to 8-92%", () => {
    const proven = { a: 0.6, b: 0.6 };
    const thin = { a: 2.6, b: 2.6 };
    const single = predictMatchup(3, 0, 12).winProbA;
    expect(predictMatchup(3, 0, 12, proven).winProbA).toBeGreaterThan(single);
    expect(predictMatchup(3, 0, 12, thin).winProbA).toBeLessThan(single);
    expect(predictMatchup(40, 0, 12, proven).winProbA).toBeCloseTo(0.92, 10);
    expect(predictMatchup(0, 40, 12, proven).winProbA).toBeCloseTo(0.08, 10);
    // Given no variance, the margin is the ratings' gap, whatever the curve.
    expect(predictMatchup(3, 0, 12, thin).projectedMargin).toBe(3);
  });
});

/*
 * The margin a matchup states: the shown ratings' gap pulled toward even by the two clubs' errors,
 * against the variance of the year's ratings (`matchupMarginShare`, 21 November 2026). The chance
 * still reads the whole gap, so no chance moves.
 */
describe("the margin a matchup states", () => {
  it("is the gap times V / (V + errorA² + errorB²), and no chance moves", () => {
    expect(MATCHUP_MARGIN_SHRINK).toBe(1);
    const errors = { a: 1.5, b: 2 };
    const variance = 9;
    const read = predictMatchup(3, 0, 12, errors, variance);
    // 9 / (9 + 2.25 + 4) of three runs.
    expect(read.projectedMargin).toBeCloseTo((3 * 9) / 15.25, 12);
    expect(read.winProbA).toBe(predictMatchup(3, 0, 12, errors).winProbA);
    // The same pull from the other bench, and none for two clubs known exactly.
    expect(predictMatchup(0, 3, 12, errors, variance).projectedMargin).toBe(-read.projectedMargin);
    expect(predictMatchup(3, 0, 12, { a: 0, b: 0 }, variance).projectedMargin).toBe(3);
    // Held to the cap after the pull, as before it.
    expect(predictMatchup(60, 0, 12, errors, variance).projectedMargin).toBe(MATCHUP_MARGIN_CAP);
  });

  it("states the whole gap where an error or the year's variance is not known", () => {
    expect(predictMatchup(3, 0, 12).projectedMargin).toBe(3);
    expect(predictMatchup(3, 0, 12, { a: 1, b: 1 }).projectedMargin).toBe(3);
    expect(predictMatchup(3, 0, 12, undefined, 9).projectedMargin).toBe(3);
    for (const variance of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(matchupMarginShare({ a: 1, b: 1 }, variance)).toBe(1);
    }
    expect(matchupMarginShare({ a: Number.NaN, b: 1 }, 9)).toBe(1);
    // A shrink of nought, which a research sweep reads, states the whole gap too.
    expect(matchupMarginShare({ a: 1, b: 1 }, 9, 0)).toBe(1);
    expect(matchupVarianceOf({ ratingVariance: 4 }, {})).toBeUndefined();
    expect(matchupVarianceOf({}, { ratingVariance: 4 })).toBeUndefined();
    expect(matchupVarianceOf({ ratingVariance: 4 }, { ratingVariance: 4 })).toBe(4);
  });

  it("never names the other club than the chance, and never states more than the gap", () => {
    for (const gap of [-9, -3, -0.4, -0.01, 0.01, 0.4, 3, 9]) {
      for (const error of [0.3, 1, 2.6, 5]) {
        const read = predictMatchup(gap, 0, 12, { a: error, b: 0.5 }, 6);
        expect(Math.sign(read.projectedMargin)).toBe(Math.sign(read.winProbA - 0.5));
        expect(Math.abs(read.projectedMargin)).toBeLessThan(Math.abs(gap));
      }
    }
  });

  it("is carried on every row as its fit's variance, and read by a preview", () => {
    const teams: ScoutTeam[] = ["A", "B", "C", "D"].map((id) => ({ id, name: `Club ${id}` }));
    const game = (id: string, a: string, b: string, sa: number, sb: number): ScoutGame => ({
      id,
      ageGroupId: "ag1",
      teamAId: a,
      teamBId: b,
      teamAScore: sa,
      teamBScore: sb,
      date: "2026-08-01",
    });
    const games = [game("1", "A", "B", 9, 2), game("2", "B", "C", 6, 4), game("3", "C", "D", 5, 5)];
    const rows = buildTeamRankings("ag1", teams, games);
    const ratings = new Map(rows.map((row) => [row.teamId, row.pointRating]));
    const variance = ratingVarianceOver(
      ratings,
      teams.map(({ id }) => id)
    );
    expect(variance).toBeGreaterThan(0);
    for (const row of rows) expect(row.ratingVariance).toBe(variance);
    const [a, b] = [
      rows.find((row) => row.teamId === "A")!,
      rows.find((row) => row.teamId === "C")!,
    ];
    const preview = previewMatchup(a, b);
    const share = matchupMarginShare(matchupErrorsOf(a, b), variance);
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(1);
    expect(preview.projectedMargin).toBe((a.rating - b.rating) * share);
    // A row of a board built before rows carried the variance states the whole gap.
    const { ratingVariance: _variance, ...older } = a;
    expect(previewMatchup(older, b).projectedMargin).toBe(a.rating - b.rating);
    expect(previewMatchup(older, b).winProb).toBe(preview.winProb);
  });

  it("reads the year fit's variance over the clubs a board could list", () => {
    const teams: ScoutTeam[] = [
      { id: "A", name: "A" },
      { id: "B", name: "B" },
      { id: "C", name: "C" },
      { id: "slot", name: "Winner of game 1", placeholder: true } as ScoutTeam,
    ];
    const rated = [
      ["A", "B", 8, 1],
      ["B", "C", 4, 3],
      ["A", "slot", 9, 0],
    ].map(([a, b, sa, sb], at) => ({
      game: {
        id: String(at),
        ageGroupId: "ag_10u_2027",
        teamAId: a as string,
        teamBId: b as string,
        teamAScore: sa as number,
        teamBScore: sb as number,
        date: "2026-08-01",
      },
      ageGap: 0,
    }));
    const groups = [{ id: "ag_10u_2027", name: "10U 2027", year: 2027 } as never];
    const fit = fitScoutYear(
      2027,
      teams,
      rated.map(({ game }) => game),
      rated,
      groups
    );
    expect(fit.ratingVariance).toBe(ratingVarianceOver(fit.adjusted.ratings, ["A", "B", "C"]));
    // The slot is in the fit and in no board, so its rating is in no variance a margin reads.
    expect(fit.ratingVariance).not.toBe(
      ratingVarianceOver(fit.adjusted.ratings, ["A", "B", "C", "slot"])
    );
  });
});
