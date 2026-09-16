/**
 * Switching between saved seasons, and making, copying or deleting one.
 */
import { useState } from "react";
import type { SeasonMeta } from "../../lib/storage";
import { card } from "../../styles/tokens";

export function SeasonManager({
  seasons,
  activeSeasonId,
  onSwitch,
  onCreate,
  onDuplicate,
  onDelete,
}: {
  seasons: SeasonMeta[];
  activeSeasonId: string;
  onSwitch: (id: string) => void;
  onCreate: (name: string) => void;
  onDuplicate: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [newName, setNewName] = useState("");
  const chip =
    "rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800";
  const createNew = () => {
    if (!newName.trim()) return;
    onCreate(newName.trim());
    setNewName("");
  };
  return (
    <section className={`${card} p-5`} aria-label="Seasons">
      <h2 className="text-2xl font-black tracking-tight text-slate-950 dark:text-slate-100">
        Seasons
      </h2>
      <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
        Run several seasons side by side. Each keeps its own teams, games, scores, and settings —
        switching is instant and nothing is overwritten. Rename the active season with the “Season
        label” field below.
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

      <ul className="mt-4 space-y-2">
        {seasons.map((season) => {
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
                  <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
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
                    Switch
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
        })}
      </ul>
    </section>
  );
}
