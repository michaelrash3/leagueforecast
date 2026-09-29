/**
 * What the cloud copy is made of, and what a device does about it when the app opens.
 *
 * The cloud copy is a manifest and a heap of pieces. The manifest names every stored value by its
 * key and its fingerprint; the pieces are named by fingerprint, so a value that has not changed is
 * never sent again, and a device that already has a fingerprint never downloads it. The manifest is
 * the only thing that is ever overwritten, and it is written last, in a transaction on its own
 * version, so a copy is either the old one or the new one and never half of each.
 */

export type ManifestPart = {
  /** The stored key: a Team Rankings key, or `league` for every League Standings season. */
  key: string;
  hash: string;
  /** The value's JSON size before compression. */
  bytes: number;
  chunks: number;
};

export type CloudManifest = {
  /** One more with every save, so a device can tell the copy moved on without reading it. */
  version: number;
  updatedAt: string;
  /** Which device saved it (`SyncState.device`), for saying "from another device". */
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

/** A manifest as Firestore hands it back, or null for anything that is not one. */
export const coerceManifest = (raw: unknown): CloudManifest | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const { version, updatedAt, device, parts } = raw as Record<string, unknown>;
  if (typeof version !== "number" || !Number.isInteger(version) || !Array.isArray(parts)) {
    return null;
  }
  const coerced: ManifestPart[] = [];
  for (const part of parts) {
    if (typeof part !== "object" || part === null) return null;
    const { key, hash, bytes, chunks } = part as Record<string, unknown>;
    if (typeof key !== "string" || typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) {
      return null;
    }
    if (typeof chunks !== "number" || !Number.isInteger(chunks) || chunks < 1) return null;
    coerced.push({ key, hash, bytes: typeof bytes === "number" ? bytes : 0, chunks });
  }
  return {
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
 * - `take-cloud`: another device saved since, and this one has changed nothing: take its copy.
 * - `send-local`: this device has changes the cloud has not, and the cloud has not moved: send them.
 * - `choose`: both have changes, or both have data and have never met. Somebody has to say which
 *   copy wins, because either answer throws the other away.
 */
export type OpenDecision = "in-step" | "take-cloud" | "send-local" | "choose";

export const decideOnOpen = (
  manifest: CloudManifest | null,
  state: { version: number | null; dirty: Readonly<Record<string, number>> },
  localEmpty: boolean
): OpenDecision => {
  const dirty = Object.keys(state.dirty).length > 0;
  if (!manifest) return localEmpty ? "in-step" : "send-local";
  // This device has never synced: its data, if it has any, and the cloud's have never met.
  if (state.version === null) return localEmpty ? "take-cloud" : "choose";
  if (manifest.version === state.version) return dirty ? "send-local" : "in-step";
  return dirty ? "choose" : "take-cloud";
};
