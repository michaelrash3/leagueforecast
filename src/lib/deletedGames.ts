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

/** The list with these rows allowed back, so the next pull may file them again. */
export const restoreGames = (deleted: DeletedGames, ids: readonly string[]): Set<string> => {
  const next = new Set(deleted);
  ids.forEach((id) => next.delete(id));
  return next;
};

/**
 * A scored game on a day that has not happened.
 *
 * `today` is passed rather than read, so one clock decides it and a test can say which day it is
 * — the same reason `poolHealth` takes it. The comparison is a plain string one: both sides are
 * ISO days, and a game dated exactly today is not ahead of anything.
 */
export const isDatedAhead = (
  game: { date?: string; teamAScore?: number; teamBScore?: number },
  today: string
): boolean =>
  game.teamAScore !== undefined &&
  game.teamBScore !== undefined &&
  game.date !== undefined &&
  game.date > today;
