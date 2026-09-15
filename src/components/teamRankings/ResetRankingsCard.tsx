import { button, card } from "../../styles/tokens";

type ResetRankingsCardProps = {
  ageGroupCount: number;
  teamCount: number;
  gameCount: number;
  /** Writes the whole pool out as one file, so there is a way back from the button below it. */
  onDownloadBackup: () => void;
  onReset: () => void;
};

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * Start again from scratch.
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
  onReset,
}: ResetRankingsCardProps) {
  const empty = ageGroupCount === 0 && teamCount === 0 && gameCount === 0;

  return (
    <div className={`${card} border-red-200 p-5 dark:border-red-900/70`}>
      <h2 className="text-sm font-black uppercase tracking-wide text-red-600 dark:text-red-400">
        Start from scratch
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        {empty ? (
          "There is nothing in Team Rankings yet — no age groups, no teams, no games."
        ) : (
          <>
            Deletes everything Team Rankings holds:{" "}
            <strong className="text-slate-950 dark:text-white">
              {plural(ageGroupCount, "age group")}, {plural(teamCount, "team")} and{" "}
              {plural(gameCount, "logged game")}
            </strong>
            , along with where an interrupted GameChanger pull had got to and which age levels have
            already had their weekly refresh. League Standings — your seasons, schedules and scores
            — is not touched.
          </>
        )}
      </p>
      <p className="mt-2 text-xs text-slate-500">
        This cannot be undone. Download the backup first if there is any chance you will want this
        data again: it is one CSV file, the same one the app&apos;s own export writes, and importing
        it puts the pool back.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={onDownloadBackup} disabled={empty} className={button.ghost}>
          Download a backup first
        </button>
        <button
          type="button"
          onClick={onReset}
          disabled={empty}
          className={`${button.danger} disabled:cursor-not-allowed disabled:opacity-50`}
        >
          Delete everything in Team Rankings
        </button>
      </div>
    </div>
  );
}
