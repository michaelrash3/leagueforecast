import { backupFilename, type FullBackup } from "./backup";

/** Saves `backup` as a file: the one part of a backup that is a browser act rather than a decision. */
export const saveBackupFile = (backup: FullBackup): void => {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = backupFilename(backup.exportedAt);
  anchor.click();
  URL.revokeObjectURL(url);
};
