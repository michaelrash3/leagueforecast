import { describe, expect, it } from "vitest";
import { buildOpponentAdjustedRatings } from "../powerRating";
import { buildPredictionEngine, type ExternalResult } from "../predictionEngine";
import { attachAdjustedRatings, calculateTeams, predictGame } from "../sim";
import { DEFAULT_SETTINGS, type GameLog, type Matchup, type TeamBase } from "../types";

const teams: TeamBase[] = [
  { id: "FAL", name: "Falcons" },
  { id: "WOL", name: "Wolves" },
  { id: "COM", name: "Comets" },
];

const matchups: Matchup[] = [
  { id: "1", date: "2026-04-01", away: "FAL", home: "WOL" },
  { id: "2", date: "2026-04-02", away: "FAL", home: "COM" },
  { id: "3", date: "2026-04-03", away: "WOL", home: "COM" },
  { id: "4", date: "2026-04-10", away: "FAL", home: "WOL" },
];

const logs: Record<string, GameLog> = {
  "1": {
    awayRuns: "9",
    homeRuns: "4",
    awayHits: "10",
    homeHits: "6",
    awayK: "3",
    homeK: "5",
    innings: "6",
    isFinal: true,
  },
  "2": {
    awayRuns: "7",
    homeRuns: "2",
    awayHits: "8",
    homeHits: "4",
    awayK: "4",
    homeK: "6",
    innings: "6",
    isFinal: true,
  },
  "3": {
    awayRuns: "6",
    homeRuns: "3",
    awayHits: "8",
    homeHits: "5",
    awayK: "4",
    homeK: "5",
    innings: "6",
    isFinal: true,
  },
  "4": {
    awayRuns: "",
    homeRuns: "",
    awayHits: "",
    homeHits: "",
    awayK: "",
    homeK: "",
    innings: "6",
    isFinal: false,
  },
};

describe("buildPredictionEngine", () => {
  it("produces explainable future-game forecasts with margin, probability, confidence, and power ratings", () => {
    const live = calculateTeams(teams, matchups, logs, DEFAULT_SETTINGS);
    const result = buildPredictionEngine(live, matchups, logs, DEFAULT_SETTINGS);

    expect(result.dataQuality.tier).not.toBe("Insufficient");
    expect(result.powerRatings[0]?.teamName).toBe("Falcons");
    expect(result.predictions).toHaveLength(1);
    expect(result.predictions[0]?.predictedWinnerId).toBe("FAL");
    expect(result.predictions[0]?.projectedMargin).toBeGreaterThan(0);
    expect(result.predictions[0]?.winProbability.teamA).toBeGreaterThan(0.5);
    expect(result.predictions[0]?.confidence.tier).toMatch(/Low|Moderate|Strong|High/);
    expect(result.predictions[0]?.keyFactors.length).toBeGreaterThan(0);
  });

  it("shows low-confidence insufficient states when no completed scores exist", () => {
    const blankLogs: Record<string, GameLog> = { "4": logs["4"]! };
    const live = calculateTeams(teams, [matchups[3]!], blankLogs, DEFAULT_SETTINGS);
    const result = buildPredictionEngine(live, [matchups[3]!], blankLogs, DEFAULT_SETTINGS);

    expect(result.dataQuality.tier).toBe("Insufficient");
    expect(result.predictions[0]?.predictedWinnerId).toBeNull();
    expect(result.predictions[0]?.confidence.tier).toBe("Low");
  });
});

describe("buildPredictionEngine with results from outside the league", () => {
  const live = () => calculateTeams(teams, matchups, logs, DEFAULT_SETTINGS);

  it("changes nothing when there are none, so the default path is untouched", () => {
    const without = buildPredictionEngine(live(), matchups, logs, DEFAULT_SETTINGS);
    const withEmpty = buildPredictionEngine(live(), matchups, logs, DEFAULT_SETTINGS, []);
    expect(withEmpty.powerRatings.map((r) => r.rating)).toEqual(
      without.powerRatings.map((r) => r.rating)
    );
  });

  it("moves a rating when a team is beaten badly outside the league", () => {
    // Wolves get thumped by a travel club the league never plays. That is real evidence about
    // Wolves, and the forecast for their next league game should feel it.
    const without = buildPredictionEngine(live(), matchups, logs, DEFAULT_SETTINGS);
    const withExtra = buildPredictionEngine(live(), matchups, logs, DEFAULT_SETTINGS, [
      { home: "S-TRAVEL", away: "WOL", homeMargin: 12 },
      { home: "S-TRAVEL", away: "WOL", homeMargin: 10 },
    ]);

    const ratingOf = (result: ReturnType<typeof buildPredictionEngine>, id: string) =>
      result.powerRatings.find((r) => r.teamId === id)?.rating ?? 0;

    expect(ratingOf(withExtra, "WOL")).toBeLessThan(ratingOf(without, "WOL"));
  });

  it("still reports records and games played from league play alone", () => {
    // The outside opponent must not turn up as a league team, and must not inflate anyone's
    // record — it changes the forecast, not the season.
    const withExtra = buildPredictionEngine(live(), matchups, logs, DEFAULT_SETTINGS, [
      { home: "S-TRAVEL", away: "WOL", homeMargin: 12 },
    ]);
    expect(withExtra.powerRatings.map((r) => r.teamId).sort()).toEqual(["COM", "FAL", "WOL"]);
    expect(withExtra.powerRatings.every((r) => r.teamName !== "S-TRAVEL")).toBe(true);
  });
});

describe("home/away is a coin flip at this level", () => {
  it("does not fit a home-field edge out of an arbitrary designation", () => {
    // Which side is recorded as home is decided by a coin flip in nearly every game, so any
    // home-field coefficient fitted from it is noise that every prediction then subtracts.
    const live = calculateTeams(teams, matchups, logs, DEFAULT_SETTINGS);
    const result = buildPredictionEngine(live, matchups, logs, DEFAULT_SETTINGS);
    expect(result.powerRatings.length).toBeGreaterThan(0);
    // Ratings still separate the teams; only the home term is gone.
    const ratings = result.powerRatings.map((r) => r.rating);
    expect(Math.max(...ratings)).toBeGreaterThan(Math.min(...ratings));
  });

  it("forecasts from outside results alone before any league game is final", () => {
    // A preseason tournament is exactly the thin-schedule case these help most, and gating on a
    // league final would have made them useless until the season started.
    const noLogs: Record<string, GameLog> = {};
    const live = calculateTeams(teams, matchups, noLogs, DEFAULT_SETTINGS);
    const cold = buildPredictionEngine(live, matchups, noLogs, DEFAULT_SETTINGS);
    expect(cold.dataQuality.tier).toBe("Insufficient");

    const warm = buildPredictionEngine(live, matchups, noLogs, DEFAULT_SETTINGS, [
      { home: "FAL", away: "S-TRAVEL", homeMargin: 8, neutral: true },
      { home: "WOL", away: "S-TRAVEL", homeMargin: -6, neutral: true },
    ]);
    expect(warm.dataQuality.tier).not.toBe("Insufficient");
  });
});

describe("buildPredictionEngine with no cap on the run differential", () => {
  // Falcons win by 5 and by 14; Wolves beat Comets by 3. The 14 is past every cap on offer.
  const final = (awayRuns: string, homeRuns: string): GameLog => ({
    awayRuns,
    homeRuns,
    awayHits: "",
    homeHits: "",
    awayK: "",
    homeK: "",
    innings: "6",
    isFinal: true,
  });
  const played: Record<string, GameLog> = {
    "1": final("9", "4"),
    "2": final("16", "2"),
    "3": final("6", "3"),
  };
  const games = matchups.slice(0, 3);
  const engineAt = (maxRunDifferential: number) => {
    const settings = { ...DEFAULT_SETTINGS, autoRunDiffCap: false, maxRunDifferential };
    return buildPredictionEngine(
      calculateTeams(teams, games, played, settings),
      games,
      played,
      settings
    );
  };
  const ratingsOf = (result: ReturnType<typeof buildPredictionEngine>) =>
    Object.fromEntries(result.powerRatings.map((row) => [row.teamId, row.rating]));

  it("rates on the margins as played, not on none at all", () => {
    // "No cap" is stored as 0, which the standings read as no cap and the fit read as a cap of
    // zero runs: every margin clamped to nothing, every rating 0.00, the table in alphabetical
    // order and every forecast pulled toward a coin flip.
    const uncapped = ratingsOf(engineAt(0));
    const asPlayed = buildOpponentAdjustedRatings(
      ["FAL", "WOL", "COM"],
      [
        { home: "WOL", away: "FAL", homeMargin: -5, neutral: true },
        { home: "COM", away: "FAL", homeMargin: -14, neutral: true },
        { home: "COM", away: "WOL", homeMargin: -3, neutral: true },
      ],
      { cap: Infinity }
    );
    for (const id of ["FAL", "WOL", "COM"]) {
      expect(uncapped[id]).toBeCloseTo(asPlayed.ratings.get(id) ?? NaN, 9);
    }
    expect(engineAt(0).powerRatings[0]?.teamId).toBe("FAL");
  });

  /*
   * The league's cap is a standings rule, and the forecast is not bound by it (the user, 28
   * September 2026): every setting rates the 14-run win as fourteen, up to `FORECAST_RUN_CAP`.
   */
  it("rates the 14-run win as played, whatever cap the league's standings use", () => {
    const uncapped = ratingsOf(engineAt(0));
    for (const cap of [8, 10]) {
      const at = ratingsOf(engineAt(cap));
      for (const id of ["FAL", "WOL", "COM"]) expect(at[id]).toBeCloseTo(uncapped[id] ?? NaN, 9);
    }
  });
});

/*
 * The forecast's own cap, the Dashboard's odds and the rating's weight in a game's forecast, held
 * to the digit. Each moved on purpose on 28 September 2026 (see `FORECAST_RUN_CAP`,
 * `MATCHUP_ODDS_SPREAD` and `RATING_EDGE_PER_RUN`), and the numbers they had before are in the
 * comments beside the ones they have now.
 */
describe("the forecast's cap, odds and rating weight", () => {
  const four: TeamBase[] = [...teams, { id: "BEA", name: "Bears" }];
  const final = (awayRuns: string, homeRuns: string): GameLog => ({
    awayRuns,
    homeRuns,
    awayHits: "",
    homeHits: "",
    awayK: "",
    homeK: "",
    innings: "6",
    isFinal: true,
  });
  const schedule: Matchup[] = [
    { id: "1", date: "4/1", away: "FAL", home: "WOL" },
    { id: "2", date: "4/2", away: "FAL", home: "COM" },
    { id: "3", date: "4/3", away: "WOL", home: "COM" },
    { id: "4", date: "4/4", away: "BEA", home: "FAL" },
    { id: "5", date: "4/5", away: "COM", home: "BEA" },
    { id: "6", date: "4/6", away: "WOL", home: "BEA" },
    { id: "7", date: "4/10", away: "FAL", home: "BEA" },
    { id: "8", date: "4/11", away: "COM", home: "WOL" },
  ];
  const played: Record<string, GameLog> = {
    "1": final("9", "4"),
    "2": final("16", "2"),
    "3": final("6", "3"),
    "4": final("3", "7"),
    "5": final("5", "6"),
    "6": final("8", "2"),
  };
  const settingsFor = (pitchMode: "player" | "machine") => ({
    ...DEFAULT_SETTINGS,
    autoRunDiffCap: false,
    maxRunDifferential: 8,
    pitchMode,
  });
  const run = (pitchMode: "player" | "machine" = "player", logs = played) => {
    const settings = settingsFor(pitchMode);
    const base = calculateTeams(four, schedule, logs, settings);
    const engine = buildPredictionEngine(base, schedule, logs, settings);
    const state = attachAdjustedRatings(base, engine.ratings);
    const byId = new Map(state.map((team) => [team.id, team]));
    return { base, engine, state, byId, settings };
  };

  it("fits the ratings on real margins up to twenty runs", () => {
    const { engine } = run();
    const rating = Object.fromEntries(engine.powerRatings.map((row) => [row.teamId, row.rating]));
    expect(rating.FAL).toBeCloseTo(4.181818, 6); // 3.090909 at the league's cap of 8
    expect(rating.WOL).toBeCloseTo(0.727273, 6); // unchanged
    expect(rating.BEA).toBeCloseTo(-1.636364, 6); // unchanged
    expect(rating.COM).toBeCloseTo(-3.272727, 6); // -2.181818
  });

  it("counts a mistyped ninety-run win as twenty", () => {
    const typo = run("player", { ...played, "2": final("91", "1") });
    const twenty = run("player", { ...played, "2": final("21", "1") });
    const of = (engine: ReturnType<typeof buildPredictionEngine>) =>
      engine.powerRatings.map((row) => [row.teamId, row.rating.toFixed(9)]);
    expect(of(typo.engine)).toEqual(of(twenty.engine));
  });

  it("keeps the league's own cap in the standings' run differential", () => {
    const { base } = run();
    // Falcons: +5, +14 and +4 as played; the standings count the 14 as the rule's 8.
    expect(base.find((team) => team.id === "FAL")?.runDiff).toBe(17);
  });

  it("gives the Dashboard's odds on the wider spread, narrower for machine pitch", () => {
    const player = run().engine.predictions.find((one) => one.gameId === "7");
    expect(player?.projectedMargin).toBe(6.2); // 5.1
    expect(player?.winProbability.teamA).toBe(0.79); // 0.86 on 2.8 and ratings capped at 8
    const machine = run("machine").engine.predictions.find((one) => one.gameId === "7");
    expect(machine?.winProbability.teamA).toBe(0.83);
  });

  it("leans a game's forecast on the rating at 0.43 a run", () => {
    const { state, byId, settings } = run();
    const chance = (id: string) =>
      predictGame(
        schedule.find((game) => game.id === id)!,
        state,
        settings,
        byId
      ).awayWinPct;
    expect(chance("7")).toBeCloseTo(0.772248, 6); // 0.655900 at 0.25 and the cap of 8
    expect(chance("8")).toBeCloseTo(0.297402, 6); // 0.394955
  });
});

describe("buildPredictionEngine placing a spring league among last autumn's tournaments", () => {
  // Falcons lose five tournament games by 6 in September and October 2026, then win five league
  // games by 6 in April and May 2027: a spring league in squad year 2027, climbing.
  const final = (awayRuns: string, homeRuns: string): GameLog => ({
    awayRuns,
    homeRuns,
    awayHits: "",
    homeHits: "",
    awayK: "",
    homeK: "",
    innings: "6",
    isFinal: true,
  });
  const spring: Matchup[] = ["4/11", "4/18", "4/25", "5/2", "5/9"].map((date, at) => ({
    id: `s${at}`,
    date,
    away: "FAL",
    home: at % 2 === 0 ? "WOL" : "COM",
  }));
  const played = Object.fromEntries(spring.map((game) => [game.id, final("8", "2")]));
  const autumn: ExternalResult[] = [
    "2026-09-06",
    "2026-09-13",
    "2026-09-20",
    "2026-09-27",
    "2026-10-04",
  ].map((date, at) => ({
    home: `S-OUT${at}`,
    away: "FAL",
    homeMargin: 6,
    date,
    neutral: true,
  }));
  const falconsIn = (squadYear?: number) =>
    buildPredictionEngine(
      calculateTeams(teams, spring, played, DEFAULT_SETTINGS),
      spring,
      played,
      DEFAULT_SETTINGS,
      autumn,
      squadYear
    ).powerRatings.find((row) => row.teamId === "FAL");

  it("reads the league's spring as the newest games, not last autumn", () => {
    // Without a year both read as one calendar year, and October came after May.
    const falcons = falconsIn(2027);
    expect(falcons?.recentForm).toBeCloseTo(6, 9);
    expect(falcons?.trend).toBe("Up");
  });
});
