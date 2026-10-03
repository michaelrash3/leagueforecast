import type { CloudStore } from "../cloud/cloudEngine";
import { boardsState } from "./boardInputs";
import type { PoolCache, PoolEnsure } from "./poolCache";
import { dryLiveStore, publishCopyViews, type CopyPublish } from "./publishCopy";
import {
  coerceLedger,
  reserveRun,
  runCost,
  settleRun,
  updateLedger,
  type LedgerStore,
} from "./rebuildLedger";
import type { RebuildTask } from "./rebuildPlan";
import { coerceLiveMeta, type LiveStore } from "./viewStore";

/**
 * One rebuild of the boards after a save of the copy, in two halves. The worker's (`runRebuild`)
 * brings the pool to the copy as it now stands, and publishes every board from it unless the
 * published ones are already the copy's. The main thread's (`handleRebuildTask`) reads the switch,
 * asks for three reads whether there is anything to do, reserves the run against what the rebuilds
 * may spend, hands it to the worker, settles what it cost, and writes one line of log. Neither
 * writes the copy, so a rebuild never asks for another.
 */

/**
 * How a rebuild ended.
 * - `published`: the boards are the copy's now (or would be, on a dry run).
 * - `current`: they already were.
 * - `older-rules`, `older-day`, `newer-live-schema`: what is published came from newer rules, a
 *   later day, or a newer build, and is left alone.
 * - `copy-replaced`, `no-copy`: the copy was started again under the run, or deleted; its next save
 *   asks for its own boards.
 * - `unreadable`: the published meta is not one this build can read.
 * - the copy's own refusals (`newer-schema` to `kept-moving`), as `PoolEnsure` names them, and the
 *   publish's (`kept-changing`, `locale`, `too-large`).
 */
export type RebuildEnd =
  | "published"
  | "current"
  | "older-rules"
  | "older-day"
  | "newer-live-schema"
  | "copy-replaced"
  | "unreadable"
  | "kept-changing"
  | "locale"
  | "too-large"
  | Extract<PoolEnsure, { ok: false }>["reason"];

export type RebuildResult = {
  end: RebuildEnd;
  /** Whether the same task run again could end otherwise: something kept moving under it. */
  retryable: boolean;
  /** Runs through it: a second when the New York day turned while it ran. */
  tries: number;
  /** The copy's version it loaded, and how: started afresh, the parts and pieces read, how long. */
  version?: number;
  cold?: boolean;
  fetched?: number;
  pieces?: number;
  loadMs?: number;
  /** The boards built and how long that took, then how long the rest of the publish took. */
  boards?: number;
  buildMs?: number;
  publishMs?: number;
  /** Pieces uploaded, whether the meta was written, and retired pieces deleted with it. */
  uploaded?: number;
  wrote?: boolean;
  deleted?: number;
};

/** The ends that are some save or publish moving under the run, which a retry may get past. */
const RETRYABLE: ReadonlySet<RebuildEnd> = new Set([
  "kept-moving",
  "kept-changing",
  "store-refused",
]);

/**
 * The ends that are the rebuild doing its job or standing aside for a newer one. Every other end is
 * a failure the ledger counts toward a pause: a copy or a meta this build cannot read, a store that
 * refused, and a run that never got past what moved under it.
 */
const FINE: ReadonlySet<RebuildEnd> = new Set([
  "published",
  "current",
  "older-rules",
  "older-day",
  "copy-replaced",
  "no-copy",
]);

const endOfPublish = (reason: Extract<CopyPublish, { ok: false }>["reason"]): RebuildEnd => {
  if (reason === "newer-schema") return "newer-live-schema";
  // A publish handed the seasons never reads the copy's League Standings part, which is the only
  // way it says a save moved the copy; were it to, the run is one a retry gets past.
  if (reason === "copy-moved") return "kept-moving";
  return reason;
};

/**
 * Brings `pool` to the copy as `copyStore` holds it now and publishes every board from it, unless
 * the published boards are already that copy's for `today()` (`boardsState`), both read against
 * the very manifest the pool was brought to. On a dry run the publish writes nothing. A publish
 * turned away because the published boards are for a later day than it read goes once more if the
 * New York day turned while it ran, before `deadline` (by `clock`), and otherwise ends there.
 */
export const runRebuild = async ({
  copyStore,
  liveStore,
  pool,
  today,
  now,
  dry = false,
  locale,
  clock = Date.now,
  deadline = Number.POSITIVE_INFINITY,
}: {
  /** The copy, read only: the rebuild never writes it. */
  copyStore: CloudStore;
  liveStore: LiveStore;
  pool: PoolCache;
  /** New York's day, asked for as each run through starts. */
  today: () => string;
  now: () => string;
  dry?: boolean;
  locale?: string;
  clock?: () => number;
  deadline?: number;
}): Promise<RebuildResult> => {
  for (let tries = 1; ; tries += 1) {
    const day = today();
    // Once more only for a day that has turned since this run read it, and with time left.
    const again = () => tries < 2 && clock() < deadline && today() !== day;

    const loading = clock();
    const ensured = await pool.ensure(copyStore);
    const loadMs = clock() - loading;
    if (!ensured.ok) {
      return { end: ensured.reason, retryable: RETRYABLE.has(ensured.reason), tries, loadMs };
    }
    const base = {
      tries,
      version: ensured.manifest.version,
      cold: ensured.cold,
      fetched: ensured.fetched.length,
      pieces: ensured.pieces,
      loadMs,
    };

    const read = await liveStore.readMeta();
    const meta = read ? coerceLiveMeta(read.meta) : null;
    if (read && !meta) return { ...base, end: "unreadable", retryable: false };
    const state = await boardsState(meta, ensured.manifest, day);
    if (state === "older-day" && again()) continue;
    if (state !== "stale") {
      const end = state === "newer-schema" ? "newer-live-schema" : state;
      return { ...base, end, retryable: false };
    }

    const publishing = clock();
    const published = await publishCopyViews({
      copyStore,
      liveStore: dry ? dryLiveStore(liveStore) : liveStore,
      manifest: ensured.manifest,
      today: day,
      now,
      readSeason: ensured.readSeason,
      sweep: "due",
      ...(locale === undefined ? {} : { locale }),
    });
    const tookMs = clock() - publishing;
    if (!published.ok) {
      if (published.reason === "older-day" && again()) continue;
      const end = endOfPublish(published.reason);
      return { ...base, end, retryable: RETRYABLE.has(end), publishMs: tookMs };
    }
    return {
      ...base,
      end: "published",
      retryable: false,
      boards: published.boards,
      buildMs: published.buildMs,
      publishMs: Math.max(0, tookMs - published.buildMs),
      uploaded: published.publish.pieces,
      wrote: published.publish.wrote,
      deleted: published.publish.deleted,
    };
  }
};

/** Whether a run's end counts as a failure toward the ledger's pause. */
export const isRebuildFailure = (end: RebuildEnd): boolean => !FINE.has(end);

/**
 * One queued rebuild, on the main thread of the function that runs it. In order, each step stopping
 * there when it says so:
 * 1. The switch (`ops/rebuild`): absent, unreadable or off ends it.
 * 2. Whether the published boards are already the copy's, or another's to leave alone: the ledger,
 *    the manifest and the meta, three reads, reserving nothing and starting no worker.
 * 3. A reservation of the run's ceiling, which the caps or a pause may refuse.
 * 4. The run, in the worker (`run`), dry or live and warm or not as the switch says.
 * 5. What it cost put in place of its ceiling, from the time since this began plus the instance's
 *    start-up (`startupS`), and the run counted as failed if it threw or ended in a failure.
 *
 * It answers one line to log, and whether to throw so the queue tries the task again: only for a
 * run that threw or ended in something that moved under it.
 */
export const handleRebuildTask = async ({
  ledger,
  copyStore,
  liveStore,
  run,
  today,
  now,
  clock,
  size,
  startupS,
  task,
}: {
  ledger: LedgerStore;
  copyStore: CloudStore;
  liveStore: LiveStore;
  run: (request: { dry: boolean; warm: boolean }) => Promise<RebuildResult>;
  today: () => string;
  now: () => string;
  clock: () => number;
  /** The instance's memory in GiB and its vCPUs, which its time is billed by. */
  size: { gib: number; cpu: number };
  /** Seconds the instance spent starting before this task, the first time; nothing after. */
  startupS: () => number;
  /** The task as queued, for the line: when the save that asked for it was made. */
  task?: RebuildTask;
}): Promise<{ line: Record<string, string | number | boolean>; rethrow: boolean }> => {
  const began = clock();
  const asked: Record<string, string> = task ? { kind: task.kind, savedAt: task.savedAt } : {};
  const day = today();

  const held = coerceLedger((await ledger.read()).raw);
  if (!held?.on) return { line: { ...asked, end: "off" }, rethrow: false };

  const manifest = await copyStore.readManifest();
  if (!manifest) return { line: { ...asked, end: "no-copy" }, rethrow: false };
  const read = await liveStore.readMeta();
  const meta = read ? coerceLiveMeta(read.meta) : null;
  if (read && !meta) return { line: { ...asked, end: "unreadable" }, rethrow: false };
  const state = await boardsState(meta, manifest, day);
  if (state !== "stale") {
    const end = state === "newer-schema" ? "newer-live-schema" : state;
    return { line: { ...asked, end, version: manifest.version }, rethrow: false };
  }

  const at = now();
  const reserved = await updateLedger(ledger, (current) => {
    const answer = reserveRun(current, day, at);
    return { next: answer.next, answer };
  });
  if ("contended" in reserved) return { line: { ...asked, end: "contended" }, rethrow: false };
  if (!reserved.answer.ok) {
    return { line: { ...asked, end: reserved.answer.why }, rethrow: false };
  }
  const { mode, warm } = reserved.answer.next;

  let result: RebuildResult | null = null;
  let error: string | null = null;
  try {
    result = await run({ dry: mode === "dry", warm });
  } catch (thrown) {
    error = thrown instanceof Error ? thrown.message : String(thrown);
  }
  const failed = result === null || isRebuildFailure(result.end);
  const used = runCost((clock() - began) / 1000 + startupS(), size);
  const settled = await updateLedger(ledger, (current) => ({
    next: settleRun(current, { at, used, failed, today: today() }),
    answer: null,
  }));

  const { retryable = true, ...ran } = result ?? {};
  return {
    line: {
      ...asked,
      ...ran,
      end: result?.end ?? "threw",
      ...(error === null ? {} : { error }),
      mode,
      gibs: used.gibs,
      vcpuS: used.vcpuS,
      settled: "answer" in settled && settled.wrote,
      ...(result?.end === "published" ? { publishedAt: now() } : {}),
    },
    rethrow: retryable,
  };
};

/**
 * When to start a fresh worker after a run: once its heap or the process has grown past what a
 * warm pool and one build should leave, or after enough runs that whatever creeps has had its
 * chance. A fresh start costs seconds; a worker that runs out of memory mid-build costs the run.
 */
export const RECYCLE_AT = { heapUsedMb: 3_072, rssMb: 6_144, runs: 200 } as const;

export const shouldRecycle = (
  memory: { heapUsedMb: number; rssMb: number },
  runs: number
): boolean =>
  memory.heapUsedMb > RECYCLE_AT.heapUsedMb ||
  memory.rssMb > RECYCLE_AT.rssMb ||
  runs >= RECYCLE_AT.runs;

/**
 * How long a save took to reach the members' boards, from the rebuilds' log lines: for each run
 * that published, from the save that queued its task to the publish. Coalesced saves share the
 * first save's task, so this is the wait of the first save in each window, the longest of them.
 */
export const liveLags = (
  lines: readonly unknown[]
): { runs: number; medianS: number; p90S: number; maxS: number } | null => {
  const lags = lines
    .flatMap((line) => {
      if (typeof line !== "object" || line === null) return [];
      const { end, savedAt, publishedAt } = line as Record<string, unknown>;
      if (end !== "published" || typeof savedAt !== "string" || typeof publishedAt !== "string") {
        return [];
      }
      const seconds = (Date.parse(publishedAt) - Date.parse(savedAt)) / 1000;
      return Number.isFinite(seconds) && seconds >= 0 ? [seconds] : [];
    })
    .sort((a, b) => a - b);
  if (lags.length === 0) return null;
  const at = (share: number) =>
    lags[Math.min(lags.length - 1, Math.ceil(share * lags.length) - 1)]!;
  const middle = lags.length / 2;
  const medianS =
    lags.length % 2 === 1 ? lags[Math.floor(middle)]! : (lags[middle - 1]! + lags[middle]!) / 2;
  return { runs: lags.length, medianS, p90S: at(0.9), maxS: lags[lags.length - 1]! };
};
