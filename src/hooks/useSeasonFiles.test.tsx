import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  READING_THE_COPY_FOR_CSV,
  STILL_READING_THE_COPY_FOR_CSV,
  useSeasonFiles,
  type SeasonFilesOptions,
} from "./useSeasonFiles";
import { DEFAULT_SETTINGS } from "../lib/types";
import type { LiveSeasonData } from "../lib/backup";
import * as cloudSession from "../lib/cloud/cloudSession";
import * as copyBackupLib from "../lib/live/copyBackup";
import { COPY_UNREAD } from "../lib/live/copyBackup";
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
    rankingsLive: true,
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

/*
 * A schedule's CSV, and the year a CSV's bare dates are read in, in the cloud (1.6e): the pool's
 * sections are the copy's, read for the file, and the year is the server's bridge's, since a
 * member's device holds no pool of its own to read either off.
 */
describe("a season's CSV in the cloud", () => {
  const saved: Blob[] = [];
  const catching = () => {
    saved.length = 0;
    vi.stubGlobal("URL", {
      createObjectURL: (blob: Blob) => {
        saved.push(blob);
        return "blob:csv";
      },
      revokeObjectURL: () => undefined,
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  };
  const done = () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  };

  it("carries the copy's Team Rankings sections, read for the file", async () => {
    catching();
    vi.spyOn(cloudSession, "restoresInCloud").mockReturnValue(true);
    const reader = { readManifest: vi.fn(), getChunk: vi.fn() };
    vi.spyOn(cloudSession, "copyReader").mockResolvedValue(reader);
    const read = vi
      .spyOn(copyBackupLib, "copyBackup")
      .mockResolvedValue({ ok: true, csv: "PLACEHOLDER-SECTIONS" });
    const local = vi.spyOn(rankingsBackup, "readTeamRankingsBackup");
    const { result, calls } = harness();
    result.current.exportCSV();
    // Said, as Backup JSON says it: the copy can take a while, and nothing else shows meanwhile.
    expect(calls.showToast).toHaveBeenCalledWith(READING_THE_COPY_FOR_CSV);
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ want: "csv" }));
    expect(await read.mock.calls[0]?.[0].copy?.()).toBe(reader);
    expect(await saved[0]?.text()).toContain("PLACEHOLDER-SECTIONS");
    expect(local).not.toHaveBeenCalled();
    done();
  });

  it("goes without them when the copy cannot be read, and says so", async () => {
    catching();
    vi.spyOn(cloudSession, "restoresInCloud").mockReturnValue(true);
    // A sign-in that would not load: the schedule is still saved.
    vi.spyOn(cloudSession, "copyReader").mockRejectedValue(new Error("no sign-in"));
    const { result, calls } = harness();
    result.current.exportCSV();
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(await saved[0]?.text()).not.toContain("TEAM RANKINGS");
    expect(calls.showToast).toHaveBeenCalledWith(
      `${COPY_UNREAD.unreachable}, so the schedule was saved without Team Rankings.`,
      { tone: "error" }
    );
    done();
  });

  it("is this device's own pool's sections anywhere else", async () => {
    catching();
    vi.spyOn(cloudSession, "restoresInCloud").mockReturnValue(false);
    const read = vi.spyOn(copyBackupLib, "copyBackup");
    const local = vi.spyOn(rankingsBackup, "readTeamRankingsBackup");
    const { result } = harness();
    result.current.exportCSV();
    expect(saved).toHaveLength(1);
    expect(local).toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    done();
  });

  it("is this device's own pool's sections with the cloud's board turned off", async () => {
    catching();
    vi.spyOn(cloudSession, "restoresInCloud").mockReturnValue(true);
    const read = vi.spyOn(copyBackupLib, "copyBackup");
    const local = vi.spyOn(rankingsBackup, "readTeamRankingsBackup");
    // A member who turned the board off edits and pulls on this device's pool, kept in step.
    const { result, calls } = harness({ rankingsLive: false });
    result.current.exportCSV();
    expect(saved).toHaveLength(1);
    expect(local).toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(calls.showToast).not.toHaveBeenCalled();
    done();
  });

  it("reads the copy once when pressed again while it reads, and says it is still reading", async () => {
    catching();
    vi.spyOn(cloudSession, "restoresInCloud").mockReturnValue(true);
    let arrive: (made: Awaited<ReturnType<typeof copyBackupLib.copyBackup>>) => void = () =>
      undefined;
    const read = vi.spyOn(copyBackupLib, "copyBackup").mockReturnValue(
      new Promise((resolve) => {
        arrive = resolve;
      })
    );
    const { result, calls } = harness();
    result.current.exportCSV();
    result.current.exportCSV();
    // Each read is the whole copy, unpacked and decoded in a worker of its own.
    expect(read).toHaveBeenCalledTimes(1);
    expect(calls.showToast.mock.calls.map(([message]) => message)).toEqual([
      READING_THE_COPY_FOR_CSV,
      STILL_READING_THE_COPY_FOR_CSV,
    ]);
    arrive({ ok: true, csv: "PLACEHOLDER-SECTIONS" });
    await waitFor(() => expect(saved).toHaveLength(1));
    // Done, the button reads the copy again.
    result.current.exportCSV();
    expect(read).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(saved).toHaveLength(2));
    done();
  });

  it("reads a bare date in the season's year as the server's bridge says it", async () => {
    // A nil-nil is a result only on a day gone by, which a bare "M/D" needs the year to say.
    const nilNil = [
      "Game ID,Date,Away Team,Innings,Away Runs,Away Hits,Away K,Home Team,Home Runs,Home Hits,Home K",
      "g1,4/5,Aces,6,0,9,,Bruins,0,6,",
    ].join("\n");
    const csv = () => new File([nilNil], "schedule.csv", { type: "text/csv" });
    const known = harness({ cloudSquadYear: 2020 });
    known.result.current.importCSV(csv());
    await waitFor(() => expect(known.calls.setActiveView).toHaveBeenCalledWith("games"));
    // With no year from the cloud and no pages here, it is no result.
    const unknown = harness();
    unknown.result.current.importCSV(csv());
    await waitFor(() => expect(unknown.calls.setActiveView).toHaveBeenCalledWith("standings"));
  });
});
