/**
 * The smallest IndexedDB that will do.
 *
 * `localStorage` gives a site five to ten megabytes, which the compact pool format stretched to
 * something like fourteen thousand teams. Past that there is nowhere to put the data, and
 * IndexedDB is where browsers keep anything of size — hundreds of megabytes, often as much as the
 * disk allows, and free in exactly the way localStorage is free: it is the user's own machine.
 *
 * What it costs is that every read and write is asynchronous, and this app reads its pool during
 * render. So this file is only the key-value store; `teamRankingsStorage.ts` puts a cache in front
 * of it, filled once at startup, and keeps the synchronous reads the rest of the app is built on.
 *
 * No library. One object store, string keys, JSON-serialisable values — a dependency would be
 * larger than the thing it wrapped.
 */

const DB_NAME = "league_forecast";
const DB_VERSION = 1;
const STORE = "pool";

/** Whether this browser has IndexedDB at all. Private windows and jsdom are the usual reasons not. */
export const idbAvailable = (): boolean => {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
};

/** Wraps a request so it reads as a promise; a failed request resolves to a rejection, not a throw. */
const request = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });

let open: Promise<IDBDatabase | null> | null = null;

/**
 * The database, opened once and shared. Never throws: a browser that refuses — private mode, a
 * corrupt store, a user who has blocked site data — gets `null`, and the caller falls back to
 * localStorage rather than losing the ability to save at all.
 */
export const openPoolDb = (): Promise<IDBDatabase | null> => {
  if (open) return open;
  if (!idbAvailable()) {
    open = Promise.resolve(null);
    return open;
  }

  open = new Promise<IDBDatabase | null>((resolve) => {
    let settled = false;
    const done = (db: IDBDatabase | null) => {
      if (settled) return;
      settled = true;
      resolve(db);
    };

    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => done(req.result);
      req.onerror = () => done(null);
      // A blocked open means another tab holds an older version. Rather than hang, fall back —
      // the next reload, once that tab is gone, will get the database.
      req.onblocked = () => done(null);
    } catch {
      done(null);
    }
  });
  return open;
};

const transact = async <T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | null> => {
  const db = await openPoolDb();
  if (!db) return null;
  try {
    const tx = db.transaction(STORE, mode);
    const result = await request(run(tx.objectStore(STORE)));
    return result;
  } catch {
    return null;
  }
};

/** One value, or `null` when it is not there or the store would not answer. */
export const idbGet = async (key: string): Promise<unknown> => {
  const value = await transact("readonly", (store) => store.get(key) as IDBRequest<unknown>);
  return value ?? null;
};

/** Writes one value. `false` means it did not land — a full disk, or no store to write to. */
export const idbSet = async (key: string, value: unknown): Promise<boolean> => {
  const db = await openPoolDb();
  if (!db) return false;
  try {
    const tx = db.transaction(STORE, "readwrite");
    // The transaction, not the request, is what tells you a quota failure — the put reports
    // success and the transaction then aborts.
    const finished = new Promise<boolean>((resolve) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    });
    tx.objectStore(STORE).put(value, key);
    return await finished;
  } catch {
    return false;
  }
};

export const idbDelete = async (key: string): Promise<void> => {
  await transact("readwrite", (store) => store.delete(key) as unknown as IDBRequest<undefined>);
};

/** Every key present, for a migration that needs to know whether there is anything here yet. */
export const idbKeys = async (): Promise<string[]> => {
  const keys = await transact(
    "readonly",
    (store) => store.getAllKeys() as IDBRequest<IDBValidKey[]>
  );
  return Array.isArray(keys) ? keys.filter((key): key is string => typeof key === "string") : [];
};

/** Only for tests and for starting over: forgets the shared handle so the next call reopens. */
export const resetPoolDbHandle = (): void => {
  open = null;
};
