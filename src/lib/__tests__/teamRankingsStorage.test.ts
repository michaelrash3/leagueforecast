import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GcTeamLink, ScoutGame, ScoutTeam } from "../teamRankings";
import {
  coerceGcTeamLink,
  coerceGcTeamLinks,
  coerceScoutGames,
  coerceScoutTeams,
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

const fullLink: GcTeamLink = {
  teamId: "gsUthn4XoIxS",
  name: "NV Stars 9u Scout",
  ageGroupId: "ag1",
  season: "fall",
  seasonYear: 2026,
  ageLevel: 9,
  avatarKey: "5192a689-d888-4ae5-abce-446885dca7c7",
  record: { win: 11, loss: 1, tie: 0 },
  importedAt: "2026-09-14T12:00:00.000Z",
};

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

  it("round-trips a team's city and GameChanger links, and a game's provenance", () => {
    const teams: ScoutTeam[] = [
      {
        id: "S-NVST",
        name: "NV Stars Scout",
        state: "KY",
        city: "Georgetown",
        gcTeams: [fullLink, { teamId: "zjvVkYnqLrf0", name: "NV Stars 9U", ageGroupId: "ag1" }],
      },
      { id: "S-ROCK", name: "Rockets" },
    ];
    const games: ScoutGame[] = [
      {
        id: "gc_gsUthn4XoIxS_59cdce43",
        teamAId: "S-NVST",
        teamBId: "S-ROCK",
        teamAScore: 12,
        teamBScore: 2,
        ageGroupId: "ag1",
        date: "2026-08-22",
        ageLevelA: 9,
        ageLevelB: 8,
        season: "Fall 2026",
        source: { kind: "gamechanger", teamId: "gsUthn4XoIxS", gameId: "59cdce43" },
      },
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

describe("coerceScoutTeams with GameChanger links", () => {
  it("drops a malformed link, not the team carrying it", () => {
    const teams = coerceScoutTeams([
      {
        id: "A",
        name: "Aces",
        city: "Georgetown",
        gcTeams: [
          fullLink,
          { name: "no team id", ageGroupId: "ag1" },
          { teamId: "   ", name: "blank team id", ageGroupId: "ag1" },
          { teamId: "x1", name: "no group", season: "fall" },
          { teamId: "x2", name: 9, ageGroupId: "ag1" },
          "not an object",
          null,
        ],
      },
    ]);
    expect(teams).toEqual([{ id: "A", name: "Aces", city: "Georgetown", gcTeams: [fullLink] }]);
  });

  it("keeps a team whose links are not a list, and adds no key for an empty list", () => {
    expect(coerceScoutTeams([{ id: "A", name: "Aces", gcTeams: "nope" }])).toEqual([
      { id: "A", name: "Aces" },
    ]);
    expect(coerceScoutTeams([{ id: "A", name: "Aces", gcTeams: [] }])).toEqual([
      { id: "A", name: "Aces" },
    ]);
    expect(coerceScoutTeams([{ id: "A", name: "Aces", city: 42 }])).toEqual([
      { id: "A", name: "Aces" },
    ]);
  });

  it("keeps a link whose optional fields are the wrong shape, minus those fields", () => {
    const link = coerceGcTeamLink({
      teamId: "x1",
      name: "Aces 9U",
      ageGroupId: "ag1",
      season: 2026,
      seasonYear: "2026",
      ageLevel: "9U",
      avatarKey: { id: "x" },
      record: { win: 1, loss: "0", tie: 0 },
      importedAt: 1700000000,
    });
    expect(link).toEqual({ teamId: "x1", name: "Aces 9U", ageGroupId: "ag1" });
  });

  it("reads a full link back exactly", () => {
    expect(coerceGcTeamLink(JSON.parse(JSON.stringify(fullLink)))).toEqual(fullLink);
    expect(coerceGcTeamLinks([fullLink, 1, {}])).toEqual([fullLink]);
    expect(coerceGcTeamLinks("nope")).toEqual([]);
  });
});

describe("coerceScoutGames with levels, seasons and sources", () => {
  const base = { id: "g1", teamAId: "A", teamBId: "B", ageGroupId: "ag1" };

  it("keeps well-formed levels, season and source", () => {
    const source = { kind: "gamechanger", teamId: "gsUthn4XoIxS", gameId: "59cdce43" };
    expect(
      coerceScoutGames([{ ...base, ageLevelA: 9, ageLevelB: 10, season: "Fall 2026", source }])
    ).toEqual([{ ...base, ageLevelA: 9, ageLevelB: 10, season: "Fall 2026", source }]);
  });

  it("drops a source that is not a GameChanger game, keeping the game", () => {
    expect(
      coerceScoutGames([
        { ...base, source: { kind: "csv", teamId: "x", gameId: "y" } },
        { ...base, id: "g2", source: { kind: "gamechanger", teamId: "x" } },
        { ...base, id: "g3", source: { kind: "gamechanger", teamId: "x", gameId: "" } },
        { ...base, id: "g4", source: "gamechanger" },
        { ...base, id: "g5", source: { kind: "gamechanger", teamId: "x", gameId: "y", extra: 1 } },
      ])
    ).toEqual([
      base,
      { ...base, id: "g2" },
      { ...base, id: "g3" },
      { ...base, id: "g4" },
      { ...base, id: "g5", source: { kind: "gamechanger", teamId: "x", gameId: "y" } },
    ]);
  });

  it("drops levels and seasons of the wrong type", () => {
    expect(
      coerceScoutGames([{ ...base, ageLevelA: "9", ageLevelB: Number.NaN, season: 2026 }])
    ).toEqual([base]);
  });
});

describe("healing a pool saved before placeholders were understood", () => {
  it("reads a placeholder-named team back as a slot", () => {
    saveScoutTeams([
      { id: "S-TBD1", name: "TBD- 08/04/26, 5:00 PM" },
      { id: "S-ACES", name: "Aces" },
    ]);
    const loaded = loadScoutTeams();
    expect(loaded.find((team) => team.id === "S-TBD1")!.placeholder).toBe(true);
    // A real club is untouched, and gains no flag it did not have.
    expect(loaded.find((team) => team.id === "S-ACES")).toEqual({ id: "S-ACES", name: "Aces" });
  });
});
