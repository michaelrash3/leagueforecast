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
 *
 * 1: the boards as L3 first published them. 2: each board's rows say their club's town, state and
 * League Standings badge (`BoardFacts`), and `inline.pages` says each page's counted games by half
 * and the roster's last pull (`LivePages`), so a device can draw a page from them alone.
 */
export const LIVE_SCHEMA = 2;
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
/**
 * What a family of views was last built from, as the publish that built them vouched: the copy by
 * id and version, a fingerprint of the stored values the family reads (`inputs`), the members'
 * day, and the version of the rules that turn those values into views. A rebuild that finds all of
 * them its own has nothing to do.
 *
 * When no one build can vouch for every view of the family (a late publish wrote over some, or a
 * publish wrote them without saying what from), the copy and inputs are empty and the record is
 * only a floor: the newest rules and the latest day any of its views were built under, which no
 * publish of the family may go below. It never reads as any copy's.
 */
export type BuiltFrom = { k: string; v: number; inputs: string; today: string; rules: number };

/** A family's record once no one build vouches for all its views: what it may not go below. */
const floorOf = (kept: BuiltFrom | undefined, from: BuiltFrom | undefined): BuiltFrom | null => {
  if (!kept && !from) return null;
  const days = [kept?.today, from?.today].filter((day): day is string => day !== undefined);
  return {
    k: "",
    v: 0,
    inputs: "",
    today: days.reduce((a, b) => (a > b ? a : b)),
    rules: Math.max(kept?.rules ?? 0, from?.rules ?? 0),
  };
};
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
  /**
   * Small values a page needs before any view, by name (`pages`, which the boards' publisher
   * writes beside them). A publish replaces only the names it hands over, and a late one none.
   */
  inline: Record<string, unknown>;
  views: Record<string, ViewEntry>;
  retired: RetiredUpload[];
  /** By family (a key prefix, `board:`), what its views were last built from. */
  built: Record<string, BuiltFrom>;
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

/**
 * `live/` as a member's device reads it: the meta's fields as stored, or null when there is none,
 * and a piece by its id, or null when it is not there. Each a read by name, never a listing, which
 * the rules refuse.
 */
export type LiveReader = {
  readMeta: () => Promise<unknown>;
  getChunk: (id: string) => Promise<Uint8Array | null>;
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

const builtOf = (raw: unknown): BuiltFrom | null => {
  if (!isRecord(raw)) return null;
  const { k, v, inputs, today, rules } = raw;
  if (typeof k !== "string" || !isCount(v) || !isCount(rules)) return null;
  if (typeof inputs !== "string" || typeof today !== "string") return null;
  // Vouched for in full, or a floor with neither copy nor inputs; never half of each.
  if ((k === "") !== (inputs === "")) return null;
  return { k, v, inputs, today, rules };
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
 * A JSON value with every record in it in key order, all the way down, so inline values read back
 * from a store that hands a map's fields over in its own order still say the same as the values a
 * publish built: an identical republish writes nothing.
 */
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => [key, canonical(item)])
  );
};

/**
 * `live/meta` as this build reads it, or null for one it cannot: another format, or any field or
 * entry that is not what it should be. Rebuilt field by field, so its JSON is the same however the
 * store handed it over.
 */
export const coerceLiveMeta = (raw: unknown): LiveMeta | null => {
  if (!isRecord(raw) || raw.format !== LIVE_FORMAT || !isCount(raw.schema)) return null;
  const { today, builtAt, copy, marks, inline, views, retired, built } = raw;
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
  // What a family was built from only spares a rebuild: a missing or unreadable entry costs one,
  // so it is dropped rather than refusing the meta, and a meta from before it was kept reads empty.
  const builtFamilies: Record<string, BuiltFrom> = {};
  for (const [family, value] of Object.entries(isRecord(built) ? built : {})) {
    const from = builtOf(value);
    if (from) builtFamilies[family] = from;
  }
  return {
    format: LIVE_FORMAT,
    schema: raw.schema,
    today,
    builtAt,
    copy: { id: copy.id, version: copy.version },
    marks: inKeyOrder(marks as Record<string, number>),
    inline: canonical(inline) as Record<string, unknown>,
    views: inKeyOrder(entries),
    retired: retiredUploads,
    built: inKeyOrder(builtFamilies),
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
      /** Pieces of retired uploads past their grace this publish took out (`collectDue`). */
      deleted: number;
      /** Those it took out of the meta and could not delete: strays for a full sweep. */
      undeleted: number;
      metaBytes: number;
      tries: number;
    }
  | {
      ok: false;
      reason:
        | "unreadable"
        | "newer-schema"
        | "kept-changing"
        | "too-large"
        | "not-current"
        | "older-day"
        | "older-rules";
    };

type Upload = { id: string; c: number; bytes: number };

/**
 * Publishes `views`, built from version `copy.version` of the copy `copy.id`, for the members' day
 * `today`. `owns` names the key prefixes this publish covers whole: a key under one of them that is
 * not among `views` is taken out, and every other key is left as it is. Each `inline` value it
 * hands over replaces the stored one of that name, and the rest are left as they are.
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
 * A publish for an earlier members' day than the meta's writes nothing, `older-day`, whatever its
 * version: its views were built for a day that has passed, and a later day's are there. One that
 * says what it `built` from, under older rules than the meta has that family's from, writes
 * nothing either, `older-rules`: code left behind by a failed deploy must not undo newer views.
 * A publish that is not late records what it `built` from for its family; one that covers the
 * family and passes nothing takes the record out, since it cannot vouch for views it did not build.
 *
 * With `collectDue`, a publish that writes the meta anyway also takes out retired uploads past
 * their grace, and deletes their pieces after its commit, as a sweep would: one commit for both.
 * It is never a reason to write.
 *
 * `stillCurrent`, when given, is asked just before each commit, or before finding there is nothing
 * to write, whether what was built is still worth publishing (the copy it came from has not been
 * replaced, say); a no stops the publish, `not-current`, with its uploads taken back and nothing
 * written.
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
  built,
  inline,
  collectDue = false,
  stillCurrent,
  maxTries = 3,
}: {
  store: LiveStore;
  views: readonly PublishedView[];
  owns: readonly string[];
  copy: { id: string; version: number };
  today: string;
  /** The time, as an ISO string: when uploads are retired and the meta was built. */
  now: string;
  /** The family these views are, and what they were built from. */
  built?: { family: string; from: BuiltFrom };
  /**
   * Inline values this publish built, by name, each written in place of the stored value of that
   * name by a publish that is not late; a late one leaves every inline value as it is.
   */
  inline?: Record<string, unknown>;
  collectDue?: boolean;
  stillCurrent?: () => Promise<boolean>;
  maxTries?: number;
}): Promise<PublishResult> => {
  const builtKeys = new Set<string>();
  for (const { key } of views) {
    if (builtKeys.has(key)) throw new Error(`Two views were built under the key ${key}.`);
    builtKeys.add(key);
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
    // ISO days, so their order is their text's.
    if (stored && today < stored.today) {
      await dropUploads(new Set());
      return { ok: false, reason: "older-day" };
    }
    const storedFrom = built ? stored?.built[built.family] : undefined;
    if (built && storedFrom && built.from.rules < storedFrom.rules) {
      await dropUploads(new Set());
      return { ok: false, reason: "older-rules" };
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
      else if (!builtKeys.has(key)) {
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
    // What each family was built from. A publish that is not late records its own. Where views of
    // a family are written by one that cannot vouch for them all (a late publish, or a publish that
    // covers the family without saying what it built from), the record is only a floor from then
    // on: no build vouches for every view, and dropping it would let older rules or an earlier day
    // write over views built under newer ones.
    const families: Record<string, BuiltFrom> = upgrading ? {} : { ...stored?.built };
    const lower = (family: string, from: BuiltFrom | undefined) => {
      const floor = floorOf(families[family], from);
      if (floor) families[family] = floor;
    };
    if (!late) {
      for (const family of Object.keys(families)) {
        if (covers(family) && family !== built?.family) lower(family, undefined);
      }
      if (built) families[built.family] = built.from;
    } else {
      const wrote = (family: string) => placed.some(({ key }) => key.startsWith(family));
      for (const family of Object.keys(families)) {
        if (wrote(family) && family !== built?.family) lower(family, undefined);
      }
      if (built && wrote(built.family)) lower(built.family, built.from);
    }
    const meta: LiveMeta = {
      format: LIVE_FORMAT,
      schema: LIVE_SCHEMA,
      // A late publish leaves the header's copy, but not an earlier day than a view it placed was
      // built for: the day only goes forward, or a publish for the earlier day could write over it.
      today: late && (placed.length === 0 || today < stored.today) ? stored.today : today,
      builtAt: now,
      copy: header,
      marks: inKeyOrder(marks),
      inline: inKeyOrder({
        ...(upgrading ? {} : (stored?.inline ?? {})),
        ...(late ? {} : (canonical(inline ?? {}) as Record<string, unknown>)),
      }),
      views: inKeyOrder(next),
      retired,
      built: inKeyOrder(families),
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
      deleted: 0,
      undeleted: 0,
      tries,
    };
    // Asked before the meta is found to say it all as well: a publish that writes nothing still
    // reports what it built as published.
    if (stillCurrent && !(await stillCurrent())) {
      await dropUploads(new Set());
      return { ok: false, reason: "not-current" };
    }
    if (stored && sameMeta(meta, stored)) {
      await dropUploads(new Set());
      const metaBytes = new TextEncoder().encode(JSON.stringify(meta)).length;
      return { ok: true, wrote: false, ...counts, metaBytes };
    }
    // Written anyway, so it may as well carry a sweep's commit: the retired uploads past their
    // grace that no view names leave the meta here, and their pieces go once it is committed.
    const due = collectDue
      ? meta.retired.filter(
          (upload) =>
            !named.has(upload.id) && Date.parse(upload.at) + RETIRE_GRACE_MS <= Date.parse(now)
        )
      : [];
    if (due.length > 0) meta.retired = meta.retired.filter((upload) => !due.includes(upload));
    const metaBytes = new TextEncoder().encode(JSON.stringify(meta)).length;
    if (metaBytes > META_MAX_BYTES) {
      await dropUploads(new Set());
      return { ok: false, reason: "too-large" };
    }
    if (await store.commitMeta(read?.token ?? null, meta)) {
      await dropUploads(named);
      // The views are out: a piece that will not go now is a stray for a full sweep to find, not a
      // reason to say the publish failed.
      let deleted = 0;
      let undeleted = 0;
      await inBatches([...pieceIdsOf(due)], (id) =>
        store.deleteChunk(id).then(
          () => {
            deleted += 1;
          },
          () => {
            undeleted += 1;
          }
        )
      );
      return { ok: true, wrote: true, ...counts, deleted, undeleted, metaBytes };
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
