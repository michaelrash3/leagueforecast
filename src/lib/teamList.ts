import { displayName } from "./format";
import { createTeamId } from "./sim";
import type { Matchup, Settings, TeamBase } from "./types";

/**
 * A League season's team list before its schedule: teams are saved, more are added later, and the
 * list is locked before any game is made from it.
 */

const nameKey = (name: string) => displayName(name).trim().toLowerCase();

/**
 * The teams to add for the names typed, each once: a name the season already has, or one typed
 * twice, is a slip rather than a second club. Ids are new beside the season's own.
 */
export const teamsToAdd = (existing: readonly TeamBase[], names: readonly string[]): TeamBase[] => {
  const seen = new Set(existing.map((team) => nameKey(team.name)));
  const ids = new Set(existing.map((team) => team.id));
  const added: TeamBase[] = [];
  for (const raw of names) {
    const name = raw.trim();
    const key = nameKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    added.push({ id: createTeamId(displayName(name), ids), name });
  }
  return added;
};

/**
 * Whether the team list is set. A season with a game has one, whatever it says: the list was set
 * when the schedule was made, and a team appearing or going mid-season would throw the standings.
 * Without games, a list is open only where it was started here (`teamsLocked: false`) or has no
 * team yet; a season with teams from before lists were kept, or started from its clubs, reads as
 * set, so its Schedule is as it was.
 */
export const teamListLocked = (
  settings: Settings,
  matchups: readonly Matchup[],
  teams: readonly TeamBase[]
): boolean => matchups.length > 0 || (teams.length > 0 && settings.teamsLocked !== false);
