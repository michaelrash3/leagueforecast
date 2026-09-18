import { beforeEach, describe, expect, it, vi } from "vitest";
import { lastBackupTakenAt, noteBackupTaken } from "../lastBackup";

const backing = new Map<string, string>();
beforeEach(() => {
  backing.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => {
      backing.set(key, value);
    },
    removeItem: (key: string) => {
      backing.delete(key);
    },
  });
});

describe("when a backup was last taken", () => {
  it("is never until one is, and the two kinds do not overwrite each other", () => {
    expect(lastBackupTakenAt("league")).toBeNull();
    noteBackupTaken("league", "2026-09-01T10:00:00.000Z");
    expect(lastBackupTakenAt("league")).toBe("2026-09-01T10:00:00.000Z");
    expect(lastBackupTakenAt("pool")).toBeNull();
    noteBackupTaken("pool", "2026-09-02T10:00:00.000Z");
    expect(lastBackupTakenAt("league")).toBe("2026-09-01T10:00:00.000Z");
    expect(lastBackupTakenAt("pool")).toBe("2026-09-02T10:00:00.000Z");
  });

  it("shrugs off a storage that refuses or holds junk", () => {
    backing.set("league_forecast_last_backup_v1", "{not json");
    expect(lastBackupTakenAt("league")).toBeNull();
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    });
    expect(() => noteBackupTaken("league")).not.toThrow();
    expect(lastBackupTakenAt("league")).toBeNull();
  });
});
