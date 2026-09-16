/**
 * Every part of the league forecast, asked the same question: does it change when Team Rankings
 * has watched a team play?
 *
 * Each case runs the same league twice — once with a set of tournament results, once without — and
 * asserts the two answers differ. A module that stops reading the pool goes on working and starts
 * returning the identical number either way, which no test of its own output would ever catch.
 */
import { describe, expect, it } from "vitest";
import { buildPredictionEngine } from "../predictionEngine";
import { attachAdjustedRatings, calculateTeams, predictGame, projectStandings } from "../sim";
import { scheduleDifficultyForTeam, teamPerformanceDifficultyScore } from "../scheduleDifficulty";
import { DEFAULT_SETTINGS, type GameLog, type Matchup, type TeamBase } from "../types";

const bases: TeamBase[] = [
  { id: "NEW", name: "Newcomers" },
  { id: "VET", name: "Veterans" },
  { id: "MID", name: "Midlanders" },
];

/** NEW has played one league game. VET and MID have four each. */
const matchups: Matchup[] = [
  { id: "m1", date: "2026-04-01", away: "VET", home: "MID" },
  { id: "m2", date: "2026-04-08", away: "MID", home: "VET" },
  { id: "m3", date: "2026-04-15", away: "VET", home: "MID" },
  { id: "m4", date: "2026-04-22", away: "MID", home: "VET" },
  { id: "m5", date: "2026-04-29", away: "NEW", home: "VET" },
  { id: "m6", date: "2026-05-06", away: "NEW", home: "MID" },
];

const log = (away: number, home: number): GameLog => ({
  awayRuns: String(away),
  awayHits: "0",
  awayK: "0",
  homeRuns: String(home),
  homeHits: "0",
  homeK: "0",
  innings: "6",
  isFinal: true,
});

const logs: Record<string, GameLog> = {
  m1: log(5, 3),
  m2: log(2, 6),
  m3: log(7, 4),
  m4: log(3, 5),
  m5: log(4, 5),
};

/** Eight tournament wins by nine runs, all before the league season. */
const externals = Array.from({ length: 8 }, (_, index) => ({
  home: "NEW",
  away: "SCOUT-STRONG",
  homeMargin: 9,
  date: `2026-03-${String(index + 1).padStart(2, "0")}`,
  neutral: true,
}));

const settings = { ...DEFAULT_SETTINGS };
const upcoming = matchups[5]!;

const league = (external: typeof externals) => {
  const base = calculateTeams(bases, matchups, logs, settings);
  const engine = buildPredictionEngine(base, matchups, logs, settings, external);
  return { engine, teams: attachAdjustedRatings(base, engine.ratings) };
};

const withScout = () => league(externals);
const withoutScout = () => league([]);

describe("what Team Rankings is worth to the league forecast", () => {
  it("rates a team off games the league never saw", () => {
    const team = withScout().teams.find((t) => t.id === "NEW")!;
    expect(team.games).toBe(1);
    expect(team.ratedGames).toBe(9);
    expect(team.adjustedRating).toBeGreaterThan(1);
    expect(withoutScout().teams.find((t) => t.id === "NEW")!.ratedGames).toBe(1);
  });

  it("reaches the game forecast for a team with barely any league record", () => {
    // This is the case the pool exists for, and the one that used to fall through a low-data
    // branch that returned before the rating was ever consulted.
    const scouted = predictGame(upcoming, withScout().teams, settings);
    const blind = predictGame(upcoming, withoutScout().teams, settings);

    expect(scouted.awayWinPct).not.toBeCloseTo(blind.awayWinPct, 5);
    expect(scouted.awayWinPct).toBeGreaterThan(blind.awayWinPct);
    expect(scouted.awayScore - scouted.homeScore).toBeGreaterThan(
      blind.awayScore - blind.homeScore
    );
  });

  it("carries through to the projected standings, and so to everything read off them", () => {
    // Gold odds, magic numbers, clinching paths, the bracket and seed ranges are all read off
    // this, so the projection is the single place worth pinning them all at once.
    const newIn = (rows: ReturnType<typeof projectStandings>) =>
      rows.find((row) => row.id === "NEW")!;
    const scouted = newIn(projectStandings(withScout().teams, [upcoming], settings));
    const blind = newIn(projectStandings(withoutScout().teams, [upcoming], settings));

    expect(scouted.runDiff).toBeGreaterThan(blind.runDiff);
    expect(scouted.rs).not.toBe(blind.rs);
  });

  it("turns over the projected winner when the pool is the only fair comparison", () => {
    // The case the bridge was built for. Flattered and Veterans never meet in this league; each
    // has only played Weaklings. Flattered blew them out twice and looks strong on that; Veterans
    // squeaked past them twice and looks ordinary. Nothing in the league can say which is better.
    //
    // The pool can: both played the same tournament club, Flattered lost to it by eleven four
    // times and Veterans beat it by five four times. That reverses the two ratings, and with them
    // the pick for the game they are about to play.
    const bases3: TeamBase[] = [
      { id: "FLAT", name: "Flattered" },
      { id: "VET", name: "Veterans" },
      { id: "WEAK", name: "Weaklings" },
    ];
    const games3: Matchup[] = [
      { id: "g1", date: "2026-04-01", away: "FLAT", home: "WEAK" },
      { id: "g2", date: "2026-04-05", away: "FLAT", home: "WEAK" },
      { id: "g3", date: "2026-04-10", away: "VET", home: "WEAK" },
      { id: "g4", date: "2026-04-15", away: "VET", home: "WEAK" },
      { id: "up", date: "2026-05-01", away: "FLAT", home: "VET" },
    ];
    const logs3 = { g1: log(12, 2), g2: log(11, 3), g3: log(3, 2), g4: log(4, 3) };
    const sharedOpponent = [
      ...Array.from({ length: 4 }, (_, index) => ({
        home: "FLAT",
        away: "SCOUT",
        homeMargin: -11,
        date: `2026-03-0${index + 1}`,
        neutral: true,
      })),
      ...Array.from({ length: 4 }, (_, index) => ({
        home: "VET",
        away: "SCOUT",
        homeMargin: 5,
        date: `2026-03-1${index + 1}`,
        neutral: true,
      })),
    ];
    const build = (external: typeof sharedOpponent) => {
      const base = calculateTeams(bases3, games3, logs3, settings);
      const engine = buildPredictionEngine(base, games3, logs3, settings, external);
      return attachAdjustedRatings(base, engine.ratings);
    };

    const game = games3[4]!;
    expect(predictGame(game, build([]), settings).winnerId).toBe("FLAT");
    expect(predictGame(game, build(sharedOpponent), settings).winnerId).toBe("VET");

    // And the standings that follow it, which is what the bracket and the odds are read off.
    const seedOf = (teams: ReturnType<typeof build>) =>
      projectStandings(teams, [game], settings).findIndex((row) => row.id === "VET");
    expect(seedOf(build(sharedOpponent))).toBeLessThan(seedOf(build([])));
  });

  it("reaches the upcoming-game prediction and its confidence", () => {
    const scouted = withScout().engine.predictions.find((p) => p.gameId === "m6")!;
    const blind = withoutScout().engine.predictions.find((p) => p.gameId === "m6")!;

    expect(scouted.projectedMargin).toBeGreaterThan(blind.projectedMargin!);
    // Nine games of evidence is not a one-game unknown, and the confidence must stop saying it is.
    expect(scouted.confidence.score).toBeGreaterThan(blind.confidence.score);
    expect(blind.riskFactors).toContain("Small sample size can make ratings unstable.");
    expect(scouted.riskFactors).not.toContain("Small sample size can make ratings unstable.");
  });

  it("reaches strength of schedule, for the team and for whoever has to play it", () => {
    const scouted = withScout().teams;
    const blind = withoutScout().teams;
    const newIn = (teams: typeof scouted) => teams.find((t) => t.id === "NEW")!;

    expect(teamPerformanceDifficultyScore(newIn(scouted), scouted, matchups, logs)).toBeGreaterThan(
      teamPerformanceDifficultyScore(newIn(blind), blind, matchups, logs)
    );
    // MID's remaining schedule is one game, against NEW.
    expect(
      scheduleDifficultyForTeam("MID", [upcoming], scouted, matchups, logs).rating
    ).toBeGreaterThan(scheduleDifficultyForTeam("MID", [upcoming], blind, matchups, logs).rating);
  });

  it("reaches elo, recent form and the trend", () => {
    const rowFor = (teams: ReturnType<typeof league>) =>
      teams.engine.powerRatings.find((row) => row.teamId === "NEW")!;
    const scouted = rowFor(withScout());
    const blind = rowFor(withoutScout());

    expect(scouted.elo).toBeGreaterThan(blind.elo);
    expect(scouted.recentForm).toBeGreaterThan(blind.recentForm);
    // Its own strength of schedule too: the rating's view of who it has faced.
    expect(scouted.strengthOfSchedule).not.toBeCloseTo(blind.strengthOfSchedule, 5);
  });

  it("calls a team with no league game at all New only when nobody has seen it play", () => {
    const soloBases: TeamBase[] = [{ id: "NEW", name: "Newcomers" }, ...bases.slice(1)];
    const unplayed = calculateTeams(soloBases, [], {}, settings);
    const seen = buildPredictionEngine(unplayed, [], {}, settings, externals);
    const unseen = buildPredictionEngine(unplayed, [], {}, settings, []);

    expect(unseen.powerRatings.find((row) => row.teamId === "NEW")!.trend).toBe("New");
    expect(seen.powerRatings.find((row) => row.teamId === "NEW")!.trend).not.toBe("New");
  });

  it("leaves the league record alone, which is the one thing a tournament is not part of", () => {
    const scouted = withScout().teams.find((t) => t.id === "NEW")!;
    const blind = withoutScout().teams.find((t) => t.id === "NEW")!;

    expect(scouted.w).toBe(blind.w);
    expect(scouted.l).toBe(blind.l);
    expect(scouted.games).toBe(blind.games);
    expect(scouted.rsg).toBe(blind.rsg);
    expect(scouted.rag).toBe(blind.rag);
  });

  it("changes nothing at all for a league with no pool behind it", () => {
    // The whole point of every fallback above: undefined rating means today's numbers, exactly.
    const plain = calculateTeams(bases, matchups, logs, settings);
    const engine = buildPredictionEngine(plain, matchups, logs, settings);
    const noRating = plain.map((team) => ({ ...team }));

    expect(noRating.every((team) => team.adjustedRating === undefined)).toBe(true);
    expect(predictGame(upcoming, noRating, settings)).toEqual(
      predictGame(upcoming, noRating, settings)
    );
    expect(engine.predictions).toHaveLength(1);
  });
});

describe("an undated tournament result", () => {
  it("still rates, but is left out of the two things that need an order", () => {
    const undated = externals.map(({ date: _dropped, ...rest }) => rest);
    const base = calculateTeams(bases, matchups, logs, settings);
    const engine = buildPredictionEngine(base, matchups, logs, settings, undated);
    const row = engine.powerRatings.find((r) => r.teamId === "NEW")!;
    const blind = withoutScout().engine.powerRatings.find((r) => r.teamId === "NEW")!;

    // The fit does not care when a game was played.
    expect(engine.ratings.games.get("NEW")).toBe(9);
    // Elo and form do, so an undated result is not guessed into a position.
    expect(row.elo).toBeCloseTo(blind.elo, 5);
    expect(row.recentForm).toBeCloseTo(blind.recentForm, 5);
  });
});
