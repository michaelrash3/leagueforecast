import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadAgeGroups,
  loadScoutGames,
  loadScoutTeams,
  saveAgeGroups,
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
        ageGroupId: "ag1",
        date: "2026-04-01",
        event: "Spring Classic",
      },
      // A scheduled game with no score yet.
      { id: "g2", teamAId: "S-ICEC", teamBId: "S-ROCK", ageGroupId: "ag1" },
    ];

    expect(saveScoutTeams(teams)).toBe(true);
    expect(saveScoutGames(games)).toBe(true);

    expect(loadScoutTeams()).toEqual(teams);
    expect(loadScoutGames()).toEqual(games);
  });

  it("round-trips age groups", () => {
    const ageGroups = [
      { id: "ag1", name: "2027", seasonIds: ["fall2026", "spring2027"] },
      { id: "ag2", name: "10U", seasonIds: [] },
      // Carries on from ag1 as the squad ages up, with its own "my team".
      { id: "ag3", name: "11U", seasonIds: [], continuesFromId: "ag1", myTeamId: "S-ICEC" },
    ];
    expect(saveAgeGroups(ageGroups)).toBe(true);
    expect(loadAgeGroups()).toEqual(ageGroups);
  });

  it("returns empty arrays when nothing is stored", () => {
    expect(loadScoutTeams()).toEqual([]);
    expect(loadScoutGames()).toEqual([]);
    expect(loadAgeGroups()).toEqual([]);
  });

  it("falls back safely from corrupted json", () => {
    backing.set("league_forecast_scout_teams_v1", "{not json");
    backing.set("league_forecast_scout_games_v1", "[1, 2,");
    backing.set("league_forecast_scout_age_groups_v1", "not json at all");
    expect(loadScoutTeams()).toEqual([]);
    expect(loadScoutGames()).toEqual([]);
    expect(loadAgeGroups()).toEqual([]);
  });

  it("drops malformed entries but keeps valid ones", () => {
    backing.set(
      "league_forecast_scout_teams_v1",
      JSON.stringify([{ id: "A", name: "Aces" }, { id: "no-name" }, "not an object"])
    );
    backing.set(
      "league_forecast_scout_games_v1",
      JSON.stringify([
        { id: "g1", teamAId: "A", teamBId: "B", ageGroupId: "ag1" },
        { id: "g2", teamAId: "A", ageGroupId: "ag1" }, // missing teamBId
        { id: "g3", teamAId: "A", teamBId: "B", teamAScore: "not a number", ageGroupId: "ag1" },
      ])
    );
    backing.set(
      "league_forecast_scout_age_groups_v1",
      JSON.stringify([
        { id: "ag1", name: "2027", seasonIds: ["fall2026"] },
        { id: "ag2", name: "no seasons array" }, // missing seasonIds
        { id: "ag3" }, // missing name
      ])
    );

    expect(loadScoutTeams()).toEqual([{ id: "A", name: "Aces" }]);
    expect(loadScoutGames()).toEqual([{ id: "g1", teamAId: "A", teamBId: "B", ageGroupId: "ag1" }]);
    expect(loadAgeGroups()).toEqual([{ id: "ag1", name: "2027", seasonIds: ["fall2026"] }]);
  });
});
