import { describe, expect, it, vi } from "vitest";
import type { CloudManifest, ManifestPart } from "../../cloud/cloudManifest";
import { LEAGUE_PART } from "../../cloud/cloudPlan";
import { fieldsOf, firestoreFieldsOf } from "../../cloud/firestoreRest";
import { coerceRebuildTask, rebuildTask, type RebuildTask } from "../rebuildPlan";
import { handleCopyWrite, type SnapshotLike } from "../rebuildTrigger";

/*
 * What the function a write to the copy triggers does with the write (`rebuildTrigger.ts`), and
 * the task the rebuild takes back off the queue (`coerceRebuildTask`).
 */

const h = (n: number) => n.toString(16).padStart(64, "0");
const part = (key: string, hash: string): ManifestPart => ({
  key,
  hash,
  bytes: 10,
  chunks: 1,
  id: "0123456789abcdef",
  at: 1,
  by: "phone",
});
const manifest = (more: Partial<CloudManifest> = {}): CloudManifest => ({
  format: 2,
  schema: 1,
  copy: "c0ffee",
  version: 4,
  save: "s",
  updatedAt: "2027-04-15T10:00:00.000Z",
  device: "phone",
  parts: [part(LEAGUE_PART, h(1)), part("league_forecast_scout_teams_v1", h(2))],
  kept: [],
  ...more,
});
const BEFORE = manifest();
/** The same copy saved again, with a board's input moved. */
const AFTER = manifest({
  version: 5,
  parts: [part(LEAGUE_PART, h(9)), part("league_forecast_scout_teams_v1", h(2))],
});
const AT = "2027-04-15T14:00:07.123456Z";

const doc = (fields?: unknown): SnapshotLike => ({
  exists: fields !== undefined,
  data: () => fields,
});
const write = (before?: unknown, after?: unknown) => ({ before: doc(before), after: doc(after) });

describe("a write of the copy's manifest", () => {
  it("queues the rebuild it asks for, and logs the save with the task it shares", async () => {
    const enqueue = vi.fn(async () => undefined);
    const readSwitch = vi.fn(async () => true);
    const done = await handleCopyWrite({
      change: write(BEFORE, AFTER),
      eventTime: AT,
      readSwitch,
      enqueue,
    });
    const queued = await rebuildTask(
      { kind: "edit", copy: "c0ffee", version: 5, reset: false },
      AT
    );
    expect(enqueue).toHaveBeenCalledWith(queued);
    expect(done).toEqual({
      level: "info",
      message: "save",
      line: {
        event: "save",
        copy: "c0ffee",
        v: 5,
        savedAt: AT,
        kind: "edit",
        task: queued.id,
        queued: true,
      },
    });
  });

  it("asks the same of a manifest as Firestore's REST API reads it back as of the plain one", async () => {
    // Every field the manifest holds is a string, a whole number, a list or a map, which the
    // event's decoder and the REST store's read the same way.
    const restRead = (stored: CloudManifest) => fieldsOf(firestoreFieldsOf({ ...stored }));
    expect(restRead(AFTER)).toEqual(AFTER);
    const asked = async (before: unknown, after: unknown) => {
      const enqueue = vi.fn(async () => undefined);
      const done = await handleCopyWrite({
        change: write(before, after),
        eventTime: AT,
        readSwitch: async () => true,
        enqueue,
      });
      return { done, queued: enqueue.mock.calls };
    };
    expect(await asked(restRead(BEFORE), restRead(AFTER))).toEqual(await asked(BEFORE, AFTER));
  });

  it("logs a skip, queueing nothing, for a delete, a manifest it cannot read, and no board input", async () => {
    const enqueue = vi.fn(async () => undefined);
    const readSwitch = vi.fn(async () => true);
    const cases: Array<[ReturnType<typeof write>, string]> = [
      [write(BEFORE, undefined), "deleted"],
      [write(BEFORE, { format: 9 }), "unreadable"],
      [write(BEFORE, manifest({ version: 5, device: "nightly" })), "no-board-input"],
      [write(BEFORE, manifest({ ...AFTER, schema: 99 })), "newer-schema"],
    ];
    for (const [change, why] of cases) {
      expect(await handleCopyWrite({ change, eventTime: AT, readSwitch, enqueue }), why).toEqual({
        level: "info",
        message: "copy write",
        line: { event: "skip", why },
      });
    }
    expect(enqueue).not.toHaveBeenCalled();
    // None of those asks for a rebuild, so none reads the switch.
    expect(readSwitch).not.toHaveBeenCalled();
  });

  it("queues nothing while the switch is off, and a copy's first save as a reset", async () => {
    const enqueue = vi.fn(async () => undefined);
    expect(
      await handleCopyWrite({
        change: write(BEFORE, AFTER),
        eventTime: AT,
        readSwitch: async () => false,
        enqueue,
      })
    ).toMatchObject({ line: { event: "skip", why: "off" } });
    expect(enqueue).not.toHaveBeenCalled();
    // Nothing before it: created, not a delete, and every board asked for.
    expect(
      await handleCopyWrite({
        change: write(undefined, AFTER),
        eventTime: AT,
        readSwitch: async () => true,
        enqueue,
      })
    ).toMatchObject({ line: { event: "save", v: 5, queued: true } });
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("reads each side once, and a side that is not there as no document whatever it holds", async () => {
    const before = { exists: true, data: vi.fn(() => BEFORE) };
    const after = { exists: true, data: vi.fn(() => AFTER) };
    await handleCopyWrite({
      change: { before, after },
      eventTime: AT,
      readSwitch: async () => true,
      enqueue: async () => undefined,
    });
    expect(before.data).toHaveBeenCalledTimes(1);
    expect(after.data).toHaveBeenCalledTimes(1);
    // A side that says it is not there is a delete, even if its data were to hand something back.
    expect(
      await handleCopyWrite({
        change: { before: doc(BEFORE), after: { exists: false, data: () => AFTER } },
        eventTime: AT,
        readSwitch: async () => true,
        enqueue: async () => undefined,
      })
    ).toMatchObject({ line: { why: "deleted" } });
  });

  it("says a queue that would not take the task, rather than throwing, and an event with no write", async () => {
    const done = await handleCopyWrite({
      change: write(BEFORE, AFTER),
      eventTime: AT,
      readSwitch: async () => true,
      enqueue: async () => {
        throw new Error("Cloud Tasks answered 503.");
      },
    });
    expect(done).toMatchObject({
      level: "error",
      message: "save",
      line: { event: "save", v: 5, queued: false, error: "Cloud Tasks answered 503." },
    });
    expect(
      await handleCopyWrite({
        change: undefined,
        eventTime: AT,
        readSwitch: async () => true,
        enqueue: async () => undefined,
      })
    ).toEqual({ level: "warn", message: "copy write", line: { event: "no-write" } });
  });
});

describe("a rebuild task as the queue hands it back", () => {
  it("is the task queued, and nothing for anything else", async () => {
    const { task } = await rebuildTask(
      { kind: "server", copy: "c0ffee", version: 5, reset: false },
      AT
    );
    expect(coerceRebuildTask(JSON.parse(JSON.stringify(task)))).toEqual(task);
    const bad: unknown[] = [
      null,
      "task",
      [task],
      { ...task, copy: "" },
      { ...task, copy: 5 },
      { ...task, kind: "nightly" },
      { ...task, window: -1 },
      { ...task, window: 1.5 },
      { ...task, window: "3" },
      { ...task, savedAt: "whenever" },
      { copy: task.copy, kind: task.kind, window: task.window },
    ];
    for (const raw of bad) expect(coerceRebuildTask(raw), JSON.stringify(raw)).toBeNull();
    const extra: RebuildTask & { more: number } = { ...task, more: 1 };
    expect(coerceRebuildTask(extra)).toEqual(task);
  });
});
