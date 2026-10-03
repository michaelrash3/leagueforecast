import { saveLineOf } from "./rebuild";
import { planCopyWrite, type RebuildTask } from "./rebuildPlan";

/**
 * What the function a write to the copy's manifest triggers (`onCopyWrite`) does with it, kept
 * here, pure, so it is tested: `functions/src/index.ts` only hands it the event, a reader of the
 * switch and the queue.
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
