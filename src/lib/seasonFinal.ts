import { displayName } from "./format";

/** How a finished season ended, in the words the Dashboard shows. */
export type SeasonFinal = {
  leader: string;
  champion?: string;
  silverChampion?: string;
  /** The followed team's finish, as a sentence. */
  ourTeam?: string;
};

type Named = { id: string; name: string };

/** A bracket's champion and how the bracket decided it (`BracketProjection`). */
type Crowned = { team: Named | null; source: string };

/**
 * How the season ended, or null while any of it is still to play: every regular-season game final
 * and, where there is a postseason, the bracket's final decided on the field (or no final needed,
 * for a bracket of one). Worked out from what the device already holds.
 */
export const seasonFinalOf = ({
  standings,
  remaining,
  scheduled,
  hasPostseason,
  champion,
  silverChampion,
  ourTeamId,
}: {
  standings: readonly Named[];
  remaining: number;
  scheduled: number;
  hasPostseason: boolean;
  champion: Crowned;
  silverChampion?: Crowned;
  ourTeamId?: string | null;
}): SeasonFinal | null => {
  const leader = standings[0];
  if (!leader || scheduled === 0 || remaining > 0) return null;
  const crowned = (crown: Crowned) => crown.source === "actual" || crown.source === "bye";
  if (hasPostseason && !crowned(champion)) return null;
  const champ = hasPostseason ? champion.team : null;
  const silver = silverChampion?.source === "actual" ? silverChampion.team : null;
  const place = ourTeamId ? standings.findIndex((team) => team.id === ourTeamId) : -1;
  const ours = place >= 0 ? standings[place] : undefined;
  return {
    leader: displayName(leader.name),
    ...(champ ? { champion: displayName(champ.name) } : {}),
    ...(silver ? { silverChampion: displayName(silver.name) } : {}),
    ...(ours
      ? {
          ourTeam: `${displayName(ours.name)} finished ${place + 1} of ${standings.length}${
            champ?.id === ours.id ? ", and won it all." : "."
          }`,
        }
      : {}),
  };
};
