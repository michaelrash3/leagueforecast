import { useEffect, useState } from "react";
import { agoLabel } from "../../lib/date";
import type { ReplacedBackup } from "../../lib/replacedBackup";
import type { FullBackup } from "../../lib/backup";

/**
 * How the line reads what is kept, saves it and hears of a new one: `readReplaced`, `saveBackupFile`
 * and `onReplacedKept`, handed down from App, which has them in the first download already.
 * Imported here, they took the backup's own code into Settings' chunk too, and the build split it
 * out of the first download, 1.7 KB heavier (`bundleBudget.mjs`).
 */
export type ReplacedBackupAccess = {
  read: () => Promise<ReplacedBackup | null>;
  save: (backup: FullBackup) => void;
  listen: (heard: () => void) => () => void;
};

/**
 * What the last full restore replaced, offered as a download for as long as this device keeps it,
 * which is until the next restore (`replacedBackup.ts`). Nothing at all where nothing is kept.
 */
export function ReplacedBackupLine({ read, save, listen }: ReplacedBackupAccess) {
  const [kept, setKept] = useState<ReplacedBackup | null>(null);
  useEffect(() => {
    let live = true;
    const look = () => {
      void read().then((found) => {
        if (live) setKept(found);
      });
    };
    look();
    const stop = listen(look);
    return () => {
      live = false;
      stop();
    };
  }, [read, listen]);
  if (!kept) return null;
  return (
    <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
      The last restore, {agoLabel(kept.at)}, replaced data kept on this device until the next
      restore.{" "}
      <button
        type="button"
        onClick={() => save(kept.backup)}
        className="font-bold text-slate-800 underline dark:text-slate-100"
      >
        Download replaced data
      </button>
    </p>
  );
}
