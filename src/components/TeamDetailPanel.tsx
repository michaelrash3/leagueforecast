import { useMemo, useState } from "react";
import {
  countsTowardRating,
  gamesForTeam,
  isScoutGamePlayed,
  teamNameKey,
  type ScoutGame,
  type ScoutTeam,
} from "../lib/teamRankings";
import { button, card, pill } from "../styles/tokens";

type TeamDetailPanelProps = {
  team: ScoutTeam;
  /** Every game in the roster's world, so games outside this age group can be counted too. */
  allGames: ScoutGame[];
  ageGroupId: string;
  ageGroupName: string;
  teamNameById: Map<string, string>;
  /** League-derived teams are named by League Standings, so their name is not ours to change. */
  fromLeague: boolean;
  onRename: (nextName: string) => void;
  /** Two letters, or empty to clear it. */
  onSetState: (state: string) => void;
  onClose: () => void;
};

const scoreLine = (game: ScoutGame, own: string, nameOf: (id: string) => string) => {
  const isA = game.teamAId === own;
  const opponent = nameOf(isA ? game.teamBId : game.teamAId);
  if (!isScoutGamePlayed(game))
    return { opponent, result: null as null | string, detail: "Scheduled" };
  const ownScore = isA ? game.teamAScore! : game.teamBScore!;
  const oppScore = isA ? game.teamBScore! : game.teamAScore!;
  const result = ownScore > oppScore ? "W" : ownScore < oppScore ? "L" : "T";
  return { opponent, result, detail: `${ownScore}–${oppScore}` };
};

/**
 * Everything logged for one team: its games here, and how many it has elsewhere.
 *
 * Also where a name gets corrected. Renaming onto a name that already exists merges the two, which
 * is the point — a schedule that said "TBD", or a club typed two ways, leaves games stranded on a
 * team that should never have existed, and this is how they reach the right one.
 */
export function TeamDetailPanel({
  team,
  allGames,
  ageGroupId,
  ageGroupName,
  teamNameById,
  fromLeague,
  onRename,
  onSetState,
  onClose,
}: TeamDetailPanelProps) {
  const [draftName, setDraftName] = useState(team.name);

  const nameOf = (id: string) => teamNameById.get(id) ?? "Unknown";
  const everyGame = useMemo(() => gamesForTeam(team.id, allGames), [team.id, allGames]);
  const here = everyGame.filter((game) => game.ageGroupId === ageGroupId);
  const elsewhere = everyGame.length - here.length;

  // The record shown here has to match the ranking table's, so it uses the same filter: played,
  // and not one of the cross-age games deliberately left out.
  const played = here.filter(countsTowardRating);
  const notCounted = here.filter((game) => isScoutGamePlayed(game) && !countsTowardRating(game));
  const wins = played.filter((game) => {
    const isA = game.teamAId === team.id;
    return (
      (isA ? game.teamAScore! : game.teamBScore!) > (isA ? game.teamBScore! : game.teamAScore!)
    );
  }).length;
  const losses = played.filter((game) => {
    const isA = game.teamAId === team.id;
    return (
      (isA ? game.teamAScore! : game.teamBScore!) < (isA ? game.teamBScore! : game.teamAScore!)
    );
  }).length;
  const ties = played.length - wins - losses;

  const trimmed = draftName.trim();
  const renamed = trimmed.length > 0 && trimmed !== team.name;
  const wouldMerge =
    renamed &&
    [...teamNameById.entries()].some(
      ([id, name]) => id !== team.id && teamNameKey(name) === teamNameKey(trimmed)
    );

  return (
    <div className={`${card} p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">{team.name}</h2>
          <p className="mt-1 text-xs text-slate-500">
            {played.length === 0
              ? `No completed games in ${ageGroupName || "this age group"} yet.`
              : `${wins}-${losses}${ties ? `-${ties}` : ""} in ${ageGroupName || "this age group"}, from ${played.length} game${played.length === 1 ? "" : "s"}.`}
            {notCounted.length > 0
              ? ` ${notCounted.length} more played here ${notCounted.length === 1 ? "is" : "are"} set not to count.`
              : ""}
            {elsewhere > 0
              ? ` ${elsewhere} more game${elsewhere === 1 ? "" : "s"} in other age groups, not counted here.`
              : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs font-bold text-slate-500 hover:underline dark:text-slate-400"
        >
          Close
        </button>
      </div>

      <div className="mt-4">
        <label
          className="text-xs font-semibold uppercase tracking-wide text-slate-500"
          htmlFor="scout-team-rename"
        >
          Team name
        </label>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <input
            id="scout-team-rename"
            type="text"
            value={draftName}
            disabled={fromLeague}
            onChange={(event) => setDraftName(event.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:opacity-60 dark:border-slate-800 dark:bg-slate-900"
          />
          <button
            type="button"
            disabled={fromLeague || !renamed}
            onClick={() => onRename(trimmed)}
            className={button.ghost}
          >
            {wouldMerge ? "Merge" : "Rename"}
          </button>
        </div>
        {fromLeague ? (
          <p className="mt-1 text-xs text-slate-500">
            This team comes from a League Standings season, so its name is set there.
          </p>
        ) : wouldMerge ? (
          <p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-500">
            A team is already called that. Saving moves every game from this one over to it and
            removes this one — which is how a placeholder gets routed to the real team.
          </p>
        ) : (
          <p className="mt-1 text-xs text-slate-500">
            Any age level in the name is dropped, so &ldquo;Aces 10U&rdquo; is stored as
            &ldquo;Aces&rdquo;.
          </p>
        )}
      </div>

      <div className="mt-4">
        <label
          className="text-xs font-semibold uppercase tracking-wide text-slate-500"
          htmlFor="scout-team-state"
        >
          State
        </label>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <input
            id="scout-team-state"
            type="text"
            value={team.state ?? ""}
            maxLength={2}
            placeholder="KY"
            onChange={(event) => onSetState(event.target.value)}
            className="w-20 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm uppercase dark:border-slate-800 dark:bg-slate-900"
          />
          <span className="text-xs text-slate-500">
            Optional. Two letters, and only used to filter the rankings — it never changes a rating.
          </span>
        </div>
      </div>

      <h3 className="mt-5 text-xs font-black uppercase tracking-wide text-slate-500">
        Games in {ageGroupName || "this age group"}
      </h3>
      {here.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">Nothing logged here yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
          {here.map((game) => {
            const line = scoreLine(game, team.id, nameOf);
            return (
              <li
                key={game.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <span className="flex items-center gap-2">
                  {game.excluded ? (
                    <span className={pill("amber")} title="Kept, but not counted">
                      —
                    </span>
                  ) : line.result ? (
                    <span
                      className={pill(
                        line.result === "W" ? "emerald" : line.result === "L" ? "red" : "neutral"
                      )}
                    >
                      {line.result}
                    </span>
                  ) : (
                    <span className={pill("blue")}>Sched</span>
                  )}
                  <span className="font-bold text-slate-950 dark:text-white">{line.opponent}</span>
                </span>
                <span className="text-slate-500">
                  {line.detail}
                  {game.date ? ` · ${game.date}` : ""}
                  {game.event ? ` · ${game.event}` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
