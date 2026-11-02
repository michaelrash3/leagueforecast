import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetCloudGuard } from "../cloud/cloudGuard";
import {
  archivedSeasonIds,
  createSeason,
  duplicateSeason,
  listSeasons,
  loadSettings,
  loadSettingsForSeason,
  saveSettings,
  setSeasonArchived,
} from "../storage";

/*
 * The archive mark as this browser keeps it: the season's own setting, written for a season that
 * is not open as any change to it is, and read for the whole list so the picker and the Seasons
 * card can set the archived seasons apart.
 */

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

describe("a season's archive mark in storage", () => {
  it("is set and taken off a season that is not open, keeping every other setting", () => {
    saveSettings({ ...loadSettings(), goldCutoff: 5 });
    const other = createSeason("Fall 2026");
    expect(archivedSeasonIds()).toEqual(new Set());

    expect(setSeasonArchived(other.id, true)).toBe(true);
    expect(archivedSeasonIds()).toEqual(new Set([other.id]));
    expect(loadSettingsForSeason(other.id).seasonLabel).toBe("Fall 2026");
    // The open season's settings are untouched.
    expect(loadSettings().goldCutoff).toBe(5);
    expect(loadSettings().archived).toBeUndefined();

    expect(setSeasonArchived(other.id, false)).toBe(true);
    expect(archivedSeasonIds()).toEqual(new Set());
    expect(loadSettingsForSeason(other.id).archived).toBe(false);
  });

  it("marks the season changed only when the mark moved", () => {
    const other = createSeason("Fall 2026");
    const savedAt = () => listSeasons().find((season) => season.id === other.id)?.updatedAt;
    expect(savedAt()).toBeUndefined();
    setSeasonArchived(other.id, true);
    const first = savedAt();
    expect(first).toBeDefined();
    vi.spyOn(Date.prototype, "toISOString").mockReturnValue("2099-01-01T00:00:00.000Z");
    setSeasonArchived(other.id, true);
    expect(savedAt()).toBe(first);
  });

  it("refuses a season this browser does not hold", () => {
    expect(setSeasonArchived("season-gone", true)).toBe(false);
    expect([...backing.keys()].some((key) => key.includes("season-gone"))).toBe(false);
  });

  it("is not copied: a season duplicated from an archived one is in use", () => {
    const other = createSeason("Fall 2026");
    setSeasonArchived(other.id, true);
    const copy = duplicateSeason(other.id, "Fall 2026 copy");
    expect(copy).not.toBeNull();
    expect(archivedSeasonIds()).toEqual(new Set([other.id]));
    expect(loadSettingsForSeason(copy!.id).seasonLabel).toBe("Fall 2026 copy");
  });
});
