import { unlinkGcTeam } from "../teamRankings";
import { cleanTeamName } from "../teamRankings/names";
import { normalizeState } from "../teamRankings/rosterNames";
import { isBoardInput } from "./boardInputs";
import type { PoolCommand } from "./commands";
import type { StoppedPulls } from "../cloud/pullJobRunner";
import type { EditReply } from "./editHandle";
import type { EditRefusal, QueryRefusal } from "./editRun";
import type { ClubCard } from "./views/clubShape";
import type { ScoutGame } from "../teamRankings";

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
  newer:
    "The cloud's boards were published by a newer version of the app, so editing is off here. Reload the page to update it.",
  noCopy:
    "There's no cloud copy this device could read, so editing is off. Reload the page to look again.",
} as const;

/**
 * Why edits are off: once the page has handed over to this device's copy, which an edit sent from
 * here would not be in when it opens (and which the device then writes itself); with no reader of
 * the cloud (signed out, or the cloud turned off on this device); with no connection to send them;
 * before the cloud has answered (`heard`: the server's own word, which a meta this build cannot
 * draw is as much as one it can), when what is drawn is what this device kept and an edit would be
 * made against a board nobody has vouched for since; over boards a newer version of the app
 * published (`newer`), which this device should reload to read before it changes them; or once the
 * cloud has answered with no copy known to make them on (`noCopy`): nothing published names one,
 * and the cloud's own manifest could not be read or there is none. Without that lock every edit and
 * question was turned away one toast at a time, under controls drawn as though they would go.
 *
 * Nothing else: edits go through the edit function and need no board, so a meta of an older
 * schema, or none, or one whose pages will not read, leaves them on. On 10 October 2026 a meta
 * the build could not draw locked editing and imports for a whole day.
 */
export const editLock = ({
  handedOver = false,
  unlinked = false,
  offline,
  heard,
  newer = false,
  noCopy = false,
}: {
  handedOver?: boolean;
  unlinked?: boolean;
  offline: boolean;
  heard: boolean;
  newer?: boolean;
  noCopy?: boolean;
}): string | null =>
  handedOver
    ? EDIT_LOCKS.handedOver
    : unlinked
      ? EDIT_LOCKS.unlinked
      : offline
        ? EDIT_LOCKS.offline
        : !heard
          ? EDIT_LOCKS.waiting
          : newer
            ? EDIT_LOCKS.newer
            : noCopy
              ? EDIT_LOCKS.noCopy
              : null;

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
  logged:
    "Some of these games were added to the page since they were checked, so nothing was added. Look them over again before adding them.",
  "too-many":
    "That would change too many clubs at once, so nothing was added. Add the games in smaller parts.",
  "store-refused":
    "The cloud would not answer just now, so nothing was changed. Try again in a minute.",
};

/** Said when the cloud's Team Rankings holds nothing a squad year is counted by. */
export const NOTHING_TO_START =
  "The cloud's Team Rankings has no pages, games or archived tables to start again from.";

/** The owner's commands that make Team Rankings another whole, which their own words describe. */
type StartAgain = "copy.reset" | "copy.restore" | "backup.restore";

/**
 * What an owner's start of Team Rankings is told where a pool edit's words would mislead. A
 * second Start again finds nothing to take out (`copyOps.ts`, `missing`), which is not a club or a
 * game gone; and one whose save went out unanswered cannot be checked on the board, which goes on
 * showing the old pool until the views are published again: Setup's squad years read the copy,
 * and so do the earlier versions in the Cloud panel.
 */
const START_AGAIN_REFUSED: Record<StartAgain, Partial<Record<EditRefusal, string>>> = {
  "copy.reset": {
    missing: NOTHING_TO_START,
    unsure:
      "Team Rankings may or may not have been started again. Setup's squad years say which, empty once it has been, as do the earlier versions in the Cloud panel; look there before pressing it again.",
  },
  "copy.restore": {
    missing: "That earlier version is no longer kept, so nothing was brought back.",
    unsure:
      "That earlier version may or may not have been brought back. The earlier versions in the Cloud panel say which, as do Setup's squad years; look there before bringing it back again.",
  },
  "backup.restore": {
    unsure:
      "The backup may or may not have been restored. The earlier versions in the Cloud panel say which, as do Setup's squad years; look there before restoring it again.",
  },
};

const startAgainOf = (command: PoolCommand): StartAgain | null =>
  command.kind === "copy.reset" ||
  command.kind === "copy.restore" ||
  command.kind === "backup.restore"
    ? command.kind
    : null;

/** What a person is told of `command` refused for `why`: its own words, or any edit's. */
export const editRefused = (command: PoolCommand, why: EditRefusal): string => {
  const kind = startAgainOf(command);
  return (kind ? START_AGAIN_REFUSED[kind][why] : undefined) ?? EDIT_REFUSED[why];
};

/**
 * What a person is told of `command` sent with no answer that says whether it was made
 * (`unanswered`): a start of Team Rankings in its own words, which say where to look; null for
 * any other edit, whose call already says it may or may not have been made.
 */
export const unansweredSaid = (command: PoolCommand): string | null => {
  const kind = startAgainOf(command);
  return kind ? (START_AGAIN_REFUSED[kind].unsure ?? null) : null;
};

/**
 * What a start of Team Rankings adds to its toast about the pulls it stopped (`EditReply.stopped`):
 * nothing where there were none, so a start with nothing under way says only that it was made.
 */
export const stoppedSaid = (stopped: StoppedPulls | undefined): string => {
  if (!stopped) return "";
  const said: string[] = [];
  if (stopped.pulls > 0) {
    const one = stopped.pulls === 1;
    said.push(
      `${stopped.pulls.toLocaleString()} ${one ? "pull" : "pulls"} under way in the cloud ${one ? "was" : "were"} asked to stop, and ${one ? "files" : "file"} nothing more.`
    );
  }
  if (stopped.nightly) said.push("The nightly refresh pulling now files nothing it fetched.");
  return said.join(" ");
};

/**
 * What the live page says while a start of Team Rankings made from it is not yet on the boards:
 * the boards, Find a team and the club cards are the views the server publishes, which a start
 * does not build (`handleEdit`), so they show the pool as it was until a rebuild publishes the
 * copy's version, and the page says so rather than look as though nothing happened. In October
 * 2026 the month's rebuild budget held those rebuilds back for days; half an hour is the longest
 * a save's views are to wait once a publish runs on GitHub when the rebuilds are held back.
 */
export const STARTED_AGAIN_WAITING: Record<StartAgain, string> = {
  "copy.reset":
    "Team Rankings was started again. The boards, Find a team and the club cards still show what it held, and empty once they are published again, within half an hour.",
  "copy.restore":
    "An earlier version of Team Rankings was brought back. The boards, Find a team and the club cards show it once they are published again, within half an hour.",
  "backup.restore":
    "Team Rankings was restored from a backup. The boards, Find a team and the club cards show it once they are published again, within half an hour.",
};

/**
 * The notice for the latest start of Team Rankings among `pending`, the edits the published views
 * do not show yet (`settledBy`), or null with none: it goes once views of the start's version, or
 * a later one, are published.
 */
export const startedAgainNotice = (pending: readonly PendingEdit[]): string | null => {
  for (let at = pending.length - 1; at >= 0; at -= 1) {
    const kind = startAgainOf(pending[at]!.command);
    if (kind) return STARTED_AGAIN_WAITING[kind];
  }
  return null;
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
 * The games of a card that Not this team on the one stored as `storedId` takes off the club, as the
 * card can tell: every game it has by a name alone (`ClubCard.byName`) against the same opponent.
 * The server takes off every game the opponent's schedules filed onto the club by the name
 * (`takenWith`), which is what a card marks as by a name against that opponent; none where the card
 * does not hold the game.
 */
export const takenWithOnCard = (card: ClubCard, storedId: string): ScoutGame[] => {
  const byName = card.byName ?? {};
  const club = card.team.id;
  const opponentOf = (game: ScoutGame) => (game.teamAId === club ? game.teamBId : game.teamAId);
  const pressed = card.games.find((game) => byName[game.id] === storedId);
  if (!pressed) return [];
  const opponent = opponentOf(pressed);
  return card.games.filter(
    (game) => byName[game.id] !== undefined && opponentOf(game) === opponent
  );
};

/**
 * A club's card as the edits made since it was published leave it, for its panel: its state, name,
 * GameChanger links and level, as each edit made them, and without a game taken off it as not its
 * own, which takes its record with it. A card the server's next publish replaces
 * says all of this itself; until then this is what the panel draws. A club folded into another is
 * no longer a card to draw, and says where its games went.
 */
export const overlayCard = (
  card: ClubCard,
  edits: readonly PoolCommand[]
): ClubCard | { foldedInto: string } => {
  let shown = card;
  // The stored ids of games taken off the club as not its own (`game.notThisTeam`), until a step
  // puts the game back on it: that edit's Undo, which puts the game as the copy held it.
  const takenOff = new Set<string>();
  for (const step of edits.flatMap(stepsOf)) {
    const team = shown.team;
    switch (step.kind) {
      case "game.notThisTeam": {
        if (step.teamId !== team.id) break;
        // The game pressed, and every other the same club filed onto this one by the name.
        const taken = takenWithOnCard(shown, step.gameId);
        if (taken.length === 0) takenOff.add(step.gameId);
        taken.forEach((game) => takenOff.add(shown.byName?.[game.id] ?? step.gameId));
        break;
      }
      case "game.put":
        for (const game of step.games) {
          if (game.teamAId === team.id || game.teamBId === team.id) takenOff.delete(game.id);
        }
        break;
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
  if (takenOff.size === 0 || !shown.byName) return shown;
  // A card names such a game by its place, and the edit by its stored id (`ClubCard.byName`).
  const byName = shown.byName;
  const off = (game: { id: string }) => {
    const stored = byName[game.id];
    return stored !== undefined && takenOff.has(stored);
  };
  if (!shown.games.some(off)) return shown;
  const { byName: _was, ...rest } = shown;
  const left = Object.fromEntries(Object.entries(byName).filter(([, id]) => !takenOff.has(id)));
  return {
    ...rest,
    games: shown.games.filter((game) => !off(game)),
    ...(Object.keys(left).length > 0 ? { byName: left } : {}),
  };
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
