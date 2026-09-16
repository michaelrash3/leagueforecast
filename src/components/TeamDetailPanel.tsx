import { useId, useMemo, useState } from "react";
import {
  countsTowardRating,
  gamesForTeam,
  gcSeasonLabel,
  isScoutGamePlayed,
  rankingPoolGroupIds,
  teamNameKey,
  teamRecordInPool,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
} from "../lib/teamRankings";
import { TeamSearchSelect } from "./TeamSearchSelect";
import { button, card, pill } from "../styles/tokens";

type TeamDetailPanelProps = {
  team: ScoutTeam;
  /** Every game in the roster's world, so games outside this season can be counted too. */
  allGames: ScoutGame[];
  ageGroupId: string;
  ageGroupName: string;
  /** Every age group, so the pool this page rates can be worked out. */
  ageGroups: AgeGroup[];
  teamNameById: Map<string, string>;
  /** League-derived teams are named by League Standings, so their name is not ours to change. */
  fromLeague: boolean;
  onRename: (nextName: string) => void;
  /** Two letters, or empty to clear it. */
  onSetState: (state: string) => void;
  /** Takes one GameChanger id off this team, undoing a pairing that turned out to be wrong. */
  onUnlinkGc: (gcTeamId: string) => void;
  /** Folds this team into another — the "same team as" the pull could only propose. */
  onMergeInto: (intoTeamId: string) => void;
  /** Teams this one could be folded into: everyone else on the page, for the picker. */
  mergeCandidates: ScoutTeam[];
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
  ageGroups,
  teamNameById,
  fromLeague,
  onRename,
  onSetState,
  onUnlinkGc,
  onMergeInto,
  mergeCandidates,
  onClose,
}: TeamDetailPanelProps) {
  const [draftName, setDraftName] = useState(team.name);
  const [mergeTarget, setMergeTarget] = useState("");

  /**
   * What the merge picker offers. The state rides along as the detail line, because a pool pulled
   * from GameChanger holds several clubs of the same name and the name alone cannot choose between
   * them; the picker sorts and filters them itself.
   */
  const mergeOptions = useMemo(
    () =>
      mergeCandidates.map((candidate) => ({
        id: candidate.id,
        label: candidate.name,
        ...(candidate.state ? { detail: candidate.state } : {}),
      })),
    [mergeCandidates]
  );

  const nameOf = (id: string) => teamNameById.get(id) ?? "Unknown";
  const everyGame = useMemo(() => gamesForTeam(team.id, allGames), [team.id, allGames]);

  /**
   * Scoped to the rating pool — every age group sharing this one's season year — rather than to
   * the page's own group, because that is what the ranking table rates. A 10U that spent the year
   * playing down is listed on the 10U page with every one of its games filed under 9U: scoped to
   * the group it would read 0-0 with nothing logged, directly contradicting the row above it.
   */
  const poolIds = useMemo(
    () => new Set(rankingPoolGroupIds(ageGroupId, ageGroups)),
    [ageGroupId, ageGroups]
  );
  const here = everyGame.filter((game) => poolIds.has(game.ageGroupId));
  const elsewhere = everyGame.length - here.length;

  // The same record the ranking row shows, counted by the same function, so the two agree.
  const record = useMemo(
    () => teamRecordInPool(team.id, ageGroupId, allGames, ageGroups),
    [team.id, ageGroupId, allGames, ageGroups]
  );
  const { wins, losses, ties } = record;
  const played = here.filter(countsTowardRating);
  const notCounted = here.filter((game) => isScoutGamePlayed(game) && !countsTowardRating(game));

  const trimmed = draftName.trim();
  const renamed = trimmed.length > 0 && trimmed !== team.name;
  const headingId = useId();

  const wouldMerge =
    renamed &&
    [...teamNameById.entries()].some(
      ([id, name]) => id !== team.id && teamNameKey(name) === teamNameKey(trimmed)
    );

  return (
    // A region rather than a plain box: this opens in answer to a click somewhere else on the
    // page, and naming it after the team is what tells a screen-reader user which team arrived.
    <section aria-labelledby={headingId} className={`${card} p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={headingId} className="text-sm font-black uppercase tracking-wide text-slate-500">
            {team.name}
          </h2>
          {(team.city || team.state) && (
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              {[team.city, team.state].filter(Boolean).join(", ")}
            </p>
          )}
          <p className="mt-1 text-xs text-slate-500">
            {played.length === 0
              ? `No completed games in ${ageGroupName || "this age group"} yet.`
              : `${wins}-${losses}${ties ? `-${ties}` : ""} in ${ageGroupName || "this age group"}, from ${played.length} game${played.length === 1 ? "" : "s"}.`}
            {record.crossAgeGames > 0
              ? ` ${record.crossAgeGames} of ${record.crossAgeGames === 1 ? "them was" : "them were"} against another age level.`
              : ""}
            {notCounted.length > 0
              ? ` ${notCounted.length} more played here ${notCounted.length === 1 ? "is" : "are"} set not to count.`
              : ""}
            {elsewhere > 0
              ? ` ${elsewhere} more game${elsewhere === 1 ? "" : "s"} in another season, not counted here.`
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
        ) : team.placeholder ? (
          <p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-500">
            This is a placeholder, not a team — the schedule said so rather than naming a club. The
            game is kept and counts for whoever played it, and this slot is not ranked. Type the
            club&apos;s real name here once you know it and the game moves to them; if that club is
            already here, saving merges the two.
          </p>
        ) : (
          <p className="mt-1 text-xs text-slate-500">
            Any age level in the name is dropped, so &ldquo;Aces 10U&rdquo; is stored as
            &ldquo;Aces&rdquo;.
          </p>
        )}
      </div>

      {(team.gcTeams?.length ?? 0) > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Known on GameChanger as
          </p>
          <ul className="mt-1 space-y-1">
            {team.gcTeams?.map((link) => (
              <li key={link.teamId} className="flex flex-wrap items-center gap-2 text-sm">
                <a
                  href={`https://web.gc.com/teams/${link.teamId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-bold text-blue-600 hover:underline dark:text-blue-400"
                >
                  {link.name}
                </a>
                <span className="text-xs text-slate-500">
                  {gcSeasonLabel(link) || "season unknown"}
                  {link.ageLevel === undefined ? "" : ` · ${link.ageLevel}U`}
                </span>
                <button
                  type="button"
                  onClick={() => onUnlinkGc(link.teamId)}
                  className="text-xs font-bold text-red-600 hover:underline dark:text-red-400"
                >
                  Unlink
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-slate-500">
            GameChanger mints a new id every season, so a club pulled across two seasons is known by
            two. Unlinking takes one off and leaves its games here — that id can then be pulled onto
            a team of its own, which is how a wrong pairing is taken apart.
          </p>
        </div>
      )}

      {mergeCandidates.length > 0 && (
        <div className="mt-4">
          <label
            className="text-xs font-semibold uppercase tracking-wide text-slate-500"
            htmlFor="scout-team-merge"
          >
            Same team as
          </label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <TeamSearchSelect
              id="scout-team-merge"
              value={mergeTarget}
              onChange={setMergeTarget}
              options={mergeOptions}
              placeholder="Type a team name…"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
            />
            <button
              type="button"
              disabled={!mergeTarget}
              onClick={() => {
                if (!mergeTarget) return;
                onMergeInto(mergeTarget);
                setMergeTarget("");
              }}
              className={button.ghost}
            >
              Fold into it
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Moves every game from this team over to that one and removes this entry, keeping both
            GameChanger ids. For a club that arrived twice — once pulled by id, once as somebody
            else&apos;s opponent.
          </p>
        </div>
      )}

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
    </section>
  );
}
