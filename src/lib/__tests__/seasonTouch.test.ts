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

  it("survives a re-read of the list", () => {
    setActiveSeason(listSeasons()[0]!.id);
    saveSettings({ ...DEFAULT_SETTINGS });
    const [again] = listSeasons();
    expect(again?.updatedAt).toBeDefined();
  });
});
