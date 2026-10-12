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
 * cannot be had: its bucket could not be read, or the bucket has no card for the club. `absent`
 * says which of those it is when the cloud has no card for the club to give: its bucket read and
 * holding none, or no bucket for it in the meta the page settled on. That is no read gone wrong
 * (offline, damaged, gone), and reading again under the same meta finds the same.
 */
export function useClubCard(
  source: LiveViewSource | null,
  year: number | undefined,
  teamId: string | null
): { card: ClubCard | null; failed: boolean; absent: boolean } {
  const key = teamId ? clubKey(year, clubBucketOf(teamId)) : null;
  const { view, failed, missing } = useLiveView(source, key, coerceClubBucket, decodedClubs);
  const card = teamId && view ? (view.clubs[teamId] ?? null) : null;
  const holdsNone = view !== null && card === null;
  return { card, failed: failed || holdsNone, absent: missing || holdsNone };
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
