import { hashValue } from "../cloud/cloudPack";
import { coerceManifest, DATA_SCHEMA, type CloudManifest } from "../cloud/cloudManifest";
import { LEAGUE_PART } from "../cloud/cloudPlan";
import { isCloudPoolKey } from "../teamRankingsStorage";
import { boardInputsPrint } from "./boardInputs";

/**
 * What a save of the copy asks of the views, decided on the save alone: whether it could have moved
 * a board, and when the rebuild it asks for runs. The function a write to the copy triggers
 * (`onCopyWrite`) runs this and queues what it says; it is kept here, pure, so it is tested.
 */

/**
 * Who saved: a device, whose edits come in bursts a person is waiting on; a server that publishes
 * the boards of what it saved (the nightly), whose own publish should already be in; or the edit
 * function (`editRun.ts`), which saves one member's change at a time and publishes nothing itself.
 */
export type RebuildKind = "edit" | "server" | "live";

/**
 * How long the saves of one kind gather into one rebuild, in seconds: every save in a window shares
 * one task. Two minutes holds a burst of a device's edits to one rebuild while a person can still
 * wait for it; a quarter of an hour is plenty for a server's saves, which come a few a night. The
 * edit function's saves are each a change a member made on purpose and is waiting to see, and the
 * boards take about half a minute to build at the real size (26 to 31 s for every board of the 29
 * September 2026 pool, measured with `npm run live:bench` on 4 October), so a quarter of a minute
 * gathers a quick run of them, a page of Pool health answers, into one build without adding much to
 * the wait.
 */
export const REBUILD_WINDOW_S = { edit: 120, server: 900, live: 15 } as const;

/**
 * How long after its window closes a rebuild runs, in seconds. A device's edits are rebuilt five
 * seconds after their window, so the last save in it has committed. A server's are checked ten
 * minutes after: its own publish should be in by then, and the check finds it current at the cost
 * of three reads, or publishes it if that publish failed. The edit function's are rebuilt three
 * seconds after: the trigger hears each save once it has committed.
 */
export const REBUILD_SETTLE_S = { edit: 5, server: 600, live: 3 } as const;

/**
 * The devices that are servers publishing their own saves' boards. `device` is whatever the saving
 * client says it is, since the rules let any member write the copy, so the name only picks the
 * delay: a device naming itself a server delays its own rebuild, and nothing is ever skipped for
 * it. A pull run in the cloud (`cloud-pull`) is not one: it saves each leg and publishes nothing,
 * so its saves are rebuilt as a device's are, rather than checked a quarter of an hour on.
 */
export const SERVER_DEVICES: ReadonlySet<string> = new Set(["nightly"]);

/**
 * The edit function's own name for its saves (`EDIT_DEVICE`), rebuilt soon after each. A device
 * naming itself so only has its saves rebuilt sooner, metered as any other run.
 */
export const LIVE_DEVICES: ReadonlySet<string> = new Set(["live-edit"]);

/** A rebuild a save asks for: of which copy and version, after which kind of save. */
export type RebuildAsk = {
  kind: RebuildKind;
  copy: string;
  version: number;
  /** The copy is new: a first save, or one after the copy was made afresh. */
  reset: boolean;
};

/**
 * - `deleted`: the copy was deleted; its views go with the next copy's first save.
 * - `unreadable`: the saved manifest is not one this build can read.
 * - `newer-schema`, `unknown-key`: a newer build saved the copy, at a schema above this build's or
 *   with a part under a key this build does not keep (`newerBuildOf`). This build cannot load it,
 *   so a run would spend a reservation on every save to no end; the rebuilds wait instead for this
 *   build to be replaced.
 * - `no-board-input`: nothing a board reads moved (`boardInputsPrint`): a refresh log, a tidy stamp,
 *   a cadence, a list, an archive's rows, or only the earlier versions kept.
 */
export type RebuildSkip =
  "deleted" | "unreadable" | "newer-schema" | "unknown-key" | "no-board-input";

/**
 * Whether a newer build saved the copy, as its manifest alone shows: a schema above this build's, or
 * a part under a key this build does not keep, which could be one the boards should read. The pool
 * refuses either before it reads a piece (`poolCache.ts`), so neither is worth a reservation.
 */
export const newerBuildOf = (manifest: CloudManifest): "newer-schema" | "unknown-key" | null => {
  if (manifest.schema > DATA_SCHEMA) return "newer-schema";
  return manifest.parts.some(({ key }) => key !== LEAGUE_PART && !isCloudPoolKey(key))
    ? "unknown-key"
    : null;
};

/**
 * Whether a write of the copy's manifest, from `before` to `after` (its fields as stored, `null` or
 * `undefined` where there is no document), asks for the boards to be built again.
 */
export const askRebuild = async (
  before: unknown,
  after: unknown
): Promise<{ ask: RebuildAsk } | { skip: RebuildSkip }> => {
  if (after === null || after === undefined) return { skip: "deleted" };
  const next = coerceManifest(after);
  if (!next) return { skip: "unreadable" };
  const newer = newerBuildOf(next);
  if (newer) return { skip: newer };
  const previous = before === null || before === undefined ? null : coerceManifest(before);
  // A copy with nothing before it, or a new copy, is built whatever saved it and whatever it holds:
  // its first boards are all it has.
  if (!previous || previous.copy !== next.copy) {
    return { ask: { kind: "edit", copy: next.copy, version: next.version, reset: true } };
  }
  if ((await boardInputsPrint(previous)) === (await boardInputsPrint(next))) {
    return { skip: "no-board-input" };
  }
  return {
    ask: {
      kind: LIVE_DEVICES.has(next.device)
        ? "live"
        : SERVER_DEVICES.has(next.device)
          ? "server"
          : "edit",
      copy: next.copy,
      version: next.version,
      reset: false,
    },
  };
};

/** What a queued rebuild carries: enough to log, never what to build, which is read when it runs. */
export type RebuildTask = { copy: string; kind: RebuildKind; window: number; savedAt: string };

/**
 * A task as the queue hands it back, or null for anything this build did not queue: only the
 * rebuild's own trigger queues to it, so one of another shape is a mistake to log, not to run.
 */
export const coerceRebuildTask = (raw: unknown): RebuildTask | null => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const { copy, kind, window, savedAt } = raw as Record<string, unknown>;
  if (typeof copy !== "string" || copy === "") return null;
  if (kind !== "edit" && kind !== "server" && kind !== "live") return null;
  if (typeof window !== "number" || !Number.isSafeInteger(window) || window < 0) return null;
  if (typeof savedAt !== "string" || Number.isNaN(Date.parse(savedAt))) return null;
  return { copy, kind, window, savedAt };
};

/**
 * The task a save at `eventTime` (Firestore's commit time) queues: one per kind and window, so
 * every save in a window shares it and the queue keeps one (a second asks for one already there,
 * which counts as done), scheduled after the window's end and its settle. Not one per copy as well:
 * a run builds whatever copy stands when it runs, so the copy in the id would decide nothing, and a
 * client saving under a new copy id each time would queue a task for every save. Its id is a hash,
 * which spreads the queue's ids as the queue asks; never one counting up.
 */
export const rebuildTask = async (
  ask: RebuildAsk,
  eventTime: string
): Promise<{ id: string; scheduleTime: Date; task: RebuildTask }> => {
  const at = Date.parse(eventTime);
  if (Number.isNaN(at)) throw new Error(`A save at no time anyone can read: ${eventTime}`);
  const span = REBUILD_WINDOW_S[ask.kind] * 1000;
  const window = Math.floor(at / span);
  const id = (await hashValue(["rb", ask.kind, window])).slice(0, 40);
  return {
    id,
    scheduleTime: new Date((window + 1) * span + REBUILD_SETTLE_S[ask.kind] * 1000),
    task: { copy: ask.copy, kind: ask.kind, window, savedAt: eventTime },
  };
};

/**
 * What to do about one write of the copy's manifest: queue a rebuild, with the save that asked for
 * it (logged, so how long each save takes to reach the boards can be measured), or skip it and say
 * why.
 * `readSwitch` reads whether rebuilds are on (`ops/rebuild`), and only for a save that asks for
 * one; a read that fails counts as on, since the rebuild reads the switch again before it spends
 * anything and a skipped save is only made good by the next night.
 */
export const planCopyWrite = async ({
  before,
  after,
  eventTime,
  readSwitch,
}: {
  before: unknown;
  after: unknown;
  eventTime: string;
  readSwitch: () => Promise<boolean>;
}): Promise<
  | { enqueue: { id: string; scheduleTime: Date; task: RebuildTask }; ask: RebuildAsk }
  | { skip: RebuildSkip | "off" }
> => {
  const asked = await askRebuild(before, after);
  if ("skip" in asked) return asked;
  // A reader that throws before it has a promise to hand back has failed to read as surely.
  const on = await Promise.resolve()
    .then(readSwitch)
    .catch(() => true);
  if (!on) return { skip: "off" };
  return { enqueue: await rebuildTask(asked.ask, eventTime), ask: asked.ask };
};
