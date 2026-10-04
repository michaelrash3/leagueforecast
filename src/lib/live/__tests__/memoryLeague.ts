import type { LeagueDocChange } from "../leagueDocs";
import type { LeagueHeard, LeagueRemote, LeagueStore, LeagueWrite } from "../leagueStore";

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

  const applyChanges = (docId: string, changes: readonly LeagueDocChange[]) => {
    const data = docs.get(docId);
    if (!data) throw Object.assign(new Error("no document"), { code: "not-found" });
    const next = structuredClone(data);
    for (const change of changes) {
      let at: Record<string, unknown> = next;
      change.path.slice(0, -1).forEach((part) => {
        const inner = at[part];
        if (typeof inner !== "object" || inner === null) at[part] = {};
        at = at[part] as Record<string, unknown>;
      });
      const last = change.path[change.path.length - 1] ?? "";
      if ("remove" in change) delete at[last];
      else at[last] = structuredClone(change.value);
    }
    docs.set(docId, next);
  };

  const commit = (docId: string, write: LeagueWrite) => {
    if ("create" in write)
      docs.set(docId, structuredClone(write.create) as Record<string, unknown>);
    else applyChanges(docId, write.changes);
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
    /** Another device writes some fields. */
    edit: (docId: string, changes: readonly LeagueDocChange[]) => commit(docId, { changes }),
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
