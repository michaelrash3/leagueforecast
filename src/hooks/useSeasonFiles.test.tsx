import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSeasonFiles, type SeasonFilesOptions } from "./useSeasonFiles";
import { DEFAULT_SETTINGS } from "../lib/types";
import type { LiveSeasonData } from "../lib/backup";

const CSV = [
  "Game ID,Date,Away Team,Innings,Away Runs,Away Hits,Away K,Home Team,Home Runs,Home Hits,Home K",
  "g1,2026-04-05,Aces,6,7,9,,Bruins,4,6,",
].join("\n");

const live = (): LiveSeasonData => ({
  teams: [],
  matchups: [],
  logs: {},
  bracketLogs: {},
  settings: DEFAULT_SETTINGS,
});

const harness = (over: Partial<SeasonFilesOptions> = {}) => {
  const calls = {
    applySeason: vi.fn(),
    clearLastImpact: vi.fn(),
    captureUndo: vi.fn(),
    closeTeamData: vi.fn(),
    setActiveView: vi.fn(),
    showToast: vi.fn(),
  };
  const options: SeasonFilesOptions = {
    liveSeason: live,
    activeSeasonId: "s1",
    teams: [],
    matchups: [],
    logs: {},
    settings: DEFAULT_SETTINGS,
    teamBaseById: new Map(),
    seasonCount: 1,
    applySeason: calls.applySeason,
    captureUndo: calls.captureUndo,
    restoreUndo: () => {},
    // Everything about these paths is behind a confirmation, so the harness always says yes.
    requestConfirmation: () => Promise.resolve(true),
    showToast: calls.showToast,
    closeTeamData: calls.closeTeamData,
    noteScoutChange: () => {},
    reloadSeasons: () => {},
    setActiveView: calls.setActiveView,
    setTheme: () => {},
    setAppMode: () => {},
    clearLastImpact: calls.clearLastImpact,
    ...over,
  };
  const { result } = renderHook(() => useSeasonFiles(options));
  return { result, calls };
};

/**
 * The recap of the last score entered, across a season being replaced.
 *
 * `lastImpact` drives the recap panel and the team drawer, and it describes one score in one
 * season. Every path that replaces the season therefore has to drop it, or the panel goes on
 * explaining a game that belongs to a season no longer loaded — with the standings underneath it
 * already showing the new one.
 *
 * Two of the three paths always did. The CSV import did not, and the gap survived the move into
 * this hook untouched on purpose, so that the move was a move and this is a change.
 */
describe("replacing a season drops the recap of the last score", () => {
  it("on a schedule CSV import", async () => {
    const { result, calls } = harness();
    result.current.importCSV(new File([CSV], "schedule.csv", { type: "text/csv" }));
    await waitFor(() => expect(calls.applySeason).toHaveBeenCalled());
    expect(calls.clearLastImpact).toHaveBeenCalled();
  });

  it("on a reset, which is the path that always did", async () => {
    const { result, calls } = harness();
    await result.current.resetSeason();
    expect(calls.applySeason).toHaveBeenCalled();
    expect(calls.clearLastImpact).toHaveBeenCalled();
  });
});
