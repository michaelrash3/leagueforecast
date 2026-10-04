import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { READING_THE_COPY, useFullBackup } from "./useFullBackup";
import * as backupLib from "../lib/backup";
import * as cloudSession from "../lib/cloud/cloudSession";
import * as copyBackupLib from "../lib/live/copyBackup";
import { notMade } from "../lib/live/copyBackup";
import type { FullBackup, LiveSeasonData } from "../lib/backup";

/**
 * A full restore replaces more than an undo snapshot could hold — a season the file does not carry
 * is simply gone — so there is no Undo offered for it. What stands in for one is a download of
 * whatever was just replaced, and that only works if the current state is read BEFORE anything is
 * written. Getting that order wrong hands back a copy of the thing that just overwrote it, which
 * looks like it worked and is worthless.
 */
/** A placeholder pool of one club, which a file with Team Rankings in it carries. */
const POOL = { ageGroups: [], teams: [{ id: "S-1", name: "Placeholder Club" }], games: [] };

const fullBackup = (label: string, seasons = 1): FullBackup =>
  ({
    exportedAt: "2026-09-19T00:00:00.000Z",
    seasons: Array.from({ length: seasons }, (_, i) => ({ id: `${label}-${i}` })),
    preferences: {},
    teamRankings: POOL,
  }) as unknown as FullBackup;

const live = (): LiveSeasonData => ({}) as LiveSeasonData;

describe("useFullBackup", () => {
  let clicked: string[] = [];

  beforeEach(() => {
    clicked = [];
    window.localStorage.clear();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn().mockReturnValue("blob:x"),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: {
      download: string;
    }) {
      clicked.push(this.download);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const setup = (confirmed: boolean, apply: { ok: boolean; failed: string[] }) => {
    const requestConfirmation = vi.fn().mockResolvedValue(confirmed);
    const showToast = vi.fn();
    const onRestored = vi.fn();
    vi.spyOn(backupLib, "applyFullBackup").mockReturnValue(
      apply as ReturnType<typeof backupLib.applyFullBackup>
    );
    vi.spyOn(backupLib, "summarizeFullBackup").mockReturnValue("2 seasons, 40 games");
    const hook = renderHook(() =>
      useFullBackup({
        liveSeason: live,
        seasonCount: 3,
        requestConfirmation,
        showToast,
        onRestored,
      })
    );
    return { ...hook, requestConfirmation, showToast, onRestored };
  };

  it("reads what is about to be replaced before it writes anything", async () => {
    const order: string[] = [];
    vi.spyOn(backupLib, "readFullBackup").mockImplementation(() => {
      order.push("read");
      return fullBackup("replaced");
    });
    const { result, showToast } = setup(true, { ok: true, failed: [] });
    vi.mocked(backupLib.applyFullBackup).mockImplementation(() => {
      order.push("write");
      return { ok: true, failed: [] } as ReturnType<typeof backupLib.applyFullBackup>;
    });

    await result.current.restoreFullBackup(fullBackup("incoming", 2));

    expect(order).toEqual(["read", "write"]);
    // And what the toast hands back is the copy taken before the write.
    const action = showToast.mock.calls[0]?.[1];
    action.onAction();
    expect(clicked).toHaveLength(1);
  });

  it("says how many seasons it will replace before doing it", async () => {
    vi.spyOn(backupLib, "readFullBackup").mockReturnValue(fullBackup("replaced"));
    const { result, requestConfirmation } = setup(true, { ok: true, failed: [] });

    await result.current.restoreFullBackup(fullBackup("incoming", 2));

    const asked = requestConfirmation.mock.calls[0]?.[0];
    expect(asked.message).toContain("all 3 seasons");
    expect(asked.message).toContain("2 seasons, 40 games");
  });

  it("does nothing at all when the restore is declined", async () => {
    vi.spyOn(backupLib, "readFullBackup").mockReturnValue(fullBackup("replaced"));
    const { result, showToast, onRestored } = setup(false, { ok: true, failed: [] });

    await result.current.restoreFullBackup(fullBackup("incoming"));

    expect(backupLib.applyFullBackup).not.toHaveBeenCalled();
    expect(onRestored).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it("still offers the replaced data when the restore only partly worked", async () => {
    vi.spyOn(backupLib, "readFullBackup").mockReturnValue(fullBackup("replaced"));
    const { result, showToast } = setup(true, { ok: false, failed: ["teams", "logs"] });

    await result.current.restoreFullBackup(fullBackup("incoming"));

    const [message, options] = showToast.mock.calls[0] ?? [];
    expect(message).toContain("could not write teams, logs");
    expect(options.tone).toBe("error");
    expect(options.actionLabel).toBe("Download replaced data");
    options.onAction();
    expect(clicked).toHaveLength(1);
  });

  it("puts React back in step before the toast says it is done", async () => {
    vi.spyOn(backupLib, "readFullBackup").mockReturnValue(fullBackup("replaced"));
    const order: string[] = [];
    const { result, showToast, onRestored } = setup(true, { ok: true, failed: [] });
    onRestored.mockImplementation(() => order.push("restored"));
    showToast.mockImplementation(() => order.push("toast"));

    await result.current.restoreFullBackup(fullBackup("incoming"));

    expect(order).toEqual(["restored", "toast"]);
  });

  it("in the cloud, writes the seasons here and has the server restore the pool", async () => {
    vi.spyOn(backupLib, "readFullBackup").mockReturnValue(fullBackup("replaced"));
    vi.spyOn(cloudSession, "restoresInCloud").mockReturnValue(true);
    const restore = vi
      .spyOn(cloudSession, "restoreTeamRankingsInCloud")
      .mockResolvedValue({ ok: true });
    const { result, showToast, requestConfirmation } = setup(true, { ok: true, failed: [] });
    const incoming = fullBackup("incoming");

    await result.current.restoreFullBackup(incoming);

    expect(backupLib.applyFullBackup).toHaveBeenCalledWith(incoming, { teamRankings: false });
    expect(restore).toHaveBeenCalledWith(incoming.teamRankings, { reload: false });
    expect(requestConfirmation.mock.calls[0]?.[0].message).toContain(
      "the cloud's Team Rankings for every device"
    );
    expect(showToast.mock.calls[0]?.[1].tone).toBe("success");
  });

  it("in the cloud, puts React in step with the seasons before the cloud is waited on", async () => {
    vi.spyOn(backupLib, "readFullBackup").mockReturnValue(fullBackup("replaced"));
    vi.spyOn(cloudSession, "restoresInCloud").mockReturnValue(true);
    const order: string[] = [];
    vi.spyOn(cloudSession, "restoreTeamRankingsInCloud").mockImplementation(async () => {
      order.push("cloud");
      return { ok: true };
    });
    const { result, onRestored } = setup(true, { ok: true, failed: [] });
    onRestored.mockImplementation(() => order.push("restored"));

    await result.current.restoreFullBackup(fullBackup("incoming"));

    expect(order).toEqual(["restored", "cloud"]);
  });

  it("in the cloud, leaves the cloud's pool alone for a file with none in it", async () => {
    vi.spyOn(backupLib, "readFullBackup").mockReturnValue(fullBackup("replaced"));
    vi.spyOn(cloudSession, "restoresInCloud").mockReturnValue(true);
    const restore = vi.spyOn(cloudSession, "restoreTeamRankingsInCloud");
    const { result, showToast, requestConfirmation } = setup(true, { ok: true, failed: [] });
    const incoming = {
      ...fullBackup("incoming"),
      teamRankings: { ageGroups: [], teams: [], games: [] },
    };

    await result.current.restoreFullBackup(incoming);

    expect(backupLib.applyFullBackup).toHaveBeenCalledWith(incoming, { teamRankings: false });
    expect(restore).not.toHaveBeenCalled();
    expect(requestConfirmation.mock.calls[0]?.[0].message).toContain("holds no Team Rankings");
    const [message, options] = showToast.mock.calls[0] ?? [];
    expect(message).toContain("the cloud's is as it was");
    expect(options.tone).toBe("success");
  });

  it("says the pool was not restored when the server would not", async () => {
    vi.spyOn(backupLib, "readFullBackup").mockReturnValue(fullBackup("replaced"));
    vi.spyOn(cloudSession, "restoresInCloud").mockReturnValue(true);
    vi.spyOn(cloudSession, "restoreTeamRankingsInCloud").mockResolvedValue({
      ok: false,
      message: "Only the owner.",
    });
    const { result, showToast } = setup(true, { ok: true, failed: [] });

    await result.current.restoreFullBackup(fullBackup("incoming"));

    const [message, options] = showToast.mock.calls[0] ?? [];
    expect(message).toContain("could not write Team Rankings (Only the owner.)");
    expect(options.tone).toBe("error");
  });

  it("anywhere else, writes the pool here as it always did", async () => {
    vi.spyOn(backupLib, "readFullBackup").mockReturnValue(fullBackup("replaced"));
    vi.spyOn(cloudSession, "restoresInCloud").mockReturnValue(false);
    const restore = vi.spyOn(cloudSession, "restoreTeamRankingsInCloud");
    const { result } = setup(true, { ok: true, failed: [] });

    await result.current.restoreFullBackup(fullBackup("incoming"));

    expect(backupLib.applyFullBackup).toHaveBeenCalledWith(expect.anything(), {
      teamRankings: true,
    });
    expect(restore).not.toHaveBeenCalled();
  });

  it("records that a backup was taken when one is exported", async () => {
    vi.spyOn(backupLib, "readFullBackup").mockReturnValue(fullBackup("current"));
    vi.spyOn(cloudSession, "restoresInCloud").mockReturnValue(false);
    const { result } = setup(true, { ok: true, failed: [] });

    result.current.exportBackup();

    expect(clicked).toHaveLength(1);
    expect(backupLib.readFullBackup).toHaveBeenCalledWith({});
    expect(window.localStorage.getItem("league_forecast_last_backup_v1")).toBeTruthy();
  });

  it("in the cloud, exports the copy's Team Rankings, read for the file", async () => {
    const COPY_POOL = {
      ageGroups: [],
      teams: [{ id: "S-2", name: "Placeholder Copy" }],
      games: [],
    };
    vi.spyOn(backupLib, "readFullBackup").mockReturnValue(fullBackup("current"));
    vi.spyOn(cloudSession, "restoresInCloud").mockReturnValue(true);
    const reader = { readManifest: vi.fn(), getChunk: vi.fn() };
    vi.spyOn(cloudSession, "copyReader").mockResolvedValue(reader);
    const read = vi
      .spyOn(copyBackupLib, "copyBackup")
      .mockResolvedValue({ ok: true, backup: COPY_POOL });
    const { result, showToast } = setup(true, { ok: true, failed: [] });

    result.current.exportBackup();

    expect(showToast).toHaveBeenCalledWith(READING_THE_COPY);
    await waitFor(() => expect(clicked).toHaveLength(1));
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ want: "backup" }));
    expect(await read.mock.calls[0]?.[0].copy?.()).toBe(reader);
    expect(backupLib.readFullBackup).toHaveBeenCalledWith({}, COPY_POOL);
    expect(window.localStorage.getItem("league_forecast_last_backup_v1")).toBeTruthy();
  });

  it("in the cloud, makes no file without the copy's Team Rankings, and says why", async () => {
    vi.spyOn(backupLib, "readFullBackup").mockReturnValue(fullBackup("current"));
    vi.spyOn(cloudSession, "restoresInCloud").mockReturnValue(true);
    // A sign-in that would not load: no reader, and nothing thrown past the button.
    vi.spyOn(cloudSession, "copyReader").mockRejectedValue(new Error("no sign-in"));
    const { result, showToast } = setup(true, { ok: true, failed: [] });

    result.current.exportBackup();

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(notMade("unreachable"), { tone: "error" })
    );
    expect(clicked).toEqual([]);
    expect(backupLib.readFullBackup).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("league_forecast_last_backup_v1")).toBeNull();
  });
});
