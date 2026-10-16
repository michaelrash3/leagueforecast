import type { FirestoreRestDocuments } from "./firestoreRest";

/** Separate from user-facing progress, so a heartbeat cannot overwrite a checkpoint. */
export const IMPORT_LEASE_MS = 90_000;

/** Where a staged import's execution lease lives, beside its job. */
export const importLeasePath = (jobId: string): string => `pullJobs/${jobId}/control/lease`;

export const importLease = (
  docs: Pick<FirestoreRestDocuments, "readAt" | "replace">,
  jobId: string,
  owner: string
) => {
  const path = importLeasePath(jobId);
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

/**
 * Until when an execution holds the import's lease, in milliseconds: 0 where none ever did or the
 * last one let it go. Read by `startPull` before it ends an import as dead (`reapPullJob`), so a
 * worker that is only slow to write its heartbeat, but still renewing its lease, is left to run.
 */
export const importLeaseUntil = async (
  docs: Pick<FirestoreRestDocuments, "readAt">,
  jobId: string
): Promise<number> => {
  const at = await docs.readAt(importLeasePath(jobId));
  const until = Number(at?.fields.until ?? 0);
  return Number.isFinite(until) ? until : 0;
};
