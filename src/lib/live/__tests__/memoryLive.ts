import type { LiveMeta, LiveStore, MetaWatch } from "../viewStore";

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
  /**
   * A listener on the meta, as Firestore's: it hears the meta when it starts and after every
   * commit or set, vouched for by the server while the store is reachable.
   */
  watchMeta: MetaWatch;
  /** How many watches are listening. */
  watching: () => number;
  /** Cuts the device off: every watch hears the meta it has, not vouched for, until `reconnect`. */
  cutOff: () => void;
  /** Reaches the server again: every watch hears the meta as it now stands. */
  reconnect: () => void;
  /** Ends every watch with `error`, as a refusal by the rules ends a listener. */
  failWatches: (error: unknown) => void;
};

export const memoryLive = (): MemoryLive => {
  let meta: unknown = null;
  let token = 0;
  let now = "2027-04-15T12:00:00.000Z";
  let racing: (() => Promise<void> | void) | null = null;
  const chunks = new Map<string, { data: Uint8Array; createdAt: string }>();
  const costs = { reads: 0, writes: 0, deletes: 0 };
  type Heard = Parameters<MetaWatch>[0];
  const watches = new Set<Heard>();
  let reachable = true;
  // Each snapshot is the meta as it stood when it changed, delivered on a later turn, as a
  // listener's are.
  const tell = (heard: Heard, fromServer = reachable) => {
    const snapshot: unknown = meta === null ? null : structuredClone(meta);
    queueMicrotask(() => {
      if (watches.has(heard)) heard.next(snapshot, fromServer);
    });
  };
  const tellAll = () => watches.forEach((heard) => tell(heard));
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
      tellAll();
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
      tellAll();
    },
    beforeCommit: (hook) => {
      racing = hook;
    },
    watchMeta: (heard) => {
      watches.add(heard);
      tell(heard);
      return () => {
        watches.delete(heard);
      };
    },
    watching: () => watches.size,
    cutOff: () => {
      reachable = false;
      tellAll();
    },
    reconnect: () => {
      reachable = true;
      tellAll();
    },
    failWatches: (error) => {
      const ended = [...watches];
      watches.clear();
      ended.forEach((heard) => queueMicrotask(() => heard.error(error)));
    },
  };
};
