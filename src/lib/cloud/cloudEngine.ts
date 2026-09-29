import { chunkId, chunkIdsOf, type CloudManifest, type ManifestPart } from "./cloudManifest";
import { hashValue, packValue, unpackChunks } from "./cloudPack";

/**
 * Moving this browser's data to the cloud copy and back, with the two stores it moves between
 * handed in, so every rule here is tested against stand-ins (`cloudEngine.test.ts`) rather than
 * against Firestore.
 */

/** The cloud copy's store: Firestore in the app (`firebaseCloud.ts`). */
export type CloudStore = {
  readManifest: () => Promise<CloudManifest | null>;
  /**
   * Replaces the manifest only if it is still at `expected` (null: there is none yet), and says
   * whether it did. A transaction in Firestore; the one write that decides which copy is current.
   */
  commitManifest: (expected: number | null, next: CloudManifest) => Promise<boolean>;
  putChunk: (id: string, data: Uint8Array<ArrayBuffer>) => Promise<void>;
  /** A piece, or null when it is not there (a copy that moved on while it was being read). */
  getChunk: (id: string) => Promise<Uint8Array | null>;
  deleteChunk: (id: string) => Promise<void>;
};

/** This browser's data, as the cloud copy sees it: stored keys and their values. */
export type LocalSource = {
  /** Every key this device keeps in the cloud and holds a value for now. */
  keys: () => string[];
  /** A key's value; null for a key this device does not hold. */
  read: (key: string) => Promise<unknown>;
  /**
   * Writes these values, null removing a key, without counting them as changes made here. Says
   * whether all of it landed.
   */
  apply: (values: ReadonlyMap<string, unknown>) => Promise<boolean>;
};

/** What this device knows of the cloud copy, kept between visits (`cloudState.ts`). */
export type SyncState = {
  /** The manifest version this device last matched, or null if it never has. */
  version: number | null;
  /** Each key's fingerprint as of that version. */
  hashes: Record<string, string>;
  /**
   * The keys changed here since, each with when. A time rather than a flag, so a save can take
   * away exactly the changes it sent and leave one made while it was sending.
   */
  dirty: Record<string, number>;
  syncedAt?: string;
};

export type Progress = (done: number, total: number) => void;

/** How many pieces of one value travel at once. */
const PARALLEL_CHUNKS = 4;

/** The state after a copy is matched: its version and fingerprints, and nothing owed. */
const matched = (
  manifest: CloudManifest,
  dirty: Record<string, number>,
  now: string
): SyncState => ({
  version: manifest.version,
  hashes: Object.fromEntries(manifest.parts.map((part) => [part.key, part.hash])),
  dirty,
  syncedAt: now,
});

/** Takes away the changes that were sent, keeping any made to a key since it was read. */
export const withoutSent = (
  dirty: Readonly<Record<string, number>>,
  sent: Readonly<Record<string, number>>
): Record<string, number> =>
  Object.fromEntries(Object.entries(dirty).filter(([key, at]) => sent[key] !== at));

const sameParts = (a: readonly ManifestPart[], b: readonly ManifestPart[]): boolean => {
  if (a.length !== b.length) return false;
  const byKey = new Map(a.map((part) => [part.key, part.hash]));
  return b.every((part) => byKey.get(part.key) === part.hash);
};

export type SendResult =
  /**
   * `sent` is the changes this save covered. The caller takes them away from the changes it has
   * recorded since (`withoutSent`), which keeps any made while the save was running.
   */
  | { ok: true; state: SyncState; sent: Record<string, number>; uploaded: number }
  /** Another device saved since this one last looked: somebody has to choose. */
  | { ok: false; reason: "moved" };

/**
 * Sends this device's copy to the cloud.
 *
 * Only what the cloud does not already have travels: a value is fingerprinted, and one whose
 * fingerprint is already stored is named, not sent. A key unchanged since the last save is not
 * even read, since its fingerprint is known. The manifest goes last, and only if the cloud is still
 * where this device last saw it; otherwise nothing is overwritten and the answer is `moved`.
 * `replace` is the user's answer to that question in this device's favour, and sends everything.
 *
 * Pieces the old manifest named and the new one does not are deleted afterwards, as best it can: a
 * piece left behind costs a little storage and nothing else, and the next save tries again.
 */
export const sendLocal = async ({
  store,
  local,
  state,
  device,
  now,
  replace = false,
  onProgress,
}: {
  store: CloudStore;
  local: LocalSource;
  state: SyncState;
  device: string;
  now: string;
  replace?: boolean;
  onProgress?: Progress;
}): Promise<SendResult> => {
  const manifest = await store.readManifest();
  const expected = manifest?.version ?? null;
  if (!replace && manifest && manifest.version !== state.version)
    return { ok: false, reason: "moved" };

  // What the cloud holds right now, which is what a value can be carried forward from.
  const inCloud = new Map((manifest?.parts ?? []).map((part) => [part.key, part]));
  const storedHashes = new Set((manifest?.parts ?? []).map((part) => part.hash));
  const trusted = !replace && manifest !== null && manifest.version === state.version;
  const sent = { ...state.dirty };

  const keys = local.keys();
  const parts: ManifestPart[] = [];
  let uploaded = 0;
  for (const [index, key] of keys.entries()) {
    const carried = inCloud.get(key);
    if (trusted && carried && !(key in sent) && state.hashes[key] === carried.hash) {
      parts.push(carried);
      continue;
    }
    const value = await local.read(key);
    if (value === null || value === undefined) continue;
    const packed = await packValue(value);
    if (!storedHashes.has(packed.hash)) {
      // A few at a time: one by one leaves a phone's connection idle between pieces, and all at
      // once asks it to hold a nationwide pool's worth of requests open together.
      for (let at = 0; at < packed.chunks.length; at += PARALLEL_CHUNKS) {
        await Promise.all(
          packed.chunks
            .slice(at, at + PARALLEL_CHUNKS)
            .map((chunk, offset) => store.putChunk(chunkId(packed.hash, at + offset), chunk))
        );
      }
      storedHashes.add(packed.hash);
      uploaded += 1;
    }
    parts.push({ key, hash: packed.hash, bytes: packed.bytes, chunks: packed.chunks.length });
    onProgress?.(index + 1, keys.length);
  }

  // Nothing different: owe nothing, and spend no write on a manifest that says the same thing.
  if (manifest && sameParts(manifest.parts, parts)) {
    return { ok: true, state: matched(manifest, {}, now), sent, uploaded };
  }

  const next: CloudManifest = { version: (expected ?? 0) + 1, updatedAt: now, device, parts };
  if (!(await store.commitManifest(expected, next))) return { ok: false, reason: "moved" };

  const kept = chunkIdsOf(next);
  for (const id of chunkIdsOf(manifest)) {
    if (kept.has(id)) continue;
    await store.deleteChunk(id).catch(() => undefined);
  }
  return { ok: true, state: matched(next, {}, now), sent, uploaded };
};

export type TakeResult =
  | { ok: true; state: SyncState; downloaded: number }
  /** A piece was missing (the copy moved on while being read), or the device refused a write. */
  | { ok: false; reason: "missing" | "refused" };

/**
 * Makes this device's copy the cloud's.
 *
 * A value whose fingerprint this device already holds, and has not changed since, is not fetched.
 * Everything else the manifest names is, and a key this device holds that the cloud copy does not
 * is removed: the copy is the cloud's, not a mixture. Nothing is written until every value has
 * arrived and unpacked, so a copy that fails to download leaves this device exactly as it was.
 */
export const takeCloud = async ({
  store,
  local,
  state,
  manifest,
  now,
  onProgress,
}: {
  store: CloudStore;
  local: LocalSource;
  state: SyncState;
  manifest: CloudManifest;
  now: string;
  onProgress?: Progress;
}): Promise<TakeResult> => {
  const values = new Map<string, unknown>();
  const wanted = manifest.parts.filter(
    (part) =>
      !(
        state.version !== null &&
        !(part.key in state.dirty) &&
        state.hashes[part.key] === part.hash
      )
  );
  for (const [index, part] of wanted.entries()) {
    const chunks = await Promise.all(
      Array.from({ length: part.chunks }, (_, at) => store.getChunk(chunkId(part.hash, at)))
    );
    if (chunks.some((chunk) => chunk === null)) return { ok: false, reason: "missing" };
    values.set(part.key, await unpackChunks(chunks as Uint8Array[]));
    onProgress?.(index + 1, wanted.length);
  }
  const named = new Set(manifest.parts.map((part) => part.key));
  for (const key of local.keys()) {
    if (!named.has(key)) values.set(key, null);
  }
  if (values.size > 0 && !(await local.apply(values))) return { ok: false, reason: "refused" };
  return { ok: true, state: matched(manifest, {}, now), downloaded: wanted.length };
};

/**
 * Whether this device's copy is the cloud's already, without sending or fetching anything: every
 * key it holds has the fingerprint the manifest names, and it holds every key the manifest names.
 * For a device meeting a cloud copy for the first time, which need not ask which one wins when
 * they are the same.
 */
export const matchesCloud = async (
  local: LocalSource,
  manifest: CloudManifest
): Promise<boolean> => {
  const keys = local.keys();
  if (keys.length !== manifest.parts.length) return false;
  const byKey = new Map(manifest.parts.map((part) => [part.key, part.hash]));
  for (const key of keys) {
    const hash = byKey.get(key);
    if (!hash || hash !== (await hashValue(await local.read(key)))) return false;
  }
  return true;
};
