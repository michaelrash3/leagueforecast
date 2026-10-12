/**
 * A small cache that forgets.
 *
 * Written for the GameChanger proxy, where a team's profile — its name, city, state and season —
 * is fetched alongside its schedule on every request, and changes perhaps once a season. The
 * schedule changes whenever somebody enters a score, so the two cannot share a lifetime, and only
 * the profile half is worth keeping.
 *
 * Two bounds, because this runs in a serverless function that may be reused for a long time. Age,
 * so a profile corrected upstream is picked up rather than pinned forever; and count, so a pull of
 * twenty thousand teams cannot grow the instance's memory by twenty thousand entries. The oldest
 * entry goes first, which a Map gives for free — it iterates in insertion order, and a re-set
 * moves an entry to the end.
 */

export type TtlCache<T> = {
  /** The value, or `undefined` when it was never here or has aged out. */
  get: (key: string) => T | undefined;
  set: (key: string, value: T) => void;
  /** How many entries are held, aged-out ones included until something asks for them. */
  size: () => number;
  clear: () => void;
};

export const createTtlCache = <T>(
  ttlMs: number,
  maxEntries: number,
  now: () => number = Date.now
): TtlCache<T> => {
  const entries = new Map<string, { value: T; at: number }>();

  return {
    get: (key) => {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (now() - entry.at >= ttlMs) {
        entries.delete(key);
        return undefined;
      }
      // Read counts as use: a team asked for repeatedly stays while one asked for once ages out.
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set: (key, value) => {
      // Deleted first so a re-set moves the entry to the end rather than keeping its old place.
      entries.delete(key);
      entries.set(key, { value, at: now() });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
    },
    size: () => entries.size,
    clear: () => entries.clear(),
  };
};
