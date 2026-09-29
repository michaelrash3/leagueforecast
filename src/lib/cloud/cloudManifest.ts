/**
 * What the cloud copy is made of, and what a device does about it when the app opens.
 *
 * The cloud copy is a manifest and a heap of pieces. The manifest names every stored value by its
 * key and its fingerprint; the pieces are named by fingerprint, so a value that has not changed is
 * never sent again, and a device that already has a fingerprint never downloads it. The manifest is
 * the only thing that is ever overwritten, and it is written last, in a transaction on its own
 * version, so a copy is either the old one or the new one and never half of each.
 */

/**
 * The manifest's layout. A device refuses a manifest in a layout newer than it knows, rather than
 * misreading it and saving its misreading back over it.
 */
export const MANIFEST_FORMAT = 1;

export type ManifestPart = {
  /** The stored key: a Team Rankings key, or `league` for every League Standings season. */
  key: string;
  hash: string;
  /** The value's JSON size before compression. */
  bytes: number;
  chunks: number;
};

export type CloudManifest = {
  format: number;
  /**
   * Which copy this is: made at random when a copy is first saved, and kept by every save after.
   * A copy started again, after the first was deleted, is a different one, and a device that knew
   * the first must not take the second for a later version of it.
   */
  copy: string;
  /** One more with every save, so a device can tell the copy moved on without reading it. */
  version: number;
  updatedAt: string;
  /** Which device saved it (`DeviceCloudState.device`), for saying "from another device". */
  device: string;
  parts: ManifestPart[];
};

/** A piece's document id: the value's fingerprint and its place among that value's pieces. */
export const chunkId = (hash: string, index: number): string => `${hash}-${index}`;

/** Every piece a manifest names. */
export const chunkIdsOf = (manifest: CloudManifest | null): Set<string> =>
  new Set(
    (manifest?.parts ?? []).flatMap((part) =>
      Array.from({ length: part.chunks }, (_, index) => chunkId(part.hash, index))
    )
  );

/**
 * A manifest as Firestore hands it back, or null for anything this app cannot read: malformed, or
 * in a newer layout. Null is not "no copy": the store refuses to treat an unreadable manifest as
 * an absent one (`firebaseCloud.ts`).
 */
export const coerceManifest = (raw: unknown): CloudManifest | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const { format, copy, version, updatedAt, device, parts } = raw as Record<string, unknown>;
  if (typeof format !== "number" || !Number.isInteger(format) || format < 1) return null;
  if (format > MANIFEST_FORMAT) return null;
  if (typeof copy !== "string" || !copy) return null;
  if (typeof version !== "number" || !Number.isInteger(version) || !Array.isArray(parts)) {
    return null;
  }
  const coerced: ManifestPart[] = [];
  const keys = new Set<string>();
  for (const part of parts) {
    if (typeof part !== "object" || part === null) return null;
    const { key, hash, bytes, chunks } = part as Record<string, unknown>;
    if (typeof key !== "string" || typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) {
      return null;
    }
    if (typeof chunks !== "number" || !Number.isInteger(chunks) || chunks < 1) return null;
    if (keys.has(key)) return null;
    keys.add(key);
    coerced.push({ key, hash, bytes: typeof bytes === "number" ? bytes : 0, chunks });
  }
  return {
    format,
    copy,
    version,
    updatedAt: typeof updatedAt === "string" ? updatedAt : "",
    device: typeof device === "string" ? device : "",
    parts: coerced,
  };
};

/**
 * What to do when the app opens, or when a device looks again:
 *
 * - `in-step`: nothing to do. The cloud holds what this device last saw, and nothing changed here.
 * - `take-cloud`: another device saved since, and this one has changed nothing: take its changes.
 *   Also a device holding nothing, meeting a copy for the first time: take all of it.
 * - `send-local`: this device has changes the cloud has not, and the cloud has not moved: send
 *   them. Or it has never saved and there is no copy yet: send everything, as the first copy.
 * - `merge`: both have changed since they last met. If they changed different values, each takes
 *   the other's; if the same value, somebody has to say which wins.
 * - `meet`: this device holds data and has never met this copy. The same data (one restored from
 *   one backup) needs nothing; different data needs somebody to say which wins.
 * - `gone`: this device has met a copy, and there is none. Deleted in the console, most likely:
 *   starting it again from whichever device happens to open first is not a thing to do unasked.
 */
export type OpenDecision = "in-step" | "take-cloud" | "send-local" | "merge" | "meet" | "gone";

export const decideOnOpen = (
  manifest: CloudManifest | null,
  state: {
    version: number | null;
    copy: string | null;
    dirty: Readonly<Record<string, number>>;
  },
  localEmpty: boolean
): OpenDecision => {
  const dirty = Object.keys(state.dirty).length > 0;
  if (!manifest) {
    if (state.version !== null) return "gone";
    return localEmpty ? "in-step" : "send-local";
  }
  if (state.version === null || state.copy !== manifest.copy) {
    return localEmpty ? "take-cloud" : "meet";
  }
  if (manifest.version === state.version) return dirty ? "send-local" : "in-step";
  return dirty ? "merge" : "take-cloud";
};

/**
 * For a device and a copy that have both changed since they last met: the values changed on both
 * sides. `known` is each key's fingerprint as of that meeting; a key the cloud has dropped since
 * counts as changed there.
 */
export const changedOnBothSides = (
  manifest: CloudManifest,
  known: Readonly<Record<string, string>>,
  dirty: Readonly<Record<string, number>>
): string[] => {
  const inCloud = new Map(manifest.parts.map((part) => [part.key, part.hash]));
  const changedInCloud = new Set([
    ...manifest.parts.filter((part) => known[part.key] !== part.hash).map((part) => part.key),
    ...Object.keys(known).filter((key) => !inCloud.has(key)),
  ]);
  return Object.keys(dirty).filter((key) => changedInCloud.has(key));
};
