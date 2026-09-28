import type { ScoutGame, ScoutTeam } from "./teamRankings";

/** How many states a stand-in's line names before it stops. */
export const PLAYED_BY_SHOWN = 3;

/**
 * Where the clubs that played each state-less team are from, most games first.
 *
 * GameChanger lists some clubs with no location, and a search for one listed a bare name among
 * dozens of the same one: an Ohio "Hurricanes" read exactly as the Florida ones, and a search for
 * "hurricanes ohio" could not find it. The clubs it played do carry states, and they are the best
 * word on where it is: on the 26 September backup, the state a pulled club's opponents most often
 * come from was its own for 92% of the 48,045 clubs that have a state. Only teams with no state
 * are answered; a club that says where it is is taken at its word.
 */
export const statesThatPlayed = (
  teams: readonly ScoutTeam[],
  games: readonly ScoutGame[]
): Map<string, string[]> => {
  const stateOf = new Map(teams.map((team) => [team.id, team.state]));
  const counts = new Map<string, Map<string, number>>();
  const note = (teamId: string, opponentId: string) => {
    if (stateOf.get(teamId)) return;
    const state = stateOf.get(opponentId);
    if (!state) return;
    const seen = counts.get(teamId) ?? new Map<string, number>();
    seen.set(state, (seen.get(state) ?? 0) + 1);
    counts.set(teamId, seen);
  };
  games.forEach((game) => {
    note(game.teamAId, game.teamBId);
    note(game.teamBId, game.teamAId);
  });
  return new Map(
    [...counts.entries()].map(([teamId, seen]) => [
      teamId,
      [...seen.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, PLAYED_BY_SHOWN)
        .map(([state]) => state),
    ])
  );
};
