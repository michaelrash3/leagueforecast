import type { FirestoreRestDocuments } from "../cloud/firestoreRest";

/**
 * Who is publishing the boards after a save (README, "Boards published when a pull ends"), kept in
 * one document no client can read or write, so the `boards-publish` job runs once at a time. A
 * launcher (the end of a pull, or a save's check, `afterPull.ts`) claims it as a launch before it
 * starts the job, so two that ask at once start it once; the job takes it over when it starts, and
 * lets it go when it ends. A claim that is never let go (a launch Google refused unanswered, a job
 * killed outright) lapses at its `until`.
 *
 * A launch's claim carries what its launcher asked of the boards (`LaunchAsk`), for the job to ask
 * the same when it asks again (`publishAfterPull`): a save's check, that everything has been still
 * for the settle, so an edit made between the check and the job's start is left to its own check
 * rather than published seconds old beside a person still editing; and a check whose save's rebuild
 * could not be queued, that no rebuild be counted on (Codex, on #409).
 */
export const PUBLISH_LEASE_PATH = "ops/boardsPublish";

/** How long a launch holds the lease for the job it starts: Cloud Run starts one in about a minute. */
export const LAUNCH_HOLD_MS = 5 * 60_000;

/** How long the job holds it: the job's own time limit (`firebase.yml`, 30 minutes). */
export const PUBLISH_HOLD_MS = 30 * 60_000;

/** A launch's owner, which the job it starts may take the lease over from. */
const LAUNCH = "launch";

/**
 * What a launcher asked of the boards, for the job it starts: how long everything must have been
 * still (`settleMs`, none at a pull's end), and whether a rebuild coming may be counted on to
 * publish them instead (`rebuilds`, false where the save's own rebuild could not be queued).
 */
export type LaunchAsk = { settleMs: number; rebuilds: boolean };

/** What a launch's claim says it asked, or null where it says nothing this build can read. */
const askOf = (fields: Record<string, unknown>): LaunchAsk | null => {
  const { settleMs, rebuilds } = fields;
  if (typeof settleMs !== "number" || !(settleMs >= 0) || !Number.isFinite(settleMs)) return null;
  if (typeof rebuilds !== "boolean") return null;
  return { settleMs, rebuilds };
};

type LeaseDocs = Pick<FirestoreRestDocuments, "readAt" | "replace">;

const heldUntil = (fields: Record<string, unknown> | undefined): number => {
  const until = Number(fields?.until ?? 0);
  return Number.isFinite(until) ? until : 0;
};

export type PublishLease = {
  /**
   * For a launcher, at `now`: the lease claimed for a launch, or until when someone else holds it.
   * Lost to another writer between the read and the write, it is held by them.
   */
  launch: (now: number, ask: LaunchAsk) => Promise<{ ok: true } | { ok: false; until: number }>;
  /** A launch's claim let go again, where the launch failed and no job is coming to take it. */
  unlaunch: () => Promise<void>;
  /**
   * For the job, at `now`: taken over from a launch or a lapsed holder, with what the launch asked
   * where it was one (null otherwise: a job started by hand); not taken where a job holds it.
   */
  take: (
    now: number,
    owner: string
  ) => Promise<{ taken: false } | { taken: true; asked: LaunchAsk | null }>;
  /** The job's hold let go, where it is still the job's. */
  release: (owner: string) => Promise<void>;
};

export const publishLease = (docs: LeaseDocs): PublishLease => ({
  launch: async (now, ask) => {
    const at = await docs.readAt(PUBLISH_LEASE_PATH);
    const until = heldUntil(at?.fields);
    if (until > now) return { ok: false, until };
    const wrote = await docs.replace(
      PUBLISH_LEASE_PATH,
      { owner: LAUNCH, until: now + LAUNCH_HOLD_MS, ...ask },
      at?.token ?? null
    );
    return wrote ? { ok: true } : { ok: false, until: now + LAUNCH_HOLD_MS };
  },
  unlaunch: async () => {
    const at = await docs.readAt(PUBLISH_LEASE_PATH);
    if (at?.fields.owner === LAUNCH)
      await docs.replace(PUBLISH_LEASE_PATH, { owner: "", until: 0 }, at.token);
  },
  take: async (now, owner) => {
    const at = await docs.readAt(PUBLISH_LEASE_PATH);
    if (at && at.fields.owner !== LAUNCH && heldUntil(at.fields) > now) return { taken: false };
    const wrote = await docs.replace(
      PUBLISH_LEASE_PATH,
      { owner, until: now + PUBLISH_HOLD_MS },
      at?.token ?? null
    );
    if (!wrote) return { taken: false };
    // A job's own hold carries no ask, so one taken over from a lapsed job reads as asked nothing.
    return { taken: true, asked: at ? askOf(at.fields) : null };
  },
  release: async (owner) => {
    const at = await docs.readAt(PUBLISH_LEASE_PATH);
    if (at?.fields.owner === owner)
      await docs.replace(PUBLISH_LEASE_PATH, { owner: "", until: 0 }, at.token);
  },
});
