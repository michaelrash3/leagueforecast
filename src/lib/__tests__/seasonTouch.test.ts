import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSeason, listSeasons, saveLogs, saveSettings, setActiveSeason } from "../storage";
import { DEFAULT_SETTINGS } from "../types";

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

describe("when a season last changed", () => {
  it("is stamped by a save of its data, and only on the season saved to", () => {
    const first = listSeasons()[0]!;
    const other = createSeason("Other");
    expect(listSeasons().find((season) => season.id === first.id)?.updatedAt).toBeUndefined();

    setActiveSeason(first.id);
    saveLogs({});
    const stamped = listSeasons().find((season) => season.id === first.id)?.updatedAt;
    expect(typeof stamped).toBe("string");
    expect(Date.parse(stamped ?? "")).not.toBeNaN();
    expect(listSeasons().find((season) => season.id === other.id)?.updatedAt).toBeUndefined();
  });

  it("is not moved by a save of what the season already holds", () => {
    vi.useFakeTimers();
    try {
      setActiveSeason(listSeasons()[0]!.id);
      vi.setSystemTime(new Date("2026-09-01T10:00:00.000Z"));
      saveLogs({});
      const first = listSeasons()[0]?.updatedAt;
      expect(first).toBe("2026-09-01T10:00:00.000Z");

      vi.setSystemTime(new Date("2026-09-02T10:00:00.000Z"));
      saveLogs({});
      expect(listSeasons()[0]?.updatedAt).toBe(first);

      saveLogs({ g1: { homeScore: 3, awayScore: 1 } } as never);
      expect(listSeasons()[0]?.updatedAt).toBe("2026-09-02T10:00:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("survives a re-read of the list", () => {
    setActiveSeason(listSeasons()[0]!.id);
    saveSettings({ ...DEFAULT_SETTINGS });
    const [again] = listSeasons();
    expect(again?.updatedAt).toBeDefined();
  });
});
