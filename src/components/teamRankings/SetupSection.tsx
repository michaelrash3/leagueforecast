import {
  type AgeGroup,
  type AgeGroupSeason,
  type ScoutGame,
  type ScoutTeam,
} from "../../lib/teamRankings";
import type { SeasonMeta } from "../../lib/storage";
import { LeagueSeasonsCard } from "./LeagueSeasonsCard";
import type { ModelCheckAnswer } from "../../lib/scoutBacktest";
import { ModelCheckCard } from "./ModelCheckCard";
import { PoolHealthCard } from "./PoolHealthCard";
import type { BulkAgeResult, GamesDropped } from "./PoolHealthView";
import { AgelessReviewCard } from "./AgelessReviewCard";
import type { AgelessAnswered } from "../../lib/agelessTriage";
import type { AgeUnknownList } from "../../lib/ageUnknown";
import type { NamedAges } from "../../lib/namedAges";
import type { DeletedClubs } from "../../lib/deletedGames";
import type { UnrealClub } from "../../lib/unrealClubs";
import type { GcImportState } from "../../lib/gameChangerImport";
import type { TidyOutcome } from "../../hooks/usePoolTidy";
import type { PoolCommand } from "../../lib/live/commands";
import type { CommandRun } from "../../lib/live/runPoolCommand";
import { ResetRankingsCard } from "./ResetRankingsCard";
import { ArchiveSeasonCard, type ArchivableYear } from "./ArchiveSeasonCard";
import { DiagnosticsCard } from "./DiagnosticsCard";
import { AgeGroupsCard, SetupIntroCard } from "./SetupCards";

type SetupSectionProps = {
  seasons: SeasonMeta[];
  ageGroups: AgeGroup[];
  /** Puts a League Standings season at an age, or takes it off with `null`. */
  onAssignSeason: (seasonId: string, season: AgeGroupSeason | null) => void;
  yearOptions: number[];
  teamCount: number;
  gameCount: number;
  onDownloadBackup: () => void;
  /** When the pool was last backed up from this browser; null for never. */
  lastBackupAt: string | null;
  onReset: () => void;
  /**
   * The teams nobody could age, and the two ways to answer for one.
   *
   * Beside Pool Health rather than in the import panel: this is a sitting somebody does with
   * GameChanger open in another tab, not something glanced at while a pull runs.
   */
  ageless: {
    list: AgeUnknownList;
    named: NamedAges;
    dropped: DeletedClubs;
    onNameAge: (teamId: string, name: string | undefined, level: number) => void;
    onThrowOut: (teamId: string, name: string | undefined) => Promise<boolean> | boolean;
    /** Takes back a named age or a throw-out, for a team found by searching. */
    onUndo: (teamId: string, name: string | undefined) => void;
    /** Clears in one pass the rows a rule has settled; see `CLEARABLE_RULES`. */
    onClearRows: (rows: readonly AgelessAnswered[]) => Promise<boolean> | boolean;
    now: Date;
  };
  /** The whole stored pool, its tidy stamp, and where to put it back once tidied. */
  poolHealth: {
    pool: GcImportState;
    tidyStamp: string;
    onTidied: (outcome: TidyOutcome) => void;
    onMergeTeams: (fromTeamId: string, intoTeamId: string) => Promise<boolean>;
    /** Throws these rows out and remembers them, so a re-pull does not file them again. */
    onDropGames: (ids: readonly string[], why?: GamesDropped) => Promise<boolean>;
    onConfirmScore: (gameId: string) => Promise<boolean>;
    /** Throws a club out: the team, its rows, and its GameChanger ids. */
    onDropClub: (club: UnrealClub) => Promise<boolean>;
    /** Opens a club's own panel from a list the card shows. */
    onOpenTeam: (teamId: string) => void;
    /** Files a club at another level in a squad year and holds it there; whether it happened. */
    onSetAge?: (teamId: string, level: number, year: number) => boolean;
    onSetAges?: (
      clubs: readonly import("../../lib/wrongAge").WrongAgeClub[]
    ) => Promise<BulkAgeResult | null>;
    /** Runs a command as the page runs every edit, saying so when the store refuses it. */
    runCommand: (command: PoolCommand) => CommandRun;
  };
  /** The years that could be frozen or deleted, and the one the app is showing as current. */
  archive: {
    years: ArchivableYear[];
    currentYear: number | undefined;
    busy: boolean;
    onArchive: (year: number) => void;
    onDelete: (year: number) => void;
  };
  /** Everything the model check needs to refit this page's pool on demand. */
  modelCheck: {
    ageGroupId: string;
    groupName: string;
    teams: ScoutTeam[];
    games: ScoutGame[];
    /** The check in the rankings worker; see `ModelCheckCard`. */
    check?: () => Promise<ModelCheckAnswer | null>;
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
  ageless,
  seasons,
  ageGroups,
  onAssignSeason,
  yearOptions,
  teamCount,
  gameCount,
  onDownloadBackup,
  lastBackupAt,
  onReset,
  poolHealth,
  archive,
  modelCheck,
}: SetupSectionProps) {
  return (
    <>
      <SetupIntroCard />

      <LeagueSeasonsCard
        seasons={seasons}
        ageGroups={ageGroups}
        yearOptions={yearOptions}
        onAssign={onAssignSeason}
      />

      <AgeGroupsCard ageGroups={ageGroups} seasons={seasons} />

      <AgelessReviewCard
        ageless={ageless.list}
        named={ageless.named}
        dropped={ageless.dropped}
        onNameAge={ageless.onNameAge}
        onThrowOut={ageless.onThrowOut}
        onUndo={ageless.onUndo}
        onClearRows={ageless.onClearRows}
        now={ageless.now}
      />

      <PoolHealthCard
        pool={poolHealth.pool}
        tidyStamp={poolHealth.tidyStamp}
        onTidied={poolHealth.onTidied}
        onMergeTeams={poolHealth.onMergeTeams}
        onDropGames={poolHealth.onDropGames}
        onDropClub={poolHealth.onDropClub}
        onConfirmScore={poolHealth.onConfirmScore}
        onOpenTeam={poolHealth.onOpenTeam}
        onSetAge={poolHealth.onSetAge}
        onSetAges={poolHealth.onSetAges}
        runCommand={poolHealth.runCommand}
      />

      <ModelCheckCard
        ageGroupId={modelCheck.ageGroupId}
        groupName={modelCheck.groupName}
        teams={modelCheck.teams}
        games={modelCheck.games}
        ageGroups={ageGroups}
        {...(modelCheck.check ? { check: modelCheck.check } : {})}
      />

      <DiagnosticsCard />

      <ArchiveSeasonCard
        years={archive.years}
        currentYear={archive.currentYear}
        busy={archive.busy}
        onArchive={archive.onArchive}
        onDelete={archive.onDelete}
      />

      <ResetRankingsCard
        ageGroupCount={ageGroups.length}
        teamCount={teamCount}
        gameCount={gameCount}
        onDownloadBackup={onDownloadBackup}
        lastBackupAt={lastBackupAt}
        onReset={onReset}
      />
    </>
  );
}
