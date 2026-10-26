import type { AgeGroup, ScoutGame, ScoutTeam } from "../teamRankings/types";

/*
 * How much of the pool a nightly's save would take away, by squad year, and the line past which it
 * is held instead (the owner's rule of 26 October 2026: "hold a save that would remove more than 5%
 * of a year's games or 2% of its clubs, and open an alarm issue saying what it would have done").
 *
 * A night's filing and tidy take things off as a matter of course: a row folded into its twin, a
 * stand-in merged into the club it was, a game GameChanger no longer lists. A great deal at once is
 * something else: a changed answer read as every schedule emptied, a rule gone wrong. Saved, it is
 * every device's pool the next morning; held, the copy stays as it was and the issue says what the
 * night would have done, for a person to look at.
 */

/** The share of a year's games, and of its clubs, a save may take away before it is held. */
export const BLAST_GAME_SHARE = 0.05;
export const BLAST_CLUB_SHARE = 0.02;

/**
 * And the fewest it must take away to be held: a year of a few dozen games, an old page or one just
 * begun, would otherwise be held for a pair of folded rows, every night, and the pool would stop
 * saving for nothing. The cloud copy's year held 386,146 games on 26 October 2026, where 5% is
 * nearly twenty thousand, so the floor never decides there.
 */
export const BLAST_GAME_FLOOR = 50;
export const BLAST_CLUB_FLOOR = 20;

/** What the pool held, by squad year: each year's game ids and club ids. */
export type PoolYears = Map<number, { games: Set<string>; clubs: Set<string> }>;

/** One year's count before the save, and how many of them the save would take away. */
export type YearRadius = {
  year: number;
  games: number;
  gamesRemoved: number;
  clubs: number;
  clubsRemoved: number;
};

/**
 * The pool by squad year: a game in its page's year, and a club in the year of every page it has a
 * game on or a GameChanger team filed under. A page with no year is left out: nothing says which
 * year it is.
 */
export const poolYears = (pool: {
  ageGroups: readonly AgeGroup[];
  teams: readonly ScoutTeam[];
  games: readonly ScoutGame[];
}): PoolYears => {
  const yearOf = new Map<string, number>();
  for (const group of pool.ageGroups)
    if (group.year !== undefined) yearOf.set(group.id, group.year);
  const years: PoolYears = new Map();
  const of = (year: number) => {
    let held = years.get(year);
    if (!held) {
      held = { games: new Set(), clubs: new Set() };
      years.set(year, held);
    }
    return held;
  };
  for (const game of pool.games) {
    const year = yearOf.get(game.ageGroupId);
    if (year === undefined) continue;
    const held = of(year);
    held.games.add(game.id);
    held.clubs.add(game.teamAId);
    held.clubs.add(game.teamBId);
  }
  for (const team of pool.teams) {
    for (const link of team.gcTeams ?? []) {
      const year = yearOf.get(link.ageGroupId);
      if (year !== undefined) of(year).clubs.add(team.id);
    }
  }
  return years;
};

/**
 * What the save would take away, year by year: a game of the year before it that the pool after
 * holds nowhere, and a club of the year before it that the pool after holds nowhere. A game or club
 * that moved to another year is not taken away. In year order.
 */
export const blastRadius = (
  before: PoolYears,
  after: { games: ReadonlySet<string>; clubs: ReadonlySet<string> }
): YearRadius[] =>
  [...before.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, held]) => {
      let gamesRemoved = 0;
      for (const id of held.games) if (!after.games.has(id)) gamesRemoved += 1;
      let clubsRemoved = 0;
      for (const id of held.clubs) if (!after.clubs.has(id)) clubsRemoved += 1;
      return {
        year,
        games: held.games.size,
        gamesRemoved,
        clubs: held.clubs.size,
        clubsRemoved,
      };
    });

/** The years a save would take too much from (`BLAST_GAME_SHARE`, `BLAST_CLUB_SHARE`). */
export const pastTheLine = (radius: readonly YearRadius[]): YearRadius[] =>
  radius.filter(
    (year) =>
      (year.gamesRemoved > year.games * BLAST_GAME_SHARE &&
        year.gamesRemoved >= BLAST_GAME_FLOOR) ||
      (year.clubsRemoved > year.clubs * BLAST_CLUB_SHARE && year.clubsRemoved >= BLAST_CLUB_FLOOR)
  );

/** A year past the line, in words, for the run's log and the alarm issue. */
export const radiusWords = (year: YearRadius): string => {
  const share = (part: number, whole: number) =>
    whole === 0 ? "0%" : `${((100 * part) / whole).toFixed(1)}%`;
  return `${year.year}: would have removed ${year.gamesRemoved} of ${year.games} games (${share(
    year.gamesRemoved,
    year.games
  )}) and ${year.clubsRemoved} of ${year.clubs} clubs (${share(year.clubsRemoved, year.clubs)})`;
};

/**
 * The years held, as the nightly hands them to its alarm step (`runAlarms.ts`): `none` for a night
 * that saved, else `held` and each year's numbers, `2027:60/1000:3/100`. Numbers only, which the
 * alarm reads back and writes again in fixed words.
 */
export const heldWord = (held: readonly YearRadius[]): string =>
  held.length === 0
    ? "none"
    : `held ${held
        .map(
          (year) =>
            `${year.year}:${year.gamesRemoved}/${year.games}:${year.clubsRemoved}/${year.clubs}`
        )
        .join(",")}`;
