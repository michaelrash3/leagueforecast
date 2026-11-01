import { describe, expect, it } from "vitest";
import { createSeasonStore, type SeasonState } from "../seasonStore";
import { DEFAULT_SETTINGS } from "../types";

/*
 * What the open season's store lays over the page's own edits (`amendEdits`): the season's next
 * save of its own carries it, and nothing else does, so no save is ever made for it alone. What
 * League Standings lays there is the GameChanger id an old pick takes (`stampPicks`). Placeholder
 * names throughout.
 */

const SEASON: SeasonState = {
  teams: [
    { id: "ACES", name: "Aces", scoutTeamId: "S-ACES" },
    { id: "BEAR", name: "Bears" },
  ],
  matchups: [],
  logs: {},
  bracketLogs: {},
  settings: DEFAULT_SETTINGS,
};

const stamp = (season: SeasonState): SeasonState =>
  season.teams.some((team) => team.scoutTeamId && !team.scoutGcTeamId)
    ? {
        ...season,
        teams: season.teams.map((team) =>
          team.scoutTeamId && !team.scoutGcTeamId ? { ...team, scoutGcTeamId: "gcAces001" } : team
        ),
      }
    : season;

describe("SeasonStore.amendEdits", () => {
  it("lays its change over the page's next edit, which then carries it", () => {
    const store = createSeasonStore({ id: "spring", season: SEASON });
    const heard: string[] = [];
    store.subscribe((change) => heard.push(change));
    store.amendEdits(stamp);
    expect(store.get().season).toBe(SEASON);
    store.setSeason((prev) => ({ ...prev, settings: { ...prev.settings, seasonLabel: "Spring" } }));
    expect(store.get().season.teams[0]).toEqual({
      id: "ACES",
      name: "Aces",
      scoutTeamId: "S-ACES",
      scoutGcTeamId: "gcAces001",
    });
    expect(store.get().season.settings.seasonLabel).toBe("Spring");
    expect(heard).toEqual(["edit"]);
  });

  it("makes no change of its own: an edit that changes nothing stays nothing", () => {
    const store = createSeasonStore({ id: "spring", season: SEASON });
    const heard: string[] = [];
    store.subscribe((change) => heard.push(change));
    store.amendEdits(stamp);
    store.setSeason((prev) => prev);
    store.setSeason(SEASON);
    expect(store.get().season).toBe(SEASON);
    expect(heard).toEqual([]);
  });

  it("leaves another device's season, a season opened and a locked page as they come", () => {
    const store = createSeasonStore({ id: "spring", season: SEASON });
    store.amendEdits(stamp);
    const arrived = { ...SEASON, logs: {} };
    store.apply(arrived);
    expect(store.get().season).toBe(arrived);
    const opened = { ...SEASON, bracketLogs: {} };
    store.open("fall", opened);
    expect(store.get().season).toBe(opened);
    store.lock("read-only");
    store.setSeason((prev) => ({ ...prev, logs: {} }));
    expect(store.get().season).toBe(opened);
  });

  it("lays nothing once let go of", () => {
    const store = createSeasonStore({ id: "spring", season: SEASON });
    store.amendEdits(stamp);
    store.amendEdits(null);
    store.setSeason((prev) => ({ ...prev, logs: {} }));
    expect(store.get().season.teams).toBe(SEASON.teams);
  });
});
