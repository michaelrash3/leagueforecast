import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadScoutGames,
  loadScoutTeams,
  saveScoutGames,
  saveScoutTeams,
} from "../teamRankingsStorage";

const backing = new Map<string, string>();

beforeEach(() => {
  backing.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => {
      backing.set(k, v);
    },
    removeItem: (k: string) => {
      backing.delete(k);
    },
  });
});

describe("teamRankingsStorage", () => {
  it("round-trips teams and games", () => {
    const teams = [
      { id: "S-ICEC", name: "Ice Cats", isMine: true },
      { id: "S-ROCK", name: "Rockets" },
    ];
    const games = [
      {
        id: "g1",
        teamAId: "S-ICEC",
        teamBId: "S-ROCK",
        teamAScore: 5,
        teamBScore: 3,
        seasonId: "s1",
        date: "2026-04-01",
        event: "Spring Classic",
      },
      // A scheduled game with no score yet.
      { id: "g2", teamAId: "S-ICEC", teamBId: "S-ROCK", seasonId: "s1" },
    ];

    expect(saveScoutTeams(teams)).toBe(true);
    expect(saveScoutGames(games)).toBe(true);

    expect(loadScoutTeams()).toEqual(teams);
    expect(loadScoutGames()).toEqual(games);
  });

  it("returns empty arrays when nothing is stored", () => {
    expect(loadScoutTeams()).toEqual([]);
    expect(loadScoutGames()).toEqual([]);
  });

  it("falls back safely from corrupted json", () => {
    backing.set("league_forecast_scout_teams_v1", "{not json");
    backing.set("league_forecast_scout_games_v1", "[1, 2,");
    expect(loadScoutTeams()).toEqual([]);
    expect(loadScoutGames()).toEqual([]);
  });

  it("drops malformed entries but keeps valid ones", () => {
    backing.set(
      "league_forecast_scout_teams_v1",
      JSON.stringify([{ id: "A", name: "Aces" }, { id: "no-name" }, "not an object"])
    );
    backing.set(
      "league_forecast_scout_games_v1",
      JSON.stringify([
        { id: "g1", teamAId: "A", teamBId: "B", seasonId: "s1" },
        { id: "g2", teamAId: "A", seasonId: "s1" }, // missing teamBId
        { id: "g3", teamAId: "A", teamBId: "B", teamAScore: "not a number", seasonId: "s1" },
      ])
    );

    expect(loadScoutTeams()).toEqual([{ id: "A", name: "Aces" }]);
    expect(loadScoutGames()).toEqual([{ id: "g1", teamAId: "A", teamBId: "B", seasonId: "s1" }]);
  });
});
