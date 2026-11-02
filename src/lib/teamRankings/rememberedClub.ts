import type { AgeGroup, GcTeamLink } from "./types";
import { ageGroupYear } from "./seasons";
import { gcIdsForSeason, readClub, type ClubLookup, type RememberedClub } from "./leagueBridge";

/*
 * The parts of reading a club this device remembers (`readClub`) that only Team Rankings' stores
 * use: which GameChanger id a store keeps for a club on a page, and the id a club is shown under
 * once read. Apart from `leagueBridge.ts`, which League Standings' first download carries, so
 * they load with Team Rankings alone.
 */

/**
 * What a store shows a remembered club under once its id is another club's (`readClub`'s
 * `moved`): the id behind this, which no club has, so nothing reads the club now under the id as
 * the one remembered, and the store shows its own club as a club gone is shown, by the name it kept.
 */
export const GONE_CLUB = "gone:";

/** The id a remembered club is shown under now: followed, as it was, or gone (`GONE_CLUB`). */
export const shownClubId = (club: RememberedClub, lookup: ClubLookup | null): string => {
  if (!lookup || !club.gc?.length) return club.id;
  const read = readClub(club, lookup);
  return "moved" in read ? `${GONE_CLUB}${read.moved}` : read.id;
};

/**
 * A club's GameChanger ids as a store keeps one for it on a page: its teams filed on the page, then
 * in the page's squad year, then the rest, the last pulled first in each (`gcIdsForSeason`).
 */
export const pageGcIds = (
  club: { gcTeams?: readonly GcTeamLink[] },
  pageId: string,
  ageGroups: AgeGroup[]
): string[] =>
  gcIdsForSeason(
    new Set([pageId]),
    [ageGroupYear(ageGroups.find((group) => group.id === pageId))],
    ageGroups
  )(club);

/**
 * How many of a club's GameChanger ids a store keeps beside it. One alone named the club by the
 * page's newest link, the likeliest to be undone, and an Unlink of it left a club still on the
 * board reading as gone (the review of 1 November 2026). With three, the club is itself while it
 * carries any of them, through two Unlinks, at 15 bytes for each id past the first (twelve
 * characters, quotes and a comma), measured on the stores' JSON.
 */
export const KEPT_GC_IDS = 3;

/**
 * The GameChanger ids a store keeps beside a club remembered on a page (`RememberedClub.gc`): the
 * first `KEPT_GC_IDS` of `pageGcIds`, the page's own team first, as a pick keeps the season's own.
 * None for a club GameChanger has no id for.
 */
export const keptGcIds = (
  club: { gcTeams?: readonly GcTeamLink[] },
  pageId: string,
  ageGroups: AgeGroup[]
): string[] => pageGcIds(club, pageId, ageGroups).slice(0, KEPT_GC_IDS);
