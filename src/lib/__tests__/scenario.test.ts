import { describe, expect, it } from "vitest";
import { pickedScore, scenarioSeason } from "../scenario";
import { calculateTeams, rankOptionsFromSettings, rankTeams } from "../sim";
import { DEFAULT_SETTINGS, type GameLog, type Matchup, type TeamBase } from "../types";

const settings = { ...DEFAULT_SETTINGS, goldCutoff: 2 };
const teams: TeamBase[] = ["A", "B", "C", "D"].map((id) => ({ id, name: id }));
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
const matchups: Matchup[] = [
  { id: "g1", date: "5/1", away: "A", home: "B" },
  { id: "g2", date: "5/1", away: "C", home: "D" },
  { id: "g3", date: "5/8", away: "A", home: "C" },
  { id: "g4", date: "5/8", away: "B", home: "D" },
  { id: "g5", date: "5/15", away: "D", home: "A" },
];
const logs = { g1: final("6", "2"), g2: final("3", "5") };
const base = () => {
  const liveTeams = calculateTeams(teams, matchups, logs, settings);
  return {
    teams,
    matchups,
    logs,
    settings,
    liveTeams,
    ratings: { byTeam: new Map<string, number>(), games: new Map<string, number>() },
  };
};

describe("the score a pick is played out at", () => {
  const game = matchups[2]!;

  it("is the model's when the pick agrees with it", () => {
    expect(pickedScore(game, { winnerId: "A" }, { awayScore: 6.4, homeScore: 3.2 })).toEqual({
      awayRuns: 6,
      homeRuns: 3,
    });
  });

  it("turns round when the pick goes against the model, and breaks a tie by a run", () => {
    expect(pickedScore(game, { winnerId: "C" }, { awayScore: 6.4, homeScore: 3.2 })).toEqual({
      awayRuns: 3,
      homeRuns: 6,
    });
    expect(pickedScore(game, { winnerId: "C" }, { awayScore: 4, homeScore: 4.2 })).toEqual({
      awayRuns: 4,
      homeRuns: 5,
    });
  });

  it("takes a typed score with the picked side ahead, and no other", () => {
    const model = { awayScore: 5, homeScore: 4 };
    expect(pickedScore(game, { winnerId: "A", awayRuns: 12, homeRuns: 0 }, model)).toEqual({
      awayRuns: 12,
      homeRuns: 0,
    });
    expect(pickedScore(game, { winnerId: "C", awayRuns: 12, homeRuns: 0 }, model)).toEqual({
      awayRuns: 4,
      homeRuns: 5,
    });
  });
});

describe("the season with some games settled by hand", () => {
  it("plays the picks as finals and ranks everybody as the standings would", () => {
    const scenario = scenarioSeason(base(), {
      g3: { winnerId: "C", awayRuns: 1, homeRuns: 9 },
      g4: { winnerId: "B", awayRuns: 7, homeRuns: 0 },
    });
    const byHand = rankTeams(
      calculateTeams(
        teams,
        matchups,
        { ...logs, g3: final("1", "9"), g4: final("7", "0") },
        settings
      ),
      rankOptionsFromSettings(settings)
    );
    expect(scenario.ranked.map((team) => [team.id, team.rank, team.w, team.l])).toEqual(
      byHand.map((team) => [team.id, team.rank, team.w, team.l])
    );
    expect(scenario.remaining.map((game) => game.id)).toEqual(["g5"]);
    expect(scenario.scores).toEqual({
      g3: { awayRuns: 1, homeRuns: 9 },
      g4: { awayRuns: 7, homeRuns: 0 },
    });
  });

  it("leaves a real result alone, and a pick for a side not in the game", () => {
    const scenario = scenarioSeason(base(), {
      g1: { winnerId: "B" },
      g5: { winnerId: "C" },
    });
    expect(scenario.scores).toEqual({});
    expect(scenario.remaining.map((game) => game.id)).toEqual(["g3", "g4", "g5"]);
  });

  it("changes nothing without picks", () => {
    const scenario = scenarioSeason(base(), {});
    expect(scenario.ranked.map((team) => team.id)).toEqual(
      rankTeams(base().liveTeams, rankOptionsFromSettings(settings)).map((team) => team.id)
    );
  });
});
