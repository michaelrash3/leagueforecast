import type { CloudStore } from "../cloud/cloudEngine";
import type { FirestoreRestDocuments } from "../cloud/firestoreRest";
import { boardsState } from "./boardInputs";
import { leaguePrintOf, readCloudLeague, type LeagueDocsList } from "./cloudLeague";
import { rebuildJobControl } from "./rebuildJobControl";
import { coerceLedger, restLedgerStore } from "./rebuildLedger";
import { LIVE_SPACING_S, newerBuildOf, spacedTask, type RebuildTask } from "./rebuildPlan";
import { coerceLiveMeta, type LiveStore } from "./viewStore";

/** Cheap preflight and coalescing shared by the task function and deployment's first request. */
export const requestRebuildJob = async (
  task: RebuildTask,
  deps: {
    docs: Pick<FirestoreRestDocuments, "readAt" | "replace">;
    copyStore: CloudStore;
    liveStore: LiveStore;
    leagueDocs: LeagueDocsList;
    launch: () => Promise<void>;
    enqueue: (next: Awaited<ReturnType<typeof spacedTask>>) => Promise<void>;
    now: () => number;
    today: () => string;
    taskId?: string;
  }
): Promise<{ end: string; until?: string }> => {
  const ledger = coerceLedger((await restLedgerStore(deps.docs).read()).raw);
  if (!ledger?.on) return { end: "off" };
  const control = rebuildJobControl(deps.docs, deps.now);
  const active = await control.read();
  if (
    !(active.owner && active.until > deps.now()) &&
    !(Date.parse(active.deferredUntil ?? "") > deps.now())
  ) {
    const manifest = await deps.copyStore.readManifest();
    const newer = manifest ? newerBuildOf(manifest) : null;
    if (!manifest || newer) return { end: newer ?? "no-copy" };
    const league = await readCloudLeague(deps.leagueDocs);
    if (!league.ok) return { end: league.reason };
    const read = await deps.liveStore.readMeta();
    const meta = read ? coerceLiveMeta(read.meta) : null;
    if (read && !meta) return { end: "unreadable" };
    const state = await boardsState(meta, manifest, deps.today(), leaguePrintOf(league));
    if (state !== "stale") return { end: state };
    const due = Date.parse(ledger.lastEndedAt ?? "") + LIVE_SPACING_S * 1000;
    const spaced = task.kind === "live" && due > deps.now() ? await spacedTask(task, due) : null;
    if (spaced && spaced.id !== deps.taskId) {
      await deps.enqueue(spaced);
      return { end: "spaced", until: new Date(due).toISOString() };
    }
  }
  const launch = await control.request(task);
  if (launch) await deps.launch();
  else {
    const held = await control.read();
    const due = Date.parse(held.deferredUntil ?? "");
    if (due > deps.now())
      await deps.enqueue(await spacedTask(task, Math.min(due, deps.now() + 29 * 86400_000)));
  }
  return { end: launch ? "launched" : "joined" };
};
