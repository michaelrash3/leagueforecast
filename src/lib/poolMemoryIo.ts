import type { PoolStoreIo } from "./teamRankingsStorage";

/**
 * A pool store held in memory, started empty: what reads a cloud copy's pool with the app's own
 * loaders away from any browser's store. The server's runs take the copy into one
 * (`loadPoolFrom`), and so does the backup worker (`backupProtocol.ts`), whose module of the store
 * is its own, apart from the page's.
 */
export const memoryIo = (): PoolStoreIo => {
  const values = new Map<string, unknown>();
  return {
    keys: async () => [...values.keys()],
    get: async (key) => values.get(key),
    set: async (key, value) => {
      values.set(key, value);
      return true;
    },
    remove: async (key) => {
      values.delete(key);
    },
    readLocal: () => null,
    clearLocal: () => undefined,
  };
};
