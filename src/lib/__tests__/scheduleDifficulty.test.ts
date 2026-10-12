import { describe, expect, it } from "vitest";
import { scheduleDifficultyForTeam, teamPerformanceDifficultyScore } from "../scheduleDifficulty";
import type { GameLog, Matchup, Team } from "../types";

const team = (
  id: string,
  rsg: number,
  rag: number,
  pct: number,
  rank: number,
  games = 10,
  extra: Partial<Team> = {}
): Team => ({
  id,
  name: id,
  w: Math.round(pct * games),
  l: games - Math.round(pct * games),
  t: 0,
  rs: rsg * games,
  ra: rag * games,
  games,
  pct,
  runDiff: (rsg - rag) * games,
  rsg,
  rag,
  hpg: 0,
  kpg: 0,
  oppKpg: 0,
  tpi: rsg - rag,
  baseTpi: rsg - rag,
  sos: 0,
  momentum: 0,
  awayK6: null,
  homeK6: null,
  totalK6: null,
  machineDifficulty: 0,
  rank,
  ...extra,
});

const finalLog = (awayRuns: string, homeRuns: string): GameLog => ({
  awayRuns,
  awayHits: "10",
  awayK: "3",
  homeRuns,
  homeHits: "10",
  homeK: "3",
  innings: "6",
  isFinal: true,
});

describe("schedule difficulty", () => {
  it("rewards scoring and prevention versus opponent averages over raw offense", () => {
    const rawSlugger = team("14 Seed Sluggers", 14, 16, 0.3, 14);
    const sluggerOpponent = team("Chaos Average", 14, 16, 0.5, 8);
    const opponentAdjustedGrinder = team("2 Seed Grinders", 3, 4, 0.7, 2);
    const grinderOpponent = team("Low Run Average", 6, 2, 0.5, 9);
    const league = [rawSlugger, sluggerOpponent, opponentAdjustedGrinder, grinderOpponent];
    const matchups: Matchup[] = [
      { id: "slugger-game", date: "", away: rawSlugger.id, home: sluggerOpponent.id },
      { id: "grinder-game", date: "", away: opponentAdjustedGrinder.id, home: grinderOpponent.id },
    ];
    const logs = {
      "slugger-game": finalLog("14", "16"),
      "grinder-game": finalLog("3", "4"),
    };

    expect(
      teamPerformanceDifficultyScore(opponentAdjustedGrinder, league, matchups, logs)
    ).toBeGreaterThan(teamPerformanceDifficultyScore(rawSlugger, league, matchups, logs));
  });

  it("summarizes remaining opponents with run profile details", () => {
    const teams = [team("target", 7, 7, 0.5, 6), team("Mashers", 14, 16, 0.4, 14)];
    const remaining: Matchup[] = [{ id: "g1", date: "", away: "target", home: "Mashers" }];

    const difficulty = scheduleDifficultyForTeam("target", remaining, teams);

    expect(difficulty.opponents).toContain("Mashers (14.0 R/G, 16.0 RA/G)");
    expect(difficulty.opponents).not.toContain("#14");
  });
});

/**
 * How a record becomes runs of margin.
 *
 * It was `(pct - 0.5) * 6`. The six was not measured — the app already had the conversion it
 * needed, in the constant a sweep had actually fitted — and the linear form quietly made two
 * claims nobody would have made out loud: that a 1-0 team is as strong as a 20-0 team, and that a
 * team which has not played yet is the worst side in the league.
 *
 * These numbers move. They are pinned to the digit here because strength of schedule is a figure
 * people read off the Model view, and a number that drifts without anyone noticing is worse than
 * one that was never right. Nothing downstream of this reaches a forecast: `sim.ts` does not read
 * it.
 */
describe("a record as runs of margin", () => {
  const league = () => [
    team("unrated-strong", 9, 4, 0.8, 1),
    team("unrated-weak", 4, 9, 0.2, 8),
    team("unrated-even", 6, 6, 0.5, 4),
    team("rated", 6, 6, 0.8, 2, 10, { adjustedRating: 1.5, ratedGames: 20 }),
    team("perfect", 9, 2, 1, 1, 6),
    team("winless", 2, 9, 0, 9, 6),
    team("no-games", 0, 0, 0, 9, 0),
  ];

  const scoreFor = (id: string) => {
    const teams = league();
    const found = teams.find((entry) => entry.id === id);
    if (!found) throw new Error(`no ${id}`);
    return teamPerformanceDifficultyScore(found, teams);
  };

  it("reads a team nobody has seen play as unknown, not as the worst in the league", () => {
    /*
     * The bug this found. `pct` is zero before a game is played, so the old linear conversion put
     * a brand-new team at -0.3 — below every side that had actually lost. Smoothing lands it on
     * an even record, which is what "we have not seen them play" should say.
     */
    expect(scoreFor("no-games")).toBe(0);
  });

  it("separates an undefeated team from a merely good one without running to infinity", () => {
    const perfect = scoreFor("perfect");
    const strong = scoreFor("unrated-strong");

    expect(Number.isFinite(perfect)).toBe(true);
    expect(perfect).toBeGreaterThan(strong);
  });

  it("is symmetric about an even record", () => {
    expect(scoreFor("unrated-even")).toBe(0);
    expect(scoreFor("unrated-weak")).toBeCloseTo(-scoreFor("unrated-strong"), 10);
    expect(scoreFor("winless")).toBeCloseTo(-scoreFor("perfect"), 10);
  });

  it("holds these exact numbers", () => {
    // Was 2.430000 / -2.430000 / 1.368000 / 3.450000 / -3.450000 / -0.300000 under `* 6`.
    expect(scoreFor("unrated-strong")).toBeCloseTo(2.534599, 6);
    expect(scoreFor("unrated-weak")).toBeCloseTo(-2.534599, 6);
    expect(scoreFor("rated")).toBeCloseTo(1.37846, 5);
    expect(scoreFor("perfect")).toBeCloseTo(3.7465, 4);
    expect(scoreFor("winless")).toBeCloseTo(-3.7465, 4);
  });

  it("still lets the fitted rating largely replace the profile where there is one", () => {
    const teams = league();
    const rated = teams.find((entry) => entry.id === "rated")!;
    const unrated = { ...rated, id: "twin", adjustedRating: undefined, ratedGames: undefined };

    // Same record and same run profile; the only difference is that one has been fitted. Twenty
    // rated games puts the weight near nine tenths, so the rating is most of the answer.
    const withRating = teamPerformanceDifficultyScore(rated, teams);
    const without = teamPerformanceDifficultyScore(unrated, [...teams, unrated]);
    expect(Math.abs(withRating - 1.5)).toBeLessThan(Math.abs(without - 1.5));
  });
});
