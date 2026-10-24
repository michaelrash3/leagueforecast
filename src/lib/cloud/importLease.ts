import type { FirestoreRestDocuments } from "./firestoreRest";
import type { PullJob } from "./pullJobs";

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

/**
 * Said of a try ended by `IMPORT_STALL_MS`, on the job, as Cloud Run's own stop is: true of every
 * try, the last as well, which only Resume carries on.
 */
export const IMPORT_STALLED =
  "The import stopped making progress for 30 minutes, so this try was ended. Downloads are kept, and the import carries on from its saved checkpoints when it is tried again or resumed.";

/** A message from the import's worker, as it posts them (`importWorker.ts`). */
export type ImportWorkerSaid = {
  done?: boolean;
  error?: string;
  progress?: boolean;
  detail?: string;
};

/** What the supervisor knows of its worker between beats. */
export type ImportWatch = {
  /** When the worker last said anything, or started. */
  heardAt: number;
  /** The last detail it gave, for the next beat to write beside the heartbeat. */
  latestDetail: { detail: string; progressAt: string } | null;
};

/**
 * The watch once the worker has said `message`: every message is a word, whatever it carries,
 * since most carry no detail (every stage written and every checkpoint of downloads posts a bare
 * `progress`), and one with a detail also replaces the detail. Time in milliseconds.
 */
export const importHeard = (
  watch: ImportWatch,
  message: ImportWorkerSaid,
  now: number
): ImportWatch => ({
  heardAt: now,
  latestDetail: message.detail
    ? { detail: message.detail, progressAt: new Date(now).toISOString() }
    : watch.latestDetail,
});

/**
 * Whether the beat carries out a stop that was asked for: not while the copy is being saved, which
 * finishes first, and not once the job has ended. A stop asked during the save used to be carried
 * out once the save had finished, the finished import written over as stopped and its downloads
 * then deleted as finished, so Resume downloaded the whole list again.
 */
export const importStopsNow = (
  job: Pick<PullJob, "stopAsked" | "stage" | "status"> | null
): boolean =>
  job !== null &&
  job.stopAsked &&
  job.stage !== "saving" &&
  job.status !== "done" &&
  job.status !== "failed" &&
  job.status !== "cancelled";

/**
 * The status a try that failed leaves its job in: stopped where a stop was asked (a save that hung
 * after Stop was pressed, ended by the stall or by Cloud Run), failed on the last try, and as it
 * was otherwise, for the next try.
 */
export const importTryStatus = ({
  last,
  stopAsked,
}: {
  last: boolean;
  stopAsked: boolean;
}): "cancelled" | "failed" | null => (stopAsked ? "cancelled" : last ? "failed" : null);

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

/**
 * Keeps `lease` renewed every `everyMs` for a run that says nothing as it goes, a leg on GitHub
 * (`legJob.ts`), and calls `onLost` once where the lease is gone: taken by another execution, or
 * not renewed in time for it to stand (`importBeat`'s "lost-contact"), when another may take it
 * over. The run must then stop at once, writing nothing (Codex, on #440): a leg's end writes its
 * count of legs done over whatever is there, so a second execution of the leg running beside it
 * could have its progress overwritten. Stops itself after `onLost`; the returned function stops it
 * otherwise.
 */
export const watchLease = (
  lease: { renew: (now: number) => Promise<boolean> },
  onLost: (why: "taken" | "lost-contact") => void,
  now: () => number = Date.now,
  everyMs = 10_000
): (() => void) => {
  let renewedAt = now();
  let renewing = false;
  let over = false;
  const lost = (why: "taken" | "lost-contact") => {
    if (over) return;
    over = true;
    clearInterval(beat);
    onLost(why);
  };
  const beat = setInterval(() => {
    if (importBeat({ now: now(), renewedAt, heardAt: now() }) === "lost-contact") {
      lost("lost-contact");
      return;
    }
    if (renewing) return;
    renewing = true;
    const asked = now();
    void lease
      .renew(asked)
      .then((owned) => {
        if (!owned) lost("taken");
        else renewedAt = asked;
      })
      // A renewal that fails is only a renewal: the next tries again, until the lease would lapse.
      .catch(() => undefined)
      .finally(() => {
        renewing = false;
      });
  }, everyMs);
  return () => {
    over = true;
    clearInterval(beat);
  };
};
