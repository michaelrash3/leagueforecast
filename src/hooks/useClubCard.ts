import { readView, type DecodedViews } from "../lib/live/liveClient";
import {
  clubBucketOf,
  clubKey,
  coerceClubBucket,
  type ClubBucket,
  type ClubCard,
} from "../lib/live/views/clubShape";
import type { LiveViewSource } from "./useLiveBoard";
import { useLiveView } from "./useLiveView";

/** Buckets decoded this page load, by fingerprint: another club of one is free. */
const decodedClubs: DecodedViews<ClubBucket> = new Map();

/** Only for tests: forgets the buckets decoded so far. */
export const forgetDecodedClubs = (): void => decodedClubs.clear();

/**
 * One club's published card for squad year `year` (`clubShape.ts`), read from its bucket through
 * the same checks as a board (`useLiveView`), or none while `teamId` is null. `failed` says it
 * cannot be had: its bucket could not be read, or the bucket has no card for the club.
 */
export function useClubCard(
  source: LiveViewSource | null,
  year: number | undefined,
  teamId: string | null
): { card: ClubCard | null; failed: boolean } {
  const key = teamId ? clubKey(year, clubBucketOf(teamId)) : null;
  const { view, failed } = useLiveView(source, key, coerceClubBucket, decodedClubs);
  const card = teamId && view ? (view.clubs[teamId] ?? null) : null;
  return { card, failed: failed || (view !== null && card === null) };
}

/**
 * One club's published card, read once rather than held on screen: what marking a club as a page's
 * own sends with it (`page.myTeam`'s `adopt`), so a club League Standings made joins the roster
 * under the mark. Null where it cannot be had.
 */
export const readClubCard = async (
  source: LiveViewSource,
  year: number | undefined,
  teamId: string
): Promise<ClubCard | null> => {
  const done = await readView({
    reader: source.reader,
    meta: source.meta,
    key: clubKey(year, clubBucketOf(teamId)),
    cache: source.cache,
    coerce: coerceClubBucket,
    memory: decodedClubs,
  }).catch(() => null);
  return done?.ok ? (done.view.clubs[teamId] ?? null) : null;
};
