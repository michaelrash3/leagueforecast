import {
  AGE_LEVELS,
  formatAgeGroupName,
  isRankedAgeLevel,
  type AgeGroup,
  type AgeGroupSeason,
} from "../../lib/teamRankings";
import type { SeasonMeta } from "../../lib/storage";
import { LeagueSeasonsCard } from "./LeagueSeasonsCard";
import { ResetRankingsCard } from "./ResetRankingsCard";
import { button, card } from "../../styles/tokens";

/**
 * The age group being created or edited. Held as one object because the form is opened, filled and
 * cleared as a unit — `startEditGroup` fills all four fields at once and Cancel blanks all four.
 */
export type AgeGroupDraft = {
  ageLevel: number;
  year: number;
  /**
   * League Standings seasons already on this group. Carried through an edit rather than chosen
   * here — which season plays at which age is asked once, in `LeagueSeasonsCard`.
   */
  seasonIds: string[];
  continuesFromId: string;
};

type SetupSectionProps = {
  seasons: SeasonMeta[];
  ageGroups: AgeGroup[];
  /** Which group the form is editing, or `null` when it is creating a new one. */
  editingGroupId: string | null;
  draft: AgeGroupDraft;
  onDraftChange: (patch: Partial<AgeGroupDraft>) => void;
  /** Puts a League Standings season at an age, or takes it off with `null`. */
  onAssignSeason: (seasonId: string, season: AgeGroupSeason | null) => void;
  yearOptions: number[];
  onSave: () => void;
  onCancelEdit: () => void;
  onEditGroup: (group: AgeGroup) => void;
  onAdvanceGroup: (group: AgeGroup) => void;
  onDeleteGroup: (group: AgeGroup) => void;
  teamCount: number;
  gameCount: number;
  onDownloadBackup: () => void;
  onReset: () => void;
};

/** The pages themselves — what exists, what continues from what — and the way to wipe the lot. */
export function SetupSection({
  seasons,
  ageGroups,
  editingGroupId,
  draft,
  onDraftChange,
  onAssignSeason,
  yearOptions,
  onSave,
  onCancelEdit,
  onEditGroup,
  onAdvanceGroup,
  onDeleteGroup,
  teamCount,
  gameCount,
  onDownloadBackup,
  onReset,
}: SetupSectionProps) {
  return (
    <>
      <div className={`${card} p-5`}>
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">
          What Team Rankings is
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Separate from League Standings: log any team&apos;s scores as they come up in a tournament
          or another league, and see how everyone stacks up. An age group&apos;s whole League
          Standings schedule (every season you assign to it — Fall, Spring, whatever your club runs)
          is folded in automatically, no need to re-enter those — an upcoming league game shows its
          opponent here right away, and once it&apos;s scored in League Standings it counts here as
          a final result too. Each age group keeps to itself, so a 9U opponent never turns up while
          you&apos;re logging an 11U game; point an age group at last year&apos;s to carry that
          squad&apos;s opponents forward as it ages up. Marking a team &ldquo;mine&rdquo; is just a
          shortcut for the scouting report and for adding your own schedule ahead of time — it never
          changes how any team, including yours, is rated.
        </p>
      </div>

      <LeagueSeasonsCard
        seasons={seasons}
        ageGroups={ageGroups}
        yearOptions={yearOptions}
        onAssign={onAssignSeason}
      />

      <div className={`${card} p-5`}>
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">Age groups</h2>
        <p className="mt-1 text-sm text-slate-500">
          These are made for you: answering the question above makes one, and so does a GameChanger
          import — a 9U schedule lands on the 9U page whether or not you made it first.
        </p>
        {ageGroups.length > 0 && (
          <ul className="mb-3 mt-3 divide-y divide-slate-100 dark:divide-slate-800">
            {ageGroups.map((group) => (
              <li
                key={group.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <span>
                  <span className="font-bold text-slate-950 dark:text-white">{group.name}</span>{" "}
                  <span className="text-slate-500">
                    {group.seasonIds.length
                      ? group.seasonIds
                          .map((id) => seasons.find((s) => s.id === id)?.name ?? id)
                          .join(", ")
                      : "No seasons assigned yet"}
                    {group.continuesFromId
                      ? ` · continues ${
                          ageGroups.find((g) => g.id === group.continuesFromId)?.name ??
                          "an age group that no longer exists"
                        }`
                      : ""}
                  </span>
                </span>
                <span className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => onAdvanceGroup(group)}
                    className="text-xs font-bold text-blue-600 hover:underline dark:text-blue-400"
                  >
                    Advance to new season
                  </button>
                  <button
                    type="button"
                    onClick={() => onEditGroup(group)}
                    className="text-xs font-bold text-blue-600 hover:underline dark:text-blue-400"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteGroup(group)}
                    className="text-xs font-bold text-red-600 hover:underline dark:text-red-400"
                  >
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <details open={editingGroupId !== null} className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-500">
            {editingGroupId ? "Edit age group" : "Add an age group by hand"}
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <span className="flex flex-col gap-1">
                <label
                  className="text-xs font-semibold uppercase tracking-wide text-slate-500"
                  htmlFor="scout-group-age"
                >
                  Age
                </label>
                <select
                  id="scout-group-age"
                  value={draft.ageLevel}
                  onChange={(event) => onDraftChange({ ageLevel: Number(event.target.value) })}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
                >
                  {AGE_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {level}U{isRankedAgeLevel(level) ? "" : " (not ranked)"}
                    </option>
                  ))}
                </select>
              </span>
              <span className="flex flex-col gap-1">
                <label
                  className="text-xs font-semibold uppercase tracking-wide text-slate-500"
                  htmlFor="scout-group-year"
                >
                  Year
                </label>
                <select
                  id="scout-group-year"
                  value={draft.year}
                  onChange={(event) => onDraftChange({ year: Number(event.target.value) })}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
                >
                  {yearOptions.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </span>
              <span className="flex flex-col justify-end pb-2 text-sm font-bold text-slate-950 dark:text-white">
                {formatAgeGroupName(draft.ageLevel, draft.year)}
              </span>
            </div>
            <label
              className="text-xs font-semibold uppercase tracking-wide text-slate-500"
              htmlFor="scout-continues-from"
            >
              Continues from
            </label>
            <select
              id="scout-continues-from"
              value={draft.continuesFromId}
              onChange={(event) => onDraftChange({ continuesFromId: event.target.value })}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
            >
              <option value="">Nothing — this is a new squad</option>
              {ageGroups
                .filter((group) => group.id !== editingGroupId)
                .map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
            </select>
            <p className="text-xs text-slate-500">
              Last year&apos;s version of this same squad — a 10U that used to be the 9U. Its
              opponents keep showing up in the name list here, but its results stay out of these
              rankings: a 9U score says nothing about a 10U game.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={onSave} className={button.primary}>
                {editingGroupId ? "Save changes" : "Create age group"}
              </button>
              {editingGroupId && (
                <button type="button" onClick={onCancelEdit} className={button.ghost}>
                  Cancel
                </button>
              )}
            </div>
          </div>
        </details>
      </div>

      <ResetRankingsCard
        ageGroupCount={ageGroups.length}
        teamCount={teamCount}
        gameCount={gameCount}
        onDownloadBackup={onDownloadBackup}
        onReset={onReset}
      />
    </>
  );
}
