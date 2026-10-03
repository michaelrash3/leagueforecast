import type { LiveMeta, LiveStore } from "../viewStore";

/**
 * A stand-in for `live/` in Firestore, in memory: the meta with a token for each version of it, as
 * Firestore's update time is, the pieces with when each was made, and counts of what each call
 * would cost. Shared by the view store's tests; not a test itself.
 */
export type MemoryLive = {
  store: LiveStore;
  meta: () => LiveMeta | null;
  chunks: Map<string, { data: Uint8Array; createdAt: string }>;
  /** Reads, writes and deletes, as billed: a refused commit costs a read and writes nothing. */
  costs: { reads: number; writes: number; deletes: number };
  /** The time new pieces are stamped with. */
  setNow: (iso: string) => void;
  /** Replaces the meta directly, as another publisher or the console would; a new token. */
  setMeta: (raw: unknown) => void;
  /** Runs once, between the next commit's call and its check: a write that races it. */
  beforeCommit: (hook: () => Promise<void> | void) => void;
};

export const memoryLive = (): MemoryLive => {
  let meta: unknown = null;
  let token = 0;
  let now = "2027-04-15T12:00:00.000Z";
  let racing: (() => Promise<void> | void) | null = null;
  const chunks = new Map<string, { data: Uint8Array; createdAt: string }>();
  const costs = { reads: 0, writes: 0, deletes: 0 };
  const store: LiveStore = {
    readMeta: async () => {
      costs.reads += 1;
      return meta === null ? null : { meta: structuredClone(meta), token: String(token) };
    },
    commitMeta: async (expected, next) => {
      const race = racing;
      racing = null;
      if (race) await race();
      costs.reads += 1;
      if (expected === null ? meta !== null : String(token) !== expected) return false;
      costs.writes += 1;
      meta = structuredClone(next);
      token += 1;
      return true;
    },
    putChunk: async (id, data) => {
      costs.writes += 1;
      chunks.set(id, { data: new Uint8Array(data), createdAt: now });
    },
    getChunk: async (id) => {
      costs.reads += 1;
      return chunks.get(id)?.data ?? null;
    },
    deleteChunk: async (id) => {
      costs.deletes += 1;
      chunks.delete(id);
    },
    listChunks: async () => {
      costs.reads += Math.max(1, chunks.size);
      return [...chunks].map(([id, { createdAt }]) => ({ id, createdAt }));
    },
  };
  return {
    store,
    meta: () => (meta === null ? null : (structuredClone(meta) as LiveMeta)),
    chunks,
    costs,
    setNow: (iso) => {
      now = iso;
    },
    setMeta: (raw) => {
      meta = raw === null ? null : structuredClone(raw);
      token += 1;
    },
    beforeCommit: (hook) => {
      racing = hook;
    },
  };
};
