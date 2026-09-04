import { describe, expect, it } from "vitest";
import { buildPredictionEngine } from "../predictionEngine";
import { calculateTeams } from "../sim";
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
