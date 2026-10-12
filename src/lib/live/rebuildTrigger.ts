import { saveLineOf } from "./rebuild";
import { planCopyWrite, planLeagueWrite, type RebuildTask } from "./rebuildPlan";

/**
 * What the functions a write to the copy's manifest or to a League Standings season triggers
 * (`onCopyWrite`, `onLeagueWrite`) do with it, kept here, pure, so it is tested:
 * `functions/src/index.ts` only hands them the event, a reader of the switch and the queue.
 */

/** A document as an event hands it over: whether it is there, and its fields as stored. */
export type SnapshotLike = { readonly exists: boolean; data: () => unknown };

/** The one line the trigger logs for a write, and how loudly. */
export type CopyWriteLine = {
  level: "info" | "warn" | "error";
  message: string;
  line: Record<string, string | number | boolean>;
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * One write of `copies/main`: planned on the save alone (`planCopyWrite`), and the rebuild it asks
 * for queued. A save it queues is logged as `saveLineOf` says, so how long it took to reach the
 * boards can be read off the log, with the task it shares; a queue that would not take the task is
 * said in that line, not thrown, since the trigger is not tried again and the next save, or the
 * night, publishes it. Each side of the write is read once (`data()` is a new object each call),
 * and a side that is not there is no document. An event with no write in it says so, rather than
 * being taken for a delete.
 */
export const handleCopyWrite = async ({
  change,
  eventTime,
  readSwitch,
  enqueue,
}: {
  change: { before: SnapshotLike; after: SnapshotLike } | undefined;
  /** When Firestore committed the write: the event's own time. */
  eventTime: string;
  readSwitch: () => Promise<boolean>;
  enqueue: (queued: { id: string; scheduleTime: Date; task: RebuildTask }) => Promise<void>;
}): Promise<CopyWriteLine> => {
  if (!change) return { level: "warn", message: "copy write", line: { event: "no-write" } };
  const plan = await planCopyWrite({
    before: change.before.exists ? change.before.data() : undefined,
    after: change.after.exists ? change.after.data() : undefined,
    eventTime,
    readSwitch,
  });
  if ("skip" in plan) {
    return { level: "info", message: "copy write", line: { event: "skip", why: plan.skip } };
  }
  const saved = { ...saveLineOf(plan.ask, eventTime), kind: plan.ask.kind, task: plan.enqueue.id };
  try {
    await enqueue(plan.enqueue);
  } catch (error) {
    return {
      level: "error",
      message: "save",
      line: { ...saved, queued: false, error: messageOf(error) },
    };
  }
  return { level: "info", message: "save", line: { ...saved, queued: true } };
};

/**
 * One write of a League Standings season's document, `league/{docId}`: planned on the write alone
 * (`planLeagueWrite`), and the rebuild it asks for queued, as a save of the copy's is. Logged with
 * the season's document and the task it shares, and a queue that would not take it said in that
 * line, not thrown: the next write, or the night, publishes it.
 */
export const handleLeagueWrite = async ({
  change,
  docId,
  eventTime,
  readSwitch,
  enqueue,
}: {
  change: { before: SnapshotLike; after: SnapshotLike } | undefined;
  /** The season's document's id, as the event's path names it. */
  docId: string;
  eventTime: string;
  readSwitch: () => Promise<boolean>;
  enqueue: (queued: { id: string; scheduleTime: Date; task: RebuildTask }) => Promise<void>;
}): Promise<CopyWriteLine> => {
  if (!change) return { level: "warn", message: "season write", line: { event: "no-write" } };
  const plan = await planLeagueWrite({
    before: change.before.exists ? change.before.data() : undefined,
    after: change.after.exists ? change.after.data() : undefined,
    docId,
    eventTime,
    readSwitch,
  });
  if ("skip" in plan) {
    return {
      level: "info",
      message: "season write",
      line: { event: "skip", season: docId, why: plan.skip },
    };
  }
  const saved = {
    event: "season",
    season: docId,
    savedAt: eventTime,
    kind: plan.ask.kind,
    task: plan.enqueue.id,
  };
  try {
    await enqueue(plan.enqueue);
  } catch (error) {
    return {
      level: "error",
      message: "season",
      line: { ...saved, queued: false, error: messageOf(error) },
    };
  }
  return { level: "info", message: "season", line: { ...saved, queued: true } };
};
