import type { AgeUnknownTeam } from "./ageUnknown";
import type { ScoutTeam } from "./teamRankings";
import { MIN_AGE_LEVEL } from "./teamRankings/seasons";

/** Said of a club thrown out once Find a team has brought it back, until its list says so itself. */
export const BROUGHT_BACK = "Taken off the deleted list. Import it again to bring its games in.";

/** What the app remembers about GameChanger ids it did not file onto a club. */
export type GcIdStores = {
  /**
   * The pool as it stands now, given only while a pull runs: Find a team searches the pool as it
   * was when the pull started, so a club filed since carries the id here and not there.
   */
  liveTeams?: readonly ScoutTeam[];
  /** The teams waiting on an age, of which only the id and the name are read. */
  ageless: ReadonlyArray<Pick<AgeUnknownTeam, "teamId" | "name">>;
  dropped: ReadonlySet<string>;
  tooYoung: ReadonlySet<string>;
  /**
   * The GameChanger ids of clubs taken off as plainly made up (`autoRemoved.ts`), each with the day
   * it was; absent where the list it was read off said nothing of them.
   */
  removed?: ReadonlyMap<string, string>;
};

/**
 * Where a GameChanger id is when Find a team has no club carrying it, said as the reason it cannot
 * be found; undefined when the app has no record of the id at all.
 *
 * A pulled id can end somewhere other than a club: waiting on an age nobody could read, thrown out,
 * or refused as younger than the app ranks. The search said "No team matches that." to all of them
 * alike, which is what the user got on 28 September 2026 pasting an id they knew had been pulled.
 * Thrown out is asked first, since a thrown-out id is refused whatever else is known of it.
 */
export const whereIsGcId = (gcTeamId: string, stores: GcIdStores): string | undefined => {
  const filed = stores.liveTeams?.find((team) =>
    team.gcTeams?.some((link) => link.teamId === gcTeamId)
  );
  if (filed)
    return `${filed.name} was filed during the pull that is running. Find a team adds it when the pull ends.`;
  if (stores.dropped.has(gcTeamId))
    return "That team was deleted, so every import skips it. Bring it back, then import it again.";
  const removedOn = stores.removed?.get(gcTeamId);
  if (removedOn !== undefined)
    return `That team was removed automatically on ${removedOn} as plainly made up. Put back, under Removed for you in Pool health, brings it back.`;
  const waiting = stores.ageless.find((row) => row.teamId === gcTeamId);
  if (waiting)
    return `${waiting.name ?? "That team"} is waiting on an age: nothing it was pulled with says one, so it is on no page yet. Give it one under Teams waiting on an age in Setup.`;
  if (stores.tooYoung.has(gcTeamId))
    return `GameChanger says that team is younger than ${MIN_AGE_LEVEL}U, so pulls skip it.`;
  return undefined;
};
