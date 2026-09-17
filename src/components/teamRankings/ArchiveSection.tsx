import { useId, useRef, useState } from "react";
import {
  archiveRowsInState,
  archiveStates,
  searchArchiveRows,
  sortArchiveEntries,
  type ArchivedRankingRow,
  type ArchivedSeason,
  type ArchiveEntry,
} from "../../lib/teamRankingsArchive";
import { loadArchivedSeason } from "../../lib/teamRankingsStorage";
import { formatRating } from "./RankingList";
import { card, pill } from "../../styles/tokens";

/** The same shape the live boards lead with, so a finished season reads like a current one. */
const NATIONAL_TOP = 25;
const STATE_TOP = 10;

/**
 * Finished seasons, read-only.
 *
 * A season that has been archived has no games left — that is what archiving is — so there is
 * nothing here to click through to and nothing to edit. What is on screen is the table as it stood
 * on the day it was frozen: the national board, a state board, and the full list to find one club
 * in. No team panel, no "mark mine", no remove; an archived row is a name and some numbers and
 * cannot be resolved into a club, by this view or anything else.
 *
 * The rows are loaded when somebody opens a season and not before. A nationwide season is a
 * hundred thousand of them and there can be years of archives: loading the list is what the card
 * does at startup, and loading the rows is what the click does.
 */
export function ArchiveSection({ entries }: { entries: ArchiveEntry[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  /** What has come back, and for which season — so "not loaded yet" is not mistaken for "empty". */
  const [loaded, setLoaded] = useState<{ id: string; season: ArchivedSeason | null } | null>(null);
  /**
   * The season most recently asked for.
   *
   * A ref rather than state because it is read by a resolved promise, not rendered: a second click
   * while the first read is in flight would otherwise land the season nobody is looking at any
   * more, and comparing against state inside the `then` would compare against the value captured
   * when the click happened.
   */
  const wanted = useRef<string | null>(null);

  /* Loading on the click rather than in an effect on `openId`: opening a season is something
     somebody did, not a state the view has to be brought into line with. */
  const toggle = (id: string) => {
    const next = openId === id ? null : id;
    wanted.current = next;
    setOpenId(next);
    setLoaded(null);
    if (!next) return;
    void loadArchivedSeason(next).then((season) => {
      if (wanted.current !== next) return;
      setLoaded({ id: next, season });
    });
  };

  const season = loaded?.id === openId ? loaded.season : null;
  const status =
    openId === null
      ? "closed"
      : loaded?.id !== openId
        ? "loading"
        : loaded.season
          ? "ready"
          : "failed";

  const listed = sortArchiveEntries(entries);

  return (
    <>
      <div className={`${card} p-5`}>
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">
          Finished seasons
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          A season that is over is kept as its final table rather than its games. These are
          read-only: the ratings are the ones the season finished with and nothing recomputes them,
          so a change to how ratings are worked out moves every live page and leaves these alone.
        </p>
        {listed.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            Nothing archived yet. Finish a season and archive it from Setup.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
            {listed.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <button
                  type="button"
                  onClick={() => toggle(entry.id)}
                  aria-expanded={entry.id === openId}
                  className="font-bold text-slate-950 hover:underline dark:text-white"
                >
                  {entry.name}
                </button>
                <span className="text-slate-500">
                  {entry.teams.toLocaleString()} ranked from {entry.fromGames.toLocaleString()} game
                  {entry.fromGames === 1 ? "" : "s"}
                  {entry.archivedAt ? ` · frozen ${entry.archivedAt.slice(0, 10)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {status === "loading" && (
        <div className={`${card} p-5`}>
          <p className="text-sm text-slate-500">Loading the table…</p>
        </div>
      )}

      {status === "failed" && (
        <div className={`${card} border-red-200 p-5 dark:border-red-900/70`}>
          <p className="text-sm text-red-600 dark:text-red-400">
            That season is listed but its table would not load. The rows are kept separately from
            the list, so the list can be right while the rows are unreachable — nothing has been
            deleted by this.
          </p>
        </div>
      )}

      {season && <ArchivedSeasonBoards season={season} />}
    </>
  );
}

/** One frozen season: the two boards, and the full list underneath to find a club in. */
function ArchivedSeasonBoards({ season }: { season: ArchivedSeason }) {
  const [shownState, setShownState] = useState("");
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const searchId = useId();

  const states = archiveStates(season);
  const state = shownState || states[0] || "";
  const stateRows = state ? archiveRowsInState(season, state).slice(0, STATE_TOP) : [];
  const found = searchArchiveRows(season, query);

  return (
    <>
      <div className={`${card} p-5`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">
            {season.name}
          </h2>
          <span className={pill("amber")}>Final</span>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {season.rows.length.toLocaleString()} teams ranked from{" "}
          {season.fromGames.toLocaleString()} game{season.fromGames === 1 ? "" : "s"} between{" "}
          {season.fromTeams.toLocaleString()} sides
          {season.archivedAt ? `, frozen ${season.archivedAt.slice(0, 10)}` : ""}.
        </p>
        <label
          className="mt-4 block text-xs font-semibold uppercase tracking-wide text-slate-500"
          htmlFor={searchId}
        >
          Find a team in this season
        </label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Type part of a name"
          className="mt-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
        />
        {query.trim() !== "" && (
          <>
            <p className="mt-2 text-xs text-slate-500">
              {found.length === 0
                ? "No team in this season has that in its name."
                : `${found.length} match${found.length === 1 ? "" : "es"}.`}
            </p>
            {found.length > 0 && <ArchivedTable rows={found.slice(0, 50)} />}
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className={`${card} p-5`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">
              National top {NATIONAL_TOP}
            </h2>
            <span className="text-xs text-slate-500">
              of {season.rows.length.toLocaleString()} ranked
            </span>
          </div>
          <ArchivedList rows={season.rows.slice(0, NATIONAL_TOP)} />
        </div>

        <div className={`${card} p-5`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">
              State top {STATE_TOP}
            </h2>
            {states.length > 0 && (
              <select
                aria-label="State"
                value={state}
                onChange={(event) => setShownState(event.target.value)}
                className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
              >
                {states.map((one) => (
                  <option key={one} value={one}>
                    {one}
                  </option>
                ))}
              </select>
            )}
          </div>
          {stateRows.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">
              No team in this season had a state recorded, so there is no state board to show.
            </p>
          ) : (
            <ArchivedList rows={stateRows} />
          )}
        </div>
      </div>

      <div className={`${card} p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">
            Full final table
          </h2>
          <button
            type="button"
            onClick={() => setShowAll((value) => !value)}
            aria-expanded={showAll}
            className="text-xs font-bold text-blue-600 hover:underline dark:text-blue-400"
          >
            {showAll
              ? "Hide the full table"
              : `Show all ${season.rows.length.toLocaleString()} teams`}
          </button>
        </div>
        {showAll && <ArchivedTable rows={season.rows} />}
      </div>
    </>
  );
}

/** A frozen board: place, name, state, record and rating. No links, because there is nowhere. */
function ArchivedList({ rows }: { rows: Array<ArchivedRankingRow & { nationalRank?: number }> }) {
  return (
    <ol className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
      {rows.map((row, index) => (
        <li
          key={`${row.rank}-${row.teamName}`}
          className="flex items-center justify-between gap-3 px-2 py-2.5 text-sm"
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className={pill(index === 0 ? "amber" : "neutral")}>#{index + 1}</span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-bold text-slate-950 dark:text-white">
                {row.teamName}
              </span>
              {row.state && <span className="truncate text-xs text-slate-500">{row.state}</span>}
            </span>
          </span>
          <span className="shrink-0 text-slate-500">
            {row.record} · {formatRating(row.rating)}
          </span>
        </li>
      ))}
    </ol>
  );
}

function ArchivedTable({ rows }: { rows: ArchivedRankingRow[] }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th className="py-2">Rank</th>
            <th>Team</th>
            <th>State</th>
            <th>Record</th>
            <th>Rating</th>
            <th>Games</th>
            <th>SOS</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.rank}-${row.teamName}`}
              className="border-t border-slate-100 dark:border-slate-800"
            >
              <td className="py-3 font-black">#{row.rank}</td>
              <td className="font-bold text-slate-950 dark:text-white">{row.teamName}</td>
              <td className="text-slate-500">{row.state ?? "—"}</td>
              <td>{row.record}</td>
              <td>{formatRating(row.rating)}</td>
              <td>{row.games}</td>
              <td>{row.sosRank ? `#${row.sosRank}` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
