import { applyChanges, createdApart, type LeagueDocChange } from "../leagueDocs";
import {
  madeAt,
  type LeagueHeard,
  type LeagueRemote,
  type LeagueStore,
  type LeagueWrite,
} from "../leagueStore";

/**
 * League seasons in memory, behaving as Firestore does where the live store leans on it: a
 * listener hears the document as it is when it starts and after every write, later and in the
 * order the writes landed; a transaction runs its plan again when the document changed under it;
 * offline, writes fail and the listener says its copy is its own. Another device's writes are
 * `put` and `edit`; `interfere` lands one between a transaction's read and its write.
 */
export const memoryLeague = () => {
  const docs = new Map<string, Record<string, unknown>>();
  const versions = new Map<string, number>();
  const watchers = new Map<string, Set<LeagueHeard>>();
  let online = true;
  let interference: (() => void) | null = null;
  let failure: string | null = null;
  let holding: (() => void)[] | null = null;
  const counts = { transactions: 0, writes: 0, runs: 0 };

  const remoteOf = (docId: string): LeagueRemote => {
    const data = docs.get(docId);
    return data ? { exists: true, data: structuredClone(data) } : { exists: false };
  };

  const tell = (docId: string) => {
    const remote = remoteOf(docId);
    const fromServer = online;
    for (const heard of watchers.get(docId) ?? []) {
      const deliver = () => {
        if (watchers.get(docId)?.has(heard)) heard.next(structuredClone(remote), fromServer);
      };
      if (holding) holding.push(deliver);
      else queueMicrotask(deliver);
    }
  };

  const bump = (docId: string) => versions.set(docId, (versions.get(docId) ?? 0) + 1);

  const applyTo = (docId: string, changes: readonly LeagueDocChange[]) => {
    const data = docs.get(docId);
    if (!data) throw Object.assign(new Error("no document"), { code: "not-found" });
    docs.set(docId, applyChanges(data, changes));
  };

  const commit = (docId: string, write: LeagueWrite) => {
    if ("create" in write)
      docs.set(docId, structuredClone(write.create) as Record<string, unknown>);
    else applyTo(docId, write.changes);
    counts.writes += 1;
    bump(docId);
    tell(docId);
  };

  const store: LeagueStore = {
    watch: (docId, heard) => {
      const set = watchers.get(docId) ?? new Set<LeagueHeard>();
      set.add(heard);
      watchers.set(docId, set);
      const remote = remoteOf(docId);
      const fromServer = online;
      queueMicrotask(() => {
        if (set.has(heard)) heard.next(remote, fromServer);
      });
      return () => {
        set.delete(heard);
      };
    },
    update: async (docId, plan) => {
      counts.transactions += 1;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        if (!online) throw Object.assign(new Error("offline"), { code: "unavailable" });
        if (failure) {
          const code = failure;
          failure = null;
          throw Object.assign(new Error(code), { code });
        }
        const version = versions.get(docId) ?? 0;
        counts.runs += 1;
        const { write, result } = plan(remoteOf(docId));
        await Promise.resolve();
        const meddle = interference;
        interference = null;
        meddle?.();
        if ((versions.get(docId) ?? 0) !== version) continue;
        if (write) commit(docId, write);
        return result;
      }
      throw Object.assign(new Error("contention"), { code: "aborted" });
    },
    list: async () => {
      if (!online) throw Object.assign(new Error("offline"), { code: "unavailable" });
      return [...docs.keys()].sort().map((docId) => ({
        docId,
        data: structuredClone(docs.get(docId)),
      }));
    },
    remove: async (docId, createdAt) => {
      if (!online) throw Object.assign(new Error("offline"), { code: "unavailable" });
      const data = docs.get(docId);
      if (!data) return "absent";
      if (createdApart(madeAt(data) ?? "", createdAt)) return "other";
      docs.delete(docId);
      bump(docId);
      tell(docId);
      return "deleted";
    },
  };

  return {
    store,
    counts,
    read: (docId: string): Record<string, unknown> | undefined => {
      const data = docs.get(docId);
      return data ? structuredClone(data) : undefined;
    },
    /** Another device writes the whole document. */
    put: (docId: string, data: object) => commit(docId, { create: data as never }),
    /** Another device writes some fields, one write past the last, as the rules hold it to. */
    edit: (docId: string, changes: readonly LeagueDocChange[]) => {
      const rev = docs.get(docId)?.rev;
      commit(docId, {
        changes: [...changes, { path: ["rev"], value: (typeof rev === "number" ? rev : 0) + 1 }],
      });
    },
    /** Ends every listener on a season with `code`, as Firestore ends one that fails. */
    failWatch: (docId: string, code: string) => {
      const set = watchers.get(docId);
      if (!set) return;
      const ended = [...set];
      set.clear();
      ended.forEach((heard) =>
        queueMicrotask(() => heard.error(Object.assign(new Error(code), { code })))
      );
    },
    /** How many listeners a season has. */
    listeners: (docId: string) => watchers.get(docId)?.size ?? 0,
    /** Another device deletes the season. */
    remove: (docId: string) => {
      docs.delete(docId);
      bump(docId);
      tell(docId);
    },
    /** Runs `meddle` once, between the next transaction's read and its write. */
    interfere: (meddle: () => void) => {
      interference = meddle;
    },
    /** The next transaction fails with `code`, connected as ever. */
    failNext: (code: string) => {
      failure = code;
    },
    /** Arrivals wait until `release`, as a slow listener's do. */
    hold: () => {
      holding = [];
    },
    release: () => {
      const waiting = holding ?? [];
      holding = null;
      waiting.forEach((deliver) => queueMicrotask(deliver));
    },
    offline: () => {
      online = false;
      for (const docId of watchers.keys()) tell(docId);
    },
    online: () => {
      online = true;
      for (const docId of watchers.keys()) tell(docId);
    },
  };
};

/** Lets every queued arrival and transaction step run. */
export const settled = async (): Promise<void> => {
  for (let round = 0; round < 20; round += 1) await Promise.resolve();
};
