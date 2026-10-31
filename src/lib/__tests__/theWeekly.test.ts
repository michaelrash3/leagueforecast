import { describe, expect, it } from "vitest";
import { isUpset, teamWeek, theWeekly, winnerChance } from "../theWeekly";
import type { ScoutGame, ScoutRankingRow } from "../teamRankings";

/*
 * The Weekly: a page's upsets of the week just played, its game of the week ahead and its winning
 * streaks still running, and a club's own week, read off the board's rows and the page's games.
 * Monday 26 October 2026: the week just played is the 19th to the 25th, the week ahead the 26th to
 * 1 November.
 */
const TODAY = "2026-10-26";
const PAGE = "ag10";

const row = (teamId: string, rank: number, rating: number, componentId = "c1"): ScoutRankingRow =>
  ({
    teamId,
    teamName: `Club ${teamId}`,
    rank,
    rating,
    ageLevel: 10,
    componentId,
    comparable: true,
  }) as ScoutRankingRow;

const ROWS = [
  row("A", 1, 6),
  row("B", 2, 4),
  row("C", 3, 2),
  row("D", 4, 1.5),
  row("E", 5, -2),
  row("F", 6, -6),
  row("G", 7, -3),
  row("H", 60, 3),
  row("U", 8, -4, "elsewhere"),
];

let made = 0;
const game = (
  a: string,
  b: string,
  date: string,
  runsA?: number,
  runsB?: number,
  more: Partial<ScoutGame> = {}
): ScoutGame => ({
  id: `g${(made += 1)}`,
  ageGroupId: PAGE,
  teamAId: a,
  teamBId: b,
  date,
  ...(runsA === undefined || runsB === undefined ? {} : { teamAScore: runsA, teamBScore: runsB }),
  ...more,
});

const days = (from: number, count: number, month = "09") =>
  Array.from({ length: count }, (_, at) => `2026-${month}-${String(from + at).padStart(2, "0")}`);

const GAMES: ScoutGame[] = [
  // The week just played.
  game("F", "A", "2026-10-20", 5, 3), // F 8% by the floor: the upset of the week
  game("E", "B", "2026-10-22", 4, 2), // E about 20%
  game("B", "E", "2026-10-22", 2, 4), // the same game off the Bs' schedule
  game("D", "C", "2026-10-21", 3, 2), // D about 47%: no upset
  game("F", "A", "2026-10-23", 3, 3), // a tie: no upset, and it ends F's run
  game("F", "A", "2026-10-24", 9, 1, { excluded: true }), // set not to count
  game("U", "A", "2026-10-21", 6, 1), // two clubs nothing compares
  game("F", "A", "2026-10-21", 7, 0, { ageGroupId: "ag11" }), // another page's
  game("F", "A", "2026-10-10", 6, 1), // the week before
  game("F", "A", TODAY, 8, 2), // today's, not the week just played
  // The week ahead.
  game("B", "C", "2026-10-28"), // 61%: the higher pair, but further from even
  game("C", "D", "2026-10-30"), // 53%: the game of the week
  game("A", "H", "2026-10-27"), // H is #60
  game("C", "D", "2026-11-03"), // past the week
  game("A", "B", "2026-10-27", 4, 1), // scored already
  // Runs of wins: D seven, G five, H four.
  ...days(1, 6).map((date) => game("D", "E", date, 5, 1)),
  ...days(20, 5, "08").map((date) => game("G", "F", date, 3, 2)),
  ...days(25, 4, "08").map((date) => game("H", "F", date, 4, 0)),
];

describe("The Weekly", () => {
  const weekly = theWeekly(PAGE, ROWS, GAMES, TODAY);

  it("ends the week it reads on yesterday", () => {
    expect(weekly.asOf).toBe("2026-10-25");
  });

  it("names the week's upsets, least likely first, a game two schedules list once", () => {
    expect(weekly.upsets).toEqual([
      expect.objectContaining({
        winnerId: "F",
        loserId: "A",
        winnerRuns: 5,
        loserRuns: 3,
        date: "2026-10-20",
        chance: 0.08,
      }),
      expect.objectContaining({ winnerId: "E", loserId: "B", winnerRuns: 4, loserRuns: 2 }),
    ]);
    expect(weekly.upsets[1]!.chance).toBeGreaterThan(0.19);
    expect(weekly.upsets[1]!.chance).toBeLessThan(0.21);
  });

  it("picks the game ahead between top clubs whose odds are nearest even", () => {
    expect(weekly.ahead).toEqual(
      expect.objectContaining({ teamAId: "C", teamBId: "D", date: "2026-10-30" })
    );
    expect(weekly.ahead!.chanceA).toBeGreaterThan(0.52);
    expect(weekly.ahead!.chanceA).toBeLessThan(0.54);
  });

  it("has no game of the week when no two top clubs meet in it", () => {
    const later = theWeekly(PAGE, ROWS, GAMES, "2026-11-10");
    expect(later.ahead).toBeNull();
  });

  it("names the winning runs still going, five or more, the longest first", () => {
    // D's six in September and the win on the 21st; G's five in August; H's four are too few; F's
    // win on the 20th is ended by the tie on the 23rd.
    expect(weekly.streaks).toEqual([
      { teamId: "D", wins: 7 },
      { teamId: "G", wins: 5 },
    ]);
  });

  it("picks the game ahead nearest even before the higher pair, however close the two", () => {
    // A #1-#2 game at about 50.06% and a #49-#50 one at about 50.006%: the second is nearer even.
    const rows = [
      row("P1", 1, 5),
      row("P2", 2, 4.99),
      ...Array.from({ length: 46 }, (_, at) => row(`F${at}`, 3 + at, 2)),
      row("Q49", 49, 1),
      row("Q50", 50, 0.999),
    ];
    const games = [game("P1", "P2", "2026-10-27"), game("Q49", "Q50", "2026-10-28")];
    expect(theWeekly(PAGE, rows, games, TODAY).ahead).toEqual(
      expect.objectContaining({ teamAId: "Q49", teamBId: "Q50" })
    );
    // At the same odds, the higher pair; at the same pair as well, the sooner.
    const level = [row("P1", 1, 5), row("P2", 2, 5), row("Q49", 49, 1), row("Q50", 50, 1)];
    expect(theWeekly(PAGE, level, games, TODAY).ahead).toEqual(
      expect.objectContaining({ teamAId: "P1", teamBId: "P2" })
    );
    const twice = [game("P1", "P2", "2026-10-29"), game("P2", "P1", "2026-10-27")];
    expect(theWeekly(PAGE, level, twice, TODAY).ahead?.date).toBe("2026-10-27");
  });

  it("reads a club's own schedule's word for its run, where the two schedules disagree", () => {
    // C's own schedule says it won each of these; E's says E did.
    const disputed = days(1, 5).map((date) =>
      game("E", "C", date, 4, 1, { reportedByB: { teamAScore: 1, teamBScore: 4 } })
    );
    expect(theWeekly(PAGE, ROWS, disputed, TODAY).streaks).toEqual([
      { teamId: "C", wins: 5 },
      { teamId: "E", wins: 5 },
    ]);
  });

  it("names no upset of a game its two clubs' schedules do not agree who won", () => {
    const disputed = game("F", "A", "2026-10-21", 5, 3, {
      reportedByB: { teamAScore: 2, teamBScore: 6 },
    });
    expect(theWeekly(PAGE, ROWS, [disputed], TODAY).upsets).toEqual([]);
  });

  it("reads a club's run off every page of the pool, as its record is counted", () => {
    const run = days(1, 5).map((date) => game("C", "E", date, 4, 1));
    // C's latest game, a loss, is filed on another age's page of the pool.
    const lost = game("E", "C", "2026-09-06", 3, 2, { ageGroupId: "ag11" });
    expect(theWeekly(PAGE, ROWS, [...run, lost], TODAY).streaks).toEqual([]);
    const won = game("C", "E", "2026-09-06", 3, 2, { ageGroupId: "ag11" });
    expect(theWeekly(PAGE, ROWS, [...run, won], TODAY).streaks).toEqual([{ teamId: "C", wins: 6 }]);
  });

  /*
   * The order a club's form line reads a day in (`byGameTime`): read untimed first, as the Weekly's
   * own sort had it, a day's second game listed with no time came before the first, and the run
   * after it was counted one short.
   */
  it("reads a day's games in playing order, a game with no start after the timed ones", () => {
    // The Cs lost the day's first game, at 3 PM UTC, won the second, listed with no time, then won
    // four more: a run of five.
    const run = [
      game("E", "C", "2026-09-01", 3, 2, { startTs: "2026-09-01T15:00:00.000Z" }),
      game("C", "E", "2026-09-01", 4, 1),
      ...days(2, 4).map((date) => game("C", "E", date, 4, 1)),
    ];
    expect(theWeekly(PAGE, ROWS, run, TODAY).streaks).toEqual([{ teamId: "C", wins: 5 }]);
  });

  it("ends a run at a tie, as at a loss", () => {
    const run = days(1, 5).map((date) => game("C", "E", date, 4, 1));
    expect(theWeekly(PAGE, ROWS, run, TODAY).streaks).toEqual([{ teamId: "C", wins: 5 }]);
    const tied = [...run, game("C", "E", "2026-09-06", 2, 2)];
    expect(theWeekly(PAGE, ROWS, tied, TODAY).streaks).toEqual([]);
  });

  it("reads only the board's half, as the board's record does", () => {
    const spring = "2027-03-10";
    const fallRun = days(1, 5).map((date) => game("C", "E", date, 2, 1));
    const springGames = [...fallRun, game("C", "E", "2027-03-01", 1, 0)];
    expect(theWeekly(PAGE, ROWS, springGames, spring).streaks).toEqual([{ teamId: "C", wins: 6 }]);
    expect(
      theWeekly(PAGE, ROWS, springGames, spring, { year: 2027, segment: "spring" }).streaks
    ).toEqual([]);
  });

  it("is empty for a week nobody played", () => {
    expect(theWeekly(PAGE, ROWS, [], TODAY)).toEqual({
      asOf: "2026-10-25",
      upsets: [],
      ahead: null,
      streaks: [],
    });
  });
});

describe("an upset", () => {
  const rowOf = (teamId: string) => ROWS.find((one) => one.teamId === teamId);

  it("is a result the ratings gave its winner less than a quarter of", () => {
    expect(isUpset(GAMES[0]!, rowOf, TODAY)).toBe(true);
    expect(isUpset(GAMES[3]!, rowOf, TODAY)).toBe(false);
    expect(winnerChance(GAMES[3]!, rowOf, TODAY)).toBeCloseTo(0.47, 2);
  });

  it("has no odds for a tie, a game not counted, or clubs nothing compares", () => {
    expect(winnerChance(GAMES[4]!, rowOf, TODAY)).toBeUndefined();
    expect(winnerChance(GAMES[5]!, rowOf, TODAY)).toBeUndefined();
    expect(winnerChance(GAMES[6]!, rowOf, TODAY)).toBeUndefined();
    expect(winnerChance(game("A", "nobody", "2026-10-20", 1, 2), rowOf, TODAY)).toBeUndefined();
  });
});

describe("a club's week", () => {
  it("is its record in the games that count, with its best win by place", () => {
    expect(teamWeek("D", GAMES, ROWS, TODAY)).toEqual({
      wins: 1,
      losses: 0,
      ties: 0,
      bestWin: { teamId: "C", place: 3 },
    });
    // Its games on every page it is handed, as a club's week is all of its games: the win over
    // the top club here and the one on the other page, the tie, and the game set not to count
    // left out.
    expect(teamWeek("F", GAMES, ROWS, TODAY)).toEqual({
      wins: 2,
      losses: 0,
      ties: 1,
      bestWin: { teamId: "A", place: 1 },
    });
    expect(teamWeek("A", GAMES, ROWS, TODAY)).toEqual({ wins: 0, losses: 3, ties: 1 });
  });

  it("reads its own schedule's word where the two schedules disagree", () => {
    const disputed = game("F", "A", "2026-10-21", 5, 3, {
      reportedByB: { teamAScore: 2, teamBScore: 6 },
    });
    expect(teamWeek("A", [disputed], ROWS, TODAY)).toEqual({
      wins: 1,
      losses: 0,
      ties: 0,
      bestWin: { teamId: "F", place: 6 },
    });
    expect(teamWeek("F", [disputed], ROWS, TODAY)).toEqual({
      wins: 1,
      losses: 0,
      ties: 0,
      bestWin: { teamId: "A", place: 1 },
    });
  });

  it("is nothing for a week it played no game that counts", () => {
    expect(teamWeek("H", GAMES, ROWS, TODAY)).toBeNull();
  });
});
