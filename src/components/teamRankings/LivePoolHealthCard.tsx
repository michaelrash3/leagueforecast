import { useEffect, useState } from "react";
import type { Confirmation } from "../../hooks/useConfirmation";
import type { LiveEdits } from "../../hooks/useLiveEdits";
import { MAX_COMMAND_STEPS, type PoolCommand } from "../../lib/live/commands";
import type { HealthInspectAnswer, HealthSummaryAnswer } from "../../lib/live/queries";
import { clubOf } from "../../lib/poolHealthSummary";
import { IMPLAUSIBLE_MARGIN } from "../../lib/teamRankings";
import { createAgeGroupId } from "../../lib/teamRankings/seasons";
import { downloadCsv } from "../../lib/download";
import { button, card } from "../../styles/tokens";
import { PoolHealthView, type PoolHealthActions, type PoolHealthAnswers } from "./PoolHealthView";

const plural = (value: number, noun: string) =>
  `${value.toLocaleString()} ${noun}${value === 1 ? "" : "s"}`;

/** What each answer is said as once the server has kept it, given or taken back. */
const ANSWER_SAID: Record<keyof PoolHealthAnswers, { given: string; taken: string }> = {
  realClubs: { given: "Kept off the list as a real club.", taken: "Back on the list." },
  ageRight: { given: "Kept at the age it is filed at.", taken: "Back on the list." },
  keptApart: { given: "Kept as two clubs.", taken: "Offered again." },
};

const answersOf = (opened: HealthSummaryAnswer): PoolHealthAnswers => ({
  realClubs: new Set(opened.answers.realClubs),
  ageRight: new Set(opened.answers.ageRight),
  keptApart: new Set(opened.answers.keptApart),
});

/**
 * Pool health on the live page (1.5): drawn as the device's own card draws it (`PoolHealthView`),
 * from what the server's pool shows as it opens (`health.summary`) and what it finds once asked to
 * look harder (`health.inspect`), each button sent to the edit function as the edit the device's
 * card makes (`useLiveEdits`). The rows an edit leaves are asked for again once it is made, so the
 * lists are the copy's as it now stands.
 *
 * Two things are left to the device's own card. The tidy that settles results against stand-ins is
 * the nightly refresh's, which tidies after every pull; and the files of the whole pool (its names,
 * its stand-in fixtures) are research files made from a pool held whole, which this page never
 * holds.
 */
export function LivePoolHealthCard({
  edits,
  confirm,
  today,
  onOpenTeam,
}: {
  edits: LiveEdits;
  confirm: Confirmation["request"];
  /** The device's day, which "a day that has not happened" is judged by. */
  today: string;
  onOpenTeam?: (teamId: string, year?: number) => void;
}) {
  const { locked, edit, ask, say } = edits;
  const [opened, setOpened] = useState<HealthSummaryAnswer | null>(null);
  const [answers, setAnswers] = useState<PoolHealthAnswers | null>(null);
  const [unread, setUnread] = useState(false);
  // Bumped to ask what the pool shows again, after an edit that changed it or a try again.
  const [asked, setAsked] = useState(0);
  const [inspection, setInspection] = useState<HealthInspectAnswer | null>(null);
  const [looking, setLooking] = useState(false);

  // What the pool shows as it opens, once edits can be sent: asked of the copy, never of a board
  // this device kept, as an edit is made against it.
  useEffect(() => {
    if (locked) return;
    let alive = true;
    void ask({ kind: "health.summary", today }).then((answer) => {
      if (!alive) return;
      if (!answer) {
        setUnread(true);
        return;
      }
      setUnread(false);
      setOpened(answer);
      setAnswers(answersOf(answer));
    });
    return () => {
      alive = false;
    };
  }, [locked, ask, today, asked]);
  const askAgain = () => setAsked((times) => times + 1);

  /** An edit that changes the pool, after which (and after its Undo) the lists are asked for. */
  const change = async (command: PoolCommand, done: string, undo = false): Promise<boolean> => {
    const made = await edit(command, { done, undo, ...(undo ? { afterUndo: askAgain } : {}) });
    if (made) askAgain();
    return made;
  };

  const look = async () => {
    setLooking(true);
    const found = await ask({ kind: "health.inspect", today });
    setLooking(false);
    if (found) setInspection(found);
  };

  if (!opened || !answers)
    return (
      <div className={`${card} p-5`} role="status" aria-live="polite">
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Pool health
        </h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          {locked ??
            (unread
              ? "Pool health could not be read from the cloud just now."
              : "Reading the pool's health from the cloud…")}
        </p>
        {unread && !locked && (
          <button type="button" onClick={askAgain} className={`${button.ghost} mt-3`}>
            Try again
          </button>
        )}
      </div>
    );

  const nameOf = (teamId: string) => clubOf(opened.summary, teamId)?.name ?? teamId;

  const actions: PoolHealthActions = {
    /*
     * Shown at once as the server kept it, and asked for again: what the pool showed was asked
     * before this answer was given, and an answer to that question still on its way would put the
     * list back as it was (the question is let go when it is asked again).
     */
    answer: async (list, add, remove) => {
      const said = ANSWER_SAID[list];
      const made = await edit(
        { kind: "answers", list, add, remove },
        { done: add.length > 0 ? said.given : said.taken }
      );
      if (!made) return false;
      setAnswers((held) => {
        if (!held) return held;
        const next = new Set([...held[list], ...add]);
        remove.forEach((id) => next.delete(id));
        return { ...held, [list]: next };
      });
      askAgain();
      return true;
    },
    // Asked first, as the device's card asks.
    dropGames: async (ids, why) => {
      if (ids.length === 0) return false;
      const games = plural(ids.length, "game");
      const confirmed = await confirm({
        title: `Delete ${games}?`,
        message: `${
          why === "ahead"
            ? "Each one carries a score on a date still to come, so it cannot be a result."
            : `Each one has a side winning by more than ${IMPLAUSIBLE_MARGIN} runs, which no real game ends with.`
        } The rows that carried those scores are remembered by their GameChanger id, so pulling those schedules again will not bring them back.`,
        confirmLabel: "Delete them",
      });
      if (!confirmed) return false;
      return change(
        { kind: "games.drop", gameIds: [...ids] },
        `Deleted ${games} ${why === "ahead" ? "dated ahead" : `won by more than ${IMPLAUSIBLE_MARGIN}`}.`
      );
    },
    // At once, without asking, as the device's card deletes one.
    dropClub: (club) => change({ kind: "club.drop", teamId: club.teamId }, `Deleted ${club.name}.`),
    confirmScore: (game) =>
      change(
        { kind: "game.confirm", year: game.year, gameId: game.id },
        `${nameOf(game.teamAId)} ${game.teamAScore}–${game.teamBScore} ${nameOf(game.teamBId)} counts now.`
      ),
    merge: async (from, into) => {
      const preview = await ask({
        kind: "merge.preview",
        fromId: from.id,
        intoId: into.id,
        adopt: [],
      });
      if (!preview) return false;
      if (!preview.found) {
        say(`${from.name} or ${into.name} is no longer in the cloud copy, so nothing was changed.`);
        return false;
      }
      const confirmed = await confirm({
        title: `Fold ${from.name} into ${into.name}?`,
        message: `${plural(preview.games, "game")} will move to ${into.name}, and ${from.name} will be removed.${
          preview.dropped > 0
            ? ` ${plural(preview.dropped, "game")} between the two cannot survive the fold and will be dropped.`
            : ""
        }`,
        confirmLabel: "Fold in",
      });
      if (!confirmed) return false;
      return change(
        { kind: "teams.merge", fromId: from.id, intoId: into.id, adopt: [] },
        `Folded into ${into.name}.`
      );
    },
    setAge: (club) =>
      change(
        {
          kind: "club.age",
          year: club.year,
          teamId: club.teamId,
          level: club.suggested,
          at: new Date().toISOString(),
          pageId: createAgeGroupId(),
        },
        `${club.name} is ${club.suggested}U now.`,
        true
      ),
    /*
     * Confirmed, then planned on the server's pool and sent back as an edit. One edit files at most
     * `MAX_COMMAND_STEPS` clubs (a step a club; the server refuses a longer one whole), so a longer
     * list goes as several, each planned on the pool the edit before it left, so two clubs bound for
     * one new page still make it once. Only a list sent as one edit can be taken back as one, so
     * only that one offers an Undo.
     */
    setAges: async (clubs) => {
      const years = [...new Set(clubs.map((club) => club.year))].sort((a, b) => a - b);
      const confirmed = await confirm({
        title: `Approve age changes for ${plural(clubs.length, "club")}?`,
        message: `${plural(clubs.length, "club")} will be moved in squad ${
          years.length === 1 ? `year ${years[0]}` : `years ${years.join(", ")}`
        }. Each suggested level comes from the evidence displayed in Pool health. “It plays up/down” remains an individual opt-out.`,
        confirmLabel: "Approve all changes",
      });
      if (!confirmed) return null;
      const parts = Math.ceil(clubs.length / MAX_COMMAND_STEPS);
      const changedTeamIds: string[] = [];
      let moved = 0;
      let failed = 0;
      // The clubs that could not be changed as the last toast said them.
      let failedSaid = 0;
      let stopped = false;
      const failure = (count: number) =>
        count
          ? ` ${count} ${count === 1 ? "club could" : "clubs could"} not be changed and remain in the review list.`
          : "";
      for (let part = 0; part < parts; part += 1) {
        const plan = await ask({
          kind: "ages.plan",
          clubs: clubs
            .slice(part * MAX_COMMAND_STEPS, (part + 1) * MAX_COMMAND_STEPS)
            .map((club) => ({ teamId: club.teamId, level: club.suggested, year: club.year })),
          at: new Date().toISOString(),
          base: createAgeGroupId(),
        });
        if (!plan) {
          stopped = true;
          break;
        }
        failed += plan.failed;
        if (plan.commands.length === 0) continue;
        const changed = changedTeamIds.length + plan.changedTeamIds.length;
        const made = await edit(
          { kind: "batch", commands: plan.commands },
          {
            done: `${plural(changed, "club")} moved to ${
              changed === 1 ? "its" : "their"
            } suggested age groups; ${plural(moved + plan.moved, "game")} refiled.${failure(failed)}`,
            undo: parts === 1,
            ...(parts === 1 ? { afterUndo: askAgain } : {}),
          }
        );
        if (!made) {
          stopped = true;
          break;
        }
        changedTeamIds.push(...plan.changedTeamIds);
        moved += plan.moved;
        failedSaid = failed;
      }
      if (changedTeamIds.length === 0) {
        if (stopped) return null;
        say(`No club could be changed.${failure(failed)}`);
        return { changedTeamIds, failed };
      }
      askAgain();
      // A last part that moved no club says what could not be changed, as no edit's toast did.
      if (!stopped && failed > failedSaid) say(failure(failed).trim());
      return { changedTeamIds, failed };
    },
    ...(onOpenTeam ? { openTeam: onOpenTeam } : {}),
    downloadToPull: () =>
      void ask({ kind: "health.toPull" }).then((file) => {
        if (file) downloadCsv("Clubs_To_Pull.csv", file.csv);
      }),
  };

  return (
    <PoolHealthView
      summary={opened.summary}
      answers={answers}
      inspection={inspection}
      looking={looking}
      canLook={!looking && locked === null}
      onLook={() => void look()}
      held={locked !== null}
      actions={actions}
      under={
        inspection && inspection.settleable > 0 ? (
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            The nightly refresh settles them: it tidies the pool after every pull.
          </p>
        ) : null
      }
    />
  );
}
