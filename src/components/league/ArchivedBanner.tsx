import { StatePanel } from "../StatePanel";

/**
 * The line over an archived season (`seasonArchive.ts`): it is read-only, says so above whatever
 * tab is open, and is brought back from here as well as from the Seasons card. Shown as a season
 * kept as it last was, since that is what an archived one is.
 */
export function ArchivedBanner({ onUnarchive }: { onUnarchive: () => void }) {
  return (
    <StatePanel
      kind="stale"
      className="mb-4"
      actions={
        <button
          type="button"
          onClick={onUnarchive}
          className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 shadow-xs hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
        >
          Unarchive
        </button>
      }
    >
      This season is archived, so it is read-only. Unarchive it to change anything.
    </StatePanel>
  );
}
