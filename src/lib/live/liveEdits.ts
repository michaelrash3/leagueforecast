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
  handedOver:
    "This page is opening on this device's copy, so editing here is off; it carries on there.",
  unlinked: "This device isn't connected to the cloud, so editing is off.",
  offline: "You're offline, so editing is off until the connection is back.",
  waiting: "Editing waits for the cloud to answer; the board drawn is this device's last one.",
} as const;

/**
 * Why edits are off: once the page has handed over to this device's copy, which an edit sent from
 * here would not be in when it opens (and which the device then writes itself); with no reader of
 * the cloud (signed out, or the cloud turned off on this device); with no connection to send them;
 * or before the network has answered, when what is drawn is what this device kept and an edit
 * would be made against a board nobody has vouched for since.
 */
export const editLock = ({
  handedOver = false,
  unlinked = false,
  offline,
  heard,
}: {
  handedOver?: boolean;
  unlinked?: boolean;
  offline: boolean;
  heard: boolean;
}): string | null =>
  handedOver
    ? EDIT_LOCKS.handedOver
    : unlinked
      ? EDIT_LOCKS.unlinked
      : offline
        ? EDIT_LOCKS.offline
        : heard
          ? null
          : EDIT_LOCKS.waiting;

/**
 * What a person is told when the code that sends an edit or a question would not load (offline as
 * the page asked for it, or a release that replaced it): nothing was sent.
 */
export const CLIENT_UNLOADED =
  "The page could not load what talks to the cloud, so nothing was sent. Try again in a minute.";

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
  "newer-league":
    "A newer version of the app saved a League Standings season, so nothing was changed. Reload the page.",
  "league-kept-live":
    "That version holds League Standings, which is kept live now, so it was not brought back.",
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
  "newer-league": "A newer version of the app saved a League Standings season. Reload the page.",
  "store-refused": "The cloud would not answer just now. Try again in a minute.",
  "kept-moving": "The cloud copy kept changing. Try again in a minute.",
  "day-spent":
    "The cloud has used today's share of its free computing time, so this waits until tomorrow.",
  "month-spent":
    "The cloud has used this month's share of its free computing time, so this waits until next month.",
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
      case "namedAges": {
        /*
         * The ages the club's GameChanger teams were named as put back, which is what a club's
         * age's Undo does (`club.age`'s inverse is a batch with this step in it): the pin it had
         * before, or none. Without it the age set stayed drawn after its Undo, until a publish.
         */
        const ids = new Set((team.gcTeams ?? []).map((link) => link.teamId));
        const touched =
          step.forget.some((id) => ids.has(id)) || step.put.some((entry) => ids.has(entry.teamId));
        if (!touched) break;
        const pin = step.put.find((entry) => ids.has(entry.teamId) && entry.pinned);
        if (pin) {
          shown = {
            ...shown,
            age: {
              level: pin.level,
              pinned: { level: pin.level, ...(pin.was === undefined ? {} : { was: pin.was }) },
            },
          };
        } else if (shown.age?.pinned) {
          const level = shown.age.pinned.was ?? shown.age.level;
          shown = { ...shown, age: level === undefined ? {} : { level } };
        }
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

/**
 * The club marked as a page's own as the edits not yet published leave it (`page.myTeam`, and its
 * Undo, which puts the page back whole): the last of them made for the page, or `published`, the
 * page's own as the views have it.
 */
export const myTeamShown = (
  pending: readonly PendingEdit[],
  pageId: string,
  published: string | undefined
): string | undefined => {
  let shown = published;
  for (const step of pending.flatMap(({ command }) => stepsOf(command))) {
    if (step.kind === "page.myTeam" && step.ageGroupId === pageId) shown = step.teamId ?? undefined;
    else if (step.kind === "group.put" && step.group.id === pageId) shown = step.group.myTeamId;
  }
  return shown;
};
