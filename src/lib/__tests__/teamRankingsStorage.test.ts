import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GcTeamLink, ScoutGame, ScoutTeam } from "../teamRankings";
import {
  clearTeamRankings,
  coerceGcTeamLink,
  coerceGcTeamLinks,
  coerceScoutGames,
  coerceScoutTeams,
  initTeamRankingsStore,
  loadAgeGroups,
  loadPullProgress,
  loadRefreshLog,
  loadTidyStamp,
  loadScoutGames,
  loadScoutTeams,
  resetTeamRankingsStore,
  saveAgeGroups,
  savePullProgress,
  saveRefreshLog,
  saveTidyStamp,
  saveScoutGames,
  saveScoutTeams,
  type PoolStoreIo,
} from "../teamRankingsStorage";

const backing = new Map<string, string>();

beforeEach(() => {
  // A test that opened the IndexedDB path must not leave the next one on it.
  resetTeamRankingsStore();
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

describe("clearing Team Rankings", () => {
  /** Everything the pool is made of, filled in so a reset has something to remove. */
  const fillPool = () => {
    saveAgeGroups([{ id: "ag1", name: "9U 2027", seasonIds: ["fall2026"] }]);
    saveScoutTeams([{ id: "S-ICEC", name: "Ice Cats" }]);
    saveScoutGames([{ id: "g1", teamAId: "S-ICEC", teamBId: "S-ROCK", ageGroupId: "ag1" }]);
    savePullProgress({
      ids: ["gc1"],
      settled: [],
      failures: [],
      startedAt: "2026-09-14T12:00:00.000Z",
      updatedAt: "2026-09-14T12:00:00.000Z",
    });
    saveRefreshLog({ "9": "2026-09-14" });
  };

  /** Nothing of the pool is left — the state of a browser that has never opened Team Rankings. */
  const expectEmptyPool = () => {
    expect(loadAgeGroups()).toEqual([]);
    expect(loadScoutTeams()).toEqual([]);
    expect(loadScoutGames()).toEqual([]);
    expect(loadPullProgress()).toBeNull();
    expect(loadRefreshLog()).toEqual({});
  };

  it("clears every key the pool is made of", () => {
    fillPool();
    expect(clearTeamRankings()).toBe(true);
    expectEmptyPool();
  });

  // League Standings keeps its own season-namespaced keys, and a reset here must not reach them.
  it("leaves League Standings data where it is", () => {
    fillPool();
    backing.set("league_forecast_teams_v1_fall2026", JSON.stringify([{ id: "t1" }]));
    backing.set("league_forecast_seasons_v1", JSON.stringify([{ id: "fall2026" }]));
    clearTeamRankings();
    expect(backing.get("league_forecast_teams_v1_fall2026")).toBe(JSON.stringify([{ id: "t1" }]));
    expect(backing.get("league_forecast_seasons_v1")).toBe(JSON.stringify([{ id: "fall2026" }]));
  });

  it("is happy to clear a pool that was already empty", () => {
    expect(clearTeamRankings()).toBe(true);
    expectEmptyPool();
  });

  it("clears the pool on the IndexedDB path too", async () => {
    const store = new Map<string, unknown>();
    const io: PoolStoreIo = {
      keys: async () => [...store.keys()],
      get: async (key) => store.get(key) ?? null,
      set: async (key, value) => {
        store.set(key, value);
        return true;
      },
      readLocal: () => null,
      clearLocal: () => {},
    };
    await initTeamRankingsStore(io);
    fillPool();
    // Saved to the cache, not to localStorage, so the reset has to reach the cache to be a reset.
    expect(loadScoutTeams()).toHaveLength(1);

    expect(clearTeamRankings()).toBe(true);
    expectEmptyPool();
  });
});

describe("decoding the pool once per version of it", () => {
  const idbIo = () => {
    const store = new Map<string, unknown>();
    const io: PoolStoreIo = {
      keys: async () => [...store.keys()],
      get: async (key) => store.get(key) ?? null,
      set: async (key, value) => {
        store.set(key, value);
        return true;
      },
      readLocal: () => null,
      clearLocal: () => {},
    };
    return io;
  };

  /*
   * The club-linking panel read the pool once per league team on every render, and Settings
   * re-renders on every keystroke - so at nationwide scale each character typed decoded a
   * 40,000-team pool a dozen times over. The decode is now keyed on the compact value's identity:
   * the same array comes back until the pool actually changes.
   */
  it("hands back the same arrays until the pool is saved again", async () => {
    await initTeamRankingsStore(idbIo());
    saveScoutTeams([
      { id: "A", name: "Aces" },
      { id: "B", name: "Bears" },
    ]);
    saveScoutGames([
      { id: "g1", teamAId: "A", teamBId: "B", ageGroupId: "ag1", teamAScore: 5, teamBScore: 3 },
    ]);

    const teams1 = loadScoutTeams();
    const games1 = loadScoutGames();
    // Twelve reads in a row, as the panel makes them: one decode, eleven free.
    for (let i = 0; i < 11; i += 1) {
      expect(loadScoutTeams()).toBe(teams1);
      expect(loadScoutGames()).toBe(games1);
    }
    expect(teams1).toEqual([
      { id: "A", name: "Aces" },
      { id: "B", name: "Bears" },
    ]);
  });

  it("decodes afresh the moment the pool changes, and not before", async () => {
    await initTeamRankingsStore(idbIo());
    saveScoutTeams([{ id: "A", name: "Aces" }]);
    const before = loadScoutTeams();

    saveScoutTeams([
      { id: "A", name: "Aces" },
      { id: "B", name: "Bears" },
    ]);
    const after = loadScoutTeams();

    expect(after).not.toBe(before);
    expect(after).toHaveLength(2);
    // And the earlier array is exactly what it was: a shared copy is never edited underneath a holder.
    expect(before).toEqual([{ id: "A", name: "Aces" }]);
  });

  it("does not let a reset keep a decoded pool alive", async () => {
    await initTeamRankingsStore(idbIo());
    saveScoutTeams([{ id: "A", name: "Aces" }]);
    const held = loadScoutTeams();
    resetTeamRankingsStore();
    // A fresh store answers empty, from a fresh decode - never from the copy the old store made.
    const fresh = loadScoutTeams();
    expect(fresh).toEqual([]);
    expect(fresh).not.toBe(held);
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

describe("the tidy stamp", () => {
  it("remembers the shape of the pool the tidy last saw", () => {
    expect(loadTidyStamp()).toBeNull();
    expect(saveTidyStamp("1|2|3|2026-09-15T18:02:58.539Z")).toBe(true);
    expect(loadTidyStamp()).toBe("1|2|3|2026-09-15T18:02:58.539Z");
  });
});
