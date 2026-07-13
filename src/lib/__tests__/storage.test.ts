import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSeason,
  deleteSeason,
  duplicateSeason,
  getActiveSeasonId,
  listSeasons,
  loadLogs,
  loadMatchups,
  loadSettings,
  loadTeams,
  renameSeason,
  saveTeams,
  setActiveSeason,
} from "../storage";

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

describe("storage hardening", () => {
  it("falls back safely from corrupted json", () => {
    backing.set("league_teams_v1", "{oops");
    expect(loadTeams()).toEqual([]);
  });

  it("coerces out-of-range settings", () => {
    backing.set("league_settings_v1", JSON.stringify({ goldCutoff: -3, maxScoreCap: 500 }));
    const settings = loadSettings();
    expect(settings.goldCutoff).toBe(1);
    expect(settings.maxScoreCap).toBe(35);
  });

  it("migrates the legacy default tiebreaker order to include runs scored", () => {
    backing.set(
      "league_settings_v1",
      JSON.stringify({ tiebreakerOrder: ["headToHead", "runDifferential", "runsAgainst"] })
    );

    expect(loadSettings().tiebreakerOrder).toEqual([
      "headToHead",
      "runDifferential",
      "runsAgainst",
      "runsFor",
    ]);
  });

  it("drops duplicate teams, invalid matchups, and orphan logs", () => {
    backing.set(
      "league_teams_v1",
      JSON.stringify([
        { id: "A", name: "Aces" },
        { id: "A", name: "Duplicate" },
        { id: "B", name: "Bears" },
      ])
    );
    backing.set(
      "league_matchups_v1",
      JSON.stringify([
        { id: "g1", date: "5/1", away: "A", home: "B" },
        { id: "g1", date: "5/2", away: "B", home: "A" },
        { id: "bad", date: "5/3", away: "A", home: "A" },
        { id: "missing", date: "5/4", away: "A", home: "Z" },
      ])
    );
    backing.set(
      "league_logs_v1",
      JSON.stringify({
        g1: {
          awayRuns: "101",
          awayHits: "88",
          awayK: "44",
          homeRuns: "3",
          homeHits: "7",
          homeK: "2",
          innings: "6",
          isFinal: true,
        },
        orphan: {
          awayRuns: "1",
          awayHits: "1",
          awayK: "1",
          homeRuns: "0",
          homeHits: "0",
          homeK: "0",
          innings: "6",
          isFinal: true,
        },
      })
    );

    expect(loadTeams()).toEqual([
      { id: "A", name: "Aces" },
      { id: "B", name: "Bears" },
    ]);
    expect(loadMatchups()).toEqual([{ id: "g1", date: "5/1", away: "A", home: "B" }]);
    expect(loadLogs()).toEqual({
      g1: {
        awayRuns: "35",
        awayHits: "88",
        awayK: "44",
        homeRuns: "3",
        homeHits: "7",
        homeK: "2",
        innings: "6",
        isFinal: true,
      },
    });
  });
});

describe("multi-season storage", () => {
  it("migrates legacy flat data into a default season", () => {
    backing.set("league_teams_v1", JSON.stringify([{ id: "A", name: "Aces" }]));
    backing.set("league_settings_v1", JSON.stringify({ seasonLabel: "Spring 2026" }));

    const seasons = listSeasons();
    expect(seasons).toHaveLength(1);
    expect(seasons[0]!.name).toBe("Spring 2026");
    expect(getActiveSeasonId()).toBe(seasons[0]!.id);
    expect(loadTeams()).toEqual([{ id: "A", name: "Aces" }]);
    // Flat key is moved, not left behind.
    expect(backing.get("league_teams_v1")).toBeUndefined();
  });

  it("keeps each season's data isolated when switching", () => {
    backing.set("league_teams_v1", JSON.stringify([{ id: "A", name: "Aces" }]));
    const first = listSeasons()[0]!;

    const second = createSeason("Fall 2026");
    expect(listSeasons()).toHaveLength(2);

    setActiveSeason(second.id);
    expect(getActiveSeasonId()).toBe(second.id);
    // A brand-new season starts empty.
    expect(loadTeams()).toEqual([]);
    saveTeams([{ id: "B", name: "Bears" }]);
    expect(loadTeams()).toEqual([{ id: "B", name: "Bears" }]);

    // The original season is untouched.
    setActiveSeason(first.id);
    expect(loadTeams()).toEqual([{ id: "A", name: "Aces" }]);
  });

  it("duplicates a season's data into a new independent copy", () => {
    backing.set("league_teams_v1", JSON.stringify([{ id: "A", name: "Aces" }]));
    const first = listSeasons()[0]!;

    const copy = duplicateSeason(first.id, "Copy");
    expect(copy).not.toBeNull();
    setActiveSeason(copy!.id);
    expect(loadTeams()).toEqual([{ id: "A", name: "Aces" }]);

    // Editing the copy does not affect the original.
    saveTeams([{ id: "A", name: "Aces" }, { id: "B", name: "Bears" }]);
    setActiveSeason(first.id);
    expect(loadTeams()).toEqual([{ id: "A", name: "Aces" }]);
  });

  it("renames seasons and refuses to delete the last one", () => {
    backing.set("league_teams_v1", JSON.stringify([{ id: "A", name: "Aces" }]));
    const first = listSeasons()[0]!;

    expect(renameSeason(first.id, "Renamed")).toBe(true);
    expect(listSeasons()[0]!.name).toBe("Renamed");
    expect(deleteSeason(first.id)).toBe(false);

    const second = createSeason("Second");
    expect(deleteSeason(second.id)).toBe(true);
    expect(listSeasons()).toHaveLength(1);
  });

  it("reassigns the active season after deleting the active one", () => {
    backing.set("league_teams_v1", JSON.stringify([{ id: "A", name: "Aces" }]));
    const first = listSeasons()[0]!;
    const second = createSeason("Second");
    setActiveSeason(second.id);

    expect(deleteSeason(second.id)).toBe(true);
    expect(getActiveSeasonId()).toBe(first.id);
  });
});
