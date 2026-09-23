import { useState } from "react";
import { button, card } from "../../styles/tokens";

/** What a squad year holds, so the size of the decision is on the card and not behind a button. */
export type ArchivableYear = {
  year: number;
  pages: number;
  games: number;
  teams: number;
  /** Tables already archived from this year, which a delete takes too. */
  archives: number;
};

const plural = (count: number, noun: string) =>
  `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;

/**
 * Freeze a finished season and let its games go — or delete it outright, with nothing kept.
 *
 * A whole squad year at a time, and the card says so, because it is the part people get wrong:
 * every age on a year is rated together, so freezing one page and leaving its siblings would
 * change their tables. There is no partial version of this to offer.
 *
 * The counts are here rather than only in the confirmation, for the same reason they are on the
 * reset card — the number of games about to go is the whole of what makes the decision easy or
 * hard, and nobody should have to press the button to find it out.
 */
export function ArchiveSeasonCard({
  years,
  currentYear,
  busy,
  onArchive,
  onDelete,
}: {
  years: ArchivableYear[];
  /** The year the app considers live, which is offered last and with a warning beside it. */
  currentYear: number | undefined;
  busy: boolean;
  onArchive: (year: number) => void;
  /** Takes the whole year out with nothing kept; the caller asks first. */
  onDelete: (year: number) => void;
}) {
  const [picked, setPicked] = useState<number | "">("");
  const chosen = years.find((one) => one.year === picked);

  return (
    <div className={`${card} p-5`}>
      <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">
        Archive or delete a season
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Keeps the final tables — national and state, rank, rating, record and strength of schedule —
        and deletes every game behind them, including the ones your league contributed. The tables
        become read-only and live under Archive. Nothing else depends on them afterwards, and
        nothing recomputes them: change how ratings are worked out later and every live page moves
        while an archived table keeps the numbers it finished with.
      </p>
      <p className="mt-3 text-sm text-slate-500">
        Or delete the year with nothing kept: its pages, its games, the clubs that played in no
        other year, the GameChanger ids its squads were pulled as, and any tables already archived
        from it.
      </p>
      <p className="mt-3 text-sm text-slate-500">
        Either way a whole baseball year goes at once — every age on it. They are rated together, so
        taking one age and leaving the rest would quietly change the tables of the ones left behind.
      </p>

      {years.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">
          No season to archive yet. Pull a team list from GameChanger, or log some games, and the
          years show up here.
        </p>
      ) : (
        <>
          <label
            className="mt-4 block text-xs font-semibold uppercase tracking-wide text-slate-500"
            htmlFor="archive-year"
          >
            Baseball year
          </label>
          <select
            id="archive-year"
            value={picked}
            onChange={(event) =>
              setPicked(event.target.value === "" ? "" : Number(event.target.value))
            }
            className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
          >
            <option value="">Choose a year…</option>
            {years.map((one) => (
              <option key={one.year} value={one.year}>
                {one.year}
                {one.year === currentYear ? " (this year)" : ""} — {plural(one.games, "game")}
              </option>
            ))}
          </select>

          {chosen && (
            <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-900">
              <p className="text-slate-500">
                <strong className="text-slate-950 dark:text-white">{chosen.year}</strong> holds{" "}
                {plural(chosen.pages, "page")}, {plural(chosen.games, "game")} and{" "}
                {plural(chosen.teams, "team")}
                {chosen.archives > 0 ? `, and ${plural(chosen.archives, "archived table")}` : ""}. A
                team that also plays in another year stays where it is.
              </p>
              {chosen.year === currentYear && (
                <p className="mt-2 font-bold text-amber-700 dark:text-amber-400">
                  This is the year the app is showing as current. Archiving it empties the live
                  boards.
                </p>
              )}
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy || chosen === undefined || chosen.pages === 0}
              onClick={() => chosen && onArchive(chosen.year)}
              className={button.dark}
            >
              {busy ? "Working…" : "Archive this year"}
            </button>
            <button
              type="button"
              disabled={busy || chosen === undefined}
              onClick={() => chosen && onDelete(chosen.year)}
              className={`${button.danger} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              Delete this year
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Take a backup from the card below first if you may want the games again — neither can be
            undone. Archiving keeps the tables; deleting keeps nothing.
          </p>
        </>
      )}
    </div>
  );
}
