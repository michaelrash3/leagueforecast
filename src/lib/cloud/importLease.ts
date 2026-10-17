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

/**
 * How long an import's worker may go without a word before its try is ended as stuck. The
 * supervisor's heartbeat and lease go on while the worker matches and tidies, which is what keeps a
 * slow import alive, and kept a hung one alive too: it said "running", and Cloud Run billed its
 * sixteen gibibytes, for the task's full 24 hours and twice more on the retries. The worker speaks
 * at every stage, every checkpoint of downloads, every batch it files and every step of the tidy,
 * and a hold GameChanger asks for is capped at a minute (`RETRY_AFTER_CAP_MS`); a whole Refresh
 * now leg of 15,240 teams on 16 October 2026, its load, pull, tidy and save, took 416 s. Half an
 * hour of silence is four times that.
 */
export const IMPORT_STALL_MS = 30 * 60_000;

/** Said of a try ended by `IMPORT_STALL_MS`, on the job, as Cloud Run's own stop is. */
export const IMPORT_STALLED =
  "The import stopped making progress for 30 minutes, so this try was ended. Downloads are kept; the next execution, or Resume, continues from the saved checkpoints.";

/**
 * What the supervisor's beat does next: give the try up where its lease could lapse before the
 * next renewal (another execution may take the import over), end it where the worker has said
 * nothing for `IMPORT_STALL_MS`, and renew otherwise. Times in milliseconds since the epoch.
 */
export const importBeat = ({
  now,
  renewedAt,
  heardAt,
}: {
  now: number;
  /** When the lease was last renewed. */
  renewedAt: number;
  /** When the worker last said anything, or started. */
  heardAt: number;
}): "lost-contact" | "stalled" | "renew" => {
  if (now - renewedAt >= IMPORT_LEASE_MS - 20_000) return "lost-contact";
  if (now - heardAt >= IMPORT_STALL_MS) return "stalled";
  return "renew";
};
