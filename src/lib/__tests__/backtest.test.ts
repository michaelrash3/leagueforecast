import { describe, expect, it } from "vitest";
import { backtestPredictions, walkForward } from "../backtest";
import { buildDemoSeason } from "../demoSeason";
import { DEFAULT_SETTINGS, type GameLog, type Matchup, type TeamBase } from "../types";

const teams: TeamBase[] = [
  { id: "A", name: "A" },
  { id: "B", name: "B" },
];
const matchups: Matchup[] = [
  { id: "g1", date: "5/1", away: "A", home: "B" },
  { id: "g2", date: "5/2", away: "B", home: "A" },
];
const logs: Record<string, GameLog> = {
  g1: {
    awayRuns: "8",
    awayHits: "0",
    awayK: "0",
    homeRuns: "2",
    homeHits: "0",
    homeK: "0",
    innings: "6",
    isFinal: true,
  },
  g2: {
    awayRuns: "1",
    awayHits: "0",
    awayK: "0",
    homeRuns: "5",
    homeHits: "0",
    homeK: "0",
    innings: "6",
    isFinal: true,
  },
};

describe("backtestPredictions", () => {
  it("returns metrics and calibration buckets", () => {
    const out = backtestPredictions(teams, matchups, logs, DEFAULT_SETTINGS, 0.2);
    expect(out.sampleSize).toBe(2);
    expect(out.brierScore).toBeGreaterThanOrEqual(0);
    expect(out.brierScore).toBeLessThanOrEqual(1);
    expect(out.calibration.length).toBeGreaterThan(0);
  });

  it("reports winner accuracy and margin error over decisive games", () => {
    const out = backtestPredictions(teams, matchups, logs, DEFAULT_SETTINGS, 0.2);
    expect(out.winnerAccuracy).not.toBeNull();
    expect(out.winnerAccuracy!).toBeGreaterThanOrEqual(0);
    expect(out.winnerAccuracy!).toBeLessThanOrEqual(1);
    expect(out.averageMarginError).not.toBeNull();
    expect(out.averageMarginError!).toBeGreaterThanOrEqual(0);
    expect(out.highConfidenceSamples).toBeGreaterThanOrEqual(0);
    expect(out.highConfidenceSamples).toBeLessThanOrEqual(out.sampleSize);
  });

  it("returns null accuracy metrics when there are no decisive games", () => {
    const tie: Record<string, GameLog> = {
      g1: {
        awayRuns: "3",
        awayHits: "0",
        awayK: "0",
        homeRuns: "3",
        homeHits: "0",
        homeK: "0",
        innings: "6",
        isFinal: true,
      },
    };
    const out = backtestPredictions(teams, [matchups[0]!], tie, DEFAULT_SETTINGS, 0.2);
    expect(out.sampleSize).toBe(0);
    expect(out.winnerAccuracy).toBeNull();
    expect(out.averageMarginError).toBeNull();
    expect(out.highConfidenceAccuracy).toBeNull();
    expect(out.highConfidenceSamples).toBe(0);
  });
});

describe("the backtest, as pinned", () => {
  it("scores the league's own games as it always has where no outside result is given", () => {
    expect(backtestPredictions(teams, matchups, logs, DEFAULT_SETTINGS)).toMatchSnapshot();
  });
});

/*
 * The forecast reads the league's games and, by default, its teams' Team Rankings results; the
 * backtest that scores it read the league's games alone, because an outside result "carries no
 * date". They carry one now, and each game is called from the results played before its day, as
 * the Gold-odds trend reads them (`trend.ts`): the number on the Dashboard is the model shipped.
 */
describe("the backtest with the season's Team Rankings results", () => {
  const home = (awayRuns: string, homeRuns: string): GameLog => ({
    awayRuns,
    awayHits: "0",
    awayK: "0",
    homeRuns,
    homeHits: "0",
    homeK: "0",
    innings: "6",
    isFinal: true,
  });
  const season: Matchup[] = [
    { id: "g1", date: "5/1", away: "A", home: "B" },
    { id: "g2", date: "5/8", away: "B", home: "A" },
  ];
  const scores = { g1: home("1", "9"), g2: home("9", "1") };
  // Before the season: A lost heavily twice, B won heavily twice.
  const before = [
    { away: "A", home: "X", homeMargin: 12, date: "2026-04-18", neutral: true },
    { away: "A", home: "X", homeMargin: 10, date: "2026-04-19", neutral: true },
    { away: "B", home: "Y", homeMargin: -12, date: "2026-04-18", neutral: true },
    { away: "B", home: "Y", homeMargin: -10, date: "2026-04-19", neutral: true },
  ];

  it("calls each game from the results played before it, which can move the number", () => {
    const leagueOnly = backtestPredictions(teams, season, scores, DEFAULT_SETTINGS);
    const shipped = backtestPredictions(teams, season, scores, DEFAULT_SETTINGS, 0.1, {
      outside: before,
    });
    expect(shipped.sampleSize).toBe(leagueOnly.sampleSize);
    expect(shipped.brierScore).toBeLessThan(leagueOnly.brierScore);
  });

  it("never reads a result played on or after the game's day", () => {
    const later = [
      ...before,
      // A crushes everyone after the season: it must change nothing called before.
      { away: "A", home: "Z", homeMargin: -20, date: "2026-06-01", neutral: true },
      { away: "A", home: "Z", homeMargin: -20, date: "2026-05-08", neutral: true },
    ];
    expect(
      backtestPredictions(teams, season, scores, DEFAULT_SETTINGS, 0.1, { outside: later })
    ).toEqual(
      backtestPredictions(teams, season, scores, DEFAULT_SETTINGS, 0.1, { outside: before })
    );
  });

  it("orders a season over New Year by its own days, whatever the results after it say", () => {
    // October, then New Year's Day, in the 2027 squad year; results in April and July come after
    // every game, and once moved the season's year to start in January, so the backtest called
    // October's game knowing January's score.
    const winter: Matchup[] = [
      { id: "w1", date: "10/1", away: "A", home: "B" },
      { id: "w2", date: "1/1", away: "B", home: "A" },
    ];
    const winterScores = { w1: home("1", "9"), w2: home("9", "1") };
    const after = [
      { away: "A", home: "X", homeMargin: 3, date: "2027-04-10", neutral: true },
      { away: "B", home: "Y", homeMargin: -3, date: "2027-07-10", neutral: true },
    ];
    expect(
      backtestPredictions(teams, winter, winterScores, DEFAULT_SETTINGS, 0.1, {
        outside: after,
        squadYear: 2027,
      })
    ).toEqual(
      backtestPredictions(teams, winter, winterScores, DEFAULT_SETTINGS, 0.1, { squadYear: 2027 })
    );
  });
});

/*
 * The demo season's eighteen finals, at both pitches and with Team Rankings results dated before,
 * among and after its games: pinned before the walk was split out of `backtestPredictions`
 * (`walkForward`) so the research sweep could score each game itself, and held to the digit since.
 */
describe("the backtest of a whole season, as pinned", () => {
  const demo = buildDemoSeason();
  const ids = demo.teams.map((team) => team.id);
  const outside = ids.flatMap((id, at) => [
    { away: id, home: "X1", homeMargin: at - 3, date: "2026-03-28", neutral: true },
    { away: "X2", home: id, homeMargin: 4 - at, date: "2026-04-18", neutral: true },
    { away: id, home: "X3", homeMargin: (at % 3) - 1, date: "2026-05-09", neutral: true },
  ]);
  it.each(["player", "machine"] as const)("at %s pitch", (pitchMode) => {
    const settings = { ...demo.settings, pitchMode };
    expect({
      alone: backtestPredictions(demo.teams, demo.matchups, demo.logs, settings),
      withResults: backtestPredictions(demo.teams, demo.matchups, demo.logs, settings, 0.1, {
        outside,
        squadYear: 2026,
      }),
    }).toMatchSnapshot();
  });
});

/*
 * The walk on its own (`walkForward`), as the research sweep reads it to score both models from one
 * set of fits: every final handed over once, in the season's order, each called by an engine that
 * has seen only the finals before it, a tie among them, and that holds a forecast of the game.
 */
describe("the walk the backtest scores", () => {
  it("hands over each final in order, called from the finals before it alone", () => {
    const demo = buildDemoSeason();
    const tied = demo.matchups[4]!.id;
    const logs = { ...demo.logs, [tied]: { ...demo.logs[tied]!, homeRuns: "7", awayRuns: "7" } };
    const finals = demo.matchups
      .filter((game) => logs[game.id]?.isFinal)
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
      .map((game) => game.id);
    const seen: string[] = [];
    walkForward(demo.teams, demo.matchups, logs, demo.settings, {}, ({ game, engine }) => {
      expect(engine.accuracy.gamesEvaluated).toBe(seen.length);
      expect(engine.predictions.some((forecast) => forecast.gameId === game.id)).toBe(true);
      seen.push(game.id);
    });
    expect(seen).toEqual(finals);
    expect(seen).toContain(tied);
  });
});
