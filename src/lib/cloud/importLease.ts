import type { FirestoreRestDocuments } from "./firestoreRest";

/** Separate from user-facing progress, so a heartbeat cannot overwrite a checkpoint. */
export const IMPORT_LEASE_MS = 90_000;
export const importLease = (
  docs: Pick<FirestoreRestDocuments, "readAt" | "replace">,
  jobId: string,
  owner: string
) => {
  const path = `pullJobs/${jobId}/control/lease`;
  return {
    claim: async (now: number): Promise<boolean> => {
      const at = await docs.readAt(path);
      const until = Number(at?.fields.until ?? 0);
      if (at && at.fields.owner !== owner && until > now) return false;
      return docs.replace(path, { owner, until: now + IMPORT_LEASE_MS }, at?.token ?? null);
    },
    renew: async (now: number): Promise<boolean> => {
      const at = await docs.readAt(path);
      if (!at || at.fields.owner !== owner || Number(at.fields.until) <= now) return false;
      return docs.replace(path, { owner, until: now + IMPORT_LEASE_MS }, at.token);
    },
    release: async (): Promise<void> => {
      const at = await docs.readAt(path);
      if (at?.fields.owner === owner) await docs.replace(path, { owner, until: 0 }, at.token);
    },
  };
};
