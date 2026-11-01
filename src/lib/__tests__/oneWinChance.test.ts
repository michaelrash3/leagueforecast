import { describe, expect, it } from "vitest";
import { buildDemoSeason } from "../demoSeason";
import { buildPredictionEngine } from "../predictionEngine";
import { attachAdjustedRatings, calculateTeams, predictGame } from "../sim";
import {
  DEFAULT_SETTINGS,
  type GameLog,
  type Matchup,
  type Settings,
  type TeamBase,
} from "../types";

/*
 * League Standings worked out two win chances for every game still to play (sweep item 29): the
 * prediction engine's, read off a rating margin (`LeaguePrediction.winProbability`), which the
 * Dashboard's list showed, and the per-game model's (`predictGame`), which the Schedule, the Our
 * team card, the team drawer and the Gold odds read. The page now shows the per-game model's alone.
 * Neither model moved to do it: both are pinned here, game by game, on the demo season and on the
 * six-team season the App's numbers are pinned on (`AppLeagueNumbers.test.tsx`), as they stood
 * before the change. Placeholder teams.
 */

const chancesOf = (
  teams: TeamBase[],
  matchups: Matchup[],
  logs: Record<string, GameLog>,
  settings: Settings
) => {
  const base = calculateTeams(teams, matchups, logs, settings);
  const engine = buildPredictionEngine(base, matchups, logs, settings);
  const live = attachAdjustedRatings(base, engine.ratings);
  return engine.predictions.map((call) => {
    const game = matchups.find((one) => one.id === call.gameId);
    if (!game) throw new Error(`No game ${call.gameId}`);
    return {
      gameId: call.gameId,
      engine: call.winProbability.teamA,
      predictGame: predictGame(game, live, settings).awayWinPct,
    };
  });
};

const final = (away: number, home: number, awayHits = 6, homeHits = 5): GameLog => ({
  awayRuns: String(away),
  homeRuns: String(home),
  awayHits: String(awayHits),
  homeHits: String(homeHits),
  awayK: "4",
  homeK: "5",
  innings: "6",
  isFinal: true,
});

describe("the two win chances, as they stood", () => {
  it("on the demo season", () => {
    const { teams, matchups, logs, settings } = buildDemoSeason();
    expect(chancesOf(teams, matchups, logs, settings)).toMatchSnapshot();
  });

  it("on the App's pinned six-team season", () => {
    const teams = ["Aces", "Bears", "Comets", "Ducks", "Eagles", "Foxes"].map((name) => ({
      id: name[0] ?? name,
      name,
    }));
    const games: [string, string, string][] = [
      ["2026-09-05", "A", "B"],
      ["2026-09-05", "C", "D"],
      ["2026-09-05", "E", "F"],
      ["2026-09-12", "A", "C"],
      ["2026-09-12", "B", "E"],
      ["2026-09-12", "D", "F"],
      ["2026-09-19", "A", "D"],
      ["2026-09-19", "B", "F"],
      ["2026-09-19", "C", "E"],
      ["2026-10-03", "A", "E"],
      ["2026-10-03", "B", "D"],
      ["2026-10-03", "C", "F"],
      ["2026-10-10", "A", "F"],
      ["2026-10-10", "B", "C"],
      ["2026-10-10", "D", "E"],
    ];
    const matchups = games.map(([date, away, home], at) => ({
      id: `g${at + 1}`,
      date,
      away,
      home,
    }));
    const logs = {
      g1: final(7, 3),
      g2: final(4, 5, 7, 6),
      g3: final(2, 9, 3, 11),
      g4: final(6, 6, 8, 8),
      g5: final(3, 1),
      g6: final(10, 4, 12, 5),
      g7: final(5, 2),
      g8: final(1, 8, 2, 9),
      g9: final(4, 3, 6, 6),
    };
    expect(
      chancesOf(teams, matchups, logs, { ...DEFAULT_SETTINGS, goldCutoff: 4 })
    ).toMatchSnapshot();
  });
});
