import { isDatedAhead } from "./deletedGames";
import type { GcImportState } from "./gameChangerImport";
import { squadYearHoldings, type SquadYearHolding } from "./poolHealth";
import { isImplausibleScore, ratedMargin } from "./teamRankings";
import { ageGroupYear } from "./teamRankings/seasons";
import type { ScoutGame } from "./teamRankings/types";
import { clubsByGcId, filedBy, unrealClubs, type UnrealClub } from "./unrealClubs";

/**
 * What Pool health shows as it opens, before anyone asks it to look harder (`PoolHealthCard`): what
 * each squad year holds, the results scored on a day that has not happened, the games won by more
 * than `IMPLAUSIBLE_MARGIN` runs, and the clubs those rows belong to. Worked out the same way from a
 * device's own pool and from the server's (`health.summary`, `queries.ts`), so the card draws the
 * one as it draws the other.
 */

/**
 * A game a list names, as the list draws it and an edit names it: its id, day, sides and score;
 * the squad year it is stored under, which a confirmed score is saved in (null for a page with no
 * year); and the clubs whose own schedules filed it (`filedBy`), which say whose schedule to open.
 */
export type HealthGame = {
  id: string;
  date?: string;
  teamAId: string;
  teamBId: string;
  teamAScore?: number;
  teamBScore?: number;
  year: number | null;
  filers: string[];
};

export type PoolHealthSummary = {
  holdings: SquadYearHolding[];
  /** Scored on a day that has not happened, in the pool's order. */
  datedAhead: HealthGame[];
  /** Won by more than `IMPLAUSIBLE_MARGIN` runs, the widest first, then the earliest. */
  implausible: Array<{ game: HealthGame; margin: number }>;
  /** The clubs those rows belong to, worst first (`unrealClubs`). */
  suspected: UnrealClub[];
  /**
   * Every club a row names, by id (the clubs that filed a row are among its two sides,
   * `filedBy`): its name, and the first GameChanger id it was pulled under, whose schedule the list
   * links to. A club the roster has no entry for is left out, and drawn by its id, as the card
   * always drew one.
   */
  clubs: Record<string, { name: string; gcId?: string }>;
};

/** What Pool health shows as it opens, from `pool`, on `today`, with the stored games per year. */
export const poolHealthSummary = (
  pool: GcImportState,
  today: string,
  storedByYear: { year: number | undefined; games: number }[]
): PoolHealthSummary => {
  const clubOfGcId = clubsByGcId(pool.teams);
  const yearOfPage = new Map(pool.ageGroups.map((group) => [group.id, ageGroupYear(group)]));
  const rowOf = (game: ScoutGame): HealthGame => ({
    id: game.id,
    ...(game.date === undefined ? {} : { date: game.date }),
    teamAId: game.teamAId,
    teamBId: game.teamBId,
    ...(game.teamAScore === undefined ? {} : { teamAScore: game.teamAScore }),
    ...(game.teamBScore === undefined ? {} : { teamBScore: game.teamBScore }),
    year: yearOfPage.get(game.ageGroupId) ?? null,
    filers: filedBy(game, clubOfGcId),
  });
  const datedAhead = pool.games.filter((game) => isDatedAhead(game, today)).map(rowOf);
  const implausible = pool.games
    .filter(isImplausibleScore)
    .map((game) => ({ game, margin: Math.abs(ratedMargin(game) ?? 0) }))
    .sort((a, b) => b.margin - a.margin || (a.game.date ?? "").localeCompare(b.game.date ?? ""))
    .map(({ game, margin }) => ({ game: rowOf(game), margin }));

  const named = new Set<string>();
  for (const game of [...datedAhead, ...implausible.map(({ game: row }) => row)]) {
    named.add(game.teamAId);
    named.add(game.teamBId);
  }
  const byId = new Map(pool.teams.map((team) => [team.id, team]));
  const clubs: PoolHealthSummary["clubs"] = {};
  for (const id of named) {
    const team = byId.get(id);
    if (!team) continue;
    const gcId = team.gcTeams?.[0]?.teamId;
    clubs[id] = { name: team.name, ...(gcId === undefined ? {} : { gcId }) };
  }
  return {
    holdings: squadYearHoldings(pool.ageGroups, pool.teams, storedByYear),
    datedAhead,
    implausible,
    suspected: unrealClubs(pool, today),
    clubs,
  };
};

/** A club the summary names, by id, or none: only its own entries, never one every object has. */
export const clubOf = (
  summary: Pick<PoolHealthSummary, "clubs">,
  teamId: string
): { name: string; gcId?: string } | undefined =>
  Object.prototype.hasOwnProperty.call(summary.clubs, teamId) ? summary.clubs[teamId] : undefined;

/**
 * The rows scored ahead, the worst club's first, as the card draws them: each placed where the
 * club that filed it sits among `unreal` (the suspected clubs nobody has vouched for), a club's
 * rows in date order, with the schedule to open (the worst filer's first GameChanger id).
 */
export const aheadWorstFirst = (
  summary: Pick<PoolHealthSummary, "datedAhead" | "clubs">,
  unreal: readonly UnrealClub[]
): Array<{ game: HealthGame; at: number; filer: string; gcId: string | undefined }> => {
  const rank = new Map(unreal.map((club, at) => [club.teamId, at]));
  return summary.datedAhead
    .map((game) => {
      const worst = game.filers.reduce(
        (best, teamId) =>
          (rank.get(teamId) ?? Infinity) < (rank.get(best) ?? Infinity) ? teamId : best,
        game.filers[0] ?? game.teamAId
      );
      return {
        game,
        at: rank.get(worst) ?? Infinity,
        filer: worst,
        gcId: clubOf(summary, worst)?.gcId,
      };
    })
    .sort((a, b) => a.at - b.at || (a.game.date ?? "").localeCompare(b.game.date ?? ""));
};
