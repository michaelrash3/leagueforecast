import { describe, expect, it } from "vitest";
import { BACKUP_APP, BACKUP_VERSION, type FullBackup } from "../backup";
import { keepReplaced, readReplaced, type ReplacedIo } from "../replacedBackup";
import { DEFAULT_SETTINGS, STORAGE_VERSION } from "../types";

/*
 * What a full restore replaced, kept on this device until the next restore (`replacedBackup.ts`).
 * It used to be offered only as the restore toast's download, for twelve seconds, and any other
 * toast replaced that one: miss it, and a browser kept nowhere else had lost its seasons.
 */
const memory = (): ReplacedIo & { held: Map<string, unknown> } => {
  const held = new Map<string, unknown>();
  return {
    held,
    get: async (key) => held.get(key) ?? null,
    set: async (key, value) => {
      held.set(key, value);
      return true;
    },
  };
};

const backup = (exportedAt: string): FullBackup => ({
  app: BACKUP_APP,
  backupVersion: BACKUP_VERSION,
  storageVersion: STORAGE_VERSION,
  exportedAt,
  activeSeasonId: "default",
  seasons: [
    {
      id: "default",
      name: "Fall 2026",
      createdAt: "2026-08-01T00:00:00.000Z",
      teams: [{ id: "A", name: "Aces" }],
      matchups: [],
      logs: {},
      bracketLogs: {},
      settings: DEFAULT_SETTINGS,
    },
  ],
  teamRankings: { ageGroups: [], teams: [], games: [] },
  preferences: {},
});

describe("what a restore replaced", () => {
  it("is kept with when it was replaced, and read back whole", async () => {
    const io = memory();
    const before = backup("2026-10-26T17:00:00.000Z");
    expect(await keepReplaced(before, "2026-10-26T17:05:00.000Z", io)).toBe(true);
    const kept = await readReplaced(io);
    expect(kept?.at).toBe("2026-10-26T17:05:00.000Z");
    expect(kept?.backup.seasons.map((season) => season.id)).toEqual(
      before.seasons.map((season) => season.id)
    );
    expect(kept?.backup.seasons[0]?.teams).toEqual([{ id: "A", name: "Aces" }]);
  });

  it("is only the last restore's: the next one takes its place", async () => {
    const io = memory();
    await keepReplaced(backup("2026-10-01T00:00:00.000Z"), "2026-10-01T00:05:00.000Z", io);
    await keepReplaced(backup("2026-10-26T00:00:00.000Z"), "2026-10-26T00:05:00.000Z", io);
    expect((await readReplaced(io))?.at).toBe("2026-10-26T00:05:00.000Z");
    expect(io.held.size).toBe(1);
  });

  it("is nothing where nothing was kept, or what was kept is not a backup", async () => {
    const io = memory();
    expect(await readReplaced(io)).toBeNull();
    await io.set("league_forecast_replaced_backup_v1", { at: "x", backup: { seasons: "no" } });
    expect(await readReplaced(io)).toBeNull();
  });
});
