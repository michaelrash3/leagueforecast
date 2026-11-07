import { useCallback, useMemo } from "react";
import {
  agelessClearedPass,
  clearedIds,
  describeCleared,
  isClearedReason,
  restoreCleared,
} from "../lib/agelessCleared";
import type { AgelessAnswered } from "../lib/agelessTriage";
import { type AgeUnknownList, forgetAgeless } from "../lib/ageUnknown";
import type { AllKnown } from "../lib/live/allKnown";
import type { PoolCommand } from "../lib/live/commands";
import type { CommandRun } from "../lib/live/runPoolCommand";
import type { RankingsSection } from "../lib/rankingsRoute";
import type { RemovedClub } from "../lib/removedForYou";
import { type AgeGroup, ageGroupYear, type ScoutGame } from "../lib/teamRankings";
import {
  clearAgelessCleared,
  loadAgelessCleared,
  loadAgeUnknown,
  saveAgelessCleared,
  saveAgeUnknown,
} from "../lib/teamRankingsStorage";
import type { UnrealClub } from "../lib/unrealClubs";
import type { useConfirmation } from "./useConfirmation";
import type { useToast } from "./useToast";

/** Referentially stable, so the card's own memos do not re-run when Setup is closed. */
const NO_AGELESS: AgeUnknownList = [];

/**
 * The answers Team Rankings takes about clubs the pool is unsure of: a lopsided score confirmed as
 * played; a club nobody could age given an age, thrown out, or the answer taken back, one at a
 * time or a whole pass; the rows a rule has settled cleared in one pass; a club that may not be
 * real deleted, ids and all; and the clubs a sweep took off as made up put back or deleted for
 * good, one at a time or a night's at once. Each is one command to the pool and one step to undo.
 *
 * TeamRankingsView.tsx did all of this among its other handlers. It moved here whole and is called
 * where it was, so its memos and callbacks keep their place among the view's.
 */
export type PoolAnswersInputs = {
  ageGroups: AgeGroup[];
  allKnown: AllKnown;
  requestConfirmation: ReturnType<typeof useConfirmation>["request"];
  runCommand: (
    command: PoolCommand,
    options?: { quiet?: boolean; explains?: boolean }
  ) => CommandRun;
  section: RankingsSection;
  showToast: ReturnType<typeof useToast>["show"];
  wholePoolGames: ScoutGame[];
};

export function usePoolAnswers({
  ageGroups,
  allKnown,
  requestConfirmation,
  runCommand,
  section,
  showToast,
  wholePoolGames,
}: PoolAnswersInputs) {
  /**
   * Takes the user's word that a game won by `ASK_MARGIN` runs or more really was
   * played that way (`ScoutGame.scoreConfirmed`). Nothing to ask first: it is undone by deleting
   * the game, and it asks only that the rating believe a score the user has looked at.
   */
  const confirmScore = async (gameId: string): Promise<boolean> => {
    const game = wholePoolGames.find((entry) => entry.id === gameId);
    if (!game) return false;
    // The game's own year alone: the rest of the pool is as it was.
    const year = ageGroupYear(ageGroups.find((group) => group.id === game.ageGroupId)) ?? null;
    if (!runCommand({ kind: "game.confirm", year, gameId }).ok) return false;
    const nameOf = (id: string) => allKnown.teams.find((team) => team.id === id)?.name ?? id;
    showToast(
      `${nameOf(game.teamAId)} ${game.teamAScore}–${game.teamBScore} ${nameOf(game.teamBId)} counts now.`,
      { tone: "success" }
    );
    return true;
  };

  /**
   * Throws a club out: the team, every row it is in, and its GameChanger ids.
   *
   * The ids are what makes it stick. Without them the next pull reads the same schedule, rebuilds
   * the team from its profile and files a fresh set of the very rows that were deleted — so the
   * club has to be refused at the schedule, which is what `isDeletedClub` does in `importOne`.
   */
  /**
   * The teams nobody could age, and the two ways to answer for one.
   *
   * Held in state as well as storage because both answers change what the review card shows on
   * the spot — naming an age or throwing a club out takes that row out of the queue immediately,
   * without waiting for a refresh to notice.
   */
  /*
   * Re-read when Setup is opened rather than held in state: the import panel is what writes this
   * list, and a copy taken at mount would be the pool as it was before the pull that filled it.
   */
  const agelessList: AgeUnknownList = useMemo(
    () => (section === "setup" ? loadAgeUnknown() : NO_AGELESS),
    [section]
  );

  const nameAgeFor = useCallback(
    (teamId: string, name: string | undefined, level: number) => {
      // What GameChanger was saying when it was named, so a later change to its own page can be
      // told apart from the silence this is filling in — see `namedAgeStands`.
      const run = runCommand({
        kind: "namedAges",
        put: [{ teamId, level, ...(name ? { name } : {}), namedAt: new Date().toISOString() }],
        forget: [],
      });
      if (run.ok)
        showToast(`${name ?? teamId} is ${level}U. It will be filed on the next refresh.`);
    },
    [runCommand, showToast]
  );

  /** Puts a thrown-out club back, which is the whole of what the toast's undo has to do. */
  const restoreDroppedClub = useCallback(
    (teamId: string) =>
      runCommand({ kind: "answers", list: "droppedClubs", add: [], remove: [teamId] }).ok,
    [runCommand]
  );

  /**
   * Throwing out a team nobody could age. No confirmation; an undo on the toast instead.
   *
   * This is a queue worked ten at a time, and most of what is on it is junk that takes a second
   * to recognise — a page with three 20-0 wins on days that have not happened is thrown out on
   * sight. A dialog in front of every one of those is a second click on the common case to guard
   * against the rare one, which is the wrong way round: the guard belongs after the action, where
   * it costs nothing unless it is needed.
   *
   * Safe to do without asking because nothing is destroyed. The club was never filed — there is
   * nothing of it in the pool to delete — so this writes an id to a list, and the undo takes it
   * straight back off. A team that gets past the toast is still findable by name on this card,
   * which is the second way back.
   */
  const throwOutAgeless = useCallback(
    (teamId: string, name: string | undefined): boolean => {
      if (!runCommand({ kind: "answers", list: "droppedClubs", add: [teamId], remove: [] }).ok)
        return false;
      /*
       * And off the waiting list, rather than leaving the row for a later pull to clean up. The
       * row only ever left on a pull that came back with something other than "no age", so a
       * thrown-out club sat there until it was fetched again — two requests to learn a thing
       * somebody had already said. The undo below puts the id back on the queue by restoring the
       * club; the row itself returns on the next pull that reaches the team.
       */
      const waiting = forgetAgeless(loadAgeUnknown(), [teamId]);
      saveAgeUnknown(waiting);
      showToast(`${name ?? teamId} thrown out.`, {
        tone: "undo",
        actionLabel: "Undo",
        onAction: () => restoreDroppedClub(teamId),
      });
      return true;
    },
    [runCommand, showToast, restoreDroppedClub]
  );

  /**
   * Taking back an answer about a team nobody could age.
   *
   * Both stores are cleared rather than the one the reader happened to be looking at, because a
   * team can be in both — named in March and thrown out in May — and an undo that left it in the
   * other would look like it had done nothing. Deleting an id that is not there costs nothing.
   *
   * There was no way to do this at all until the search made these teams visible: both answers
   * were one-way from the UI, and a reader could see the mistake and not fix it.
   */
  const undoAgelessAnswer = useCallback(
    (teamId: string, name: string | undefined) => {
      const run = runCommand({
        kind: "batch",
        commands: [
          { kind: "answers", list: "droppedClubs", add: [], remove: [teamId] },
          { kind: "namedAges", put: [], forget: [teamId] },
        ],
      });
      if (run.ok) showToast(`${name ?? teamId} is back on the queue.`);
    },
    [runCommand, showToast]
  );

  /**
   * Taking back a whole pass, after the toast that offered it has gone.
   *
   * The rows come back from the stored pass rather than from a pull, which is the only reason a
   * bulk clear is safe to offer at all: a team refused at the door was never filed, so the row on
   * the waiting list is the only record that it was ever asked about. Undoing by re-fetching
   * would cost two requests a team to learn what was already known.
   */
  const undoClearedPass = useCallback(async () => {
    const pass = await loadAgelessCleared();
    if (!pass) {
      showToast("That pass is no longer stored, so there is nothing to put back.", {
        tone: "error",
      });
      return;
    }
    const ids = clearedIds(pass);
    if (!runCommand({ kind: "answers", list: "droppedClubs", add: [], remove: ids }).ok) return;
    saveAgeUnknown(restoreCleared(loadAgeUnknown(), pass));
    await clearAgelessCleared();
    showToast(`${describeCleared(pass)} back on the list.`);
  }, [runCommand, showToast]);

  /**
   * Clearing the rows a rule has settled, in one pass: GameChanger's own answers, and the rules the
   * user settled — named void, tee ball and younger, rec ball in a closed league.
   *
   * Asks first, where the single throw-out deliberately does not. The argument there is that a
   * dialog in front of the common case costs a click to guard against the rare one; here the
   * action *is* the rare one, thousands of rows at once, and nobody can check it by eye
   * afterwards. So the dialog says how many each rule is clearing.
   *
   * One write per store rather than one per row: `forgetClubs` and `forgetAgeless` both take
   * arrays, so twenty thousand teams is two writes and one render, not forty thousand. The rows
   * are stored whole before they go, which is what makes the undo real rather than a toast
   * somebody had to catch.
   */
  const clearAgelessRows = useCallback(
    async (chosen: readonly AgelessAnswered[]): Promise<boolean> => {
      const rows = chosen.flatMap(({ row, rule, verdict }) =>
        isClearedReason(verdict.kind) ? [{ row, rule, why: verdict.kind }] : []
      );
      if (rows.length === 0) return false;
      const byRule = new Map<string, { label: string; count: number }>();
      rows.forEach(({ rule }) => {
        const known = byRule.get(rule.id);
        if (known) known.count += 1;
        else byRule.set(rule.id, { label: rule.label, count: 1 });
      });
      const breakdown = [...byRule.values()]
        .map(({ label, count }) => `${count.toLocaleString()}: ${label}`)
        .join("\n");
      const confirmed = await requestConfirmation({
        title: `Clear ${rows.length.toLocaleString()} teams?`,
        message:
          `${breakdown}\n\n` +
          "They leave the list and no later pull asks about them again. Nothing in the pool is " +
          "touched, and the pass can be undone afterwards.",
        confirmLabel: "Clear them",
      });
      if (!confirmed) return false;

      const ids = rows.map(({ row }) => row.teamId);
      // Stored before anything is removed: a pass that cannot be undone must not have happened.
      const pass = agelessClearedPass(
        rows.map(({ row, why }) => ({ entry: row, why })),
        new Date().toISOString()
      );
      const kept = await saveAgelessCleared(pass);

      if (!runCommand({ kind: "answers", list: "droppedClubs", add: ids, remove: [] }).ok)
        return false;
      saveAgeUnknown(forgetAgeless(loadAgeUnknown(), ids));

      showToast(
        `${rows.length.toLocaleString()} teams cleared.` +
          (kept ? "" : " The undo could not be stored, so this one cannot be taken back."),
        kept
          ? { tone: "undo", actionLabel: "Undo", onAction: () => void undoClearedPass() }
          : { tone: "error" }
      );
      return true;
    },
    [runCommand, showToast, requestConfirmation, undoClearedPass]
  );

  /**
   * Deletes a club off the list of clubs that may not be real: the club, every row it is in, and
   * its GameChanger ids, which a later pull then refuses. At once, without asking: the user, going
   * down a list of 9,999-0 winners, said on 28 September 2026 to take the dialog away and that they
   * would take their chances.
   */
  const dropClub = async (club: UnrealClub): Promise<boolean> => {
    // The club, every game it is in, the rows they stood on and its GameChanger ids (`club.drop`);
    // the ids reach the view's own list too, so a list pasted in this session skips it.
    if (!runCommand({ kind: "club.drop", teamId: club.teamId }).ok) return false;
    showToast(`Deleted ${club.name}.`, { tone: "success" });
    return true;
  };

  /**
   * Puts a club the sweep took off as plainly made up back on the boards (`autoRemoved.ts`): its
   * marks forgotten and its ids said to be real, so no later sweep takes it again. Undo on the
   * toast puts both back as they were.
   */
  const putBackRemoved = (club: RemovedClub): boolean => {
    const run = runCommand({
      kind: "batch",
      commands: [
        { kind: "autoRemoved", put: [], forget: club.gcTeamIds },
        { kind: "answers", list: "realClubs", add: club.gcTeamIds, remove: [] },
      ],
    });
    if (!run.ok) return false;
    showToast(`${club.name} is back on the boards, kept as real.`, {
      tone: "undo",
      actionLabel: "Undo",
      onAction: () => runCommand(run.inverse),
    });
    return true;
  };

  /**
   * Puts back every club one day's sweep took off (`autoRemoved.ts`): their marks forgotten and
   * nothing said of them, so the next sweep takes off again any still showing its sign. How a sweep
   * that went wrong is taken back as a whole. Undo on the toast puts the marks back.
   */
  const putBackRemovedOn = (day: string, clubs: readonly RemovedClub[]): boolean => {
    const run = runCommand({
      kind: "autoRemoved",
      put: [],
      forget: clubs.flatMap((club) => club.gcTeamIds),
    });
    if (!run.ok) return false;
    const many = clubs.length === 1 ? "1 club" : `${clubs.length.toLocaleString()} clubs`;
    showToast(`${many} taken off on ${day} back on the boards.`, {
      tone: "undo",
      actionLabel: "Undo",
      onAction: () => runCommand(run.inverse),
    });
    return true;
  };

  /** Deletes a club the sweep took off for good, as Delete club does, with Undo on the toast. */
  const deleteRemoved = (club: RemovedClub): boolean => {
    const run = runCommand({ kind: "club.drop", teamId: club.teamId });
    if (!run.ok) return false;
    showToast(`Deleted ${club.name} for good.`, {
      tone: "undo",
      actionLabel: "Undo",
      onAction: () => runCommand(run.inverse),
    });
    return true;
  };

  /**
   * Deletes for good the clubs a sweep took off that are still listed, one night's or every
   * night's, as Delete club does each: once the ones worth keeping are put back, the rest in one
   * change, with Undo on the toast. Asks first, unlike the one-at-a-time delete, because this is
   * many clubs at once and nobody can check them by eye afterwards; the dialog says how many.
   * Gives back the clubs deleted, all or none, as one change.
   */
  const deleteRemovedOn = async (
    day: string | null,
    clubs: readonly RemovedClub[]
  ): Promise<readonly RemovedClub[]> => {
    if (clubs.length === 0) return [];
    const many = clubs.length === 1 ? "1 club" : `${clubs.length.toLocaleString()} clubs`;
    const when = day ? ` taken off on ${day}` : " taken off";
    const confirmed = await requestConfirmation({
      title: `Delete ${many}${when} for good?`,
      message:
        "Each goes as Delete club takes one: the club, every game it is in, and its GameChanger ids, which a later pull refuses. A club a League Standings team links is not among them.",
      confirmLabel: "Delete them",
    });
    if (!confirmed) return [];
    const run = runCommand({
      kind: "batch",
      commands: clubs.map((club): PoolCommand => ({ kind: "club.drop", teamId: club.teamId })),
    });
    if (!run.ok) return [];
    showToast(`Deleted ${many}${when} for good.`, {
      tone: "undo",
      actionLabel: "Undo",
      onAction: () => runCommand(run.inverse),
    });
    return clubs;
  };

  return {
    agelessList,
    clearAgelessRows,
    confirmScore,
    deleteRemoved,
    deleteRemovedOn,
    dropClub,
    nameAgeFor,
    putBackRemoved,
    putBackRemovedOn,
    restoreDroppedClub,
    throwOutAgeless,
    undoAgelessAnswer,
  };
}
