import { describe, expect, it } from "vitest";
import {
  buildScoutingReport,
  buildTeamRankings,
  matchupOddsSpread,
  predictMatchup,
  type ScoutGame,
  type ScoutTeam,
} from "../teamRankings";

/*
 * The odds a matchup is given, by the age level it is played at.
 *
 * The curve was 2.8 runs wide at every level and, on games the ratings had not seen, overconfident:
 * favourites called at about 75% won 69 to 71% of the time. Its spread then rose with age, 2.95 at
 * 8U and 0.09 a year above it, fitted to ratings capped at 8. With `RATING_CAP` at 12 a rating
 * stretches further, and the spread refitted to it is 3.75 at 8U and 0.10 a year above it — see
 * `matchupOddsSpread` for what was measured.
 */
describe("the spread of the odds curve", () => {
  it("rises with age from 3.75 at 8U, 0.10 a year", () => {
    expect(matchupOddsSpread(8)).toBeCloseTo(3.75, 10);
    expect(matchupOddsSpread(9)).toBeCloseTo(3.85, 10);
    expect(matchupOddsSpread(12)).toBeCloseTo(4.15, 10);
    expect(matchupOddsSpread(18)).toBeCloseTo(4.75, 10);
  });

  it("reads a level it has nothing measured for as the nearer end, and none at all as 12U", () => {
    expect(matchupOddsSpread(6)).toBeCloseTo(matchupOddsSpread(8), 10);
    expect(matchupOddsSpread(21)).toBeCloseTo(matchupOddsSpread(18), 10);
    expect(matchupOddsSpread(undefined)).toBeCloseTo(matchupOddsSpread(12), 10);
  });

  it("gives a three-run favourite about 69% at 9U and 66% at 17U", () => {
    // Against the curve fitted to ratings capped at 8, which gave the same favourite 72.9% at 9U
    // and 69.0% at 17U: a three-run gap between ratings capped at 12 says less about who wins.
    expect(1 / (1 + Math.exp(-3 / 3.04))).toBeCloseTo(0.7285, 4);
    expect(1 / (1 + Math.exp(-3 / 3.76))).toBeCloseTo(0.6895, 4);
    expect(predictMatchup(3, 0, 9).winProbA).toBeCloseTo(1 / (1 + Math.exp(-3 / 3.85)), 10);
    expect(predictMatchup(3, 0, 9).winProbA).toBeCloseTo(0.6855, 4);
    expect(predictMatchup(3, 0, 17).winProbA).toBeCloseTo(1 / (1 + Math.exp(-3 / 4.65)), 10);
    expect(predictMatchup(3, 0, 17).winProbA).toBeCloseTo(0.6559, 4);
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
    expect(vsC.winProb).toBeCloseTo(predictMatchup(forA.rating, opponent.rating, 14).winProbA, 10);
    expect(vsC.winProb).not.toBeCloseTo(
      predictMatchup(forA.rating, opponent.rating, 8).winProbA,
      4
    );
  });
});
