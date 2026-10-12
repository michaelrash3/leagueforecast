import type { CloudStore } from "../cloudEngine";
import type { CloudManifest } from "../cloudManifest";
import type { CloudMembers } from "../firebaseCloud";
import { memberAddress, sortMembers, type Member } from "../members";

/**
 * A stand-in for the Firestore copy, in memory: the manifest and its pieces, with the same
 * compare-and-swap on version and copy the real store makes, and counts of what each call would
 * cost. Shared by the engine's, the plan's and the session's tests; not a test itself.
 */
export type MemoryCloud = {
  store: CloudStore;
  manifest: () => CloudManifest | null;
  chunks: Map<string, Uint8Array>;
  /** Reads, writes, deletes, and bytes downloaded, as billed. */
  costs: { reads: number; writes: number; deletes: number; bytesDown: number };
  /** Replaces the manifest directly, as the console (or another device) would. */
  setManifest: (manifest: CloudManifest | null) => void;
  /** Holds every delete until the returned function is called: a save asleep after its commit. */
  holdDeletes: () => () => void;
};

export const memoryCloud = (): MemoryCloud => {
  let manifest: CloudManifest | null = null;
  const chunks = new Map<string, Uint8Array>();
  const costs = { reads: 0, writes: 0, deletes: 0, bytesDown: 0 };
  let held: Promise<void> | null = null;
  const store: CloudStore = {
    readManifest: async () => {
      costs.reads += 1;
      return manifest ? structuredClone(manifest) : null;
    },
    commitManifest: async (expected, next) => {
      costs.reads += 1;
      if (expected === null ? manifest !== null : manifest?.version !== expected.version) {
        return false;
      }
      if (expected !== null && manifest?.copy !== expected.copy) return false;
      costs.writes += 1;
      manifest = structuredClone(next);
      return true;
    },
    putChunk: async (id, data) => {
      costs.writes += 1;
      chunks.set(id, new Uint8Array(data));
    },
    getChunk: async (id) => {
      costs.reads += 1;
      const chunk = chunks.get(id) ?? null;
      if (chunk) costs.bytesDown += chunk.length;
      return chunk;
    },
    deleteChunk: async (id) => {
      if (held) await held;
      costs.deletes += 1;
      chunks.delete(id);
    },
  };
  return {
    store,
    manifest: () => manifest,
    chunks,
    costs,
    setManifest: (next) => {
      manifest = next ? structuredClone(next) : null;
    },
    holdDeletes: () => {
      let release = () => undefined as void;
      held = new Promise<void>((resolve) => {
        release = () => {
          held = null;
          resolve();
        };
      });
      return release;
    },
  };
};

/**
 * The list of who may use the copy, in memory, as the rules let `email` see and change it: its own
 * entry for anyone on the list, and the rest for the owner, who alone adds and takes off, and never
 * the owner's own entry. A refusal throws `permission-denied`, as Firestore does.
 */
export const memoryMembers = (
  list: Member[],
  email: () => string | null
): CloudMembers & { entries: () => Member[] } => {
  const refused = () =>
    Object.assign(new Error("Missing or insufficient permissions."), {
      code: "permission-denied",
    });
  const own = () => {
    const address = email();
    return address ? list.find((member) => member.address === memberAddress(address)) : undefined;
  };
  const owner = () => {
    if (own()?.role !== "owner") throw refused();
  };
  return {
    role: async () => own()?.role ?? null,
    list: async () => {
      owner();
      return sortMembers(list);
    },
    add: async (address, addedAt) => {
      owner();
      const key = memberAddress(address);
      if (list.some((member) => member.address === key)) throw refused();
      list.push({ address: key, role: "member", addedAt });
    },
    remove: async (address) => {
      owner();
      const key = memberAddress(address);
      if (key === own()?.address) throw refused();
      list.splice(0, list.length, ...list.filter((member) => member.address !== key));
    },
    entries: () => sortMembers(list),
  };
};
