import { useCallback } from "react";
import {
  applyFullBackup,
  backupFilename,
  readFullBackup,
  summarizeFullBackup,
  type FullBackup,
  type LiveSeasonData,
} from "../lib/backup";
import { noteBackupTaken } from "../lib/lastBackup";
import type { ConfirmState } from "./useConfirmation";

export type FullBackupOptions = {
  /** The active season as React holds it, which is fresher than storage's debounced writes. */
  liveSeason: () => LiveSeasonData;
  /** How many seasons are about to be replaced, for saying so before it happens. */
  seasonCount: number;
  requestConfirmation: (options: ConfirmState) => Promise<boolean>;
  showToast: (
    message: string,
    options?: {
      tone?: "success" | "error";
      actionLabel?: string;
      onAction?: () => void;
      durationMs?: number;
    }
  ) => void;
  /**
   * Put React back in step with storage, which is the source of truth once a restore has written
   * to it. Called before the toast, so what is on screen already matches what was restored.
   */
  onRestored: (backup: FullBackup) => void;
};

export type FullBackupControls = {
  /** Downloads everything in this browser, and records that a backup was taken. */
  exportBackup: () => void;
  /** Asks, then replaces everything in this browser with what the file holds. */
  restoreFullBackup: (backup: FullBackup) => Promise<void>;
};

/** Saving a file is the one part of this that is a browser act rather than a decision. */
const saveAsFile = (backup: FullBackup) => {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = backupFilename(backup.exportedAt);
  anchor.click();
  URL.revokeObjectURL(url);
};

/**
 * The whole-browser backup: every season, the Team Rankings pool, and the interface preferences.
 *
 * A restore replaces more than an undo snapshot could ever hold — a season the file does not carry
 * is simply gone — so there is no Undo offered for it, which would be a promise this cannot keep.
 * What it does instead is read the current state *before* writing anything and hand that back as a
 * download in the toast. That ordering is the whole safety of the operation and is easy to lose in
 * a refactor, so it lives here with the reason attached: the download is offered on both outcomes,
 * a partial restore most of all, and the toast is held open long enough to actually click.
 */
export function useFullBackup({
  liveSeason,
  seasonCount,
  requestConfirmation,
  showToast,
  onRestored,
}: FullBackupOptions): FullBackupControls {
  const exportBackup = useCallback(() => {
    saveAsFile(readFullBackup(liveSeason()));
    noteBackupTaken("league");
  }, [liveSeason]);

  const restoreFullBackup = useCallback(
    async (backup: FullBackup) => {
      // Read first. After applyFullBackup there is nothing left to read it from.
      const replaced = readFullBackup(liveSeason());
      const confirmed = await requestConfirmation({
        title: "Restore full backup?",
        message: `${summarizeFullBackup(backup)}

This replaces everything currently in this browser: all ${seasonCount} season${
          seasonCount === 1 ? "" : "s"
        }, the Team Rankings pool, and your theme and mode. It cannot be undone — the toast afterwards offers a download of the data being replaced.`,
        confirmLabel: "Restore everything",
      });
      if (!confirmed) return;

      const result = applyFullBackup(backup);
      onRestored(backup);

      const offerReplaced = {
        actionLabel: "Download replaced data",
        onAction: () => saveAsFile(replaced),
        durationMs: 12000,
      };
      if (!result.ok) {
        showToast(`Restore incomplete — could not write ${result.failed.join(", ")}.`, {
          tone: "error",
          ...offerReplaced,
        });
        return;
      }
      showToast(
        `Restored ${backup.seasons.length} season${
          backup.seasons.length === 1 ? "" : "s"
        } and Team Rankings.`,
        { tone: "success", ...offerReplaced }
      );
    },
    [liveSeason, seasonCount, requestConfirmation, showToast, onRestored]
  );

  return { exportBackup, restoreFullBackup };
}
