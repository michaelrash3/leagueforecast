import { gcAgeLevels, gcLinkSquadYear } from "../teamRankings";
import type { NamedAges } from "../namedAges";
import type { AgeGroup, ScoutTeam } from "./types";

/** A club's level in a squad year, and the level a person pinned it at, if one did. */
export type ClubAge = { level?: number; pinned?: { level: number; was?: number } };

/**
 * A club's level in squad year `year` and whether it was set by hand, for the team panel's Age line.
 * Only for a club with a GameChanger link in the year: its level is the link's, where a club
 * without one has its level read off games other clubs filed. The page's panel reads it
 * (`TeamRankingsView`), and so do the club cards a server publishes (`views/clubs.ts`).
 */
export const clubAgeOf = (
  team: ScoutTeam,
  year: number | undefined,
  ageGroups: AgeGroup[],
  namedAges: NamedAges
): ClubAge | undefined => {
  if (year === undefined) return undefined;
  const links = (team.gcTeams ?? []).filter((link) => gcLinkSquadYear(link, ageGroups) === year);
  if (links.length === 0) return undefined;
  const levels = gcAgeLevels(team, year, ageGroups);
  const level = levels[levels.length - 1];
  const pin = links.map((link) => namedAges.get(link.teamId)).find((entry) => entry?.pinned);
  return {
    ...(level === undefined ? {} : { level }),
    ...(pin
      ? { pinned: { level: pin.level, ...(pin.was === undefined ? {} : { was: pin.was }) } }
      : {}),
  };
};
