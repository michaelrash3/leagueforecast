import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { READING_THE_COPY, STILL_READING_THE_COPY, useFullBackup } from "./useFullBackup";
import * as backupLib from "../lib/backup";
import * as cloudSession from "../lib/cloud/cloudSession";
import * as copyBackupLib from "../lib/live/copyBackup";
import { notMade } from "../lib/live/copyBackup";
import { memoryIo } from "../lib/poolMemoryIo";
import * as storage from "../lib/storage";
import {
  initTeamRankingsStore,
  resetTeamRankingsStore,
  saveScoutTeams,
} from "../lib/teamRankingsStorage";
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
/** The copy's pool, as a backup made off it carries it. */
const COPY_POOL = { ageGroups: [], teams: [{ id: "S-2", name: "Placeholder Copy" }], games: [] };
/** No pool at all: what a file leaves the cloud's alone with. */
const NO_POOL = { ageGroups: [], teams: [], games: [] };

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

  const setup = (
    confirmed: boolean,
    apply: { ok: boolean; failed: string[] },
    rankingsLive = true
  ) => {
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
        rankingsLive,
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
    // The cloud's pool was not replaced, so there is none of it to point to.
    expect(message).not.toContain("Earlier versions");
    expect(options.tone).toBe("error");
  });

  it("in the cloud, says where the replaced pool is when only the seasons failed", async () => {
    vi.spyOn(backupLib, "readFullBackup").mockReturnValue(fullBackup("replaced"));
    vi.spyOn(cloudSession, "restoresInCloud").mockReturnValue(true);
    vi.spyOn(cloudSession, "restoreTeamRankingsInCloud").mockResolvedValue({ ok: true });
    const { result, showToast } = setup(true, { ok: false, failed: ["seasons"] });

    await result.current.restoreFullBackup(fullBackup("incoming"));

    const [message, options] = showToast.mock.calls[0] ?? [];
    expect(message).toContain("could not write seasons");
    // The download offered holds no pool in the cloud: the one replaced is the cloud's to keep.
    expect(message).toContain("Earlier versions in the Cloud panel");
    expect(options.actionLabel).toBe("Download replaced data");
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
    const saved: string[] = [];
    vi.stubGlobal(
      "Blob",
      class {
        constructor(parts: string[]) {
          saved.push(parts.join(""));
        }
      }
    );
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
    // League as it stands at the press, with no pool of this device's in it.
    expect(backupLib.readFullBackup).toHaveBeenCalledTimes(1);
    expect(backupLib.readFullBackup).toHaveBeenCalledWith({}, NO_POOL);
    await waitFor(() => expect(clicked).toHaveLength(1));
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ want: "backup" }));
    expect(await read.mock.calls[0]?.[0].copy?.()).toBe(reader);
    expect(JSON.parse(saved[0] ?? "{}")).toEqual({
      ...fullBackup("current"),
      teamRankings: COPY_POOL,
    });
    expect(window.localStorage.getItem("league_forecast_last_backup_v1")).toBeTruthy();
  });

  it("with the cloud's board turned off, writes this device's own pool, as it always did", () => {
    vi.spyOn(backupLib, "readFullBackup").mockReturnValue(fullBackup("current"));
    vi.spyOn(cloudSession, "restoresInCloud").mockReturnValue(true);
    const read = vi.spyOn(copyBackupLib, "copyBackup");
    // A member who turned the board off edits and pulls on this device's pool, kept in step.
    const { result, showToast } = setup(true, { ok: true, failed: [] }, false);

    result.current.exportBackup();

    expect(read).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
    expect(backupLib.readFullBackup).toHaveBeenCalledWith({});
    expect(clicked).toHaveLength(1);
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
    expect(window.localStorage.getItem("league_forecast_last_backup_v1")).toBeNull();
  });
});

describe("useFullBackup, a season switched while the copy is read", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("files each season's own schedule under its own id", async () => {
    window.localStorage.clear();
    const saved: string[] = [];
    vi.stubGlobal(
      "Blob",
      class {
        constructor(parts: string[]) {
          saved.push(parts.join(""));
        }
      }
    );
    vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => undefined });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const first = storage.getActiveSeasonId();
    storage.saveTeams([{ id: "a1", name: "First Season Club" }]);
    const second = storage.createSeason("Second").id;
    storage.setActiveSeason(second);
    storage.saveTeams([{ id: "b1", name: "Second Season Club" }]);
    storage.setActiveSeason(first);

    vi.spyOn(cloudSession, "restoresInCloud").mockReturnValue(true);
    let arrive: (made: Awaited<ReturnType<typeof copyBackupLib.copyBackup>>) => void = () =>
      undefined;
    vi.spyOn(copyBackupLib, "copyBackup").mockReturnValue(
      new Promise((resolve) => {
        arrive = resolve;
      })
    );
    // The active season as React holds it when the button is pressed: the first one's.
    const firstLive = (): LiveSeasonData => ({
      teams: [{ id: "a1", name: "First Season Club" }],
      matchups: [],
      logs: {},
      bracketLogs: {},
      settings: storage.loadSettingsForSeason(first),
    });
    const { result } = renderHook(() =>
      useFullBackup({
        liveSeason: firstLive,
        seasonCount: 2,
        rankingsLive: true,
        requestConfirmation: vi.fn(),
        showToast: vi.fn(),
        onRestored: vi.fn(),
      })
    );

    result.current.exportBackup();
    // The member switches seasons while the copy is read.
    storage.setActiveSeason(second);
    arrive({ ok: true, backup: COPY_POOL });
    await waitFor(() => expect(saved).toHaveLength(1));

    const file = JSON.parse(saved[0] ?? "{}") as FullBackup;
    const teamsOf = (id: string) =>
      file.seasons.find((one) => one.id === id)?.teams.map((team) => team.name);
    expect(teamsOf(first)).toEqual(["First Season Club"]);
    // The second season's own schedule, not the first one's laid over it.
    expect(teamsOf(second)).toEqual(["Second Season Club"]);
    // League as it stood at the press, which the active season is part of; the pool the copy's.
    expect(file.activeSeasonId).toBe(first);
    expect(file.teamRankings).toEqual(COPY_POOL);
  });
});

describe("useFullBackup, pressed again while the copy is read", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reads the copy once, says it is still reading, and reads it again once that is done", async () => {
    vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => undefined });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    vi.spyOn(backupLib, "readFullBackup").mockReturnValue(fullBackup("current"));
    vi.spyOn(cloudSession, "restoresInCloud").mockReturnValue(true);
    let arrive: (made: Awaited<ReturnType<typeof copyBackupLib.copyBackup>>) => void = () =>
      undefined;
    const read = vi.spyOn(copyBackupLib, "copyBackup").mockReturnValue(
      new Promise((resolve) => {
        arrive = resolve;
      })
    );
    const showToast = vi.fn();
    const { result } = renderHook(() =>
      useFullBackup({
        liveSeason: live,
        seasonCount: 1,
        rankingsLive: true,
        requestConfirmation: vi.fn(),
        showToast,
        onRestored: vi.fn(),
      })
    );
    result.current.exportBackup();
    result.current.exportBackup();
    // Each read is the whole copy, unpacked and decoded in a worker of its own.
    expect(read).toHaveBeenCalledTimes(1);
    expect(showToast.mock.calls.map(([message]) => message)).toEqual([
      READING_THE_COPY,
      STILL_READING_THE_COPY,
    ]);
    // Once the read is done, failed here, the button reads the copy again.
    arrive({ ok: false, why: "unreachable" });
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(notMade("unreachable"), { tone: "error" })
    );
    result.current.exportBackup();
    expect(read).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(
        showToast.mock.calls.filter(([message]) => message === notMade("unreachable"))
      ).toHaveLength(2)
    );
  });
});

describe("useFullBackup, the data a cloud restore replaced", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetTeamRankingsStore();
  });

  const restoring = async (inCloud: boolean) => {
    window.localStorage.clear();
    resetTeamRankingsStore();
    await initTeamRankingsStore(memoryIo());
    // A pool this device kept from before Team Rankings went live here, not the cloud's.
    saveScoutTeams([{ id: "S-9", name: "Placeholder Stale Club" }]);
    const saved: string[] = [];
    vi.stubGlobal(
      "Blob",
      class {
        constructor(parts: string[]) {
          saved.push(parts.join(""));
        }
      }
    );
    vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => undefined });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    vi.spyOn(cloudSession, "restoresInCloud").mockReturnValue(inCloud);
    vi.spyOn(cloudSession, "restoreTeamRankingsInCloud").mockResolvedValue({ ok: true });
    vi.spyOn(backupLib, "applyFullBackup").mockReturnValue({ ok: true, failed: [] });
    vi.spyOn(backupLib, "summarizeFullBackup").mockReturnValue("1 season");
    const showToast = vi.fn();
    const { result } = renderHook(() =>
      useFullBackup({
        liveSeason: () => ({
          teams: [],
          matchups: [],
          logs: {},
          bracketLogs: {},
          settings: storage.loadSettings(),
        }),
        seasonCount: 1,
        rankingsLive: true,
        requestConfirmation: vi.fn().mockResolvedValue(true),
        showToast,
        onRestored: vi.fn(),
      })
    );

    await result.current.restoreFullBackup(fullBackup("incoming"));
    const [message, options] = showToast.mock.calls[0] ?? [];
    options?.onAction();
    const replaced = JSON.parse(saved[0] ?? "{}") as FullBackup;
    return { message: String(message), replaced };
  };

  it("carries no pool of this device's in the cloud, which the restore did not replace", async () => {
    const { message, replaced } = await restoring(true);
    // Restored in its turn, this file would lay that pool over the cloud's for every device.
    expect(replaced.teamRankings).toEqual(NO_POOL);
    // The pool the restore did replace is the cloud's, which keeps it.
    expect(message).toContain("Earlier versions");
  });

  it("carries this device's pool anywhere else, which the restore did replace", async () => {
    const { message, replaced } = await restoring(false);
    expect(replaced.teamRankings.teams.map((team) => team.name)).toEqual([
      "Placeholder Stale Club",
    ]);
    expect(message).not.toContain("Earlier versions");
  });
});
