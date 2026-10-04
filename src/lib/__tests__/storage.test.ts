import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadSettingsForSeason,
  readSeasonSnapshot,
  addSeasons,
  createSeason,
  deleteSeason,
  duplicateSeason,
  getActiveSeasonId,
  listSeasons,
  loadLogs,
  loadLogsForSeason,
  loadMatchups,
  loadMatchupsForSeason,
  loadSettings,
  loadTeams,
  loadTeamsForSeason,
  renameSeason,
  saveLogs,
  saveMatchups,
  saveSettings,
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

describe("a final across a reload", () => {
  it("stays final under a full box score with its strikeouts left blank", () => {
    // Machine pitch under the full box score is where a final without strikeouts used to be read
    // back as not final: the Scoreboard showed it Scheduled and the standings lost the game.
    saveTeams([
      { id: "A", name: "Aces" },
      { id: "B", name: "Bears" },
    ]);
    saveMatchups([{ id: "g1", date: "2026-05-01", away: "A", home: "B" }]);
    saveSettings({ ...loadSettings(), pitchMode: "machine", scoreDetail: "full" });
    const final = {
      awayRuns: "7",
      awayHits: "",
      awayK: "",
      homeRuns: "4",
      homeHits: "",
      homeK: "",
      innings: "6",
      isFinal: true,
    };
    saveLogs({ g1: final });

    expect(loadLogs()).toEqual({ g1: final });
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

  it("names a duplicate's own label after the duplicate, not the season it copied", () => {
    // The season switcher renames a season to match its label, so a copy that kept the original's
    // label was renamed back to the original's name the first time it was opened: two seasons of
    // one name, and no telling which was the copy.
    const first = listSeasons()[0]!;
    saveSettings({ ...loadSettings(), seasonLabel: "Spring 2026", goldCutoff: 5 });

    const copy = duplicateSeason(first.id, "Spring 2026 (what if)");
    setActiveSeason(copy!.id);
    expect(loadSettings().seasonLabel).toBe("Spring 2026 (what if)");
    // Everything else in the settings is the copy's to keep.
    expect(loadSettings().goldCutoff).toBe(5);
    setActiveSeason(first.id);
    expect(loadSettings().seasonLabel).toBe("Spring 2026");
  });

  it("duplicates a season's data into a new independent copy", () => {
    backing.set("league_teams_v1", JSON.stringify([{ id: "A", name: "Aces" }]));
    const first = listSeasons()[0]!;

    const copy = duplicateSeason(first.id, "Copy");
    expect(copy).not.toBeNull();
    setActiveSeason(copy!.id);
    expect(loadTeams()).toEqual([{ id: "A", name: "Aces" }]);

    // Editing the copy does not affect the original.
    saveTeams([
      { id: "A", name: "Aces" },
      { id: "B", name: "Bears" },
    ]);
    setActiveSeason(first.id);
    expect(loadTeams()).toEqual([{ id: "A", name: "Aces" }]);
  });

  it("renames seasons and refuses to delete the last one", () => {
    backing.set("league_teams_v1", JSON.stringify([{ id: "A", name: "Aces" }]));
    const first = listSeasons()[0]!;

    expect(renameSeason(first.id, "Renamed")).toBe(true);
    expect(listSeasons()[0]!.name).toBe("Renamed");
    // A cleared box is a box being edited, not a request to call the season "". The label in
    // Settings is typed into, and every keystroke reaches here.
    expect(renameSeason(first.id, "   ")).toBe(false);
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

  it("reads a specific season's data without switching the active season", () => {
    backing.set("league_teams_v1", JSON.stringify([{ id: "A", name: "Aces" }]));
    const first = listSeasons()[0]!;
    const second = createSeason("Second");

    setActiveSeason(second.id);
    saveTeams([
      { id: "B", name: "Bears" },
      { id: "C", name: "Cubs" },
    ]);
    saveMatchups([{ id: "g1", date: "5/1", away: "B", home: "C" }]);
    setActiveSeason(first.id);

    // Reading the inactive "second" season by id returns its own data...
    expect(loadTeamsForSeason(second.id)).toEqual([
      { id: "B", name: "Bears" },
      { id: "C", name: "Cubs" },
    ]);
    expect(loadMatchupsForSeason(second.id)).toEqual([
      { id: "g1", date: "5/1", away: "B", home: "C" },
    ]);
    expect(loadLogsForSeason(second.id)).toEqual({});
    // Reading never moves the active pointer, and the active season's own data is untouched.
    expect(getActiveSeasonId()).toBe(first.id);
    expect(loadTeams()).toEqual([{ id: "A", name: "Aces" }]);
    expect(loadMatchups()).toEqual([]);
  });

  it("adds seasons from elsewhere under their own ids, leaving those it holds as they are", () => {
    backing.set("league_teams_v1", JSON.stringify([{ id: "A", name: "Aces" }]));
    const first = listSeasons()[0]!;
    const arrived = {
      id: "Fall 2026",
      name: "Fall 2026",
      createdAt: "2026-08-01T00:00:00.000Z",
      teams: [{ id: "B", name: "Bears" }],
      matchups: [],
      logs: {},
      bracketLogs: {},
      settings: loadSettingsForSeason(first.id),
    };
    expect(addSeasons([arrived, { ...arrived, id: first.id, teams: [] }])).toBe(true);
    expect(listSeasons().map((season) => season.id)).toEqual([first.id, "Fall 2026"]);
    expect(readSeasonSnapshot("Fall 2026")).toMatchObject({ teams: [{ id: "B", name: "Bears" }] });
    expect(readSeasonSnapshot(first.id)?.teams).toEqual([{ id: "A", name: "Aces" }]);
    expect(getActiveSeasonId()).toBe(first.id);
    expect(readSeasonSnapshot("nowhere")).toBeNull();
  });
});

describe("a league team's Team Rankings pick", () => {
  it("survives a save and a load", () => {
    // It is stored on the team, so it rides the season key, duplicate, backup and undo with it.
    // Before this, every load rebuilt each team as {id, name} and the answer vanished silently.
    saveTeams([
      { id: "A", name: "Trash Pandas", scoutTeamId: "S-TRAS" },
      { id: "B", name: "Bears" },
    ]);
    expect(loadTeams()).toEqual([
      { id: "A", name: "Trash Pandas", scoutTeamId: "S-TRAS" },
      { id: "B", name: "Bears" },
    ]);
  });

  it("is absent, not empty, on a team saved before the field existed", () => {
    saveTeams([{ id: "A", name: "Aces" }]);
    expect(loadTeams()[0]).toEqual({ id: "A", name: "Aces" });
    expect("scoutTeamId" in loadTeams()[0]!).toBe(false);
  });

  it("drops a pick that is not a string", () => {
    localStorage.setItem(
      "league_season_default_teams_v1",
      JSON.stringify([{ id: "A", name: "Aces", scoutTeamId: 7 }])
    );
    expect(loadTeams()).toEqual([{ id: "A", name: "Aces" }]);
  });
});

describe("the one-time migration into a season namespace", () => {
  it("keeps the flat key when the copy is refused", () => {
    /*
     * The copy has to land before the original goes. A quota refusal is the ordinary way it does
     * not, and this runs at startup on a browser whose localStorage is already as full as the
     * season about to be copied into it — so removing regardless destroyed the league at the one
     * moment the user had done nothing but open the app.
     */
    const teams = JSON.stringify([{ id: "t1", name: "Trash Pandas" }]);
    backing.set("league_teams_v1", teams);
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => backing.get(k) ?? null,
      // Full, as a browser at quota is: reads and removes still work, writes do not.
      setItem: () => {
        throw new DOMException("QuotaExceededError");
      },
      removeItem: (k: string) => {
        backing.delete(k);
      },
    });

    // Reading is what triggers the migration.
    loadTeams();

    expect(backing.get("league_teams_v1")).toBe(teams);
  });

  it("moves the flat key across and clears it once the copy has landed", () => {
    backing.set("league_teams_v1", JSON.stringify([{ id: "t1", name: "Trash Pandas" }]));

    expect(loadTeams()).toEqual([{ id: "t1", name: "Trash Pandas" }]);
    expect(backing.get("league_teams_v1")).toBeUndefined();
    expect(backing.get("league_season_default_teams_v1")).toBeDefined();
  });
});
