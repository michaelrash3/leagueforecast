import { type Dispatch, type SetStateAction, useCallback, useState } from "react";
import type { GcIdOffer } from "../components/TeamSearchSelect";
import type { AutoRemovals } from "../lib/autoRemoved";
import { clubSearchGames } from "../lib/clubSearch";
import type { DeletedClubs } from "../lib/deletedGames";
import { BROUGHT_BACK, whereIsGcId } from "../lib/gcIdWhereabouts";
import type { AllKnown } from "../lib/live/allKnown";
import type { PoolCommand } from "../lib/live/commands";
import type { CommandRun } from "../lib/live/runPoolCommand";
import type { RankingsSection } from "../lib/rankingsRoute";
import { removedDays } from "../lib/removedClubs";
import {
  type AgeGroup,
  ageGroupYear,
  mergeScoutTeams,
  type ScoutTeam,
  type SeasonSegment,
} from "../lib/teamRankings";
import { loadAgeUnknown, loadScoutGames, loadTooYoungClubs } from "../lib/teamRankingsStorage";
import { useClubSearch } from "./useClubSearch";
import type { useConfirmation } from "./useConfirmation";
import type { useToast } from "./useToast";

/**
 * Find a team, and what comes off it: the search over every club and every game it can land on;
 * where a pasted GameChanger id is when no club there carries it; a club thrown out, brought back;
 * one club merged into another; and going to the page a club is on, from the search or from a list
 * further up the page. With them, what games added put right on the clubs they name that the
 * roster already holds (`heldHeals`, `withHeals`), which adding a game reads too.
 *
 * TeamRankingsView.tsx did all of this among its other handlers. It moved here whole and is called
 * where it was, so its state, memos and the search hook it calls keep their place among the view's.
 */
export type FindTeamInputs = {
  ageGroups: AgeGroup[];
  allKnown: AllKnown;
  autoRemoved: AutoRemovals;
  droppedClubs: DeletedClubs;
  openClub: (teamId: string) => void;
  openPage: (groupId: string, half?: SeasonSegment) => void;
  pullLive: boolean;
  rankedTeams: ScoutTeam[];
  requestConfirmation: ReturnType<typeof useConfirmation>["request"];
  restoreDroppedClub: (teamId: string) => boolean;
  runCommand: (
    command: PoolCommand,
    options?: { quiet?: boolean; explains?: boolean }
  ) => CommandRun;
  scoutTeams: ScoutTeam[];
  section: RankingsSection;
  setOpenTeamId: Dispatch<SetStateAction<string | null>>;
  settledRevision: number;
  showToast: ReturnType<typeof useToast>["show"];
};

export function useFindTeam({
  ageGroups,
  allKnown,
  autoRemoved,
  droppedClubs,
  openClub,
  openPage,
  pullLive,
  rankedTeams,
  requestConfirmation,
  restoreDroppedClub,
  runCommand,
  scoutTeams,
  section,
  setOpenTeamId,
  settledRevision,
  showToast,
}: FindTeamInputs) {
  /** The clubs of a pair League Standings made that the roster does not hold, to join it. */
  const unheldOf = (...ids: string[]): ScoutTeam[] =>
    ids.flatMap((id) =>
      scoutTeams.some((team) => team.id === id)
        ? []
        : allKnown.teams.filter((team) => team.id === id)
    );

  /**
   * What games added put right on the clubs they name that the roster already holds: a name the
   * lookup cleaned of an age label it was stored with (`resolveOrCreateTeam`), and a state the
   * schedule import filled in from its file where the club had none (it never replaces one). Only
   * those two, laid over the club as stored, so nothing else League Standings worked out for it on
   * the fly is written; and only on the clubs the games name, so a club the add did not touch is
   * not written for a name the walk cleaned on its own.
   */
  const heldHeals = (next: readonly ScoutTeam[], named: ReadonlySet<string>): PoolCommand[] =>
    next.flatMap((team): PoolCommand[] => {
      if (!named.has(team.id)) return [];
      const was = scoutTeams.find((held) => held.id === team.id);
      if (!was || (was.name === team.name && was.state === team.state)) return [];
      const state = team.state === undefined ? {} : { state: team.state };
      return [{ kind: "team.put", team: { ...was, name: team.name, ...state } }];
    });

  /** Games added, with the heals of the held clubs they name, as one change. */
  const withHeals = (heals: PoolCommand[], add: PoolCommand): PoolCommand =>
    heals.length === 0 ? add : { kind: "batch", commands: [...heals, add] };

  const mergeInto = async (fromId: string, intoId: string): Promise<boolean> => {
    const from = allKnown.teams.find((team) => team.id === fromId);
    const into = allKnown.teams.find((team) => team.id === intoId);
    if (!from || !into) return false;
    const preview = mergeScoutTeams(fromId, intoId, scoutTeams, loadScoutGames(), ageGroups);
    const confirmed = await requestConfirmation({
      title: `Fold ${from.name} into ${into.name}?`,
      message: `Every game moves to ${into.name} and ${from.name} is removed.${
        preview.droppedGames > 0
          ? ` ${preview.droppedGames} game${preview.droppedGames === 1 ? "" : "s"} between the two cannot survive the merge and will be dropped.`
          : ""
      }`,
      confirmLabel: "Fold in",
    });
    if (!confirmed) return false;
    const run = runCommand({
      kind: "teams.merge",
      fromId,
      intoId,
      adopt: unheldOf(fromId, intoId),
    });
    if (!run.ok) return false;
    setOpenTeamId(intoId);
    showToast(`Folded into ${into.name}.`, { tone: "success" });
    return true;
  };

  /**
   * Every game the search can land on: the league's derived fixtures and every stored year, read
   * when the index is built. Stable across renders so the index is rebuilt on a change, not a render.
   */
  const everyKnownGame = useCallback(
    () => clubSearchGames(allKnown.derivedGames, loadScoutGames(), allKnown.teams, ageGroups),
    [allKnown.derivedGames, allKnown.teams, ageGroups]
  );
  /**
   * Where a GameChanger id pasted into Find a team is when no club there carries it (`whereIsGcId`).
   * Read when asked rather than kept: it is asked only of an id nothing matched, and the lists it
   * reads are cached in memory already.
   */
  const [broughtBack, setBroughtBack] = useState<ReadonlySet<string>>(() => new Set());
  const explainGcId = useCallback(
    (gcTeamId: string) =>
      broughtBack.has(gcTeamId) && !droppedClubs.has(gcTeamId)
        ? BROUGHT_BACK
        : whereIsGcId(gcTeamId, {
            ...(pullLive ? { liveTeams: scoutTeams } : {}),
            ageless: loadAgeUnknown(),
            dropped: droppedClubs,
            tooYoung: loadTooYoungClubs(),
            removed: removedDays(autoRemoved),
          }),
    [pullLive, scoutTeams, droppedClubs, autoRemoved, broughtBack]
  );
  /** A club thrown out, brought back from Find a team, as the live page's does (with Undo). */
  const offerForGcId = useCallback(
    (gcTeamId: string): GcIdOffer | undefined =>
      droppedClubs.has(gcTeamId)
        ? {
            label: "Bring it back",
            run: () => {
              if (!restoreDroppedClub(gcTeamId)) return;
              setBroughtBack((was) => new Set([...was, gcTeamId]));
              showToast(BROUGHT_BACK, {
                tone: "undo",
                actionLabel: "Undo",
                onAction: () =>
                  void runCommand({
                    kind: "answers",
                    list: "droppedClubs",
                    add: [gcTeamId],
                    remove: [],
                  }),
              });
            },
          }
        : undefined,
    [droppedClubs, restoreDroppedClub, showToast, runCommand]
  );
  const { searchOptions, pageOf, mergeCandidatesFor } = useClubSearch({
    teams: allKnown.teams,
    games: everyKnownGame,
    ageGroups,
    rankedTeams,
    /*
     * Not rebuilt while a pull is running, and that is the expensive half of this.
     *
     * Rebuilding the index reads every stored year and walks every team against every game, and a
     * pull runs from Import, where the index is on, so every save during a run rebuilt the whole
     * thing. The revision is not enough to stop it, because a save hands back new `teams` and
     * `ageGroups` arrays and the index follows those by identity, as it should.
     *
     * It used to be switched off for the run instead, which took the Find a team box off the top
     * of Rankings for as long as a pull went on, an hour and more on a nationwide list, with
     * nothing to say why: the user asked where it had gone on 28 September 2026. Held, the box
     * stays and searches the pool as it stood when the run began, and the index is built once
     * more when the run lets go.
     */
    enabled: section !== "setup",
    hold: pullLive,
    revision: settledRevision,
  });

  /** Goes to the page a team is on and opens it, whichever season and level that turns out to be. */
  const openSearchedTeam = (teamId: string) => {
    const page = pageOf(teamId);
    if (page) openPage(page.ageGroupId);
    openClub(teamId);
  };

  /**
   * The same, from a list further up the page, Pool health's: the panel opens below everything,
   * out of sight of the list, so it is brought into view once it is there.
   */
  const openListedTeam = (
    teamId: string,
    _year?: number,
    pageId?: string,
    segment?: SeasonSegment
  ) => {
    /*
     * The page the row names, where it names one: a leader with few outside games is listed off one
     * page's board, and a club entered by hand has no GameChanger id to find a page by. Otherwise,
     * since the search's page index is not built in Setup, where these lists are, the page is the
     * one a GameChanger id of the club's own is filed under, the latest year's: opened on another
     * page, the panel showed none of the games the list had named. A page holds its year, so the
     * row's year says nothing more here. The row's half goes with its page only (`openPage`).
     */
    const page =
      (pageId !== undefined && ageGroups.some((group) => group.id === pageId)
        ? pageId
        : undefined) ??
      pageOf(teamId)?.ageGroupId ??
      allKnown.teams
        .find((known) => known.id === teamId)
        ?.gcTeams?.map((link) => ageGroups.find((group) => group.id === link.ageGroupId))
        .filter((group): group is AgeGroup => group !== undefined)
        .sort((a, b) => (ageGroupYear(b) ?? 0) - (ageGroupYear(a) ?? 0))[0]?.id;
    if (page) openPage(page, page === pageId ? segment : undefined);
    openClub(teamId);
  };

  return {
    explainGcId,
    heldHeals,
    mergeCandidatesFor,
    mergeInto,
    offerForGcId,
    openListedTeam,
    openSearchedTeam,
    searchOptions,
    unheldOf,
    withHeals,
  };
}
