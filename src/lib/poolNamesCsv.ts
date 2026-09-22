/**
 * The teams that already work, as a file — the tripwire population.
 *
 * `scripts/agelessSweep.ts` measures a candidate rule two ways. What it catches in the backlog is
 * the easy half, and it flatters every rule ever written, because a rule is only ever tried
 * against the teams it was written for. The half that matters is what it catches among the teams
 * the pool already ranks: every one of those has an age and is connected to the rest of the pool,
 * so a rule firing on one is either about to eat a working club or about to relabel a team that
 * is already correctly filed. That is the closest thing to a false-positive rate available
 * without ground truth, and there is no way to compute it from the backlog alone.
 *
 * The backlog leaves the browser as `agelessCsv`. This is the other file, and it is deliberately
 * the smallest thing that answers the question: the id, the name and the age already on it.
 * Names and ages, no games — a hundred thousand rows of that is a few megabytes, where the
 * whole-browser backup carrying the same teams plus every game they played runs to hundreds.
 *
 * The age is here because it turns the tripwire from "does this rule fire on a working team?"
 * into "does it fire with a *different answer* than the one already filed?", which is the sharper
 * question: a rule that reads 10U off a team the pool has at 10U is agreeing, not misfiring.
 */

import { csvEscape } from "./csv";
import type { AgeGroup, ScoutGame, ScoutTeam } from "./teamRankings";

export const POOL_NAMES_CSV_HEADERS = [
  "Team ID",
  "Team Name",
  "Age Level",
  "Squad Year",
  "State",
  "Ranked",
] as const;

/**
 * Whether this row is a club the pool actually ranks.
 *
 * A placeholder is a bracket slot and a name-only team is a club somebody else's schedule
 * mentioned; neither is ranked, and neither is evidence about anything a rule might do wrong.
 * They are written all the same, with the answer in a column, because a rule firing on ten
 * thousand "TBD" rows is worth knowing and worth being able to exclude rather than never seeing.
 */
const isRanked = (team: ScoutTeam): boolean => !team.placeholder && !team.nameOnly;

/**
 * Which age group each team plays in, read off its games.
 *
 * A `ScoutTeam` carries no age group of its own — the age is a property of the result, because a
 * club fields squads at several ages and a game knows which one it was. The commonest group
 * across a team's games is the answer here: a team that played thirty games at 10U and one
 * friendly at 12U is a 10U team, and for a tripwire the modal answer is the one a rule should be
 * agreeing with.
 */
const groupOf = (teams: readonly ScoutTeam[], games: readonly ScoutGame[]): Map<string, string> => {
  const counts = new Map<string, Map<string, number>>();
  const bump = (teamId: string, groupId: string) => {
    const seen = counts.get(teamId) ?? new Map<string, number>();
    seen.set(groupId, (seen.get(groupId) ?? 0) + 1);
    counts.set(teamId, seen);
  };
  games.forEach((game) => {
    bump(game.teamAId, game.ageGroupId);
    bump(game.teamBId, game.ageGroupId);
  });
  const best = new Map<string, string>();
  teams.forEach((team) => {
    const seen = counts.get(team.id);
    if (!seen) return;
    let top: string | undefined;
    let most = 0;
    seen.forEach((n, groupId) => {
      if (n > most) {
        most = n;
        top = groupId;
      }
    });
    if (top !== undefined) best.set(team.id, top);
  });
  return best;
};

/** The whole pool, a chunk at a time, for a Blob to assemble without one giant string. */
export const poolNamesCsvParts = (
  teams: readonly ScoutTeam[],
  ageGroups: readonly AgeGroup[],
  games: readonly ScoutGame[]
): string[] => {
  const groups = new Map(ageGroups.map((group) => [group.id, group]));
  const playsIn = groupOf(teams, games);
  const parts = [`${POOL_NAMES_CSV_HEADERS.join(",")}\n`];
  teams.forEach((team) => {
    const groupId = playsIn.get(team.id);
    const group = groupId === undefined ? undefined : groups.get(groupId);
    const cells = [
      team.id,
      team.name,
      group?.ageLevel ?? "",
      group?.year ?? "",
      team.state ?? "",
      isRanked(team) ? "yes" : "no",
    ];
    parts.push(`${cells.map(csvEscape).join(",")}\n`);
  });
  return parts;
};

export const poolNamesCsv = (
  teams: readonly ScoutTeam[],
  ageGroups: readonly AgeGroup[],
  games: readonly ScoutGame[]
): string => poolNamesCsvParts(teams, ageGroups, games).join("");

/** "gamechanger-pool-names-2026-09-22.csv" */
export const poolNamesCsvFilename = (day: string): string => `gamechanger-pool-names-${day}.csv`;
