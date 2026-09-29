import {
  chunkId,
  chunkIdsOf,
  MANIFEST_FORMAT,
  type CloudManifest,
  type ManifestPart,
} from "./cloudManifest";
import { hashValue, packValue, unpackChunks } from "./cloudPack";

/**
 * Moving this browser's data to the cloud copy and back, with the two stores it moves between
 * handed in, so every rule here is tested against stand-ins (`cloudEngine.test.ts`) rather than
 * against Firestore.
 *
 * The rule everything here keeps: a value leaves the cloud copy only because a device recorded
 * removing it, and leaves a device only because the copy dropped a value that device had synced.
 * Never because one side merely does not hold it. A device whose storage failed to open, or that
 * cannot read a value, holds less than it should, and that must not travel.
 */

/** The cloud copy's store: Firestore in the app (`firebaseCloud.ts`). */
export type CloudStore = {
  /** The manifest, or null when there is none. Throws on one it cannot read, never nulls it. */
  readManifest: () => Promise<CloudManifest | null>;
  /**
   * Replaces the manifest only if it is still at `expected` (null: there must be none), and says
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
   * Writes these values, null removing a key, without counting them as changes made here. Writes
   * nothing, and says so, if any of it is not a value this device knows how to hold; otherwise
   * says whether all of it landed.
   */
  apply: (values: ReadonlyMap<string, unknown>) => Promise<boolean>;
  /**
   * Whether this device's stores can be read at all. One that cannot holds less than it has, and
   * syncs nothing until it can.
   */
  usable: () => boolean;
};

/** What this device knows of the cloud copy, kept between visits (`cloudState.ts`). */
export type SyncState = {
  /** The manifest version this device last matched, or null if it never has. */
  version: number | null;
  /** Which copy that was (`CloudManifest.copy`). */
  copy: string | null;
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

const newCopyId = (): string => {
  try {
    return crypto.randomUUID();
  } catch {
    return `copy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
};

const fingerprints = (manifest: CloudManifest): Record<string, string> =>
  Object.fromEntries(manifest.parts.map((part) => [part.key, part.hash]));

/** The state after a copy is matched: its version, copy and fingerprints. */
const matched = (
  manifest: CloudManifest,
  dirty: Record<string, number>,
  now: string
): SyncState => ({
  version: manifest.version,
  copy: manifest.copy,
  hashes: fingerprints(manifest),
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

/**
 * How a save goes:
 * - `patch`: the changes recorded here (`SyncState.dirty`), onto the copy this device last saw.
 *   Every other value in the copy is carried as it is, whether this device holds it or not; a
 *   recorded change to a key this device no longer holds removes it.
 * - `first`: this device's whole data, as the first copy there is. Refused if one appeared.
 * - `replace`: this device's whole data in place of the copy there is. The user's answer, in this
 *   device's favour, to which copy wins; the one save that can take a value out of the copy
 *   because this device does not hold it.
 */
export type SaveMode = "patch" | "first" | "replace";

export type SendResult =
  /**
   * `sent` is the changes this save covered. The caller takes them away from the changes it has
   * recorded since (`withoutSent`), which keeps any made while the save was running.
   */
  | { ok: true; state: SyncState; sent: Record<string, number>; uploaded: number }
  /**
   * `moved`: another device saved since this one last looked, or made the first copy first.
   * `gone`: a patch found no copy to patch.
   */
  | { ok: false; reason: "moved" | "gone" };

/**
 * Sends this device's copy, or its changes, to the cloud.
 *
 * Only what the cloud does not already have travels: a value is fingerprinted, and one whose
 * fingerprint is already stored is named, not sent. Everything to send is read before the first
 * piece goes, so the copy is one moment's data rather than a mixture from either side of a write
 * that lands while it uploads. The manifest goes last, and only onto the copy this device expected;
 * otherwise nothing is overwritten, the pieces this save uploaded for nothing are cleared away,
 * and the answer is `moved`.
 *
 * Pieces the old manifest named and the new one does not are deleted afterwards, as best it can: a
 * piece left behind costs a little storage and nothing else.
 */
export const sendLocal = async ({
  store,
  local,
  state,
  device,
  now,
  mode,
  onProgress,
}: {
  store: CloudStore;
  local: LocalSource;
  state: SyncState;
  device: string;
  now: string;
  mode: SaveMode;
  onProgress?: Progress;
}): Promise<SendResult> => {
  const manifest = await store.readManifest();
  if (mode === "patch") {
    if (!manifest) return { ok: false, reason: "gone" };
    if (manifest.copy !== state.copy || manifest.version !== state.version) {
      return { ok: false, reason: "moved" };
    }
  }
  if (mode === "first" && manifest) return { ok: false, reason: "moved" };

  const sent = { ...state.dirty };
  const held = new Set(local.keys());
  const keys = mode === "patch" ? Object.keys(sent) : [...held];
  const values = new Map<string, unknown>();
  for (const key of keys) {
    const value = await local.read(key);
    // Listed and yet not readable is a read that failed, not a value removed: nothing is sent
    // rather than a copy short of it.
    if ((value === null || value === undefined) && held.has(key)) {
      throw new Error("This browser could not read all of its data, so nothing was saved.");
    }
    values.set(key, value);
  }

  const parts = new Map<string, ManifestPart>(
    mode === "patch" && manifest ? manifest.parts.map((part) => [part.key, part]) : []
  );
  const storedHashes = new Set((manifest?.parts ?? []).map((part) => part.hash));
  const uploadedIds: string[] = [];
  let uploaded = 0;
  let done = 0;
  for (const [key, value] of values) {
    done += 1;
    if (value === null || value === undefined) {
      // A patch removing what this device recorded removing; a whole copy leaving out what it
      // does not hold.
      parts.delete(key);
      onProgress?.(done, values.size);
      continue;
    }
    const packed = await packValue(value);
    if (!storedHashes.has(packed.hash)) {
      // A few at a time: one by one leaves a phone's connection idle between pieces, and all at
      // once asks it to hold a nationwide pool's worth of requests open together.
      for (let at = 0; at < packed.chunks.length; at += PARALLEL_CHUNKS) {
        await Promise.all(
          packed.chunks.slice(at, at + PARALLEL_CHUNKS).map((chunk, offset) => {
            const id = chunkId(packed.hash, at + offset);
            uploadedIds.push(id);
            return store.putChunk(id, chunk);
          })
        );
      }
      storedHashes.add(packed.hash);
      uploaded += 1;
    }
    parts.set(key, { key, hash: packed.hash, bytes: packed.bytes, chunks: packed.chunks.length });
    onProgress?.(done, values.size);
  }

  const nextParts = [...parts.values()];
  // Nothing different: owe nothing, and spend no write on a manifest that says the same thing.
  if (manifest && sameParts(manifest.parts, nextParts)) {
    return { ok: true, state: matched(manifest, {}, now), sent, uploaded };
  }

  const next: CloudManifest = {
    format: MANIFEST_FORMAT,
    copy: manifest?.copy ?? newCopyId(),
    version: (manifest?.version ?? 0) + 1,
    updatedAt: now,
    device,
    parts: nextParts,
  };
  if (!(await store.commitManifest(manifest?.version ?? null, next))) {
    await clearUnnamed(store, uploadedIds);
    return { ok: false, reason: "moved" };
  }

  const kept = chunkIdsOf(next);
  for (const id of chunkIdsOf(manifest)) {
    if (kept.has(id)) continue;
    await store.deleteChunk(id).catch(() => undefined);
  }
  return { ok: true, state: matched(next, {}, now), sent, uploaded };
};

/**
 * After a save that did not land: the pieces it uploaded, less any the copy that did land names
 * (the same value saved from another device is the same pieces).
 */
const clearUnnamed = async (store: CloudStore, ids: readonly string[]): Promise<void> => {
  if (ids.length === 0) return;
  let named: Set<string>;
  try {
    named = chunkIdsOf(await store.readManifest());
  } catch {
    return;
  }
  for (const id of ids) {
    if (!named.has(id)) await store.deleteChunk(id).catch(() => undefined);
  }
};

/**
 * How a copy is taken:
 * - `update`: the copy's changes since this device last met it. What this device changed and has
 *   not sent is left for it to send; a value the copy dropped is removed here only if this device
 *   had synced it; a value this device holds that the copy never had is left alone.
 * - `replace`: this device becomes the copy exactly. The user's answer, in the cloud's favour, to
 *   which copy wins.
 */
export type TakeMode = "update" | "replace";

export type TakeResult =
  | { ok: true; state: SyncState; downloaded: number }
  /**
   * `missing`: a piece was not there (the copy moved on while it was being read). `refused`: this
   * device would not store it: out of space, or a value it does not know how to hold.
   */
  | { ok: false; reason: "missing" | "refused" };

/**
 * Makes this device's data the cloud copy's, in the way `mode` says.
 *
 * A value whose fingerprint this device already holds, and has not changed since, is not fetched.
 * Nothing is written until every value has arrived and unpacked, so a copy that fails to download
 * leaves this device exactly as it was.
 */
export const takeCloud = async ({
  store,
  local,
  state,
  manifest,
  now,
  mode,
  onProgress,
}: {
  store: CloudStore;
  local: LocalSource;
  state: SyncState;
  manifest: CloudManifest;
  now: string;
  mode: TakeMode;
  onProgress?: Progress;
}): Promise<TakeResult> => {
  // Fingerprints are only this device's own for the copy it met; for another copy it knows none.
  const known = state.copy === manifest.copy ? state.hashes : {};
  const owed = mode === "update" ? state.dirty : {};
  const wanted = manifest.parts.filter(
    (part) => !(part.key in owed) && !(known[part.key] === part.hash && !(part.key in state.dirty))
  );
  const values = new Map<string, unknown>();
  for (const [index, part] of wanted.entries()) {
    const chunks = await Promise.all(
      Array.from({ length: part.chunks }, (_, at) => store.getChunk(chunkId(part.hash, at)))
    );
    if (chunks.some((chunk) => chunk === null)) return { ok: false, reason: "missing" };
    values.set(part.key, await unpackChunks(chunks as Uint8Array[]));
    onProgress?.(index + 1, wanted.length);
  }
  const named = new Set(manifest.parts.map((part) => part.key));
  const leaving =
    mode === "replace"
      ? local.keys().filter((key) => !named.has(key))
      : Object.keys(known).filter((key) => !named.has(key) && !(key in owed));
  for (const key of leaving) values.set(key, null);
  if (values.size > 0 && !(await local.apply(values))) return { ok: false, reason: "refused" };
  return { ok: true, state: matched(manifest, { ...owed }, now), downloaded: wanted.length };
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
