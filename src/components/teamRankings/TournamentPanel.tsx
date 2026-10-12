import { useId, useMemo, useState } from "react";
import type { ScoutRankingRow, UpcomingMatchup } from "../../lib/teamRankings";
import { simulateTournament, TOURNAMENT_ITERATIONS } from "../../lib/tournamentSim";
import {
  deleteField,
  readSavedFields,
  saveField,
  type SavedField,
} from "../../lib/tournamentFields";
import { TeamSearchSelect, type TeamSearchOption } from "../TeamSearchSelect";
import { formatRating } from "./RankingList";
import { card } from "../../styles/tokens";

type TournamentPanelProps = {
  ageGroupId: string;
  rankings: ScoutRankingRow[];
  /** The report's team, and the games still on its schedule, for "our weekend" in one press. */
  reportForId: string;
  upcomingRows: UpcomingMatchup[];
  placeOf: (teamId: string) => string | undefined;
};

const pct = (value: number) => `${Math.round(value * 100)}%`;

const SMALL_BUTTON =
  "text-xs font-bold text-slate-600 hover:underline disabled:opacity-40 dark:text-slate-300";

/**
 * A weekend's field, played out before it is played.
 *
 * Travel coaches pick and prepare for a tournament most weekends, and the page could only say how
 * one club would do against each other club, one at a time and gone on reload. Here the field is
 * built by name or from the report's own next opponents, drawn into pools, and the whole event
 * simulated (`simulateTournament`): how strong the field is, and each club's chance to win its
 * pool, reach the final and win. A field is saved in this browser by name.
 */
export function TournamentPanel({
  ageGroupId,
  rankings,
  reportForId,
  upcomingRows,
  placeOf,
}: TournamentPanelProps) {
  const nameId = useId();
  const poolsId = useId();
  const advanceId = useId();
  const savedId = useId();
  const [name, setName] = useState("");
  const [fieldIds, setFieldIds] = useState<string[]>([]);
  const [pools, setPools] = useState(1);
  const [advance, setAdvance] = useState(4);
  // Keyed by age group where it is rendered, so these are always this age group's.
  const [savedFields, setSavedFields] = useState<SavedField[]>(() => readSavedFields(ageGroupId));

  const rowById = useMemo(() => new Map(rankings.map((row) => [row.teamId, row])), [rankings]);
  const options = useMemo(
    (): TeamSearchOption[] =>
      rankings
        .filter((row) => !fieldIds.includes(row.teamId))
        .map((row) => {
          const place = placeOf(row.teamId);
          return { id: row.teamId, label: row.teamName, ...(place ? { detail: place } : {}) };
        }),
    [rankings, fieldIds, placeOf]
  );
  const fieldRows = useMemo(
    () => fieldIds.flatMap((id) => rowById.get(id) ?? []),
    [fieldIds, rowById]
  );
  const unranked = fieldIds.length - fieldRows.length;
  const result = useMemo(
    () => simulateTournament(fieldRows, { pools, advance }),
    [fieldRows, pools, advance]
  );

  const add = (teamIds: string[]) =>
    setFieldIds((before) => [...before, ...teamIds.filter((id) => id && !before.includes(id))]);
  const ourWeekend = [reportForId, ...upcomingRows.map((row) => row.opponentId)].filter((id) =>
    rowById.has(id)
  );

  return (
    <section aria-label="Tournament field" className={`${card} p-5`}>
      <h2 className="text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Tournament field
      </h2>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        Build a weekend&apos;s field and play it out {TOURNAMENT_ITERATIONS.toLocaleString()} times
        on these ratings: pools by round robin, then a bracket for the clubs with the most pool
        wins.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor={nameId} className="sr-only">
          Event name
        </label>
        <input
          id={nameId}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Event name"
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
        />
        <button
          type="button"
          className={SMALL_BUTTON}
          disabled={!name.trim() || fieldIds.length === 0}
          onClick={() =>
            setSavedFields(
              saveField(ageGroupId, {
                name: name.trim(),
                teamIds: fieldIds,
                pools,
                advance,
              })
            )
          }
        >
          Save field
        </button>
        {savedFields.length > 0 && (
          <>
            <label htmlFor={savedId} className="sr-only">
              Saved fields
            </label>
            <select
              id={savedId}
              value=""
              onChange={(event) => {
                const field = savedFields.find((one) => one.name === event.target.value);
                if (!field) return;
                setName(field.name);
                setFieldIds(field.teamIds);
                setPools(field.pools);
                setAdvance(field.advance);
              }}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="">Open a saved field…</option>
              {savedFields.map((field) => (
                <option key={field.name} value={field.name}>
                  {field.name} ({field.teamIds.length})
                </option>
              ))}
            </select>
          </>
        )}
        {savedFields.some((field) => field.name === name.trim()) && (
          <button
            type="button"
            className={SMALL_BUTTON}
            onClick={() => setSavedFields(deleteField(ageGroupId, name.trim()))}
          >
            Delete saved
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <label
          htmlFor="tournament-add-team"
          className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
        >
          Add a club
        </label>
        <TeamSearchSelect
          id="tournament-add-team"
          value=""
          onChange={(teamId) => add([teamId])}
          options={options}
          placeholder="Search for a team"
          className="w-full sm:w-auto sm:min-w-56 sm:max-w-xs"
        />
        {ourWeekend.length > 1 && (
          <button type="button" className={SMALL_BUTTON} onClick={() => add(ourWeekend)}>
            Add our next opponents
          </button>
        )}
        {fieldIds.length > 0 && (
          <button type="button" className={SMALL_BUTTON} onClick={() => setFieldIds([])}>
            Clear field
          </button>
        )}
      </div>

      {fieldIds.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="The field">
          {fieldIds.map((id) => (
            <li
              key={id}
              className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800"
            >
              {rowById.get(id)?.teamName ?? "Not ranked here"}
              <button
                type="button"
                aria-label={`Remove ${rowById.get(id)?.teamName ?? "club"}`}
                onClick={() => setFieldIds((before) => before.filter((one) => one !== id))}
                className="font-bold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <label
          htmlFor={poolsId}
          className="text-xs font-semibold text-slate-500 dark:text-slate-400"
        >
          Pools
        </label>
        <select
          id={poolsId}
          value={pools}
          onChange={(event) => setPools(Number(event.target.value))}
          className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
        >
          {[1, 2, 3, 4].map((count) => (
            <option key={count} value={count}>
              {count}
            </option>
          ))}
        </select>
        <label
          htmlFor={advanceId}
          className="text-xs font-semibold text-slate-500 dark:text-slate-400"
        >
          Bracket of
        </label>
        <select
          id={advanceId}
          value={advance}
          onChange={(event) => setAdvance(Number(event.target.value))}
          className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
        >
          {[2, 4, 8].map((count) => (
            <option key={count} value={count}>
              {count}
            </option>
          ))}
        </select>
      </div>

      {unranked > 0 && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
          {unranked} club{unranked === 1 ? " is" : "s are"} not ranked on this board and{" "}
          {unranked === 1 ? "is" : "are"} left out of the simulation.
        </p>
      )}

      {result ? (
        <div className="mt-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Field strength: average rating {formatRating(result.strength.averageRating)}, average
            rank #{Math.round(result.strength.averageRank).toLocaleString()}, best #
            {result.strength.bestRank.toLocaleString()}. Played as {result.format.pools} pool
            {result.format.pools === 1 ? "" : "s"} and a bracket of {result.format.advance}.
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-sm" aria-label="Tournament odds">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <th className="py-1 pr-3">Club</th>
                  <th className="py-1 pr-3">Pool</th>
                  <th className="py-1 pr-3 text-right">Win pool</th>
                  <th className="py-1 pr-3 text-right">Final</th>
                  <th className="py-1 text-right">Win</th>
                </tr>
              </thead>
              <tbody>
                {result.field.map((row) => (
                  <tr key={row.teamId}>
                    <td className="py-1 pr-3">
                      {row.teamName}{" "}
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        #{row.rank.toLocaleString()}
                      </span>
                      {row.apart && (
                        <span
                          className="ml-1 text-xs font-bold text-amber-700 dark:text-amber-400"
                          title="Nothing in the games pulled so far links this club to most of the field, so its odds are a guess."
                        >
                          a guess
                        </span>
                      )}
                    </td>
                    <td className="py-1 pr-3">{row.pool}</td>
                    <td className="py-1 pr-3 text-right">{pct(row.winPool)}</td>
                    <td className="py-1 pr-3 text-right">{pct(row.reachFinal)}</td>
                    <td className="py-1 text-right font-bold">{pct(row.win)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
          Add two or more ranked clubs to play the field out.
        </p>
      )}
    </section>
  );
}
