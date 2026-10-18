import type { AgelessAside } from "../agelessQueue";
import type { AgeUnknownTeam } from "../ageUnknown";

/*
 * A hit of the server's `ageless.search` (`queries.ts`) as it is sent and read, in a module of its
 * own: the device's live card and reader need these few lines, and taking them from the server's
 * questions would put the whole of that file in the Team Rankings download.
 */

/**
 * The reasons a search's hit carried in `aside` before 18 October 2026, the five every build since
 * the search reads. A build reads `aside` strictly, refusing the whole answer for a reason it has
 * no words for, and the live page waits for the person to take an update (`registerType:
 * "prompt"`), so a phone can run such a build for days after the server moves on. Any later reason
 * goes in `setAsideBy`, which those builds never read: there the row shows with no note, as on the
 * queue, rather than the search failing. On the backup of 11 October 2026, 8,341 of the 13,169
 * rows carry one of the later reasons.
 */
export const FIRST_ASIDES = [
  "dropped",
  "named",
  "high-school",
  "short-roster",
  "left-alone",
] as const satisfies readonly AgelessAside[];

export type FirstAside = (typeof FIRST_ASIDES)[number];

const isFirstAside = (aside: AgelessAside): aside is FirstAside =>
  (FIRST_ASIDES as readonly AgelessAside[]).includes(aside);

/** A team the search found, and what stands between it and the queue, in whichever field fits. */
export type AgelessSearchHit = {
  entry: AgeUnknownTeam;
  /** One of the first five reasons (`FIRST_ASIDES`), the only ones a server before them had. */
  aside?: FirstAside;
  /** Any reason after those, where a build from before it never looks. */
  setAsideBy?: AgelessAside;
};

/** What stands between a hit and the queue, whichever field carried it. */
export const hitAside = (hit: AgelessSearchHit): AgelessAside | undefined =>
  hit.setAsideBy ?? hit.aside;

/** A hit as it is sent: a first reason where every build reads one, a later one beside it. */
export const searchHit = (
  entry: AgeUnknownTeam,
  aside: AgelessAside | undefined
): AgelessSearchHit =>
  aside === undefined
    ? { entry }
    : isFirstAside(aside)
      ? { entry, aside }
      : { entry, setAsideBy: aside };
