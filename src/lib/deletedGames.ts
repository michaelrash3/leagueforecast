/**
 * The games the user has thrown out, so a re-pull does not put them back.
 *
 * A game with a score on a day that has not happened did not happen. You cannot score a game
 * early: a schedule can be opened ahead of time by accident, but it comes back without a score.
 * So a scored row dated in the future is somebody's mistake or somebody's invention, and a pool
 * pulled from a nationwide list carries both — 535 of them here, across 475 clubs, with the worst
 * offenders entirely made up: one called "Test team" with 68 of 68 games ahead of today, another
 * carrying a 106-13 record built on games that have not been played.
 *
 * Throwing one out is only half the job. The next pull of that club's schedule finds it again and
 * files it again, so the deletion has to be remembered rather than merely done. It is remembered
 * against the row's own id — `gc_<teamId>_<gameId>`, minted from GameChanger's two ids and stable
 * across every pull — which is why this needs nothing but a set of strings.
 *
 * A game nobody pulled has no such id and needs no tombstone: deleting one deletes it, and there
 * is no schedule to bring it back.
 */

import { gcRowId, type ScoutGame } from "./teamRankings/types";

export type DeletedGames = ReadonlySet<string>;

/** Whatever was stored, as a set. Anything that is not an id is dropped. */
export const coerceDeletedGames = (raw: unknown): Set<string> => {
  if (!Array.isArray(raw)) return new Set();
  const out = new Set<string>();
  raw.forEach((entry) => {
    if (typeof entry === "string" && entry.length > 0) out.add(entry);
  });
  return out;
};

/** The set as it is stored: a plain array, sorted so a save that changes nothing looks like it. */
export const deletedGamesList = (deleted: DeletedGames): string[] => [...deleted].sort();

export const isDeletedGame = (deleted: DeletedGames, gameId: string): boolean =>
  deleted.has(gameId);

/** The list with these rows marked as thrown out. */
export const forgetGames = (deleted: DeletedGames, ids: readonly string[]): Set<string> =>
  new Set([...deleted, ...ids]);

/**
 * The rows to remember for games being thrown out: each game's own id, and the row it stands on
 * where that is not the one its id was made from — a game that took over a row entered again after
 * the first was deleted, which the next pull finds by that row's id and would file again.
 */
export const rowsOfGames = (
  games: readonly Pick<ScoutGame, "id" | "source">[],
  ids: readonly string[]
): string[] => {
  const drop = new Set(ids);
  const stoodOn = games.flatMap((game) =>
    drop.has(game.id) && game.source && gcRowId(game.source.teamId, game.source.gameId) !== game.id
      ? [gcRowId(game.source.teamId, game.source.gameId)]
      : []
  );
  return [...ids, ...stoodOn];
};

/** The list with these rows allowed back, so the next pull may file them again. */
export const restoreGames = (deleted: DeletedGames, ids: readonly string[]): Set<string> => {
  const next = new Set(deleted);
  ids.forEach((id) => next.delete(id));
  return next;
};

/** An ISO day, which is the only shape this file can compare. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A scored game on a day that has not happened.
 *
 * `today` is passed rather than read, so one clock decides it and a test can say which day it is
 * — the same reason `poolHealth` takes it. The comparison is a plain string one, which is exact
 * for two ISO days and nonsense for anything else, so a date that is not one is not compared at
 * all.
 *
 * That last part is the whole of it. A pulled row carries an ISO day; a row mirrored in from
 * League Standings carries the league's own "M/D", and `"4/12" > "2026-09-20"` is true for no
 * better reason than that "4" sorts after "2". Every league fixture dated April to September was
 * being offered up as a game played on a day still to come, while December and January slipped
 * past — and a date with no year in it cannot answer this question in either direction, so the
 * honest answer is no.
 */
export const isDatedAhead = (
  game: { date?: string; teamAScore?: number; teamBScore?: number },
  today: string
): boolean =>
  game.teamAScore !== undefined &&
  game.teamBScore !== undefined &&
  game.date !== undefined &&
  ISO_DAY.test(game.date) &&
  ISO_DAY.test(today) &&
  game.date > today;

/**
 * A schedule on which nothing has happened yet and every game already has a result.
 *
 * That is not a club that got some dates wrong — a handful of results on the wrong day is what
 * `unrealClubs` lists for somebody to look at. It is a schedule that invented itself: "Test team"
 * with 68 of 68, "ShotByKoRob Scout Team" with 13 of 13, "CA Wildcatters 2031" with 19 of 19. The
 * user's rule, stated flatly: if a team's entire schedule is completed games in the future, the
 * team is fake. So every game counts, scored and unscored alike: one real game already played, or
 * one future game still waiting for its result, and the schedule is not this.
 *
 * "Today" is the caller's, as `isDatedAhead` takes it, and a game dated today is never ahead: a
 * game finished this afternoon is a game, whatever the clock in another time zone says.
 */
export const isInventedSchedule = (
  games: readonly { date?: string; teamScore?: number; opponentScore?: number }[],
  today: string
): boolean =>
  games.length > 0 &&
  games.every(
    (game) =>
      game.teamScore !== undefined &&
      game.opponentScore !== undefined &&
      game.date !== undefined &&
      ISO_DAY.test(game.date) &&
      ISO_DAY.test(today) &&
      game.date > today
  );

/**
 * The clubs the user has thrown out, by GameChanger team id.
 *
 * A row deleted is a row; a club deleted is every row it will ever file. Some of what a
 * nationwide pull brings back is not a club at all — one in this pool is called "Test team" and
 * holds 68 of 68 games on days that have not happened, another carries a 106-13 record built
 * entirely on them, with 20-0 and 17-0 against opponents that appear nowhere else. Deleting their
 * games one at a time is endless, because the schedule that invented them is still in the pull
 * list and files a fresh set on the next run.
 *
 * So the club goes, and its GameChanger ids are remembered. `importOne` refuses a schedule whose
 * id is here before it reads a game off it, which is the only place that can stop the whole thing
 * coming back. A club is remembered by the ids it was pulled under, because that is what a pull
 * asks for — a name is not an identity and the next pull would not match on one anyway.
 */
export type DeletedClubs = ReadonlySet<string>;

export const coerceDeletedClubs = (raw: unknown): Set<string> => coerceDeletedGames(raw);

export const deletedClubsList = (clubs: DeletedClubs): string[] => [...clubs].sort();

export const isDeletedClub = (clubs: DeletedClubs, gcTeamId: string): boolean =>
  clubs.has(gcTeamId);

/** The list with these GameChanger ids marked as thrown out. */
export const forgetClubs = (clubs: DeletedClubs, gcTeamIds: readonly string[]): Set<string> =>
  new Set([...clubs, ...gcTeamIds]);

/** The list with these ids allowed back, so a pull may file them again. */
export const restoreClubs = (clubs: DeletedClubs, gcTeamIds: readonly string[]): Set<string> => {
  const next = new Set(clubs);
  gcTeamIds.forEach((id) => next.delete(id));
  return next;
};

/**
 * The ids on a finished run whose schedules were refused as invented, to be thrown out for good.
 *
 * Refusing one is not enough on its own. Its dates are in the future only until they are not:
 * the "Test team" schedule refused in September reads as a season played by November, and the
 * next pull would file every result on it. Remembered here, it is refused before a game is read
 * however the calendar has moved, exactly as a club somebody threw out by hand is.
 */
export const inventedFromOutcomes = (
  outcomes: readonly { gcTeamId: string; skip?: string }[]
): string[] =>
  outcomes.filter((outcome) => outcome.skip === "invented").map((outcome) => outcome.gcTeamId);
