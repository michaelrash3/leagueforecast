import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetCloudGuard } from "../cloud/cloudGuard";
import { readLeagueClubRanks, writeLeagueClubRanks } from "../leagueClubRanks";
import {
  readNotified,
  readOurTeam,
  readPutAside,
  readSeen,
  writeNotified,
  writeOurTeam,
  writePutAside,
  writeSeen,
} from "../preferences";
import { keepScenario, readScenarios } from "../savedScenarios";
import { seenOf } from "../seasonDigest";
import {
  loadSettingsForSeason,
  readSeasonSnapshot,
  replaceLeagueSnapshot,
  type SeasonSnapshot,
  addSeasons,
  adoptSeasonCreatedAt,
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
  resetCloudGuard();
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

  it("gives a season the creation time of the season it has become, and no other", () => {
    const first = listSeasons()[0]!;
    expect(adoptSeasonCreatedAt(first.id, "2026-08-01T00:00:00.000Z")).toBe(true);
    expect(listSeasons()[0]).toMatchObject({ id: first.id, createdAt: "2026-08-01T00:00:00.000Z" });
    expect(adoptSeasonCreatedAt(first.id, "2026-08-01T00:00:00.000Z")).toBe(false);
    expect(adoptSeasonCreatedAt("nowhere", "2026-08-01T00:00:00.000Z")).toBe(false);
    expect(listSeasons()).toHaveLength(1);
  });
});

/*
 * A season id is handed out again: `createSeason` counts from the seasons held, and every
 * browser's first season is `default`. What this device keeps of a season under its id, its last
 * look, the findings put aside, the team followed, the playoff scenarios and the server's last
 * bridge, belongs to that season alone, and a season given the id after it starts with none of it.
 * Placeholder teams.
 */
describe("what this device keeps of a season under its id", () => {
  const T = "2026-05-01T00:00:00.000Z";

  /** The server's last bridge for each season, as `useScoutBridge` keeps it. */
  const BRIDGE = "lf_league_bridge_v2";
  const bridges = (): object => JSON.parse(localStorage.getItem(BRIDGE) ?? "{}") as object;

  /**
   * A last look, a finding put aside, a team followed, a scenario, a clinch already announced, the
   * followed club's place on Team Rankings and the server's last bridge, kept for `id`.
   */
  const keepOnDevice = (id: string) => {
    writeSeen(
      id,
      seenOf({
        teams: [
          { id: "A", name: "Aces" },
          { id: "B", name: "Bears" },
        ],
        matchups: [{ id: "g1", date: "5/1", away: "A", home: "B" }],
        logs: {},
      })
    );
    writePutAside(id, { "missing-date:g1": "info" });
    writeOurTeam(id, "A");
    keepScenario({
      version: 1,
      id: "sc-1",
      name: "Aces win out",
      seasonId: id,
      picks: { g1: { winnerId: "A" } },
      basis: { g1: { away: "A", home: "B", date: "5/1" } },
      createdAt: T,
      modifiedAt: T,
    });
    // Told by team alone, so a season of the same names under the id would never be told it.
    writeNotified(new Set([...readNotified(), `${id}:clinched:A:`]));
    writeLeagueClubRanks(id, { A: { clubId: "club-a", board: "9U 2027", rank: 3, of: 40, at: T } });
    // What the forecast reads offline until the server answers again (`useScoutBridge`).
    localStorage.setItem(BRIDGE, JSON.stringify({ ...bridges(), [id]: { results: [] } }));
  };
  const keptOnDevice = (id: string) => ({
    seen: readSeen(id) !== null,
    putAside: Object.keys(readPutAside(id)),
    ourTeam: readOurTeam(id),
    scenarios: readScenarios(id).map((scenario) => scenario.name),
    notified: [...readNotified()]
      .filter((key) => key.startsWith(`${id}:`))
      .map((key) => key.slice(id.length + 1)),
    clubRanks: Object.keys(readLeagueClubRanks()[id] ?? {}),
    bridge: Object.keys(bridges()).includes(id),
  });
  const ALL = {
    seen: true,
    putAside: ["missing-date:g1"],
    ourTeam: "A",
    scenarios: ["Aces win out"],
    notified: ["clinched:A:"],
    clubRanks: ["A"],
    bridge: true,
  };
  const NONE = {
    seen: false,
    putAside: [],
    ourTeam: null,
    scenarios: [],
    notified: [],
    clubRanks: [],
    bridge: false,
  };

  const arriving = (id: string, createdAt = T): SeasonSnapshot => ({
    id,
    name: id,
    createdAt,
    teams: [{ id: "C", name: "Comets" }],
    matchups: [],
    logs: {},
    bracketLogs: {},
    settings: loadSettingsForSeason("default"),
  });

  it("goes with the season deleted, and only with it", () => {
    const first = listSeasons()[0]!;
    const second = createSeason("Spring");
    keepOnDevice(first.id);
    keepOnDevice(second.id);

    expect(deleteSeason(second.id)).toBe(true);

    expect(keptOnDevice(second.id)).toEqual(NONE);
    expect(keptOnDevice(first.id)).toEqual(ALL);
    const next = createSeason("Fall");
    expect(next.id).toBe(second.id);
    expect(keptOnDevice(next.id)).toEqual(NONE);
  });

  it("is none of a season made here, whatever a season gone before left under its id", () => {
    // Left by a season deleted before its keeping went with it.
    keepOnDevice("season-2");
    keepOnDevice("season-3");

    expect(createSeason("Spring").id).toBe("season-2");
    expect(keptOnDevice("season-2")).toEqual(NONE);
    expect(duplicateSeason("season-2", "Spring copy")?.id).toBe("season-3");
    expect(keptOnDevice("season-3")).toEqual(NONE);
  });

  it("is none of a season arriving from elsewhere, and stays with one held here", () => {
    const first = listSeasons()[0]!;
    keepOnDevice(first.id);
    keepOnDevice("season-2");

    expect(addSeasons([arriving("season-2"), arriving(first.id)])).toBe(true);

    expect(keptOnDevice("season-2")).toEqual(NONE);
    expect(keptOnDevice(first.id)).toEqual(ALL);
  });

  it("stays through a restore of the same season, and goes with one dropped or replaced", () => {
    const first = listSeasons()[0]!;
    const second = createSeason("Spring");
    const third = createSeason("Summer");
    [first.id, second.id, third.id, "season-9"].forEach(keepOnDevice);

    expect(
      replaceLeagueSnapshot({
        activeSeasonId: first.id,
        seasons: [
          readSeasonSnapshot(first.id)!,
          // Another season under the id, made at another moment: a backup from before the one
          // held here was deleted and the id given again.
          { ...readSeasonSnapshot(second.id)!, createdAt: "2025-04-01T00:00:00.000Z" },
          arriving("season-9"),
        ],
      })
    ).toBe(true);

    expect(keptOnDevice(first.id)).toEqual(ALL);
    expect(keptOnDevice(second.id)).toEqual(NONE);
    expect(keptOnDevice(third.id)).toEqual(NONE);
    expect(keptOnDevice("season-9")).toEqual(NONE);
  });

  // The other side's season under the id made at another moment, or at a moment it never kept.
  it.each(["2025-04-01T00:00:00.000Z", ""])(
    "moves with this device's season to the id a cloud merge gave it (other made at %j)",
    (otherMadeAt) => {
      const first = listSeasons()[0]!;
      saveTeams([{ id: "A", name: "Aces" }]);
      keepOnDevice(first.id);
      // Left under the new id by a season gone before.
      writeOurTeam("season-7", "Z");
      const mine = readSeasonSnapshot(first.id)!;

      expect(
        replaceLeagueSnapshot(
          {
            activeSeasonId: "season-7",
            // The cloud's season under the id, and this device's beside it under its new one.
            seasons: [arriving(first.id, otherMadeAt), { ...mine, id: "season-7" }],
          },
          { fromCloud: true, renamed: { [first.id]: "season-7" } }
        )
      ).toBe(true);

      expect(keptOnDevice("season-7")).toEqual(ALL);
      expect(keptOnDevice(first.id)).toEqual(NONE);
    }
  );

  it("comes back with this device's season from a backup taken before a merge gave it a new id", () => {
    const first = listSeasons()[0]!;
    saveTeams([{ id: "A", name: "Aces" }]);
    keepOnDevice(first.id);
    const before = readSeasonSnapshot(first.id)!;
    replaceLeagueSnapshot(
      {
        activeSeasonId: "season-7",
        seasons: [arriving(first.id, "2025-04-01T00:00:00.000Z"), { ...before, id: "season-7" }],
      },
      { fromCloud: true, renamed: { [first.id]: "season-7" } }
    );
    expect(keptOnDevice("season-7")).toEqual(ALL);

    // The backup restored: made at the same moment, it is this device's season under its old id.
    expect(replaceLeagueSnapshot({ activeSeasonId: first.id, seasons: [before] })).toBe(true);

    expect(keptOnDevice(first.id)).toEqual(ALL);
    expect(keptOnDevice("season-7")).toEqual(NONE);
  });

  it("keeps a season carried again its own, whatever else was made at the same moment", () => {
    const first = listSeasons()[0]!;
    const second = createSeason("Spring");
    // Made in the same millisecond, as two seasons made by one click's work can be.
    replaceLeagueSnapshot({
      activeSeasonId: first.id,
      seasons: [
        { ...readSeasonSnapshot(first.id)!, createdAt: T },
        { ...readSeasonSnapshot(second.id)!, createdAt: T },
      ],
    });
    keepOnDevice(first.id);
    keepOnDevice(second.id);
    writeOurTeam(second.id, "B");

    expect(
      replaceLeagueSnapshot({ activeSeasonId: first.id, seasons: [readSeasonSnapshot(first.id)!] })
    ).toBe(true);

    expect(readOurTeam(first.id)).toBe("A");
    expect(keptOnDevice(second.id)).toEqual(NONE);
    // Nor does a season new here, carried beside it and made in the same millisecond, take it.
    const again = readSeasonSnapshot(first.id)!;
    expect(
      replaceLeagueSnapshot({
        activeSeasonId: first.id,
        seasons: [again, { ...again, id: "season-5" }],
      })
    ).toBe(true);
    expect(keptOnDevice(first.id)).toEqual(ALL);
    expect(keptOnDevice("season-5")).toEqual(NONE);
  });

  it("carries nothing to a season under another id made at another moment, or at none", () => {
    const first = listSeasons()[0]!;
    const second = createSeason("Spring");
    // The second held as one from before seasons kept the moment they were made.
    replaceLeagueSnapshot({
      activeSeasonId: first.id,
      seasons: [
        readSeasonSnapshot(first.id)!,
        { ...readSeasonSnapshot(second.id)!, createdAt: "" },
      ],
    });
    keepOnDevice(first.id);
    keepOnDevice(second.id);
    const mine = readSeasonSnapshot(first.id)!;
    const undated = readSeasonSnapshot(second.id)!;

    expect(
      replaceLeagueSnapshot({
        activeSeasonId: "season-8",
        seasons: [
          { ...mine, id: "season-8", createdAt: "2025-04-01T00:00:00.000Z" },
          { ...undated, id: "season-9" },
        ],
      })
    ).toBe(true);

    [first.id, second.id, "season-8", "season-9"].forEach((id) =>
      expect(keptOnDevice(id)).toEqual(NONE)
    );
  });

  it("moves only a season held here, and only to an id the seasons carry", () => {
    const first = listSeasons()[0]!;
    keepOnDevice(first.id);
    // Left by a season deleted before its keeping went with it.
    keepOnDevice("season-5");

    expect(
      replaceLeagueSnapshot(
        {
          activeSeasonId: first.id,
          seasons: [readSeasonSnapshot(first.id)!, arriving("season-7")],
        },
        { fromCloud: true, renamed: { "season-5": "season-7", [first.id]: "season-8" } }
      )
    ).toBe(true);

    expect(keptOnDevice("season-7")).toEqual(NONE);
    expect(keptOnDevice(first.id)).toEqual(ALL);
    expect(keptOnDevice("season-8")).toEqual(NONE);
  });

  it("stays with a season a tab may no longer delete or replace", () => {
    const first = listSeasons()[0]!;
    const second = createSeason("Spring");
    keepOnDevice(second.id);
    // Another tab took a copy in since this one read its seasons (`cloudGuard.ts`).
    backing.set("league_forecast_cloud_taken_league", "another-tab");

    deleteSeason(second.id);
    expect(listSeasons().map((season) => season.id)).toContain(second.id);
    expect(keptOnDevice(second.id)).toEqual(ALL);

    expect(
      replaceLeagueSnapshot({ activeSeasonId: first.id, seasons: [readSeasonSnapshot(first.id)!] })
    ).toBe(false);
    expect(listSeasons().map((season) => season.id)).toContain(second.id);
    expect(keptOnDevice(second.id)).toEqual(ALL);
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
