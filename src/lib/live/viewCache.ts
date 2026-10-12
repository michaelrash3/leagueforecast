import { DamagedValueError, unpackChunks } from "../cloud/cloudPack";
import { idbDelete, idbGet, idbKeys, idbSet } from "../idb";
import { isPoolStoreOpen } from "../teamRankingsStorage";

/**
 * The published views this device has read, kept so an open shows them before any network read
 * and fetches a view again only when its fingerprint changes.
 *
 * A view is kept as the gzipped bytes its pieces join to, under its fingerprint (`ViewEntry.h`),
 * and checked against it on every read, as a piece fetched from the cloud is: an entry the disk
 * damaged is deleted and fetched again, never drawn. The same fingerprint is the same view
 * whoever reads it, so views carry no account. What does is the last meta read and the last board
 * shown, which say what this account may see: another account's are left alone and cleared.
 *
 * The keys sit in the pool's IndexedDB store beside the saved board (`savedBoard.ts`). None is a
 * pool key, so the boot's fill never reads them, the cloud copy never carries them, and a reset of
 * the app, which empties the store, takes them with it. A browser whose pool is not in IndexedDB
 * keeps nothing here: localStorage has no room for megabytes of views, so it reads them every open.
 *
 * At most `VIEW_CACHE_BYTES` of views are kept, the least recently read going first.
 */

const META_KEY = "league_forecast_live_meta_v1";
const LAST_KEY = "league_forecast_live_last_v1";
const INDEX_KEY = "league_forecast_live_index_v1";
const VIEW_PREFIX = "league_forecast_live_view_v1:";

/**
 * The most gzipped bytes of views kept. The seeded fixture's 33 boards measured 238 KB together, a
 * real-size page's board 256 to 276 KB, so this holds every board of a season many times over.
 */
export const VIEW_CACHE_BYTES = 100_000_000;

/** What the cache is kept in; IndexedDB's, but for a test. */
export type ViewCacheIo = {
  /** Whether anything is kept: only while the pool's store is IndexedDB. */
  enabled: () => boolean;
  keys: () => Promise<string[]>;
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<boolean>;
  remove: (key: string) => Promise<void>;
  /** The clock, in milliseconds, that orders reads for eviction. */
  now: () => number;
};

const browserIo: ViewCacheIo = {
  enabled: isPoolStoreOpen,
  keys: idbKeys,
  get: idbGet,
  set: idbSet,
  remove: idbDelete,
  now: () => Date.now(),
};

/** The last meta an account read: its fields as read (`coerceLiveMeta` reads them again), and when. */
export type CachedMeta = { meta: unknown; readAt: string };
/** The board an account last had on screen: its key in the meta and its fingerprint. */
export type LastShown = { key: string; h: string };

type IndexEntry = { bytes: number; usedAt: number };

const isRecord = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === "object" && raw !== null && !Array.isArray(raw);

const HASH = /^[0-9a-f]{64}$/;

const indexOf = (raw: unknown): Map<string, IndexEntry> => {
  const index = new Map<string, IndexEntry>();
  if (!isRecord(raw)) return index;
  for (const [h, entry] of Object.entries(raw)) {
    if (!HASH.test(h) || !isRecord(entry)) continue;
    const { bytes, usedAt } = entry;
    if (typeof bytes !== "number" || typeof usedAt !== "number") continue;
    index.set(h, { bytes, usedAt });
  }
  return index;
};

export type ViewCache = {
  /** The account's last meta, or null: none kept, or another account's, which this clears. */
  meta: (uid: string) => Promise<CachedMeta | null>;
  keepMeta: (uid: string, meta: unknown, readAt: string) => Promise<void>;
  /** The board the account last had on screen, or null: none, or another account's. */
  lastShown: (uid: string) => Promise<LastShown | null>;
  keepLastShown: (uid: string, shown: LastShown) => Promise<void>;
  /** The view of fingerprint `h`, read back and checked against it, or null when none is kept. */
  view: (h: string) => Promise<unknown>;
  /** Keeps a view's gzipped bytes, which must be the ones that unpacked to fingerprint `h`. */
  keepView: (h: string, bytes: Uint8Array) => Promise<void>;
  /** Takes out everything kept here, for an account that may no longer read the views. */
  clear: () => Promise<void>;
};

/**
 * The cache in `io`, keeping at most `limitBytes` of views. Writes to the index of views go one at a time, so two views kept at once do
 * not each write an index without the other; two tabs can still, which costs a view's bytes kept
 * unindexed until a `clear`, and never a wrong view, since every read is checked.
 */
export const openViewCache = (
  io: ViewCacheIo = browserIo,
  limitBytes = VIEW_CACHE_BYTES
): ViewCache => {
  let queue: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };

  const readIndex = async () => indexOf(await io.get(INDEX_KEY));
  const writeIndex = (index: Map<string, IndexEntry>) =>
    io.set(INDEX_KEY, Object.fromEntries(index));

  const forget = (h: string) =>
    inTurn(async () => {
      const index = await readIndex();
      await io.remove(`${VIEW_PREFIX}${h}`);
      if (index.delete(h)) await writeIndex(index);
    });

  const owned = async <T>(
    key: string,
    uid: string,
    read: (record: Record<string, unknown>) => T | null
  ) => {
    if (!io.enabled()) return null;
    const raw = await io.get(key);
    if (!isRecord(raw)) return null;
    if (raw.uid !== uid) {
      await Promise.all([io.remove(META_KEY), io.remove(LAST_KEY)]);
      return null;
    }
    return read(raw);
  };

  return {
    meta: (uid) =>
      owned(META_KEY, uid, ({ meta, readAt }) =>
        typeof readAt === "string" && meta !== undefined ? { meta, readAt } : null
      ),
    keepMeta: async (uid, meta, readAt) => {
      if (io.enabled()) await io.set(META_KEY, { uid, meta, readAt });
    },
    lastShown: (uid) =>
      owned(LAST_KEY, uid, ({ key, h }) =>
        typeof key === "string" && typeof h === "string" && HASH.test(h) ? { key, h } : null
      ),
    keepLastShown: async (uid, { key, h }) => {
      if (io.enabled()) await io.set(LAST_KEY, { uid, key, h });
    },
    view: async (h) => {
      if (!io.enabled() || !HASH.test(h)) return null;
      const bytes = await io.get(`${VIEW_PREFIX}${h}`);
      if (bytes === null || bytes === undefined) return null;
      let value: unknown;
      try {
        if (!(bytes instanceof Uint8Array)) throw new DamagedValueError();
        value = await unpackChunks([bytes], h);
      } catch {
        await forget(h);
        return null;
      }
      void inTurn(async () => {
        const index = await readIndex();
        const entry = index.get(h);
        if (!entry) return;
        index.set(h, { ...entry, usedAt: io.now() });
        await writeIndex(index);
      });
      return value;
    },
    keepView: (h, bytes) =>
      inTurn(async () => {
        if (!io.enabled() || !HASH.test(h)) return;
        if (!(await io.set(`${VIEW_PREFIX}${h}`, bytes))) return;
        const index = await readIndex();
        index.set(h, { bytes: bytes.length, usedAt: io.now() });
        let total = [...index.values()].reduce((sum, entry) => sum + entry.bytes, 0);
        const oldest = [...index.entries()]
          .filter(([kept]) => kept !== h)
          .sort(([, a], [, b]) => a.usedAt - b.usedAt);
        for (const [kept, entry] of oldest) {
          if (total <= limitBytes) break;
          await io.remove(`${VIEW_PREFIX}${kept}`);
          index.delete(kept);
          total -= entry.bytes;
        }
        await writeIndex(index);
      }),
    clear: () =>
      inTurn(async () => {
        if (!io.enabled()) return;
        const ours = (await io.keys()).filter(
          (key) =>
            key === META_KEY || key === LAST_KEY || key === INDEX_KEY || key.startsWith(VIEW_PREFIX)
        );
        await Promise.all(ours.map((key) => io.remove(key)));
      }),
  };
};
