/**
 * What the cloud copy is made of.
 *
 * The cloud copy is a manifest and a heap of pieces. The manifest names every stored value by its
 * key, its fingerprint and the upload that stored it; the pieces are named by that upload. The
 * manifest is the only thing that is ever overwritten, and it is written last, in a transaction on
 * its own version, so a copy is either the old one or the new one and never half of each.
 *
 * A piece belongs to one upload and is never written again under the same name. The first version
 * named pieces by the value's fingerprint alone, and three things went wrong with that: a browser
 * that gzips differently from the one that uploaded a value counted its pieces differently, and
 * named pieces nobody stored; a save that fell asleep after its commit woke hours later and
 * deleted pieces a newer copy had since uploaded again under the same name; and two devices saving
 * the same new value at once could delete each other's. A name that leaves the manifest now never
 * comes back, so deleting it can never hurt a copy that names something else.
 */

/**
 * The manifest's layout. A device refuses a manifest in any layout but its own, rather than
 * misreading it and saving its misreading back over it. Any field added to the manifest is a new
 * layout: a build that drops fields it does not know would otherwise write the manifest back
 * without them.
 */
export const MANIFEST_FORMAT = 2;

/**
 * The shape of the data inside the values, as this build reads and writes it. Raised with any
 * change to what a stored value holds: a field a team, a game, a setting or a pool row carries.
 * A build older than a copy's schema refuses to take it or save onto it, and says to update: it
 * would otherwise read the copy, drop the fields it does not know, and save the loss to every
 * device with its next edit. The tripwire is `cloudSchema.test.ts`.
 */
export const DATA_SCHEMA = 1;

export type ManifestPart = {
  /** The stored key: a Team Rankings key, or `league` for every League Standings season. */
  key: string;
  /** SHA-256 of the value's JSON. */
  hash: string;
  /** The value's JSON size before compression. */
  bytes: number;
  chunks: number;
  /** The upload that stored the pieces: `${id}-${n}`, unique to it. */
  id: string;
  /** When the value was changed on the device that saved it, in ms: who changed it last. */
  at: number;
  /** Which device saved it (`DeviceCloudState.device`). */
  by: string;
};

/**
 * A value that stopped being current in the cloud copy only because somebody's change was settled
 * against it: the other device's, where both changed one thing, or this device's own before it
 * joined the copy. Kept, pieces and all, so it can be brought back from any device.
 */
export type KeptPart = ManifestPart & {
  /** Which settlement it was kept by: a kept version is brought back whole, group by group. */
  group: string;
  keptAt: string;
  /** `replaced`: the cloud's value, overwritten by a later one. `lost`: a device's, not taken. */
  why: "replaced" | "lost";
};

export type CloudManifest = {
  format: number;
  /** The newest data schema any save to this copy was made by (`DATA_SCHEMA`). */
  schema: number;
  /**
   * Which copy this is: made at random when a copy is first saved, and kept by every save after.
   * A copy started again, after the first was deleted, is a different one, and a device that knew
   * the first must not take the second for a later version of it.
   */
  copy: string;
  /** One more with every save, so a device can tell the copy moved on without reading it. */
  version: number;
  /**
   * Made at random by the save that wrote this version. A commit whose reply was lost is found
   * again by it, rather than being taken for another device's save.
   */
  save: string;
  updatedAt: string;
  /** Which device saved it (`DeviceCloudState.device`). */
  device: string;
  parts: ManifestPart[];
  kept: KeptPart[];
};

/** A piece's document id: the upload's id and its place among that upload's pieces. */
export const chunkId = (id: string, index: number): string => `${id}-${index}`;

const idsOfPart = (part: ManifestPart): string[] =>
  Array.from({ length: part.chunks }, (_, index) => chunkId(part.id, index));

/** Every piece a manifest names, current or kept. */
export const chunkIdsOf = (manifest: CloudManifest | null): Set<string> =>
  new Set([...(manifest?.parts ?? []), ...(manifest?.kept ?? [])].flatMap(idsOfPart));

/** A random id for an upload, a save or a copy: 128 bits, hex. */
export const randomId = (): string => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const UPLOAD_ID = /^[0-9a-f]{16,64}$/;
const HASH = /^[0-9a-f]{64}$/;

const coercePart = (raw: unknown): ManifestPart | null => {
  if (!isRecord(raw)) return null;
  const { key, hash, bytes, chunks, id, at, by } = raw;
  if (typeof key !== "string" || !key) return null;
  if (typeof hash !== "string" || !HASH.test(hash)) return null;
  if (typeof id !== "string" || !UPLOAD_ID.test(id)) return null;
  if (typeof chunks !== "number" || !Number.isInteger(chunks) || chunks < 1) return null;
  return {
    key,
    hash,
    bytes: typeof bytes === "number" && Number.isFinite(bytes) ? bytes : 0,
    chunks,
    id,
    at: typeof at === "number" && Number.isFinite(at) ? at : 0,
    by: typeof by === "string" ? by : "",
  };
};

const coerceKept = (raw: unknown): KeptPart | null => {
  const part = coercePart(raw);
  if (!part || !isRecord(raw)) return null;
  const { group, keptAt, why } = raw;
  if (typeof group !== "string" || !group) return null;
  if (why !== "replaced" && why !== "lost") return null;
  return { ...part, group, keptAt: typeof keptAt === "string" ? keptAt : "", why };
};

/**
 * A manifest as Firestore hands it back, or null for anything this app cannot read: malformed, or
 * in another layout. Null is not "no copy": the store refuses to treat an unreadable manifest as an
 * absent one (`firebaseCloud.ts`).
 */
export const coerceManifest = (raw: unknown): CloudManifest | null => {
  if (!isRecord(raw)) return null;
  const { format, schema, copy, version, save, updatedAt, device, parts, kept } = raw;
  if (format !== MANIFEST_FORMAT) return null;
  if (typeof schema !== "number" || !Number.isInteger(schema) || schema < 1) return null;
  if (typeof copy !== "string" || !copy) return null;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) return null;
  if (!Array.isArray(parts) || !Array.isArray(kept)) return null;
  const coerced: ManifestPart[] = [];
  const keys = new Set<string>();
  for (const one of parts) {
    const part = coercePart(one);
    if (!part || keys.has(part.key)) return null;
    keys.add(part.key);
    coerced.push(part);
  }
  const keptParts: KeptPart[] = [];
  for (const one of kept) {
    const part = coerceKept(one);
    if (!part) return null;
    keptParts.push(part);
  }
  return {
    format,
    schema,
    copy,
    version,
    save: typeof save === "string" ? save : "",
    updatedAt: typeof updatedAt === "string" ? updatedAt : "",
    device: typeof device === "string" ? device : "",
    parts: coerced,
    kept: keptParts,
  };
};

/** How long a kept version stays, and how many settlements' worth are kept at most. */
export const KEEP_DAYS = 30;
export const KEEP_GROUPS = 6;

/**
 * The kept versions still worth keeping at `now`: none older than `KEEP_DAYS`, and of the rest
 * only the newest `KEEP_GROUPS` settlements, each whole.
 */
export const keptStill = (kept: readonly KeptPart[], now: string): KeptPart[] => {
  const cutoff = Date.parse(now) - KEEP_DAYS * 86_400_000;
  const fresh = kept.filter((part) => !(Date.parse(part.keptAt) < cutoff));
  const newest = new Map<string, string>();
  for (const part of fresh) {
    const seen = newest.get(part.group);
    if (seen === undefined || part.keptAt > seen) newest.set(part.group, part.keptAt);
  }
  const groups = new Set(
    [...newest.entries()]
      .sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0))
      .slice(0, KEEP_GROUPS)
      .map(([group]) => group)
  );
  return fresh.filter((part) => groups.has(part.group));
};
