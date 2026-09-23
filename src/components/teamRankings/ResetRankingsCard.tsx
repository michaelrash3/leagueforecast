import { agoLabel, daysSince } from "../../lib/date";
import { BACKUP_REMINDER_DAYS } from "../../lib/lastBackup";
import { button, card } from "../../styles/tokens";

type ResetRankingsCardProps = {
  ageGroupCount: number;
  teamCount: number;
  gameCount: number;
  /** Writes the whole pool out as one file, so there is a way back from the button below it. */
  onDownloadBackup: () => void;
  /** When that was last done from this browser; null for never. */
  lastBackupAt: string | null;
  onReset: () => void;
};

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * Start again from scratch: everything the app keeps in this browser, not only Team Rankings.
 *
 * The counts are on the card rather than only in the confirmation, because the number of games
 * about to go is the whole of what makes this decision easy or hard, and a reader should not have
 * to press a red button to find it out. The backup sits in the same card for the same reason: the
 * moment to offer the way back is before the door closes, not in a toast afterwards — there is no
 * afterwards here, as nothing about this is undoable.
 */
export function ResetRankingsCard({
  ageGroupCount,
  teamCount,
  gameCount,
  onDownloadBackup,
  lastBackupAt,
  onReset,
}: ResetRankingsCardProps) {
  const empty = ageGroupCount === 0 && teamCount === 0 && gameCount === 0;
  const overdue = !empty && (daysSince(lastBackupAt) ?? Infinity) > BACKUP_REMINDER_DAYS;

  return (
    <div className={`${card} border-red-200 p-5 dark:border-red-900/70`}>
      <h2 className="text-sm font-black uppercase tracking-wide text-red-600 dark:text-red-400">
        Start from scratch
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Deletes everything this app keeps in this browser and starts it again as if it had never
        been opened:{" "}
        {empty ? (
          "Team Rankings, which is empty already"
        ) : (
          <>
            Team Rankings&apos;{" "}
            <strong className="text-slate-950 dark:text-white">
              {plural(ageGroupCount, "age group")}, {plural(teamCount, "team")} and{" "}
              {plural(gameCount, "logged game")}
            </strong>
          </>
        )}
        ; every League Standings season, with its schedules and scores; and every decision made
        along the way — the clubs and games thrown out, the ages named by hand, the teams waiting on
        an age, the Organizations file — along with your settings.
      </p>
      <p className="mt-2 text-xs text-slate-500">
        This cannot be undone. Take a backup first if there is any chance you will want any of it
        again: Backup JSON, under League Standings → Settings, saves everything in this browser; the
        button here saves Team Rankings alone.
      </p>
      {!empty && (
        <p
          className={`mt-2 text-xs ${overdue ? "font-bold text-amber-700 dark:text-amber-300" : "text-slate-500"}`}
          data-testid="pool-backup-freshness"
        >
          Last backup: {agoLabel(lastBackupAt)}.
          {overdue &&
            " This pool lives in this browser alone; a backup is the only copy elsewhere."}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={onDownloadBackup} disabled={empty} className={button.ghost}>
          Download a backup first
        </button>
        <button type="button" onClick={onReset} className={button.danger}>
          Delete everything in the app
        </button>
      </div>
    </div>
  );
}
