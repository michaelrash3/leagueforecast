import { describe, expect, it } from "vitest";
import { formOf, recordVsExpected, scheduleRankInState, weekendAhead } from "../clubForm";
import {
  previewMatchup,
  type ScoutGame,
  type ScoutRankingRow,
  type UpcomingMatchup,
} from "../teamRankings";

/*
 * A club's season beside its ratings: its schedule's toughness in its state, its record beside the
 * one the ratings expected, its one-run games, its form over its last games, and its next weekend.
 */
const row = (
  teamId: string,
  rank: number,
  rating: number,
  more: Partial<ScoutRankingRow> = {}
): ScoutRankingRow =>
  ({
    teamId,
    teamName: `Club ${teamId}`,
    rank,
    rating,
    ageLevel: 10,
    componentId: "c1",
    comparable: true,
    strengthOfSchedule: 0,
    ...more,
  }) as ScoutRankingRow;

const ROWS = [
  row("A", 1, 4, { strengthOfSchedule: 2 }),
  row("B", 2, 2, { strengthOfSchedule: 3 }),
  row("C", 3, 0, { strengthOfSchedule: 1 }),
  row("D", 4, -2, { strengthOfSchedule: 0.5 }),
  row("U", 5, 1, { componentId: "elsewhere" }),
];
const rowOf = (teamId: string) => ROWS.find((one) => one.teamId === teamId);

let made = 0;
const game = (a: string, b: string, date: string, runsA: number, runsB: number): ScoutGame => ({
  id: `g${(made += 1)}`,
  ageGroupId: "ag10",
  teamAId: a,
  teamBId: b,
  date,
  teamAScore: runsA,
  teamBScore: runsB,
});

describe("a schedule's toughness in its state", () => {
  const states: Record<string, string> = { A: "KY", B: "KY", C: "KY", D: "OH" };
  const stateOf = (teamId: string) => states[teamId];

  it("ranks the club's schedule among its state's clubs on the board, 1 the toughest", () => {
    expect(scheduleRankInState(ROWS, "A", stateOf)).toEqual({ rank: 2, of: 3 });
    expect(scheduleRankInState(ROWS, "B", stateOf)).toEqual({ rank: 1, of: 3 });
    expect(scheduleRankInState(ROWS, "D", stateOf)).toEqual({ rank: 1, of: 1 });
  });

  it("is nothing for a club with no state or no row", () => {
    expect(scheduleRankInState(ROWS, "U", stateOf)).toBeUndefined();
    expect(scheduleRankInState(ROWS, "Z", () => "KY")).toBeUndefined();
  });
});

describe("a record beside the one the ratings expected", () => {
  const GAMES = [
    game("A", "B", "2026-09-05", 5, 4), // a one-run win at about 61%
    game("C", "A", "2026-09-06", 3, 2), // a one-run loss, A at about 72%
    game("A", "D", "2026-09-12", 9, 1), // a win at about 80%
    game("A", "C", "2026-09-13", 4, 4), // a tie
    game("A", "U", "2026-09-19", 1, 9), // against a club nothing compares: not read
    game("A", "Z", "2026-09-19", 1, 9), // against a club with no row: not read
    { ...game("A", "B", "2026-09-20", 0, 9), excluded: true }, // set not to count
  ];

  it("counts the games against clubs rated and compared, and sums their chances", () => {
    const expected = recordVsExpected("A", GAMES, rowOf, "2026-10-01")!;
    const chance = (a: string, b: string) => previewMatchup(rowOf(a)!, rowOf(b)!).winProb;
    expect(expected).toEqual({
      wins: 2,
      losses: 1,
      ties: 1,
      expectedWins: chance("A", "B") + chance("A", "C") + chance("A", "D") + chance("A", "C"),
      oneRun: { wins: 1, losses: 1 },
    });
  });

  it("is nothing with no such game", () => {
    expect(recordVsExpected("A", [GAMES[4]!], rowOf, "2026-10-01")).toBeUndefined();
    expect(recordVsExpected("Z", GAMES, rowOf, "2026-10-01")).toBeUndefined();
  });
});

describe("a club's form", () => {
  it("reads its last five, newest first, against the margins its ratings expected", () => {
    // A is projected to beat B by 2, C by 4 and D by 6.
    const games = [
      game("A", "D", "2026-09-01", 9, 0), // the oldest, past the five
      game("A", "B", "2026-09-05", 5, 0), // by 5: 3 better
      game("A", "C", "2026-09-06", 3, 2), // by 1: 3 short
      game("A", "D", "2026-09-07", 30, 0), // by 30, read as 14: 8 better
      game("B", "A", "2026-09-08", 4, 2), // lost by 2: 4 short
      game("A", "C", "2026-09-09", 4, 4), // a tie: 4 short
    ];
    const form = formOf("A", games, rowOf, "2026-10-01")!;
    expect(form.games.map((one) => [one.won, one.tied])).toEqual([
      [false, true],
      [false, false],
      [true, false],
      [true, false],
      [true, false],
    ]);
    expect(form.games.map((one) => Math.round(one.against * 10) / 10)).toEqual([-4, -4, 8, -3, 3]);
    expect(form.beat).toBe(2);
    expect(form.average).toBeCloseTo(0, 5);
  });

  it("is nothing with no game against a club rated and compared", () => {
    expect(formOf("A", [game("A", "U", "2026-09-05", 3, 1)], rowOf, "2026-10-01")).toBeUndefined();
  });
});

describe("the weekend ahead", () => {
  const match = (date: string, opponentId: string, winProb?: number): UpcomingMatchup => ({
    gameId: `${date}-${opponentId}`,
    date,
    opponentId,
    opponentName: `Club ${opponentId}`,
    ...(winProb === undefined ? {} : { winProb }),
  });

  it("is the first weekend with a dated game, Friday to Sunday, with its chances", () => {
    const friday = match("2026-10-30", "B", 0.45);
    const saturday = match("2026-10-31", "C", 0.7);
    const sunday = match("2026-11-01", "Z");
    const ahead = weekendAhead([
      match("", "D", 0.9),
      sunday,
      saturday,
      friday,
      match("2026-11-07", "A", 0.2),
    ]);
    expect(ahead).toEqual({
      sunday: "2026-11-01",
      games: [friday, saturday, sunday],
      expectedWins: 0.45 + 0.7,
      toughest: friday,
      likeliest: saturday,
    });
  });

  it("names no toughest and likeliest of fewer than two games it can call", () => {
    const ahead = weekendAhead([match("2026-10-31", "C", 0.7), match("2026-11-01", "Z")]);
    expect(ahead).not.toHaveProperty("toughest");
    expect(ahead?.expectedWins).toBe(0.7);
  });

  it("is nothing with no dated game", () => {
    expect(weekendAhead([match("", "D", 0.9)])).toBeUndefined();
  });
});
