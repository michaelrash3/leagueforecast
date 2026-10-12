import { readUpload, type UploadReader } from "../cloud/uploads";
import { readTeamRankingsFile, writeTeamRankingsBackup } from "../teamRankingsBackup";
import { replaceArchivedSeasons } from "../teamRankingsStorage";

/**
 * Team Rankings restored from a backup on the server (1.6), as a device restoring the same file
 * restores its own pool (`useSeasonFiles`' `applyTeamRankingsImport`): the file the owner staged
 * (`uploads.ts`), read back and checked against its fingerprint, then read as the device reads a
 * Team Rankings JSON file (`readTeamRankingsFile`, `parseTeamRankingsJson`'s reading of the parsed
 * file) and written onto the process's store
 * (`writeTeamRankingsBackup`), its archived tables with it where the file carries them. The edit
 * run commits what that wrote as one save, keeping whole what it replaced (`runEdit`).
 *
 * The upload holds the file's own text: the device stages the Team Rankings JSON it would have
 * written, made from whichever backup it was given (`teamRankingsJsonParts`), so the server reads
 * one format whatever the file was, and reads it with the very function the device does.
 */

/**
 * What a restore came to on the store: done; `missing` (no such upload, or one not whole);
 * `refused` (pieces that are not what was fingerprinted, or a file that is not a Team Rankings
 * backup); or `unsaved` (the store would not take it).
 */
export type BackupRestoreRun = { ok: true } | { ok: false; why: "missing" | "refused" | "unsaved" };

export const runBackupRestore = async (
  uploads: UploadReader,
  upload: string
): Promise<BackupRestoreRun> => {
  const read = await readUpload(uploads, upload, "team-rankings");
  if (!read.ok) return { ok: false, why: read.why === "damaged" ? "refused" : "missing" };
  const backup = readTeamRankingsFile(read.value);
  if (!backup) return { ok: false, why: "refused" };
  if (!writeTeamRankingsBackup(backup)) return { ok: false, why: "unsaved" };
  // Only when the file carries archives at all, as on a device: a file that predates them says
  // nothing about the archive, and reading that silence as "none" would delete every table.
  if (backup.archives && !(await replaceArchivedSeasons(backup.archives))) {
    return { ok: false, why: "unsaved" };
  }
  return { ok: true };
};
