import { hashValue } from "../cloud/cloudPack";
import type { FirestoreRestDocuments } from "../cloud/firestoreRest";

/**
 * The check a save queues for the boards where no rebuild is coming to publish it (README, "Boards
 * published after an edit"): an edit through the edit function, a League Standings score, a pull's
 * save. It runs once the copy and the seasons have been still for `BOARDS_SETTLE_MS`, on the
 * rebuilds' own queue, and where the boards are behind and nothing is at work on them, starts the
 * `boards-publish` job (`afterPull.ts`).
 *
 * One is queued for each minute a save falls in, under one name, so a run of edits queues one a
 * minute and not one an edit; each runs the settle after its minute ends, so the check of the last
 * save of a run is the one that finds everything still, and the checks before it find a save still
 * settling and leave the boards to it. Half an hour of clean-up in Pool health is one publish after
 * it, not one an edit: each publish builds the whole year's boards, about two minutes of an 8 GiB
 * instance.
 */

/** How long the copy and the seasons must have been still before a save's check publishes. */
export const BOARDS_SETTLE_MS = 3 * 60_000;

/** The span of saves one check is queued for. */
export const BOARDS_CHECK_WINDOW_MS = 60_000;

/**
 * What the queue carries: that it is a check of the boards, and when the save it was queued for
 * was; and `noRebuild` where that save's own rebuild could not be queued, so no rebuild coming may
 * be counted on to publish it, however the ledger reads (Codex, on #409).
 */
export type BoardsCheckTask = { check: "boards"; savedAt: string; noRebuild?: true };

/** A check as the queue hands it back, or null for anything else (a rebuild's task). */
export const coerceBoardsCheck = (raw: unknown): BoardsCheckTask | null => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const { check, savedAt, noRebuild } = raw as Record<string, unknown>;
  if (check !== "boards") return null;
  if (typeof savedAt !== "string" || Number.isNaN(Date.parse(savedAt))) return null;
  return { check, savedAt, ...(noRebuild === true ? { noRebuild } : {}) };
};

/**
 * The check a save at `savedAt` (Firestore's commit time) queues: one per minute, named for it, and
 * run the settle after the minute ends, which is the settle after the minute's last save at least.
 * A save whose rebuild could not be queued (`noRebuild`) queues one of its own name for the minute,
 * so a check the minute already has, counting on a rebuild, does not stand in for it.
 */
export const boardsCheckTask = async (
  savedAt: string,
  noRebuild = false
): Promise<{ id: string; scheduleTime: Date; task: BoardsCheckTask }> => {
  const at = Date.parse(savedAt);
  if (Number.isNaN(at)) throw new Error(`A save at no time anyone can read: ${savedAt}`);
  const window = Math.floor(at / BOARDS_CHECK_WINDOW_MS);
  return {
    id: (await hashValue(noRebuild ? ["bc", window, "no-rebuild"] : ["bc", window])).slice(0, 40),
    scheduleTime: new Date((window + 1) * BOARDS_CHECK_WINDOW_MS + BOARDS_SETTLE_MS),
    task: { check: "boards", savedAt, ...(noRebuild ? { noRebuild: true as const } : {}) },
  };
};

/**
 * The same check asked again at `due`: where a publish was under way when it ran, once that one has
 * let the lease go (`publishLease.ts`), since it may have built its boards before the save.
 */
export const boardsCheckAgain = async (
  task: BoardsCheckTask,
  due: number
): Promise<{ id: string; scheduleTime: Date; task: BoardsCheckTask }> => ({
  id: (await hashValue(["bc", "again", due])).slice(0, 40),
  scheduleTime: new Date(due),
  task: { ...task },
});

/**
 * Whether a save's trigger line (`rebuildTrigger.ts`) is of a save the boards read: one that asked
 * for a rebuild (queued or not), or would have, had the rebuilds not been switched off. A save that
 * moved nothing a board reads, a deleted or unreadable copy, or a newer build's, asks no check.
 */
export const asksBoards = (line: Readonly<Record<string, unknown>>): boolean =>
  line.event === "save" || line.event === "season" || (line.event === "skip" && line.why === "off");

/**
 * When a check that found a publish under way asks again (`boardsCheckAgain`): half a minute after
 * the lease lapses, or after the settle at the latest, so one that holds the lease for its whole
 * half hour is not waited out when the publish ends in two minutes, as it does.
 */
export const againAt = (until: number, now: number): number =>
  Math.min(until, now + BOARDS_SETTLE_MS) + 30_000;

/**
 * Where the last deletion of a League Standings season is noted (`onLeagueWrite`): a season's last
 * write is the settle's evidence that it is still (`afterPullDecision`), and a deleted document
 * leaves no time of its own, so a check or a job that read the seasons just after one was deleted
 * would take the others for still and publish at once (Codex, on #409). No client reads or writes
 * it (`firestore.rules`).
 */
export const LEAGUE_DELETED_PATH = "ops/leagueDeleted";

/** When the last deletion noted was, from the note's fields, or undefined where there is none. */
export const leagueDeletedAt = (
  fields: Readonly<Record<string, unknown>> | null | undefined
): string | undefined => {
  const at = fields?.at;
  return typeof at === "string" && !Number.isNaN(Date.parse(at)) ? at : undefined;
};

/**
 * A season deleted at `at` (Firestore's commit time) noted, unless a later deletion already is:
 * triggers may arrive out of order, and the note only ever moves forward.
 */
export const noteLeagueDeleted = async (
  docs: Pick<FirestoreRestDocuments, "readAt" | "replace">,
  at: string
): Promise<void> => {
  for (let tries = 0; tries < 3; tries += 1) {
    const was = await docs.readAt(LEAGUE_DELETED_PATH);
    const known = leagueDeletedAt(was?.fields);
    if (known !== undefined && Date.parse(known) >= Date.parse(at)) return;
    if (await docs.replace(LEAGUE_DELETED_PATH, { at }, was?.token ?? null)) return;
  }
};
