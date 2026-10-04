import { createWorker } from "../../hooks/createWorker";
import type {
  BackupAnswer,
  BackupRequest,
  BackupWant,
  PoolPartPieces,
} from "../../workers/backupProtocol";
import { inBatches } from "../cloud/cloudEngine";
import { chunkId } from "../cloud/cloudManifest";
import { LEAGUE_PART } from "../cloud/cloudPlan";
import type { CopyReader } from "./copyArchive";

/**
 * A backup of Team Rankings as the cloud's copy holds it (1.6e), for a device that holds no pool of
 * its own, or none it keeps in step: Setup's backup button, the whole-browser backup, and a
 * schedule's CSV export, in the cloud. The pieces of every pool part of the copy are fetched here,
 * as a take fetches them, and made into the backup by the backup worker (`backupProtocol.ts`),
 * which lays them into a pool store of its own and reads them back with the device's own loaders.
 */

/** Why the copy gave no backup, each said in plain words (`COPY_UNREAD`). */
export type CopyBackupMiss = "unreachable" | "none" | "moved" | "damaged" | "newer" | "failed";

export type CopyBackup = Extract<BackupAnswer, { ok: true }> | { ok: false; why: CopyBackupMiss };

/**
 * Why the copy's Team Rankings could not be had, each in plain words, for the caller to finish with
 * what then happened ("…, so no backup was made", `notMade`).
 */
export const COPY_UNREAD: Record<CopyBackupMiss, string> = {
  unreachable: "The cloud's copy could not be read just now",
  none: "The cloud holds no copy of Team Rankings yet",
  moved: "The cloud's copy changed while it was being read",
  damaged: "Part of the cloud's copy would not read",
  newer:
    "The cloud's copy was saved by a newer version of the app, so reload the page to update it",
  failed: "This browser could not put the cloud's Team Rankings together",
};

/** What is said of a backup the copy could not make. */
export const notMade = (why: CopyBackupMiss): string =>
  `${COPY_UNREAD[why]}, so no backup was made.`;

type Pieces =
  { ok: true; parts: PoolPartPieces[] } | { ok: false; why: "unreachable" | "none" | "moved" };

/** The pieces of the copy's pool parts, as its manifest now names them, or why not. */
const fetchPieces = async (
  reader: CopyReader,
  onProgress?: (done: number, total: number) => void
): Promise<Pieces> => {
  try {
    const manifest = await reader.readManifest();
    if (!manifest) return { ok: false, why: "none" };
    const pool = manifest.parts.filter((part) => part.key !== LEAGUE_PART);
    const parts: PoolPartPieces[] = [];
    for (const [index, part] of pool.entries()) {
      const chunks = new Array<Uint8Array | null>(part.chunks).fill(null);
      await inBatches(
        Array.from({ length: part.chunks }, (_, at) => at),
        async (at) => {
          chunks[at] = await reader.getChunk(chunkId(part.id, at));
        }
      );
      // Swept since the manifest was read: the copy moved on under the read.
      if (chunks.some((chunk) => chunk === null)) return { ok: false, why: "moved" };
      parts.push({ key: part.key, hash: part.hash, chunks: chunks as Uint8Array[] });
      onProgress?.(index + 1, pool.length);
    }
    return { ok: true, parts };
  } catch {
    return { ok: false, why: "unreachable" };
  }
};

/** Runs one request on a backup worker of its own, which ends with the answer. */
export const runBackupWorker = (request: BackupRequest): Promise<BackupAnswer> =>
  new Promise((resolve) => {
    const worker = createWorker(
      () =>
        new Worker(new URL("../../workers/backup.worker.ts", import.meta.url), { type: "module" }),
      "Backup"
    );
    // Never done here instead: this page's pool store is the device's own (`backupProtocol.ts`).
    if (!worker) {
      resolve({ ok: false, why: "failed" });
      return;
    }
    const done = (answer: BackupAnswer) => {
      worker.terminate();
      resolve(answer);
    };
    worker.onmessage = (event: MessageEvent<BackupAnswer>) => done(event.data);
    worker.onerror = () => done({ ok: false, why: "failed" });
    worker.onmessageerror = () => done({ ok: false, why: "failed" });
    worker.postMessage(request);
  });

/**
 * Team Rankings as the cloud's copy holds it, as `want` asks for it, or why not. A copy that moves
 * on while its pieces are read is read again, once, off its manifest as it then stands. It never
 * throws, so a caller that saves something either way (a schedule's CSV) always gets to.
 */
export const copyBackup = async ({
  copy,
  want,
  savedAt,
  run = runBackupWorker,
  onProgress,
}: {
  /** The cloud's copy as this member may read it (`copyReader`): none, when not given. */
  copy: (() => Promise<CopyReader | null>) | undefined;
  want: BackupWant;
  savedAt: string;
  run?: (request: BackupRequest) => Promise<BackupAnswer>;
  onProgress?: (done: number, total: number) => void;
}): Promise<CopyBackup> => {
  // A reader that will not come, its sign-in failing to load, is a copy that could not be read.
  const reader = copy ? await copy().catch(() => null) : null;
  if (!reader) return { ok: false, why: "unreachable" };
  let pieces = await fetchPieces(reader, onProgress);
  if (!pieces.ok && pieces.why === "moved") pieces = await fetchPieces(reader, onProgress);
  if (!pieces.ok) return pieces;
  return run({ parts: pieces.parts, want, savedAt }).catch((): CopyBackup => ({
    ok: false,
    why: "failed",
  }));
};
