/**
 * Switching between saved seasons, and making, copying, archiving or deleting one.
 */
import { Suspense, useId, useState } from "react";
import { archiveGroups } from "../../lib/seasonArchive";
import type { SeasonMeta } from "../../lib/storage";
import { card } from "../../styles/tokens";
import { ErrorBoundary } from "../ErrorBoundary";
import { LoadingPanel } from "../LoadingPanel";
import { viewChunk } from "./leagueViews";

/**
 * Every season at a glance, fetched the first time it is opened rather than with the Settings tab:
 * most visits to Settings never open it, and it reads every season stored here when it is drawn.
 * Its own boundary forgets a failed download, so Try again fetches afresh. While it downloads it
 * says so, as the other panels a button opens do: on one bar the button would otherwise say the
 * panel is open over nothing, and a second tap would close it.
 */
const glanceView = viewChunk(
  () => import("./SeasonsAtAGlance").then((module) => module.SeasonsAtAGlance),
  "SeasonsAtAGlance"
);

export function SeasonManager({
  seasons,
  activeSeasonId,
  archived = new Set<string>(),
  onSwitch,
  onCreate,
  onDuplicate,
  onDelete,
  onArchive,
}: {
  seasons: SeasonMeta[];
  activeSeasonId: string;
  /** The seasons archived (`seasonArchive.ts`), listed under Archived after the rest. */
  archived?: ReadonlySet<string>;
  onSwitch: (id: string) => void;
  onCreate: (name: string) => void;
  onDuplicate: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  /** Archives a season, or brings it back. */
  onArchive?: (id: string, archived: boolean) => void;
}) {
  const [newName, setNewName] = useState("");
  const [glanceOpen, setGlanceOpen] = useState(false);
  const glanceId = useId();
  const chip =
    "rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800";
  const createNew = () => {
    if (!newName.trim()) return;
    onCreate(newName.trim());
    setNewName("");
  };
  const groups = archiveGroups(seasons, archived);
  const row = (season: SeasonMeta, isArchived: boolean) => {
    const isActive = season.id === activeSeasonId;
    return (
      <li
        key={season.id}
        className={`flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between ${
          isActive
            ? "border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30"
            : "border-slate-200 dark:border-slate-700"
        }`}
      >
        <div className="flex min-w-0 items-center gap-2">
          {isActive && (
            <span className="rounded-full bg-blue-600 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-white">
              Active
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-900 dark:text-slate-100">
            {season.name}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isActive && (
            <button type="button" className={chip} onClick={() => onSwitch(season.id)}>
              {isArchived ? "Open" : "Switch"}
            </button>
          )}
          {onArchive && (
            <button
              type="button"
              className={chip}
              aria-label={`${isArchived ? "Unarchive" : "Archive"} ${season.name}`}
              onClick={() => onArchive(season.id, !isArchived)}
            >
              {isArchived ? "Unarchive" : "Archive"}
            </button>
          )}
          <button
            type="button"
            className={chip}
            onClick={() => onDuplicate(season.id, `${season.name} copy`)}
          >
            Duplicate
          </button>
          {seasons.length > 1 && (
            <button
              type="button"
              className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 dark:border-red-900/70 dark:text-red-300 dark:hover:bg-red-950/30"
              onClick={() => onDelete(season.id)}
            >
              Delete
            </button>
          )}
        </div>
      </li>
    );
  };
  return (
    <section className={`${card} p-5`} aria-label="Seasons">
      <h2 className="text-2xl font-black tracking-tight text-slate-950 dark:text-slate-100">
        Seasons
      </h2>
      <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
        Run several seasons side by side. Each keeps its own teams, games, scores, and settings —
        switching is instant and nothing is overwritten. Rename the active season with the “Season
        label” field below. Archive a season once it is over: it moves under Archived and is
        read-only until you unarchive it.
      </p>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") createNew();
          }}
          placeholder="New season name"
          aria-label="New season name"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-900 shadow-xs dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 sm:max-w-xs"
        />
        <button
          type="button"
          onClick={createNew}
          disabled={!newName.trim()}
          className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white shadow-xs hover:bg-slate-800 disabled:opacity-40 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
        >
          New Season
        </button>
      </div>

      <ul className="mt-4 space-y-2">{groups.inUse.map((season) => row(season, false))}</ul>

      {groups.archived.length > 0 && (
        <section className="mt-4" aria-label="Archived seasons">
          <h3 className="text-xs font-black uppercase tracking-[0.18em] text-slate-600 dark:text-slate-300">
            Archived
          </h3>
          <ul className="mt-2 space-y-2">{groups.archived.map((season) => row(season, true))}</ul>
        </section>
      )}

      <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
        <button
          type="button"
          className={chip}
          aria-expanded={glanceOpen}
          aria-controls={glanceId}
          onClick={() => setGlanceOpen((open) => !open)}
        >
          Seasons at a glance
        </button>
        <div id={glanceId} className={glanceOpen ? "mt-3" : ""}>
          {glanceOpen && (
            <ErrorBoundary area="Seasons at a glance" onReset={glanceView.reset}>
              <Suspense fallback={<LoadingPanel area="the seasons at a glance" />}>
                <glanceView.View seasons={seasons} activeSeasonId={activeSeasonId} />
              </Suspense>
            </ErrorBoundary>
          )}
        </div>
      </div>
    </section>
  );
}
