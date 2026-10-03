import { inBatches } from "../cloud/cloudEngine";
import { chunkId, randomId } from "../cloud/cloudManifest";
import { hashJson, packHashed, type HashedValue } from "../cloud/cloudPack";

/**
 * The views a server publishes for members to read: `live/meta`, one small document naming every
 * view, and each view's gzipped JSON in pieces under `live/meta/chunks/{upload-n}`, as the copy
 * keeps its values (`cloudPack.ts`). A member's device listens to the one document and fetches only
 * the pieces of the views on its screen, and only when their fingerprint has changed.
 *
 * Three rules, each for a reader that may be in the middle of fetching while a publisher writes:
 * - A piece is never rewritten. A changed view goes up under a new upload id, so a reader holding
 *   the old meta still finds every piece it names.
 * - An upload the meta stops naming is retired, not deleted, and its pieces go only once it has
 *   been retired for `RETIRE_GRACE_MS` (`sweepViews`): long enough for any fetch already under way.
 * - The meta is replaced only if it is still the document this publish read (the store's
 *   precondition), and it remembers the newest version of each copy any publish carried, so a
 *   rebuild that finishes after a newer one never puts back what the newer one replaced.
 *
 * The copy engine's `commitChanges` is not used for this: it deletes what a commit stops naming at
 * once, which is right for one device's own copy and wrong for pieces other devices are reading.
 */

/** The layout of `live/meta`. A reader or publisher refuses any other. */
export const LIVE_FORMAT = 1;
/**
 * The shape inside view values and `inline`; raised when one changes, so old builds stop reading.
 * A meta of a newer schema is left alone, by publishes and sweeps alike, and a publish over an
 * older one keeps nothing it did not build itself, since the rest has the older shape.
 */
export const LIVE_SCHEMA = 1;
/** How long a retired upload stays readable before a sweep may delete it. */
export const RETIRE_GRACE_MS = 15 * 60_000;
/**
 * How old a piece the meta has never named must be before a sweep deletes it: a publish that
 * crashed between its uploads and its commit. A publish in flight is minutes from upload to
 * commit, never an hour.
 */
export const STRAY_AGE_MS = 60 * 60_000;
/**
 * The largest meta a publish writes. Every member's device downloads it on each change, so it is
 * kept small: the seeded fixture's 33 boards measured 173 to 179 bytes an entry, three a page.
 */
export const META_MAX_BYTES = 500_000;

/**
 * One view: its fingerprint, its upload, how many pieces, its JSON's bytes, and the copy it was
 * built from, by id and version. The copy is the entry's own, not the meta's: publishes of
 * different families of view replace only their own keys, so after a copy is made afresh the
 * meta can hold views of both copies for a while.
 */
export type ViewEntry = { h: string; id: string; c: number; b: number; k: string; v: number };
/** An upload the views no longer name, and when that happened. */
export type RetiredUpload = { id: string; c: number; at: string };
export type LiveMeta = {
  format: number;
  schema: number;
  /** The members' day the views were built for, as an ISO day. */
  today: string;
  /** When a publish last changed anything. */
  builtAt: string;
  /** The copy the views reflect, by its id and version (`CloudManifest`): the newest publish's. */
  copy: { id: string; version: number };
  /**
   * The newest version of each copy a publish has carried, by copy id, kept while the header or a
   * view names that copy. A publish of an older version than its copy's mark is late: a newer
   * build has run since it read the copy.
   */
  marks: Record<string, number>;
  /** Small values a page needs before any view; passed through untouched by board publishes. */
  inline: Record<string, unknown>;
  views: Record<string, ViewEntry>;
  retired: RetiredUpload[];
};

/** Where `live/` is kept: Firestore through REST on a server, a stand-in in tests. */
export type LiveStore = {
  /** The meta's fields and a token naming this version of it, or null when there is none. */
  readMeta: () => Promise<{ meta: unknown; token: string } | null>;
  /**
   * Replaces the meta only if it is still the version `token` names (null: there must be none),
   * and says whether it did.
   */
  commitMeta: (token: string | null, next: LiveMeta) => Promise<boolean>;
  putChunk: (id: string, data: Uint8Array<ArrayBuffer>) => Promise<void>;
  /** A piece, or null when it is not there. */
  getChunk: (id: string) => Promise<Uint8Array | null>;
  /** A piece that is not there counts as deleted. */
  deleteChunk: (id: string) => Promise<void>;
  /** Every piece there is, by id, with when it was made. */
  listChunks: () => Promise<Array<{ id: string; createdAt: string }>>;
};

/** A view to publish under `key`, which a member's device asks for by name. */
export type PublishedView = { key: string; value: unknown };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const HASH = /^[0-9a-f]{64}$/;
const UPLOAD_ID = /^[0-9a-f]{16,64}$/;

const entryOf = (raw: unknown): ViewEntry | null => {
  if (!isRecord(raw)) return null;
  const { h, id, c, b, k, v } = raw;
  if (typeof h !== "string" || !HASH.test(h)) return null;
  if (typeof id !== "string" || !UPLOAD_ID.test(id)) return null;
  if (typeof k !== "string" || k === "") return null;
  if (!isCount(c) || c < 1 || !isCount(b) || !isCount(v)) return null;
  return { h, id, c, b, k, v };
};

const retiredOf = (raw: unknown): RetiredUpload | null => {
  if (!isRecord(raw)) return null;
  const { id, c, at } = raw;
  if (typeof id !== "string" || !UPLOAD_ID.test(id) || !isCount(c) || c < 1) return null;
  if (typeof at !== "string" || Number.isNaN(Date.parse(at))) return null;
  return { id, c, at };
};

/** A record in key order, so two metas saying the same things have the same JSON. */
const inKeyOrder = <T>(record: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/**
 * `live/meta` as this build reads it, or null for one it cannot: another format, or any field or
 * entry that is not what it should be. Rebuilt field by field, so its JSON is the same however the
 * store handed it over.
 */
export const coerceLiveMeta = (raw: unknown): LiveMeta | null => {
  if (!isRecord(raw) || raw.format !== LIVE_FORMAT || !isCount(raw.schema)) return null;
  const { today, builtAt, copy, marks, inline, views, retired } = raw;
  if (typeof today !== "string" || typeof builtAt !== "string") return null;
  if (!isRecord(copy) || typeof copy.id !== "string" || !isCount(copy.version)) return null;
  if (!isRecord(marks) || !Object.values(marks).every(isCount)) return null;
  if (!isRecord(inline) || !isRecord(views) || !Array.isArray(retired)) return null;
  const entries: Record<string, ViewEntry> = {};
  for (const [key, value] of Object.entries(views)) {
    const entry = entryOf(value);
    if (!entry) return null;
    entries[key] = entry;
  }
  const retiredUploads: RetiredUpload[] = [];
  for (const value of retired) {
    const upload = retiredOf(value);
    if (!upload) return null;
    retiredUploads.push(upload);
  }
  return {
    format: LIVE_FORMAT,
    schema: raw.schema,
    today,
    builtAt,
    copy: { id: copy.id, version: copy.version },
    marks: inKeyOrder(marks as Record<string, number>),
    inline,
    views: inKeyOrder(entries),
    retired: retiredUploads,
  };
};

/** Every piece of these uploads, by document id. */
export const pieceIdsOf = (uploads: Iterable<{ id: string; c: number }>): Set<string> => {
  const ids = new Set<string>();
  for (const { id, c } of uploads) {
    for (let index = 0; index < c; index += 1) ids.add(chunkId(id, index));
  }
  return ids;
};

/** Whether two metas say the same, apart from when they were built. */
const sameMeta = (a: LiveMeta, b: LiveMeta): boolean =>
  JSON.stringify({ ...a, builtAt: "" }) === JSON.stringify({ ...b, builtAt: "" });

export type PublishResult =
  | {
      ok: true;
      /** Whether the meta was written: false when it already said everything this publish built. */
      wrote: boolean;
      /** Uploads this publish made that the meta now names, their pieces and gzipped bytes. */
      uploaded: number;
      pieces: number;
      bytes: number;
      /** Views already named with this fingerprint, built from this copy at this version. */
      unchanged: number;
      /**
       * Views built and not written, because this publish is late: ones the meta has that it may
       * not replace, and ones the meta lacks, which it may not add.
       */
      refused: number;
      /** Views this publish covers that it did not build, so took out. */
      removed: number;
      /** Uploads newly retired. */
      retired: number;
      metaBytes: number;
      tries: number;
    }
  | { ok: false; reason: "unreadable" | "newer-schema" | "kept-changing" | "too-large" };

type Upload = { id: string; c: number; bytes: number };

/**
 * Publishes `views`, built from version `copy.version` of the copy `copy.id`, for the members' day
 * `today`. `owns` names the key prefixes this publish covers whole: a key under one of them that is
 * not among `views` is taken out, and every other key, and `inline`, is left as it is.
 *
 * Each view's JSON is hashed once. A view the meta already names with that fingerprint costs
 * nothing, and one another key already names reuses that upload; anything else is gzipped and
 * uploaded under a fresh id. The meta is then committed over the version read, and a refusal (a
 * racing publisher or sweep) reads it again and merges again, reusing what this publish uploaded,
 * without building anything again. A meta that already says everything this publish would write
 * is not written: a second, identical publish writes nothing.
 *
 * A publish is late when its version is older than the newest of its copy any publish carried
 * (`LiveMeta.marks`): a newer build has run since this one read the copy, and may have replaced
 * or taken out what this one built. A late publish replaces only views of its own copy built from
 * no later version than its own, takes nothing out, adds no view the meta lacks, and leaves the
 * header and the marks as they are, so it cannot bring back what a newer publish removed or put
 * the meta's day back. A publish that is not late writes every view it built over whatever the
 * meta has, from its own copy or another: a copy made afresh starts its versions again and takes
 * over view by view. Two copies have no order between them, so a server must not publish from a
 * copy it has seen replaced; a late build of one that had a later publish is held all the same,
 * while any view still names that copy and its mark is kept.
 *
 * Over a meta a newer build wrote it writes nothing, and over one an older build wrote it keeps
 * nothing it did not build, inline values included (`LIVE_SCHEMA`).
 *
 * Uploads the committed meta does not name are deleted at once, since nothing ever named them. A
 * store error is thrown as it is, leaving any uploads for `sweepViews` to collect an hour later.
 */
export const publishViews = async ({
  store,
  views,
  owns,
  copy,
  today,
  now,
  maxTries = 3,
}: {
  store: LiveStore;
  views: readonly PublishedView[];
  owns: readonly string[];
  copy: { id: string; version: number };
  today: string;
  /** The time, as an ISO string: when uploads are retired and the meta was built. */
  now: string;
  maxTries?: number;
}): Promise<PublishResult> => {
  const built = new Set<string>();
  for (const { key } of views) {
    if (built.has(key)) throw new Error(`Two views were built under the key ${key}.`);
    built.add(key);
  }
  const hashed = await Promise.all(
    views.map(async ({ key, value }) => ({ key, value: await hashJson(value) }))
  );
  const covers = (key: string) => owns.some((prefix) => key.startsWith(prefix));

  // This publish's own uploads, by fingerprint, kept across tries.
  const uploads = new Map<string, Upload>();
  const upload = async (value: HashedValue): Promise<Upload> => {
    const made = uploads.get(value.hash);
    if (made) return made;
    const pieces = await packHashed(value);
    const id = randomId();
    await inBatches(
      pieces.map((piece, index) => ({ piece, index })),
      ({ piece, index }) => store.putChunk(chunkId(id, index), piece)
    );
    const done = {
      id,
      c: pieces.length,
      bytes: pieces.reduce((sum, piece) => sum + piece.length, 0),
    };
    uploads.set(value.hash, done);
    return done;
  };
  /** Deletes this publish's uploads that `named` does not name. Best effort: a stray is swept. */
  const dropUploads = async (named: ReadonlySet<string>) => {
    const unnamed = [...uploads.values()].filter((made) => !named.has(made.id));
    await inBatches([...pieceIdsOf(unnamed)], (id) => store.deleteChunk(id).catch(() => undefined));
  };

  for (let tries = 1; tries <= maxTries; tries += 1) {
    const read = await store.readMeta();
    const stored = read ? coerceLiveMeta(read.meta) : null;
    if (read && !stored) {
      await dropUploads(new Set());
      return { ok: false, reason: "unreadable" };
    }
    if (stored && stored.schema > LIVE_SCHEMA) {
      await dropUploads(new Set());
      return { ok: false, reason: "newer-schema" };
    }
    // Over an older build's meta, nothing this publish did not build is kept: its views and inline
    // values have the older shape, and the meta about to be written says they have this one.
    const upgrading = stored !== null && stored.schema < LIVE_SCHEMA;
    const storedViews = stored?.views ?? {};
    const mark = stored?.marks[copy.id];
    // Late against an older build's meta or not, an upgrade keeps none of it, so it is not held.
    const late = stored !== null && !upgrading && mark !== undefined && copy.version < mark;
    // What a late publish may still replace: a view of its own copy, from no later version.
    const replaceable = (entry: ViewEntry) =>
      !late || (entry.k === copy.id && entry.v <= copy.version);

    const next: Record<string, ViewEntry> = {};
    let refused = 0;
    let unchanged = 0;
    let removed = 0;
    for (const [key, entry] of Object.entries(storedViews)) {
      if (!covers(key) && !upgrading) next[key] = entry;
      else if (!built.has(key)) {
        // Taken out, unless this publish is late: a newer one decided what is there.
        if (late) next[key] = entry;
        else removed += 1;
      }
    }
    const storedByHash = new Map<string, ViewEntry>();
    Object.values(storedViews).forEach((entry) => {
      if (!storedByHash.has(entry.h)) storedByHash.set(entry.h, entry);
    });
    // Each view's place in the next meta: kept as the meta has it, or written from its upload.
    const placed = hashed.flatMap(({ key, value }) => {
      const entry = storedViews[key];
      if (entry && !replaceable(entry)) {
        next[key] = entry;
        refused += 1;
        return [];
      }
      if (!entry && late) {
        refused += 1;
        return [];
      }
      if (entry?.h === value.hash && entry.k === copy.id && entry.v === copy.version) {
        unchanged += 1;
      }
      // The key's own upload while its fingerprint holds, else any upload of the same JSON.
      const source = entry?.h === value.hash ? entry : storedByHash.get(value.hash);
      return [{ key, value, source }];
    });
    const missing = new Map(
      placed.filter(({ source }) => !source).map(({ value }) => [value.hash, value])
    );
    await inBatches([...missing.values()], async (value) => {
      await upload(value);
    });
    for (const { key, value, source } of placed) {
      const from = source ?? uploads.get(value.hash);
      if (!from) throw new Error(`The view ${key} was not uploaded.`);
      // Stamped with this version even when unchanged, so a late build of an older version
      // finds it newer and leaves it.
      next[key] = {
        h: value.hash,
        id: from.id,
        c: from.c,
        b: value.bytes,
        k: copy.id,
        v: copy.version,
      };
    }

    // An upload the views stop naming is retired once, and stays retired until a sweep.
    const named = new Set(Object.values(next).map((entry) => entry.id));
    const retired = [...(stored?.retired ?? [])];
    const retiredIds = new Set(retired.map((upload) => upload.id));
    let newlyRetired = 0;
    Object.values(storedViews).forEach(({ id, c }) => {
      if (named.has(id) || retiredIds.has(id)) return;
      retired.push({ id, c, at: now });
      retiredIds.add(id);
      newlyRetired += 1;
    });

    // The header is the newest publish's: a late one's day and copy do not replace it. A copy's
    // mark is kept while the header or a view names the copy, the only time a build of it can
    // still be held to it; a copy no longer named is one a fresh copy has taken over.
    const header = late ? stored.copy : { id: copy.id, version: copy.version };
    const copies = new Set([header.id, ...Object.values(next).map((entry) => entry.k)]);
    const marks = Object.fromEntries(
      Object.entries({ ...stored?.marks, ...(late ? {} : { [copy.id]: copy.version }) }).filter(
        ([id]) => copies.has(id)
      )
    );
    const meta: LiveMeta = {
      format: LIVE_FORMAT,
      schema: LIVE_SCHEMA,
      today: late ? stored.today : today,
      builtAt: now,
      copy: header,
      marks: inKeyOrder(marks),
      inline: upgrading ? {} : (stored?.inline ?? {}),
      views: inKeyOrder(next),
      retired,
    };
    const ours = [...uploads.values()].filter((made) => named.has(made.id));
    const counts = {
      uploaded: ours.length,
      pieces: ours.reduce((sum, made) => sum + made.c, 0),
      bytes: ours.reduce((sum, made) => sum + made.bytes, 0),
      unchanged,
      refused,
      removed,
      retired: newlyRetired,
      tries,
    };
    const metaBytes = new TextEncoder().encode(JSON.stringify(meta)).length;
    if (stored && sameMeta(meta, stored)) {
      await dropUploads(new Set());
      return { ok: true, wrote: false, ...counts, metaBytes };
    }
    if (metaBytes > META_MAX_BYTES) {
      await dropUploads(new Set());
      return { ok: false, reason: "too-large" };
    }
    if (await store.commitMeta(read?.token ?? null, meta)) {
      await dropUploads(named);
      return { ok: true, wrote: true, ...counts, metaBytes };
    }
  }
  await dropUploads(new Set());
  return { ok: false, reason: "kept-changing" };
};

/**
 * Deletes what no reader can still be fetching: uploads retired for at least `RETIRE_GRACE_MS`, and
 * pieces the meta has never named that are at least `STRAY_AGE_MS` old.
 *
 * The meta is committed without the retired uploads before their pieces are deleted. No publish
 * names a retired upload today, since it takes ids only from the views of the meta it read or
 * from fresh uploads, so the order is defence in depth: should a publish ever reuse one, it reads
 * the upload gone from the meta, or has its commit refused by the sweep's.
 */
export const sweepViews = async ({
  store,
  now,
  maxTries = 3,
}: {
  store: LiveStore;
  now: string;
  maxTries?: number;
}): Promise<
  | { ok: true; deleted: number; strays: number }
  | { ok: false; reason: "unreadable" | "newer-schema" | "kept-changing" }
> => {
  const at = Date.parse(now);
  let deleted = 0;
  let meta: LiveMeta | null = null;
  for (let tries = 1; ; tries += 1) {
    const read = await store.readMeta();
    meta = read ? coerceLiveMeta(read.meta) : null;
    if (read && !meta) return { ok: false, reason: "unreadable" };
    if (!read || !meta) break;
    // A newer build's meta may name pieces in ways this one cannot see: neither rewrite it nor
    // take a piece it names for a stray.
    if (meta.schema > LIVE_SCHEMA) return { ok: false, reason: "newer-schema" };
    const named = new Set(Object.values(meta.views).map((entry) => entry.id));
    const due = meta.retired.filter(
      (upload) => !named.has(upload.id) && Date.parse(upload.at) + RETIRE_GRACE_MS <= at
    );
    if (due.length === 0) break;
    const kept = meta.retired.filter((upload) => !due.includes(upload));
    const next: LiveMeta = { ...meta, retired: kept };
    if (await store.commitMeta(read.token, next)) {
      const pieces = [...pieceIdsOf(due)];
      await inBatches(pieces, (id) => store.deleteChunk(id));
      deleted += pieces.length;
      meta = next;
      break;
    }
    if (tries >= maxTries) return { ok: false, reason: "kept-changing" };
  }
  const known = pieceIdsOf([...Object.values(meta?.views ?? {}), ...(meta?.retired ?? [])]);
  const strays = (await store.listChunks()).filter(
    ({ id, createdAt }) => !known.has(id) && Date.parse(createdAt) + STRAY_AGE_MS <= at
  );
  await inBatches(strays, ({ id }) => store.deleteChunk(id));
  return { ok: true, deleted, strays: strays.length };
};
