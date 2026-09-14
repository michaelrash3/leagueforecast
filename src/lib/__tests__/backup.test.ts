import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BACKUP_APP,
  BACKUP_VERSION,
  applyFullBackup,
  backupFilename,
  coerceBackup,
  readFullBackup,
  summarizeFullBackup,
} from "../backup";
import { readAppMode, readTheme, writeAppMode, writeTheme } from "../preferences";
import {
  createSeason,
  getActiveSeasonId,
  listSeasons,
  loadLogsForSeason,
  loadMatchupsForSeason,
  loadSettingsForSeason,
  loadTeamsForSeason,
  renameSeason,
  saveLogs,
  saveMatchups,
  saveSettings,
  saveTeams,
  saveUndoSnapshot,
  setActiveSeason,
} from "../storage";
import { saveAgeGroups, saveScoutGames, saveScoutTeams } from "../teamRankingsStorage";
import { DEFAULT_SETTINGS } from "../types";

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

/** Two seasons with data in each, a rankings pool, and both preferences set. */
const seedBrowser = () => {
  saveTeams([
    { id: "ACE", name: "Aces" },
    { id: "BRU", name: "Bruins" },
  ]);
  saveMatchups([{ id: "g1", date: "2026-04-05", away: "ACE", home: "BRU" }]);
  saveLogs({
    g1: {
      innings: "6",
      awayRuns: "7",
      awayHits: "9",
      awayK: "3",
      homeRuns: "4",
      homeHits: "6",
      homeK: "2",
      isFinal: true,
    },
  });
  saveSettings({ ...DEFAULT_SETTINGS, seasonLabel: "Spring 2026", goldCutoff: 4 });
  // The app keeps the season index name in sync with the editable season label; the index name is
  // what the switcher and a backup summary show, so mirror that here.
  renameSeason("default", "Spring 2026");

  const second = createSeason("Fall 2026");
  setActiveSeason(second.id);
  saveTeams([
    { id: "COM", name: "Comets" },
    { id: "DUK", name: "Dukes" },
  ]);
  saveMatchups([{ id: "g2", date: "2026-09-05", away: "COM", home: "DUK" }]);
  saveSettings({ ...DEFAULT_SETTINGS, seasonLabel: "Fall 2026" });
  setActiveSeason("default");

  saveAgeGroups([
    { id: "ag1", name: "10U 2028", ageLevel: 10, year: 2028, seasonIds: ["default"] },
  ]);
  saveScoutTeams([{ id: "S-ICEC", name: "Ice Cats", isMine: true }]);
  saveScoutGames([
    {
      id: "sg1",
      teamAId: "S-ICEC",
      teamBId: "S-ROCK",
      ageGroupId: "ag1",
      teamAScore: 5,
      teamBScore: 3,
    },
  ]);
  writeTheme("dark");
  writeAppMode("rankings");
  return second.id;
};

describe("readFullBackup", () => {
  it("carries every season, not just the active one", () => {
    seedBrowser();
    const backup = readFullBackup();

    expect(backup.app).toBe(BACKUP_APP);
    expect(backup.backupVersion).toBe(BACKUP_VERSION);
    expect(backup.activeSeasonId).toBe("default");
    expect(backup.seasons.map((season) => season.name)).toEqual(["Spring 2026", "Fall 2026"]);
    expect(backup.seasons[0]?.teams).toHaveLength(2);
    expect(backup.seasons[0]?.logs.g1?.awayRuns).toBe("7");
    expect(backup.seasons[1]?.teams).toHaveLength(2);
  });

  it("carries the Team Rankings pool and the UI preferences", () => {
    seedBrowser();
    const backup = readFullBackup();

    expect(backup.teamRankings.ageGroups).toHaveLength(1);
    expect(backup.teamRankings.teams).toEqual([{ id: "S-ICEC", name: "Ice Cats", isMine: true }]);
    expect(backup.teamRankings.games).toHaveLength(1);
    expect(backup.preferences).toEqual({ theme: "dark", appMode: "rankings" });
  });

  it("prefers live state over storage for the active season, since score writes are debounced", () => {
    seedBrowser();
    const live = {
      teams: [{ id: "ACE", name: "Aces" }],
      matchups: [{ id: "g1", date: "2026-04-05", away: "ACE", home: "ACE" }],
      logs: {},
      bracketLogs: {},
      settings: { ...DEFAULT_SETTINGS, seasonLabel: "Edited moments ago" },
    };

    const backup = readFullBackup(live);
    const [active, other] = backup.seasons;

    expect(active?.settings.seasonLabel).toBe("Edited moments ago");
    expect(active?.teams).toHaveLength(1);
    // The non-active season is untouched by the live override.
    expect(other?.settings.seasonLabel).toBe("Fall 2026");
    expect(other?.teams).toHaveLength(2);
  });

  it("leaves the per-season undo snapshot out of the file", () => {
    seedBrowser();
    saveUndoSnapshot({ teams: [], matchups: [], logs: {}, label: "scratch", timestamp: 1 });

    const serialized = JSON.stringify(readFullBackup());
    expect(serialized).not.toContain("scratch");
  });
});

describe("coerceBackup", () => {
  it("round-trips a full backup through JSON", () => {
    seedBrowser();
    const backup = readFullBackup();
    const parsed = coerceBackup(JSON.parse(JSON.stringify(backup)) as unknown);

    expect(parsed?.kind).toBe("full");
    if (parsed?.kind !== "full") return;
    expect(parsed.backup.seasons).toEqual(backup.seasons);
    expect(parsed.backup.teamRankings).toEqual(backup.teamRankings);
    expect(parsed.backup.preferences).toEqual(backup.preferences);
    expect(parsed.backup.activeSeasonId).toBe(backup.activeSeasonId);
  });

  it("still reads the older single-season backup shape", () => {
    const parsed = coerceBackup({
      teams: [{ id: "ACE", name: "Aces" }],
      matchups: [{ id: "g1", date: "2026-04-05", away: "ACE", home: "ACE" }],
      logs: {},
      settings: { seasonLabel: "Legacy" },
    });

    expect(parsed?.kind).toBe("season");
    if (parsed?.kind !== "season") return;
    expect(parsed.season.teams).toEqual([{ id: "ACE", name: "Aces" }]);
    expect(parsed.season.settings.seasonLabel).toBe("Legacy");
    // No rankings block in a pre-rankings backup, so the live pool must be left alone.
    expect(parsed.teamRankings).toBeNull();
  });

  it("rejects a file that is neither shape", () => {
    expect(coerceBackup(null)).toBeNull();
    expect(coerceBackup({ nothing: true })).toBeNull();
    expect(coerceBackup({ seasons: [] })).toBeNull();
    expect(coerceBackup({ seasons: [{ name: "no id" }] })).toBeNull();
  });

  it("drops duplicate season ids that would collide in the index", () => {
    const parsed = coerceBackup({
      seasons: [
        { id: "a", name: "First", teams: [], matchups: [], logs: {} },
        { id: "a", name: "Clash", teams: [], matchups: [], logs: {} },
        { id: "b", name: "Second", teams: [], matchups: [], logs: {} },
      ],
    });

    expect(parsed?.kind).toBe("full");
    if (parsed?.kind !== "full") return;
    expect(parsed.backup.seasons.map((season) => season.name)).toEqual(["First", "Second"]);
  });

  it("falls back to the first season when the active pointer names a missing one", () => {
    const parsed = coerceBackup({
      activeSeasonId: "gone",
      seasons: [{ id: "a", name: "First", teams: [], matchups: [], logs: {} }],
    });

    expect(parsed?.kind).toBe("full");
    if (parsed?.kind !== "full") return;
    expect(parsed.backup.activeSeasonId).toBe("a");
  });

  it("ignores preferences that are not real values", () => {
    const parsed = coerceBackup({
      seasons: [{ id: "a", name: "First", teams: [], matchups: [], logs: {} }],
      preferences: { theme: "chartreuse", appMode: 7 },
    });

    expect(parsed?.kind).toBe("full");
    if (parsed?.kind !== "full") return;
    expect(parsed.backup.preferences).toEqual({});
  });
});

describe("applyFullBackup", () => {
  it("restores every season, the pool, and the preferences into a fresh browser", () => {
    const secondId = seedBrowser();
    const backup = readFullBackup();

    // A different browser: one unrelated season, no rankings, opposite preferences.
    backing.clear();
    saveTeams([{ id: "ZZZ", name: "Nobody" }]);
    writeTheme("light");
    writeAppMode("league");

    expect(applyFullBackup(backup)).toEqual({ ok: true, failed: [] });

    expect(listSeasons().map((season) => season.name)).toEqual(["Spring 2026", "Fall 2026"]);
    expect(getActiveSeasonId()).toBe("default");
    expect(loadTeamsForSeason("default")).toHaveLength(2);
    expect(loadLogsForSeason("default").g1?.awayRuns).toBe("7");
    expect(loadSettingsForSeason("default").goldCutoff).toBe(4);
    expect(loadTeamsForSeason(secondId).map((team) => team.id)).toEqual(["COM", "DUK"]);
    expect(loadMatchupsForSeason(secondId)).toHaveLength(1);
    expect(readTheme()).toBe("dark");
    expect(readAppMode()).toBe("rankings");
  });

  it("clears a season the backup does not carry", () => {
    seedBrowser();
    const backup = readFullBackup();
    const doomed = createSeason("Delete me");
    expect(listSeasons()).toHaveLength(3);

    applyFullBackup(backup);

    expect(listSeasons().map((season) => season.id)).not.toContain(doomed.id);
    expect(loadTeamsForSeason(doomed.id)).toEqual([]);
  });

  it("names the part it could not write instead of reporting success", () => {
    seedBrowser();
    const backup = readFullBackup();
    // Team Rankings keys are the ones that fail here; the season keys still write.
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (k.includes("scout")) throw new Error("QuotaExceededError");
        backing.set(k, v);
      },
      removeItem: (k: string) => {
        backing.delete(k);
      },
    });

    const result = applyFullBackup(backup);
    expect(result.ok).toBe(false);
    expect(result.failed).toContain("Team Rankings");
  });
});

describe("summarizeFullBackup", () => {
  it("lists each season and marks the one that opens", () => {
    seedBrowser();
    const summary = summarizeFullBackup(readFullBackup());

    expect(summary).toContain("2 seasons in this backup:");
    expect(summary).toContain("- Spring 2026: 2 teams, 1 game, 1 final (opens on restore)");
    expect(summary).toContain("- Fall 2026: 2 teams, 1 game, 0 final");
    expect(summary).toContain("Team Rankings: 1 age group · 1 ranked team · 1 logged game");
  });
});

describe("backupFilename", () => {
  it("labels the file by export date rather than by one season's name", () => {
    expect(backupFilename("2026-09-14T11:43:17.000Z")).toBe(
      "League_Forecast_Backup_2026-09-14.json"
    );
  });

  it("stays a valid filename when the timestamp is unusable", () => {
    expect(backupFilename("")).toBe("League_Forecast_Backup_export.json");
  });
});
