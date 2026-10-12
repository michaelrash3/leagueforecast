import { useState } from "react";
import type { ShowToast } from "../../hooks/useLiveEdits";
import { copyBackup, notMade } from "../../lib/live/copyBackup";
import type { CopyReader } from "../../lib/live/copyArchive";
import { noteBackupTaken } from "../../lib/lastBackup";
import { formatBytes } from "../../lib/teamRankingsBackup";
import type { BackupAnswer, BackupRequest } from "../../workers/backupProtocol";
import { button, card } from "../../styles/tokens";

/** Said when the cloud's Team Rankings holds nothing a backup would keep. */
export const NOTHING_TO_BACK_UP = "Nothing to back up yet.";

/** Saves `blob` as a download named `name`. */
const saveBlob = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
};

/**
 * A backup of Team Rankings on the live page (1.6e): the cloud copy's pool, read when the button is
 * pressed (`copyBackup`) and written as the very file the device's Setup writes, finished seasons
 * and every decision made along the way included, which Restore reads anywhere. The pieces come
 * with the page and the file is put together by the backup worker, off the page, so a nationwide
 * pool neither waits on this device's own copy nor stops the page while it is made.
 */
export function LiveBackupCard({
  copy,
  run,
  showToast,
}: {
  /** The cloud's copy as this member may read it (`copyReader`): none, when not given. */
  copy: (() => Promise<CopyReader | null>) | undefined;
  /** The backup worker, for a test; the real one otherwise. */
  run?: (request: BackupRequest) => Promise<BackupAnswer>;
  showToast: ShowToast;
}) {
  // While a backup is made: how many of the copy's parts are in, of how many.
  const [progress, setProgress] = useState<[number, number] | null>(null);

  const download = async () => {
    setProgress([0, 0]);
    try {
      const savedAt = new Date().toISOString();
      const made = await copyBackup({
        copy,
        want: "file",
        savedAt,
        ...(run ? { run } : {}),
        onProgress: (done, total) => setProgress([done, total]),
      });
      if (!made.ok) {
        showToast(notMade(made.why), { tone: "error" });
        return;
      }
      if (!made.file || made.file.length === 0) {
        showToast(NOTHING_TO_BACK_UP, { tone: "error" });
        return;
      }
      const blob = new Blob(made.file, { type: "application/json" });
      saveBlob(blob, `Team_Rankings_Backup_${savedAt.slice(0, 10)}.json`);
      noteBackupTaken("pool");
      showToast(`Backup downloaded (${formatBytes(blob.size)}).`, { tone: "success" });
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className={`${card} p-5`}>
      <h2 className="text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Back up Team Rankings
      </h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Downloads the cloud&apos;s Team Rankings as one file: every page, club and game, the
        finished seasons, and every decision made along the way. Restoring it, on this device or any
        other, reads this file.
      </p>
      <button
        type="button"
        onClick={() => void download()}
        disabled={progress !== null}
        aria-busy={progress !== null}
        className={`${button.ghost} mt-3`}
      >
        {progress === null
          ? "Download a backup"
          : progress[1] > 0
            ? `Reading the cloud's copy… ${progress[0]} of ${progress[1]}`
            : "Reading the cloud's copy…"}
      </button>
    </div>
  );
}
