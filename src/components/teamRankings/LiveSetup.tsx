import { useMemo } from "react";
import type { Confirmation } from "../../hooks/useConfirmation";
import type { LiveEdits } from "../../hooks/useLiveEdits";
import type { PoolCommand } from "../../lib/live/commands";
import { overlayGroups, seasonAssignedSaid } from "../../lib/live/groupsOverlay";
import type { SeasonMeta } from "../../lib/storage";
import type { AgeGroup, AgeGroupSeason, ScoutGame, ScoutTeam } from "../../lib/teamRankings";
import { ageGroupYear, createAgeGroupId, seasonYearOptions } from "../../lib/teamRankings/seasons";
import { button, card } from "../../styles/tokens";

const NO_TEAMS: ScoutTeam[] = [];
const NO_GAMES: ScoutGame[] = [];
const NO_GROUPS: AgeGroup[] = [];

/** Said when the server has no such page to check. */
export const PAGE_NOT_ON_COPY = "That age group is not on the cloud's copy any more.";
/** Under the model check's button when the server's answer did not come. */
export const CHECK_UNANSWERED = "No answer came back, for the reason just shown.";
import { DiagnosticsCard } from "./DiagnosticsCard";
import { LeagueSeasonsCard } from "./LeagueSeasonsCard";
import { LiveAgelessCard } from "./LiveAgelessCard";
import { LiveArchiveCard } from "./LiveArchiveCard";
import { LivePoolHealthCard } from "./LivePoolHealthCard";
import { ModelCheckCard } from "./ModelCheckCard";
import { AgeGroupsCard, SetupIntroCard } from "./SetupCards";

/**
 * Setup on the live page (1.5), card for card as the device's Setup draws it, from the cloud's
 * pool: the league seasons put on its pages, or taken off, as edits sent to the edit function; the
 * pages that hold anything; the teams waiting on an age and Pool health from the server's lists;
 * the model check of the page open, worked out on the server (`model.check`); and this browser's
 * own diagnostics. The pages are the cloud's (`groups`, the ones its last publish carries) with
 * the edits made here drawn over them until a publish carries those too, so a season put on a page
 * shows there at once. Archiving a year and starting again are opened on this device's copy until
 * each is live too, by asking for it: the page hands over to Team Rankings there, on Setup.
 */
export default function LiveSetup({
  edits,
  confirm,
  today,
  pageId,
  groupName,
  groups,
  seasons,
  onOpenTeam,
  onRestWanted,
}: {
  edits: LiveEdits;
  confirm: Confirmation["request"];
  today: string;
  /** The page open on the board, which the model check is of. */
  pageId: string;
  groupName: string;
  /** The cloud's pages as its last publish carries them. */
  groups: readonly AgeGroup[];
  /** League Standings' seasons, which the league seasons card asks about. */
  seasons: SeasonMeta[];
  /** Opens a club's panel, in the squad year its row is of where it says one. */
  onOpenTeam: (teamId: string, year?: number) => void;
  /** Opens the rest of Setup on this device's copy. */
  onRestWanted: () => void;
}) {
  const { pending, edit, ask, say } = edits;
  const shown = useMemo(
    () =>
      overlayGroups(
        groups,
        pending.map(({ command }) => command)
      ),
    [groups, pending]
  );
  const yearOptions = useMemo(() => seasonYearOptions(shown), [shown]);

  /*
   * Unlike the device's card, the page is not opened on the season's page afterwards: a page the
   * edit makes is not among the board's tabs until this device's copy has it, and Setup is where
   * the person asked from.
   */
  const assign = (seasonId: string, season: AgeGroupSeason | null) => {
    const command: Extract<PoolCommand, { kind: "season.assign" }> = {
      kind: "season.assign",
      seasonId,
      season,
      pageId: createAgeGroupId(),
    };
    void edit(command, { done: seasonAssignedSaid(shown, command) });
  };

  /*
   * The whole check in one question: twelve fits of the page's year, 15.1 s on 12U of 29
   * September (`npm run live:bench`), on the server's pool with the copy's League Standings
   * seasons in it, as the boards were fitted. Nothing else is edited on the server meanwhile, as
   * with a what-if.
   */
  const checkModel = async () => {
    const asked = await ask({ kind: "model.check", page: pageId });
    if (!asked) return null;
    if (!asked.answer) say(PAGE_NOT_ON_COPY);
    return asked.answer;
  };

  return (
    <>
      <SetupIntroCard />
      <LeagueSeasonsCard
        seasons={seasons}
        ageGroups={shown}
        yearOptions={yearOptions}
        onAssign={assign}
      />
      <AgeGroupsCard ageGroups={shown} seasons={seasons} />
      <LiveAgelessCard edits={edits} confirm={confirm} today={today} />
      <LivePoolHealthCard edits={edits} confirm={confirm} today={today} onOpenTeam={onOpenTeam} />
      {/* The pool is the server's, so the card is given none of its own to check on the page. */}
      <ModelCheckCard
        ageGroupId={pageId}
        groupName={groupName}
        teams={NO_TEAMS}
        games={NO_GAMES}
        ageGroups={NO_GROUPS}
        check={checkModel}
        unanswered={CHECK_UNANSWERED}
      />
      <LiveArchiveCard
        edits={edits}
        confirm={confirm}
        currentYear={ageGroupYear(shown.find((group) => group.id === pageId))}
      />
      <DiagnosticsCard />
      <div className={`${card} p-5`}>
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
          The rest of Setup
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Starting again opens on this device&apos;s copy for now.
        </p>
        <button type="button" onClick={onRestWanted} className={`${button.ghost} mt-3`}>
          Open them on this device&apos;s copy
        </button>
      </div>
    </>
  );
}
