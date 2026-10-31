import { describe, expect, it } from "vitest";
import { clinchingPathsForTeams } from "../clinchingPaths";
import { eliminationNumberForGold, magicForGold, neededResults } from "../magic";
import { needsLines } from "../ourTeam";
import {
  attachAdjustedRatings,
  calculateTeams,
  emptyTeam,
  getMathGoldStatus,
  getRemainingCounts,
  leagueAverageSide,
  OWED_OPPONENT,
  predictGame,
  rankOptionsFromSettings,
  rankTeams,
  simulateBracketOdds,
  simulateGoldOddsRun,
} from "../sim";
import {
  DEFAULT_SETTINGS,
  type GameLog,
  type Matchup,
  type TeamBase,
  type TeamWithProjection,
} from "../types";
import { isFinal } from "../util";

/*
 * Games a team still owes under the games-per-team setting, beyond those the schedule shows. The
 * Standings' status column has always counted them (`getRemainingCounts`); the exact numbers read
 * the schedule alone, so a league that had played the games it had entered was told it was settled:
 * "Already clinched" beside a status of In, "Already eliminated" beside Alive, and no Gold Bracket
 * paths at all. Each owed game is now one more game in the exact search, against a stand-in that is
 * never ranked. Placeholder names.
 */

const final = (away: number, home: number): GameLog => ({
  awayRuns: String(away),
  homeRuns: String(home),
  awayHits: "",
  homeHits: "",
  awayK: "",
  homeK: "",
  innings: "6",
  isFinal: true,
});

const TEAMS: TeamBase[] = [
  { id: "A", name: "Aces" },
  { id: "B", name: "Bears" },
  { id: "C", name: "Comets" },
  { id: "D", name: "Ducks" },
];

const FIVE: TeamBase[] = [...TEAMS, { id: "E", name: "Eagles" }];

/** One round robin, every game of it played: the Aces win all three, the Bears two, the Comets one. */
const ROUND: Matchup[] = [
  { id: "g1", date: "5/1", away: "A", home: "B" },
  { id: "g2", date: "5/1", away: "C", home: "D" },
  { id: "g3", date: "5/8", away: "A", home: "C" },
  { id: "g4", date: "5/8", away: "B", home: "D" },
  { id: "g5", date: "5/15", away: "A", home: "D" },
  { id: "g6", date: "5/15", away: "B", home: "C" },
];

/** The same, with the Aces and the Bears to meet twice more. */
const TWICE: Matchup[] = [
  ...ROUND,
  { id: "g7", date: "5/22", away: "B", home: "A" },
  { id: "g8", date: "5/29", away: "A", home: "B" },
];

const SCORES: Record<string, GameLog> = {
  g1: final(6, 2),
  g2: final(5, 3),
  g3: final(7, 1),
  g4: final(4, 2),
  g5: final(8, 3),
  g6: final(5, 4),
};

const league = (
  matchups: Matchup[],
  gamesPerTeam: number,
  teams: TeamBase[] = TEAMS,
  scores: Record<string, GameLog> = SCORES,
  tiePoints = DEFAULT_SETTINGS.tiePoints
) => {
  const settings = {
    ...DEFAULT_SETTINGS,
    goldCutoff: 2,
    regularSeasonGamesPerTeam: gamesPerTeam,
    tiePoints,
  };
  const live = calculateTeams(teams, matchups, scores, settings);
  const ranked = rankTeams(live, rankOptionsFromSettings(settings));
  const remaining = matchups.filter((game) => !isFinal(scores[game.id]));
  const counts = getRemainingCounts(live, remaining, gamesPerTeam);
  const rows: TeamWithProjection[] = ranked.map((team) => ({
    ...team,
    ...getMathGoldStatus(team, ranked, counts, 2, settings),
    projectedRank: team.rank,
    projectedRecord: "",
    projectedRunDiff: 0,
    goldPct: 50,
    goldTrend: [],
  }));
  const status = (id: string) => rows.find((row) => row.id === id)?.goldStatus;
  const magic = (id: string) => magicForGold(id, rows, remaining, 2, settings).description;
  const elimination = (id: string) =>
    eliminationNumberForGold(id, rows, remaining, 2, settings).description;
  const needs = (id: string) =>
    needsLines(id, neededResults(id, rows, remaining, 2, settings) ?? [], (teamId) => {
      const name = teams.find((team) => team.id === teamId)?.name;
      if (!name) throw new Error(`No team ${teamId} to name`);
      return name;
    });
  const paths = () =>
    clinchingPathsForTeams(rows, remaining, 2, settings, () => [], {
      limit: 8,
      exactLimit: 15,
    }).map((path) => `${path.teamName} ${path.status}: ${path.notes.join(" ")}`);
  const odds = (iterations: number, follow?: string) =>
    simulateGoldOddsRun(live, remaining, iterations, "owed", 2, settings, follow);
  const bracket = (logs: Record<string, GameLog>) =>
    simulateBracketOdds(live, remaining, 400, "owed", 2, settings, logs);
  return { status, magic, elimination, needs, paths, odds, bracket };
};

describe("the reproduction: the entered games played, games per team still owed", () => {
  // A game more each under the setting, which the exact search can still walk.
  const owedOne = league(ROUND, 4);

  it("does not tell a team the status calls In that it has already clinched", () => {
    expect(owedOne.status("B")).toBe("In");
    // The Bears are 2-1 and the Comets 1-2, each with a game to play: the Bears in for sure only
    // with a win, since a loss and a Comets win leave them level.
    expect(owedOne.magic("B")).toBe("1 more win clinches a Gold Bracket spot.");
  });

  it("does not tell a team the status calls Alive that it is already eliminated", () => {
    expect(owedOne.status("C")).toBe("Alive");
    expect(owedOne.elimination("C")).toBe(
      "1 more loss would eliminate the team from the Gold Bracket."
    );
  });

  it("says what a team needs in games the schedule does not show yet", () => {
    // The Comets get in only level with the Bears, so the Bears must lose theirs and they win.
    expect(owedOne.needs("C")).toEqual([
      "Bears to lose their game not yet on the schedule",
      "Win the game not yet on the schedule",
    ]);
  });

  it("still settles what owed games cannot change", () => {
    // The Aces cannot fall below second, and the Ducks cannot reach the Bears' two wins.
    expect(owedOne.status("A")).toBe("Clinched");
    expect(owedOne.magic("A")).toBe("Already clinched.");
    expect(owedOne.status("D")).toBe("Eliminated");
    expect(owedOne.elimination("D")).toBe("Already eliminated from the Gold Bracket.");
  });

  it("lists the Gold Bracket paths of the teams still in the race", () => {
    expect(owedOne.paths()).toEqual([
      "Bears In: Controls a Gold spot by winning out.",
      "Comets Alive: Needs help from teams above the line. Out after 1 more loss.",
    ]);
    // Nine games owed each, as the sweep found it: too many to search, so the paths are the
    // standings' own, and none of them is dropped as settled.
    expect(league(ROUND, 12).paths()).toEqual([
      "Bears In: Controls a Gold spot by protecting the current cut-line cushion.",
      "Aces In: Controls a Gold spot by protecting the current cut-line cushion.",
      "Comets Alive: Needs help from teams above the line.",
      "Ducks Alive: Needs help from teams above the line.",
    ]);
  });
});

describe("the owed games among the games left", () => {
  it("counts them among a team's games, so a clinch short of them is not winning out", () => {
    // Two owed each: the Aces need one win of their two, not both.
    expect(league(ROUND, 5).paths()).toContain("Aces In: Clinches with 1 win.");
  });

  it("counts them toward the limit on the exact search", () => {
    // Four owed each is sixteen games, one past the fifteen the search is asked within, so the
    // paths are the standings' own rather than the search's.
    expect(league(ROUND, 7).paths()).toEqual([
      "Bears In: Controls a Gold spot by protecting the current cut-line cushion.",
      "Aces In: Controls a Gold spot by protecting the current cut-line cushion.",
      "Comets Alive: Needs help from teams above the line.",
      "Ducks Alive: Needs help from teams above the line.",
    ]);
  });
});

describe("a league where only some teams owe games", () => {
  // The Comets and the Ducks owe two each; the Aces and the Bears have theirs on the schedule.
  const some = league(TWICE, 5);

  it("counts the owed games for the teams that owe them, and the schedule for the rest", () => {
    // The Bears need both games against the Aces: one win and the Comets can draw level.
    expect(some.magic("B")).toBe("2 more wins clinches a Gold Bracket spot.");
    expect(some.elimination("B")).toBe(
      "Its own losses cannot eliminate it, but other results still can."
    );
    expect(some.magic("A")).toBe("1 more win clinches a Gold Bracket spot.");
    expect(some.elimination("C")).toBe(
      "2 more losses would eliminate the team from the Gold Bracket."
    );
    expect(some.elimination("D")).toBe(
      "1 more loss would eliminate the team from the Gold Bracket."
    );
  });

  it("names a scheduled game a team can get help from, and no game the schedule does not show", () => {
    expect(some.paths()).toEqual([
      "Bears In: Controls a Gold spot by winning out.",
      "Aces In: Clinches with 1 win.",
      "Comets Alive: Comets get help if Bears lose to Aces. Out after 2 more losses.",
      "Ducks Alive: Ducks get help if Bears lose to Aces. Out after 1 more loss.",
    ]);
  });
});

/*
 * One game owed in the whole league and nothing left on the schedule, so the season's last game is
 * one the schedule does not show yet. The search reads the table as it stands once nothing is left
 * to play, and the needs ask it with the game already decided, which a table that has not booked
 * the game cannot answer: the Eagles were told they needed nothing, and the Bears read a stand-in's
 * id where a team's name goes. Like the last game on the schedule, it is read at every score it can
 * end with.
 */
describe("the season's last game owed beyond the schedule", () => {
  // Three games each set. The Aces win all three, the Bears beat the Comets and the Ducks by eight
  // runs each, and the Eagles, with two played, beat the same two by a run each.
  const games: Matchup[] = [
    { id: "f1", date: "5/1", away: "A", home: "B" },
    { id: "f2", date: "5/1", away: "C", home: "E" },
    { id: "f3", date: "5/8", away: "A", home: "C" },
    { id: "f4", date: "5/8", away: "D", home: "E" },
    { id: "f5", date: "5/15", away: "A", home: "D" },
    { id: "f6", date: "5/15", away: "B", home: "C" },
    { id: "f7", date: "5/22", away: "B", home: "D" },
  ];
  const scores: Record<string, GameLog> = {
    f1: final(5, 4),
    f2: final(3, 4),
    f3: final(6, 2),
    f4: final(2, 3),
    f5: final(7, 3),
    f6: final(9, 1),
    f7: final(10, 2),
  };
  const last = league(games, 3, FIVE, scores);

  it("tells the team that owes it what it needs from it", () => {
    // Level with the Bears after a loss, the Eagles lose the tie on run differential at any score;
    // a tie puts them half a point clear.
    expect(last.status("E")).toBe("In");
    expect(last.needs("E")).toEqual(["Don't lose the game not yet on the schedule"]);
  });

  it("tells a team it can pass what it needs from it, by the name of the team that owes it", () => {
    // The Bears get in only level with the Eagles, on the tiebreak they hold.
    expect(last.status("B")).toBe("Alive");
    expect(last.needs("B")).toEqual(["Eagles to lose their game not yet on the schedule"]);
  });
});

/*
 * The season's last game is read with every tiebreaker, so there another team's win can be the
 * result a team needs, where on the search's points and losses it only ever puts that team higher:
 * clear of a three-way tie that run differential settles, it leaves a two-way one that head-to-head
 * does. The card named the stand-in where the team that owes the game goes.
 */
describe("the season's last game owed beyond the schedule, needed won", () => {
  // Three games each set again, and the Eagles, 2-0, owe their third. The Aces beat the Bears and
  // the Comets by a run each and lost to the Ducks by ten; the Bears won their other two by ten.
  // An Eagles loss leaves three teams at 2-1, where head-to-head is not read and run differential
  // puts the Aces third; an Eagles win leaves the Aces level with the Bears alone, and ahead of them
  // on the game between them.
  const games: Matchup[] = [
    { id: "w1", date: "5/1", away: "C", home: "E" },
    { id: "w2", date: "5/1", away: "D", home: "E" },
    { id: "w3", date: "5/8", away: "A", home: "B" },
    { id: "w4", date: "5/8", away: "A", home: "C" },
    { id: "w5", date: "5/15", away: "D", home: "A" },
    { id: "w6", date: "5/15", away: "B", home: "C" },
    { id: "w7", date: "5/22", away: "B", home: "D" },
  ];
  const scores: Record<string, GameLog> = {
    w1: final(0, 5),
    w2: final(0, 5),
    w3: final(1, 0),
    w4: final(1, 0),
    w5: final(10, 0),
    w6: final(10, 0),
    w7: final(10, 0),
  };

  it("names the team that owes it where its win is what another team needs", () => {
    const noTies = league(games, 3, FIVE, scores, 0);
    expect(noTies.status("A")).toBe("In");
    expect(noTies.needs("A")).toEqual(["Eagles to win their game not yet on the schedule"]);
    // The same game is the Bears' way in the other way round.
    expect(noTies.needs("B")).toEqual(["Eagles to lose their game not yet on the schedule"]);
  });

  it("asks it only not to lose where a tie lifts it clear too", () => {
    // Ties worth half a win, as by default: an Eagles tie puts them half a point clear.
    expect(league(games, 3, FIVE, scores).needs("A")).toEqual([
      "Eagles not to lose their game not yet on the schedule",
    ]);
  });
});

/*
 * The odds played the scheduled games alone, so with none left the season was over: the top two at
 * 100% and the rest at 0% while each team had nine games to play. Each owed game is now played
 * after the scheduled ones, against a side of the league's average strength that is never ranked.
 */
describe("the Gold odds with games owed beyond the schedule", () => {
  it("play the owed games, so the race the status calls open is open in the odds too", () => {
    const run = league(ROUND, 12).odds(4000);
    for (const id of ["A", "B", "C", "D"]) {
      expect(run.odds[id]).toBeGreaterThan(1);
      expect(run.odds[id]).toBeLessThan(99);
    }
    // In the order the records put them, the Aces' three wins ahead of the Bears' two.
    expect(run.odds.A).toBeGreaterThan(run.odds.B ?? 100);
    expect(run.odds.B).toBeGreaterThan(run.odds.C ?? 100);
    expect(run.odds.C).toBeGreaterThan(run.odds.D ?? 100);
  });

  it("fill the cut with the league's own teams, the stand-in never among them", () => {
    const run = league(ROUND, 12).odds(400);
    expect(Object.keys(run.odds).sort()).toEqual(["A", "B", "C", "D"]);
    // Two places in every season, and every place from first to fourth handed out once.
    const inside = Object.values(run.odds).reduce((sum, value) => sum + value, 0);
    expect(inside).toBeCloseTo(200, 9);
    const places = Object.values(run.places).reduce((sum, value) => sum + value, 0);
    expect(places).toBeCloseTo(10, 9);
  });

  it("play them for the teams that owe them, and the schedule for the rest", () => {
    // The Comets get in by winning both of theirs while the Bears lose both to the Aces.
    const run = league(TWICE, 5).odds(4000, "C");
    expect(run.odds.C).toBeGreaterThan(1);
    expect(run.odds.B).toBeLessThan(99);
    // The followed team's swing is the scheduled games', which are the ones it can be told about.
    expect(run.swing?.gameIds).toEqual(["g7", "g8"]);
  });

  it("wait for the owed games before reading the bracket's kept scores", () => {
    // The top seed won the final as kept, but with nine games owed each, nobody is seeded yet: the
    // title odds are the ones drawn with no score kept at all.
    const owed = league(ROUND, 12);
    const crowned = owed.bracket({ "bracket-r1-g1": final(2, 5) });
    expect(crowned).toEqual(owed.bracket({}));
    expect(crowned.championOdds.C).toBeGreaterThan(0);
  });
});

describe("the side a game owed beyond the schedule is played against", () => {
  const settings = { ...DEFAULT_SETTINGS, goldCutoff: 2, regularSeasonGamesPerTeam: 12 };
  const live = calculateTeams(TEAMS, ROUND, SCORES, settings);

  it("is the league's average team, which no team of the league can be", () => {
    const side = leagueAverageSide(live);
    expect(side.id).toBe(OWED_OPPONENT);
    expect(live.some((team) => team.id === side.id)).toBe(false);
    // Every game was between two of the league's teams, so its average is a .500 side with no run
    // differential, scoring and allowing the league's runs a game.
    const runs = live.reduce((sum, team) => sum + team.rs, 0) / 12;
    expect(side.games).toBe(3);
    expect(side.pct).toBeCloseTo(0.5, 12);
    expect(side.runDiff).toBeCloseTo(0, 12);
    expect(side.rsg).toBeCloseTo(runs, 12);
    expect(side.rag).toBeCloseTo(runs, 12);
    expect(side.w + side.l + side.t).toBe(0);
    expect(side.headToHead).toEqual({});
    // A team yet to play counts for nothing in the average of what a game is like.
    const unplayed = leagueAverageSide([...live, emptyTeam({ id: "E", name: "Eagles" })]);
    expect(unplayed.pct).toBeCloseTo(0.5, 12);
    expect(unplayed.rsg).toBeCloseTo(runs, 12);
  });

  it("is beaten more often by a better team", () => {
    const side = leagueAverageSide(live);
    const byId = new Map([...live.map((team) => [team.id, team] as const), [side.id, side]]);
    const chance = (id: string) =>
      predictGame({ id: "x", date: "", away: id, home: side.id }, live, settings, byId).awayWinPct;
    expect(chance("A")).toBeGreaterThan(chance("B"));
    expect(chance("B")).toBeGreaterThan(chance("C"));
    expect(chance("C")).toBeGreaterThan(chance("D"));
    expect(chance("A")).toBeGreaterThan(0.5);
    expect(chance("D")).toBeLessThan(0.5);
  });

  it("carries the league's rating where its teams carry one, by the games behind each", () => {
    expect(leagueAverageSide(live).adjustedRating).toBeUndefined();
    const rated = attachAdjustedRatings(live, {
      byTeam: new Map([
        ["A", 3],
        ["B", 1],
        ["C", -1],
      ]),
      games: new Map([
        ["A", 6],
        ["B", 2],
        ["C", 2],
      ]),
    });
    const ratedSide = leagueAverageSide(rated);
    expect(ratedSide.adjustedRating).toBeCloseTo((3 * 6 + 1 * 2 - 1 * 2) / 10, 12);
    expect(ratedSide.ratedGames).toBeCloseTo(10 / 3, 12);
  });
});
