import { coerceManifest, type CloudManifest } from "../cloud/cloudManifest";
import type { PullJob, PullJobStage } from "../cloud/pullJobs";
import { coerceRefreshGate, nightlyUnderWay, REFRESH_QUIET_MS } from "../cloud/refreshGate";
import { boardInputsPrint } from "./boardInputs";
import { leaguePrintOf, type CloudLeague } from "./cloudLeague";
import { newerBuildOf } from "./rebuildPlan";
import { BOARD_FAMILY, BOARD_RULES, BOARD_SHAPE } from "./views/boardShape";
import { coerceLiveMeta, LIVE_SCHEMA, needsRepublish } from "./viewStore";

/**
 * The boards caught up with the cloud copy between nights (README, "Boards caught up on GitHub"):
 * whether the published boards are behind the copy, and whether anything is writing the copy, or
 * publishing them itself, that a publish now would run beside. `scripts/catchUp.ts` runs it every
 * half hour on GitHub and, where the boards are behind and nothing is, publishes them as the
 * republish after a deploy does (`republishViews`); it is kept here so its rules are tested.
 *
 * It is for the time a save's own rebuild does not come: rebuilds switched off, paused, deferred to
 * a later month by their budget (as they were from 14 October to 1 November 2026), or failing.
 * Until it, an import or an edit that saved the copy in those times reached the boards only with
 * the nightly, which GitHub starts hours late.
 */

/** Why the published boards are behind the copy, and want publishing. */
export type Behind =
  /** Nothing is published at all. */
  | "nothing"
  /** An older build published them: an older schema, or boards of an older shape or rules. */
  | "older-build"
  /** Nothing says what the boards were built from, or only a floor no one build vouches for. */
  | "no-record"
  /** They were built from another copy than the one there now: a copy made afresh. */
  | "other-copy"
  /** A League Standings season's document changed since they were built. */
  | "league"
  /** What they read of the copy changed since they were built (`boardInputsPrint`). */
  | "inputs";

/** Why the catch-up publishes nothing. */
export type LeftBecause =
  /** There is no copy, or none this build can build from (`newerBuildOf`), or seasons. */
  | "no-copy"
  | "unreadable-copy"
  | "newer-copy"
  | "league-unreadable"
  | "newer-league"
  /** The views are not this build's to replace: unreadable, a newer build's, or a later day's. */
  | "unreadable-views"
  | "newer-views"
  | "later-day"
  /** The boards are the copy's as it stands, whatever day they were built for. */
  | "current"
  /** Behind, but something is at work that a publish now would run beside (`heldBy`). */
  | "nightly-running"
  | "nightly-pulling"
  | "pulling"
  | "rebuilding"
  | "settling";

export type CatchUp =
  { publish: true; behind: Behind } | { publish: false; because: LeftBecause; behind?: Behind };

/**
 * Where the published boards (`live/meta` as stored, null where there is none) stand against the
 * copy `manifest` and the seasons whose fingerprint is `league` (`leaguePrintOf`), on the members'
 * day `today`: behind it, and why, or left as they are, and why.
 *
 * Unlike a rebuild's `boardsState`, two things move nothing here. The day: boards built yesterday
 * from what the copy still holds are the night's to build again for today, and a half-hourly run
 * that took a new day for a reason would publish every board each midnight. And a later version of
 * the copy whose board inputs are the boards' own: a save that moved nothing a board reads asks no
 * rebuild either (`askRebuild`), and publishing it would build the same boards for nothing.
 */
export const boardsBehind = async (
  meta: unknown,
  manifest: CloudManifest,
  league: string,
  today: string
): Promise<{ behind: Behind } | { left: LeftBecause }> => {
  if (meta === null || meta === undefined) return { behind: "nothing" };
  const read = coerceLiveMeta(meta);
  // A publish would refuse each of these (`publishViews`), so building the boards would be for
  // nothing; the nightly's publish refuses them too, and says so.
  if (!read) return { left: "unreadable-views" };
  if (read.schema > LIVE_SCHEMA) return { left: "newer-views" };
  const built = read.built[BOARD_FAMILY];
  if (
    built &&
    (built.rules > BOARD_RULES || (built.rules === BOARD_RULES && (built.shape ?? 0) > BOARD_SHAPE))
  ) {
    return { left: "newer-views" };
  }
  // ISO days, so their order is their text's.
  if (today < read.today) return { left: "later-day" };
  if (needsRepublish(meta)) return { behind: "older-build" };
  if (!built || built.k === "") return { behind: "no-record" };
  if (built.k !== manifest.copy) return { behind: "other-copy" };
  if ((built.league ?? "") !== league) return { behind: "league" };
  if (built.v >= manifest.version) return { left: "current" };
  return built.inputs === (await boardInputsPrint(manifest))
    ? { left: "current" }
    : { behind: "inputs" };
};

/**
 * What may be at work on the copy or the boards, read only once they are found behind it.
 */
export type WritersLook = {
  /**
   * The nightly refresh's runs on GitHub not yet completed (queued, waiting or in progress), as the
   * workflow asked GitHub just before; null where GitHub did not say.
   */
  nightlyRuns: number | null;
  /** The refresh gate (`ops/refresh`, `refreshGate.ts`), its fields as stored. */
  gate: unknown;
  /** The pulls queued or running (`pullJobs`), "Refresh now" and pasted lists alike. */
  jobs: readonly PullJob[];
  /** The rebuild job's control document (`ops/rebuildJob`, `rebuildJobControl.ts`), as stored. */
  rebuildJob: unknown;
};

/**
 * How long the copy must have been still before the catch-up publishes it. An edit's rebuild is
 * asked for within the two minutes its saves gather in, runs five seconds after they close
 * (`REBUILD_WINDOW_S`, `REBUILD_SETTLE_S`), and holds the rebuild job's control document from its
 * launch to its publish (`rebuildJobControl.ts`), so ten minutes after the last save a rebuild that
 * was coming has come, or is seen running; and a burst of edits is one publish after it, not one
 * per run beside a person still editing.
 */
export const CATCH_UP_SETTLE_MS = 10 * 60_000;

/**
 * A staged import's stages that write nothing of the copy: waiting to start or resume, checking
 * its list against the copy, and downloading, which goes to the job's own checkpoints for hours
 * (`stagedImport.ts`). It writes the copy only in its last phase, from filing on. A pull of the
 * older kind ("Refresh now", and a list sent before the staged importer) saves the copy at the end
 * of every leg, so any stage of one counts.
 */
const STAGED_NOT_WRITING: ReadonlySet<PullJobStage> = new Set(["waiting", "checking", "fetching"]);

/**
 * Whether a pull may write the copy while a publish built from it now goes up: queued or running,
 * heard from within the time a refresh may go quiet and still be alive (`REFRESH_QUIET_MS`), and,
 * for a staged import, past its downloads. One not heard from in that time died without saying so,
 * and would otherwise hold the boards back for ever.
 */
export const pullWritesCopy = (job: PullJob, now: Date): boolean => {
  if (job.status !== "queued" && job.status !== "running") return false;
  const heard = Math.max(
    ...[job.updatedAt, job.heartbeatAt, job.progressAt]
      .map((at) => Date.parse(at ?? ""))
      .filter((at) => Number.isFinite(at))
  );
  if (!(now.getTime() - heard < REFRESH_QUIET_MS)) return false;
  return !(job.pipeline === "staged-v1" && STAGED_NOT_WRITING.has(job.stage));
};

/** Whether a rebuild job holds its control document now: launching, or running and heard from. */
const rebuildHolds = (raw: unknown, now: Date): boolean => {
  if (typeof raw !== "object" || raw === null) return false;
  const { owner, until } = raw as { owner?: unknown; until?: unknown };
  return typeof owner === "string" && typeof until === "number" && until > now.getTime();
};

/**
 * What a publish now would run beside, or null where nothing is: the nightly, on GitHub
 * (`nightlyRuns`) or holding the refresh gate while it pulls; a pull or an import writing the copy
 * (`pullWritesCopy`); a rebuild after a save, which publishes the boards itself; or a save less
 * than `CATCH_UP_SETTLE_MS` ago, which a rebuild may yet publish and an edit may yet follow. Running
 * beside any of them harms nothing, since every publish is made over the meta as read and never
 * puts back an older version (`publishViews`): it would build the whole pool for boards a moment
 * from being replaced, or published anyway. A GitHub that did not say is not waited on, for the
 * same reason.
 */
export const heldBy = (look: WritersLook, savedAt: string, now: Date): LeftBecause | null => {
  if (look.nightlyRuns !== null && look.nightlyRuns > 0) return "nightly-running";
  if (nightlyUnderWay(coerceRefreshGate(look.gate), now)) return "nightly-pulling";
  if (look.jobs.some((job) => pullWritesCopy(job, now))) return "pulling";
  if (rebuildHolds(look.rebuildJob, now)) return "rebuilding";
  if (now.getTime() - Date.parse(savedAt) < CATCH_UP_SETTLE_MS) return "settling";
  return null;
};

/**
 * Whether the catch-up publishes now, and why. `copy` is the copy's manifest as stored and when
 * Firestore last wrote it, by its own clock (null where there is no copy); `meta` the views' meta as
 * stored; `league` the seasons as read. What may be at work (`writers`) is read only where the
 * boards are behind, so a run that finds them current costs the reads of the copy's manifest, the
 * meta and the seasons, and nothing more.
 */
export const catchUpDecision = async ({
  copy,
  meta,
  league,
  today,
  now,
  writers,
}: {
  copy: { manifest: unknown; savedAt: string } | null;
  meta: unknown;
  league: CloudLeague;
  today: string;
  now: Date;
  writers: () => Promise<WritersLook>;
}): Promise<CatchUp> => {
  if (!copy) return { publish: false, because: "no-copy" };
  const manifest = coerceManifest(copy.manifest);
  if (!manifest) return { publish: false, because: "unreadable-copy" };
  if (newerBuildOf(manifest)) return { publish: false, because: "newer-copy" };
  if (!league.ok) return { publish: false, because: league.reason };
  const stands = await boardsBehind(meta, manifest, leaguePrintOf(league), today);
  if ("left" in stands) return { publish: false, because: stands.left };
  const held = heldBy(await writers(), copy.savedAt, now);
  return held
    ? { publish: false, because: held, behind: stands.behind }
    : { publish: true, behind: stands.behind };
};

/**
 * Whether the boards published (`meta`) are still behind the copy and the seasons as they now
 * stand: what the catch-up's publish asks before it starts and after a try that did not publish
 * (`republishViews`'s `wanted`), so a rebuild or the nightly that published them meanwhile ends it.
 */
export const stillBehind = async ({
  meta,
  manifest,
  league,
  today,
}: {
  meta: unknown;
  manifest: CloudManifest | null;
  league: CloudLeague;
  today: string;
}): Promise<boolean> => {
  if (!manifest || newerBuildOf(manifest) || !league.ok) return false;
  return "behind" in (await boardsBehind(meta, manifest, leaguePrintOf(league), today));
};
