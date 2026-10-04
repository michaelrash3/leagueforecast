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
import { copyBackup, notMade } from "../lib/live/copyBackup";
import { teamRankingsBackupIsEmpty } from "../lib/teamRankingsBackup";
import { copyReader, restoresInCloud, restoreTeamRankingsInCloud } from "../lib/cloud/cloudSession";
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
  /**
   * Downloads everything in this browser, and records that a backup was taken: in the cloud, with
   * Team Rankings as the cloud's copy holds it, read for the file (1.6e).
   */
  exportBackup: () => void;
  /** Asks, then replaces everything in this browser with what the file holds. */
  restoreFullBackup: (backup: FullBackup) => Promise<void>;
};

/** Said while the backup reads Team Rankings off the cloud's copy, which can take a while. */
export const READING_THE_COPY =
  "Reading Team Rankings from the cloud for the backup. It downloads once that is in.";

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
    if (!restoresInCloud()) {
      saveAsFile(readFullBackup(liveSeason()));
      noteBackupTaken("league");
      return;
    }
    /*
     * In the cloud the pool is the copy's, which a restore of this file goes back to (above), and a
     * member's device holds none of its own, or none kept in step: the file carries the copy's,
     * read when it is asked for, or is not made at all rather than made with a pool that is not.
     */
    showToast(READING_THE_COPY);
    void (async () => {
      const made = await copyBackup({
        copy: copyReader,
        want: "backup",
        savedAt: new Date().toISOString(),
      });
      if (!made.ok || !made.backup) {
        showToast(notMade(made.ok ? "failed" : made.why), { tone: "error" });
        return;
      }
      // The season as it then stands, which may have moved while the copy was read.
      saveAsFile(readFullBackup(liveSeason(), made.backup));
      noteBackupTaken("league");
    })();
  }, [liveSeason, showToast]);

  const restoreFullBackup = useCallback(
    async (backup: FullBackup) => {
      // Read first. After applyFullBackup there is nothing left to read it from.
      const replaced = readFullBackup(liveSeason());
      // In the cloud, the pool is the copy's, and the server restores it (1.6): this browser
      // writes the seasons and settings, and takes the pool from the copy when Team Rankings next
      // reads it. What the copy replaces it keeps, so the cloud's pool can be brought back.
      const inCloud = restoresInCloud();
      // A file with no pool in it leaves the cloud's as it is: emptying that is Start again's.
      const cloudPool = inCloud && !teamRankingsBackupIsEmpty(backup.teamRankings);
      const confirmed = await requestConfirmation({
        title: "Restore full backup?",
        message: `${summarizeFullBackup(backup)}

This replaces everything currently in this browser: all ${seasonCount} season${
          seasonCount === 1 ? "" : "s"
        }, ${
          cloudPool
            ? "and your theme and mode; and the cloud's Team Rankings for every device, which keeps the pool it replaces under Earlier versions in the Cloud panel"
            : inCloud
              ? "and your theme and mode. The file holds no Team Rankings, so the cloud's is left as it is"
              : "the Team Rankings pool, and your theme and mode"
        }. It cannot be undone — the toast afterwards offers a download of the data being replaced.`,
        confirmLabel: "Restore everything",
      });
      if (!confirmed) return;

      const result = applyFullBackup(backup, { teamRankings: !inCloud });
      // On screen before the cloud is waited on, which can take a while: the seasons written are
      // the ones React holds by then, so nothing typed meanwhile lands in the wrong season.
      onRestored(backup);
      const failed = [...result.failed];
      if (cloudPool) {
        const pool = await restoreTeamRankingsInCloud(backup.teamRankings, { reload: false });
        if (!pool.ok) failed.push(`Team Rankings (${pool.message})`);
      }

      const offerReplaced = {
        actionLabel: "Download replaced data",
        onAction: () => saveAsFile(replaced),
        durationMs: 12000,
      };
      if (failed.length > 0) {
        showToast(`Restore incomplete — could not write ${failed.join(", ")}.`, {
          tone: "error",
          ...offerReplaced,
        });
        return;
      }
      showToast(
        `Restored ${backup.seasons.length} season${backup.seasons.length === 1 ? "" : "s"}${
          inCloud && !cloudPool
            ? ". The file holds no Team Rankings, so the cloud's is as it was."
            : " and Team Rankings."
        }`,
        { tone: "success", ...offerReplaced }
      );
    },
    [liveSeason, seasonCount, requestConfirmation, showToast, onRestored]
  );

  return { exportBackup, restoreFullBackup };
}
