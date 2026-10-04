import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSeasonFiles, type SeasonFilesOptions } from "./useSeasonFiles";
import { DEFAULT_SETTINGS } from "../lib/types";
import type { LiveSeasonData } from "../lib/backup";
import * as cloudSession from "../lib/cloud/cloudSession";
import * as rankingsBackup from "../lib/teamRankingsBackup";
import { teamRankingsJson } from "../lib/teamRankingsBackup";

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

/*
 * A Team Rankings pool imported from a file, in the cloud (1.6): restored by the server rather than
 * written into this browser, which a device of the copy no longer does for itself. Placeholder names.
 */
describe("a pool imported in the cloud", () => {
  const POOL = { ageGroups: [], teams: [{ id: "S-1", name: "Placeholder Restored" }], games: [] };
  const file = (text: string) => new File([text], "backup.json", { type: "application/json" });

  it("is the server's to restore, reloading on it, for the Team Rankings file alone", async () => {
    vi.spyOn(cloudSession, "restoresInCloud").mockReturnValue(true);
    const restore = vi
      .spyOn(cloudSession, "restoreTeamRankingsInCloud")
      .mockResolvedValue({ ok: true });
    const written = vi.spyOn(rankingsBackup, "writeTeamRankingsBackup");
    const { result, calls } = harness();
    result.current.importBackup(file(teamRankingsJson(POOL, "2026-10-04T12:00:00.000Z")));
    await waitFor(() => expect(restore).toHaveBeenCalledTimes(1));
    expect(restore.mock.calls[0]?.[0]).toMatchObject({ teams: POOL.teams });
    expect(restore.mock.calls[0]?.[1]).toEqual({ reload: true });
    expect(written).not.toHaveBeenCalled();
    // Said, for where Team Rankings is not open and nothing reloads.
    await waitFor(() =>
      expect(calls.showToast).toHaveBeenCalledWith(
        expect.stringContaining("Team Rankings restored in the cloud"),
        { tone: "success" }
      )
    );
    vi.restoreAllMocks();
  });

  it("says why when the server would not", async () => {
    vi.spyOn(cloudSession, "restoresInCloud").mockReturnValue(true);
    vi.spyOn(cloudSession, "restoreTeamRankingsInCloud").mockResolvedValue({
      ok: false,
      message: "Only the owner.",
    });
    const { result, calls } = harness();
    result.current.importBackup(file(teamRankingsJson(POOL, "2026-10-04T12:00:00.000Z")));
    await waitFor(() =>
      expect(calls.showToast).toHaveBeenCalledWith(
        "Team Rankings was not restored: Only the owner.",
        {
          tone: "error",
        }
      )
    );
    vi.restoreAllMocks();
  });

  it("leaves the pool out of a season backup's Undo, and does not reload under the season", async () => {
    vi.spyOn(cloudSession, "restoresInCloud").mockReturnValue(true);
    const { result, calls } = harness();
    const restore = vi
      .spyOn(cloudSession, "restoreTeamRankingsInCloud")
      .mockImplementation(async () => {
        // The season is on screen before the cloud is waited on.
        expect(calls.applySeason).toHaveBeenCalledTimes(1);
        return { ok: true };
      });
    result.current.importBackup(
      file(JSON.stringify({ teams: [], matchups: [], logs: {}, teamRankings: POOL }))
    );
    await waitFor(() => expect(calls.applySeason).toHaveBeenCalledTimes(1));
    expect(calls.captureUndo).toHaveBeenCalledWith(
      "Backup import",
      expect.objectContaining({ withTeamRankings: false })
    );
    await waitFor(() => expect(restore).toHaveBeenCalledTimes(1));
    expect(restore.mock.calls[0]?.[1]).toEqual({ reload: false });
    vi.restoreAllMocks();
  });

  it("says in the import's own toast when the server would not restore the pool", async () => {
    vi.spyOn(cloudSession, "restoresInCloud").mockReturnValue(true);
    vi.spyOn(cloudSession, "restoreTeamRankingsInCloud").mockResolvedValue({
      ok: false,
      message: "Only the owner.",
    });
    const { result, calls } = harness();
    result.current.importBackup(
      file(JSON.stringify({ teams: [], matchups: [], logs: {}, teamRankings: POOL }))
    );
    await waitFor(() => expect(calls.showToast).toHaveBeenCalledTimes(1));
    const [message, options] = calls.showToast.mock.calls[0] ?? [];
    expect(message).toContain("Imported backup");
    expect(message).toContain("Team Rankings was not restored: Only the owner.");
    expect(options).toMatchObject({ tone: "error", actionLabel: "Undo" });
    vi.restoreAllMocks();
  });

  it("is written here, as it always was, anywhere else", async () => {
    vi.spyOn(cloudSession, "restoresInCloud").mockReturnValue(false);
    const restore = vi.spyOn(cloudSession, "restoreTeamRankingsInCloud");
    const written = vi.spyOn(rankingsBackup, "writeTeamRankingsBackup").mockReturnValue(true);
    const { result, calls } = harness();
    result.current.importBackup(file(teamRankingsJson(POOL, "2026-10-04T12:00:00.000Z")));
    await waitFor(() => expect(written).toHaveBeenCalledTimes(1));
    expect(restore).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(calls.showToast.mock.calls[0]?.[0]).toContain("Team Rankings restored")
    );
    vi.restoreAllMocks();
  });
});
