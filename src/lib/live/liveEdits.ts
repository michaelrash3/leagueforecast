import { unlinkGcTeam } from "../teamRankings";
import { cleanTeamName, normalizeState } from "../teamRankings/names";
import { isBoardInput } from "./boardInputs";
import type { PoolCommand } from "./commands";
import type { EditReply } from "./editHandle";
import type { EditRefusal, QueryRefusal } from "./editRun";
import type { ClubCard } from "./views/clubShape";

/**
 * A member's edits from the live page (1.5), on the device: what each answer is said as, which edits
 * the page still shows over the views it reads, and how a club's card reads with them. The edit
 * function answers once a save has landed; the views follow when the rebuild the save asks for
 * publishes them, a minute or so on (`LIVE_SPACING_S`). Until then the page draws what the edit made
 * over what it reads, so a change made is a change seen. Pure, so it is tested without a page or a
 * server; `useLiveEdits` sends the edits.
 */

/** An edit the server made, which the published views may not show yet. */
export type PendingEdit = { command: PoolCommand; copy: string; version: number };

/**
 * The edit a reply says was made, to show over the views until they show it: null when the save
 * changed nothing the views are built from (`isBoardInput`), a Pool health answer say, since then
 * no rebuild comes and there is nothing for them to catch up on.
 */
export const pendingOf = (
  command: PoolCommand,
  reply: Extract<EditReply, { ok: true }>
): PendingEdit | null =>
  reply.changed.some(isBoardInput) ? { command, copy: reply.copy, version: reply.version } : null;

/**
 * Whether views published of `copy` leave nothing of `edit` to show: they are of its copy at its
 * version or later, or of another copy, which the edit was never made on.
 */
export const settledBy = (edit: PendingEdit, copy: { id: string; version: number }): boolean =>
  copy.id !== edit.copy || copy.version >= edit.version;

/** How long since the last call a warm-up is worth sending: the pool is warm before then. */
export const WARM_AFTER_MS = 10 * 60_000;

/** Why the page will not send an edit now, as the person is told. */
export const EDIT_LOCKS = {
  offline: "You're offline, so editing is off until the connection is back.",
  waiting: "Editing waits for the cloud to answer; the board drawn is this device's last one.",
} as const;

/**
 * Why edits are off: with no connection to send them, or before the network has answered, when
 * what is drawn is what this device kept and an edit would be made against a board nobody has
 * vouched for since.
 */
export const editLock = ({
  offline,
  heard,
}: {
  offline: boolean;
  heard: boolean;
}): string | null => (offline ? EDIT_LOCKS.offline : heard ? null : EDIT_LOCKS.waiting);

/** What a person is told of an edit the server would not make, each reason in plain words. */
export const EDIT_REFUSED: Record<EditRefusal, string> = {
  missing: "That club or game is no longer in the pool, so nothing was changed.",
  refused: "The pool would not take that change, so nothing was changed.",
  unsaved:
    "The cloud would not save that change just now, so it was not made. Try again in a minute.",
  "copy-replaced":
    "The cloud copy was started again since this page opened, so nothing was changed. Reload the page.",
  unsure: "The change may or may not have been made. Check it on the board before making it again.",
  "kept-moving":
    "Other changes kept landing first, so this one was not made. Try again in a minute.",
  "no-copy": "There is no cloud copy to change.",
  "newer-schema": "A newer version of the app saved the cloud copy. Reload the page to edit it.",
  "newer-rules": "A newer version of the app saved the cloud copy. Reload the page to edit it.",
  "unknown-key": "A newer version of the app saved the cloud copy. Reload the page to edit it.",
  damaged: "The cloud copy could not be read, so nothing was changed.",
  "league-unreadable": "The cloud copy could not be read, so nothing was changed.",
  "store-refused":
    "The cloud would not answer just now, so nothing was changed. Try again in a minute.",
};

/** What a person is told of a question the server would not answer. */
export const QUERY_REFUSED: Record<QueryRefusal, string> = {
  "copy-replaced": "The cloud copy was started again since this page opened. Reload the page.",
  "no-copy": "There is no cloud copy to ask about.",
  "newer-schema": "A newer version of the app saved the cloud copy. Reload the page.",
  "newer-rules": "A newer version of the app saved the cloud copy. Reload the page.",
  "unknown-key": "A newer version of the app saved the cloud copy. Reload the page.",
  damaged: "The cloud copy could not be read just now.",
  "league-unreadable": "The cloud copy could not be read just now.",
  "store-refused": "The cloud would not answer just now. Try again in a minute.",
  "kept-moving": "The cloud copy kept changing. Try again in a minute.",
};

/** A command and every step of it, in the order they run. */
const stepsOf = (command: PoolCommand): PoolCommand[] =>
  command.kind === "batch" ? command.commands.flatMap(stepsOf) : [command];

/**
 * A club's card as the edits made since it was published leave it, for its panel: its state, name,
 * GameChanger links and level, as each edit made them. A card the server's next publish replaces
 * says all of this itself; until then this is what the panel draws. A club folded into another is
 * no longer a card to draw, and says where its games went.
 */
export const overlayCard = (
  card: ClubCard,
  edits: readonly PoolCommand[]
): ClubCard | { foldedInto: string } => {
  let shown = card;
  for (const step of edits.flatMap(stepsOf)) {
    const team = shown.team;
    switch (step.kind) {
      case "team.state": {
        if (step.teamId !== team.id) break;
        const state = step.state === null ? undefined : normalizeState(step.state);
        const next = { ...team };
        delete next.state;
        shown = { ...shown, team: state ? { ...next, state } : next };
        break;
      }
      case "team.rename": {
        const name = cleanTeamName(step.name).trim();
        if (step.teamId === team.id && name) shown = { ...shown, team: { ...team, name } };
        break;
      }
      case "team.unlinkGc": {
        if (step.teamId !== team.id) break;
        const [unlinked] = unlinkGcTeam(team.id, step.gcTeamId, [team]);
        if (unlinked) shown = { ...shown, team: unlinked };
        break;
      }
      case "club.age": {
        if (step.teamId !== team.id) break;
        const was = shown.age?.pinned?.was ?? shown.age?.level;
        shown = {
          ...shown,
          age: {
            level: step.level,
            pinned: { level: step.level, ...(was === undefined ? {} : { was }) },
          },
        };
        break;
      }
      case "club.ageClear": {
        if (step.teamId !== team.id || !shown.age?.pinned) break;
        const level = shown.age.pinned.was ?? shown.age.level;
        shown = { ...shown, age: level === undefined ? {} : { level } };
        break;
      }
      case "teams.merge":
        if (step.fromId === team.id) return { foldedInto: step.intoId };
        break;
      default:
        break;
    }
  }
  return shown;
};
