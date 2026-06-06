import { describe, expect, it } from "vitest";
import { scheduleDifficultyForTeam, teamPerformanceDifficultyScore } from "../scheduleDifficulty";
import type { GameLog, Matchup, Team } from "../types";

const team = (
  id: string,
  rsg: number,
  rag: number,
  pct: number,
  rank: number,
  games = 10
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
