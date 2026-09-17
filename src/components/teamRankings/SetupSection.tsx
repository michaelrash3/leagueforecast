import {
  type AgeGroup,
  type AgeGroupSeason,
  type ScoutGame,
  type ScoutTeam,
} from "../../lib/teamRankings";
import type { SeasonMeta } from "../../lib/storage";
import { LeagueSeasonsCard } from "./LeagueSeasonsCard";
import { ModelCheckCard } from "./ModelCheckCard";
import { PoolHealthCard } from "./PoolHealthCard";
import type { GcImportState } from "../../lib/gameChangerImport";
import type { TidyOutcome } from "../../hooks/usePoolTidy";
import { ResetRankingsCard } from "./ResetRankingsCard";
import { card } from "../../styles/tokens";

type SetupSectionProps = {
  seasons: SeasonMeta[];
  ageGroups: AgeGroup[];
  /** Puts a League Standings season at an age, or takes it off with `null`. */
  onAssignSeason: (seasonId: string, season: AgeGroupSeason | null) => void;
  yearOptions: number[];
  teamCount: number;
  gameCount: number;
  onDownloadBackup: () => void;
  onReset: () => void;
  /** The whole stored pool, its tidy stamp, and where to put it back once tidied. */
  poolHealth: {
    pool: GcImportState;
    tidyStamp: string;
    onTidied: (outcome: TidyOutcome) => void;
  };
  /** Everything the model check needs to refit this page's pool on demand. */
  modelCheck: {
    ageGroupId: string;
    groupName: string;
    teams: ScoutTeam[];
    games: ScoutGame[];
  };
};

/**
 * What the pool is: which pages exist, which league season sits on which, how healthy it is, and
 * the way to wipe the lot.
 *
 * The pages themselves are no longer made or edited here. GameChanger owns them — a 9U schedule
 * lands on the 9U page whether or not anybody made it first — so a form for creating, renaming,
 * advancing and deleting them was a second owner of the same thing, and the only question it
 * really answered (which league season plays at which age) is asked once, above.
 */
export function SetupSection({
  seasons,
  ageGroups,
  onAssignSeason,
  yearOptions,
  teamCount,
  gameCount,
  onDownloadBackup,
  onReset,
  poolHealth,
  modelCheck,
}: SetupSectionProps) {
  /*
   * The pages this card has anything to say about.
   *
   * A nationwide pull makes a page per age per squad year — twenty-two of them, and one league
   * season between the lot. The list was twenty-one rows of "No league season on this page" and a
   * single row that mattered, which is the opposite of what a list is for. Nothing is made
   * unreachable by leaving them out: the pages are where the rankings live and nothing here creates
   * or manages them, and a season is attached through the question above rather than from a row.
   *
   * Carried-forward pages stay, season or not — "continues 8U 2026" is a thing somebody chose, and
   * the only place it is written down.
   */
  const worthListing = ageGroups.filter(
    (group) => group.seasonIds.length > 0 || group.continuesFromId
  );
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
          GameChanger makes these, and owns them: a 9U schedule lands on the 9U page, and answering
          the question above puts your league season on one. There is nothing to manage here — a
          page exists exactly when something is filed on it.
        </p>
        {ageGroups.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            None yet. Pull a team list from GameChanger and the pages make themselves.
          </p>
        ) : worthListing.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            {ageGroups.length} page{ageGroups.length === 1 ? "" : "s"}, none with a league season on
            it. Answer the question above to put one somewhere.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
            {worthListing.map((group) => (
              <li key={group.id} className="flex flex-wrap items-baseline gap-2 py-2 text-sm">
                <span className="font-bold text-slate-950 dark:text-white">{group.name}</span>
                <span className="text-slate-500">
                  {group.seasonIds.length
                    ? group.seasonIds
                        .map((id) => seasons.find((s) => s.id === id)?.name ?? id)
                        .join(", ")
                    : "No league season on this page"}
                  {group.continuesFromId
                    ? ` · continues ${
                        ageGroups.find((g) => g.id === group.continuesFromId)?.name ??
                        "an age group that no longer exists"
                      }`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
        {worthListing.length > 0 && worthListing.length < ageGroups.length && (
          <p className="mt-2 text-xs text-slate-500">
            and {ageGroups.length - worthListing.length} more with no league season and nothing
            carried forward. They are still pages — this card only has something to say about the
            ones above.
          </p>
        )}
      </div>

      <PoolHealthCard
        pool={poolHealth.pool}
        tidyStamp={poolHealth.tidyStamp}
        onTidied={poolHealth.onTidied}
      />

      <ModelCheckCard
        ageGroupId={modelCheck.ageGroupId}
        groupName={modelCheck.groupName}
        teams={modelCheck.teams}
        games={modelCheck.games}
        ageGroups={ageGroups}
      />

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
