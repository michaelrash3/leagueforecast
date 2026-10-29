import { useId, useState } from "react";
import { builderTeamNames } from "../../lib/roundRobin";
import { displayName } from "../../lib/format";
import type { TeamBase } from "../../lib/types";
import { EditLock } from "./EditLock";

/**
 * A season's team list before its schedule: teams typed in and saved, more added on a later visit,
 * renamed or taken off while the list is open, and the list locked once it is set. The schedule is
 * made only from a locked list, so the standings never meet a team that appears or goes after the
 * games are made. It opens again only while no game exists.
 */
export function TeamListPanel({
  teams,
  locked,
  hasGames,
  onAdd,
  onRename,
  onRemove,
  onLock,
  onUnlock,
}: {
  teams: TeamBase[];
  locked: boolean;
  hasGames: boolean;
  /** True when the names were saved, so the box can be cleared for the next ones. */
  onAdd: (names: string[]) => boolean;
  onRename: (teamId: string, name: string) => void;
  onRemove: (teamId: string) => void;
  onLock: () => void;
  onUnlock: () => void;
}) {
  const [text, setText] = useState("");
  const boxId = useId();
  const save = () => {
    if (onAdd(builderTeamNames(text))) setText("");
  };

  return (
    <section
      aria-label="Team list"
      className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-700 dark:bg-slate-900"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-100">
          Teams ({teams.length})
        </h2>
        <span
          className={`rounded-full px-3 py-1 text-xs font-black ${
            locked
              ? "bg-slate-950 text-white dark:bg-white dark:text-slate-950"
              : "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200"
          }`}
        >
          {locked ? "Locked" : "Open"}
        </span>
      </div>
      <p className="mt-1 text-sm font-semibold text-slate-600 dark:text-slate-300">
        {locked
          ? hasGames
            ? "The team list is set, and the schedule is made from it."
            : "The team list is set. Make the schedule below."
          : "Add the league's teams and save them; come back to add more. Lock the list when every team is in, then make the schedule."}
      </p>

      <EditLock>
        {!locked && (
          <div className="mt-4">
            <label
              htmlFor={boxId}
              className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300"
            >
              Add teams, one per line
            </label>
            <textarea
              id={boxId}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={"Falcons\nWolves\nComets"}
              className="mt-1 h-28 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-950 outline-hidden focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
            />
            <button
              type="button"
              onClick={save}
              disabled={builderTeamNames(text).length === 0}
              className="mt-2 rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white shadow-xs hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
            >
              Save teams
            </button>
          </div>
        )}

        {teams.length > 0 && (
          <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
            {teams.map((team) => (
              <li key={team.id} className="flex items-center gap-2 px-3 py-2">
                {locked ? (
                  <span className="text-sm font-bold text-slate-950 dark:text-slate-100">
                    {displayName(team.name)}
                  </span>
                ) : (
                  <>
                    <input
                      // Keyed on the name, so a rename the season refused puts the old one back.
                      key={team.name}
                      defaultValue={displayName(team.name)}
                      aria-label={`Name of ${displayName(team.name)}`}
                      onBlur={(event) => {
                        const next = event.target.value.trim();
                        if (next && next !== displayName(team.name)) onRename(team.id, next);
                        else event.target.value = displayName(team.name);
                      }}
                      className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm font-bold text-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    />
                    <button
                      type="button"
                      onClick={() => onRemove(team.id)}
                      aria-label={`Remove ${displayName(team.name)}`}
                      className="shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-red-700 dark:border-slate-600 dark:bg-slate-800 dark:text-red-300"
                    >
                      Remove
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {!locked && (
            <>
              <button
                type="button"
                onClick={onLock}
                disabled={teams.length < 2}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white shadow-xs hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Lock team list
              </button>
              {teams.length < 2 && (
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Two teams at least, to lock the list.
                </span>
              )}
            </>
          )}
          {locked && !hasGames && (
            <button
              type="button"
              onClick={onUnlock}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 shadow-xs hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              Unlock
            </button>
          )}
        </div>
      </EditLock>
    </section>
  );
}
