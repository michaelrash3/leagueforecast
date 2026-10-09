import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShowToast } from "../../hooks/useLiveEdits";
import { commitChanges } from "../../lib/cloud/cloudEngine";
import { memoryCloud } from "../../lib/cloud/__tests__/memoryCloud";
import { notMade } from "../../lib/live/copyBackup";
import { lastBackupTakenAt } from "../../lib/lastBackup";
import type { BackupAnswer, BackupRequest } from "../../workers/backupProtocol";
import { LiveBackupCard, NOTHING_TO_BACK_UP } from "./LiveBackupCard";

/*
 * Setup's backup on the live page: the cloud copy's pool read when the button is pressed, made
 * into the file by the backup worker (a stand-in here, whose own test holds the file to the
 * device's), and downloaded.
 */

const T = "2027-04-15T12:00:00.000Z";

const copyHolding = async () => {
  const cloud = memoryCloud();
  const saved = await commitChanges({
    store: cloud.store,
    base: null,
    changes: [{ key: "league_forecast_scout_teams_v1", value: [], at: 1 }],
    device: "phone",
    now: T,
  });
  if (!saved.ok) throw new Error("not saved");
  return cloud;
};

const said: { message: string; tone?: string }[] = [];
const showToast: ShowToast = (message, options) => {
  said.push({ message, ...(options?.tone ? { tone: options.tone } : {}) });
};

let saved: { name: string; size: number }[] = [];
beforeEach(() => {
  said.length = 0;
  saved = [];
  localStorage.clear();
  let made: Blob | null = null;
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: (blob: Blob) => {
      made = blob;
      return "blob:backup";
    },
    revokeObjectURL: () => undefined,
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    saved.push({ name: this.download, size: made?.size ?? -1 });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Setup's backup on the live page", () => {
  it("downloads the file the worker makes of the cloud's copy, and notes the backup taken", async () => {
    const cloud = await copyHolding();
    const asked: BackupRequest[] = [];
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    const run = async (request: BackupRequest): Promise<BackupAnswer> => {
      asked.push(request);
      await held;
      return { ok: true, file: ['{"format":', '"placeholder"}'] };
    };
    render(<LiveBackupCard copy={async () => cloud.store} run={run} showToast={showToast} />);
    fireEvent.click(screen.getByRole("button", { name: "Download a backup" }));
    // Said while it is read, and not to be asked twice.
    const reading = await screen.findByRole("button", { name: "Reading the cloud's copy… 1 of 1" });
    expect(reading).toBeDisabled();
    release();
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(asked.map(({ want }) => want)).toEqual(["file"]);
    expect(saved[0]?.name).toMatch(/^Team_Rankings_Backup_\d{4}-\d{2}-\d{2}\.json$/);
    expect(saved[0]?.size).toBe('{"format":"placeholder"}'.length);
    expect(said).toEqual([{ message: "Backup downloaded (24 bytes).", tone: "success" }]);
    expect(lastBackupTakenAt("pool")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Download a backup" })).not.toBeDisabled();
  });

  it("says why no backup was made, and downloads nothing", async () => {
    const run = async (): Promise<BackupAnswer> => ({ ok: false, why: "newer" });
    const cloud = await copyHolding();
    const { unmount } = render(
      <LiveBackupCard copy={async () => cloud.store} run={run} showToast={showToast} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Download a backup" }));
    await waitFor(() => expect(said).toHaveLength(1));
    expect(said[0]).toEqual({ message: notMade("newer"), tone: "error" });
    unmount();
    render(<LiveBackupCard copy={async () => null} run={run} showToast={showToast} />);
    fireEvent.click(screen.getByRole("button", { name: "Download a backup" }));
    await waitFor(() => expect(said).toHaveLength(2));
    expect(said[1]).toEqual({ message: notMade("unreachable"), tone: "error" });
    expect(saved).toEqual([]);
    expect(lastBackupTakenAt("pool")).toBeNull();
  });

  it("says there is nothing to back up for an empty pool", async () => {
    const cloud = await copyHolding();
    const run = async (): Promise<BackupAnswer> => ({ ok: true, file: [] });
    render(<LiveBackupCard copy={async () => cloud.store} run={run} showToast={showToast} />);
    fireEvent.click(screen.getByRole("button", { name: "Download a backup" }));
    await waitFor(() => expect(said).toEqual([{ message: NOTHING_TO_BACK_UP, tone: "error" }]));
    expect(saved).toEqual([]);
  });
});
