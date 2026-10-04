import { useState } from "react";
import type { Confirmation } from "../../hooks/useConfirmation";
import type { LiveEdits } from "../../hooks/useLiveEdits";
import type { YearSummary } from "../../lib/yearSummary";
import { button, card } from "../../styles/tokens";

/** Said once Team Rankings is started again, with its Undo beside it. */
export const STARTED_AGAIN =
  "Team Rankings started again. Undo now, or bring it back from the Cloud panel while it is among the earlier versions kept there.";
/** Said when the cloud's Team Rankings holds nothing a squad year is counted by. */
export const NOTHING_TO_START =
  "The cloud's Team Rankings has no pages, games or archived tables to start again from.";

const plural = (count: number, noun: string) =>
  `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;

/** The confirmation starting again asks, with what the cloud holds now. */
export const startAgainConfirmation = (years: readonly YearSummary[]) => {
  const pages = years.reduce((sum, year) => sum + year.pages, 0);
  const games = years.reduce((sum, year) => sum + year.games, 0);
  const tables = years.reduce((sum, year) => sum + year.archives, 0);
  const held = [
    plural(pages, "page"),
    plural(games, "stored game"),
    ...(tables > 0 ? [plural(tables, "archived table")] : []),
  ];
  return {
    title: "Start Team Rankings again?",
    message: [
      `The cloud's Team Rankings holds ${held.join(", ")} across ${plural(years.length, "squad year")}. All of it goes, on every device: the pages, the clubs and their games, the archive, and every decision made along the way (the clubs and games thrown out, the ages named by hand, the teams waiting on an age, the Organizations file and the nightly's pull lists).`,
      "League Standings is left as it is.",
      "What goes is kept as an earlier version, so it can be brought back: Undo straight after, or Bring back in the Cloud panel. The panel keeps the six most recent versions for 30 days at most, and each nightly refresh that changes anything keeps one too, so do not leave it long.",
    ].join("\n\n"),
    confirmLabel: "Start again",
  };
};

/**
 * Starting Team Rankings again on the live page (1.6): the cloud copy's Team Rankings emptied by
 * the server (`copy.reset`), the copy's owner's alone, and the server says so to anyone else. What
 * it takes is kept whole as an earlier version (`copyOps.ts`), so Undo brings it back, and so does
 * the Cloud panel's Bring back while it is one of the six versions kept (`KEEP_GROUPS`), which the
 * nightly's own kept versions push out within a week of refreshes that change anything. Unlike the device's card, nothing on this device is
 * deleted: the cloud's copy is the one started again. The size of it is asked of the server
 * (`year.list`) when the button is pressed, so the confirmation counts what the cloud holds then.
 */
export function LiveStartAgainCard({
  edits,
  confirm,
}: {
  edits: LiveEdits;
  confirm: Confirmation["request"];
}) {
  const { ask, edit, say } = edits;
  const [busy, setBusy] = useState(false);

  const startAgain = async () => {
    setBusy(true);
    try {
      const asked = await ask({ kind: "year.list" });
      if (!asked) return;
      if (asked.years.length === 0) {
        say(NOTHING_TO_START);
        return;
      }
      if (!(await confirm(startAgainConfirmation(asked.years)))) return;
      await edit({ kind: "copy.reset" }, { done: STARTED_AGAIN, undo: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`${card} border-red-200 p-5 dark:border-red-900/70`}>
      <h2 className="text-sm font-black uppercase tracking-wide text-red-600 dark:text-red-400">
        Start Team Rankings again
      </h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Empties the cloud&apos;s Team Rankings for every device: its pages, clubs and games, the
        archive, and every decision made along the way. League Standings is left as it is. What goes
        is kept as an earlier version in the Cloud panel, one of the six most recent kept there for
        30 days at most, so it can be brought back. Only the cloud copy&apos;s owner can do this.
      </p>
      <button
        type="button"
        onClick={() => void startAgain()}
        disabled={busy}
        className={`${button.danger} mt-3`}
      >
        Start Team Rankings again
      </button>
    </div>
  );
}
