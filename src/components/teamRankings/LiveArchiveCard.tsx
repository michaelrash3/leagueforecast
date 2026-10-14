import { useEffect, useState } from "react";
import type { Confirmation } from "../../hooks/useConfirmation";
import type { LiveEdits } from "../../hooks/useLiveEdits";
import {
  archiveConfirmation,
  archivedSaid,
  archivesAnything,
  deleteConfirmation,
  deletesAnything,
  nothingUnder,
  type YearSummary,
} from "../../lib/yearSummary";
import { button, card } from "../../styles/tokens";
import { ArchiveSeasonCard } from "./ArchiveSeasonCard";

/** What the card says while the cloud has not yet said which years there are. */
export const YEARS_READING = "Reading the years from the cloud…";

/**
 * Setup's Archive card on the live page (1.6): the years the cloud copy holds, as the server counts
 * them (`year.list`), and a year archived or deleted by the server (`year.archive`, `year.delete`),
 * which only the copy's owner may ask for, and the server says so to anyone else. Each asks first
 * with what the server says it would keep and take (`year.archivePreview`, `year.deletePreview`),
 * in the words the device's own card asks in (`yearSummary.ts`), and the years are read again once
 * it is done.
 */
export function LiveArchiveCard({
  edits,
  confirm,
  currentYear,
}: {
  edits: LiveEdits;
  confirm: Confirmation["request"];
  /** The year of the page on screen, which the card offers with a warning beside it. */
  currentYear: number | undefined;
}) {
  const { ask, edit, say, locked, poolRevision } = edits;
  const [years, setYears] = useState<YearSummary[] | null>(null);
  const [yearsAt, setYearsAt] = useState(poolRevision);
  const [busy, setBusy] = useState(false);
  const [unread, setUnread] = useState(false);
  /** Bumped once an archive or a delete is made, so the years are read again. */
  const [made, setMade] = useState(0);
  const [answeredRequest, setAnsweredRequest] = useState(-1);
  const shownYears = yearsAt === poolRevision ? years : null;
  const readFailed = unread && answeredRequest === made && yearsAt === poolRevision;

  // Asked once edits are on, as the other cards ask: a question sent while they are off is only
  // the lock said again.
  useEffect(() => {
    if (locked) return;
    let alive = true;
    const controller = new AbortController();
    void ask({ kind: "year.list" }, { signal: controller.signal }).then((answer) => {
      if (!alive) return;
      setUnread(!answer);
      setAnsweredRequest(made);
      setYearsAt(poolRevision);
      setYears(answer?.years ?? null);
    });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [locked, ask, made, poolRevision]);

  /** One archive or delete: asked about, confirmed, sent, and the years read again after. */
  const run = async (work: () => Promise<boolean>) => {
    setBusy(true);
    try {
      if (await work()) setMade((count) => count + 1);
    } finally {
      setBusy(false);
    }
  };

  const archive = (year: number) =>
    run(async () => {
      const asked = await ask({ kind: "year.archivePreview", year });
      if (!asked) return false;
      if (!archivesAnything(asked.preview)) {
        say(nothingUnder(year));
        return false;
      }
      if (!(await confirm(archiveConfirmation(year, asked.preview)))) return false;
      return edit(
        { kind: "year.archive", year, at: new Date().toISOString() },
        { done: archivedSaid(year, asked.preview) }
      );
    });

  const remove = (year: number) =>
    run(async () => {
      const asked = await ask({ kind: "year.deletePreview", year });
      if (!asked) return false;
      if (!deletesAnything(asked.preview)) {
        say(nothingUnder(year));
        return false;
      }
      if (!(await confirm(deleteConfirmation(year, asked.preview)))) return false;
      return edit({ kind: "year.delete", year }, { done: `${year} deleted.` });
    });

  if (shownYears === null) {
    return (
      <div className={`${card} p-5`}>
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Archive or delete a season
        </h2>
        <p role="status" className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {locked ??
            (readFailed
              ? "The cloud's years could not be read just now."
              : edits.reconnecting
                ? "Reconnecting to read the cloud's years…"
                : YEARS_READING)}
        </p>
        {readFailed && !locked && (
          <button
            type="button"
            className={`${button.ghost} mt-3`}
            onClick={() => setMade((count) => count + 1)}
          >
            Try again
          </button>
        )}
      </div>
    );
  }
  return (
    <>
      {busy && (
        <p role="status" className="text-sm text-slate-500 dark:text-slate-400">
          Working on this season in the cloud…
        </p>
      )}
      <ArchiveSeasonCard
        years={shownYears}
        currentYear={currentYear}
        busy={busy}
        onArchive={(year) => void archive(year)}
        onDelete={(year) => void remove(year)}
      />
    </>
  );
}
