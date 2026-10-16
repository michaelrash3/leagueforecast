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
 *
 * A launcher that finds the lease held asks its holder to publish again once it is done (`again`,
 * what it asked merged into what any launcher before it asked), since a job that read the copy
 * before the launcher's save would otherwise end without it: a pull's end has no check to ask after
 * it where the rebuilds are not deployed (Codex, on #409). The job hands the lease back at its end
 * (`handBack`), and finds there whether it was asked again, in the same write.
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
const askOf = (fields: unknown): LaunchAsk | null => {
  if (typeof fields !== "object" || fields === null) return null;
  const { settleMs, rebuilds } = fields as Record<string, unknown>;
  if (typeof settleMs !== "number" || !(settleMs >= 0) || !Number.isFinite(settleMs)) return null;
  if (typeof rebuilds !== "boolean") return null;
  return { settleMs, rebuilds };
};

/** Two asks as one: the shorter settle, and a rebuild counted on only where both count on one. */
const merged = (was: LaunchAsk | null, ask: LaunchAsk): LaunchAsk =>
  was
    ? { settleMs: Math.min(was.settleMs, ask.settleMs), rebuilds: was.rebuilds && ask.rebuilds }
    : ask;

/** How many times a launcher may find the lease moved under it before it takes it for held. */
const TRIES = 3;

/**
 * How many times the job's own writes are tried again while launchers keep writing onto the lease
 * under it: each such write is one launcher's ask, merged in, so ten at once is past any day's
 * pulls and checks, where three could be lost to three pulls ending together (Codex, on #409).
 */
const HOLDER_TRIES = 10;

type LeaseDocs = Pick<FirestoreRestDocuments, "readAt" | "replace">;

const heldUntil = (fields: Record<string, unknown> | undefined): number => {
  const until = Number(fields?.until ?? 0);
  return Number.isFinite(until) ? until : 0;
};

export type PublishLease = {
  /**
   * For a launcher, at `now`: the lease claimed for a launch, or until when someone else holds it,
   * who is asked to publish again once done (`handBack`). Read again where another writer moved it
   * between the read and the write.
   */
  launch: (now: number, ask: LaunchAsk) => Promise<{ ok: true } | { ok: false; until: number }>;
  /** A launch's claim let go again, where the launch failed and no job is coming to take it. */
  unlaunch: () => Promise<void>;
  /**
   * For the job, at `now`: taken over from a launch or a lapsed holder, read again where a launcher
   * wrote onto the claim meanwhile, with what the launch asked where it was one (null otherwise: a
   * job started by hand); not taken where a job holds it.
   */
  take: (
    now: number,
    owner: string
  ) => Promise<{ taken: false } | { taken: true; asked: LaunchAsk | null }>;
  /**
   * The job's hold handed back at `now`, where it is still the job's: let go, and null; or, where a
   * launcher asked meanwhile, kept for another round, and what was asked.
   */
  handBack: (owner: string, now: number) => Promise<LaunchAsk | null>;
  /**
   * The job's hold given up at `now` after its last round: let go, and null; or, where a launcher
   * asked during that round, turned into a launch's claim carrying the ask, for the job its
   * holder starts next to take over, and the ask (Codex, on #409).
   */
  handOn: (owner: string, now: number) => Promise<LaunchAsk | null>;
  /** The job's hold let go, where it is still the job's, asked again or not. */
  release: (owner: string) => Promise<void>;
};

export const publishLease = (docs: LeaseDocs): PublishLease => ({
  launch: async (now, ask) => {
    for (let tries = 0; tries < TRIES; tries += 1) {
      const at = await docs.readAt(PUBLISH_LEASE_PATH);
      const until = heldUntil(at?.fields);
      if (at && until > now) {
        const again = merged(askOf(at.fields.again), ask);
        if (await docs.replace(PUBLISH_LEASE_PATH, { ...at.fields, again }, at.token))
          return { ok: false, until };
        continue;
      }
      const wrote = await docs.replace(
        PUBLISH_LEASE_PATH,
        { owner: LAUNCH, until: now + LAUNCH_HOLD_MS, ...ask },
        at?.token ?? null
      );
      if (wrote) return { ok: true };
    }
    return { ok: false, until: now + LAUNCH_HOLD_MS };
  },
  unlaunch: async () => {
    const at = await docs.readAt(PUBLISH_LEASE_PATH);
    if (at?.fields.owner === LAUNCH)
      await docs.replace(PUBLISH_LEASE_PATH, { owner: "", until: 0 }, at.token);
  },
  take: async (now, owner) => {
    // Read again where the claim moved under it: a launcher that found the claim held and wrote
    // its ask onto it, which this job, yet to read the copy, publishes for (Codex, on #409).
    for (let tries = 0; tries < TRIES; tries += 1) {
      const at = await docs.readAt(PUBLISH_LEASE_PATH);
      if (at && at.fields.owner !== LAUNCH && heldUntil(at.fields) > now) return { taken: false };
      const wrote = await docs.replace(
        PUBLISH_LEASE_PATH,
        { owner, until: now + PUBLISH_HOLD_MS },
        at?.token ?? null
      );
      if (!wrote) continue;
      // A job's own hold carries no ask, so one taken over from a lapsed job reads as asked
      // nothing. A launch's carries its own, and what launchers that found it held asked after it.
      const launched = at ? askOf(at.fields) : null;
      return { taken: true, asked: launched && merged(askOf(at?.fields.again), launched) };
    }
    return { taken: false };
  },
  handBack: async (owner, now) => {
    for (let tries = 0; tries < HOLDER_TRIES; tries += 1) {
      const at = await docs.readAt(PUBLISH_LEASE_PATH);
      if (at?.fields.owner !== owner) return null;
      const again = askOf(at.fields.again);
      const next = again ? { owner, until: now + PUBLISH_HOLD_MS } : { owner: "", until: 0 };
      if (await docs.replace(PUBLISH_LEASE_PATH, next, at.token)) return again;
    }
    return null;
  },
  handOn: async (owner, now) => {
    for (let tries = 0; tries < HOLDER_TRIES; tries += 1) {
      const at = await docs.readAt(PUBLISH_LEASE_PATH);
      if (at?.fields.owner !== owner) return null;
      const again = askOf(at.fields.again);
      const next = again
        ? { owner: LAUNCH, until: now + LAUNCH_HOLD_MS, ...again }
        : { owner: "", until: 0 };
      if (await docs.replace(PUBLISH_LEASE_PATH, next, at.token)) return again;
    }
    return null;
  },
  release: async (owner) => {
    const at = await docs.readAt(PUBLISH_LEASE_PATH);
    if (at?.fields.owner === owner)
      await docs.replace(PUBLISH_LEASE_PATH, { owner: "", until: 0 }, at.token);
  },
});
