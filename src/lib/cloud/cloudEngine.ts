import {
  chunkId,
  chunkIdsOf,
  DATA_SCHEMA,
  keptStill,
  MANIFEST_FORMAT,
  randomId,
  type CloudManifest,
  type KeptPart,
  type ManifestPart,
} from "./cloudManifest";
import { DamagedValueError, hashJson, packHashed, unpackChunks } from "./cloudPack";

/**
 * Moving values to the cloud copy and back, with the store handed in, so every rule here is tested
 * against a stand-in (`cloudEngine.test.ts`) rather than against Firestore. What to move, and when,
 * is `cloudPlan.ts` and `cloudSession.ts`; this only moves it, one commit at a time.
 */

/** The cloud copy's store: Firestore in the app (`firebaseCloud.ts`). */
export type CloudStore = {
  /** The manifest, or null when there is none. Throws on one it cannot read, never nulls it. */
  readManifest: () => Promise<CloudManifest | null>;
  /**
   * Replaces the manifest only if it is still the version and copy this device read (null: there
   * must be none at all), and says whether it did. A transaction in Firestore; the one write that
   * decides which copy is current.
   */
  commitManifest: (
    expected: { version: number; copy: string } | null,
    next: CloudManifest
  ) => Promise<boolean>;
  putChunk: (id: string, data: Uint8Array<ArrayBuffer>) => Promise<void>;
  /** A piece, or null when it is not there. */
  getChunk: (id: string) => Promise<Uint8Array | null>;
  deleteChunk: (id: string) => Promise<void>;
};

export type Progress = (done: number, total: number) => void;

/** How many pieces travel at once, each way. */
const PARALLEL_CHUNKS = 4;

/** Thrown by a store call that takes longer than it should: a stalled request, not a slow one. */
export class CloudTimeoutError extends Error {
  constructor(what: string) {
    super(`The cloud took too long to answer (${what}).`);
    this.name = "CloudTimeoutError";
  }
}

const timed = <T>(work: Promise<T>, ms: number, what: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new CloudTimeoutError(what)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });

/**
 * `store` with a limit on every call. Firestore's lite SDK sets none: a request the network drops
 * without closing waits for ever, and with it everything waiting on this device's lock.
 */
export const timedStore = (
  store: CloudStore,
  limits: { manifest: number; chunk: number } = { manifest: 20_000, chunk: 90_000 }
): CloudStore => ({
  readManifest: () => timed(store.readManifest(), limits.manifest, "reading the copy"),
  commitManifest: (expected, next) =>
    timed(store.commitManifest(expected, next), limits.manifest, "saving the copy"),
  putChunk: (id, data) => timed(store.putChunk(id, data), limits.chunk, "sending a piece"),
  getChunk: (id) => timed(store.getChunk(id), limits.chunk, "fetching a piece"),
  deleteChunk: (id) => timed(store.deleteChunk(id), limits.chunk, "tidying a piece"),
});

/** A few at a time, in order of starting, each awaited: `work` for every item. */
const inBatches = async <T>(items: readonly T[], work: (item: T) => Promise<void>) => {
  for (let at = 0; at < items.length; at += PARALLEL_CHUNKS) {
    await Promise.all(items.slice(at, at + PARALLEL_CHUNKS).map(work));
  }
};

/** A value to put in the copy, or null to take its key out. */
export type Change = {
  key: string;
  value: unknown;
  /** When it changed on this device, in ms: what a later change on another device is set against. */
  at: number;
};

export type CommitResult =
  | {
      ok: true;
      /** The manifest now current, whether this commit wrote it or found nothing to change. */
      manifest: CloudManifest;
      /** Each changed key's fingerprint as stored, or null for a key taken out. */
      sent: Record<string, string | null>;
      /** How many values had to be uploaded, rather than named from pieces already stored. */
      uploaded: number;
    }
  /** Another device saved, or made the first copy, since `base` was read. Nothing was changed. */
  | { ok: false; reason: "moved" };

const partKey = (part: ManifestPart): string => `${part.key}\n${part.hash}\n${part.id}`;
const keptKey = (part: KeptPart): string => `${partKey(part)}\n${part.group}\n${part.why}`;

const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length !== b.length) return false;
  const seen = new Set(a);
  return b.every((one) => seen.has(one));
};

/**
 * One commit to the cloud copy, onto `base`, the manifest this device read (null: a first copy,
 * where there must be none). In one step, it can:
 * - `changes`: put values in the copy, or take keys out of it;
 * - `keepReplaced`: keep the copy's current value of these keys before a change here replaces it
 *   (a later change on this device winning over another device's);
 * - `keepLost`: keep these values of this device's that the copy's will replace here (another
 *   device's later change winning, or this device's data from before it joined the copy);
 * - `restore`: make a kept settlement current again, keeping what it replaces in turn.
 *
 * A value whose fingerprint the copy already holds is named from the pieces it has, never uploaded
 * again. Every upload gets pieces of its own name, recorded through `onUploads` before the first is
 * sent, so pieces a save left behind can be found and cleared. The manifest goes last, and only
 * onto the version and copy read; if that moved on, this save's own pieces are cleared and the
 * answer is `moved`. A commit whose reply was lost is recognised by its save id. The pieces the old
 * manifest named and the new one does not are deleted afterwards, as best it can.
 */
export const commitChanges = async ({
  store,
  base,
  copy,
  changes = [],
  keepReplaced = [],
  keepLost = [],
  restore,
  device,
  now,
  onUploads,
  onProgress,
}: {
  store: CloudStore;
  base: CloudManifest | null;
  /** For a first copy: the id to give it. A new one at random when absent. */
  copy?: string;
  changes?: readonly Change[];
  keepReplaced?: readonly string[];
  keepLost?: readonly Change[];
  restore?: string;
  device: string;
  now: string;
  onUploads?: (chunkIds: string[]) => void;
  onProgress?: Progress;
}): Promise<CommitResult> => {
  const parts = new Map((base?.parts ?? []).map((part) => [part.key, part]));
  const stored = new Map<string, ManifestPart>();
  for (const part of [...(base?.parts ?? []), ...(base?.kept ?? [])]) stored.set(part.hash, part);
  const group = randomId();
  const newKept: KeptPart[] = [];
  const uploads: string[] = [];
  const sent: Record<string, string | null> = {};
  let uploaded = 0;
  const total = changes.length + keepLost.length;
  let done = 0;

  /** The stored part for a value: named from pieces already there, or uploaded. */
  const partFor = async (change: Change): Promise<ManifestPart> => {
    const hashed = await hashJson(change.value);
    const known = stored.get(hashed.hash);
    const meta = {
      key: change.key,
      hash: hashed.hash,
      bytes: hashed.bytes,
      at: change.at,
      by: device,
    };
    if (known) return { ...meta, chunks: known.chunks, id: known.id };
    const chunks = await packHashed(hashed);
    const id = randomId();
    const ids = chunks.map((_, index) => chunkId(id, index));
    uploads.push(...ids);
    onUploads?.([...uploads]);
    await inBatches(
      chunks.map((chunk, index) => [ids[index] ?? chunkId(id, index), chunk] as const),
      ([chunkName, chunk]) => store.putChunk(chunkName, chunk)
    );
    uploaded += 1;
    const part = { ...meta, chunks: chunks.length, id };
    stored.set(part.hash, part);
    return part;
  };

  for (const key of keepReplaced) {
    const current = parts.get(key);
    if (current) newKept.push({ ...current, group, keptAt: now, why: "replaced" });
  }
  for (const lost of keepLost) {
    if (lost.value !== null && lost.value !== undefined) {
      newKept.push({ ...(await partFor(lost)), group, keptAt: now, why: "lost" });
    }
    done += 1;
    onProgress?.(done, total);
  }
  for (const change of changes) {
    if (change.value === null || change.value === undefined) {
      parts.delete(change.key);
      sent[change.key] = null;
    } else {
      const part = await partFor(change);
      parts.set(change.key, part);
      sent[change.key] = part.hash;
    }
    done += 1;
    onProgress?.(done, total);
  }

  let kept = base?.kept ?? [];
  if (restore) {
    const bringing = kept.filter((part) => part.group === restore);
    kept = kept.filter((part) => part.group !== restore);
    for (const { group: _group, keptAt: _keptAt, why: _why, ...part } of bringing) {
      const current = parts.get(part.key);
      if (current) newKept.push({ ...current, group, keptAt: now, why: "replaced" });
      parts.set(part.key, { ...part, at: Date.parse(now), by: device });
      sent[part.key] = part.hash;
    }
  }
  kept = keptStill([...kept, ...newKept], now);

  const nextParts = [...parts.values()];
  if (
    base &&
    sameSet(base.parts.map(partKey), nextParts.map(partKey)) &&
    sameSet(base.kept.map(keptKey), kept.map(keptKey))
  ) {
    // Nothing different: spend no write on a manifest that says the same thing.
    return { ok: true, manifest: base, sent, uploaded };
  }

  const next: CloudManifest = {
    format: MANIFEST_FORMAT,
    schema: Math.max(base?.schema ?? DATA_SCHEMA, DATA_SCHEMA),
    copy: base?.copy ?? copy ?? randomId(),
    version: (base?.version ?? 0) + 1,
    save: randomId(),
    updatedAt: now,
    device,
    parts: nextParts,
    kept,
  };
  let committed = await store.commitManifest(
    base ? { version: base.version, copy: base.copy } : null,
    next
  );
  if (!committed) {
    // A commit that landed, whose reply was lost and retried, reads as refused: found by its id.
    let current: CloudManifest | null | undefined;
    try {
      current = await store.readManifest();
    } catch {
      current = undefined;
    }
    if (current?.save === next.save) {
      committed = true;
    } else {
      // These pieces are this save's alone, by name, so a copy that is not this save's cannot be
      // naming them. Without an answer that it is not, they stay, recorded, for `sweepUploads`.
      if (current !== undefined) {
        await inBatches(uploads, (id) => store.deleteChunk(id).catch(() => undefined));
      }
      return { ok: false, reason: "moved" };
    }
  }

  const named = chunkIdsOf(next);
  const orphans = [...chunkIdsOf(base)].filter((id) => !named.has(id));
  await inBatches(orphans, (id) => store.deleteChunk(id).catch(() => undefined));
  return { ok: true, manifest: next, sent, uploaded };
};

/**
 * Pieces a save uploaded and never committed, the page closed or the save cut off before its
 * manifest went: every recorded name the current manifest does not use. Their names are the
 * interrupted upload's own, so none can belong to a value the copy names.
 */
export const sweepUploads = async (
  store: CloudStore,
  manifest: CloudManifest | null,
  recorded: readonly string[]
): Promise<void> => {
  const named = chunkIdsOf(manifest);
  await inBatches(
    recorded.filter((id) => !named.has(id)),
    (id) => store.deleteChunk(id).catch(() => undefined)
  );
};

export type FetchResult =
  | { ok: true; values: Map<string, unknown> }
  /**
   * `missing`: a piece is not there. `damaged`: the pieces do not make the value the manifest
   * names. Either way nothing arrived, and nothing has been written.
   */
  | { ok: false; reason: "missing" | "damaged"; key: string };

/**
 * The values of `parts`, downloaded, unpacked and each checked against its fingerprint. Everything
 * arrives before anything is returned, so a take that fails part way writes nothing.
 */
export const fetchValues = async ({
  store,
  parts,
  onProgress,
}: {
  store: CloudStore;
  parts: readonly ManifestPart[];
  onProgress?: Progress;
}): Promise<FetchResult> => {
  const values = new Map<string, unknown>();
  for (const [index, part] of parts.entries()) {
    const chunks: (Uint8Array | null)[] = new Array<Uint8Array | null>(part.chunks).fill(null);
    await inBatches(
      Array.from({ length: part.chunks }, (_, at) => at),
      async (at) => {
        chunks[at] = await store.getChunk(chunkId(part.id, at));
      }
    );
    if (chunks.some((chunk) => chunk === null)) {
      return { ok: false, reason: "missing", key: part.key };
    }
    try {
      values.set(part.key, await unpackChunks(chunks as Uint8Array[], part.hash));
    } catch (error) {
      if (error instanceof DamagedValueError) {
        return { ok: false, reason: "damaged", key: part.key };
      }
      throw error;
    }
    onProgress?.(index + 1, parts.length);
  }
  return { ok: true, values };
};
