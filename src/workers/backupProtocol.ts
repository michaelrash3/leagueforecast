import { DamagedValueError, unpackChunks } from "../lib/cloud/cloudPack";
import { memoryIo } from "../lib/poolMemoryIo";
import {
  readTeamRankingsBackup,
  teamRankingsCsvSections,
  teamRankingsJsonParts,
  type TeamRankingsBackup,
} from "../lib/teamRankingsBackup";
import {
  applyCloudPoolValues,
  initTeamRankingsStore,
  loadAllArchivedSeasons,
  resetTeamRankingsStore,
} from "../lib/teamRankingsStorage";

/**
 * What crosses the backup worker's port (`backup.worker.ts`), and what it does with it: Team
 * Rankings as the cloud's copy holds it, made into what a backup of it is (1.6e).
 *
 * A member's device is to hold no pool, so a backup of Team Rankings is read off the copy when it
 * is asked for. The page fetches the pieces of the copy's pool parts (`copyBackup.ts`); here they
 * are unpacked and checked as a take checks them (`unpackChunks`), laid into a pool store of this
 * realm's own, in memory (`applyCloudPoolValues`), and read back by the very loaders the device's
 * own backup reads with (`readTeamRankingsBackup`, `loadAllArchivedSeasons`). So the file is the
 * one a device holding that pool would write, to the byte, and the work is off the page.
 *
 * It must run in a worker. The store is a module of one per realm: on the page it is the device's
 * own, which this would empty and fill with the copy.
 */

/** One part of the copy's pool as its pieces were fetched: its key, its fingerprint, its pieces. */
export type PoolPartPieces = { key: string; hash: string; chunks: Uint8Array[] };

/**
 * What the backup is wanted for: the Team Rankings file, with the finished seasons, as Setup's
 * button writes it (`file`); the pool's CSV sections, as a schedule's CSV export carries them
 * (`csv`); or the pool itself, as the whole-browser backup holds it (`backup`). The last two leave
 * the finished seasons out, as the device's do.
 */
export type BackupWant = "file" | "csv" | "backup";

export type BackupRequest = { parts: PoolPartPieces[]; want: BackupWant; savedAt: string };

export type BackupAnswer =
  | { ok: true; file?: string[]; csv?: string; backup?: TeamRankingsBackup }
  /**
   * `damaged`: pieces that do not make the value the copy names. `newer`: a key this build does
   * not keep, from a copy a newer build saved. `failed`: the worker could not do it at all.
   */
  | { ok: false; why: "damaged" | "newer" | "failed" };

export const backupOfCopy = async (request: BackupRequest): Promise<BackupAnswer> => {
  const values = new Map<string, unknown>();
  for (const part of request.parts) {
    try {
      values.set(part.key, await unpackChunks(part.chunks, part.hash));
    } catch (error) {
      if (error instanceof DamagedValueError) return { ok: false, why: "damaged" };
      throw error;
    }
  }
  resetTeamRankingsStore();
  await initTeamRankingsStore(memoryIo());
  if (!(await applyCloudPoolValues(values))) return { ok: false, why: "newer" };
  const pool = readTeamRankingsBackup();
  switch (request.want) {
    case "file": {
      const backup = { ...pool, archives: await loadAllArchivedSeasons() };
      // No parts for a pool with nothing in it, as the device writes no file then either.
      return { ok: true, file: teamRankingsJsonParts(backup, request.savedAt) };
    }
    case "csv":
      return { ok: true, csv: teamRankingsCsvSections(pool) };
    case "backup":
      return { ok: true, backup: pool };
  }
};
