import { coachesOf } from "./gcStaff";
import {
  clubIsPickable,
  gcAgeLevels,
  levelsForSeason,
  yearsForSeason,
  type AgeGroup,
  type ScoutTeam,
} from "./teamRankings";

/**
 * A club as the picker of which club a League Standings team is lists it, when somebody widens it
 * to every club (`ScoutLinkPanel`): its name, where and at what age it plays, who coaches it, and
 * its GameChanger ids, so a pasted id or link finds it. The fields of the picker's option
 * (`TeamSearchOption`), made in one place so the list this device makes from its own pool and the
 * one the server makes from the cloud's (`league.clubs`) read the same.
 */
export type ClubPickOption = {
  id: string;
  label: string;
  detail?: string;
  coaches?: readonly string[];
  gcIds?: readonly string[];
};

/** Where a club plays, as a picker's row says it. */
export const placeOf = (club: { city?: string; state?: string }): string =>
  [club.city, club.state].filter(Boolean).join(", ");

/**
 * The age on the row. Two clubs of one name in one town are told apart by nothing else a picker
 * shows, and a list reading "Cincy Stix Navy · Harrison, OH" twice over cannot be chosen from.
 */
export const levelOf = (club: { ageLevel?: number }): string =>
  club.ageLevel === undefined ? "" : `${club.ageLevel}U`;

/**
 * Every club that could be picked by hand for a team of season `seasonId`, with the age
 * GameChanger has it at when it says: the two conditions the narrow list applies, over the whole
 * pool rather than over this season's pages, of a club GameChanger knows, at this board's level or
 * one below it.
 *
 * Without the second, typing a name into the wide search returned every club in the country called
 * that, at every age from 8U to 18U, which is how three "Cincy Stix Navy" came back with nothing on
 * the rows to choose between them.
 */
export const pickableClubs = (
  seasonId: string,
  ageGroups: AgeGroup[],
  teams: readonly ScoutTeam[]
): Array<ScoutTeam & { ageLevel?: number }> => {
  const levels = levelsForSeason(seasonId, ageGroups);
  const years = yearsForSeason(seasonId, ageGroups);
  return teams
    .filter((team) => clubIsPickable(team, levels, years, ageGroups))
    .map((team) => {
      const ageLevel = gcAgeLevels(team, years[0], ageGroups)[0];
      return ageLevel === undefined ? team : { ...team, ageLevel };
    });
};

/** A club as the wide picker lists it. */
export const clubPickOption = (club: ScoutTeam & { ageLevel?: number }): ClubPickOption => {
  const detail = [placeOf(club), levelOf(club)].filter(Boolean).join(" · ");
  const coaches = coachesOf(club);
  return {
    id: club.id,
    label: club.name,
    ...(detail ? { detail } : {}),
    ...(coaches.length > 0 ? { coaches } : {}),
    ...(club.gcTeams?.length ? { gcIds: club.gcTeams.map((link) => link.teamId) } : {}),
  };
};
