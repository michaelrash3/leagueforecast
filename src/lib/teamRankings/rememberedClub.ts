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
  if (!lookup || !club.gc) return club.id;
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
 * The GameChanger id a store keeps beside a club remembered on a page (`RememberedClub.gc`): the
 * first of `pageGcIds`, as a pick keeps the season's own, because that is the one that stays the
 * club's longest. None for a club GameChanger has no id for.
 */
export const pageGcId = (
  club: { gcTeams?: readonly GcTeamLink[] },
  pageId: string,
  ageGroups: AgeGroup[]
): string | undefined => pageGcIds(club, pageId, ageGroups)[0];
