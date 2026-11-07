import { describe, expect, it } from "vitest";
import {
  buildScoutingReport,
  buildTeamRankings,
  matchupErrorsOf,
  matchupOddsSpread,
  matchupOddsWidth,
  predictMatchup,
  previewMatchup,
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
    // A pool of four, its previews snapshotted before rows carried an error; the same rows with
    // their errors taken off, as a board built before them is read, preview the same.
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
      ["A", "B", 0.7060408326969742],
      ["A", "D", 0.7142388152607415],
      ["A", "C", 0.745617915261263],
      ["B", "A", 0.2939591673030259],
      ["B", "D", 0.5099558680369058],
      ["B", "C", 0.5496220354249689],
      ["D", "A", 0.2857611847392585],
      ["D", "B", 0.4900441319630942],
      ["D", "C", 0.5397447077693609],
      ["C", "A", 0.25438208473873697],
      ["C", "B", 0.45037796457503104],
      ["C", "D", 0.4602552922306392],
    ];
    const row = (id: string) => rows.find((one) => one.teamId === id)!;
    const without = (id: string) => {
      const { ratingError: _error, ...rest } = row(id);
      return rest;
    };
    for (const [a, b, chance] of before) {
      expect(previewMatchup(without(a), without(b)).winProb).toBe(chance);
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
    expect(at12(0.5)).toBeCloseTo(2.881, 3);
    expect(at12(1)).toBeCloseTo(3.271, 3);
    expect(at12(2)).toBeCloseTo(4.506, 3);
    expect(at12(2.5)).toBeCloseTo(5.244, 3);
    expect(at12(1)).toBeCloseTo(Math.sqrt((0.6 * 4.565) ** 2 + 1.6 * 2), 12);
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
    // The margin is the ratings' gap, whatever the curve.
    expect(predictMatchup(3, 0, 12, thin).projectedMargin).toBe(3);
  });
});
